const axios = require("axios");

function normalizeSymbol(symbol) {
  return symbol.trim().toUpperCase();
}

function toBinanceSymbol(symbol) {
  return normalizeSymbol(symbol).replace("/", "");
}

function toOKXSwap(symbol) {
  const raw = normalizeSymbol(symbol).replace("/", "-");
  return raw.endsWith("-SWAP") ? raw : `${raw}-SWAP`;
}

function toBybitSymbol(symbol) {
  return normalizeSymbol(symbol).replace("/", "");
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

const BinanceAPI = {
  name: "Binance Futures",
  baseURL: "https://fapi.binance.com",

  async getTopContractSymbols(limit = 30) {
    const res = await axios.get(`${this.baseURL}/fapi/v1/ticker/24hr`, { timeout: 10000 });
    return res.data
      .filter((item) => item.symbol.endsWith("USDT"))
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, limit)
      .map((item) => item.symbol.replace("USDT", "/USDT"));
  },

  async getTopSymbols(limit = 20) {
    return this.getTopContractSymbols(limit);
  },

  async getTicker(symbol) {
    const sym = toBinanceSymbol(symbol);
    const res = await axios.get(`${this.baseURL}/fapi/v1/ticker/24hr?symbol=${sym}`, { timeout: 10000 });
    const data = res.data;
    return {
      exchange: this.name,
      symbol: sym.replace("USDT", "/USDT"),
      price: Number(data.lastPrice),
      priceChange: Number(data.priceChangePercent),
      high24h: Number(data.highPrice),
      low24h: Number(data.lowPrice),
      quoteVolume24h: Number(data.quoteVolume),
      timestamp: Date.now(),
    };
  },

  async getMultipleTickers(symbols) {
    const res = await axios.get(`${this.baseURL}/fapi/v1/ticker/24hr`, { timeout: 10000 });
    const map = new Map(res.data.map((item) => [item.symbol, item]));
    return symbols.map((symbol) => {
      const sym = toBinanceSymbol(symbol);
      const data = map.get(sym);
      if (!data) return null;
      return {
        exchange: this.name,
        symbol: sym.replace("USDT", "/USDT"),
        price: Number(data.lastPrice),
        priceChange: Number(data.priceChangePercent),
        high24h: Number(data.highPrice),
        low24h: Number(data.lowPrice),
        quoteVolume24h: Number(data.quoteVolume),
        timestamp: Date.now(),
      };
    }).filter(Boolean);
  },

  async getCandles(symbol, timeframe = "15m", limit = 120) {
    const sym = toBinanceSymbol(symbol);
    const res = await axios.get(`${this.baseURL}/fapi/v1/klines`, {
      params: { symbol: sym, interval: timeframe, limit },
      timeout: 10000,
    });
    return res.data.map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5]));
  },
};

