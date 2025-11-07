import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import {
  eventType,
  exchangeType,
  exchangeTypeEnum,
  exchangeTypeUnion,
  mockEvent,
  mockExchange,
} from "./lib/mock.ts";
import { t } from "./lib/t.ts";
import { ExchangeTypeEnum } from "./lib/types.ts";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
