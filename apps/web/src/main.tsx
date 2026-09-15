import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { ServicesProvider } from "./ui/services/ServicesProvider";
import { ThemeProvider } from "./ui/theme/ThemeProvider";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ServicesProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </ServicesProvider>
  </StrictMode>,
);
