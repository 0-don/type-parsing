import { ExchangeTypeEnum, ExchangeTypeUnion } from "./types";

export const exchangeType = "BITGET" as const;
export const eventType = "CASHBACK_BOOST" as const;

export const assetSymbol = "BTC" as const;
export const tradeStatus = "COMPLETED" as const;
export const userRole = "MOD" as const;
export const exchangeType2 = "MEXC" as const;
export const exchangeType3 = "BYBIT" as const;

export const exchangeTypeUnion = "MEXC" as ExchangeTypeUnion;
export const exchangeTypeEnum: ExchangeTypeEnum = ExchangeTypeEnum.MEXC;

export const mockExchange = {
  exchangeType: "MEXC" as ExchangeTypeEnum,
  name: "MEXC Exchange",
  isActive: true,
};

export const mockEvent = {
  eventType: "TRADING_COMPETITION",
  status: "ACTIVE",
  exchangeType: "BYBIT" as ExchangeTypeUnion,
};

