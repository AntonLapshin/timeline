import { createContext, type Context } from "react";
import { createApiClient, type ApiClient } from "../../core/apiClient";
import { createLlmParser, type LlmParser } from "../../core/llmParse";

/** The set of injected services available to the UI via context. */
export interface Services {
  apiClient: ApiClient;
  llmParser: LlmParser;
}

/** Default API base URL for the loopback-only web app. */
export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8123";

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
