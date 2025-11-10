"use client";
import { useTranslations } from "next-intl";
import { ExchangeDtoExchangeType } from "./lib/openapi";

export const ExchangeHero = () => {
  const t = useTranslations();
  const exchangeType = "binance" as ExchangeDtoExchangeType;
  const exchange = {
    score: 4.8,
    reclaimPercentage: 25,
  };
  const exchangeAccountsCount = 15420;
  const vipInfo = { maxLevel: 9 };
  const feeRanges = {
    highestMaker: 0.1,
    lowestMakerWithCashback: 0.025,
  };

  const handleStartEarning = () => {
    // Mock action
    console.log("Starting earning flow");
  };

  return (
    <div className="from-background via-background to-muted/20 relative overflow-hidden bg-linear-to-br">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-size-[24px_24px]" />

      <div className="relative z-10 container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <div className="bg-background/80 border-primary/20 flex h-32 w-32 items-center justify-center rounded-3xl border-2 p-6 shadow-2xl backdrop-blur-sm md:h-40 md:w-40">
                <div className="w-24 h-24 bg-orange-500 rounded-2xl flex items-center justify-center text-white font-bold text-2xl">
                  B
                </div>
              </div>

              <div className="absolute -top-3 -right-3">
                <div className="bg-primary text-primary-foreground font-plus-jakarta-sans flex items-center gap-1 px-3 py-1 text-sm font-bold shadow-lg rounded">
                  ⭐ {exchange.score.toFixed(1)}
                </div>
              </div>

              <div className="bg-primary/20 absolute inset-0 -z-10 animate-pulse rounded-full blur-xl" />
            </div>
          </div>

          <div className="mb-8">
            <h1 className="from-foreground via-foreground/90 to-foreground/70 font-plus-jakarta-sans mb-4 bg-linear-to-r bg-clip-text text-center text-2xl leading-tight font-bold text-transparent sm:text-3xl md:text-4xl lg:text-5xl">
              {t(`MAIN.ENUM.${exchangeType!}`)}
            </h1>
            <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <div className="font-hanken-grotesk bg-linear-to-r from-red-500 to-orange-500 px-4 py-2 text-lg font-bold text-white shadow-lg rounded">
                ⚡{" "}
                {t("EXCHANGE.CASHBACK_POLICY.FEES_PAYBACK_DISCOUNT", {
                  rate: exchange.reclaimPercentage,
                })}
              </div>
            </div>

            <div className="flex items-center justify-center gap-4">
              <div className="flex gap-2">
                <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                  Spot Trading
                </span>
                <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">
                  Futures
                </span>
              </div>
            </div>
          </div>

          <div className="mb-8 flex flex-wrap justify-center gap-5">
            <div className="bg-card/50 flex flex-1 items-center gap-3 rounded-xl border p-4 backdrop-blur-sm">
              <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
                👥
              </div>
              <div className="text-left">
                <div className="text-primary font-plus-jakarta-sans text-2xl font-bold">
                  {exchangeAccountsCount.toLocaleString()}
                </div>
                <div className="text-muted-foreground font-hanken-grotesk text-sm">
                  {t("EXCHANGE.HERO.ACTIVE_USERS")}
                </div>
              </div>
            </div>

            <div className="bg-card/50 flex flex-1 items-center gap-3 rounded-xl border p-4 backdrop-blur-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                📈
              </div>
              <div className="text-left">
                <div className="font-plus-jakarta-sans text-2xl font-bold whitespace-nowrap text-blue-500">
                  {t("EXCHANGE.HERO.FEE_RANGE", {
                    from: feeRanges.highestMaker.toFixed(3),
                    to: feeRanges.lowestMakerWithCashback.toFixed(3),
                  })}
                </div>
                <div className="text-muted-foreground font-hanken-grotesk text-sm">
                  {t("EXCHANGE.HERO.FEES")}
                </div>
              </div>
            </div>

            <div className="bg-card/50 flex flex-1 items-center gap-3 rounded-xl border p-4 backdrop-blur-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
                ⭐
              </div>
              <div className="text-left">
                <div className="font-plus-jakarta-sans text-2xl font-bold text-yellow-500">
                  VIP {vipInfo.maxLevel}
                </div>
                <div className="text-muted-foreground font-hanken-grotesk text-sm">
                  {t("EXCHANGE.HERO.MAX_LEVEL")}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <button
              className="group font-hanken-grotesk w-full sm:w-auto bg-primary text-primary-foreground px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors"
              onClick={handleStartEarning}
            >
              ⚡ {t("EXCHANGE.HERO.START_EARNING")}
              <span className="ml-2 transition-transform group-hover:translate-x-1 inline-block">
                →
              </span>
            </button>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="text-muted-foreground font-hanken-grotesk flex items-center justify-center gap-2">
              ✓ {t("EXCHANGE.HERO.FEATURES.NO_MINIMUM_DEPOSIT")}
            </div>
            <div className="text-muted-foreground font-hanken-grotesk flex items-center justify-center gap-2">
              ✓ {t("EXCHANGE.HERO.FEATURES.INSTANT_CASHBACK")}
            </div>
            <div className="text-muted-foreground font-hanken-grotesk flex items-center justify-center gap-2">
              ✓ {t("EXCHANGE.HERO.FEATURES.VIP_BENEFITS")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
