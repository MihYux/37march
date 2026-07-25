import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { OperatorApp } from "./operator/OperatorApp";
import "./styles.css";
import "./operator/release-workflow.css";
import "./operator/release-region-data.css";
import "./operator/release-plan-publish.css";
import "./operator/release-optimization-dashboard.css";

const isOperator =
  new URLSearchParams(window.location.search).get("surface") === "operator";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isOperator ? <OperatorApp /> : <App />}
  </StrictMode>,
);
