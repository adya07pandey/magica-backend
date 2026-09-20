import { runs } from "@trigger.dev/sdk";

import { prisma } from "../../lib/prisma";
import { settleCredits } from "../credits/credit.service";

const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING", "WAITING", "STOPPING"] as const;
const ACTIVE_WORK_STATUSES = ["QUEUED", "RUNNING"] as const;

export async function cancelAgentRun(runId: string) {
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      task: { select: { userId: true } },
      toolInvocations: {
        select: { triggerRunId: true },
      },
    },
  });

  if (!ACTIVE_RUN_STATUSES.includes(run.status as typeof ACTIVE_RUN_STATUSES[number])) {
    return run;
  }

  const now = new Date();
  const cancelled = await prisma.$transaction(async (tx) => {
    const transition = await tx.agentRun.updateMany({
      where: { id: run.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
      data: {
        status: "CANCELLED",
        cancelRequestedAt: run.cancelRequestedAt ?? now,
        cancelledAt: now,
        completedAt: now,
        errorCode: "CANCELLED",
        errorMessage: "Stopped by user",
      },
    });

    if (transition.count === 0) return false;

    await Promise.all([
      tx.runStep.updateMany({
        where: { runId: run.id, status: "RUNNING" },
        data: {
          status: "CANCELLED",
          completedAt: now,
          errorCode: "CANCELLED",
          errorMessage: "Stopped by user",
        },
      }),
      tx.toolInvocation.updateMany({
        where: { runId: run.id, status: { in: [...ACTIVE_WORK_STATUSES] } },
        data: {
          status: "CANCELLED",
          completedAt: now,
          errorCode: "CANCELLED",
          errorMessage: "Stopped by user",
        },
      }),
      tx.waitpoint.updateMany({
        where: { runId: run.id, status: "PENDING" },
        data: { status: "CANCELLED", resolvedAt: now },
      }),
    ]);

    return true;
  });

  if (!cancelled) {
    return prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
  }

  await releaseOpenReservations(run.id, run.task.userId);

  const triggerRunIds = [
    run.triggerRunId,
    ...run.toolInvocations.map((invocation) => invocation.triggerRunId),
  ].filter(
    (id): id is string => Boolean(id && !id.startsWith("local:")),
  );

  const cancellationResults = await Promise.allSettled(
    [...new Set(triggerRunIds)].map((triggerRunId) => runs.cancel(triggerRunId)),
  );
  for (const result of cancellationResults) {
    if (result.status === "rejected") {
      console.warn("Trigger run cancellation failed after local cancellation", result.reason);
    }
  }

  return prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
}

async function releaseOpenReservations(runId: string, userId: string) {
  const prefix = `credits:reserve:${runId}:`;
  const reservations = await prisma.creditLedger.findMany({
    where: {
      userId,
      referenceType: "AgentRun",
      referenceId: runId,
      type: "RESERVATION",
      idempotencyKey: { startsWith: prefix },
    },
    select: { amount: true, idempotencyKey: true },
  });

  await Promise.all(
    reservations.map((reservation) => {
      const toolCallId = reservation.idempotencyKey.slice(prefix.length);
      return settleCredits({
        userId,
        runId,
        reservedAmount: reservation.amount.abs(),
        actualAmount: 0,
        idempotencyKey: `credits:settle:${runId}:${toolCallId}`,
      });
    }),
  );
}
