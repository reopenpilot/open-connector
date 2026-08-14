import type { ActionDefinition, JsonSchema } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "home_assistant";

const contextSchema = s.looseObject("The Home Assistant context attached to a state change.", {
  id: s.nullableString("The Home Assistant context identifier."),
  parent_id: s.nullableString("The optional parent context identifier."),
  user_id: s.nullableString("The optional Home Assistant user identifier."),
});

const stateProperties = {
  entity_id: s.string("The Home Assistant entity identifier."),
  state: s.string("The current state value."),
  attributes: s.looseObject("The integration-specific attributes for the entity state."),
  last_changed: s.string("The timestamp when the state last changed."),
  last_updated: s.string("The timestamp when the state object was last updated."),
  context: contextSchema,
};

const stateSchema = s.looseRequiredObject("One Home Assistant entity state object.", stateProperties, {
  optional: ["attributes", "context"],
});

// History rows are not full state objects. With minimal_response, Home Assistant
// returns only state and last_changed for the entries between the first and last
// of the period, dropping entity_id, attributes, and last_updated; no_attributes
// drops attributes on every row. Only state and last_changed are always present.
const historyStateSchema = s.looseRequiredObject(
  "One recorded Home Assistant state. Fields other than state and last_changed are omitted for compacted rows.",
  stateProperties,
  { optional: ["entity_id", "attributes", "last_updated", "context"] },
);

const emptyInputSchema = s.actionInput({}, [], "No input is required for this action.");
const entityInputSchema = s.actionInput(
  {
    entityId: s.nonEmptyString("The Home Assistant entity identifier, for example light.living_room."),
  },
  ["entityId"],
  "Input parameters for selecting one Home Assistant entity.",
);

/** Output field for one registry that only the Home Assistant WebSocket API serves. */
export type HomeAssistantRegistryName = "entities" | "devices" | "areas" | "floors" | "labels";

/** Every registry `get_registries` can fetch, in output-field order. */
export const homeAssistantRegistryNames: HomeAssistantRegistryName[] = [
  "entities",
  "devices",
  "areas",
  "floors",
  "labels",
];

const registryNames: string[] = homeAssistantRegistryNames;

// Home Assistant's search ItemType enum; the values it accepts as a search origin.
const searchItemTypes: string[] = [
  "area",
  "automation",
  "automation_blueprint",
  "config_entry",
  "device",
  "entity",
  "floor",
  "group",
  "integration",
  "label",
  "person",
  "scene",
  "script",
  "script_blueprint",
];

// The recorder statistics vocabulary: the kinds of statistic a sensor produces,
// the bucket sizes the recorder can aggregate into, and the value columns a row
// can carry. Which columns are populated depends on the statistic kind, so a
// mean statistic has no sum and a sum statistic has no mean.
const statisticTypes: string[] = ["mean", "sum"];
const statisticPeriods: string[] = ["5minute", "hour", "day", "week", "month", "year"];
const statisticValueTypes: string[] = ["change", "last_reset", "max", "mean", "min", "state", "sum"];

const statisticRowSchema = s.looseObject(
  "One aggregated Home Assistant statistics row. Start and end are Unix timestamps in milliseconds.",
  {
    start: s.number("The bucket start as a Unix timestamp in milliseconds."),
    end: s.number("The bucket end as a Unix timestamp in milliseconds."),
  },
);

// The registry write commands share four traits worth stating on every action
// that has them: they need an admin token, they replace list fields instead of
// merging them, they store references to areas, floors, and labels without
// checking that those exist, and Home Assistant reports an unknown target id
// from most of them as a bare unknown error rather than a not-found.
const registryAdminNote = "Requires an admin access token.";
const registryReplaceNote = "List fields replace the stored list rather than adding to it, so send the full list.";
const registryDanglingNote =
  "Home Assistant stores this reference without checking that it exists, so create the target first and verify it.";
const registryUnknownIdNote = "An id that does not exist is reported as an unknown Home Assistant error.";
const registryNameNote =
  "Names are unique once case and spaces are ignored, so Living Room and livingroom collide and the second one is rejected.";
const registryGeneratedIdNote =
  "Home Assistant generates the id from the name, so read it from this result rather than guessing it.";
// Home Assistant validates the colour against a closed set: its theme colour
// names, or a hex code. Anything else is rejected with a message that only
// mentions the hex form, so the names are spelled out here.
const labelColorNote =
  "This is either a #RRGGBB hex code or one of the theme colour names: primary, accent, disabled, red, pink, purple, deep-purple, indigo, blue, light-blue, cyan, teal, green, light-green, lime, yellow, amber, orange, deep-orange, brown, light-grey, grey, dark-grey, blue-grey, black, white.";

// Every Lovelace write command is admin-gated, and dashboards defined in YAML
// reject them outright because their configuration lives in a file Home
// Assistant does not manage.
const lovelaceAdminNote =
  "Requires an admin access token, and only works on dashboards Home Assistant stores itself; a dashboard defined in YAML is rejected.";
const lovelaceDefaultDashboardNote =
  "Omit the url path to target the default dashboard, which is the one served at /lovelace.";

const lovelaceResourceTypes: string[] = ["css", "html", "js", "module"];

const lovelaceUrlPathSchema = s.nonEmptyString(
  "The url path of the dashboard, as listed by list_lovelace_dashboards. Omit it for the default dashboard.",
);
const lovelaceDashboardIdSchema = s.nonEmptyString(
  "The dashboard id, as returned by list_lovelace_dashboards or create_lovelace_dashboard. This is not the url path: Home Assistant slugifies the url path with underscores to build it.",
);

