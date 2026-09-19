import { Prisma } from "../../generated/prisma/client";

import { prisma } from "../../lib/prisma";
import { IdempotencyConflictError } from "../../lib/errors";
import type { CreateTaskInput } from "./task.schemas";

type CreateTaskParams = {
  userId: string;
  input: CreateTaskInput;
  idempotencyKey: string;
};

export async function createTaskWithFirstMessage({
  userId,
  input,
  idempotencyKey,
}: CreateTaskParams) {
  const existingRun = await prisma.agentRun.findUnique({
    where: {
      idempotencyKey,
    },
    include: {
      task: true,
      message: true,
    },
  });

  if (existingRun) {
    if (existingRun.task.userId !== userId) {
      throw new IdempotencyConflictError();
    }

    return {
      task: existingRun.task,
      message: existingRun.message,
      run: existingRun,
      existing: true,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          userId,
          title: "New Task",
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
              text: input.content,
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
        existing: false,
      };
    });

    return result;
  } catch (error) {
    /*
     * Two identical requests can race:
     *
     * Request A → doesn't find the key
     * Request B → doesn't find the key
     *
     * Both try to create an AgentRun.
     *
     * PostgreSQL's UNIQUE constraint on AgentRun.idempotencyKey
     * guarantees that only one can succeed.
     */
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existingRun = await prisma.agentRun.findUnique({
        where: {
          idempotencyKey,
        },
        include: {
          task: true,
          message: true,
        },
      });

      if (!existingRun) {
        throw error;
      }

      if (existingRun.task.userId !== userId) {
        throw new IdempotencyConflictError();
      }

      return {
        task: existingRun.task,
        message: existingRun.message,
        run: existingRun,
        existing: true,
      };
    }

    throw error;
  }
}