// src/index.js
require("dotenv").config();

console.log("🚀 Bot 程式啟動中...");
console.log("Node 版本:", process.version);
console.log("TOKEN 存在:", !!process.env.DISCORD_TOKEN);
console.log("CHANNEL_ID:", process.env.DISCORD_CHANNEL_ID);

const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } = require("discord.js");
const { getExchange } = require("./exchangeAPI");
const { buildTickerEmbed, buildOverviewEmbed, buildAlertEmbed } = require("./formatter");

const TOKEN      = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const EXCHANGE   = process.env.EXCHANGE || "okx";
const THRESHOLD  = parseFloat(process.env.ALERT_THRESHOLD || "3");
const INTERVAL   = parseInt(process.env.POLL_INTERVAL || "10000");
const WATCH_RAW  = process.env.WATCH_SYMBOLS || "";
const OVERVIEW_INTERVAL = 30 * 60 * 1000; // 30 分鐘

if (!TOKEN) { console.error("❌ DISCORD_TOKEN 未設定！"); process.exit(1); }
if (!CHANNEL_ID) { console.error("❌ DISCORD_CHANNEL_ID 未設定！"); process.exit(1); }

const api = getExchange(EXCHANGE);
console.log("📡 使用交易所:", EXCHANGE);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

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

let watchSymbols = WATCH_RAW ? WATCH_RAW.split(",").map((s) => s.trim()) : [];
let monitorInterval = null;
let overviewInterval = null;
let lastPrices = {};

// ─── 發送市場總覽 ──────────────────────────────────────────
async function sendOverview(channel) {
  try {
    const tickers = await api.getMultipleTickers(watchSymbols.slice(0, 15));
    await channel.send({ embeds: [buildOverviewEmbed(tickers, EXCHANGE)] });
    console.log(`[${new Date().toLocaleTimeString()}] ✅ 市場總覽已發送`);
  } catch (err) {
    console.error("發送總覽錯誤:", err.message);
  }
}

// ─── 警報監控 ──────────────────────────────────────────────
async function startMonitor(channel) {
  if (monitorInterval) clearInterval(monitorInterval);
  if (overviewInterval) clearInterval(overviewInterval);

  console.log(`🚀 開始監控 ${watchSymbols.length} 個交易對，每 30 分鐘發送總覽`);

  monitorInterval = setInterval(async () => {
    if (watchSymbols.length === 0) return;
    try {
      const tickers = await api.getMultipleTickers(watchSymbols);
      for (const ticker of tickers) {
        const absChange = Math.abs(ticker.priceChange);
        const prevPrice = lastPrices[ticker.symbol];
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
      console.log(`[${new Date().toLocaleTimeString()}] 掃描完成 ${tickers.length} 個`);
    } catch (err) {
      console.error("監控錯誤:", err.message);
    }
  }, INTERVAL);

  // 每 30 分鐘自動發送市場總覽
  overviewInterval = setInterval(() => sendOverview(channel), OVERVIEW_INTERVAL);
}

// ─── Bot 啟動 ──────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot 已上線：${c.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log("✅ Slash Commands 已註冊");
  } catch (err) {
    console.error("Slash Commands 註冊失敗:", err.message);
  }

  if (watchSymbols.length === 0) {
    console.log("🔍 自動偵測前 20 大幣種...");
    try {
      watchSymbols = await api.getTopSymbols(20);
      console.log("✅ 偵測完成:", watchSymbols.slice(0, 5).join(", "), "...");
    } catch (err) {
      console.error("自動偵測失敗:", err.message);
    }
  }

  try {
    const channel = await c.channels.fetch(CHANNEL_ID);
    console.log("✅ 頻道找到:", channel.name);
    await startMonitor(channel);
    await sendOverview(channel); // 啟動時立即發一次
  } catch (err) {
    console.error("❌ 頻道錯誤:", err.message);
  }
});

// ─── Slash Command 處理 ────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  try {
    switch (interaction.commandName) {
      case "price": {
        const sym = interaction.options.getString("symbol").toUpperCase();
        const ticker = await api.getTicker(sym);
        await interaction.editReply({ embeds: [buildTickerEmbed(ticker)] });
        break;
      }
      case "market": {
        const limit = interaction.options.getInteger("limit") || 10;
        const symbols = await api.getTopSymbols(limit);
        const tickers = await api.getMultipleTickers(symbols);
        await interaction.editReply({ embeds: [buildOverviewEmbed(tickers, EXCHANGE)] });
        break;
      }
      case "watch": {
        const input = interaction.options.getString("symbols");
        watchSymbols = input.split(",").map((s) => s.trim().toUpperCase());
        lastPrices = {};
        const channel = interaction.channel;
        await startMonitor(channel);
        await interaction.editReply(
          `✅ 已設定監控：**${watchSymbols.join(", ")}**\n每 ${INTERVAL / 1000} 秒掃描，漲跌超過 ${THRESHOLD}% 自動警報，每 30 分鐘發送市場總覽`
        );
        break;
      }
      case "status": {
        await interaction.editReply(
          `**📡 目前監控狀態**\n` +
          `• 交易所：${EXCHANGE}\n` +
          `• 監控標的：${watchSymbols.length > 0 ? watchSymbols.join(", ") : "無"}\n` +
          `• 掃描間隔：${INTERVAL / 1000} 秒\n` +
          `• 警報閾值：±${THRESHOLD}%\n` +
          `• 市場總覽：每 30 分鐘自動發送\n` +
          `• 監控中：${monitorInterval ? "✅ 是" : "❌ 否"}`
        );
        break;
      }
      case "detect": {
        const limit = interaction.options.getInteger("limit") || 20;
        watchSymbols = await api.getTopSymbols(limit);
        lastPrices = {};
        const channel = interaction.channel;
        await startMonitor(channel);
        await sendOverview(channel);
        await interaction.editReply(
          `✅ 偵測並監控 **${watchSymbols.length}** 個交易對，每 30 分鐘自動發送市場總覽`
        );
        break;
      }
    }
  } catch (err) {
    console.error(`指令錯誤 [${interaction.commandName}]:`, err.message);
    await interaction.editReply(`❌ 錯誤：${err.message}`);
  }
});

client.on("error", (err) => console.error("❌ Discord 錯誤:", err.message));
process.on("unhandledRejection", (err) => console.error("❌ 未處理錯誤:", err.message));

console.log("🔐 嘗試登入 Discord...");
client.login(TOKEN).catch((err) => {
  console.error("❌ 登入失敗:", err.message);
  process.exit(1);
});
