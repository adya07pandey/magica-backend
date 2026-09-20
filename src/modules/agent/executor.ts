import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { attachmentStorageKey, copyRemoteAssetToR2, isR2Configured, signedAssetUrl } from "../../lib/storage/r2";
import {
  reserveCredits,
  settleCredits,
} from "../credits/credit.service";
import {
  createRunStep,
  completeRunStep,
  failRunStep,
} from "../runs/run-step.service";
import { getTool } from "../tools/core/registry";
import { executeToolAsChild } from "../tools/core/child-dispatch";
import { getOpenRouterTools } from "../tools/core/openrouter-tools";
import { emitWebhook } from "../webhooks/webhook.service";
import { buildConversationContext } from "./context";
import { generateWithOpenRouter } from "./model-router";
import { extractImageGenerationPrompt } from "./image-intent";
import {
  detectRequestedMediaTools,
  restrictToolCallsToMediaIntent,
  restrictToolsToMediaIntent,
} from "./media-intent";
import type {
  AgentMessage,
  ModelResponse,
  ToolCall,
} from "./model.types";

const MAX_AGENT_STEPS = 20;
const MODEL_ROUTE = "openrouter/free";

type ExecuteAgentRunResult = {
  messageId: string;
  stepCount: number;
  actualModel?: string;
};

type ContentBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      status: "COMPLETED" | "FAILED";
      creditsUsed: number;
      output?: unknown;
      error?: string;
    }
  | {
      type: "generated_asset";
      toolCallId: string;
      toolName: string;
      assetType: "image" | "video";
      url: string;
    };

