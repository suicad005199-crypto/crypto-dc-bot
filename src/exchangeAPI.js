const axios = require("axios");

const REQUEST_TIMEOUT = 10000;

const http = axios.create({
  timeout: REQUEST_TIMEOUT,
  headers: {
    "User-Agent": "MarketDataService/1.0",
  },
});

function normalizeSymbol(symbol = "") {
  return symbol.trim().toUpperCase();
}

function formatUSDT(symbol) {
  return symbol.replace("USDT", "/USDT");
}

function candle(openTime, open, high, low, close, volume) {
  return {
    openTime: Number(openTime),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  };
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function createError(exchange, method, error) {
  return new Error(
    `[${exchange}] ${method} failed: ${
      error?.response?.data?.msg ||
      error?.response?.data?.message ||
      error.message
    }`
  );
}

class BaseExchange {
  constructor(name, baseURL) {
    this.name = name;
    this.baseURL = baseURL;
  }

  async request(url, params = {}) {
    try {
      const res = await http.get(`${this.baseURL}${url}`, { params });
      return res.data;
    } catch (error) {
      throw createError(this.name, url, error);
    }
  }

  mapTicker(data) {
    return data;
  }
}

/* ---------------- Binance ---------------- */

class BinanceAPI extends BaseExchange {
  constructor() {
    super("Binance Futures", "https://fapi.binance.com");
  }

  toSymbol(symbol) {
    return normalizeSymbol(symbol).replace("/", "");
  }

  async getAllTickers() {
    return this.request("/fapi/v1/ticker/24hr");
  }

  async getTopSymbols(limit = 20) {
    const data = await this.getAllTickers();

    return data
      .filter((x) => x.symbol.endsWith("USDT"))
      .sort((a, b) => safeNumber(b.quoteVolume) - safeNumber(a.quoteVolume))
      .slice(0, limit)
      .map((x) => formatUSDT(x.symbol));
  }

  mapTicker(data) {
    return {
      exchange: this.name,
      symbol: formatUSDT(data.symbol),
      price: safeNumber(data.lastPrice),
      priceChange: safeNumber(data.priceChangePercent),
      high24h: safeNumber(data.highPrice),
      low24h: safeNumber(data.lowPrice),
      quoteVolume24h: safeNumber(data.quoteVolume),
      timestamp: Date.now(),
    };
  }

  async getTicker(symbol) {
    const data = await this.request("/fapi/v1/ticker/24hr", {
      symbol: this.toSymbol(symbol),
    });

    return this.mapTicker(data);
  }

  async getMultipleTickers(symbols = []) {
    const data = await this.getAllTickers();

    const tickerMap = new Map(
      data.map((item) => [item.symbol, item])
    );

    return symbols
      .map((symbol) => {
        const ticker = tickerMap.get(this.toSymbol(symbol));
        return ticker ? this.mapTicker(ticker) : null;
      })
      .filter(Boolean);
  }

  async getCandles(symbol, timeframe = "15m", limit = 120) {
    const data = await this.request("/fapi/v1/klines", {
      symbol: this.toSymbol(symbol),
      interval: timeframe,
      limit,
    });

    return data.map((row) =>
      candle(row[0], row[1], row[2], row[3], row[4], row[5])
    );
  }
}

/* ---------------- OKX ---------------- */

class OKXAPI extends BaseExchange {
  constructor() {
    super("OKX Swap", "https://www.okx.com");
  }

  toSymbol(symbol) {
    const raw = normalizeSymbol(symbol).replace("/", "-");
    return raw.endsWith("-SWAP") ? raw : `${raw}-SWAP`;
  }

  async getAllTickers() {
    const res = await this.request("/api/v5/market/tickers", {
      instType: "SWAP",
    });

    return res.data || [];
  }

  getPriceChange(last, open) {
    return open ? ((last - open) / open) * 100 : 0;
  }

  mapTicker(data) {
    const last = safeNumber(data.last);
    const open = safeNumber(data.open24h);

    return {
      exchange: this.name,
      symbol: data.instId.replace("-USDT-SWAP", "/USDT"),
      price: last,
      priceChange: this.getPriceChange(last, open),
      high24h: safeNumber(data.high24h),
      low24h: safeNumber(data.low24h),
      quoteVolume24h: safeNumber(data.volCcy24h),
      timestamp: Date.now(),
    };
  }

  async getTopSymbols(limit = 20) {
    const data = await this.getAllTickers();

    return data
      .filter((x) => x.instId.endsWith("-USDT-SWAP"))
      .sort((a, b) => safeNumber(b.volCcy24h) - safeNumber(a.volCcy24h))
      .slice(0, limit)
      .map((x) => x.instId.replace("-USDT-SWAP", "/USDT"));
  }

  async getTicker(symbol) {
    const res = await this.request("/api/v5/market/ticker", {
      instId: this.toSymbol(symbol),
    });

    return this.mapTicker(res.data[0]);
  }

  async getMultipleTickers(symbols = []) {
    const data = await this.getAllTickers();

    const tickerMap = new Map(
      data.map((item) => [item.instId, item])
    );

    return symbols
      .map((symbol) => {
        const ticker = tickerMap.get(this.toSymbol(symbol));
        return ticker ? this.mapTicker(ticker) : null;
      })
      .filter(Boolean);
  }

  async getCandles(symbol, timeframe = "15m", limit = 120) {
    const bar = timeframe === "1h" ? "1H" : timeframe;

    const res = await this.request("/api/v5/market/candles", {
      instId: this.toSymbol(symbol),
      bar,
      limit,
    });

    return res.data
      .map((row) =>
        candle(row[0], row[1], row[2], row[3], row[4], row[5])
      )
      .reverse();
  }
}

/* ---------------- Bybit ---------------- */

class BybitAPI extends BaseExchange {
  constructor() {
    super("Bybit Linear", "https://api.bybit.com");
  }

  toSymbol(symbol) {
    return normalizeSymbol(symbol).replace("/", "");
  }

  async getAllTickers() {
    const res = await this.request("/v5/market/tickers", {
      category: "linear",
    });

    return res.result?.list || [];
  }

  mapTicker(data) {
    return {
      exchange: this.name,
      symbol: formatUSDT(data.symbol),
      price: safeNumber(data.lastPrice),
      priceChange: safeNumber(data.price24hPcnt) * 100,
      high24h: safeNumber(data.highPrice24h),
      low24h: safeNumber(data.lowPrice24h),
      quoteVolume24h: safeNumber(data.turnover24h),
      timestamp: Date.now(),
    };
  }

  async getTopSymbols(limit = 20) {
    const data = await this.getAllTickers();

    return data
      .filter((x) => x.symbol.endsWith("USDT"))
      .sort((a, b) => safeNumber(b.turnover24h) - safeNumber(a.turnover24h))
      .slice(0, limit)
      .map((x) => formatUSDT(x.symbol));
  }

  async getTicker(symbol) {
    const res = await this.request("/v5/market/tickers", {
      category: "linear",
      symbol: this.toSymbol(symbol),
    });

    return this.mapTicker(res.result.list[0]);
  }

  async getMultipleTickers(symbols = []) {
    const data = await this.getAllTickers();

    const tickerMap = new Map(
      data.map((item) => [item.symbol, item])
    );

    return symbols
      .map((symbol) => {
        const ticker = tickerMap.get(this.toSymbol(symbol));
        return ticker ? this.mapTicker(ticker) : null;
      })
      .filter(Boolean);
  }

  async getCandles(symbol, timeframe = "15m", limit = 120) {
    const interval =
      timeframe === "1h"
        ? "60"
        : timeframe.replace("m", "");

    const res = await this.request("/v5/market/kline", {
      category: "linear",
      symbol: this.toSymbol(symbol),
      interval,
      limit,
    });

    return res.result.list
      .map((row) =>
        candle(row[0], row[1], row[2], row[3], row[4], row[5])
      )
      .reverse();
  }
}

/* ---------------- Factory ---------------- */

const exchanges = {
  binance: new BinanceAPI(),
  okx: new OKXAPI(),
  bybit: new BybitAPI(),
};

function getExchange(name = "okx") {
  return exchanges[String(name).toLowerCase()] || exchanges.okx;
}

module.exports = {
  getExchange,
  exchanges,
};
