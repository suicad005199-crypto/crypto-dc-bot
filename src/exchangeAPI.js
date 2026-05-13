// src/exchangeAPI.js
// 交易所 API 模組 - 支援 Binance / OKX / Bybit

const axios = require("axios");

// ─── Binance ───────────────────────────────────────────────
const BinanceAPI = {
  baseURL: "https://api.binance.com",

  // 自動取得所有 USDT 交易對（依成交量排序）
  async getTopSymbols(limit = 20) {
    const res = await axios.get(`${this.baseURL}/api/v3/ticker/24hr`);
    return res.data
      .filter((t) => t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map((t) => t.symbol);
  },

  // 取得指定交易對資訊
  async getTicker(symbol) {
    const sym = symbol.replace("/", ""); // BTC/USDT → BTCUSDT
    const [ticker, info] = await Promise.all([
      axios.get(`${this.baseURL}/api/v3/ticker/24hr?symbol=${sym}`),
      axios.get(`${this.baseURL}/api/v3/exchangeInfo?symbol=${sym}`),
    ]);
    const d = ticker.data;
    const filters = info.data.symbols[0].filters;
    const lotFilter = filters.find((f) => f.filterType === "LOT_SIZE");

    return {
      exchange: "Binance",
      symbol: symbol,
      baseAsset: info.data.symbols[0].baseAsset,
      quoteAsset: info.data.symbols[0].quoteAsset,
      type: detectAssetType(info.data.symbols[0].baseAsset),
      price: parseFloat(d.lastPrice),
      priceChange: parseFloat(d.priceChangePercent),
      high24h: parseFloat(d.highPrice),
      low24h: parseFloat(d.lowPrice),
      volume24h: parseFloat(d.volume),
      quoteVolume24h: parseFloat(d.quoteVolume),
      minQty: lotFilter?.minQty,
      timestamp: Date.now(),
    };
  },

  // 批次取得多個交易對
  async getMultipleTickers(symbols) {
    const res = await axios.get(`${this.baseURL}/api/v3/ticker/24hr`);
    const map = {};
    res.data.forEach((t) => (map[t.symbol] = t));

    return symbols.map((sym) => {
      const key = sym.replace("/", "");
      const d = map[key];
      if (!d) return null;
      const base = key.replace("USDT", "");
      return {
        exchange: "Binance",
        symbol: sym,
        baseAsset: base,
        quoteAsset: "USDT",
        type: detectAssetType(base),
        price: parseFloat(d.lastPrice),
        priceChange: parseFloat(d.priceChangePercent),
        high24h: parseFloat(d.highPrice),
        low24h: parseFloat(d.lowPrice),
        volume24h: parseFloat(d.volume),
        quoteVolume24h: parseFloat(d.quoteVolume),
        timestamp: Date.now(),
      };
    }).filter(Boolean);
  },
};

// ─── OKX ───────────────────────────────────────────────────
const OKXAPI = {
  baseURL: "https://www.okx.com",

  async getTopSymbols(limit = 20) {
    const res = await axios.get(
      `${this.baseURL}/api/v5/market/tickers?instType=SPOT`
    );
    return res.data.data
      .filter((t) => t.instId.endsWith("-USDT"))
      .sort((a, b) => parseFloat(b.volCcy24h) - parseFloat(a.volCcy24h))
      .slice(0, limit)
      .map((t) => t.instId.replace("-", "/"));
  },

  async getTicker(symbol) {
    const instId = symbol.replace("/", "-"); // BTC/USDT → BTC-USDT
    const res = await axios.get(
      `${this.baseURL}/api/v5/market/ticker?instId=${instId}`
    );
    const d = res.data.data[0];
    const base = instId.split("-")[0];
    return {
      exchange: "OKX",
      symbol: symbol,
      baseAsset: base,
      quoteAsset: "USDT",
      type: detectAssetType(base),
      price: parseFloat(d.last),
      priceChange: (((parseFloat(d.last) - parseFloat(d.open24h)) / parseFloat(d.open24h)) * 100),
      high24h: parseFloat(d.high24h),
      low24h: parseFloat(d.low24h),
      volume24h: parseFloat(d.vol24h),
      quoteVolume24h: parseFloat(d.volCcy24h),
      timestamp: Date.now(),
    };
  },

  async getMultipleTickers(symbols) {
    const res = await axios.get(
      `${this.baseURL}/api/v5/market/tickers?instType=SPOT`
    );
    const map = {};
    res.data.data.forEach((t) => (map[t.instId] = t));

    return symbols.map((sym) => {
      const instId = sym.replace("/", "-");
      const d = map[instId];
      if (!d) return null;
      const base = instId.split("-")[0];
      return {
        exchange: "OKX",
        symbol: sym,
        baseAsset: base,
        quoteAsset: "USDT",
        type: detectAssetType(base),
        price: parseFloat(d.last),
        priceChange: (((parseFloat(d.last) - parseFloat(d.open24h)) / parseFloat(d.open24h)) * 100),
        high24h: parseFloat(d.high24h),
        low24h: parseFloat(d.low24h),
        volume24h: parseFloat(d.vol24h),
        quoteVolume24h: parseFloat(d.volCcy24h),
        timestamp: Date.now(),
      };
    }).filter(Boolean);
  },
};

// ─── Bybit ─────────────────────────────────────────────────
const BybitAPI = {
  baseURL: "https://api.bybit.com",

  async getTopSymbols(limit = 20) {
    const res = await axios.get(
      `${this.baseURL}/v5/market/tickers?category=spot`
    );
    return res.data.result.list
      .filter((t) => t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
      .slice(0, limit)
      .map((t) => t.symbol.replace("USDT", "/USDT"));
  },

  async getTicker(symbol) {
    const sym = symbol.replace("/", "");
    const res = await axios.get(
      `${this.baseURL}/v5/market/tickers?category=spot&symbol=${sym}`
    );
    const d = res.data.result.list[0];
    const base = sym.replace("USDT", "");
    return {
      exchange: "Bybit",
      symbol: symbol,
      baseAsset: base,
      quoteAsset: "USDT",
      type: detectAssetType(base),
      price: parseFloat(d.lastPrice),
      priceChange: parseFloat(d.price24hPcnt) * 100,
      high24h: parseFloat(d.highPrice24h),
      low24h: parseFloat(d.lowPrice24h),
      volume24h: parseFloat(d.volume24h),
      quoteVolume24h: parseFloat(d.turnover24h),
      timestamp: Date.now(),
    };
  },

  async getMultipleTickers(symbols) {
    const res = await axios.get(
      `${this.baseURL}/v5/market/tickers?category=spot`
    );
    const map = {};
    res.data.result.list.forEach((t) => (map[t.symbol] = t));

    return symbols.map((sym) => {
      const key = sym.replace("/", "");
      const d = map[key];
      if (!d) return null;
      const base = key.replace("USDT", "");
      return {
        exchange: "Bybit",
        symbol: sym,
        baseAsset: base,
        quoteAsset: "USDT",
        type: detectAssetType(base),
        price: parseFloat(d.lastPrice),
        priceChange: parseFloat(d.price24hPcnt) * 100,
        high24h: parseFloat(d.highPrice24h),
        low24h: parseFloat(d.lowPrice24h),
        volume24h: parseFloat(d.volume24h),
        quoteVolume24h: parseFloat(d.turnover24h),
        timestamp: Date.now(),
      };
    }).filter(Boolean);
  },
};

// ─── 自動偵測資產類型 ──────────────────────────────────────
const ASSET_CATEGORIES = {
  // Layer 1
  L1: ["BTC", "ETH", "BNB", "SOL", "ADA", "AVAX", "DOT", "ATOM", "NEAR", "FTM", "ALGO", "ONE", "EGLD", "HBAR", "XLM", "XRP", "TRX", "MATIC", "APT", "SUI"],
  // Layer 2
  L2: ["ARB", "OP", "MATIC", "IMX", "METIS", "BOBA", "ZKS", "STRK", "MANTA", "BLAST"],
  // DeFi
  DEFI: ["UNI", "AAVE", "COMP", "MKR", "CRV", "SUSHI", "YFI", "SNX", "BAL", "1INCH", "DYDX", "GMX", "GNS", "PENDLE", "JOE"],
  // Meme
  MEME: ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "MEME", "BOME", "POPCAT", "MEW"],
  // AI
  AI: ["FET", "AGIX", "OCEAN", "RNDR", "TAO", "ARKM", "GRT", "NMR", "WLD"],
  // GameFi
  GAMEFI: ["AXS", "SAND", "MANA", "ENJ", "GALA", "ILV", "GMT", "STEPN", "MAGIC", "IMX"],
  // Stablecoin
  STABLE: ["USDT", "USDC", "BUSD", "DAI", "TUSD", "FRAX", "LUSD"],
};

function detectAssetType(baseAsset) {
  const asset = baseAsset.toUpperCase();
  for (const [type, list] of Object.entries(ASSET_CATEGORIES)) {
    if (list.includes(asset)) return type;
  }
  return "ALT"; // 其他山寨幣
}

// ─── 匯出 ──────────────────────────────────────────────────
const EXCHANGES = { binance: BinanceAPI, okx: OKXAPI, bybit: BybitAPI };

function getExchange(name = "binance") {
  return EXCHANGES[name.toLowerCase()] || BinanceAPI;
}

module.exports = { getExchange, detectAssetType, ASSET_CATEGORIES };
