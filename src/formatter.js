const { EmbedBuilder } = require("discord.js");

function formatPrice(price) {
  if (!Number.isFinite(Number(price))) return "n/a";
  const value = Number(price);
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(6);
  return value.toFixed(8);
}

function formatVolume(value) {
  const volume = Number(value || 0);
  if (volume >= 1e9) return `$${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `$${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `$${(volume / 1e3).toFixed(2)}K`;
  return `$${volume.toFixed(2)}`;
}

function buildTickerEmbed(ticker) {
  const isUp = ticker.priceChange >= 0;
  return new EmbedBuilder()
    .setColor(isUp ? 0x22c55e : 0xef4444)
    .setTitle(`${ticker.symbol} 合約行情 ${isUp ? "LONG 偏強" : "SHORT 偏弱"}`)
    .addFields(
      { name: "交易所", value: ticker.exchange, inline: true },
      { name: "現價", value: `$${formatPrice(ticker.price)}`, inline: true },
      { name: "24h 漲跌", value: `${isUp ? "+" : ""}${ticker.priceChange.toFixed(2)}%`, inline: true },
      { name: "24h 高低", value: `$${formatPrice(ticker.high24h)} / $${formatPrice(ticker.low24h)}`, inline: true },
      { name: "24h 成交額", value: formatVolume(ticker.quoteVolume24h), inline: true },
    )
    .setFooter({ text: "資料僅供策略提醒，不代表保證獲利" })
    .setTimestamp(ticker.timestamp);
}

function buildOverviewEmbed(tickers, exchange) {
  const lines = tickers.slice(0, 15).map((ticker, index) => {
    const mark = ticker.priceChange >= 0 ? "+" : "";
    return `${index + 1}. **${ticker.symbol}** $${formatPrice(ticker.price)} (${mark}${ticker.priceChange.toFixed(2)}%)`;
  });

  return new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`${exchange} 合約市場總覽`)
    .setDescription(lines.join("\n") || "目前沒有資料")
    .setTimestamp();
}

function buildSignalEmbed(signal) {
  const isLong = signal.direction === "LONG";
  return new EmbedBuilder()
    .setColor(isLong ? 0x22c55e : 0xef4444)
    .setTitle(`${isLong ? "LONG" : "SHORT"} 訊號 | ${signal.symbol}`)
    .setDescription([
      `信心分數: **${signal.confidence}**`,
      `交易所: **${signal.exchange}**`,
      `框架: **${signal.higherTimeframe || "1h"} 大方向 / ${signal.lowerTimeframe || "15m"} 進場**`,
      `理由: ${signal.reasons.join(" / ")}`,
    ].join("\n"))
    .addFields(
      { name: "進場 Entry", value: `$${formatPrice(signal.entry)}`, inline: true },
      { name: "止盈 TP1", value: `$${formatPrice(signal.takeProfit1)}`, inline: true },
      { name: "止盈 TP2", value: `$${formatPrice(signal.takeProfit2)}`, inline: true },
      { name: "停損 SL", value: `$${formatPrice(signal.stopLoss)}`, inline: true },
      { name: "風險報酬", value: `${signal.riskReward}R`, inline: true },
      { name: "RSI / ATR", value: `${signal.rsi} / ${formatPrice(signal.atr)}`, inline: true },
      { name: "短線動能", value: `${signal.momentum}%`, inline: true },
      { name: "H1 動能", value: `${signal.higherTimeframeMomentum}%`, inline: true },
      { name: "量能倍率", value: `${signal.volumeRatio}x`, inline: true },
    )
    .setFooter({ text: "策略訊號不是財務建議；合約有高槓桿風險，請自行控倉" })
    .setTimestamp(signal.timestamp);
}

function buildSignalListEmbed(signals, exchange) {
  if (!signals.length) {
    return new EmbedBuilder()
      .setColor(0x94a3b8)
      .setTitle(`${exchange} 策略掃描`)
      .setDescription("目前沒有達到分數門檻的合約訊號。")
      .setTimestamp();
  }

  const lines = signals.map((signal, index) => [
    `**${index + 1}. ${signal.direction} ${signal.symbol}** | ${signal.confidence} | RR ${signal.riskReward}R`,
    `H1 ${signal.higherTimeframeMomentum}% / M15 ${signal.momentum}%`,
    `Entry $${formatPrice(signal.entry)} | TP1 $${formatPrice(signal.takeProfit1)} | SL $${formatPrice(signal.stopLoss)}`,
  ].join("\n"));

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`${exchange} 合約策略掃描 Top ${signals.length}`)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: "用 /signals 可手動掃描；訊號只做提醒，不自動下單" })
    .setTimestamp();
}

module.exports = {
  buildTickerEmbed,
  buildOverviewEmbed,
  buildSignalEmbed,
  buildSignalListEmbed,
};
