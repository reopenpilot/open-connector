import type { HomeAssistantActionContext, HomeAssistantActionHandler } from "./runtime.ts";

import { optionalRecord, optionalString, optionalStringOrNull, requiredRecord } from "../../core/cast.ts";
import { ProviderRequestError } from "../provider-runtime.ts";
import { assertStoredConfigMatches, badHomeAssistantRequest, requestHomeAssistantJson } from "./runtime.ts";

/**
 * One editable Home Assistant config domain served by `/api/config/<component>/config/<key>`.
 *
 * The three domains differ only in the component segment, the input field that
 * carries the key, and whether Home Assistant validates that key as a slug, so
 * the read/write/delete handlers are shared and parameterised by this record.
 */
interface HomeAssistantConfigDomain {
  /** Path segment under `/api/config`. */
  component: string;
  /** Action input field holding the config key. */
  keyField: string;
  /** Home Assistant validates script keys with `cv.slug`; automation and scene ids are free-form strings. */
  keyMustBeSlug: boolean;
}

const automationDomain: HomeAssistantConfigDomain = {
  component: "automation",
  keyField: "automationId",
  keyMustBeSlug: false,
};

const scriptDomain: HomeAssistantConfigDomain = {
  component: "script",
  keyField: "scriptKey",
  keyMustBeSlug: true,
};

const sceneDomain: HomeAssistantConfigDomain = {
  component: "scene",
  keyField: "sceneId",
  keyMustBeSlug: false,
};

const slugPattern = /^[a-z0-9_]+$/;

export const homeAssistantConfigActionHandlers: Record<string, HomeAssistantActionHandler> = {
  get_automation_config: (input, context) => readConfig(automationDomain, input, context),
  save_automation_config: (input, context) => writeConfig(automationDomain, input, context),
  delete_automation_config: (input, context) => removeConfig(automationDomain, input, context),
  get_script_config: (input, context) => readConfig(scriptDomain, input, context),
  save_script_config: (input, context) => writeConfig(scriptDomain, input, context),
  delete_script_config: (input, context) => removeConfig(scriptDomain, input, context),
  get_scene_config: (input, context) => readConfig(sceneDomain, input, context),
  save_scene_config: (input, context) => writeConfig(sceneDomain, input, context),
  delete_scene_config: (input, context) => removeConfig(sceneDomain, input, context),
  async check_config(_input, context) {
    const payload =
      optionalRecord(
        await requestHomeAssistantJson({
          context,
          path: "/api/config/core/check_config",
          method: "POST",
        }),
      ) ?? {};
    return {
      result: optionalString(payload.result) ?? "unknown",
      errors: optionalStringOrNull(payload.errors),
      warnings: optionalStringOrNull(payload.warnings),
    };
  },
};

async function readConfig(
  domain: HomeAssistantConfigDomain,
  input: Record<string, unknown>,
  context: HomeAssistantActionContext,
): Promise<unknown> {
  return {
    config: await requestHomeAssistantJson({
      context,
      path: buildConfigPath(domain, input),
      method: "GET",
    }),
  };
}

async function writeConfig(
  domain: HomeAssistantConfigDomain,
  input: Record<string, unknown>,
  context: HomeAssistantActionContext,
): Promise<unknown> {
  // The key travels in the path; Home Assistant injects it into the stored
  // entry itself, so the body is the bare config object.
  const path = buildConfigPath(domain, input);
  const previousConfig = requiredRecord(input.previousConfig, "previousConfig", badHomeAssistantRequest);
  const config = requiredRecord(input.config, "config", badHomeAssistantRequest);

  assertStoredConfigMatches({
    stored: await readStoredConfig(path, context),
    previous: previousConfig,
    subject: `this ${domain.component}`,
    readActionName: `get_${domain.component}_config`,
  });

  return {
    result: readConfigResult(
      await requestHomeAssistantJson({
        context,
        path,
        method: "POST",
        body: config,
      }),
    ),
  };
}

/**
 * Read the configuration this key currently stores, treating a key that has
 * none as an empty document.
 *
 * Posting to an unused key is how an entry is created, so "not stored yet" is a
 * normal state here rather than an error, and a caller creating one passes an
 * empty object.
 */
async function readStoredConfig(path: string, context: HomeAssistantActionContext): Promise<Record<string, unknown>> {
  try {
    return optionalRecord(await requestHomeAssistantJson({ context, path, method: "GET" })) ?? {};
  } catch (error) {
    if (error instanceof ProviderRequestError && error.status === 404) {
      return {};
    }
    throw error;
  }
}

async function removeConfig(
  domain: HomeAssistantConfigDomain,
  input: Record<string, unknown>,
  context: HomeAssistantActionContext,
): Promise<unknown> {
  return {
    result: readConfigResult(
      await requestHomeAssistantJson({
        context,
        path: buildConfigPath(domain, input),
        method: "DELETE",
      }),
    ),
  };
}

function buildConfigPath(domain: HomeAssistantConfigDomain, input: Record<string, unknown>): string {
  return `/api/config/${domain.component}/config/${encodeURIComponent(readConfigKey(domain, input))}`;
}

function readConfigKey(domain: HomeAssistantConfigDomain, input: Record<string, unknown>): string {
  const value = optionalString(input[domain.keyField]);
  if (!value) {
    throw badHomeAssistantRequest(`${domain.keyField} is required`);
  }
  if (domain.keyMustBeSlug && !slugPattern.test(value)) {
    throw badHomeAssistantRequest(`${domain.keyField} must be a slug of lowercase letters, digits, and underscores`);
  }
  return value;
}

function readConfigResult(payload: unknown): string {
  return optionalString(optionalRecord(payload)?.result) ?? "ok";
}
