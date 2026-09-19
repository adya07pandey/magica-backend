import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/src/generated/prisma/client";
import { getIdempotencyKey } from "@/src/lib/idempotency";
import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";

const ResolveWaitpointSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  payload: z.unknown().optional(),
});

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ token: string }>;
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
    ResolveWaitpointSchema.safeParse(body);

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

  const { token } = await params;

  const waitpoint =
    await prisma.waitpoint.findFirst({
      where: {
        token,
        run: {
          task: {
            userId: user.id,
          },
        },
      },
      include: {
        run: true,
      },
    });

  if (!waitpoint) {
    return NextResponse.json(
      { error: "Waitpoint not found" },
      { status: 404 },
    );
  }

  if (
    waitpoint.idempotencyKey === idempotencyKey &&
    waitpoint.status !== "PENDING"
  ) {
    return NextResponse.json({
      waitpoint,
      existing: true,
    });
  }

  if (waitpoint.status !== "PENDING") {
    return NextResponse.json(
      {
        error:
          "Waitpoint has already been resolved",
      },
      { status: 409 },
    );
  }

  if (
    waitpoint.expiresAt &&
    waitpoint.expiresAt.getTime() < Date.now()
  ) {
    const expired =
      await prisma.waitpoint.update({
        where: {
          id: waitpoint.id,
        },
        data: {
          status: "EXPIRED",
          resolvedAt: new Date(),
        },
      });

    return NextResponse.json(
      {
        waitpoint: expired,
        error: "Waitpoint expired",
      },
      { status: 410 },
    );
  }

  const resolved =
    await prisma.waitpoint.update({
      where: {
        id: waitpoint.id,
      },
      data: {
        status:
          parsed.data.decision === "approve"
            ? "APPROVED"
            : "REJECTED",
        ...(parsed.data.payload === undefined
          ? {}
          : {
              payload:
                parsed.data.payload === null
                  ? Prisma.JsonNull
                  : (parsed.data
                      .payload as Prisma.InputJsonValue),
            }),
        resolvedAt: new Date(),
      },
    });

  await prisma.agentRun.update({
    where: {
      id: waitpoint.runId,
    },
    data: {
      status: "QUEUED",
    },
  });

  return NextResponse.json({
    waitpoint: resolved,
    existing: false,
  });
}
