import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { mockExchange } from "./lib/mock";
import { ExchangeDtoExchangeType } from "./lib/openapi";
import { t } from "./lib/t";
import viteLogo from "/vite.svg";

const params = {
  exchangeType: "",
};

function App() {
  const [count, setCount] = useState(0);
  const exchangeType = params.exchangeType as ExchangeDtoExchangeType;

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
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
      {t(`BENEFITS.${exchangeType}.AMOUNT`)}
      {t(`BENEFITS.${mockExchange?.exchangeType!}.AMOUNT`)}
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  );
}

export default App;