const OKXAPI = {
  name: "OKX Swap",
  baseURL: "https://www.okx.com",

  async getTopContractSymbols(limit = 30) {
    const res = await axios.get(`${this.baseURL}/api/v5/market/tickers`, {
      params: { instType: "SWAP" },
      timeout: 10000,
    });
    return res.data.data
      .filter((item) => item.instId.endsWith("-USDT-SWAP"))
      .sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h))
      .slice(0, limit)
      .map((item) => item.instId.replace("-USDT-SWAP", "/USDT"));
  },

  async getTopSymbols(limit = 20) {
    return this.getTopContractSymbols(limit);
  },

  async getTicker(symbol) {
    const instId = toOKXSwap(symbol);
    const res = await axios.get(`${this.baseURL}/api/v5/market/ticker`, {
      params: { instId },
      timeout: 10000,
    });
    const data = res.data.data[0];
    const last = Number(data.last);
    const open = Number(data.open24h);
    return {
      exchange: this.name,
      symbol: instId.replace("-USDT-SWAP", "/USDT"),
      price: last,
      priceChange: open ? ((last - open) / open) * 100 : 0,
      high24h: Number(data.high24h),
      low24h: Number(data.low24h),
      quoteVolume24h: Number(data.volCcy24h),
      timestamp: Date.now(),
    };
  },

  async getMultipleTickers(symbols) {
    const res = await axios.get(`${this.baseURL}/api/v5/market/tickers`, {
      params: { instType: "SWAP" },
      timeout: 10000,
    });
    const map = new Map(res.data.data.map((item) => [item.instId, item]));
    return symbols.map((symbol) => {
      const instId = toOKXSwap(symbol);
      const data = map.get(instId);
      if (!data) return null;
      const last = Number(data.last);
      const open = Number(data.open24h);
      return {
        exchange: this.name,
        symbol: instId.replace("-USDT-SWAP", "/USDT"),
        price: last,
        priceChange: open ? ((last - open) / open) * 100 : 0,
        high24h: Number(data.high24h),
        low24h: Number(data.low24h),
        quoteVolume24h: Number(data.volCcy24h),
        timestamp: Date.now(),
      };
    }).filter(Boolean);
  },

  async getCandles(symbol, timeframe = "15m", limit = 120) {
    const instId = toOKXSwap(symbol);
    const bar = timeframe === "1h" ? "1H" : timeframe;
    const res = await axios.get(`${this.baseURL}/api/v5/market/candles`, {
      params: { instId, bar, limit },
      timeout: 10000,
    });
    return res.data.data
      .map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5]))
      .reverse();
  },
};

const BybitAPI = {
  name: "Bybit Linear",
  baseURL: "https://api.bybit.com",

  async getTopContractSymbols(limit = 30) {
    const res = await axios.get(`${this.baseURL}/v5/market/tickers`, {
      params: { category: "linear" },
      timeout: 10000,
    });
    return res.data.result.list
      .filter((item) => item.symbol.endsWith("USDT"))
      .sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h))
      .slice(0, limit)
      .map((item) => item.symbol.replace("USDT", "/USDT"));
  },

  async getTopSymbols(limit = 20) {
    return this.getTopContractSymbols(limit);
  },

  async getTicker(symbol) {
    const sym = toBybitSymbol(symbol);
    const res = await axios.get(`${this.baseURL}/v5/market/tickers`, {
      params: { category: "linear", symbol: sym },
      timeout: 10000,
    });
    const data = res.data.result.list[0];
    return {
      exchange: this.name,
      symbol: sym.replace("USDT", "/USDT"),
      price: Number(data.lastPrice),
      priceChange: Number(data.price24hPcnt) * 100,
      high24h: Number(data.highPrice24h),
      low24h: Number(data.lowPrice24h),
      quoteVolume24h: Number(data.turnover24h),
      timestamp: Date.now(),
    };
  },

  async getMultipleTickers(symbols) {
    const res = await axios.get(`${this.baseURL}/v5/market/tickers`, {
      params: { category: "linear" },
      timeout: 10000,
    });
    const map = new Map(res.data.result.list.map((item) => [item.symbol, item]));
    return symbols.map((symbol) => {
      const sym = toBybitSymbol(symbol);
      const data = map.get(sym);
      if (!data) return null;
      return {
        exchange: this.name,
        symbol: sym.replace("USDT", "/USDT"),
        price: Number(data.lastPrice),
        priceChange: Number(data.price24hPcnt) * 100,
        high24h: Number(data.highPrice24h),
        low24h: Number(data.lowPrice24h),
        quoteVolume24h: Number(data.turnover24h),
        timestamp: Date.now(),
      };
    }).filter(Boolean);
  },

  async getCandles(symbol, timeframe = "15m", limit = 120) {
    const interval = timeframe === "1h" ? "60" : timeframe.replace("m", "");
    const res = await axios.get(`${this.baseURL}/v5/market/kline`, {
      params: { category: "linear", symbol: toBybitSymbol(symbol), interval, limit },
      timeout: 10000,
    });
    return res.data.result.list
      .map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5]))
      .reverse();
  },
};

const EXCHANGES = { binance: BinanceAPI, okx: OKXAPI, bybit: BybitAPI };

function getExchange(name = "okx") {
  return EXCHANGES[String(name).toLowerCase()] || OKXAPI;
}

module.exports = { getExchange };
