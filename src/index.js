require("dotenv").config();

const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } = require("discord.js");
const { getExchange } = require("./exchangeAPI");
const { scanMarket } = require("./strategy");
const {
  buildTickerEmbed,
  buildOverviewEmbed,
  buildSignalEmbed,
  buildSignalListEmbed,
} = require("./formatter");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const EXCHANGE = process.env.EXCHANGE || "okx";
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 300000);
const SCAN_LIMIT = Number(process.env.SCAN_LIMIT || 30);
const SIGNAL_MIN_SCORE = Number(process.env.SIGNAL_MIN_SCORE || 68);
const SIGNAL_MAX_RESULTS = Number(process.env.SIGNAL_MAX_RESULTS || 5);
const SIGNAL_TIMEFRAME = process.env.SIGNAL_TIMEFRAME || "15m";
const SIGNAL_HIGHER_TIMEFRAME = process.env.SIGNAL_HIGHER_TIMEFRAME || "1h";
const SIGNAL_COOLDOWN = Number(process.env.SIGNAL_COOLDOWN || 3600000);

if (!TOKEN || !CHANNEL_ID) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID.");
  process.exit(1);
}

const api = getExchange(EXCHANGE);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

let scannerTimer = null;
const signalCooldowns = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("price")
    .setDescription("查詢合約行情")
    .addStringOption((option) => option.setName("symbol").setDescription("例如 BTC/USDT").setRequired(true)),
  new SlashCommandBuilder()
    .setName("market")
    .setDescription("顯示合約市場成交額前 N 名")
    .addIntegerOption((option) => option.setName("limit").setDescription("預設 10，最多 30")),
  new SlashCommandBuilder()
    .setName("signals")
    .setDescription("手動掃描策略訊號")
    .addIntegerOption((option) => option.setName("limit").setDescription("掃描前 N 大合約，預設 30")),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("顯示策略掃描狀態"),
].map((command) => command.toJSON());

function scannerOptions(overrides = {}) {
  return {
    scanLimit: SCAN_LIMIT,
    minScore: SIGNAL_MIN_SCORE,
    maxSignals: SIGNAL_MAX_RESULTS,
    timeframe: SIGNAL_TIMEFRAME,
    higherTimeframe: SIGNAL_HIGHER_TIMEFRAME,
    ...overrides,
  };
}

function cooldownKey(signal) {
  return `${signal.exchange}:${signal.symbol}:${signal.direction}`;
}

function filterFreshSignals(signals) {
  const now = Date.now();
  return signals.filter((signal) => {
    const key = cooldownKey(signal);
    const lastSent = signalCooldowns.get(key) || 0;
    if (now - lastSent < SIGNAL_COOLDOWN) return false;
    signalCooldowns.set(key, now);
    return true;
  });
}

async function runStrategyScan(channel, manual = false, overrides = {}) {
  const signals = await scanMarket(api, scannerOptions(overrides));
  const freshSignals = manual ? signals : filterFreshSignals(signals);

  if (manual) {
    await channel.send({ embeds: [buildSignalListEmbed(signals, api.name)] });
    return signals;
  }

  for (const signal of freshSignals) {
    await channel.send({ embeds: [buildSignalEmbed(signal)] });
  }
  return freshSignals;
}

async function startScanner(channel) {
  if (scannerTimer) clearInterval(scannerTimer);

  console.log(`Strategy scanner started: ${api.name}, H1 bias + M15 entry, top ${SCAN_LIMIT}`);
  await runStrategyScan(channel).catch((err) => console.error("initial scan failed:", err.message));

  scannerTimer = setInterval(() => {
    runStrategyScan(channel).catch((err) => console.error("strategy scan failed:", err.message));
  }, POLL_INTERVAL);
}

client.once(Events.ClientReady, async (bot) => {
  console.log(`Bot online: ${bot.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(bot.user.id), { body: commands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Slash command registration failed:", err.message);
  }

  try {
    const channel = await bot.channels.fetch(CHANNEL_ID);
    await channel.send(`策略掃描器已啟動：${api.name} / H1 大方向 + M15 進場 / 分數門檻 ${SIGNAL_MIN_SCORE}`);
    await startScanner(channel);
  } catch (err) {
    console.error(`Channel error (${CHANNEL_ID}):`, err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  try {
    switch (interaction.commandName) {
      case "price": {
        const symbol = interaction.options.getString("symbol").toUpperCase();
        const ticker = await api.getTicker(symbol);
        await interaction.editReply({ embeds: [buildTickerEmbed(ticker)] });
        break;
      }

      case "market": {
        const limit = Math.min(interaction.options.getInteger("limit") || 10, 30);
        const symbols = await api.getTopContractSymbols(limit);
        const tickers = await api.getMultipleTickers(symbols);
        await interaction.editReply({ embeds: [buildOverviewEmbed(tickers, api.name)] });
        break;
      }

      case "signals": {
        const limit = Math.min(interaction.options.getInteger("limit") || SCAN_LIMIT, 50);
        await interaction.editReply(`正在掃描 ${api.name} 前 ${limit} 大合約...`);
        const signals = await scanMarket(api, scannerOptions({ scanLimit: limit }));
        await interaction.followUp({ embeds: [buildSignalListEmbed(signals, api.name)] });
        break;
      }

      case "status": {
        await interaction.editReply([
          "**策略掃描狀態**",
          `交易所: ${api.name}`,
          `大時間框架: ${SIGNAL_HIGHER_TIMEFRAME}`,
          `小時間框架: ${SIGNAL_TIMEFRAME}`,
          `掃描範圍: 前 ${SCAN_LIMIT} 大合約`,
          `分數門檻: ${SIGNAL_MIN_SCORE}`,
          `自動掃描間隔: ${Math.round(POLL_INTERVAL / 1000)} 秒`,
          `冷卻時間: ${Math.round(SIGNAL_COOLDOWN / 60000)} 分鐘`,
        ].join("\n"));
        break;
      }
    }
  } catch (err) {
    console.error(`command failed [${interaction.commandName}]:`, err);
    await interaction.editReply(`執行失敗：${err.message}`);
  }
});

process.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));

client.login(TOKEN).catch((err) => {
  console.error("Discord login failed:", err.message);
  process.exit(1);
});
