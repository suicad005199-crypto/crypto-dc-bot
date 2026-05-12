// src/index.js
// Discord Bot 主程式 - 幣種自動偵測 + 即時回報

require("dotenv").config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } = require("discord.js");
const { getExchange } = require("./exchangeAPI");
const { buildTickerEmbed, buildOverviewEmbed, buildAlertEmbed } = require("./formatter");

// ─── 設定 ──────────────────────────────────────────────────
const TOKEN      = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const EXCHANGE   = process.env.EXCHANGE || "binance";
const THRESHOLD  = parseFloat(process.env.ALERT_THRESHOLD || "3");
const INTERVAL   = parseInt(process.env.POLL_INTERVAL || "10000");
const WATCH_RAW  = process.env.WATCH_SYMBOLS || "";

const api = getExchange(EXCHANGE);

// ─── Discord Client ────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ─── Slash Commands 定義 ───────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("price")
    .setDescription("查詢單一交易對即時資訊")
    .addStringOption((opt) =>
      opt.setName("symbol").setDescription("交易對，例如 BTC/USDT").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("market")
    .setDescription("顯示前 N 大交易對總覽")
    .addIntegerOption((opt) =>
      opt.setName("limit").setDescription("顯示幾個（預設 10）").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("watch")
    .setDescription("設定自動監控的交易對（逗號分隔）")
    .addStringOption((opt) =>
      opt.setName("symbols").setDescription("例如 BTC/USDT,ETH/USDT").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("顯示目前監控狀態"),

  new SlashCommandBuilder()
    .setName("detect")
    .setDescription("自動偵測交易所前 N 大幣種並開始監控")
    .addIntegerOption((opt) =>
      opt.setName("limit").setDescription("偵測幾個（預設 20）").setRequired(false)
    ),
].map((cmd) => cmd.toJSON());

// ─── 狀態管理 ──────────────────────────────────────────────
let watchSymbols = WATCH_RAW
  ? WATCH_RAW.split(",").map((s) => s.trim())
  : [];
let monitorInterval = null;
let lastPrices = {};

// ─── 監控邏輯 ──────────────────────────────────────────────
async function startMonitor(channel) {
  if (monitorInterval) clearInterval(monitorInterval);

  console.log(`🚀 開始監控 ${watchSymbols.length} 個交易對...`);

  monitorInterval = setInterval(async () => {
    if (watchSymbols.length === 0) return;
    try {
      const tickers = await api.getMultipleTickers(watchSymbols);
      for (const ticker of tickers) {
        const absChange = Math.abs(ticker.priceChange);
        const prevPrice = lastPrices[ticker.symbol];

        // 超過閾值 → 發送警報
        if (absChange >= THRESHOLD) {
          const alreadyAlerted = prevPrice?.alerted && Date.now() - prevPrice.alertedAt < 3600000;
          if (!alreadyAlerted) {
            await channel.send({ embeds: [buildAlertEmbed(ticker, THRESHOLD)] });
            lastPrices[ticker.symbol] = { price: ticker.price, alerted: true, alertedAt: Date.now() };
          }
        } else {
          lastPrices[ticker.symbol] = { price: ticker.price, alerted: false };
        }
      }
      console.log(`[${new Date().toLocaleTimeString()}] 已掃描 ${tickers.length} 個交易對`);
    } catch (err) {
      console.error("監控錯誤:", err.message);
    }
  }, INTERVAL);
}

// ─── Bot 啟動 ──────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot 已上線：${c.user.tag}`);

  // 註冊 Slash Commands
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log("✅ Slash Commands 已註冊");
  } catch (err) {
    console.error("Slash Commands 註冊失敗:", err);
  }

  // 自動偵測（若沒有設定 WATCH_SYMBOLS）
  if (watchSymbols.length === 0) {
    console.log("🔍 未設定監控清單，自動偵測前 20 大幣種...");
    try {
      watchSymbols = await api.getTopSymbols(20);
      console.log("✅ 自動偵測完成:", watchSymbols.join(", "));
    } catch (err) {
      console.error("自動偵測失敗:", err.message);
    }
  }

  // 開始監控
  const channel = await c.channels.fetch(CHANNEL_ID).catch(() => null);
  if (channel) {
    await startMonitor(channel);
    await channel.send({
      embeds: [
        buildOverviewEmbed(
          await api.getMultipleTickers(watchSymbols.slice(0, 15)),
          EXCHANGE
        ),
      ],
    });
  } else {
    console.warn("⚠️ 找不到頻道，請確認 DISCORD_CHANNEL_ID");
  }
});

// ─── Slash Command 處理 ────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  try {
    switch (interaction.commandName) {

      // /price BTC/USDT
      case "price": {
        const sym = interaction.options.getString("symbol").toUpperCase();
        const ticker = await api.getTicker(sym);
        await interaction.editReply({ embeds: [buildTickerEmbed(ticker)] });
        break;
      }

      // /market [limit]
      case "market": {
        const limit = interaction.options.getInteger("limit") || 10;
        const symbols = await api.getTopSymbols(limit);
        const tickers = await api.getMultipleTickers(symbols);
        await interaction.editReply({ embeds: [buildOverviewEmbed(tickers, EXCHANGE)] });
        break;
      }

      // /watch BTC/USDT,ETH/USDT
      case "watch": {
        const input = interaction.options.getString("symbols");
        watchSymbols = input.split(",").map((s) => s.trim().toUpperCase());
        lastPrices = {};
        const channel = interaction.channel;
        await startMonitor(channel);
        await interaction.editReply(
          `✅ 已設定監控：**${watchSymbols.join(", ")}**\n每 ${INTERVAL / 1000} 秒掃描一次，漲跌超過 ${THRESHOLD}% 自動警報`
        );
        break;
      }

      // /status
      case "status": {
        const statusText =
          `**📡 目前監控狀態**\n` +
          `• 交易所：${EXCHANGE}\n` +
          `• 監控標的：${watchSymbols.length > 0 ? watchSymbols.join(", ") : "無"}\n` +
          `• 掃描間隔：${INTERVAL / 1000} 秒\n` +
          `• 警報閾值：±${THRESHOLD}%\n` +
          `• 監控中：${monitorInterval ? "✅ 是" : "❌ 否"}`;
        await interaction.editReply(statusText);
        break;
      }

      // /detect [limit]
      case "detect": {
        const limit = interaction.options.getInteger("limit") || 20;
        await interaction.editReply(`🔍 正在自動偵測 ${EXCHANGE} 前 ${limit} 大幣種...`);
        watchSymbols = await api.getTopSymbols(limit);
        lastPrices = {};
        const channel = interaction.channel;
        await startMonitor(channel);
        const tickers = await api.getMultipleTickers(watchSymbols.slice(0, 15));
        await interaction.followUp({
          content: `✅ 已偵測並開始監控 **${watchSymbols.length}** 個交易對`,
          embeds: [buildOverviewEmbed(tickers, EXCHANGE)],
        });
        break;
      }
    }
  } catch (err) {
    console.error(`指令錯誤 [${interaction.commandName}]:`, err.message);
    await interaction.editReply(`❌ 發生錯誤：${err.message}`);
  }
});

// ─── 啟動 ──────────────────────────────────────────────────
if (!TOKEN) {
  console.error("❌ 請在 .env 設定 DISCORD_TOKEN");
  process.exit(1);
}

client.login(TOKEN);
