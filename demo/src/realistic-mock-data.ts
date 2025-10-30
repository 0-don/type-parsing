import { ExchangeTypeEnum, ExchangeTypeUnion } from "./types";

export const exchangeType = "BITGET" as const;
export const eventType = "CASHBACK_BOOST" as const;
export const benefitType = "TRADE_RECLAIM" as const;
export const assetSymbol = "BTC" as const;
export const tradeStatus = "COMPLETED" as const;
export const userRole = "MOD" as const;
export const programType = "SIGNUP_BONUS" as const;
export const symbolType = "USDC" as const;
export const exchangeType2 = "MEXC" as const;
export const exchangeType3 = "BYBIT" as const;
export const exchangeType4 = "PHEMEX" as const;
export const eventStatus = "ACTIVE" as const;
export const eventStatus2 = "SCHEDULED" as const;
export const tradeType = "SPOT" as const;
export const tradeType2 = "FUTURES" as const;

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

export const mockBenefit = {
  benefitType: "SPECIAL",
  benefitEnum: "DAILY_BTC_PRIZE_DRAW",
};

export const mockTrade = {
  tradeType: "SPOT",
  asset: {
    symbol: "USDT",
  },
};