export async function executeAgentRun(
  runId: string,
): Promise<ExecuteAgentRunResult> {
  const runStartedAt = Date.now();
  console.info(`[timing] agent ${runId} start`);

  const run = await prisma.agentRun.findUnique({
    where: {
      id: runId,
    },
    include: {
      task: true,
      message: true,
    },
  });

  if (!run) {
    throw new Error(`AgentRun ${runId} not found`);
  }

  if (!["QUEUED", "RUNNING"].includes(run.status)) {
    throw new Error(
      `AgentRun ${runId} cannot execute from status ${run.status}`,
    );
  }

  await prisma.agentRun.update({
    where: {
      id: runId,
    },
    data: {
      status: "RUNNING",
      startedAt: run.startedAt ?? new Date(),
    },
  });

  await emitWebhook({
    event: "agent.started",
    payload: {
      runId,
      taskId: run.taskId,
      messageId: run.messageId,
    },
  });

  const contextStartedAt = Date.now();
  const messages: AgentMessage[] =
    await buildConversationContext(run.taskId);
  logTiming(`agent ${runId} context`, contextStartedAt, {
    messages: messages.length,
  });

  const requestedMediaTools = detectRequestedMediaTools(
    run.message.contentBlocks,
  );
  const tools = restrictToolsToMediaIntent(
    getOpenRouterTools(),
    requestedMediaTools,
  );
  const contentBlocks: ContentBlock[] = [];
  const requestedImagePrompt = extractImageGenerationPrompt(
    run.message.contentBlocks,
  );

  let stepNumber = 0;
  let actualModel: string | undefined;
  let pendingAssistantMessageId: string | undefined;

  for (
    let agentStep = 1;
    agentStep <= MAX_AGENT_STEPS;
    agentStep += 1
  ) {
    await throwIfCancelled(runId);

    stepNumber += 1;

    const modelStep = await createRunStep({
      runId,
      stepNumber,
      type: "MODEL_CALL",
      name:
        agentStep === 1
          ? "Initial model call"
          : `Model call ${agentStep}`,
      model: MODEL_ROUTE,
      input: {
        messages,
        toolNames: tools.map((tool) => tool.name),
      },
      metadata: {
        agentStep,
      },
    });

    let modelResult: ModelResponse;

    try {
      const modelStartedAt = Date.now();
      const modelExecution =
        await generateWithOpenRouter(
          messages,
          tools,
        );
      modelResult =
        modelExecution.response;

      const restrictedToolCalls = restrictToolCallsToMediaIntent(
        modelResult.toolCalls,
        requestedMediaTools,
      );

      if (restrictedToolCalls.rejected.length > 0) {
        console.warn(
          `[agent] ${runId} rejected media tools unrelated to the latest request: ${restrictedToolCalls.rejected
            .map((toolCall) => toolCall.name)
            .join(", ")}`,
        );
        modelResult = {
          ...modelResult,
          toolCalls: restrictedToolCalls.allowed,
        };
      }

      if (
        agentStep === 1 &&
        modelResult.toolCalls.length === 0 &&
        requestedImagePrompt
      ) {
        modelResult = {
          ...modelResult,
          content: null,
          toolCalls: [
            {
              id: `image-fallback-${run.id}`,
              name: "gpt_image_2",
              arguments: {
                prompt: requestedImagePrompt,
                quality: "Low",
              },
            },
          ],
        };

        console.warn(
          `[agent] ${runId} applied deterministic gpt_image_2 fallback`,
        );
      }

      logTiming(`agent ${runId} model step ${agentStep}`, modelStartedAt, {
        model: modelResult.model,
        toolCalls: modelResult.toolCalls.map((t) => t.name),
        hasContent: Boolean(modelResult.content),
      });

      actualModel = modelResult.model;

      await prisma.agentRun.update({
        where: {
          id: runId,
        },
        data: {
          actualModel,
          stepCount: stepNumber,
          ...(modelResult.usage
            ? {
                inputTokens: { increment: modelResult.usage.inputTokens },
                outputTokens: { increment: modelResult.usage.outputTokens },
                totalTokens: { increment: modelResult.usage.totalTokens },
              }
            : {}),
        },
      });

      await completeRunStep(modelStep.id, {
        model: modelResult.model,
        content: modelResult.content,
        toolCalls: modelResult.toolCalls,
        usage: modelResult.usage,
      }, modelResult.usage, { creditsUsed: 0 });
    } catch (error) {
      await failRunStep(
        modelStep.id,
        error,
        "MODEL_FAILED",
      );

      throw error;
    }

    if (
      modelResult.content &&
      modelResult.content.trim().length > 0
    ) {
      contentBlocks.push({
        type: "text",
        text: modelResult.content,
      });
    }

    if (modelResult.toolCalls.length === 0) {
      const assistantMessage = pendingAssistantMessageId
        ? await prisma.message.update({
            where: { id: pendingAssistantMessageId },
            data: {
              status: "COMPLETED",
              contentBlocks:
                contentBlocks as unknown as Prisma.InputJsonValue,
            },
          })
        : await prisma.message.create({
            data: {
              taskId: run.taskId,
              role: "ASSISTANT",
              status: "COMPLETED",
              contentBlocks:
                contentBlocks as unknown as Prisma.InputJsonValue,
            },
          });

      await prisma.agentRun.update({
        where: {
          id: runId,
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          stepCount: stepNumber,
          actualModel,
        },
      });

      await emitWebhook({
        event: "agent.completed",
        payload: {
          runId,
          taskId: run.taskId,
          messageId: assistantMessage.id,
          stepCount: stepNumber,
        },
      });

      logTiming(`agent ${runId} total`, runStartedAt, {
        steps: stepNumber,
        completedBy: "model",
      });

      return {
        messageId: assistantMessage.id,
        stepCount: stepNumber,
        actualModel,
      };
    }

    messages.push({
      role: "assistant",
      content: modelResult.content ?? "",
      toolCalls: modelResult.toolCalls,
    });

    for (const toolCall of modelResult.toolCalls) {
      contentBlocks.push({
        type: "tool_call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.arguments,
      });
    }

    const toolResults =
      await executeToolCallsInParallel({
        runId,
        taskId: run.taskId,
        userId: run.task.userId,
        toolCalls: modelResult.toolCalls,
        nextStepNumber: stepNumber + 1,
      });

    stepNumber += toolResults.length;

    for (const result of toolResults) {
      contentBlocks.push(
        result.contentBlock,
        ...result.assetBlocks,
      );

      messages.push({
        role: "tool",
        toolCallId: result.toolCall.id,
        name: result.toolCall.name,
        content: JSON.stringify(result.output),
      });
    }

    if (toolResults.some((result) => result.assetBlocks.length > 0)) {
      const assistantMessage = pendingAssistantMessageId
        ? await prisma.message.update({
            where: { id: pendingAssistantMessageId },
            data: {
              contentBlocks:
                contentBlocks as unknown as Prisma.InputJsonValue,
            },
          })
        : await prisma.message.create({
            data: {
              taskId: run.taskId,
              role: "ASSISTANT",
              status: "PENDING",
              contentBlocks:
                contentBlocks as unknown as Prisma.InputJsonValue,
            },
          });

      pendingAssistantMessageId = assistantMessage.id;

      await prisma.attachment.updateMany({
        where: {
          toolInvocationId: {
            in: toolResults.flatMap((result) =>
              result.invocationId ? [result.invocationId] : [],
            ),
          },
          messageId: null,
        },
        data: { messageId: assistantMessage.id },
      });

      await prisma.message.update({
        where: { id: assistantMessage.id },
        data: { status: "COMPLETED" },
      });

      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          stepCount: stepNumber,
          actualModel,
        },
      });

      await emitWebhook({
        event: "agent.completed",
        payload: {
          runId,
          taskId: run.taskId,
          messageId: assistantMessage.id,
          stepCount: stepNumber,
        },
      });

      logTiming(`agent ${runId} total`, runStartedAt, {
        steps: stepNumber,
        completedBy: "generated_asset",
      });

      return {
        messageId: assistantMessage.id,
        stepCount: stepNumber,
        actualModel,
      };
    }
  }

  throw new Error(
    `Maximum agent steps exceeded (${MAX_AGENT_STEPS})`,
  );
}

