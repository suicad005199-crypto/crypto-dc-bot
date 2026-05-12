require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  ActivityType,
  EmbedBuilder,
} = require("discord.js");

const { getExchange } = require("./exchangeAPI");
const { scanMarket } = require("./strategy");

const {
  buildTickerEmbed,
  buildSignalEmbed,
  buildSignalListEmbed,
} = require("./formatter");

/* ---------------------------------- */
/* CONFIG（優化結構） */
/* ---------------------------------- */

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  channelId: process.env.DISCORD_CHANNEL_ID,

  exchange: process.env.EXCHANGE || "okx",

  pollInterval: Number(process.env.POLL_INTERVAL || 300000),
  scanLimit: Number(process.env.SCAN_LIMIT || 30),

  signal: {
    minScore: Number(process.env.SIGNAL_MIN_SCORE || 68),
    maxResults: Number(process.env.SIGNAL_MAX_RESULTS || 5),
    timeframe: process.env.SIGNAL_TIMEFRAME || "15m",
    higherTimeframe: process.env.SIGNAL_HIGHER_TIMEFRAME || "1h",
    cooldown: Number(process.env.SIGNAL_COOLDOWN || 3600000),
  },
};

if (!CONFIG.token || !CONFIG.channelId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID");
  process.exit(1);
}

/* ---------------------------------- */
/* CLIENT */
/* ---------------------------------- */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const api = getExchange(CONFIG.exchange);

let scannerTimer = null;
const signalCooldowns = new Map();

/* ---------------------------------- */
/* CACHE（效能優化） */
/* ---------------------------------- */

let tickerCache = {
  data: null,
  updatedAt: 0,
  ttl: 15000,
};

async function getCachedTickers(symbols) {
  const now = Date.now();

  if (!tickerCache.data || now - tickerCache.updatedAt > tickerCache.ttl) {
    tickerCache.data = await api.getMultipleTickers(symbols);
    tickerCache.updatedAt = now;
  }

  return tickerCache.data;
}

/* ---------------------------------- */
/* COMMANDS */
/* ---------------------------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("市場")
    .setDescription("強勢幣排行（價格+量能）")
    .addIntegerOption(o =>
      o.setName("數量").setDescription("預設10")
    ),

  new SlashCommandBuilder()
    .setName("價格")
    .setDescription("H1趨勢 + M15進場分析")
    .addStringOption(o =>
      o.setName("幣種")
        .setDescription("BTC/USDT")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("訊號")
    .setDescription("策略掃描交易訊號")
    .addIntegerOption(o =>
      o.setName("數量").setDescription("掃描範圍")
    ),

  new SlashCommandBuilder()
    .setName("狀態")
    .setDescription("系統狀態"),
].map(c => c.toJSON());

/* ---------------------------------- */
/* HELPERS */
/* ---------------------------------- */

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function cooldownKey(signal) {
  return `${signal.exchange}:${signal.symbol}:${signal.direction}`;
}

function isCooling(signal) {
  const key = cooldownKey(signal);
  const last = signalCooldowns.get(key) || 0;
  return Date.now() - last < CONFIG.signal.cooldown;
}

function markCooldown(signal) {
  signalCooldowns.set(cooldownKey(signal), Date.now());
}

/* ---------------------------------- */
/* STRATEGY RUNNER */
/* ---------------------------------- */

async function runScan(channel, manual = false, overrides = {}) {
  const signals = await scanMarket(api, {
    scanLimit: CONFIG.scanLimit,
    minScore: CONFIG.signal.minScore,
    maxSignals: CONFIG.signal.maxResults,
    timeframe: CONFIG.signal.timeframe,
    higherTimeframe: CONFIG.signal.higherTimeframe,
    ...overrides,
  });

  const filtered = manual
    ? signals
    : signals.filter(s => {
        if (isCooling(s)) return false;
        markCooldown(s);
        return true;
      });

  if (manual) {
    return channel.send({
      embeds: [buildSignalListEmbed(filtered, api.name)],
    });
  }

  for (const s of filtered) {
    await channel.send({
      embeds: [buildSignalEmbed(s)],
    });
  }

  return filtered;
}

/* ---------------------------------- */
/* SCANNER LOOP */
/* ---------------------------------- */

