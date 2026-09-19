import { NextResponse } from "next/server";

import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { findActiveRun } from "@/src/modules/runs/run.service";
import { corsHeaders } from "@/src/lib/cors";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ taskId: string }>;
  },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  const { taskId } = await params;

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      userId: user.id,
    },
    select: {
      id: true,
    },
  });

  if (!task) {
    return NextResponse.json(
      {
        error: "Task not found",
      },
      {
        status: 404,
        headers: corsHeaders,
      },
    );
  }

  const activeRun =
    await findActiveRun(taskId);

  if (!activeRun) {
    return NextResponse.json(
      {
        error: "Task has no active agent run",
        code: "NO_ACTIVE_RUN",
      },
      {
        status: 409,
        headers: corsHeaders,
      },
    );
  }

  const run = await prisma.agentRun.update({
    where: {
      id: activeRun.id,
    },
    data: {
      status: "STOPPING",
      cancelRequestedAt: new Date(),
    },
    select: {
      id: true,
      status: true,
      cancelRequestedAt: true,
    },
  });

  return NextResponse.json(
    {
      run,
    },
    {
      status: 202,
      headers: corsHeaders,
    },
  );
}
