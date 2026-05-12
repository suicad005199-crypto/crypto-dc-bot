require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  ActivityType,
} = require("discord.js");

const { getExchange } = require("./exchangeAPI");
const { scanMarket } = require("./strategy");

const {
  buildTickerEmbed,
  buildOverviewEmbed,
  buildSignalEmbed,
  buildSignalListEmbed,
} = require("./formatter");

/* ---------------------------------- */
/* ENV */
/* ---------------------------------- */

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  channelId: process.env.DISCORD_CHANNEL_ID,

  exchange: process.env.EXCHANGE || "okx",

  pollInterval: Number(
    process.env.POLL_INTERVAL || 300000
  ),

  scanLimit: Number(
    process.env.SCAN_LIMIT || 30
  ),

  signalMinScore: Number(
    process.env.SIGNAL_MIN_SCORE || 68
  ),

  signalMaxResults: Number(
    process.env.SIGNAL_MAX_RESULTS || 5
  ),

  signalTimeframe:
    process.env.SIGNAL_TIMEFRAME || "15m",

  signalHigherTimeframe:
    process.env.SIGNAL_HIGHER_TIMEFRAME || "1h",

  signalCooldown: Number(
    process.env.SIGNAL_COOLDOWN || 3600000
  ),
};

if (!CONFIG.token || !CONFIG.channelId) {
  console.error(
    "Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID"
  );

  process.exit(1);
}

/* ---------------------------------- */
/* Discord Client */
/* ---------------------------------- */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const api = getExchange(CONFIG.exchange);

/* ---------------------------------- */
/* Runtime State */
/* ---------------------------------- */

let scannerTimer = null;

const signalCooldowns = new Map();

const runtime = {
  lastScanAt: null,
  lastSignals: 0,
  totalSignals: 0,
};

/* ---------------------------------- */
/* Commands */
/* ---------------------------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("price")
    .setDescription("查詢合約行情")
    .addStringOption((option) =>
      option
        .setName("symbol")
        .setDescription("例如 BTC/USDT")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("market")
    .setDescription("市場總覽")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("預設 10，最大 30")
    ),

  new SlashCommandBuilder()
    .setName("signals")
    .setDescription("手動掃描策略訊號")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("掃描前 N 大合約")
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("查看掃描器狀態"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("查看機器人延遲"),
].map((command) => command.toJSON());

/* ---------------------------------- */
/* Helpers */
/* ---------------------------------- */

function log(...args) {
  console.log(
    `[${new Date().toISOString()}]`,
    ...args
  );
}

function scannerOptions(overrides = {}) {
  return {
    scanLimit: CONFIG.scanLimit,
    minScore: CONFIG.signalMinScore,
    maxSignals: CONFIG.signalMaxResults,
    timeframe: CONFIG.signalTimeframe,
    higherTimeframe:
      CONFIG.signalHigherTimeframe,

    ...overrides,
  };
}

function cooldownKey(signal) {
  return [
    signal.exchange,
    signal.symbol,
    signal.direction,
  ].join(":");
}

function isSignalCoolingDown(signal) {
  const key = cooldownKey(signal);

  const lastSent =
    signalCooldowns.get(key) || 0;

  return (
    Date.now() - lastSent <
    CONFIG.signalCooldown
  );
}

function markSignalCooldown(signal) {
  signalCooldowns.set(
    cooldownKey(signal),
    Date.now()
  );
}

function filterFreshSignals(signals) {
  return signals.filter((signal) => {
    if (isSignalCoolingDown(signal)) {
      return false;
    }

    markSignalCooldown(signal);

    return true;
  });
}

async function safeSend(channel, payload) {
  try {
    return await channel.send(payload);
  } catch (err) {
    log("send failed:", err.message);
  }
}

async function updateBotPresence() {
  try {
    client.user.setPresence({
      activities: [
        {
          name: `${api.name} Signals`,
          type: ActivityType.Watching,
        },
      ],

      status: "online",
    });
  } catch (err) {
    log("presence update failed:", err.message);
  }
}

/* ---------------------------------- */
/* Strategy Scanner */
/* ---------------------------------- */

async function runStrategyScan(
  channel,
  {
    manual = false,
    overrides = {},
  } = {}
) {
  const signals = await scanMarket(
    api,
    scannerOptions(overrides)
  );

  runtime.lastScanAt = Date.now();
  runtime.lastSignals = signals.length;
  runtime.totalSignals += signals.length;

  const finalSignals = manual
    ? signals
    : filterFreshSignals(signals);

  if (manual) {
    await safeSend(channel, {
      embeds: [
        buildSignalListEmbed(
          finalSignals,
          api.name
        ),
      ],
    });

    return finalSignals;
  }

  for (const signal of finalSignals) {
    await safeSend(channel, {
      embeds: [buildSignalEmbed(signal)],
    });
  }

  if (finalSignals.length > 0) {
    log(
      `sent ${finalSignals.length} signals`
    );
  }

  return finalSignals;
}