async function startScanner(channel) {
  if (scannerTimer) clearInterval(scannerTimer);

  log(`scanner start: ${api.name}`);

  await runScan(channel).catch(err =>
    log("initial scan error:", err.message)
  );

  scannerTimer = setInterval(async () => {
    try {
      await runScan(channel);
    } catch (e) {
      log("scan error:", e.message);
    }
  }, CONFIG.pollInterval);
}

/* ---------------------------------- */
/* READY */
/* ---------------------------------- */

client.once(Events.ClientReady, async (bot) => {
  log(`online: ${bot.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(CONFIG.token);

  await rest.put(
    Routes.applicationCommands(bot.user.id),
    { body: commands }
  );

  const channel = await bot.channels.fetch(CONFIG.channelId);

  await channel.send(
    `🚀 Bot啟動｜${api.name}｜H1→M15策略`
  );

  await startScanner(channel);
});

/* ---------------------------------- */
/* COMMAND HANDLER */
/* ---------------------------------- */

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();

  try {

    /* -------- 市場 -------- */
    if (interaction.commandName === "市場") {
      const limit = Math.min(
        interaction.options.getInteger("數量") || 10,
        30
      );

      const symbols = await api.getTopContractSymbols(100);
      const tickers = await getCachedTickers(symbols);

      const sorted = tickers
        .sort((a, b) =>
          (b.priceChange * 0.7 + b.quoteVolume24h / 1e6) -
          (a.priceChange * 0.7 + a.quoteVolume24h / 1e6)
        )
        .slice(0, limit);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("📊 市場強勢排行")
            .setDescription(
              sorted.map((t, i) =>
                `**${i + 1}. ${t.symbol}**
📈 ${t.priceChange.toFixed(2)}%
💰 ${t.price}`
              ).join("\n\n")
            )
        ]
      });
    }

    /* -------- 價格 -------- */
    if (interaction.commandName === "價格") {
      const symbol = interaction.options.getString("幣種").toUpperCase();

      const [ticker, m15, h1] = await Promise.all([
        api.getTicker(symbol),
        api.getCandles(symbol, "15m", 120),
        api.getCandles(symbol, "1h", 120),
      ]);

      const signal = require("./strategy")
        .analyzeMultiTimeframeSymbol(symbol, m15, h1);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(signal?.direction === "LONG" ? 0x22c55e :
                     signal?.direction === "SHORT" ? 0xef4444 : 0x94a3b8)
            .setTitle(`📌 ${symbol}`)
            .setDescription([
              `H1趨勢：${signal?.direction || "N/A"}`,
              `現價：${ticker.price}`,
              `Entry：${signal?.entry || "-"}`,
              `TP1：${signal?.takeProfit1 || "-"}`,
              `TP2：${signal?.takeProfit2 || "-"}`,
              `SL：${signal?.stopLoss || "-"}`,
              `RR：${signal?.riskReward || "-"}`,
              `信心：${signal?.confidence || "-"}`
            ].join("\n"))
        ]
      });
    }

    /* -------- 訊號 -------- */
    if (interaction.commandName === "訊號") {
      const limit = Math.min(
        interaction.options.getInteger("數量") || CONFIG.scanLimit,
        50
      );

      await interaction.editReply("🔍 掃描中...");

      const signals = await scanMarket(api, {
        scanLimit: limit,
      });

      const sorted = signals.sort(
        (a, b) => (b.score * b.riskReward) - (a.score * a.riskReward)
      );

      return interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("⚡ 訊號列表")
            .setDescription(
              sorted.map((s, i) =>
                `**${i + 1}. ${s.symbol} ${s.direction}**
Score:${s.score} RR:${s.riskReward}
Entry:${s.entry}`
              ).join("\n\n")
            )
        ]
      });
    }

    /* -------- 狀態 -------- */
    if (interaction.commandName === "狀態") {
      return interaction.editReply(
        `📡 ${api.name}｜H1→M15｜Top ${CONFIG.scanLimit}`
      );
    }

  } catch (err) {
    return interaction.editReply(`錯誤：${err.message}`);
  }
});

/* ---------------------------------- */
/* ERROR HANDLING */
/* ---------------------------------- */

process.on("unhandledRejection", err =>
  log("unhandled:", err)
);

process.on("uncaughtException", err =>
  log("exception:", err)
);

/* ---------------------------------- */
/* LOGIN */
/* ---------------------------------- */

client.login(CONFIG.token);
