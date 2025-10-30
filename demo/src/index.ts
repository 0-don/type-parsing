import { t } from "./t";
import { ExchangeType, ExchangeTypeEnum, ExchangeTypeUnion } from "./types";

const exchangeTypeUnion = "MEXC" as ExchangeTypeUnion;
const exhangeTypeEnum: ExchangeTypeEnum = ExchangeTypeEnum.MEXC;

t(`MAIN.ENUM.${exchangeTypeUnion}`);
t(`MAIN.ENUM.${exhangeTypeEnum}`);
Object.values(ExchangeType).forEach((value) => t(`MAIN.ENUM.${value}`));
