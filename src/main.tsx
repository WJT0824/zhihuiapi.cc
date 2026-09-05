import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./types/preload";
import { mockApi } from "./services/mockApi";

if (!window.zhihui) {
  window.zhihui = mockApi;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
