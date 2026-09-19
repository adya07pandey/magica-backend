import type {
  AgentMessage,
  ToolDefinition,
  ModelResponse,
} from "./model.types";

import {
  openRouterProvider,
} from "./openrouter";

export async function generateWithOpenRouter(
  messages: AgentMessage[],
  tools: ToolDefinition[] = [],
): Promise<{
  response: ModelResponse;
}> {
  const response =
    await openRouterProvider.generate(
      messages,
      tools,
    );

  return {
    response,
  };
}
