const DEFAULTS = {
  candleLimit: 240,

  minScore: 70,
  maxSignals: 5,

  atrStopMultiplier: 1.4,
  atrTargetMultiplier: 2.2,

  minRiskReward: 1.8,

  volumeThreshold: 1.15,
  momentumThreshold: 0.25,

  minCandles: 220,
};

/* ---------------------------------- */
/* Utils */
/* ---------------------------------- */

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function average(values = []) {
  if (!values.length) return 0;

  return (
    values.reduce((sum, value) => sum + safeNumber(value), 0) /
    values.length
  );
}

function pct(from, to) {
  if (!from) return 0;

  return ((to - from) / from) * 100;
}

function roundPrice(price) {
  const value = safeNumber(price);

  if (value >= 1000) return Number(value.toFixed(2));
  if (value >= 1) return Number(value.toFixed(4));
  if (value >= 0.01) return Number(value.toFixed(6));

  return Number(value.toFixed(8));
}

/* ---------------------------------- */
/* Indicators */
/* ---------------------------------- */

function ema(values, length) {
  if (!values.length) return [];

  const multiplier = 2 / (length + 1);

  let current = values[0];

  return values.map((value, index) => {
    current =
      index === 0
        ? value
        : value * multiplier +
          current * (1 - multiplier);

    return current;
  });
}

function sma(values, length) {
  if (!values.length) return [];

  return values.map((_, index) => {
    if (index < length - 1) {
      return values[index];
    }

    const slice = values.slice(
      index - length + 1,
      index + 1
    );

    return average(slice);
  });
}

function atr(candles, length = 14) {
  if (candles.length <= length) return 0;

  const ranges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;

    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - prevClose),
        Math.abs(current.low - prevClose)
      )
    );
  }

  return average(ranges.slice(-length));
}

/* ---------------------------------- */
/* Trend Filter (H1) */
/* ---------------------------------- */

function getHigherTimeframeBias(candles) {
  if (
    !Array.isArray(candles) ||
    candles.length < DEFAULTS.minCandles
  ) {
    return null;
  }

  const closes = candles.map((x) => x.close);

  const ma83 = sma(closes, 83);
  const ema200 = ema(closes, 200);

  const lastClose = closes[closes.length - 1];

  const ma83Now = ma83[ma83.length - 1];
  const ema200Now = ema200[ema200.length - 1];

  const momentum = pct(
    closes[closes.length - 7],
    lastClose
  );

  /* ---------------- LONG ---------------- */

  if (
    lastClose > ma83Now &&
    ma83Now > ema200Now &&
    momentum > 0
  ) {
    return {
      direction: "LONG",
      momentum: Number(momentum.toFixed(2)),
      trend: "H1 多頭趨勢",
      ma83: roundPrice(ma83Now),
      ema200: roundPrice(ema200Now),
    };
  }

  /* ---------------- SHORT ---------------- */

  if (
    lastClose < ma83Now &&
    ma83Now < ema200Now &&
    momentum < 0
  ) {
    return {
      direction: "SHORT",
      momentum: Number(momentum.toFixed(2)),
      trend: "H1 空頭趨勢",
      ma83: roundPrice(ma83Now),
      ema200: roundPrice(ema200Now),
    };
  }

  return {
    direction: "NEUTRAL",
    momentum: Number(momentum.toFixed(2)),
    trend: "H1 無明確趨勢",
    ma83: roundPrice(ma83Now),
    ema200: roundPrice(ema200Now),
  };
}

/* ---------------------------------- */
/* Entry Levels */
/* ---------------------------------- */

function buildTradeLevels(
  direction,
  entry,
  atrValue,
  options
) {
  const stopDistance = Math.max(
    atrValue * options.atrStopMultiplier,
    entry * 0.005
  );

  const targetDistance = Math.max(
    atrValue * options.atrTargetMultiplier,
    stopDistance * options.minRiskReward
  );

  const isLong = direction === "LONG";

  return {
    entry: roundPrice(entry),

    stopLoss: roundPrice(
      isLong
        ? entry - stopDistance
        : entry + stopDistance
    ),

    takeProfit1: roundPrice(
      isLong
        ? entry + targetDistance
        : entry - targetDistance
    ),

    takeProfit2: roundPrice(
      isLong
        ? entry + targetDistance * 1.8
        : entry - targetDistance * 1.8
    ),

    riskReward: Number(
      (targetDistance / stopDistance).toFixed(2)
    ),
  };
}

/* ---------------------------------- */
/* M15 Entry Strategy */
/* ---------------------------------- */

