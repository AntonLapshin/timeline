import { useMemo, type ReactNode } from "react";
import {
  ServicesContext,
  createServices,
  DEFAULT_API_BASE_URL,
} from "./context";

export interface ServicesProviderProps {
  /** Base URL of the timeline API. Defaults to same-origin (LAN-friendly). */
  baseUrl?: string;
  children: ReactNode;
}

/**
 * Provides the injected services to the component tree.
 *
 * Components consume services via `useServices()` and never instantiate them
 * directly — the concrete implementations (and their base URLs / fetch impls)
 * are wired here once.
 */
export function ServicesProvider({
  baseUrl = DEFAULT_API_BASE_URL,
  children,
}: ServicesProviderProps) {
  const services = useMemo(() => createServices(baseUrl), [baseUrl]);

  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
}