function registryListSchema(description: string): JsonSchema {
  return s.nullable(s.array(description, s.looseObject("One Home Assistant registry entry.")));
}

// The editable config store reached through /api/config/<component>/config/<key>.
// Every domain there takes an admin token and only covers entries Home Assistant
// itself manages (automations.yaml, scripts.yaml, scenes.yaml); entries defined
// in other YAML files are not visible to it.
const configAdminNote =
  "Requires an admin access token, and only covers entries stored in the Home Assistant UI-editable config; entries defined in other YAML files return not found.";

const configWriteResultSchema = s.actionOutput(
  { result: s.string("The Home Assistant result status, normally ok.") },
  "The Home Assistant config write result.",
);

function configKeyInput(field: string, description: string): JsonSchema {
  return s.actionInput({ [field]: s.nonEmptyString(description) }, [field], "Input parameters for one config entry.");
}

function configSaveInput(field: string, description: string, configDescription: string): JsonSchema {
  return s.actionInput(
    {
      [field]: s.nonEmptyString(description),
      config: s.looseObject(configDescription),
    },
    [field, "config"],
    "Input parameters for saving one config entry.",
  );
}

function configReadOutput(description: string): JsonSchema {
  return s.actionOutput({ config: s.looseObject(description) }, "The stored Home Assistant configuration entry.");
}