async function executeToolCallsInParallel(params: {
  runId: string;
  taskId: string;
  userId: string;
  toolCalls: ToolCall[];
  nextStepNumber: number;
}) {
  const indexedCalls = params.toolCalls.map(
    (toolCall, index) => ({
      toolCall,
      stepNumber:
        params.nextStepNumber + index,
    }),
  );

  return Promise.all(
    indexedCalls.map(
      async ({ toolCall, stepNumber }) => {
        const tool = getTool(toolCall.name);
        const normalizedArguments =
          await normalizeToolArguments(
            toolCall.name,
            toolCall.arguments,
            { taskId: params.taskId },
          );

        const validatedInput =
          tool.inputSchema.parse(
            normalizedArguments,
          );

        const estimatedCredits =
          tool.estimateCredits?.(
            validatedInput as never,
          ) ?? 0;

        const reserveKey =
          `credits:reserve:${params.runId}:${toolCall.id}`;

        const step = await createRunStep({
          runId: params.runId,
          stepNumber,
          type: "TOOL_CALL",
          name: tool.name,
          input: validatedInput,
          metadata: {
            toolCallId: toolCall.id,
            estimatedCredits,
          },
        });

        let reservedAmount;

        try {
          reservedAmount = await reserveCredits({
            userId: params.userId,
            runId: params.runId,
            amount: estimatedCredits,
            idempotencyKey: reserveKey,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Insufficient credits"
          ) {
            const output = {
              success: false,
              error: "INSUFFICIENT_CREDITS",
              estimatedCredits,
            };

            await completeRunStep(step.id, output, undefined, {
              creditsUsed: 0,
            });

            return {
              toolCall,
              output,
              invocationId: undefined,
              contentBlock: {
                type: "tool_result" as const,
                toolCallId: toolCall.id,
                toolName: tool.name,
                status: "FAILED" as const,
                creditsUsed: 0,
                error: "INSUFFICIENT_CREDITS",
                output,
              },
              assetBlocks: [] as ContentBlock[],
            };
          }

          await failRunStep(step.id, error, "CREDIT_RESERVATION_FAILED");
          throw error;
        }

        let creditsSettled = false;

        try {
          const toolStartedAt = Date.now();
          console.info(`[timing] agent ${params.runId} tool ${tool.name} start`);
          const execution =
            await executeToolAsChild({
              toolName: tool.name,
              input: validatedInput,
              context: {
                userId: params.userId,
                taskId: params.taskId,
                runId: params.runId,
                toolCallId: toolCall.id,
              },
              idempotencyKey:
                `tool:${params.runId}:${toolCall.id}`,
            });
          logTiming(`agent ${params.runId} tool ${tool.name}`, toolStartedAt, {
            reused: execution.reused,
          });

          const output =
            execution.output ?? {};

          const actualCredits = estimatedCredits;

          await settleCredits({
            userId: params.userId,
            runId: params.runId,
            reservedAmount,
            actualAmount: actualCredits,
            idempotencyKey:
              `credits:settle:${params.runId}:${toolCall.id}`,
          });
          creditsSettled = true;

          await Promise.all([
            persistGeneratedAttachments({
              userId: params.userId,
              taskId: params.taskId,
              toolInvocationId:
                execution.invocation.id,
              toolName: tool.name,
              output,
            }),

            completeRunStep(step.id, {
              toolName: tool.name,
              output,
              invocationId:
                execution.invocation.id,
              reused: execution.reused,
            }, undefined, {
              creditsUsed: actualCredits,
              toolInvocationId: execution.invocation.id,
            }),

            emitWebhook({
              event: "tool.completed",
              payload: {
                runId: params.runId,
                taskId: params.taskId,
                toolInvocationId:
                  execution.invocation.id,
                toolName: tool.name,
                toolCallId: toolCall.id,
              },
            }),
          ]);

          return {
            toolCall,
            output,
            invocationId: execution.invocation.id,
            contentBlock: {
              type: "tool_result" as const,
              toolCallId: toolCall.id,
              toolName: tool.name,
              status: "COMPLETED" as const,
              creditsUsed: actualCredits,
              output,
            },
            assetBlocks:
              extractGeneratedAssets(
                tool.name,
                toolCall.id,
                output,
              ),
          };
        } catch (error) {
          if (!creditsSettled) {
            await settleCredits({
              userId: params.userId,
              runId: params.runId,
              reservedAmount,
              actualAmount: 0,
              idempotencyKey:
                `credits:settle:${params.runId}:${toolCall.id}:failed`,
            });
          }

          await failRunStep(
            step.id,
            error,
            "TOOL_FAILED",
            creditsSettled ? estimatedCredits : 0,
          );

          await emitWebhook({
            event: "tool.failed",
            payload: {
              runId: params.runId,
              taskId: params.taskId,
              toolName: tool.name,
              toolCallId: toolCall.id,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown tool error",
            },
          });

          throw error;
        }
      },
    ),
  );
}

export async function failAgentRunWebhook(params: {
  runId: string;
  taskId?: string;
  error: unknown;
}) {
  await emitWebhook({
    event: "agent.failed",
    payload: {
      runId: params.runId,
      ...(params.taskId
        ? { taskId: params.taskId }
        : {}),
      error:
        params.error instanceof Error
          ? params.error.message
          : "Unknown error",
    },
  });
}

async function throwIfCancelled(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: {
      id: runId,
    },
    select: {
      status: true,
    },
  });

  if (run?.status === "STOPPING") {
    await prisma.agentRun.update({
      where: {
        id: runId,
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        completedAt: new Date(),
      },
    });

    throw new Error("Agent run cancelled");
  }
}

