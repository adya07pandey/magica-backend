import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/src/generated/prisma/client";
import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { corsHeaders } from "@/src/lib/cors";

const forkTaskSchema = z.object({
  messageId: z.string().uuid(),
});

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(
  request: Request,
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON body",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const parsed =
    forkTaskSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details:
          parsed.error.flatten(),
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const sourceTask =
    await prisma.task.findFirst({
      where: {
        id: taskId,
        userId: user.id,
      },
      select: {
        id: true,
        title: true,
      },
    });

  if (!sourceTask) {
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

  const forkPoint =
    await prisma.message.findFirst({
      where: {
        id: parsed.data.messageId,
        taskId,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

  if (!forkPoint) {
    return NextResponse.json(
      {
        error: "Fork point not found",
      },
      {
        status: 404,
        headers: corsHeaders,
      },
    );
  }

  const messagesToCopy =
    await prisma.message.findMany({
      where: {
        taskId,
        OR: [
          {
            createdAt: {
              lt: forkPoint.createdAt,
            },
          },
          {
            createdAt: forkPoint.createdAt,
            id: {
              lte: forkPoint.id,
            },
          },
        ],
      },
      orderBy: [
        {
          createdAt: "asc",
        },
        {
          id: "asc",
        },
      ],
      select: {
        role: true,
        status: true,
        contentBlocks: true,
        createdAt: true,
      },
    });

  const forkedTask =
    await prisma.$transaction(
      async (tx) => {
        const task = await tx.task.create({
          data: {
            userId: user.id,
            title: `${sourceTask.title} fork`,
            parentTaskId: taskId,
            forkedFromMessageId:
              forkPoint.id,
          },
        });

        if (messagesToCopy.length > 0) {
          await tx.message.createMany({
            data: messagesToCopy.map(
              (message) => ({
                taskId: task.id,
                role: message.role,
                status: message.status,
                contentBlocks:
                  message.contentBlocks as Prisma.InputJsonValue,
                createdAt:
                  message.createdAt,
              }),
            ),
          });
        }

        return task;
      },
    );

  return NextResponse.json(
    {
      task: forkedTask,
      copiedMessages:
        messagesToCopy.length,
    },
    {
      status: 201,
      headers: corsHeaders,
    },
  );
}