export const homeAssistantActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "get_config",
    description: "Fetch the Home Assistant instance configuration.",
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      { config: s.looseObject("The Home Assistant configuration object.") },
      "The Home Assistant configuration response.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_states",
    description: "List all current Home Assistant entity states.",
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      { states: s.array("The Home Assistant state objects.", stateSchema) },
      "The current Home Assistant entity states.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_state",
    description: "Fetch the current state for one Home Assistant entity.",
    inputSchema: entityInputSchema,
    outputSchema: s.actionOutput({ state: stateSchema }, "The selected Home Assistant entity state."),
  }),
  defineProviderAction(service, {
    name: "list_services",
    description: "List Home Assistant service domains and their available services.",
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      {
        services: s.array(
          "The Home Assistant service domains returned by the instance.",
          s.looseObject("One Home Assistant service domain entry."),
        ),
      },
      "The Home Assistant service catalog.",
    ),
  }),
  defineProviderAction(service, {
    name: "call_service",
    description: "Call a Home Assistant service to control entities, such as light.turn_on or switch.turn_off.",
    inputSchema: s.actionInput(
      {
        domain: s.nonEmptyString("The Home Assistant service domain, for example light or switch."),
        service: s.nonEmptyString("The Home Assistant service name, for example turn_on or turn_off."),
        serviceData: s.looseObject(
          "The JSON service data sent directly to Home Assistant, such as entity_id or brightness.",
        ),
        returnResponse: s.boolean("Whether to request service response data with the return_response query parameter."),
      },
      ["domain", "service"],
      "Input parameters for calling one Home Assistant service.",
    ),
    outputSchema: s.actionOutput(
      {
        changedStates: s.array("The Home Assistant states changed by the service call.", stateSchema),
        serviceResponse: s.nullable(s.looseObject("The optional Home Assistant service response object.")),
      },
      "The normalized Home Assistant service call response.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_events",
    description: "List Home Assistant event types currently known by the instance.",
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      {
        events: s.array(
          "The Home Assistant event type entries returned by the instance.",
          s.looseObject("One Home Assistant event type entry."),
        ),
      },
      "The Home Assistant event type catalog.",
    ),
  }),
  defineProviderAction(service, {
    name: "fire_event",
    description: "Fire one Home Assistant event with optional event data.",
    inputSchema: s.actionInput(
      {
        eventType: s.nonEmptyString("The Home Assistant event type to fire."),
        eventData: s.looseObject("The optional JSON event data sent to Home Assistant."),
      },
      ["eventType"],
      "Input parameters for firing one Home Assistant event.",
    ),
    outputSchema: s.actionOutput(
      { response: s.looseObject("The JSON response returned by Home Assistant after firing the event.") },
      "The Home Assistant fire-event response.",
    ),
  }),
  defineProviderAction(service, {
    name: "render_template",
    description: "Render a Home Assistant template against the connected instance.",
    inputSchema: s.actionInput(
      {
        template: s.nonEmptyString("The Home Assistant template string to render."),
        variables: s.looseObject("Optional template variables passed to Home Assistant."),
      },
      ["template"],
      "Input parameters for rendering one Home Assistant template.",
    ),
    outputSchema: s.actionOutput(
      { result: s.string("The rendered template text returned by Home Assistant.") },
      "The rendered Home Assistant template response.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_history",
    description:
      "Fetch recorded state history for one or more Home Assistant entities over a time period, for answering questions about how a value changed.",
    followUpActions: ["home_assistant.get_logbook"],
    inputSchema: s.actionInput(
      {
        entityIds: s.array(
          "The entity ids to fetch history for. Home Assistant requires at least one.",
          s.nonEmptyString("One Home Assistant entity identifier."),
          { minItems: 1 },
        ),
        startTime: s.dateTime("The start of the period. Defaults to one day before now when omitted."),
        endTime: s.dateTime("The end of the period. Defaults to one day after the start time."),
        minimalResponse: s.boolean(
          "Return only state changes without full attribute payloads, which greatly reduces response size.",
        ),
        noAttributes: s.boolean("Omit entity attributes from the response."),
        skipInitialState: s.boolean("Omit the state that was already active at the start of the period."),
        significantChangesOnly: s.boolean(
          "Return only significant state changes. Home Assistant defaults this to true.",
        ),
      },
      ["entityIds"],
      "Input parameters for one Home Assistant history query.",
    ),
    outputSchema: s.actionOutput(
      {
        history: s.array(
          "One list of state objects per requested entity, in the order Home Assistant returns them.",
          s.array("The recorded states for one entity.", historyStateSchema),
        ),
      },
      "The recorded Home Assistant state history.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_logbook",
    description:
      "Fetch the Home Assistant logbook: the human-readable timeline of what happened and what triggered it, for diagnosing why something changed.",
    inputSchema: s.actionInput(
      {
        startTime: s.dateTime("The start of the period. Defaults to one day before now when omitted."),
        endTime: s.dateTime("The end of the period."),
        entityIds: s.array(
          "Optional entity ids to restrict the logbook to.",
          s.nonEmptyString("One Home Assistant entity identifier."),
        ),
        period: s.positiveInteger("The number of days to cover, used when no end time is given."),
        contextId: s.nonEmptyString(
          "Optional Home Assistant context id, to list only the entries produced by one action.",
        ),
      },
      [],
      "Input parameters for one Home Assistant logbook query.",
    ),
    outputSchema: s.actionOutput(
      {
        entries: s.array("The logbook entries.", s.looseObject("One Home Assistant logbook entry.")),
      },
      "The Home Assistant logbook entries for the requested period.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_calendars",
    description: "List the calendar entities exposed by Home Assistant.",
    followUpActions: ["home_assistant.list_calendar_events"],
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      {
        calendars: s.array(
          "The Home Assistant calendar entities.",
          s.looseRequiredObject(
            "One Home Assistant calendar entity.",
            {
              entity_id: s.string("The calendar entity identifier."),
              name: s.string("The calendar display name."),
            },
            { optional: ["name"] },
          ),
        ),
      },
      "The Home Assistant calendar entities.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_calendar_events",
    description: "List the events on one Home Assistant calendar between a start and end time.",
    inputSchema: s.actionInput(
      {
        entityId: s.nonEmptyString("The calendar entity identifier, for example calendar.personal."),
        start: s.dateTime("The inclusive start of the window."),
        end: s.dateTime("The exclusive end of the window, which must be after the start."),
      },
      ["entityId", "start", "end"],
      "Input parameters for one Home Assistant calendar event query.",
    ),
    outputSchema: s.actionOutput(
      {
        events: s.array(
          "The calendar events in the requested window.",
          s.looseObject(
            "One Home Assistant calendar event. Start and end are objects holding either dateTime or date.",
          ),
        ),
      },
      "The Home Assistant calendar events.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_error_log",
    description:
      "Fetch the Home Assistant error log for the current session as plain text. Home Assistant serves this only when the instance runs with file logging enabled, so it can report not found on an otherwise healthy instance.",
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      { log: s.string("The plain-text Home Assistant error log.") },
      "The Home Assistant error log.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_registries",
    description:
      "List the Home Assistant entity, device, area, floor, and label registries in one call. These registries expose the device and room structure behind entity ids, which the REST API does not serve.",
    inputSchema: s.actionInput(
      {
        include: s.array(
          "The registries to fetch. Defaults to all five when omitted or empty.",
          s.stringEnum("One Home Assistant registry name.", registryNames),
        ),
      },
      [],
      "Input parameters for selecting which Home Assistant registries to fetch.",
    ),
    outputSchema: s.actionOutput(
      {
        entities: registryListSchema(
          "The entity registry entries, including the device and area each entity belongs to.",
        ),
        devices: registryListSchema("The device registry entries, including manufacturer, model, and area."),
        areas: registryListSchema("The area registry entries."),
        floors: registryListSchema("The floor registry entries."),
        labels: registryListSchema("The label registry entries."),
      },
      "The requested Home Assistant registries. Registries excluded from the request are null.",
    ),
  }),
  defineProviderAction(service, {
    name: "search_related",
    description:
      "Find the Home Assistant items related to one entity, device, area, automation, or config entry, such as the automations that reference a given light.",
    inputSchema: s.actionInput(
      {
        itemType: s.stringEnum("The Home Assistant item type to search from.", searchItemTypes),
        itemId: s.nonEmptyString(
          "The identifier of the item to search from, for example light.living_room for an entity.",
        ),
      },
      ["itemType", "itemId"],
      "Input parameters for one Home Assistant related-items search.",
    ),
    outputSchema: s.actionOutput(
      {
        related: s.looseObject("The related Home Assistant item identifiers, keyed by item type."),
      },
      "The Home Assistant items related to the requested item.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_device_automations",
    description:
      "List the triggers, conditions, and actions one Home Assistant device supports, for building automations against that device.",
    followUpActions: ["home_assistant.validate_config"],
    inputSchema: s.actionInput(
      {
        deviceId: s.nonEmptyString("The Home Assistant device registry identifier."),
      },
      ["deviceId"],
      "Input parameters for listing one Home Assistant device's automation capabilities.",
    ),
    outputSchema: s.actionOutput(
      {
        triggers: s.array("The device triggers.", s.looseObject("One Home Assistant device trigger.")),
        conditions: s.array("The device conditions.", s.looseObject("One Home Assistant device condition.")),
        actions: s.array("The device actions.", s.looseObject("One Home Assistant device action.")),
      },
      "The automation capabilities for the requested Home Assistant device.",
    ),
  }),
  defineProviderAction(service, {
    name: "execute_script",
    description:
      "Run a Home Assistant script sequence, which can chain several service calls, delays, and conditions in one request instead of one service call at a time.",
    inputSchema: s.actionInput(
      {
        sequence: s.array(
          "The Home Assistant script steps to run, in the same format as a script's sequence.",
          s.looseObject("One Home Assistant script step."),
        ),
        variables: s.looseObject("Optional variables made available to the script sequence."),
      },
      ["sequence"],
      "Input parameters for running one Home Assistant script sequence.",
    ),
    outputSchema: s.actionOutput(
      {
        context: s.nullable(s.looseObject("The Home Assistant context for the script run.")),
        response: s.nullable(s.looseObject("The optional script response variable returned by Home Assistant.")),
      },
      "The Home Assistant script execution result.",
    ),
  }),
  defineProviderAction(service, {
    name: "validate_config",
    description:
      "Validate Home Assistant trigger, condition, and action configurations before storing them in an automation.",
    followUpActions: ["home_assistant.save_automation_config", "home_assistant.save_script_config"],
    inputSchema: s.actionInput(
      {
        triggers: s.array("The trigger configurations to validate.", s.looseObject("One Home Assistant trigger.")),
        conditions: s.array(
          "The condition configurations to validate.",
          s.looseObject("One Home Assistant condition."),
        ),
        actions: s.array("The action configurations to validate.", s.looseObject("One Home Assistant action.")),
      },
      [],
      "Input parameters for validating Home Assistant automation configuration. At least one list is required.",
    ),
    outputSchema: s.actionOutput(
      {
        validation: s.looseObject(
          "The validation result keyed by triggers, conditions, and actions, each with valid and error fields.",
        ),
      },
      "The Home Assistant configuration validation result.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_automation_config",
    description: `Fetch the stored configuration for one Home Assistant automation. ${configAdminNote}`,
    followUpActions: ["home_assistant.save_automation_config"],
    inputSchema: configKeyInput("automationId", "The automation id, which is the id field inside the automation."),
    outputSchema: configReadOutput("The stored automation configuration."),
  }),
  defineProviderAction(service, {
    name: "save_automation_config",
    description: `Create or replace one Home Assistant automation. Posting to an unused id creates the automation. ${configAdminNote}`,
    followUpActions: ["home_assistant.get_automation_config", "home_assistant.get_logbook"],
    inputSchema: configSaveInput(
      "automationId",
      "The automation id to create or replace.",
      "The automation configuration, with the same keys as an automations.yaml entry such as alias, triggers, conditions, actions, and mode.",
    ),
    outputSchema: configWriteResultSchema,
  }),
  defineProviderAction(service, {
    name: "delete_automation_config",
    description: `Delete one Home Assistant automation. ${configAdminNote}`,
    inputSchema: configKeyInput("automationId", "The automation id to delete."),
    outputSchema: configWriteResultSchema,
  }),
  defineProviderAction(service, {
    name: "get_script_config",
    description: `Fetch the stored configuration for one Home Assistant script. ${configAdminNote}`,
    followUpActions: ["home_assistant.save_script_config"],
    inputSchema: configKeyInput("scriptKey", "The script key, the slug after script. in the entity id."),
    outputSchema: configReadOutput("The stored script configuration."),
  }),
  defineProviderAction(service, {
    name: "save_script_config",
    description: `Create or replace one Home Assistant script. Posting to an unused key creates the script. ${configAdminNote}`,
    followUpActions: ["home_assistant.get_script_config"],
    inputSchema: configSaveInput(
      "scriptKey",
      "The script key to create or replace, which must be a slug of lowercase letters, digits, and underscores.",
      "The script configuration, with the same keys as a scripts.yaml entry such as alias, sequence, and mode.",
    ),
    outputSchema: configWriteResultSchema,
  }),
  defineProviderAction(service, {
    name: "delete_script_config",
    description: `Delete one Home Assistant script. ${configAdminNote}`,
    inputSchema: configKeyInput("scriptKey", "The script key to delete."),
    outputSchema: configWriteResultSchema,
  }),
  defineProviderAction(service, {
    name: "get_scene_config",
    description: `Fetch the stored configuration for one Home Assistant scene. ${configAdminNote}`,
    followUpActions: ["home_assistant.save_scene_config"],
    inputSchema: configKeyInput("sceneId", "The scene id, which is the id field inside the scene."),
    outputSchema: configReadOutput("The stored scene configuration."),
  }),
  defineProviderAction(service, {
    name: "save_scene_config",
    description: `Create or replace one Home Assistant scene. Posting to an unused id creates the scene. ${configAdminNote}`,
    followUpActions: ["home_assistant.get_scene_config"],
    inputSchema: configSaveInput(
      "sceneId",
      "The scene id to create or replace.",
      "The scene configuration, with the same keys as a scenes.yaml entry such as name and entities.",
    ),
    outputSchema: configWriteResultSchema,
  }),
  defineProviderAction(service, {
    name: "delete_scene_config",
    description: `Delete one Home Assistant scene. ${configAdminNote}`,
    inputSchema: configKeyInput("sceneId", "The scene id to delete."),
    outputSchema: configWriteResultSchema,
  }),
  defineProviderAction(service, {
    name: "list_statistic_ids",
    description:
      "List the long-term statistics Home Assistant records, with the unit and whether each one is a mean or a sum. Long-term statistics are kept far longer than the state history, so this is where multi-week energy, power, and temperature trends live.",
    followUpActions: ["home_assistant.get_statistics"],
    inputSchema: s.actionInput(
      {
        statisticType: s.stringEnum(
          "Only list statistics of this kind. Omit to list every recorded statistic.",
          statisticTypes,
        ),
      },
      [],
      "Input parameters for listing Home Assistant statistic ids.",
    ),
    outputSchema: s.actionOutput(
      {
        statisticIds: s.array(
          "The recorded statistics, each with its statistic_id, source, units, and whether it carries a sum. Read mean_type, an integer where 0 is none, 1 arithmetic, and 2 circular, rather than the deprecated has_mean flag.",
          s.looseObject("One Home Assistant statistic metadata entry."),
        ),
      },
      "The Home Assistant long-term statistics catalog.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_statistics_metadata",
    description:
      "Fetch the recording metadata for specific long-term statistics, including the unit the values are stored in and whether the statistic carries mean or sum values.",
    followUpActions: ["home_assistant.get_statistics"],
    inputSchema: s.actionInput(
      {
        statisticIds: s.array(
          "The statistic ids to describe. Omit to describe every recorded statistic.",
          s.nonEmptyString("One Home Assistant statistic id, usually the entity id it is recorded for."),
        ),
      },
      [],
      "Input parameters for one Home Assistant statistics metadata query.",
    ),
    outputSchema: s.actionOutput(
      {
        metadata: s.array(
          "The statistics metadata entries.",
          s.looseObject("One Home Assistant statistic metadata entry."),
        ),
      },
      "The Home Assistant statistics metadata.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_statistics",
    description:
      "Fetch aggregated long-term statistics for one or more statistic ids, bucketed by five minutes, hour, day, week, month, or year. Prefer this over get_history for questions spanning more than a day or two: the recorder keeps only a few days of raw states but keeps these aggregates for years. Which value columns a row carries depends on the statistic: a sum statistic such as an energy meter returns state, sum, and change, while a mean statistic such as a temperature returns mean, min, and max.",
    inputSchema: s.actionInput(
      {
        statisticIds: s.array(
          "The statistic ids to fetch, as returned by list_statistic_ids. Ids that are not recorded are omitted from the result rather than reported as an error.",
          s.nonEmptyString("One Home Assistant statistic id."),
          { minItems: 1 },
        ),
        startTime: s.dateTime(
          "The inclusive start of the period. Include an explicit UTC offset or Z: Home Assistant reads a timestamp without one in its own local time zone.",
        ),
        endTime: s.dateTime(
          "The exclusive end of the period. Omitting this returns everything recorded since the start time, with no upper bound, which can be an enormous payload on a long-lived instance.",
        ),
        period: s.stringEnum(
          "The bucket size the statistics are aggregated into. For day, week, month, and year Home Assistant snaps the window outwards to local calendar boundaries, so the first and last buckets can fall outside the requested range.",
          statisticPeriods,
        ),
        types: s.array(
          "The value types to return. Home Assistant returns every type the statistic supports when omitted, and returns only start and end for an explicitly empty list.",
          s.stringEnum("One Home Assistant statistic value type.", statisticValueTypes),
        ),
        units: s.looseObject(
          "Optional unit conversion, keyed by unit class such as energy, power, temperature, or volume, with the unit to convert to as the value. Without this, values come back in the entity's current display unit, so the same query can change magnitude after a user changes that unit.",
        ),
      },
      ["statisticIds", "startTime", "period"],
      "Input parameters for one Home Assistant long-term statistics query.",
    ),
    outputSchema: s.actionOutput(
      {
        statistics: s.record(
          s.array("The statistic rows for one statistic id, ordered by start time.", statisticRowSchema),
          {
            description: "The statistics rows keyed by statistic id. A statistic with no data in the period is absent.",
          },
        ),
      },
      "The Home Assistant long-term statistics for the requested period.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_entity_registry_entry",
    description:
      "Fetch the registry entry for one entity, which is the editable layer over it: its name override, icon, area, labels, voice aliases, and per-integration options. Read this before update_entity_registry_entry, because the list and options fields are replaced wholesale rather than merged.",
    followUpActions: ["home_assistant.update_entity_registry_entry"],
    inputSchema: entityInputSchema,
    outputSchema: s.actionOutput(
      { entry: s.looseObject("The entity registry entry.") },
      "The Home Assistant entity registry entry.",
    ),
  }),
  defineProviderAction(service, {
    name: "update_entity_registry_entry",
    description: `Update the editable registry fields of one entity: its displayed name, icon, area, labels, voice aliases, device class, and per-integration options. Fields left out keep their current values, and null resets a field to the integration default. ${registryReplaceNote} ${registryAdminNote} This cannot rename the entity id, enable, or disable an entity.`,
    followUpActions: ["home_assistant.get_entity_registry_entry"],
    inputSchema: s.actionInput(
      {
        entityId: s.nonEmptyString("The entity to update, for example light.living_room."),
        name: s.nullableString("The displayed name, or null to fall back to the integration's own name."),
        icon: s.nullableString("The icon, for example mdi:lamp, or null to fall back to the default icon."),
        areaId: s.nullableString(
          `The area to place the entity in, or null to remove it from its area. ${registryDanglingNote}`,
        ),
        deviceClass: s.nullableString(
          "The device class override, for example temperature, or null to fall back to the integration's own device class.",
        ),
        hiddenBy: s.nullable(
          s.stringEnum(
            "Set to user to hide the entity from the dashboards and voice assistants, or null to unhide it. Hiding keeps the entity recording, unlike disabling it.",
            ["user"],
          ),
        ),
        aliases: s.array(
          `The complete list of voice assistant aliases, replacing the stored list. Send an empty list to clear them. ${registryReplaceNote}`,
          s.nonEmptyString("One alias for the entity."),
        ),
        labels: s.array(
          `The complete list of label ids, replacing the stored list. Send an empty list to clear them. ${registryDanglingNote}`,
          s.nonEmptyString("One label id."),
        ),
        optionsDomain: s.nonEmptyString(
          "The integration domain the options belong to, for example sensor. Required when options is sent.",
        ),
        options: s.nullable(
          s.looseObject(
            "The complete options object for that domain, such as display_precision for a sensor, replacing everything stored for the domain. Null removes the domain's options. Required when optionsDomain is sent.",
          ),
        ),
      },
      ["entityId"],
      "Input parameters for updating one Home Assistant entity registry entry. At least one changed field is required.",
    ),
    outputSchema: s.actionOutput(
      { entry: s.looseObject("The updated entity registry entry.") },
      "The updated Home Assistant entity registry entry.",
    ),
  }),
  defineProviderAction(service, {
    name: "update_device_registry_entry",
    description: `Update the editable registry fields of one device: the name shown to users, its area, and its labels. Moving a device to an area is what gives its entities an area, so prefer this over updating each entity. ${registryAdminNote} ${registryUnknownIdNote}`,
    inputSchema: s.actionInput(
      {
        deviceId: s.nonEmptyString("The device registry id, as returned by get_registries."),
        nameByUser: s.nullableString(
          "The name shown to users, or null to fall back to the name the integration reports. The integration's own name cannot be changed.",
        ),
        areaId: s.nullableString(
          `The area to place the device in, or null to remove it from its area. ${registryDanglingNote}`,
        ),
        labels: s.array(
          `The complete list of label ids, replacing the stored list. Send an empty list to clear them. ${registryDanglingNote}`,
          s.nonEmptyString("One label id."),
        ),
      },
      ["deviceId"],
      "Input parameters for updating one Home Assistant device registry entry. At least one changed field is required.",
    ),
    outputSchema: s.actionOutput(
      { entry: s.looseObject("The updated device registry entry.") },
      "The updated Home Assistant device registry entry.",
    ),
  }),
  defineProviderAction(service, {
    name: "create_area",
    description: `Create one area, which is how Home Assistant groups devices and entities by room. ${registryNameNote} ${registryAdminNote}`,
    followUpActions: ["home_assistant.update_device_registry_entry"],
    inputSchema: s.actionInput(
      {
        name: s.nonEmptyString("The area name, for example Living Room."),
        floorId: s.nonEmptyString(`The floor the area belongs to. ${registryDanglingNote}`),
        icon: s.nonEmptyString("The area icon, for example mdi:sofa."),
        picture: s.nullableString("A url to a picture representing the area."),
        aliases: s.array("Voice assistant aliases for the area.", s.nonEmptyString("One alias for the area.")),
        labels: s.array(`The label ids to attach. ${registryDanglingNote}`, s.nonEmptyString("One label id.")),
        temperatureEntityId: s.nullableString("The entity whose reading represents the area temperature."),
        humidityEntityId: s.nullableString("The entity whose reading represents the area humidity."),
      },
      ["name"],
      "Input parameters for creating one Home Assistant area.",
    ),
    outputSchema: s.actionOutput(
      { entry: s.looseObject(`The created area. ${registryGeneratedIdNote}`) },
      "The created Home Assistant area.",
    ),
  }),
  defineProviderAction(service, {
    name: "update_area",
    description: `Update one area's name, floor, icon, aliases, labels, or the entities that report its temperature and humidity. Fields left out keep their current values. ${registryNameNote} ${registryAdminNote} ${registryUnknownIdNote}`,
    inputSchema: s.actionInput(
      {
        areaId: s.nonEmptyString("The area id, as returned by get_registries. Renaming an area does not change it."),
        name: s.nonEmptyString("The new area name."),
        floorId: s.nullableString(
          `The floor the area belongs to, or null to detach it from its floor. ${registryDanglingNote}`,
        ),
        icon: s.nullableString("The area icon, or null to remove it."),
        picture: s.nullableString("A url to a picture representing the area, or null to remove it."),
        aliases: s.array(
          `The complete list of voice assistant aliases, replacing the stored list. ${registryReplaceNote}`,
          s.nonEmptyString("One alias for the area."),
        ),
        labels: s.array(
          `The complete list of label ids, replacing the stored list. ${registryDanglingNote}`,
          s.nonEmptyString("One label id."),
        ),
        temperatureEntityId: s.nullableString(
          "The entity whose reading represents the area temperature, or null to unset it.",
        ),
        humidityEntityId: s.nullableString(
          "The entity whose reading represents the area humidity, or null to unset it.",
        ),
      },
      ["areaId"],
      "Input parameters for updating one Home Assistant area. At least one changed field is required.",
    ),
    outputSchema: s.actionOutput({ entry: s.looseObject("The updated area.") }, "The updated Home Assistant area."),
  }),
  defineProviderAction(service, {
    name: "create_floor",
    description: `Create one floor, which groups areas into storeys of the building. ${registryNameNote} ${registryAdminNote}`,
    followUpActions: ["home_assistant.update_area"],
    inputSchema: s.actionInput(
      {
        name: s.nonEmptyString("The floor name, for example Ground Floor."),
        level: s.nullableInteger("The storey number, where 0 is the ground floor and negative numbers are basements."),
        icon: s.nullableString("The floor icon, for example mdi:home-floor-g."),
        aliases: s.array("Voice assistant aliases for the floor.", s.nonEmptyString("One alias for the floor.")),
      },
      ["name"],
      "Input parameters for creating one Home Assistant floor.",
    ),
    outputSchema: s.actionOutput(
      { entry: s.looseObject(`The created floor. ${registryGeneratedIdNote}`) },
      "The created Home Assistant floor.",
    ),
  }),
  defineProviderAction(service, {
    name: "update_floor",
    description: `Update one floor's name, storey level, icon, or aliases. Fields left out keep their current values. ${registryNameNote} ${registryAdminNote} ${registryUnknownIdNote}`,
    inputSchema: s.actionInput(
      {
        floorId: s.nonEmptyString("The floor id, as returned by get_registries."),
        name: s.nonEmptyString("The new floor name."),
        level: s.nullableInteger("The storey number, or null to unset it."),
        icon: s.nullableString("The floor icon, or null to remove it."),
        aliases: s.array(
          `The complete list of voice assistant aliases, replacing the stored list. ${registryReplaceNote}`,
          s.nonEmptyString("One alias for the floor."),
        ),
      },
      ["floorId"],
      "Input parameters for updating one Home Assistant floor. At least one changed field is required.",
    ),
    outputSchema: s.actionOutput({ entry: s.looseObject("The updated floor.") }, "The updated Home Assistant floor."),
  }),
  defineProviderAction(service, {
    name: "create_label",
    description: `Create one label. Labels cut across areas and devices, and service calls can target every entity carrying one, which makes them the way to build ad hoc groups. ${registryNameNote} ${registryAdminNote}`,
    followUpActions: ["home_assistant.update_entity_registry_entry"],
    inputSchema: s.actionInput(
      {
        name: s.nonEmptyString("The label name."),
        color: s.nullableString(`The label colour shown in the interface. ${labelColorNote}`),
        description: s.nullableString("What the label is for."),
        icon: s.nullableString("The label icon, for example mdi:tag."),
      },
      ["name"],
      "Input parameters for creating one Home Assistant label.",
    ),
    outputSchema: s.actionOutput(
      { entry: s.looseObject(`The created label. ${registryGeneratedIdNote}`) },
      "The created Home Assistant label.",
    ),
  }),
  defineProviderAction(service, {
    name: "update_label",
    description: `Update one label's name, colour, description, or icon. Fields left out keep their current values. ${registryNameNote} ${registryAdminNote} ${registryUnknownIdNote}`,
    inputSchema: s.actionInput(
      {
        labelId: s.nonEmptyString("The label id, as returned by get_registries."),
        name: s.nonEmptyString("The new label name."),
        color: s.nullableString(`The label colour, or null to remove it. ${labelColorNote}`),
        description: s.nullableString("What the label is for, or null to remove the description."),
        icon: s.nullableString("The label icon, or null to remove it."),
      },
      ["labelId"],
      "Input parameters for updating one Home Assistant label. At least one changed field is required.",
    ),
    outputSchema: s.actionOutput({ entry: s.looseObject("The updated label.") }, "The updated Home Assistant label."),
  }),
  defineProviderAction(service, {
    name: "get_lovelace_config",
    description: `Fetch the stored configuration of one Lovelace dashboard, which holds its views, cards, and their options. ${lovelaceDefaultDashboardNote} A dashboard rendered by a strategy, including the auto-generated default one, has no stored configuration until something saves one.`,
    followUpActions: ["home_assistant.save_lovelace_config"],
    inputSchema: s.actionInput(
      {
        urlPath: lovelaceUrlPathSchema,
        force: s.boolean("Bypass the cached configuration and reread it from storage."),
      },
      [],
      "Input parameters for reading one Home Assistant dashboard configuration.",
    ),
    outputSchema: s.actionOutput(
      { config: s.looseObject("The stored dashboard configuration, normally with a views list.") },
      "The stored Home Assistant dashboard configuration.",
    ),
  }),
  defineProviderAction(service, {
    name: "save_lovelace_config",
    description: `Replace the stored configuration of one Lovelace dashboard. This overwrites the whole document rather than merging, so read the current configuration with get_lovelace_config, change what is needed, and send the complete result back. Everything omitted is lost. ${lovelaceAdminNote} ${lovelaceDefaultDashboardNote}`,
    followUpActions: ["home_assistant.get_lovelace_config"],
    inputSchema: s.actionInput(
      {
        urlPath: lovelaceUrlPathSchema,
        config: s.looseObject("The complete dashboard configuration to store, normally with a views list."),
      },
      ["config"],
      "Input parameters for replacing one Home Assistant dashboard configuration.",
    ),
    outputSchema: s.actionOutput(
      { saved: s.literal(true, { description: "Whether Home Assistant stored the dashboard configuration." }) },
      "The Home Assistant dashboard save result.",
    ),
  }),
  defineProviderAction(service, {
    name: "delete_lovelace_config",
    description: `Delete the stored configuration of one Lovelace dashboard, which reverts it to the automatically generated view. The dashboard itself stays in the sidebar; use delete_lovelace_dashboard to remove it entirely. ${lovelaceAdminNote} ${lovelaceDefaultDashboardNote}`,
    inputSchema: s.actionInput(
      { urlPath: lovelaceUrlPathSchema },
      [],
      "Input parameters for deleting one Home Assistant dashboard configuration.",
    ),
    outputSchema: s.actionOutput(
      { deleted: s.literal(true, { description: "Whether Home Assistant deleted the dashboard configuration." }) },
      "The Home Assistant dashboard configuration delete result.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_lovelace_dashboards",
    description:
      "List the Lovelace dashboards registered on the instance. Entries defined in YAML carry a filename and no id; only entries with an id can be updated, deleted, or given a stored configuration.",
    followUpActions: ["home_assistant.get_lovelace_config"],
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      {
        dashboards: s.array(
          "The registered dashboards, each with its url_path, title, mode, and, for editable ones, its id.",
          s.looseObject("One Home Assistant dashboard entry."),
        ),
      },
      "The Home Assistant Lovelace dashboards.",
    ),
  }),
  defineProviderAction(service, {
    name: "create_lovelace_dashboard",
    description: `Create one Lovelace dashboard and add it to the sidebar. It starts with no stored configuration, so follow up with save_lovelace_config to give it views. ${lovelaceAdminNote}`,
    followUpActions: ["home_assistant.save_lovelace_config"],
    inputSchema: s.actionInput(
      {
        urlPath: s.nonEmptyString(
          "The url path the dashboard is served at, which must contain a hyphen, for example energy-detail.",
        ),
        title: s.nonEmptyString("The dashboard title shown in the sidebar."),
        icon: s.nonEmptyString("The optional sidebar icon, for example mdi:home."),
        showInSidebar: s.boolean("Whether the dashboard appears in the sidebar. Home Assistant defaults this to true."),
        requireAdmin: s.boolean("Whether only admin users may open the dashboard."),
      },
      ["urlPath", "title"],
      "Input parameters for creating one Home Assistant dashboard.",
    ),
    outputSchema: s.actionOutput(
      {
        dashboard: s.looseObject(
          "The created dashboard entry. Its id is a slugified form of the url path with underscores, and is what the update and delete actions take.",
        ),
      },
      "The created Home Assistant dashboard.",
    ),
  }),
  defineProviderAction(service, {
    name: "update_lovelace_dashboard",
    description: `Update the sidebar presentation of one Lovelace dashboard. Fields left out keep their current values, and a null icon removes the icon. This does not touch the dashboard's views; use save_lovelace_config for those. ${lovelaceAdminNote}`,
    inputSchema: s.actionInput(
      {
        dashboardId: lovelaceDashboardIdSchema,
        title: s.nonEmptyString("The new dashboard title."),
        icon: s.nullableString("The new sidebar icon, or null to remove the current one."),
        showInSidebar: s.boolean("Whether the dashboard appears in the sidebar."),
        requireAdmin: s.boolean("Whether only admin users may open the dashboard."),
      },
      ["dashboardId"],
      "Input parameters for updating one Home Assistant dashboard. At least one changed field is required.",
    ),
    outputSchema: s.actionOutput(
      { dashboard: s.looseObject("The updated dashboard entry.") },
      "The updated Home Assistant dashboard.",
    ),
  }),
  defineProviderAction(service, {
    name: "delete_lovelace_dashboard",
    description: `Delete one Lovelace dashboard together with its stored views. This is not reversible, and the views are not recoverable from Home Assistant afterwards, so read them with get_lovelace_config first if they may be needed. ${lovelaceAdminNote}`,
    inputSchema: s.actionInput(
      { dashboardId: lovelaceDashboardIdSchema },
      ["dashboardId"],
      "Input parameters for deleting one Home Assistant dashboard.",
    ),
    outputSchema: s.actionOutput(
      { deleted: s.literal(true, { description: "Whether Home Assistant deleted the dashboard." }) },
      "The Home Assistant dashboard delete result.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_lovelace_resources",
    description:
      "List the frontend resources Home Assistant loads for dashboards, which is how custom cards are registered.",
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      {
        resources: s.array(
          "The registered frontend resources, each with its id, url, and type.",
          s.looseObject("One Home Assistant frontend resource."),
        ),
      },
      "The Home Assistant frontend resources.",
    ),
  }),
  defineProviderAction(service, {
    name: "create_lovelace_resource",
    description: `Register one frontend resource so dashboards can use the custom cards it defines. The file has to already be reachable from Home Assistant, normally under /local. ${lovelaceAdminNote}`,
    inputSchema: s.actionInput(
      {
        resourceType: s.stringEnum("How the frontend loads the resource.", lovelaceResourceTypes),
        url: s.nonEmptyString("The url Home Assistant loads the resource from, for example /local/my-card.js."),
      },
      ["resourceType", "url"],
      "Input parameters for registering one Home Assistant frontend resource.",
    ),
    outputSchema: s.actionOutput(
      { resource: s.looseObject("The created frontend resource. Its type is reported as type, not res_type.") },
      "The created Home Assistant frontend resource.",
    ),
  }),
  defineProviderAction(service, {
    name: "update_lovelace_resource",
    description: `Update the url or load type of one registered frontend resource. Fields left out keep their current values. ${lovelaceAdminNote}`,
    inputSchema: s.actionInput(
      {
        resourceId: s.nonEmptyString("The resource id, as returned by list_lovelace_resources."),
        resourceType: s.stringEnum("How the frontend loads the resource.", lovelaceResourceTypes),
        url: s.nonEmptyString("The url Home Assistant loads the resource from."),
      },
      ["resourceId"],
      "Input parameters for updating one Home Assistant frontend resource. At least one changed field is required.",
    ),
    outputSchema: s.actionOutput(
      { resource: s.looseObject("The updated frontend resource.") },
      "The updated Home Assistant frontend resource.",
    ),
  }),
  defineProviderAction(service, {
    name: "delete_lovelace_resource",
    description: `Remove one registered frontend resource. Dashboards using the custom cards it defines stop rendering them. ${lovelaceAdminNote}`,
    inputSchema: s.actionInput(
      { resourceId: s.nonEmptyString("The resource id, as returned by list_lovelace_resources.") },
      ["resourceId"],
      "Input parameters for removing one Home Assistant frontend resource.",
    ),
    outputSchema: s.actionOutput(
      { deleted: s.literal(true, { description: "Whether Home Assistant removed the frontend resource." }) },
      "The Home Assistant frontend resource delete result.",
    ),
  }),
  defineProviderAction(service, {
    name: "check_config",
    description:
      "Ask Home Assistant to validate its own configuration files and report errors and warnings. Requires an admin access token.",
    inputSchema: emptyInputSchema,
    outputSchema: s.actionOutput(
      {
        result: s.string("Either valid or invalid."),
        errors: s.nullableString("The configuration errors, or null when there are none."),
        warnings: s.nullableString("The configuration warnings, or null when there are none."),
      },
      "The Home Assistant configuration check result.",
    ),
  }),
];