function logTiming(
  label: string,
  startedAt: number,
  details: Record<string, unknown> = {},
) {
  const durationMs = Date.now() - startedAt;
  const suffix = Object.keys(details).length
    ? ` ${JSON.stringify(details)}`
    : "";
  console.info(`[timing] ${label} ${durationMs}ms${suffix}`);
}

async function normalizeToolArguments(
  toolName: string,
  argumentsObject: Record<string, unknown>,
  context: { taskId: string },
) {
  let normalized = unwrapRequestArgument(argumentsObject);

  if (toolName === "gpt_image_2") {
    normalized = {
      ...normalized,
      quality: normalizeEnumValue(
        normalized.quality,
        ["Low", "Medium", "High"],
      ),
      background: normalizeEnumValue(
        normalized.background,
        ["Auto", "Transparent", "Opaque"],
      ),
      output_format: normalizeEnumValue(
        normalized.output_format,
        ["PNG", "JPEG", "WEBP"],
      ),
    };
  }

  if (toolName === "merge_videos") {
    normalized = {
      ...normalized,
      transition:
        normalizeEnumValue(
          normalized.transition,
          ["none", "fade", "dissolve"],
        ) ?? "none",
      video_urls: await restoreSignedVideoUrls(
        normalized.video_urls,
        context.taskId,
      ),
    };
  }

  return normalized;
}

