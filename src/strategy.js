const DEFAULTS = {
  candleLimit: 120,
  minScore: 68,
  maxSignals: 5,
  atrStopMultiplier: 1.2,
  atrTargetMultiplier: 1.8,
  minRiskReward: 1.25,
};

function ema(values, length) {
  const k = 2 / (length + 1);
  let current = values[0];
  return values.map((value, index) => {
    current = index === 0 ? value : value * k + current * (1 - k);
    return current;
  });
}

function rsi(closes, length = 14) {
  if (closes.length <= length) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / length;
  let avgLoss = losses / length;
  for (let i = length + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (length - 1) + Math.max(diff, 0)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(-diff, 0)) / length;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atr(candles, length = 14) {
  if (candles.length <= length) return 0;
  const ranges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1].close;
    ranges.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    ));
  }
  return ranges.slice(-length).reduce((sum, value) => sum + value, 0) / length;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(from, to) {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

function roundPrice(price) {
  if (price >= 1000) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(6));
  return Number(price.toFixed(8));
}

function buildLevels(direction, entry, atrValue, options) {
  const stopDistance = Math.max(entry * 0.006, atrValue * options.atrStopMultiplier);
  const targetDistance = Math.max(stopDistance * options.minRiskReward, atrValue * options.atrTargetMultiplier);

  if (direction === "LONG") {
    return {
      entry: roundPrice(entry),
      stopLoss: roundPrice(entry - stopDistance),
      takeProfit1: roundPrice(entry + targetDistance),
      takeProfit2: roundPrice(entry + targetDistance * 1.65),
      riskReward: Number((targetDistance / stopDistance).toFixed(2)),
    };
  }

  return {
    entry: roundPrice(entry),
    stopLoss: roundPrice(entry + stopDistance),
    takeProfit1: roundPrice(entry - targetDistance),
    takeProfit2: roundPrice(entry - targetDistance * 1.65),
    riskReward: Number((targetDistance / stopDistance).toFixed(2)),
  };
}

function scoreLong({ lastClose, emaFastNow, emaSlowNow, emaTrendNow, rsiNow, volumeRatio, momentum }) {
  let score = 0;
  const reasons = [];

  if (lastClose > emaTrendNow) { score += 20; reasons.push("價格站上 EMA50"); }
  if (emaFastNow > emaSlowNow) { score += 22; reasons.push("EMA9 > EMA21"); }
  if (momentum > 0.35) { score += 18; reasons.push("短線動能偏多"); }
  if (rsiNow >= 52 && rsiNow <= 72) { score += 18; reasons.push("RSI 多方且未過熱"); }
  if (volumeRatio >= 1.15) { score += 14; reasons.push("量能放大"); }
  if (lastClose > emaFastNow) { score += 8; reasons.push("價格貼近強勢區"); }

  return { direction: "LONG", score, reasons };
}

function scoreShort({ lastClose, emaFastNow, emaSlowNow, emaTrendNow, rsiNow, volumeRatio, momentum }) {
  let score = 0;
  const reasons = [];

  if (lastClose < emaTrendNow) { score += 20; reasons.push("價格跌破 EMA50"); }
  if (emaFastNow < emaSlowNow) { score += 22; reasons.push("EMA9 < EMA21"); }
  if (momentum < -0.35) { score += 18; reasons.push("短線動能偏空"); }
  if (rsiNow <= 48 && rsiNow >= 28) { score += 18; reasons.push("RSI 空方且未過度超跌"); }
  if (volumeRatio >= 1.15) { score += 14; reasons.push("量能放大"); }
  if (lastClose < emaFastNow) { score += 8; reasons.push("價格貼近弱勢區"); }

  return { direction: "SHORT", score, reasons };
}

