const DEFAULTS = {
  candleLimit: 120,

  minScore: 68,
  maxSignals: 5,

  atrStopMultiplier: 1.2,
  atrTargetMultiplier: 1.8,

  minRiskReward: 1.25,

  volumeThreshold: 1.15,
  momentumThreshold: 0.35,

  minCandles: 60,
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
    values.reduce(
      (sum, value) => sum + safeNumber(value),
      0
    ) / values.length
  );
}

function pct(from, to) {
  if (!from) return 0;

  return ((to - from) / from) * 100;
}

function roundPrice(price) {
  const value = safeNumber(price);

  if (value >= 1000) {
    return Number(value.toFixed(2));
  }

  if (value >= 1) {
    return Number(value.toFixed(4));
  }

  if (value >= 0.01) {
    return Number(value.toFixed(6));
  }

  return Number(value.toFixed(8));
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

/* ---------------------------------- */
/* Indicators */
/* ---------------------------------- */

function ema(values, length) {
  if (!values.length) return [];

  const multiplier =
    2 / (length + 1);

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

function rsi(closes, length = 14) {
  if (closes.length <= length) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= length; i++) {
    const diff =
      closes[i] - closes[i - 1];

    if (diff >= 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  let avgGain = gains / length;
  let avgLoss = losses / length;

  for (
    let i = length + 1;
    i < closes.length;
    i++
  ) {
    const diff =
      closes[i] - closes[i - 1];

    avgGain =
      (avgGain * (length - 1) +
        Math.max(diff, 0)) /
      length;

    avgLoss =
      (avgLoss * (length - 1) +
        Math.max(-diff, 0)) /
      length;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

function atr(candles, length = 14) {
  if (candles.length <= length) {
    return 0;
  }

  const ranges = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const current = candles[i];
    const prevClose =
      candles[i - 1].close;

    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(
          current.high - prevClose
        ),
        Math.abs(
          current.low - prevClose
        )
      )
    );
  }

  return average(
    ranges.slice(-length)
  );
}

/* ---------------------------------- */
/* Risk Model */
/* ---------------------------------- */

function buildTradeLevels(
  direction,
  entry,
  atrValue,
  options
) {
  const stopDistance = Math.max(
    entry * 0.006,
    atrValue *
      options.atrStopMultiplier
  );

  const targetDistance = Math.max(
    stopDistance *
      options.minRiskReward,
    atrValue *
      options.atrTargetMultiplier
  );

  const isLong =
    direction === "LONG";

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
        ? entry +
            targetDistance * 1.65
        : entry -
            targetDistance * 1.65
    ),

    riskReward: Number(
      (
        targetDistance /
        stopDistance
      ).toFixed(2)
    ),
  };
}

/* ---------------------------------- */
/* Score Engine */
/* ---------------------------------- */

function createScoreResult(direction) {
  return {
    direction,
    score: 0,
    reasons: [],
  };
}

function addScore(
  result,
  condition,
  score,
  reason
) {
  if (!condition) return;

  result.score += score;

  result.reasons.push(reason);
}

function scoreLong(input, options) {
  const result =
    createScoreResult("LONG");

  addScore(
    result,
    input.lastClose >
      input.emaTrendNow,
    20,
    "價格站上 EMA50"
  );

  addScore(
    result,
    input.emaFastNow >
      input.emaSlowNow,
    22,
    "EMA9 > EMA21"
  );

  addScore(
    result,
    input.momentum >
      options.momentumThreshold,
    18,
    "短線動能偏強"
  );

  addScore(
    result,
    input.rsiNow >= 52 &&
      input.rsiNow <= 72,
    18,
    "RSI 多方健康"
  );

  addScore(
    result,
    input.volumeRatio >=
      options.volumeThreshold,
    14,
    "量能放大"
  );

  addScore(
    result,
    input.lastClose >
      input.emaFastNow,
    8,
    "價格貼近強勢區"
  );

  return result;
}

function scoreShort(input, options) {
  const result =
    createScoreResult("SHORT");

  addScore(
    result,
    input.lastClose <
      input.emaTrendNow,
    20,
    "價格跌破 EMA50"
  );

  addScore(
    result,
    input.emaFastNow <
      input.emaSlowNow,
    22,
    "EMA9 < EMA21"
  );

  addScore(
    result,
    input.momentum <
      -options.momentumThreshold,
    18,
    "短線動能偏弱"
  );

  addScore(
    result,
    input.rsiNow <= 48 &&
      input.rsiNow >= 28,
    18,
    "RSI 空方健康"
  );

  addScore(
    result,
    input.volumeRatio >=
      options.volumeThreshold,
    14,
    "量能放大"
  );

  addScore(
    result,
    input.lastClose <
      input.emaFastNow,
    8,
    "價格貼近弱勢區"
  );

  return result;
}

/* ---------------------------------- */
/* Higher Timeframe Bias */
/* ---------------------------------- */

