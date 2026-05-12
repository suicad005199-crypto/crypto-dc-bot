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

if (!TOKEN || !CHANNEL_ID) {
  console.error("❌ 錯誤：必要環境變數 (TOKEN 或 CHANNEL_ID) 缺失！");
  process.exit(1);
}

const api = getExchange(EXCHANGE);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

let watchSymbols = WATCH_RAW ? WATCH_RAW.split(",").map((s) => s.trim().toUpperCase()) : [];
let monitorInterval = null;
let lastPrices = {};

const commands = [
  new SlashCommandBuilder().setName("price").setDescription("查詢單一交易對即時資訊").addStringOption(o => o.setName("symbol").setDescription("例如 BTC/USDT").setRequired(true)),
  new SlashCommandBuilder().setName("market").setDescription("顯示前 N 大交易對總覽").addIntegerOption(o => o.setName("limit").setDescription("預設 10")),
  new SlashCommandBuilder().setName("watch").setDescription("設定監控交易對").addStringOption(o => o.setName("symbols").setDescription("逗號分隔").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("目前監控狀態"),
  new SlashCommandBuilder().setName("detect").setDescription("自動偵測前 N 大幣種").addIntegerOption(o => o.setName("limit").setDescription("預設 20")),
].map(cmd => cmd.toJSON());

async function startMonitor(channel) {
  if (!channel) return console.error("❌ 啟動監控失敗：頻道物件無效");
  if (monitorInterval) clearInterval(monitorInterval);
  
  console.log(`🚀 開始監控 ${watchSymbols.length} 個交易對...`);
  monitorInterval = setInterval(async () => {
    if (watchSymbols.length === 0) return;
    try {
      const tickers = await api.getMultipleTickers(watchSymbols);
      for (const ticker of tickers) {
        const absChange = Math.abs(ticker.priceChange);
        const prevPrice = lastPrices[ticker.symbol];
        
        if (absChange >= THRESHOLD) {
          const alreadyAlerted = prevPrice?.alerted && (Date.now() - prevPrice.alertedAt < 3600000);
          if (!alreadyAlerted) {
            await channel.send({ embeds: [buildAlertEmbed(ticker, THRESHOLD)] }).catch(e => console.error("發送警報失敗:", e.message));
            lastPrices[ticker.symbol] = { price: ticker.price, alerted: true, alertedAt: Date.now() };
          }
        } else {
          lastPrices[ticker.symbol] = { price: ticker.price, alerted: false };
        }
      }
    } catch (err) {
      console.error("監控掃描錯誤:", err.message);
    }
  }, INTERVAL);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot 已上線：${c.user.tag}`);

  // --- 除錯用：列出 Bot 看得到的所有頻道 ---
  console.log("--- 頻道檢索中 ---");
  const visibleChannels = c.channels.cache.filter(ch => ch.isTextBased());
  console.log(`Bot 總共可以看到 ${visibleChannels.size} 個文字頻道`);
  visibleChannels.forEach(ch => console.log(`> 頻道: ${ch.name} | ID: ${ch.id} | 伺服器: ${ch.guild.name}`));
  console.log("------------------");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log("✅ Slash Commands 已註冊");
  } catch (err) {
    console.error("Slash Commands 註冊失敗:", err.message);
  }

  // 初始化監控對象
  if (watchSymbols.length === 0) {
    try {
      watchSymbols = await api.getTopSymbols(20);
      console.log("✅ 自動偵測幣種完成");
    } catch (e) { console.error("偵測失敗:", e.message); }
  }

  // 嘗試獲取頻道並發送啟動訊息
  try {
    const channel = await c.channels.fetch(CHANNEL_ID);
    console.log(`✅ 成功對接頻道：#${channel.name}`);
    
    await startMonitor(channel);
    
    const initialTickers = await api.getMultipleTickers(watchSymbols.slice(0, 15));
    await channel.send({ 
      content: "🔔 **加密貨幣監控機器人已啟動**",
      embeds: [buildOverviewEmbed(initialTickers, EXCHANGE)] 
    });
  } catch (err) {
    console.error(`❌ 頻道錯誤 (${CHANNEL_ID}): ${err.message}`);
    console.error("請確認：1. ID 是否正確 2. Bot 是否已被邀請入伺服器 3. Bot 是否有查看該頻道的權限");
  }
});

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
        watchSymbols = input.split(",").map(s => s.trim().toUpperCase());
        lastPrices = {};
        await startMonitor(interaction.channel);
        await interaction.editReply(`✅ 監控清單更新：**${watchSymbols.join(", ")}**`);
        break;
      }
      case "status": {
        await interaction.editReply(`**📡 狀態報告**\n• 交易所: ${EXCHANGE}\n• 監控中: ${watchSymbols.length} 個交易對\n• 警報閾值: ±${THRESHOLD}%`);
        break;
      }
      case "detect": {
        const limit = interaction.options.getInteger("limit") || 20;
        watchSymbols = await api.getTopSymbols(limit);
        lastPrices = {};
        await startMonitor(interaction.channel);
        await interaction.editReply(`✅ 已重新偵測前 ${limit} 大交易對並開始監控`);
        break;
      }
    }
  } catch (err) {
    console.error(`指令處理失敗 [${interaction.commandName}]:`, err.message);
    await interaction.editReply(`❌ 執行失敗：${err.message}`);
  }
});

process.on("unhandledRejection", (err) => console.error("❌ 全域錯誤:", err));

client.login(TOKEN).catch(e => {
  console.error("❌ 登入失敗:", e.message);
  process.exit(1);
});