function analyzeSymbol(symbol, candles, options = {}) {
  const config = { ...DEFAULTS, ...options };
  if (!Array.isArray(candles) || candles.length < 60) return null;

  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const last = candles[candles.length - 1];
  const emaFast = ema(closes, 9);
  const emaSlow = ema(closes, 21);
  const emaTrend = ema(closes, 50);
  const atrValue = atr(candles, 14);
  const rsiNow = rsi(closes, 14);
  const recentVolume = average(volumes.slice(-5));
  const baseVolume = average(volumes.slice(-30, -5));
  const volumeRatio = baseVolume ? recentVolume / baseVolume : 1;
  const momentum = pct(closes[closes.length - 6], last.close);

  const input = {
    lastClose: last.close,
    emaFastNow: emaFast[emaFast.length - 1],
    emaSlowNow: emaSlow[emaSlow.length - 1],
    emaTrendNow: emaTrend[emaTrend.length - 1],
    rsiNow,
    volumeRatio,
    momentum,
  };

  const long = scoreLong(input);
  const short = scoreShort(input);
  const picked = long.score >= short.score ? long : short;
  const levels = buildLevels(picked.direction, last.close, atrValue, config);

  if (picked.score < config.minScore || levels.riskReward < config.minRiskReward) return null;

  return {
    symbol,
    direction: picked.direction,
    score: Math.min(picked.score, 100),
    confidence: `${Math.min(picked.score, 100)}%`,
    entry: levels.entry,
    takeProfit1: levels.takeProfit1,
    takeProfit2: levels.takeProfit2,
    stopLoss: levels.stopLoss,
    riskReward: levels.riskReward,
    rsi: Number(rsiNow.toFixed(2)),
    atr: roundPrice(atrValue),
    momentum: Number(momentum.toFixed(2)),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    reasons: picked.reasons.slice(0, 4),
    timestamp: Date.now(),
  };
}

function getHigherTimeframeBias(candles) {
  if (!Array.isArray(candles) || candles.length < 60) return null;

  const closes = candles.map((candle) => candle.close);
  const emaFast = ema(closes, 21);
  const emaSlow = ema(closes, 50);
  const lastClose = closes[closes.length - 1];
  const emaFastNow = emaFast[emaFast.length - 1];
  const emaSlowNow = emaSlow[emaSlow.length - 1];
  const momentum = pct(closes[closes.length - 7], lastClose);

  if (lastClose > emaSlowNow && emaFastNow > emaSlowNow && momentum > 0) {
    return { direction: "LONG", momentum: Number(momentum.toFixed(2)) };
  }

  if (lastClose < emaSlowNow && emaFastNow < emaSlowNow && momentum < 0) {
    return { direction: "SHORT", momentum: Number(momentum.toFixed(2)) };
  }

  return { direction: "NEUTRAL", momentum: Number(momentum.toFixed(2)) };
}

function analyzeMultiTimeframeSymbol(symbol, lowerCandles, higherCandles, options = {}) {
  const bias = getHigherTimeframeBias(higherCandles);
  if (!bias || bias.direction === "NEUTRAL") return null;

  const signal = analyzeSymbol(symbol, lowerCandles, options);
  if (!signal || signal.direction !== bias.direction) return null;

  return {
    ...signal,
    higherTimeframe: options.higherTimeframe || "1h",
    lowerTimeframe: options.timeframe || "15m",
    higherTimeframeMomentum: bias.momentum,
    reasons: [`H1 大方向 ${bias.direction}`, ...signal.reasons].slice(0, 5),
  };
}

async function scanMarket(api, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const symbols = await api.getTopContractSymbols(config.scanLimit || 30);
  const signals = [];

  for (const symbol of symbols) {
    try {
      const [lowerCandles, higherCandles] = await Promise.all([
        api.getCandles(symbol, config.timeframe || "15m", config.candleLimit),
        api.getCandles(symbol, config.higherTimeframe || "1h", config.candleLimit),
      ]);
      const signal = analyzeMultiTimeframeSymbol(symbol, lowerCandles, higherCandles, config);
      if (signal) signals.push({ ...signal, exchange: api.name });
    } catch (err) {
      console.warn(`skip ${symbol}: ${err.message}`);
    }
  }

  return signals
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxSignals);
}

module.exports = { analyzeSymbol, analyzeMultiTimeframeSymbol, scanMarket };
