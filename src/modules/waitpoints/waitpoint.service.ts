import { randomUUID } from "node:crypto";

import { wait } from "@trigger.dev/sdk";

import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { isPrismaUniqueConstraintError } from "../../lib/prisma-errors";
import { getAgentExecutionMode } from "../agent/execution-mode";
import type { ToolExecutionContext } from "../tools/core/types";
import {
  StoredWaitpointPayloadSchema,
  UserInputResultSchema,
  WaitpointResolutionSchema,
  type UserInputRequest,
  type UserInputResult,
  type WaitpointResolution,
} from "./schemas";
import {
  classifyResolutionAttempt,
  readCanonicalWaitpointResult,
} from "./domain";

export class WaitpointRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WaitpointRequestError";
  }
}

export async function createAndWaitForUserInput(params: {
  request: UserInputRequest;
  context: ToolExecutionContext;
}): Promise<UserInputResult> {
  if (getAgentExecutionMode() !== "trigger") {
    throw new Error("User-input waitpoints require Trigger execution mode");
  }

  const idempotencyKey =
    `waitpoint:${params.context.runId}:${params.context.toolCallId}`;
  const expiresAt = new Date(
    Date.now() + params.request.expiresInMinutes * 60_000,
  );

  let persisted = await prisma.waitpoint.findUnique({
    where: { idempotencyKey },
  });

  if (!persisted) {
    try {
      persisted = await prisma.waitpoint.create({
        data: {
          runId: params.context.runId,
          token: randomUUID(),
          idempotencyKey,
          type: params.request.type,
          status: "PENDING",
          payload: {
            request: params.request,
          } as Prisma.InputJsonValue,
          expiresAt,
        },
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }

      persisted = await prisma.waitpoint.findUnique({
        where: { idempotencyKey },
      });

      if (!persisted) {
        const pending = await prisma.waitpoint.findFirst({
          where: { runId: params.context.runId, status: "PENDING" },
        });
        if (pending) {
          throw new Error("This run is already waiting for an important answer");
        }
        throw error;
      }
    }
  }

  const existingResult = readCanonicalWaitpointResult(persisted);
  if (existingResult) {
    await resumeRun(params.context.runId);
    return existingResult;
  }

  if (isExpired(persisted.expiresAt)) {
    return expireWaitpoint(persisted.id, params.context.runId);
  }

  let triggerTokenId = persisted.triggerTokenId;

  if (!triggerTokenId) {
    const triggerToken = await wait.createToken({
      timeout: `${params.request.expiresInMinutes}m`,
      idempotencyKey,
    });
    triggerTokenId = triggerToken.id;

    await prisma.waitpoint.updateMany({
      where: { id: persisted.id, triggerTokenId: null },
      data: { triggerTokenId },
    });

    persisted = await prisma.waitpoint.findUniqueOrThrow({
      where: { id: persisted.id },
    });
    triggerTokenId = persisted.triggerTokenId ?? triggerTokenId;
  } else {
    const triggerToken = await wait.retrieveToken<WaitpointResolution>(
      triggerTokenId,
    );

    if (triggerToken.status === "TIMED_OUT") {
      return expireWaitpoint(persisted.id, params.context.runId);
    }

    if (triggerToken.status === "COMPLETED") {
      const canonical = await prisma.waitpoint.findUniqueOrThrow({
        where: { id: persisted.id },
      });
      const repairedResult = readCanonicalWaitpointResult(canonical);
      if (repairedResult) {
        await resumeRun(params.context.runId);
        return repairedResult;
      }
      throw new Error("Trigger token completed without a canonical resolution");
    }
  }

  await prisma.agentRun.update({
    where: { id: params.context.runId },
    data: { status: "WAITING" },
  });

  const triggerResult = await wait.forToken<WaitpointResolution>(
    triggerTokenId,
  );

  if (!triggerResult.ok) {
    return expireWaitpoint(persisted.id, params.context.runId);
  }

  const canonical = await prisma.waitpoint.findUniqueOrThrow({
    where: { id: persisted.id },
  });
  const result = readCanonicalWaitpointResult(canonical);

  if (!result || result.status !== "RESOLVED") {
    throw new Error("Waitpoint resumed without a canonical stored resolution");
  }

  await resumeRun(params.context.runId);

  return result;
}

export async function resolveWaitpointForUser(params: {
  token: string;
  userId: string;
  idempotencyKey: string;
  resolution: WaitpointResolution;
}) {
  const outcome = await prisma.$transaction(async (tx) => {
    const waitpoint = await tx.waitpoint.findUnique({
      where: { token: params.token },
      include: {
        run: {
          select: {
            task: { select: { userId: true } },
          },
        },
      },
    });

    const stored = waitpoint
      ? StoredWaitpointPayloadSchema.safeParse(waitpoint.payload)
      : null;
    const decision = classifyResolutionAttempt({
      record: waitpoint
        ? {
            ownerUserId: waitpoint.run.task.userId,
            status: waitpoint.status,
            expiresAt: waitpoint.expiresAt,
            resolution: waitpoint.resolution,
          }
        : null,
      request: stored?.success ? stored.data.request : null,
      userId: params.userId,
      resolution: params.resolution,
      now: new Date(),
    });

    if (!waitpoint || decision.kind === "NOT_FOUND") {
      throw new WaitpointRequestError("Waitpoint not found", 404, "NOT_FOUND");
    }

    if (decision.kind === "INVALID_RESOLUTION") {
      throw new WaitpointRequestError(
        "Resolution does not match the requested response",
        400,
        "INVALID_RESOLUTION",
      );
    }

    if (decision.kind === "EXPIRED") {
      await tx.waitpoint.updateMany({
        where: { id: waitpoint.id, status: "PENDING" },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
      return { kind: "expired" as const };
    }

    if (decision.kind === "DUPLICATE") {
      return { kind: "duplicate" as const, waitpoint };
    }

    if (decision.kind === "ALREADY_RESOLVED") {
      throw new WaitpointRequestError(
        "Waitpoint has already been resolved",
        409,
        "ALREADY_RESOLVED",
      );
    }

    if (decision.kind === "NOT_PENDING") {
      throw new WaitpointRequestError(
        `Waitpoint is ${decision.status.toLowerCase()}`,
        409,
        "NOT_PENDING",
      );
    }

    const updated = await tx.waitpoint.updateMany({
      where: { id: waitpoint.id, status: "PENDING" },
      data: {
        status: "RESOLVED",
        resolution: params.resolution as Prisma.InputJsonValue,
        resolutionIdempotencyKey: params.idempotencyKey,
        resolvedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      const concurrent = await tx.waitpoint.findUniqueOrThrow({
        where: { id: waitpoint.id },
      });
      const concurrentResolution = WaitpointResolutionSchema.safeParse(
        concurrent.resolution,
      );
      if (
        concurrent.status === "RESOLVED" &&
        concurrentResolution.success &&
        JSON.stringify(concurrentResolution.data) ===
          JSON.stringify(params.resolution)
      ) {
        return { kind: "duplicate" as const, waitpoint: concurrent };
      }
      throw new WaitpointRequestError(
        "Waitpoint was resolved concurrently",
        409,
        "CONCURRENT_RESOLUTION",
      );
    }

    return {
      kind: "resolved" as const,
      waitpoint: await tx.waitpoint.findUniqueOrThrow({
        where: { id: waitpoint.id },
      }),
    };
  });

  if (outcome.kind === "expired") {
    throw new WaitpointRequestError("Waitpoint expired", 410, "EXPIRED");
  }

  const resolved = outcome.waitpoint;

  if (!resolved.triggerTokenId) {
    throw new WaitpointRequestError(
      "Waitpoint is not ready for completion",
      409,
      "TOKEN_NOT_READY",
    );
  }

  await completeOrReconcileTriggerToken(
    resolved.triggerTokenId,
    params.resolution,
  );

  return resolved;
}

async function expireWaitpoint(waitpointId: string, runId: string) {
  await prisma.$transaction([
    prisma.waitpoint.updateMany({
      where: { id: waitpointId, status: "PENDING" },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    }),
    prisma.agentRun.updateMany({
      where: { id: runId, status: "WAITING" },
      data: { status: "RUNNING" },
    }),
  ]);

  return UserInputResultSchema.parse({ status: "EXPIRED" });
}

async function resumeRun(runId: string) {
  await prisma.agentRun.updateMany({
    where: { id: runId, status: "WAITING" },
    data: { status: "RUNNING" },
  });
}

async function completeOrReconcileTriggerToken(
  triggerTokenId: string,
  resolution: WaitpointResolution,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const triggerToken = await wait.retrieveToken<WaitpointResolution>(
        triggerTokenId,
      );

      if (triggerToken.status === "COMPLETED") {
        return;
      }

      if (triggerToken.status !== "WAITING") {
        throw new WaitpointRequestError(
          "The durable wait token can no longer be completed",
          409,
          "TOKEN_NOT_WAITING",
        );
      }

      await wait.completeToken(triggerTokenId, resolution);
      return;
    } catch (error) {
      if (error instanceof WaitpointRequestError) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

function isExpired(expiresAt: Date | null) {
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
}
