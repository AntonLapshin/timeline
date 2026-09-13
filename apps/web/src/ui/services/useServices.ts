import { useContext } from "react";
import { ServicesContext, type Services } from "./context";

/**
 * Access the injected services. Must be called within a `ServicesProvider`.
 */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error("useServices must be used within a ServicesProvider");
  }
  return services;
}
