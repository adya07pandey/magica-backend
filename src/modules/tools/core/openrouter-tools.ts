import { z } from "zod";

import {
  getAllTools,
} from "./registry";

import type {
  ToolDefinition,
} from "../../agent/model.types";

export function getOpenRouterTools() {
  return getAllTools().map(
    (tool) => ({
      name: tool.name,

      description:
        tool.description,

      parameters:
        z.toJSONSchema(
          tool.inputSchema,
        ) as Record<string, unknown>,
    }),
  ) satisfies ToolDefinition[];
}