async function restoreSignedVideoUrls(
  value: unknown,
  taskId: string,
) {
  if (!Array.isArray(value)) {
    return value;
  }

  const attachments = await prisma.attachment.findMany({
    where: {
      taskId,
      status: "READY",
      mimeType: {
        startsWith: "video/",
      },
      storageKey: {
        not: null,
      },
    },
    select: {
      storageKey: true,
    },
  });

  const signedByStorageKey = new Map<string, string>();

  await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment.storageKey) return;
      try {
        signedByStorageKey.set(
          attachment.storageKey,
          await signedAssetUrl(attachment.storageKey),
        );
      } catch {
        // Keep the model URL when signing fails; execution will surface the real error.
      }
    }),
  );

  return value.map((item) => {
    if (typeof item !== "string") {
      return item;
    }

    const storageKey = findStorageKeyInUrl(
      item,
      signedByStorageKey.keys(),
    );

    return storageKey
      ? signedByStorageKey.get(storageKey) ?? item
      : item;
  });
}

function findStorageKeyInUrl(
  url: string,
  storageKeys: Iterable<string>,
) {
  let pathname: string;

  try {
    pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }

  for (const storageKey of storageKeys) {
    if (pathname === storageKey) {
      return storageKey;
    }
  }

  return null;
}

function unwrapRequestArgument(
  argumentsObject: Record<string, unknown>,
) {
  if (
    Object.keys(argumentsObject).length !== 1 ||
    typeof argumentsObject.request !== "string"
  ) {
    return argumentsObject;
  }

  try {
    const parsed = JSON.parse(argumentsObject.request);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return argumentsObject;
  }

  return argumentsObject;
}

function normalizeEnumValue(
  value: unknown,
  allowed: string[],
) {
  if (typeof value !== "string") {
    return value;
  }

  return allowed.find(
    (option) =>
      option.toLowerCase() === value.toLowerCase(),
  ) ?? value;
}

function extractGeneratedAssets(
  toolName: string,
  toolCallId: string,
  output: unknown,
): ContentBlock[] {
  if (
    typeof output !== "object" ||
    output === null
  ) {
    return [];
  }

  const blocks: ContentBlock[] = [];

  if (
    "image_url" in output &&
    typeof output.image_url === "string"
  ) {
    blocks.push({
      type: "generated_asset",
      toolCallId,
      toolName,
      assetType: "image",
      url: output.image_url,
    });
  }

  if (
    "image_urls" in output &&
    Array.isArray(output.image_urls)
  ) {
    for (const url of output.image_urls) {
      if (typeof url === "string") {
        blocks.push({
          type: "generated_asset",
          toolCallId,
          toolName,
          assetType: "image",
          url,
        });
      }
    }
  }

  if (
    "video_url" in output &&
    typeof output.video_url === "string"
  ) {
    blocks.push({
      type: "generated_asset",
      toolCallId,
      toolName,
      assetType: "video",
      url: output.video_url,
    });
  }

  return blocks;
}

async function persistGeneratedAttachments(params: {
  userId: string;
  taskId: string;
  toolInvocationId: string;
  toolName: string;
  output: unknown;
}) {
  const assets = extractGeneratedAssets(
    params.toolName,
    params.toolInvocationId,
    params.output,
  );

  await Promise.all(
    assets.map(async (asset, index) => {
      if (asset.type !== "generated_asset") {
        return;
      }

      const attachment = await prisma.attachment.create({
        data: {
          userId: params.userId,
          taskId: params.taskId,
          toolInvocationId:
            params.toolInvocationId,
          source: "GENERATED",
          status: isR2Configured() ? "PROCESSING" : "READY",
          filename:
            asset.assetType === "video"
              ? `${params.toolName}.mp4`
              : `${params.toolName}.png`,
          mimeType:
            asset.assetType === "video"
              ? "video/mp4"
              : "image/png",
          sizeBytes: BigInt(0),
          url: asset.url,
          position: index,
          metadata: {
            toolName: params.toolName,
            assetType: asset.assetType,
          },
        },
      });

      if (isR2Configured()) {
        try {
          const stored = await copyRemoteAssetToR2({
            sourceUrl: asset.url,
            storageKey: attachmentStorageKey({
              userId: params.userId,
              taskId: params.taskId,
              attachmentId: attachment.id,
              filename: attachment.filename,
            }),
            mimeType: attachment.mimeType,
          });
          await prisma.attachment.update({
            where: { id: attachment.id },
            data: {
              status: "READY",
              storageKey: stored.storageKey,
              url: stored.url ?? asset.url,
            },
          });
        } catch {
          await prisma.attachment.update({
            where: { id: attachment.id },
            data: { status: "READY" },
          });
        }
      }
    }),
  );
}
