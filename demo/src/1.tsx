import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ExchangeDtoExchangeType } from "./lib/openapi";

const getPageMetadata = async (options: any) => options;

export async function generateMetadata(props: {
  params: Promise<{ locale: string; exchangeType: string }>;
}) {
  const locale = (await props.params).locale as Locale;
  const exchange = (await props.params).exchangeType as ExchangeDtoExchangeType;
  const t = await getTranslations({ locale });

  return getPageMetadata({
    locale,
    title: t("METADATA.EXCHANGE.TITLE", {
      exchange: t(`MAIN.ENUM.${exchange}`),
    }),
    description: t("METADATA.EXCHANGE.DESCRIPTION", { exchange }),
    keywords: t("METADATA.EXCHANGE.KEYWORDS", { exchange }),
  });
}
