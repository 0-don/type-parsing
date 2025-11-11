import { ExchangeTypeEnum, type ExchangeTypeUnion } from "./lib/types";
import { t } from "./lib/t";

// ============================================
// CURRENTLY SUPPORTED (Should work)
// ============================================

// 1. Direct variable with union type ✓
const exchangeType: ExchangeTypeUnion = "MEXC";
t(`EXCHANGE.${exchangeType}.NAME`);

// 2. Property access (single level) ✓
const mockExchange = { exchangeType: "BYBIT" as ExchangeTypeUnion };
t(`EXCHANGE.${mockExchange.exchangeType}.NAME`);

// 3. Enum variable ✓
const enumValue: ExchangeTypeEnum = ExchangeTypeEnum.MEXC;
t(`EXCHANGE.${enumValue}.NAME`);

// 4. Object.values().forEach() ✓
Object.values(ExchangeTypeEnum).forEach((value) => {
  t(`EXCHANGE.${value}.NAME`);
});

// ============================================
// HIGH PRIORITY - SHOULD TEST
// ============================================

// 5. Array.map() iteration - LIKELY FAILS
const exchangeTypes: ExchangeTypeUnion[] = ["MEXC", "BYBIT"];
exchangeTypes.map((type) => t(`EXCHANGE.${type}.NAME`));

// 6. Array.forEach() iteration - LIKELY FAILS
exchangeTypes.forEach((type) => {
  t(`EXCHANGE.${type}.NAME`);
});

// 7. Object.keys() iteration - LIKELY FAILS
Object.keys(ExchangeTypeEnum).forEach((key) => {
  t(`EXCHANGE.${key}.NAME`);
});

// 8. Object.entries() iteration - LIKELY FAILS
const config = { mexc: "MEXC", bybit: "BYBIT" } as const;
Object.entries(config).forEach(([key, value]) => {
  t(`EXCHANGE.${value}.NAME`);
});

// 9. Multi-level property access - LIKELY FAILS
const nested = {
  config: {
    exchange: {
      type: "MEXC" as ExchangeTypeUnion,
    },
  },
};
t(`EXCHANGE.${nested.config.exchange.type}.NAME`);

// 10. Destructured parameters - LIKELY FAILS
const exchanges = [
  { type: "MEXC" as ExchangeTypeUnion },
  { type: "BYBIT" as ExchangeTypeUnion },
];
exchanges.forEach(({ type }) => {
  t(`EXCHANGE.${type}.NAME`);
});

// ============================================
// MEDIUM PRIORITY - EDGE CASES
// ============================================

// 11. Ternary expression - MIGHT FAIL
const condition = true;
const selectedType = condition ? ("MEXC" as ExchangeTypeUnion) : ("BYBIT" as ExchangeTypeUnion);
t(`EXCHANGE.${selectedType}.NAME`);

// 12. Array with as const - LIKELY FAILS
const typeArray = ["MEXC", "BYBIT", "PHEMEX"] as const;
typeArray.forEach((type) => {
  t(`EXCHANGE.${type}.NAME`);
});

// 13. Spread operator - LIKELY FAILS
const firstTypes = ["MEXC"] as const;
const allTypes = [...firstTypes, "BYBIT"] as const;
allTypes.forEach((type) => {
  t(`EXCHANGE.${type}.NAME`);
});

// 14. Optional chaining (multi-level) - LIKELY FAILS
const maybeNested = {
  config: {
    exchange: {
      type: "MEXC" as ExchangeTypeUnion,
    },
  },
};
t(`EXCHANGE.${maybeNested?.config?.exchange?.type}.NAME`);

// 15. Array element access - LIKELY FAILS
const typesArray: ExchangeTypeUnion[] = ["MEXC", "BYBIT"];
t(`EXCHANGE.${typesArray[0]}.NAME`);

// 16. Function return value - MIGHT WORK (depends on VSCode language service)
function getExchangeType(): ExchangeTypeUnion {
  return "MEXC";
}
const returnedType = getExchangeType();
t(`EXCHANGE.${returnedType}.NAME`);

// 17. Type guard narrowing - MIGHT WORK
function processType(type: string | ExchangeTypeUnion) {
  if (type === "MEXC" || type === "BYBIT") {
    t(`EXCHANGE.${type}.NAME`); // Type should be narrowed
  }
}

// 18. Generic type parameter - LIKELY FAILS
function processGeneric<T extends ExchangeTypeUnion>(type: T) {
  t(`EXCHANGE.${type}.NAME`);
}

// 19. Const assertion on single literal - SHOULD WORK
const singleType = "MEXC" as const;
t(`EXCHANGE.${singleType}.NAME`);

// 20. Mixed: Object.values() with filter - LIKELY FAILS
Object.values(ExchangeTypeEnum)
  .filter((v) => v.startsWith("M"))
  .forEach((value) => {
    t(`EXCHANGE.${value}.NAME`);
  });

export {};
