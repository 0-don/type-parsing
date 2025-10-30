import "./comprehensive-tests";
import {
  eventType,
  exchangeType,
  exchangeTypeEnum,
  exchangeTypeUnion,
  mockEvent,
  mockExchange,
} from "./mock";
import { t } from "./t";
import { ExchangeTypeEnum } from "./types";

// Test all exchange types in various contexts
t(`EXCHANGE.${exchangeType}.FEATURES.ADVANCED_TRADING`);

// Complex nested scenarios
t(`EXCHANGE.${exchangeType}.EVENTS.${eventType}.DETAILS`);

// Test benefits and rewards
t(`BENEFITS.${mockExchange.exchangeType}.AMOUNT`);
t(`REWARDS.${mockEvent.exchangeType}.CASHBACK_BOOST`);

t(`MAIN.ENUM.${exchangeTypeUnion}`);
t(`MAIN.ENUM.${exchangeTypeEnum}`);
Object.values(ExchangeTypeEnum).forEach((value) => t(`MAIN.ENUM.${value}`));
