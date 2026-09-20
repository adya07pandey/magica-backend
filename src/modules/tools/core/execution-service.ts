import { prisma } from "../../../lib/prisma";
import { isPrismaUniqueConstraintError } from "../../../lib/prisma-errors";
import { checkToolRateLimit } from "./rate-limit.service";
import { getTool } from "./registry";
import type { ToolExecutionContext } from "./types";
import { completedToolCredits } from "../../credits/tool-billing";

type ExecuteToolParams = {
  toolName: string;
  input: unknown;
  context: ToolExecutionContext;
  idempotencyKey: string;
};

export async function executeTool(params: ExecuteToolParams) {
  const prepared = await prepareToolInvocation(params);

  if (prepared.status === "COMPLETED") {
    return completedResult(prepared, true);
  }

  return executeToolInvocation({
    invocationId: prepared.id,
    context: params.context,
  });
}

export async function prepareToolInvocation(params: ExecuteToolParams) {
  const tool = getTool(params.toolName);
  const input = tool.inputSchema.parse(params.input);

  const existing = await prisma.toolInvocation.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });

  if (existing) {
    assertInvocationMatches(existing, params);
    return existing;
  }

  await checkToolRateLimit(params.context.userId);

  try {
    return await prisma.toolInvocation.create({
      data: {
        runId: params.context.runId,
        toolName: params.toolName,
        status: "QUEUED",
        idempotencyKey: params.idempotencyKey,
        input: input as object,
      },
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const raced = await prisma.toolInvocation.findUniqueOrThrow({
      where: { idempotencyKey: params.idempotencyKey },
    });
    assertInvocationMatches(raced, params);
    return raced;
  }
}

export async function executeToolInvocation(params: {
  invocationId: string;
  context: ToolExecutionContext;
  triggerRunId?: string;
}) {
  const invocation = await prisma.toolInvocation.findUniqueOrThrow({
    where: { id: params.invocationId },
  });

  if (invocation.status === "COMPLETED") {
    return completedResult(invocation, true);
  }

  const tool = getTool(invocation.toolName);
  const input = tool.inputSchema.parse(invocation.input);
  const startedAt = Date.now();

  await prisma.toolInvocation.update({
    where: { id: invocation.id },
    data: {
      status: "RUNNING",
      startedAt: invocation.startedAt ?? new Date(),
      triggerRunId: params.triggerRunId ?? invocation.triggerRunId,
      errorCode: null,
      errorMessage: null,
    },
  });

  try {
    const rawOutput = await tool.execute(input as never, params.context);
    const output = tool.outputSchema.parse(rawOutput);
    const creditsUsed = completedToolCredits({
      toolName: tool.name,
      estimatedCredits: tool.estimateCredits?.(input as never) ?? 0,
      output,
    });
    const completed = await prisma.toolInvocation.update({
      where: { id: invocation.id },
      data: {
        status: "COMPLETED",
        output: output as object,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        creditsUsed,
        providerRunId: extractString(output, "providerRunId"),
      },
    });

    return { invocation: completed, output, reused: false };
  } catch (error) {
    await prisma.toolInvocation.update({
      where: { id: invocation.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        errorCode: "TOOL_EXECUTION_FAILED",
        errorMessage:
          error instanceof Error ? error.message : "Unknown tool error",
      },
    });
    throw error;
  }
}

function completedResult(
  invocation: Awaited<ReturnType<typeof prisma.toolInvocation.findUniqueOrThrow>>,
  reused: boolean,
) {
  return { invocation, output: invocation.output, reused };
}

function assertInvocationMatches(
  invocation: { runId: string; toolName: string },
  params: ExecuteToolParams,
) {
  if (
    invocation.runId !== params.context.runId ||
    invocation.toolName !== params.toolName
  ) {
    throw new Error("Tool idempotency key belongs to another operation");
  }
}

function extractString(output: unknown, key: string) {
  if (typeof output !== "object" || output === null || !(key in output)) {
    return undefined;
  }
  const value = (output as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
