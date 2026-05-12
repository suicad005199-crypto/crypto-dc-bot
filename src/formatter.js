const {
  EmbedBuilder,
  Colors,
} = require("discord.js");

/* ---------------------------------- */
/* Utils */
/* ---------------------------------- */

const COLORS = {
  long: Colors.Green,
  short: Colors.Red,
  neutral: Colors.Blurple,
  warning: Colors.Orange,
  muted: Colors.Grey,
};

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatPrice(price) {
  const value = safeNumber(price);

  if (value >= 1000) {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: 2,
    });
  }

  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(6);

  return value.toFixed(8);
}

function formatPercent(value) {
  const num = safeNumber(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function formatVolume(value) {
  const volume = safeNumber(value);

  if (volume >= 1e9) return `$${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `$${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `$${(volume / 1e3).toFixed(2)}K`;

  return `$${volume.toFixed(2)}`;
}

function getDirectionColor(isLong) {
  return isLong ? COLORS.long : COLORS.short;
}

function createBaseEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp();
}

function formatMomentum(value) {
  return `${safeNumber(value).toFixed(2)}%`;
}

function buildField(name, value, inline = true) {
  return {
    name,
    value: String(value),
    inline,
  };
}

/* ---------------------------------- */
/* Ticker Embed */
/* ---------------------------------- */

function buildTickerEmbed(ticker) {
  const isLong = safeNumber(ticker.priceChange) >= 0;

  return createBaseEmbed(getDirectionColor(isLong))
    .setTitle(
      `${ticker.symbol} ${
        isLong ? "LONG 偏強 📈" : "SHORT 偏弱 📉"
      }`
    )
    .addFields(
      buildField("交易所", ticker.exchange),
      buildField("現價", `$${formatPrice(ticker.price)}`),
      buildField("24h 漲跌", formatPercent(ticker.priceChange)),

      buildField(
        "24h 高 / 低",
        `$${formatPrice(ticker.high24h)} / $${formatPrice(
          ticker.low24h
        )}`,
        false
      ),

      buildField(
        "24h 成交額",
        formatVolume(ticker.quoteVolume24h),
        false
      )
    )
    .setFooter({
      text: "Market Data • Futures Monitor",
    });
}

/* ---------------------------------- */
/* Market Overview */
/* ---------------------------------- */

function buildOverviewEmbed(tickers, exchange) {
  const description =
    tickers.length > 0
      ? tickers
          .slice(0, 15)
          .map((ticker, index) => {
            return [
              `**${index + 1}. ${ticker.symbol}**`,
              `💰 $${formatPrice(ticker.price)}`,
              `📊 ${formatPercent(ticker.priceChange)}`,
            ].join(" ");
          })
          .join("\n")
      : "目前沒有市場資料";

  return createBaseEmbed(COLORS.neutral)
    .setTitle(`${exchange} 市場總覽`)
    .setDescription(description)
    .setFooter({
      text: `Top ${Math.min(tickers.length, 15)} Contracts`,
    });
}

/* ---------------------------------- */
/* Signal Embed */
/* ---------------------------------- */

function buildSignalEmbed(signal) {
  const isLong = signal.direction === "LONG";

  const reasons = Array.isArray(signal.reasons)
    ? signal.reasons.map((x) => `• ${x}`).join("\n")
    : "無";

  return createBaseEmbed(getDirectionColor(isLong))
    .setTitle(
      `${signal.direction} 訊號 ${
        isLong ? "🚀" : "⚠️"
      } | ${signal.symbol}`
    )
    .setDescription(
      [
        `🎯 信心分數: **${signal.confidence}**`,
        `🏢 交易所: **${signal.exchange}**`,
        `⏱️ 結構: **${signal.higherTimeframe || "1h"} → ${
          signal.lowerTimeframe || "15m"
        }**`,
        "",
        `📌 理由`,
        reasons,
      ].join("\n")
    )
    .addFields(
      buildField("Entry", `$${formatPrice(signal.entry)}`),
      buildField("TP1", `$${formatPrice(signal.takeProfit1)}`),
      buildField("TP2", `$${formatPrice(signal.takeProfit2)}`),

      buildField("SL", `$${formatPrice(signal.stopLoss)}`),
      buildField("RR", `${signal.riskReward}R`),
      buildField("RSI", safeNumber(signal.rsi).toFixed(2)),

      buildField("ATR", formatPrice(signal.atr)),
      buildField("M15 動能", formatMomentum(signal.momentum)),
      buildField(
        "H1 動能",
        formatMomentum(signal.higherTimeframeMomentum)
      ),

      buildField(
        "量能倍率",
        `${safeNumber(signal.volumeRatio).toFixed(2)}x`
      )
    )
    .setFooter({
      text: "Signal Alert • Not Financial Advice",
    });
}

/* ---------------------------------- */
/* Signal List Embed */
/* ---------------------------------- */

function buildSignalListEmbed(signals, exchange) {
  if (!signals.length) {
    return createBaseEmbed(COLORS.muted)
      .setTitle(`${exchange} 策略掃描`)
      .setDescription("目前沒有達標訊號")
      .setFooter({
        text: "Scanner Idle",
      });
  }

  const description = signals
    .map((signal, index) => {
      return [
        `## ${index + 1}. ${signal.direction} ${signal.symbol}`,
        `🎯 Score: **${signal.confidence}** | RR: **${signal.riskReward}R**`,
        `📊 H1 ${formatMomentum(signal.higherTimeframeMomentum)} / M15 ${formatMomentum(signal.momentum)}`,
        `💰 Entry: $${formatPrice(signal.entry)}`,
        `🎯 TP1: $${formatPrice(signal.takeProfit1)}`,
        `🛑 SL: $${formatPrice(signal.stopLoss)}`,
      ].join("\n");
    })
    .join("\n\n");

  return createBaseEmbed(COLORS.warning)
    .setTitle(`${exchange} 策略掃描`)
    .setDescription(description)
    .setFooter({
      text: `${signals.length} Signals Detected`,
    });
}

module.exports = {
  buildTickerEmbed,
  buildOverviewEmbed,
  buildSignalEmbed,
  buildSignalListEmbed,
};
