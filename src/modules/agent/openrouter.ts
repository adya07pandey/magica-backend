import { env } from "../../lib/env";
import {
  ModelResponseSchema,
  ToolDefinitionSchema,
  type AgentMessage,
  type ModelProvider,
  type ModelResponse,
  type ToolDefinition,
} from "./model.types";

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_MODEL = "openrouter/free";

type OpenRouterToolCall = {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
};

type OpenRouterResponse = {
  model?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  choices?: Array<{
    message?: {
      role?: unknown;
      content?: unknown;
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
};

export const openRouterProvider: ModelProvider = {
  name: OPENROUTER_MODEL,

  async generate(
    messages: AgentMessage[],
    tools: ToolDefinition[] = [],
  ): Promise<ModelResponse> {
    const validatedTools = tools.map((tool) =>
      ToolDefinitionSchema.parse(tool),
    );

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,

        "HTTP-Referer": env.FRONTEND_URL,

        "X-Title": "Magica Agent Chat",
      },

      body: JSON.stringify({
        model: OPENROUTER_MODEL,

        messages: messages.map((message) => {
          switch (message.role) {
            case "system":
            case "user":
              return {
                role: message.role,
                content: message.content,
              };

            case "assistant":
              return {
                role: "assistant",
                content: message.content,
                ...(message.toolCalls?.length
                  ? {
                      tool_calls: message.toolCalls.map((toolCall) => ({
                        id: toolCall.id,
                        type: "function",
                        function: {
                          name: toolCall.name,
                          arguments: JSON.stringify(
                            toolCall.arguments,
                          ),
                        },
                      })),
                    }
                  : {}),
              };

            case "tool":
              return {
                role: "tool",
                tool_call_id: message.toolCallId,
                name: message.name,
                content: message.content,
              };
          }
        }),

        ...(validatedTools.length > 0
          ? {
              tools: validatedTools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `OpenRouter request failed (${response.status}): ${errorText}`,
      );
    }

    const rawData =
      (await response.json()) as OpenRouterResponse;

    return parseOpenRouterResponse(rawData);
  },
};

/**
 * Convert the provider response into our internal
 * provider-neutral ModelResponse.
 */
function parseOpenRouterResponse(
  data: OpenRouterResponse,
): ModelResponse {
  const message = data.choices?.[0]?.message;

  if (!message) {
    throw new Error(
      "OpenRouter returned no assistant message",
    );
  }

  const toolCalls =
    parseToolCalls(message.tool_calls);

  /**
   * IMPORTANT:
   *
   * We validate the final normalized object with Zod.
   */
  return ModelResponseSchema.parse({
    model:
      typeof data.model === "string"
        ? data.model
        : OPENROUTER_MODEL,

    role: "assistant",

    content:
      typeof message.content === "string" ||
      message.content === null
        ? message.content
        : "",

    toolCalls,

    usage: parseUsage(data.usage),
  });
}

function parseUsage(usage: OpenRouterResponse["usage"]) {
  if (!usage) {
    return undefined;
  }

  const inputTokens = toTokenCount(usage.prompt_tokens);
  const outputTokens = toTokenCount(usage.completion_tokens);
  const totalTokens = toTokenCount(usage.total_tokens);

  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }

  return { inputTokens, outputTokens, totalTokens };
}

function toTokenCount(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function parseToolCalls(
  calls: OpenRouterToolCall[] | undefined,
) {
  if (!calls || calls.length === 0) {
    return [];
  }

  return calls.map((call, index) => {
    const id =
      typeof call.id === "string" && call.id.length > 0
        ? call.id
        : `tool-call-${index}`;

    const name =
      typeof call.function?.name === "string"
        ? call.function.name
        : "";

    if (!name) {
      throw new Error(
        `OpenRouter returned a tool call without a tool name`,
      );
    }

    const rawArguments =
      typeof call.function?.arguments === "string"
        ? call.function.arguments
        : "{}";

    let parsedArguments: unknown;

    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch {
      throw new Error(
        `Invalid JSON arguments returned for tool ${name}`,
      );
    }

    if (
      typeof parsedArguments !== "object" ||
      parsedArguments === null ||
      Array.isArray(parsedArguments)
    ) {
      throw new Error(
        `Tool arguments for ${name} must be an object`,
      );
    }

    return {
      id,
      name,
      arguments:
        parsedArguments as Record<string, unknown>,
    };
  });
}
