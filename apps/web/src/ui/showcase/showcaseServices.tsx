import { useMemo, type ReactNode } from "react";
import { ServicesContext } from "../services/context";
import {
  createShowcaseServices,
  type ShowcaseScenario,
} from "./showcaseServices";

/**
 * Injects fake services into the component tree via `ServicesContext`.
 *
 * Follows the same context-injection pattern as the real `ServicesProvider`:
 * components consume services via `useServices()` and never instantiate them
 * directly. The Showcase page wraps each gallery section in this provider with
 * a scenario so the real, dumb components render their various states without
 * any backend.
 */
export function ShowcaseServicesProvider({
  scenario = "populated",
  children,
}: {
  scenario?: ShowcaseScenario;
  children: ReactNode;
}) {
  const services = useMemo(() => createShowcaseServices(scenario), [scenario]);
  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
}
