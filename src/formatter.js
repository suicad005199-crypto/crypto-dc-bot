// src/formatter.js
const { EmbedBuilder } = require("discord.js");

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
    .setDescription(`**交易標的類型：** ${meta.label}\n**交易所：** ${ticker.exchange}`)
    .addFields(
      { name: "💰 當前價格",   value: `\`$${formatPrice(ticker.price)}\``,    inline: true },
      { name: "📈 24h 最高",   value: `\`$${formatPrice(ticker.high24h)}\``,  inline: true },
      { name: "📉 24h 最低",   value: `\`$${formatPrice(ticker.low24h)}\``,   inline: true },
      { name: "📊 24h 成交額", value: formatVolume(ticker.quoteVolume24h),     inline: true },
      { name: "🪙 基礎資產",   value: ticker.baseAsset,                        inline: true },
      { name: "💱 計價資產",   value: ticker.quoteAsset,                       inline: true },
    )
    .setFooter({ text: `${ticker.exchange} · 更新時間` })
    .setTimestamp(ticker.timestamp);
}

// ─── 進場訊號 Embed（含 TP/SL）────────────────────────────
function buildSignalEmbed(ticker, signal) {
  const isLong = signal.direction === "LONG";
  const color  = isLong ? 0x22c55e : 0xef4444;
  const dirIcon = isLong ? "🟢 做多 LONG" : "🔴 做空 SHORT";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`📌 ${ticker.symbol} 進場訊號`)
    .addFields(
      { name: "方向",     value: dirIcon,                              inline: true },
      { name: "風報比",   value: `1 : ${signal.rr}`,                  inline: true },
      { name: "\u200b",   value: "\u200b",                             inline: true },
      { name: "🎯 進場價", value: `\`$${formatPrice(signal.entry)}\``, inline: true },
      { name: "✅ 止盈 TP", value: `\`$${formatPrice(signal.tp)}\` (+${signal.tpPct}%)`, inline: true },
      { name: "❌ 止損 SL", value: `\`$${formatPrice(signal.sl)}\` (-${signal.slPct}%)`, inline: true },
    )
    .setFooter({ text: "⚠️ 僅供參考，非投資建議，請自行評估風險" })
    .setTimestamp();
}

// ─── 多標的總覽 Embed ──────────────────────────────────────
function buildOverviewEmbed(tickers, exchange) {
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`📡 ${exchange} 市場總覽 — 前 ${tickers.length} 大交易對`)
    .setTimestamp();

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
    embed.addFields({ name: `${meta.emoji} ${meta.label}`, value: lines.join("\n"), inline: false });
  }

  return embed;
}

// ─── 警報 Embed（含 TP/SL）────────────────────────────────
function buildAlertEmbed(ticker, threshold, signal) {
  const isUp = ticker.priceChange >= 0;
  const meta = TYPE_META[ticker.type] || TYPE_META.ALT;
  const color = isUp ? 0x22c55e : 0xef4444;
  const direction = isUp ? "🚀 急漲警報" : "🔻 急跌警報";
  const isLong = signal?.direction === "LONG";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${direction}！${ticker.symbol}`)
    .setDescription(
      `**${meta.emoji} ${meta.label}** 24h 波動超過 **${threshold}%**\n\n` +
      `📌 當前價格：**$${formatPrice(ticker.price)}**\n` +
      `📈 24h 漲跌：**${ticker.priceChange >= 0 ? "+" : ""}${ticker.priceChange.toFixed(2)}%**`
    )
    .setFooter({ text: `來源：${ticker.exchange}` })
    .setTimestamp();

  if (signal) {
    embed.addFields(
      { name: "方向",      value: isLong ? "🟢 做多 LONG" : "🔴 做空 SHORT", inline: true },
      { name: "風報比",    value: `1 : ${signal.rr}`,                         inline: true },
      { name: "\u200b",    value: "\u200b",                                    inline: true },
      { name: "🎯 進場價", value: `\`$${formatPrice(signal.entry)}\``,         inline: true },
      { name: "✅ 止盈 TP", value: `\`$${formatPrice(signal.tp)}\` (+${signal.tpPct}%)`, inline: true },
      { name: "❌ 止損 SL", value: `\`$${formatPrice(signal.sl)}\` (-${signal.slPct}%)`, inline: true },
    );
  }

  return embed;
}

module.exports = { buildTickerEmbed, buildOverviewEmbed, buildAlertEmbed, buildSignalEmbed, TYPE_META };
