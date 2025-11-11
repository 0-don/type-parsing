import type { FilterConfig } from "@/lib/types";
import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { t } from "./lib/t";

const params = {
  exchangeType: "",
};

const filterConfigs: FilterConfig[] = [
  { type: "ALL" },
  { type: "ONGOING_TOURNAMENTS" },
  { type: "HIGH_CASHBACK" },
  { type: "LIMIT_ORDER" },
  { type: "MARKET_ORDER" },
];

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <div>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>

      {filterConfigs.map(({ type }) => (
        <div
          key={type}
          className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground md:min-w-none font-hanken-grotesk flex min-w-24 flex-col items-center gap-1 px-2 py-3 text-xs font-medium transition-all duration-200 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
        >
          <span className="hidden sm:inline">{t(`MAIN.ENUM.${type}`)}</span>
        </div>
      ))}
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  );
}

export default App;
