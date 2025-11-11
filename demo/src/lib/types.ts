export const ExchangeType = {
  MEXC: "MEXC",
  BYBIT: "BYBIT",
  PHEMEX: "PHEMEX",
  BITGET: "BITGET",
  OKX: "OKX",
  BITUNIX: "BITUNIX",
  BINANCE: "BINANCE",
  BITMART: "BITMART",
  LEVEX: "LEVEX",
} as const;

export enum ExchangeTypeEnum {
  MEXC = "MEXC",
  BYBIT = "BYBIT",
  PHEMEX = "PHEMEX",
  BITGET = "BITGET",
  OKX = "OKX",
  BITUNIX = "BITUNIX",
  BINANCE = "BINANCE",
  BITMART = "BITMART",
  LEVEX = "LEVEX",
}

export type ExchangeTypeUnion =
  | "MEXC"
  | "BYBIT"
  | "PHEMEX"
  | "BITGET"
  | "OKX"
  | "BITUNIX"
  | "BINANCE"
  | "BITMART"
  | "LEVEX";

export type FilterType =
  | "ALL"
  | "ONGOING_TOURNAMENTS"
  | "HIGH_CASHBACK"
  | "LIMIT_ORDER"
  | "MARKET_ORDER";

export interface FilterConfig {
  type: FilterType;
}
