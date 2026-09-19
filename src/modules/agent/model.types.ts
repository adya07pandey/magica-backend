import { z } from "zod";

/**
 * ---------------------------------------------------------
 * Tool Call
 * ---------------------------------------------------------
 */

export const ToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * ---------------------------------------------------------
 * Agent Messages
 * ---------------------------------------------------------
 *
 * These are the provider-neutral messages used by the
 * orchestration layer.
 */

export const SystemMessageSchema = z.object({
  role: z.literal("system"),
  content: z.string(),
});

export const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.string(),
});

export const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullable(),
  toolCalls: z.array(ToolCallSchema).optional(),
});

export const ToolMessageSchema = z.object({
  role: z.literal("tool"),
  content: z.string(),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
});

export const AgentMessageSchema = z.discriminatedUnion("role", [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/**
 * ---------------------------------------------------------
 * Tool Definition
 * ---------------------------------------------------------
 *
 * This is what gets exposed to the model.
 */

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/**
 * ---------------------------------------------------------
 * Model Response
 * ---------------------------------------------------------
 */

export const ModelResponseSchema = z.object({
  model: z.string().min(1),
  role: z.literal("assistant"),
  content: z.string().nullable(),
  toolCalls: z.array(ToolCallSchema).default([]),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export type ModelResponse = z.infer<typeof ModelResponseSchema>;

/**
 * ---------------------------------------------------------
 * Provider Contract
 * ---------------------------------------------------------
 */

export interface ModelProvider {
  name: string;

  generate(
    messages: AgentMessage[],
    tools?: ToolDefinition[],
  ): Promise<ModelResponse>;
}
