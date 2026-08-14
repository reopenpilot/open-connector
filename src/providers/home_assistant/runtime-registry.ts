import type { HomeAssistantRegistryName } from "./actions.ts";
import type { HomeAssistantActionContext, HomeAssistantActionHandler } from "./runtime.ts";

import {
  compactObject,
  nullableInteger,
  nullableString,
  optionalRecord,
  optionalString,
  optionalStringArray,
} from "../../core/cast.ts";
import { ProviderRequestError } from "../provider-runtime.ts";
import { homeAssistantRegistryNames } from "./actions.ts";
import { runHomeAssistantCommands } from "./runtime-ws.ts";
import { badHomeAssistantRequest, readInputString, requireHomeAssistantChanges } from "./runtime.ts";

const registryListCommandTypes: Record<HomeAssistantRegistryName, string> = {
  entities: "config/entity_registry/list",
  devices: "config/device_registry/list",
  areas: "config/area_registry/list",
  floors: "config/floor_registry/list",
  labels: "config/label_registry/list",
};

export const homeAssistantRegistryActionHandlers: Record<string, HomeAssistantActionHandler> = {
  async get_registries(input, context) {
    const requested = readRegistryNames(input.include);
    const results = await runHomeAssistantCommands(
      context,
      requested.map((name) => ({ type: registryListCommandTypes[name] })),
    );

    // Registries the caller did not ask for stay null so an omitted registry is
    // distinguishable from one the instance genuinely has no entries for.
    const output: Record<HomeAssistantRegistryName, unknown> = {
      entities: null,
      devices: null,
      areas: null,
      floors: null,
      labels: null,
    };
    requested.forEach((name, index) => {
      output[name] = results[index] ?? [];
    });
    return output;
  },
  async get_entity_registry_entry(input, context) {
    const entry = await runRegistryCommand(context, "config/entity_registry/get", {
      entity_id: readInputString(input.entityId, "entityId"),
    });
    return { entry };
  },
  async update_entity_registry_entry(input, context) {
    const changes = compactObject({
      name: nullableString(input.name),
      icon: nullableString(input.icon),
      area_id: nullableString(input.areaId),
      device_class: nullableString(input.deviceClass),
      hidden_by: nullableString(input.hiddenBy),
      // Both list fields replace what is stored rather than adding to it, and
      // neither accepts null, so an empty array is how a caller clears them.
      aliases: optionalStringArray(input.aliases),
      labels: optionalStringArray(input.labels),
      ...readEntityOptions(input),
    });
    requireHomeAssistantChanges(changes, "name, icon, areaId, deviceClass, hiddenBy, aliases, labels, or options");

    // This is the one registry command that wraps its result, so the entry has
    // to be unwrapped here rather than by the shared helper.
    const result = await runRegistryCommand(context, "config/entity_registry/update", {
      entity_id: readInputString(input.entityId, "entityId"),
      ...changes,
    });
    return { entry: optionalRecord(result.entity_entry) ?? {} };
  },
  async update_device_registry_entry(input, context) {
    const changes = compactObject({
      // Home Assistant keeps the integration-provided name read-only; the
      // user-visible rename is name_by_user, and null restores the original.
      name_by_user: nullableString(input.nameByUser),
      area_id: nullableString(input.areaId),
      labels: optionalStringArray(input.labels),
    });
    requireHomeAssistantChanges(changes, "nameByUser, areaId, or labels");

    const entry = await runRegistryCommand(context, "config/device_registry/update", {
      device_id: readInputString(input.deviceId, "deviceId"),
      ...changes,
    });
    return { entry };
  },
  async create_area(input, context) {
    const entry = await runRegistryCommand(context, "config/area_registry/create", {
      name: readInputString(input.name, "name"),
      ...compactObject({
        // Create rejects an explicit null for these two, unlike update, so they
        // are read as plain optional strings.
        floor_id: optionalString(input.floorId),
        icon: optionalString(input.icon),
        picture: nullableString(input.picture),
        aliases: optionalStringArray(input.aliases),
        labels: optionalStringArray(input.labels),
        temperature_entity_id: nullableString(input.temperatureEntityId),
        humidity_entity_id: nullableString(input.humidityEntityId),
      }),
    });
    return { entry };
  },
  async update_area(input, context) {
    const changes = compactObject({
      name: optionalString(input.name),
      floor_id: nullableString(input.floorId),
      icon: nullableString(input.icon),
      picture: nullableString(input.picture),
      aliases: optionalStringArray(input.aliases),
      labels: optionalStringArray(input.labels),
      temperature_entity_id: nullableString(input.temperatureEntityId),
      humidity_entity_id: nullableString(input.humidityEntityId),
    });
    requireHomeAssistantChanges(
      changes,
      "name, floorId, icon, picture, aliases, labels, temperatureEntityId, or humidityEntityId",
    );

    const entry = await runRegistryCommand(context, "config/area_registry/update", {
      area_id: readInputString(input.areaId, "areaId"),
      ...changes,
    });
    return { entry };
  },
  async create_floor(input, context) {
    const entry = await runRegistryCommand(context, "config/floor_registry/create", {
      name: readInputString(input.name, "name"),
      ...compactObject({
        icon: nullableString(input.icon),
        level: nullableInteger(input.level),
        aliases: optionalStringArray(input.aliases),
      }),
    });
    return { entry };
  },
  async update_floor(input, context) {
    const changes = compactObject({
      name: optionalString(input.name),
      icon: nullableString(input.icon),
      level: nullableInteger(input.level),
      aliases: optionalStringArray(input.aliases),
    });
    requireHomeAssistantChanges(changes, "name, icon, level, or aliases");

    const entry = await runRegistryCommand(context, "config/floor_registry/update", {
      floor_id: readInputString(input.floorId, "floorId"),
      ...changes,
    });
    return { entry };
  },
  async create_label(input, context) {
    const entry = await runRegistryCommand(context, "config/label_registry/create", {
      name: readInputString(input.name, "name"),
      ...compactObject({
        icon: nullableString(input.icon),
        color: nullableString(input.color),
        description: nullableString(input.description),
      }),
    });
    return { entry };
  },
  async update_label(input, context) {
    const changes = compactObject({
      name: optionalString(input.name),
      icon: nullableString(input.icon),
      color: nullableString(input.color),
      description: nullableString(input.description),
    });
    requireHomeAssistantChanges(changes, "name, icon, color, or description");

    const entry = await runRegistryCommand(context, "config/label_registry/update", {
      label_id: readInputString(input.labelId, "labelId"),
      ...changes,
    });
    return { entry };
  },
};

