import { prisma } from "../../lib/prisma";

const ACTIVE_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING",
  "STOPPING",
] as const;

export async function findActiveRun(taskId: string) {
  return prisma.agentRun.findFirst({
    where: {
      taskId,
      status: {
        in: [...ACTIVE_RUN_STATUSES],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function markRunRunning(runId: string) {
  return prisma.agentRun.update({
    where: {
      id: runId,
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

export async function markRunCompleted(runId: string) {
  return prisma.agentRun.update({
    where: {
      id: runId,
    },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
}

export async function markRunFailed(
  runId: string,
  error: unknown,
) {
  const errorMessage =
    error instanceof Error
      ? error.message
      : "Unknown error";

  return prisma.agentRun.update({
    where: {
      id: runId,
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage,
    },
  });
}