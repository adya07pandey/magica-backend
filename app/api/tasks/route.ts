import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { Prisma } from "@/src/generated/prisma/client";
import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { getIdempotencyKey } from "@/src/lib/idempotency";
import { dispatchAgentRun } from "@/src/modules/agent/dispatch";
import { corsHeaders } from "@/src/lib/cors";
import { dispatchTaskTitleGeneration } from "@/src/modules/tasks/title-dispatch";

const createTaskSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(32_000, "Message is too long"),

  attachments: z
    .array(z.string().uuid())
    .default([]),
});

type Cursor = {
  createdAt: string;
  id: string;
};

function encodeCursor(cursor: Cursor) {
  return Buffer.from(
    JSON.stringify(cursor),
  ).toString("base64url");
}

function decodeCursor(
  value: string,
): Cursor | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(
        value,
        "base64url",
      ).toString("utf8"),
    );

    if (
      typeof decoded.createdAt !== "string" ||
      typeof decoded.id !== "string"
    ) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// ---------------------------------------------------------
// GET /api/tasks
//
// Returns the authenticated user's tasks.
// ---------------------------------------------------------

export async function GET(request: Request) {
  const requestStartedAt = Date.now();
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

  const url = new URL(request.url);

  const requestedLimit = Number(
    url.searchParams.get("limit") ?? "30",
  );

  if (
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 100
  ) {
    return NextResponse.json(
      {
        error: "limit must be between 1 and 100",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const search =
    url.searchParams.get("search")?.trim();

  const favoriteOnly =
    url.searchParams.get("favorite") === "true";

  const cursorValue =
    url.searchParams.get("cursor");

  const cursor = cursorValue
    ? decodeCursor(cursorValue)
    : null;

  if (cursorValue && !cursor) {
    return NextResponse.json(
      {
        error: "Invalid cursor",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const tasksList = await prisma.task.findMany({
    where: {
      userId: user.id,
      ...(favoriteOnly
        ? { isFavorite: true }
        : {}),
      ...(search
        ? {
            OR: [
              {
                title: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                messages: {
                  some: {
                    contentBlocks: {
                      path: ["text"],
                      string_contains: search,
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              {
                createdAt: {
                  lt: new Date(
                    cursor.createdAt,
                  ),
                },
              },
              {
                createdAt:
                  new Date(
                    cursor.createdAt,
                  ),
                id: {
                  lt: cursor.id,
                },
              },
            ],
          }
        : {}),
    },

    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],

    select: {
      id: true,
      title: true,
      isFavorite: true,
      parentTaskId: true,
      forkedFromMessageId: true,
      createdAt: true,
      updatedAt: true,
    },
    take: requestedLimit + 1,
  });

  const hasMore =
    tasksList.length > requestedLimit;

  if (hasMore) {
    tasksList.pop();
  }

  const nextCursor =
    hasMore && tasksList.length > 0
      ? encodeCursor({
          createdAt:
            tasksList[
              tasksList.length - 1
            ].createdAt.toISOString(),
          id:
            tasksList[
              tasksList.length - 1
            ].id,
        })
      : null;

  const response = NextResponse.json(
    {
      tasks: tasksList,
      pagination: {
        limit: requestedLimit,
        hasMore,
        nextCursor,
      },
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );

  logTiming("tasks GET total", requestStartedAt, {
    count: tasksList.length,
  });

  return response;
}

// ---------------------------------------------------------
// POST /api/tasks
//
// Creates:
//   1. Task
//   2. First USER Message
//   3. AgentRun
//
// Then dispatches the AgentRun to Trigger.dev.
// ---------------------------------------------------------

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  // -------------------------------------------------------
  // 1. Authenticate
  // -------------------------------------------------------

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

  // -------------------------------------------------------
  // 2. Parse JSON
  // -------------------------------------------------------

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

  // -------------------------------------------------------
  // 3. Validate request
  // -------------------------------------------------------

  const parsed = createTaskSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten(),
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  // -------------------------------------------------------
  // 4. Get Idempotency-Key
  // -------------------------------------------------------

  const idempotencyKey = getIdempotencyKey(request);

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error: "Missing or invalid Idempotency-Key header",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  // -------------------------------------------------------
  // 5. Check if this request was already processed
  // -------------------------------------------------------

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
    // The same idempotency key cannot be used by another user.
    if (existingRun.task.userId !== user.id) {
      return NextResponse.json(
        {
          error:
            "Idempotency key belongs to another operation",
        },
        {
          status: 409,
          headers: corsHeaders,
        },
      );
    }

    return NextResponse.json(
      {
        taskId: existingRun.taskId,
        messageId: existingRun.messageId,
        runId: existingRun.id,
        status: existingRun.status,
        existing: true,
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  }

  // -------------------------------------------------------
  // 6. Create Task + Message + AgentRun atomically
  // -------------------------------------------------------

  try {
    const taskId = randomUUID();
    const messageId = randomUUID();
    const runId = randomUUID();

    const [task, message, run] = await prisma.$transaction([
      prisma.task.create({
        data: {
          id: taskId,
          userId: user.id,
          title: "New Task",
        },
      }),
      prisma.message.create({
        data: {
          id: messageId,
          taskId,
          role: "USER",
          status: "COMPLETED",

          contentBlocks: [
            {
              type: "text",
              text: parsed.data.content,
            },
          ],
        },
      }),
      prisma.agentRun.create({
        data: {
          id: runId,
          taskId,
          messageId,

          status: "QUEUED",

          idempotencyKey,

          modelRoute: "openrouter/free",
        },
      }),
    ]);

    const result = { task, message, run };

    // ---------------------------------------------------
    // 7. Dispatch durable execution to Trigger.dev
    // ---------------------------------------------------

    const [triggerRun] = await Promise.all([
      dispatchAgentRun(result.run.id),
      dispatchTaskTitleGeneration({
        taskId: result.task.id,
        messageId: result.message.id,
        userMessage: parsed.data.content,
      }),
    ]);

    // ---------------------------------------------------
    // 8. Save Trigger.dev run ID
    // ---------------------------------------------------

    await prisma.agentRun.update({
      where: {
        id: result.run.id,
      },

      data: {
        triggerRunId: triggerRun.id,
      },
    });

    // ---------------------------------------------------
    // 9. Return result
    // ---------------------------------------------------

    const response = NextResponse.json(
      {
        taskId: result.task.id,
        messageId: result.message.id,
        runId: result.run.id,
        status: result.run.status,
        existing: false,
      },
      {
        status: 201,
        headers: corsHeaders,
      },
    );

    logTiming("tasks POST total", requestStartedAt, {
      taskId: result.task.id,
    });

    return response;
  } catch (error) {
    // ---------------------------------------------------
    // 10. Handle idempotency race
    //
    // Two identical requests can reach the database
    // simultaneously. The unique idempotencyKey constraint
    // protects us.
    // ---------------------------------------------------

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existingRunAfterRace =
        await prisma.agentRun.findUnique({
          where: {
            idempotencyKey,
          },

          include: {
            task: true,
            message: true,
          },
        });

      if (existingRunAfterRace) {
        if (
          existingRunAfterRace.task.userId !== user.id
        ) {
          return NextResponse.json(
            {
              error:
                "Idempotency key belongs to another operation",
            },
            {
              status: 409,
              headers: corsHeaders,
            },
          );
        }

        return NextResponse.json(
          {
            taskId: existingRunAfterRace.taskId,
            messageId: existingRunAfterRace.messageId,
            runId: existingRunAfterRace.id,
            status: existingRunAfterRace.status,
            existing: true,
          },
          {
            status: 200,
            headers: corsHeaders,
          },
        );
      }
    }

    console.error(
      "POST /api/tasks failed:",
      error,
    );

    return NextResponse.json(
      {
        error: "Failed to create task",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}

function logTiming(
  label: string,
  startedAt: number,
  details: Record<string, unknown> = {},
) {
  console.info(
    `[timing] ${label} ${Date.now() - startedAt}ms ${JSON.stringify(details)}`,
  );
}
