// src/formatter.js
// Discord Embed 格式化模組

const { EmbedBuilder } = require("discord.js");

// 類型對應 emoji 和顏色
const TYPE_META = {
  L1:     { emoji: "🔵", label: "Layer 1 主鏈",    color: 0x3b82f6 },
  L2:     { emoji: "🟣", label: "Layer 2 擴容",    color: 0x8b5cf6 },
  DEFI:   { emoji: "🟢", label: "DeFi 協議",       color: 0x10b981 },
  MEME:   { emoji: "🐸", label: "Meme 幣",         color: 0xf59e0b },
  AI:     { emoji: "🤖", label: "AI 概念",         color: 0x06b6d4 },
  GAMEFI: { emoji: "🎮", label: "GameFi / NFT",   color: 0xf97316 },
  STABLE: { emoji: "💵", label: "穩定幣",          color: 0x6b7280 },
  ALT:    { emoji: "⚪", label: "山寨幣",          color: 0x9ca3af },
};

function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (price >= 1)    return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function formatVolume(vol) {
  if (vol >= 1e9) return `$${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `$${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `$${(vol / 1e3).toFixed(2)}K`;
  return `$${vol.toFixed(2)}`;
}

// ─── 單一交易對 Embed ──────────────────────────────────────
function buildTickerEmbed(ticker) {
  const meta = TYPE_META[ticker.type] || TYPE_META.ALT;
  const isUp = ticker.priceChange >= 0;
  const changeStr = `${isUp ? "▲" : "▼"} ${Math.abs(ticker.priceChange).toFixed(2)}%`;
  const color = isUp ? 0x22c55e : 0xef4444;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${meta.emoji} ${ticker.symbol}  ${changeStr}`)
    .setDescription(
      `**交易標的類型：** ${meta.label}\n` +
      `**交易所：** ${ticker.exchange}`
    )
    .addFields(
      { name: "💰 當前價格",  value: `\`$${formatPrice(ticker.price)}\``,          inline: true },
      { name: "📈 24h 最高",  value: `\`$${formatPrice(ticker.high24h)}\``,        inline: true },
      { name: "📉 24h 最低",  value: `\`$${formatPrice(ticker.low24h)}\``,         inline: true },
      { name: "📊 24h 成交額", value: formatVolume(ticker.quoteVolume24h),          inline: true },
      { name: "🪙 基礎資產",  value: ticker.baseAsset,                             inline: true },
      { name: "💱 計價資產",  value: ticker.quoteAsset,                            inline: true },
    )
    .setFooter({ text: `${ticker.exchange} · 更新時間` })
    .setTimestamp(ticker.timestamp);
}

// ─── 多標的總覽 Embed ──────────────────────────────────────
function buildOverviewEmbed(tickers, exchange) {
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`📡 ${exchange} 市場總覽 — 前 ${tickers.length} 大交易對`)
    .setTimestamp();

  // 依類型分組
  const groups = {};
  tickers.forEach((t) => {
    if (!groups[t.type]) groups[t.type] = [];
    groups[t.type].push(t);
  });

  for (const [type, list] of Object.entries(groups)) {
    const meta = TYPE_META[type] || TYPE_META.ALT;
    const lines = list.map((t) => {
      const isUp = t.priceChange >= 0;
      const arrow = isUp ? "▲" : "▼";
      return `${arrow} **${t.baseAsset}** $${formatPrice(t.price)} (${isUp ? "+" : ""}${t.priceChange.toFixed(2)}%)`;
    });
    embed.addFields({
      name: `${meta.emoji} ${meta.label}`,
      value: lines.join("\n"),
      inline: false,
    });
  }

  return embed;
}

// ─── 警報 Embed ────────────────────────────────────────────
function buildAlertEmbed(ticker, threshold) {
  const isUp = ticker.priceChange >= 0;
  const meta = TYPE_META[ticker.type] || TYPE_META.ALT;
  const color = isUp ? 0x22c55e : 0xef4444;
  const direction = isUp ? "🚀 急漲警報" : "🔻 急跌警報";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${direction}！${ticker.symbol}`)
    .setDescription(
      `**${meta.emoji} ${meta.label}** 在 24h 內波動超過 **${threshold}%**\n\n` +
      `📌 當前價格：**$${formatPrice(ticker.price)}**\n` +
      `📈 24h 漲跌：**${ticker.priceChange >= 0 ? "+" : ""}${ticker.priceChange.toFixed(2)}%**`
    )
    .setFooter({ text: `來源：${ticker.exchange}` })
    .setTimestamp();
}

module.exports = { buildTickerEmbed, buildOverviewEmbed, buildAlertEmbed, TYPE_META };