/** Run one registry command and read its result as a registry entry object. */
async function runRegistryCommand(
  context: HomeAssistantActionContext,
  type: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [result] = await runHomeAssistantCommands(context, [{ type, ...fields }]);
  return optionalRecord(result) ?? {};
}

/**
 * Entity options are stored per integration domain, and Home Assistant requires
 * the domain and the options to travel together: one without the other is
 * rejected by the instance as a malformed command.
 */
function readEntityOptions(input: Record<string, unknown>): Record<string, unknown> {
  const optionsDomain = optionalString(input.optionsDomain);
  const options = input.options === null ? null : optionalRecord(input.options);
  if (optionsDomain === undefined && options === undefined) {
    return {};
  }
  if (optionsDomain === undefined || options === undefined) {
    throw badHomeAssistantRequest("optionsDomain and options must be sent together");
  }
  return { options_domain: optionsDomain, options };
}

function readRegistryNames(value: unknown): HomeAssistantRegistryName[] {
  if (value === undefined || value === null) {
    return homeAssistantRegistryNames;
  }
  if (!Array.isArray(value)) {
    throw new ProviderRequestError(400, "include must be an array of registry names");
  }
  if (value.length === 0) {
    return homeAssistantRegistryNames;
  }

  const selected: HomeAssistantRegistryName[] = [];
  for (const entry of value) {
    const name = homeAssistantRegistryNames.find((candidate) => candidate === entry);
    if (!name) {
      throw new ProviderRequestError(400, `include must only contain ${homeAssistantRegistryNames.join(", ")}`);
    }
    if (!selected.includes(name)) {
      selected.push(name);
    }
  }
  return selected;
}
