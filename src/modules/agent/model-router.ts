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
  options?: {
    onTextDelta?: (delta: string, content: string) => void | Promise<void>;
    signal?: AbortSignal;
  },
): Promise<{
  response: ModelResponse;
}> {
  const response =
    options?.onTextDelta
      ? await openRouterProvider.generateStream(
          messages,
          tools,
          options.onTextDelta,
          options.signal,
        )
      : await openRouterProvider.generate(
          messages,
          tools,
        );

  return {
    response,
  };
}
