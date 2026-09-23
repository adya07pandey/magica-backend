import { NextResponse } from "next/server";
import { z } from "zod";

import { getIdempotencyKey } from "@/src/lib/idempotency";
import { prisma } from "@/src/lib/prisma";
import { dispatchAgentRun } from "@/src/modules/agent/dispatch";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { findActiveRun } from "@/src/modules/runs/run.service";
import { dispatchTaskTitleGeneration } from "@/src/modules/tasks/title-dispatch";

const CompletionSchema = z.object({
  taskId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(32_000),
});

export async function POST(request: Request) {
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
    CompletionSchema.safeParse(body);

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

  const existing =
    await prisma.agentRun.findUnique({
      where: {
        idempotencyKey,
      },
    });

  if (existing) {
    return NextResponse.json({
      taskId: existing.taskId,
      messageId: existing.messageId,
      runId: existing.id,
      status: existing.status,
      existing: true,
    });
  }

  if (parsed.data.taskId) {
    const activeRun =
      await findActiveRun(parsed.data.taskId);

    if (activeRun) {
      return NextResponse.json(
        {
          error:
            "Task already has an active agent run",
          runId: activeRun.id,
        },
        { status: 409 },
      );
    }
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const createdNewTask = !parsed.data.taskId;
      const task = parsed.data.taskId
        ? await tx.task.findFirst({
            where: {
              id: parsed.data.taskId,
              userId: user.id,
            },
          })
        : await tx.task.create({
            data: {
              userId: user.id,
              title: "New Task",
            },
          });

      if (!task) {
        throw new Error("Task not found");
      }

      const message = await tx.message.create({
        data: {
          taskId: task.id,
          role: "USER",
          status: "COMPLETED",
          contentBlocks: [
            {
              type: "text",
              text: parsed.data.message,
            },
          ],
        },
      });

      const run = await tx.agentRun.create({
        data: {
          taskId: task.id,
          messageId: message.id,
          status: "QUEUED",
          idempotencyKey,
          modelRoute: "openrouter/free",
        },
      });

      return {
        task,
        message,
        run,
        createdNewTask,
      };
    },
  );

  const [triggerRun] = await Promise.all([
    dispatchAgentRun(result.run.id),
    result.createdNewTask
      ? dispatchTaskTitleGeneration({
          taskId: result.task.id,
          messageId: result.message.id,
          userMessage: parsed.data.message,
        })
      : Promise.resolve(null),
  ]);

  await prisma.agentRun.update({
    where: {
      id: result.run.id,
    },
    data: {
      triggerRunId: triggerRun.id,
    },
  });

  return NextResponse.json(
    {
      taskId: result.task.id,
      messageId: result.message.id,
      runId: result.run.id,
      status: result.run.status,
      existing: false,
    },
    { status: 202 },
  );
}
