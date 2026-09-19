import { NextResponse } from "next/server";

import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { isR2Configured } from "@/src/lib/storage/r2";
import {
  CreateTransloaditParamsSchema,
  createSignedAssemblyParams,
} from "@/src/modules/uploads/transloadit";
import { corsHeaders } from "@/src/lib/cors";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "Cloudflare R2 is not configured. Add the R2 environment variables before uploading files." },
      { status: 503, headers: corsHeaders },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders },
    );
  }

  const parsed =
    CreateTransloaditParamsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details:
          parsed.error.flatten(),
      },
      { status: 400, headers: corsHeaders },
    );
  }

  let uploadTaskId = parsed.data.taskId;

  if (uploadTaskId) {
    const task = await prisma.task.findFirst({
      where: {
        id: uploadTaskId,
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404, headers: corsHeaders },
      );
    }
  } else {
    const draftTask = await prisma.task.create({
      data: {
        userId: user.id,
        title: "New Task",
      },
      select: {
        id: true,
      },
    });
    uploadTaskId = draftTask.id;
  }

  try {
    const signed =
      createSignedAssemblyParams({
        userId: user.id,
        taskId: uploadTaskId,
      });

    return NextResponse.json(
      {
        ...signed,
        taskId: uploadTaskId,
        limits: {
          maxFiles: 10,
          maxFileBytes:
            512 * 1024 * 1024,
        },
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload signing failed",
      },
      { status: 500, headers: corsHeaders },
    );
  }
}
