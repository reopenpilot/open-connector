import type { HomeAssistantActionHandler } from "./runtime.ts";

import {
  compactObject,
  optionalRecord,
  optionalString,
  optionalStringArray,
  requiredStringArray,
} from "../../core/cast.ts";
import { runHomeAssistantCommands } from "./runtime-ws.ts";
import { badHomeAssistantRequest, readInputString } from "./runtime.ts";

export const homeAssistantStatisticsActionHandlers: Record<string, HomeAssistantActionHandler> = {
  async list_statistic_ids(input, context) {
    const [statisticIds] = await runHomeAssistantCommands(context, [
      {
        type: "recorder/list_statistic_ids",
        ...compactObject({ statistic_type: optionalString(input.statisticType) }),
      },
    ]);
    return { statisticIds: statisticIds ?? [] };
  },
  async get_statistics_metadata(input, context) {
    const [metadata] = await runHomeAssistantCommands(context, [
      {
        type: "recorder/get_statistics_metadata",
        ...compactObject({ statistic_ids: optionalStringArray(input.statisticIds) }),
      },
    ]);
    return { metadata: metadata ?? [] };
  },
  async get_statistics(input, context) {
    const [statistics] = await runHomeAssistantCommands(context, [
      {
        type: "recorder/statistics_during_period",
        statistic_ids: readStatisticIds(input.statisticIds),
        start_time: readInputString(input.startTime, "startTime"),
        period: readInputString(input.period, "period"),
        ...compactObject({
          end_time: optionalString(input.endTime),
          types: optionalStringArray(input.types),
          units: optionalRecord(input.units),
        }),
      },
    ]);
    return { statistics: optionalRecord(statistics) ?? {} };
  },
};

/**
 * Home Assistant rejects an empty `statistic_ids` list outright, but it accepts
 * a whitespace-only id and answers with an empty result, which reads as "this
 * instance records no statistics" rather than as a bad request. Trim the ids and
 * reject a list that normalizes to nothing, so both cases fail the same way.
 */
function readStatisticIds(value: unknown): string[] {
  const statisticIds = requiredStringArray(value, "statisticIds", badHomeAssistantRequest)
    .map((statisticId) => statisticId.trim())
    .filter((statisticId) => statisticId.length > 0);
  if (statisticIds.length === 0) {
    throw badHomeAssistantRequest("statisticIds must contain at least one statistic id");
  }
  return statisticIds;
}
