import { LinkAccountRequestExchangeType } from "./lib/openapi";
import { t } from "./lib/t";

export const Demo = () => {
  const featuredExchanges = Object.values(LinkAccountRequestExchangeType);

  return (
    <div className="container mx-auto max-w-xl px-4">
      {featuredExchanges.map((exchange) => (
        <>{t(`MAIN.ENUM.${exchange}`)}</>
      ))}
      {t("EXCHANGE.CASHBACK_POLICY.FEES_PAYBACK_DISCOUNT", {
        rate:  0,
      })}
    </div>
  );
};