function getHigherTimeframeBias(
  candles
) {
  if (
    !Array.isArray(candles) ||
    candles.length <
      DEFAULTS.minCandles
  ) {
    return null;
  }

  const closes = candles.map(
    (x) => x.close
  );

  const emaFast = ema(closes, 21);
  const emaSlow = ema(closes, 50);

  const lastClose =
    closes[closes.length - 1];

  const emaFastNow =
    emaFast[emaFast.length - 1];

  const emaSlowNow =
    emaSlow[emaSlow.length - 1];

  const momentum = pct(
    closes[closes.length - 7],
    lastClose
  );

  const isLong =
    lastClose > emaSlowNow &&
    emaFastNow > emaSlowNow &&
    momentum > 0;

  const isShort =
    lastClose < emaSlowNow &&
    emaFastNow < emaSlowNow &&
    momentum < 0;

  if (isLong) {
    return {
      direction: "LONG",
      momentum: Number(
        momentum.toFixed(2)
      ),
    };
  }

  if (isShort) {
    return {
      direction: "SHORT",
      momentum: Number(
        momentum.toFixed(2)
      ),
    };
  }

  return {
    direction: "NEUTRAL",
    momentum: Number(
      momentum.toFixed(2)
    ),
  };
}

/* ---------------------------------- */
/* Symbol Analysis */
/* ---------------------------------- */

function analyzeSymbol(
  symbol,
  candles,
  options = {}
) {
  const config = {
    ...DEFAULTS,
    ...options,
  };

  if (
    !Array.isArray(candles) ||
    candles.length <
      config.minCandles
  ) {
    return null;
  }

  const closes = candles.map(
    (x) => x.close
  );

  const volumes = candles.map(
    (x) => x.volume
  );

  const last =
    candles[candles.length - 1];

  const emaFast = ema(closes, 9);
  const emaSlow = ema(closes, 21);
  const emaTrend = ema(closes, 50);

  const atrValue = atr(
    candles,
    14
  );

  const rsiNow = rsi(
    closes,
    14
  );

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
    closes[closes.length - 6],
    last.close
  );

  const input = {
    lastClose: last.close,

    emaFastNow:
      emaFast[emaFast.length - 1],

    emaSlowNow:
      emaSlow[emaSlow.length - 1],

    emaTrendNow:
      emaTrend[emaTrend.length - 1],

    rsiNow,
    volumeRatio,
    momentum,
  };

  const long = scoreLong(
    input,
    config
  );

  const short = scoreShort(
    input,
    config
  );

  const picked =
    long.score >= short.score
      ? long
      : short;

  const levels =
    buildTradeLevels(
      picked.direction,
      last.close,
      atrValue,
      config
    );

  if (
    picked.score <
      config.minScore ||
    levels.riskReward <
      config.minRiskReward
  ) {
    return null;
  }

  return {
    symbol,

    direction: picked.direction,

    score: clamp(
      picked.score,
      0,
      100
    ),

    confidence: `${clamp(
      picked.score,
      0,
      100
    )}%`,

    entry: levels.entry,

    takeProfit1:
      levels.takeProfit1,

    takeProfit2:
      levels.takeProfit2,

    stopLoss:
      levels.stopLoss,

    riskReward:
      levels.riskReward,

    rsi: Number(
      rsiNow.toFixed(2)
    ),

    atr: roundPrice(atrValue),

    momentum: Number(
      momentum.toFixed(2)
    ),

    volumeRatio: Number(
      volumeRatio.toFixed(2)
    ),

    reasons: picked.reasons.slice(
      0,
      4
    ),

    timestamp: Date.now(),
  };
}

/* ---------------------------------- */
/* Multi Timeframe */
/* ---------------------------------- */

function analyzeMultiTimeframeSymbol(
  symbol,
  lowerCandles,
  higherCandles,
  options = {}
) {
  const bias =
    getHigherTimeframeBias(
      higherCandles
    );

  if (
    !bias ||
    bias.direction === "NEUTRAL"
  ) {
    return null;
  }

  const signal = analyzeSymbol(
    symbol,
    lowerCandles,
    options
  );

  if (
    !signal ||
    signal.direction !==
      bias.direction
  ) {
    return null;
  }

  return {
    ...signal,

    higherTimeframe:
      options.higherTimeframe ||
      "1h",

    lowerTimeframe:
      options.timeframe ||
      "15m",

    higherTimeframeMomentum:
      bias.momentum,

    reasons: [
      `HTF ${bias.direction} Bias`,
      ...signal.reasons,
    ].slice(0, 5),
  };
}

/* ---------------------------------- */
/* Market Scanner */
/* ---------------------------------- */

async function scanMarket(
  api,
  options = {}
) {
  const config = {
    ...DEFAULTS,
    ...options,
  };

  const symbols =
    await api.getTopSymbols(
      config.scanLimit || 30
    );

  const tasks = symbols.map(
    async (symbol) => {
      try {
        const [
          lowerCandles,
          higherCandles,
        ] = await Promise.all([
          api.getCandles(
            symbol,
            config.timeframe ||
              "15m",
            config.candleLimit
          ),

          api.getCandles(
            symbol,
            config.higherTimeframe ||
              "1h",
            config.candleLimit
          ),
        ]);

        const signal =
          analyzeMultiTimeframeSymbol(
            symbol,
            lowerCandles,
            higherCandles,
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
    }
  );

  const results =
    await Promise.all(tasks);

  return results
    .filter(Boolean)
    .sort(
      (a, b) => b.score - a.score
    )
    .slice(0, config.maxSignals);
}

module.exports = {
  analyzeSymbol,
  analyzeMultiTimeframeSymbol,
  scanMarket,

  indicators: {
    ema,
    rsi,
    atr,
  },
};