async function startScanner(channel) {
  if (scannerTimer) {
    clearInterval(scannerTimer);
  }

  log(
    `scanner started | ${api.name} | ${CONFIG.signalHigherTimeframe} -> ${CONFIG.signalTimeframe}`
  );

  await runStrategyScan(channel).catch(
    (err) => {
      log(
        "initial scan failed:",
        err.message
      );
    }
  );

  scannerTimer = setInterval(async () => {
    try {
      await runStrategyScan(channel);
    } catch (err) {
      log(
        "scheduled scan failed:",
        err.message
      );
    }
  }, CONFIG.pollInterval);
}

/* ---------------------------------- */
/* Discord Ready */
/* ---------------------------------- */

client.once(
  Events.ClientReady,
  async (bot) => {
    log(`bot online: ${bot.user.tag}`);

    await updateBotPresence();

    try {
      const rest = new REST({
        version: "10",
      }).setToken(CONFIG.token);

      await rest.put(
        Routes.applicationCommands(
          bot.user.id
        ),
        {
          body: commands,
        }
      );

      log("slash commands registered");
    } catch (err) {
      log(
        "slash registration failed:",
        err.message
      );
    }

    try {
      const channel =
        await bot.channels.fetch(
          CONFIG.channelId
        );

      await safeSend(channel, {
        content: [
          "🚀 策略掃描器已啟動",
          `交易所: ${api.name}`,
          `結構: ${CONFIG.signalHigherTimeframe} → ${CONFIG.signalTimeframe}`,
          `掃描範圍: Top ${CONFIG.scanLimit}`,
          `訊號門檻: ${CONFIG.signalMinScore}`,
        ].join("\n"),
      });

      await startScanner(channel);
    } catch (err) {
      log(
        "channel init failed:",
        err.message
      );
    }
  }
);

/* ---------------------------------- */
/* Interaction Handler */
/* ---------------------------------- */

client.on(
  Events.InteractionCreate,
  async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    await interaction.deferReply();

    try {
      switch (interaction.commandName) {
        /* ---------------- PRICE ---------------- */

        case "price": {
          const symbol =
            interaction.options
              .getString("symbol")
              .toUpperCase();

          const ticker =
            await api.getTicker(symbol);

          return interaction.editReply({
            embeds: [
              buildTickerEmbed(ticker),
            ],
          });
        }

        /* ---------------- MARKET ---------------- */

        case "market": {
          const limit = Math.min(
            interaction.options.getInteger(
              "limit"
            ) || 10,
            30
          );

          const symbols =
            await api.getTopSymbols(limit);

          const tickers =
            await api.getMultipleTickers(
              symbols
            );

          return interaction.editReply({
            embeds: [
              buildOverviewEmbed(
                tickers,
                api.name
              ),
            ],
          });
        }

        /* ---------------- SIGNALS ---------------- */

        case "signals": {
          const limit = Math.min(
            interaction.options.getInteger(
              "limit"
            ) || CONFIG.scanLimit,
            50
          );

          await interaction.editReply(
            `🔍 正在掃描 ${api.name} Top ${limit} Contracts...`
          );

          const signals =
            await scanMarket(
              api,
              scannerOptions({
                scanLimit: limit,
              })
            );

          return interaction.followUp({
            embeds: [
              buildSignalListEmbed(
                signals,
                api.name
              ),
            ],
          });
        }

        /* ---------------- STATUS ---------------- */

        case "status": {
          const uptime = Math.floor(
            process.uptime()
          );

          return interaction.editReply({
            content: [
              "# 📡 策略掃描器狀態",
              "",
              `交易所: ${api.name}`,
              `大週期: ${CONFIG.signalHigherTimeframe}`,
              `小週期: ${CONFIG.signalTimeframe}`,
              `掃描範圍: Top ${CONFIG.scanLimit}`,
              `分數門檻: ${CONFIG.signalMinScore}`,
              `掃描間隔: ${
                CONFIG.pollInterval / 1000
              } 秒`,
              `冷卻時間: ${
                CONFIG.signalCooldown / 60000
              } 分鐘`,
              "",
              `上次掃描訊號: ${runtime.lastSignals}`,
              `累積訊號數: ${runtime.totalSignals}`,
              `運行時間: ${uptime} 秒`,
            ].join("\n"),
          });
        }

        /* ---------------- PING ---------------- */

        case "ping": {
          return interaction.editReply(
            `🏓 ${client.ws.ping}ms`
          );
        }
      }
    } catch (err) {
      log(
        `command failed [${interaction.commandName}]`,
        err
      );

      return interaction.editReply({
        content: `❌ 執行失敗: ${err.message}`,
      });
    }
  }
);

/* ---------------------------------- */
/* Process Events */
/* ---------------------------------- */

process.on(
  "unhandledRejection",
  (err) => {
    log("unhandled rejection:", err);
  }
);

process.on(
  "uncaughtException",
  (err) => {
    log("uncaught exception:", err);
  }
);

/* ---------------------------------- */
/* Login */
/* ---------------------------------- */

client.login(CONFIG.token).catch((err) => {
  log("discord login failed:", err.message);

  process.exit(1);
});
