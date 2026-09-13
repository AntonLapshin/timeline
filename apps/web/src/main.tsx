import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ServicesProvider } from "./ui/services/ServicesProvider";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ServicesProvider>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
