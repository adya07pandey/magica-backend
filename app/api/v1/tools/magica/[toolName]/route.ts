import { NextResponse } from "next/server";
import { z } from "zod";

import { getIdempotencyKey } from "@/src/lib/idempotency";
import { prisma } from "@/src/lib/prisma";
import {
  reserveCredits,
  settleCredits,
} from "@/src/modules/credits/credit.service";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { executeTool } from "@/src/modules/tools/core/execution-service";
import { getTool } from "@/src/modules/tools/core/registry";

const DirectToolSchema = z.object({
  input: z.record(z.string(), z.unknown()),
});

const ALLOWED_MAGICA_TOOLS = new Set([
  "crop_image",
  "gpt_image_2",
  "merge_videos",
]);

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ toolName: string }>;
  },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const idempotencyKey =
    getIdempotencyKey(request);

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error:
          "Missing or invalid Idempotency-Key header",
      },
      { status: 400 },
    );
  }

  const { toolName } = await params;

  if (!ALLOWED_MAGICA_TOOLS.has(toolName)) {
    return NextResponse.json(
      { error: "Unknown Magica tool" },
      { status: 404 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed =
    DirectToolSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details:
          parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const tool = getTool(toolName);
  const validatedInput =
    tool.inputSchema.parse(parsed.data.input);

  const result = await prisma.$transaction(
    async (tx) => {
      const task = await tx.task.create({
        data: {
          userId: user.id,
          title: `Run ${toolName}`,
        },
      });

      const message = await tx.message.create({
        data: {
          taskId: task.id,
          role: "USER",
          status: "COMPLETED",
          contentBlocks: [
            {
              type: "text",
              text: `Execute ${toolName}`,
            },
          ],
        },
      });

      const run = await tx.agentRun.create({
        data: {
          taskId: task.id,
          messageId: message.id,
          status: "RUNNING",
          idempotencyKey,
          modelRoute: "direct-tool",
          startedAt: new Date(),
        },
      });

      return {
        task,
        message,
        run,
      };
    },
  );

  const estimatedCredits =
    tool.estimateCredits?.(
      validatedInput as never,
    ) ?? 0;

  const reservedAmount = await reserveCredits({
    userId: user.id,
    runId: result.run.id,
    amount: estimatedCredits,
    idempotencyKey:
      `credits:reserve:${result.run.id}:direct`,
  });

  try {
    const execution = await executeTool({
      toolName,
      input: validatedInput,
      context: {
        userId: user.id,
        taskId: result.task.id,
        runId: result.run.id,
        toolCallId: "direct",
      },
      idempotencyKey:
        `tool:${result.run.id}:direct`,
    });

    const actualCredits =
      typeof execution.output === "object" &&
      execution.output !== null &&
      "creditUsed" in execution.output &&
      typeof execution.output.creditUsed ===
        "number"
        ? execution.output.creditUsed
        : 0;

    await settleCredits({
      userId: user.id,
      runId: result.run.id,
      reservedAmount,
      actualAmount: actualCredits,
      idempotencyKey:
        `credits:settle:${result.run.id}:direct`,
    });

    await prisma.agentRun.update({
      where: {
        id: result.run.id,
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        actualCredits,
      },
    });

    return NextResponse.json({
      runId: result.run.id,
      toolInvocationId:
        execution.invocation.id,
      output: execution.output,
    });
  } catch (error) {
    await prisma.agentRun.update({
      where: {
        id: result.run.id,
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage:
          error instanceof Error
            ? error.message
            : "Unknown tool error",
      },
    });

    throw error;
  }
}