function analyzeEntry(
  symbol,
  candles,
  higherBias,
  options = {}
) {
  const config = {
    ...DEFAULTS,
    ...options,
  };

  if (
    !Array.isArray(candles) ||
    candles.length < config.minCandles
  ) {
    return null;
  }

  const closes = candles.map((x) => x.close);
  const volumes = candles.map((x) => x.volume);

  const last = candles[candles.length - 1];

  const ma83 = sma(closes, 83);
  const ema200 = ema(closes, 200);

  const ma83Now = ma83[ma83.length - 1];
  const ema200Now = ema200[ema200.length - 1];

  const atrValue = atr(candles, 14);

  const recentVolume = average(
    volumes.slice(-5)
  );

  const baseVolume = average(
    volumes.slice(-30, -5)
  );

  const volumeRatio = baseVolume
    ? recentVolume / baseVolume
    : 1;

  const momentum = pct(
    closes[closes.length - 5],
    last.close
  );

  let score = 0;
  const reasons = [];

  /* ---------------------------------- */
  /* LONG */
  /* ---------------------------------- */

  if (higherBias.direction === "LONG") {
    if (last.close > ma83Now) {
      score += 30;
      reasons.push("價格站上 MA83");
    }

    if (ma83Now > ema200Now) {
      score += 30;
      reasons.push("MA83 > EMA200");
    }

    if (momentum > config.momentumThreshold) {
      score += 20;
      reasons.push("M15 多方動能");
    }

    if (volumeRatio >= config.volumeThreshold) {
      score += 20;
      reasons.push("量能放大");
    }
  }

  /* ---------------------------------- */
  /* SHORT */
  /* ---------------------------------- */

  if (higherBias.direction === "SHORT") {
    if (last.close < ma83Now) {
      score += 30;
      reasons.push("價格跌破 MA83");
    }

    if (ma83Now < ema200Now) {
      score += 30;
      reasons.push("MA83 < EMA200");
    }

    if (momentum < -config.momentumThreshold) {
      score += 20;
      reasons.push("M15 空方動能");
    }

    if (volumeRatio >= config.volumeThreshold) {
      score += 20;
      reasons.push("量能放大");
    }
  }

  if (score < config.minScore) {
    return null;
  }

  const levels = buildTradeLevels(
    higherBias.direction,
    last.close,
    atrValue,
    config
  );

  return {
    symbol,

    direction: higherBias.direction,

    trend: higherBias.trend,

    confidence: `${score}%`,
    score,

    entry: levels.entry,

    takeProfit1: levels.takeProfit1,
    takeProfit2: levels.takeProfit2,

    stopLoss: levels.stopLoss,

    riskReward: levels.riskReward,

    momentum: Number(momentum.toFixed(2)),

    volumeRatio: Number(volumeRatio.toFixed(2)),

    atr: roundPrice(atrValue),

    ma83: roundPrice(ma83Now),
    ema200: roundPrice(ema200Now),

    higherTimeframeMomentum:
      higherBias.momentum,

    higherTimeframe: "1h",
    lowerTimeframe: "15m",

    reasons,

    timestamp: Date.now(),
  };
}

/* ---------------------------------- */
/* Scanner */
/* ---------------------------------- */

async function scanMarket(api, options = {}) {
  const config = {
    ...DEFAULTS,
    ...options,
  };

  const symbols = await api.getTopSymbols(
    config.scanLimit || 30
  );

  const tasks = symbols.map(async (symbol) => {
    try {
      const [m15Candles, h1Candles] =
        await Promise.all([
          api.getCandles(
            symbol,
            "15m",
            config.candleLimit
          ),

          api.getCandles(
            symbol,
            "1h",
            config.candleLimit
          ),
        ]);

      const h1Bias =
        getHigherTimeframeBias(h1Candles);

      if (
        !h1Bias ||
        h1Bias.direction === "NEUTRAL"
      ) {
        return null;
      }

      const signal = analyzeEntry(
        symbol,
        m15Candles,
        h1Bias,
        config
      );

      return signal
        ? {
            ...signal,
            exchange: api.name,
          }
        : null;
    } catch (err) {
      console.warn(
        `scan skip ${symbol}:`,
        err.message
      );

      return null;
    }
  });

  const results = await Promise.all(tasks);

  return results
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxSignals);
}

module.exports = {
  scanMarket,
  analyzeEntry,
  getHigherTimeframeBias,

  indicators: {
    ema,
    sma,
    atr,
  },
};
