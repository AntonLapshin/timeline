import { createContext, type Context } from "react";
import { createApiClient, type ApiClient } from "../../core/apiClient";
import { createLlmParser, type LlmParser } from "../../core/llmParse";

/** The set of injected services available to the UI via context. */
export interface Services {
  apiClient: ApiClient;
  llmParser: LlmParser;
}

/** Default API base URL: same-origin (relative) so the UI works on both
 * localhost and LAN IPs. The Vite dev/preview server proxies /api + /healthz
 * to the backend (see vite.config.ts), so browsers only need the web port
 * (8123) and avoid CORS. Pass an explicit base URL to override (tests do). */
export const DEFAULT_API_BASE_URL = "";

/** React context holding the injected services (null until provided). */
export const ServicesContext: Context<Services | null> =
  createContext<Services | null>(null);

/** Build the concrete services bound to a base URL. */
export function createServices(baseUrl: string = DEFAULT_API_BASE_URL): Services {
  return {
    apiClient: createApiClient(baseUrl),
    llmParser: createLlmParser(baseUrl),
  };
}
