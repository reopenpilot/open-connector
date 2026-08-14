import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { HomeAssistantActionContext } from "./runtime.ts";

import { isPrivateNetworkAccessAllowed } from "../../core/request.ts";
import { defineProviderExecutors, requireApiKeyCredential } from "../provider-runtime.ts";
import { homeAssistantConfigActionHandlers } from "./runtime-config.ts";
import { homeAssistantLovelaceActionHandlers } from "./runtime-lovelace.ts";
import { homeAssistantRegistryActionHandlers } from "./runtime-registry.ts";
import { homeAssistantStatisticsActionHandlers } from "./runtime-statistics.ts";
import { homeAssistantWebSocketActionHandlers } from "./runtime-ws.ts";
import {
  homeAssistantActionHandlers,
  resolveHomeAssistantBaseUrl,
  validateHomeAssistantCredential,
} from "./runtime.ts";

const service = "home_assistant";

export const executors: ProviderExecutors = defineProviderExecutors<HomeAssistantActionContext>({
  service,
  handlers: {
    ...homeAssistantActionHandlers,
    ...homeAssistantConfigActionHandlers,
    ...homeAssistantLovelaceActionHandlers,
    ...homeAssistantRegistryActionHandlers,
    ...homeAssistantStatisticsActionHandlers,
    ...homeAssistantWebSocketActionHandlers,
  },
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<HomeAssistantActionContext> {
    const credential = await requireApiKeyCredential(context, service);
    return {
      apiKey: credential.apiKey,
      baseUrl: resolveHomeAssistantBaseUrl({
        values: credential.values,
        metadata: credential.metadata,
      }),
      fetcher,
      signal: context.signal,
    };
  },
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input) {
    return validateHomeAssistantCredential(input);
  },
};
