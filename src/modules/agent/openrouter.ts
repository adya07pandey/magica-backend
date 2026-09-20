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

type OpenRouterStreamChunk = {
  model?: unknown;
  usage?: OpenRouterResponse["usage"];
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: Array<{
        index?: unknown;
        id?: unknown;
        function?: {
          name?: unknown;
          arguments?: unknown;
        };
      }>;
    };
  }>;
};

interface StreamingModelProvider extends ModelProvider {
  generateStream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    onTextDelta: (delta: string, content: string) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<ModelResponse>;
}

export const openRouterProvider: StreamingModelProvider = {
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

      body: JSON.stringify(buildRequestBody(messages, validatedTools)),
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

  async generateStream(
    messages: AgentMessage[],
    tools: ToolDefinition[] = [],
    onTextDelta,
    signal,
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
        ...buildRequestBody(messages, validatedTools),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter request failed (${response.status}): ${errorText}`,
      );
    }
    if (!response.body) {
      throw new Error("OpenRouter returned an empty streaming response");
    }

    return readOpenRouterStream(response.body, onTextDelta);
  },
};

function buildRequestBody(
  messages: AgentMessage[],
  tools: ToolDefinition[],
) {
  return {
    model: OPENROUTER_MODEL,
    messages: messages.map((message) => {
      switch (message.role) {
        case "system":
        case "user":
          return { role: message.role, content: message.content };
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
                      arguments: JSON.stringify(toolCall.arguments),
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
    ...(tools.length > 0
      ? {
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }
      : {}),
  };
}

export async function readOpenRouterStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string, content: string) => void | Promise<void>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = "";
  let content = "";
  let model = OPENROUTER_MODEL;
  let usage: ReturnType<typeof parseUsage>;

  const processEvent = async (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;

    const chunk = JSON.parse(data) as OpenRouterStreamChunk;
    if (typeof chunk.model === "string") model = chunk.model;
    if (chunk.usage) usage = parseUsage(chunk.usage);

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (typeof delta?.content === "string" && delta.content) {
        content += delta.content;
        await onTextDelta(delta.content, content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = typeof call.index === "number" ? call.index : 0;
        const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof call.id === "string") current.id = call.id;
        if (typeof call.function?.name === "string") current.name += call.function.name;
        if (typeof call.function?.arguments === "string") {
          current.arguments += call.function.arguments;
        }
        toolCalls.set(index, current);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) await processEvent(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) await processEvent(buffer);

  return ModelResponseSchema.parse({
    model,
    role: "assistant",
    content: content || null,
    toolCalls: parseToolCalls(
      [...toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call], index) => ({
          id: call.id || `tool-call-${index}`,
          type: "function",
          function: {
            name: call.name,
            arguments: call.arguments || "{}",
          },
        })),
    ),
    usage,
  });
}

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
