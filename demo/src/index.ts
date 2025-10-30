import "./comprehensive-tests";
import {
  assetSymbol,
  eventType,
  exchangeType,
  exchangeType2,
  exchangeType3,
  exchangeTypeEnum,
  exchangeTypeUnion,
  mockEvent,
  mockExchange,
  tradeStatus,
  userRole,
} from "./mock";
import { t } from "./t";
import { ExchangeTypeEnum } from "./types";

// Test all exchange types in various contexts
t(`EXCHANGE.${exchangeType}.FEATURES.ADVANCED_TRADING`);
t(`EXCHANGE.${exchangeType2}.FEES.MAKER_RATE`);
t(`EXCHANGE.${exchangeType3}.VIP.REQUIREMENTS`);

// Test benefits and rewards
t(`BENEFITS.${mockExchange.exchangeType}.AMOUNT`);
t(`REWARDS.${mockEvent.exchangeType}.CASHBACK_BOOST`);

// Test trading scenarios
t(`TRADING.${assetSymbol}.PAIR_INFO`);
t(`TRADING.STATUS.${tradeStatus}.ALERT`);

// Test user management
t(`USER.${userRole}.DASHBOARD.TITLE`);
t(`PERMISSIONS.${userRole}.ACCESS_LEVEL`);

// Test event management
t(`EVENTS.${eventType}.PARTICIPATION_RULES`);
t(`PROMOTIONS.${eventType}.REWARDS`);

// Complex nested scenarios
t(`EXCHANGE.${exchangeType}.EVENTS.${eventType}.DETAILS`);
t(`USER.${userRole}.EXCHANGE.${exchangeType2}.SETTINGS`);
t(`TRADING.${assetSymbol}.STATUS.${tradeStatus}.MESSAGE`);

t(`MAIN.ENUM.${exchangeTypeUnion}`);
t(`MAIN.ENUM.${exchangeTypeEnum}`);
Object.values(ExchangeTypeEnum).forEach((value) => t(`MAIN.ENUM.${value}`));

// Additional test patterns
const dynamicExchange = "BITUNIX" as const;
const dynamicEvent = "SPECIAL_PROMOTION" as const;

t(`DYNAMIC.${dynamicExchange}.CONFIG`);
t(`DYNAMIC.${dynamicEvent}.TERMS`);
