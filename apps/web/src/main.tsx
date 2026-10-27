import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAuth } from "./lib/auth";
import { initTheme } from "./lib/theme";
import "./index.css";

initTheme();
initAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
