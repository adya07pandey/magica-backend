import { prisma } from "../../lib/prisma";

const QUEUED_RUN_TIMEOUT_MS = 2 * 60 * 1000;

export async function expireStaleQueuedRun(run: {
  id: string;
  status: string;
  createdAt: Date;
}) {
  if (
    run.status !== "QUEUED" ||
    Date.now() - run.createdAt.getTime() < QUEUED_RUN_TIMEOUT_MS
  ) {
    return false;
  }

  const result = await prisma.agentRun.updateMany({
    where: {
      id: run.id,
      status: "QUEUED",
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorCode: "TRIGGER_START_TIMEOUT",
      errorMessage:
        "The background worker did not start this run. Please try again.",
    },
  });

  return result.count > 0;
}
