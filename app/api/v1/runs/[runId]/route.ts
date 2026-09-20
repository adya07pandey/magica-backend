import { NextResponse } from "next/server";

import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ runId: string }>;
  },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { runId } = await params;

  const run = await prisma.agentRun.findFirst({
    where: {
      id: runId,
      task: {
        userId: user.id,
      },
    },
    include: {
      steps: {
        orderBy: {
          stepNumber: "asc",
        },
      },
      toolInvocations: {
        orderBy: {
          createdAt: "asc",
        },
      },
      skills: true,
      waitpoints: {
        select: {
          id: true,
          token: true,
          type: true,
          status: true,
          payload: true,
          resolution: true,
          expiresAt: true,
          resolvedAt: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!run) {
    return NextResponse.json(
      { error: "Run not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    run: {
      ...run,
      totalCreditsUsed: run.actualCredits ?? 0,
    },
  });
}
