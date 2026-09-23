import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatchAgentRun } from "@/src/modules/agent/dispatch";
import { expireStaleQueuedRun } from "@/src/modules/runs/stale-run.service";
import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { getIdempotencyKey } from "@/src/lib/idempotency";
import { findActiveRun } from "@/src/modules/runs/run.service";
import { checkRateLimit } from "@/src/lib/rate-limit";
import { isPrismaUniqueConstraintError } from "@/src/lib/prisma-errors";
import { corsHeaders } from "@/src/lib/cors";

type Cursor = {
  createdAt: string;
  id: string;
};

const createMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(32_000, "Message is too long"),

  attachments: z
    .array(z.string().uuid())
    .default([]),
});

const updateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional(),

  isFavorite: z.boolean().optional(),
});

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

function logTiming(
  label: string,
  startedAt: number,
  details: Record<string, unknown> = {},
) {
  const durationMs = Date.now() - startedAt;
  const suffix = Object.keys(details).length
    ? ` ${JSON.stringify(details)}`
    : "";
  console.info(`[timing] ${label} ${durationMs}ms${suffix}`);
}

// =========================================================
// OPTIONS
// =========================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// =========================================================
// GET /api/tasks/[taskId]
// =========================================================
//
// Returns:
// - Task information
// - Cursor-paginated messages
//
// IMPORTANT:
// We DO NOT check for an active AgentRun here.
// The frontend needs to be able to poll/fetch the task
// while an agent is running.
// =========================================================

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ taskId: string }>;
  },
) {
  const requestStartedAt = Date.now();

  
  // -------------------------------------------------------
  // 1. Authentication
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
  // 2. Rate limiting
  // -------------------------------------------------------

  const rateLimit = await checkRateLimit(
    user.id,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests",
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Retry-After": String(
            rateLimit.retryAfterSeconds,
          ),
          "X-RateLimit-Limit": String(
            rateLimit.limit,
          ),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // -------------------------------------------------------
  // 3. Get task ID
  // -------------------------------------------------------

  const { taskId } = await params;

  // -------------------------------------------------------
  // 4. Parse pagination
  // -------------------------------------------------------

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

  const cursorValue =
    url.searchParams.get("cursor");

  let cursor: Cursor | null = null;

  if (cursorValue) {
    cursor = decodeCursor(cursorValue);

    if (!cursor) {
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
  }

  // -------------------------------------------------------
  // 5. Verify task ownership
  // -------------------------------------------------------

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      userId: user.id,
    },

    select: {
      id: true,
      title: true,
      isFavorite: true,
      parentTaskId: true,
      forkedFromMessageId: true,
      createdAt: true,
      updatedAt: true,
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

  // -------------------------------------------------------
  // 6. Fetch messages
  // -------------------------------------------------------

  const relatedDataStartedAt = Date.now();
  const [messages, pendingAttachments, queriedActiveRun] =
    await Promise.all([
      prisma.message.findMany({
        where: {
          taskId,

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

        take: requestedLimit + 1,

        include: {
          attachments: true,
          agentRuns: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
            select: {
              actualCredits: true,
            },
          },
        },
      }),

      prisma.attachment.findMany({
        where: {
          taskId,
          userId: user.id,
          messageId: null,
          toolInvocationId: null,
          status: {
            in: ["UPLOADING", "PROCESSING", "READY"],
          },
        },
        orderBy: {
          position: "asc",
        },
      }),

      prisma.agentRun.findFirst({
        where: {
          taskId,
          status: {
            in: [
              "QUEUED",
              "RUNNING",
              "WAITING",
              "STOPPING",
            ],
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          status: true,
          modelRoute: true,
          actualModel: true,
          stepCount: true,
          estimatedCredits: true,
          reservedCredits: true,
          actualCredits: true,
          errorCode: true,
          errorMessage: true,
          startedAt: true,
          createdAt: true,
          updatedAt: true,
          steps: {
            orderBy: {
              stepNumber: "asc",
            },
            select: {
              id: true,
              stepNumber: true,
              type: true,
              name: true,
              status: true,
              durationMs: true,
              creditsUsed: true,
              output: true,
              inputTokens: true,
              outputTokens: true,
              totalTokens: true,
              errorCode: true,
              errorMessage: true,
            },
          },
          toolInvocations: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              toolName: true,
              status: true,
              output: true,
              providerRunId: true,
              creditsUsed: true,
              durationMs: true,
              errorCode: true,
              errorMessage: true,
            },
          },
        },
      }),
    ]);
  const activeRun =
    queriedActiveRun &&
    (await expireStaleQueuedRun(queriedActiveRun))
      ? null
      : queriedActiveRun;

  logTiming(`task ${taskId} related data`, relatedDataStartedAt, {
    messages: messages.length,
    pendingAttachments: pendingAttachments.length,
    hasActiveRun: Boolean(activeRun),
  });

  // -------------------------------------------------------
  // 7. Determine whether another page exists
  // -------------------------------------------------------

  const hasMore =
    messages.length > requestedLimit;

  if (hasMore) {
    messages.pop();
  }

  // -------------------------------------------------------
  // 8. Create next cursor
  // -------------------------------------------------------

  const nextCursor =
    hasMore && messages.length > 0
      ? encodeCursor({
          createdAt:
            messages[
              messages.length - 1
            ].createdAt.toISOString(),

          id:
            messages[
              messages.length - 1
            ].id,
        })
      : null;

  // -------------------------------------------------------
  // 9. Reverse for chat UI
  // -------------------------------------------------------
  //
  // DB query:
  //
  // newest → oldest
  //
  // UI:
  //
  // oldest → newest
  // -------------------------------------------------------

  messages.reverse();

  let pendingRunCredits: string | null = null;
  const serializedMessages = messages.map((message) => {
    const runCredits =
      message.agentRuns[0]?.actualCredits?.toString() ?? null;
    const totalCreditsUsed =
      message.role === "ASSISTANT" ? pendingRunCredits : null;

    if (message.role === "USER") {
      pendingRunCredits = runCredits;
    } else if (message.role === "ASSISTANT") {
      pendingRunCredits = null;
    }

    const { agentRuns: _agentRuns, ...serializedMessage } = message;

    return {
      ...serializedMessage,
      totalCreditsUsed,
      attachments: message.attachments.map((attachment) => ({
        ...attachment,
        sizeBytes: attachment.sizeBytes.toString(),
      })),
    };
  });

  const serializedPendingAttachments = pendingAttachments.map(
    (attachment) => ({
      ...attachment,
      sizeBytes: attachment.sizeBytes.toString(),
    }),
  );

  // -------------------------------------------------------
  // 10. Response
  // -------------------------------------------------------

  const response = NextResponse.json(
    {
      task,

      messages: serializedMessages,

      pendingAttachments: serializedPendingAttachments,

      activeRun: activeRun
        ? {
            ...activeRun,
            totalCreditsUsed: activeRun.actualCredits ?? 0,
          }
        : null,

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
  logTiming(`task ${taskId} GET total`, requestStartedAt);
  return response;
}

// =========================================================
// PATCH /api/tasks/[taskId]
// =========================================================

export async function PATCH(
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
    updateTaskSchema.safeParse(body);

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

  if (
    parsed.data.title === undefined &&
    parsed.data.isFavorite === undefined
  ) {
    return NextResponse.json(
      {
        error:
          "At least one task field must be provided",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const taskStartedAt = Date.now();
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      userId: user.id,
    },
    select: {
      id: true,
    },
  });
  logTiming(`task ${taskId} ownership`, taskStartedAt);

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

  const updated =
    await prisma.task.update({
      where: {
        id: taskId,
      },
      data: parsed.data,
      select: {
        id: true,
        title: true,
        isFavorite: true,
        parentTaskId: true,
        forkedFromMessageId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

  return NextResponse.json(
    {
      task: updated,
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );


}

// =========================================================
// POST /api/tasks/[taskId]
// =========================================================
//
// Adds a USER message to an existing task.
//
// Flow:
//
// POST
//   ↓
// authenticate
//   ↓
// ownership
//   ↓
// validate
//   ↓
// idempotency
//   ↓
// active-run check
//   ↓
// DB transaction
//   ├── USER Message
//   └── AgentRun
//   ↓
// Trigger.dev
// =========================================================

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ taskId: string }>;
  },
) {
  // -------------------------------------------------------
  // 1. Authentication
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
  // 2. Rate limiting
  // -------------------------------------------------------

  const rateLimit = await checkRateLimit(
    user.id,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests",
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          ...corsHeaders,

          "Retry-After": String(
            rateLimit.retryAfterSeconds,
          ),

          "X-RateLimit-Limit": String(
            rateLimit.limit,
          ),

          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // -------------------------------------------------------
  // 3. Get task ID
  // -------------------------------------------------------

  const { taskId } = await params;

  // -------------------------------------------------------
  // 4. Verify task ownership
  // -------------------------------------------------------

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

  // -------------------------------------------------------
  // 5. Parse JSON
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
  // 6. Validate body
  // -------------------------------------------------------

  const parsed =
    createMessageSchema.safeParse(body);

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

  if (parsed.data.attachments.length > 0) {
    const validAttachmentCount =
      await prisma.attachment.count({
        where: {
          id: {
            in: parsed.data.attachments,
          },
          taskId,
          userId: user.id,
          messageId: null,
          status: "READY",
        },
      });

    if (validAttachmentCount !== parsed.data.attachments.length) {
      return NextResponse.json(
        {
          error:
            "One or more attachments are unavailable or still processing",
        },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }
  }

  // -------------------------------------------------------
  // 7. Get idempotency key
  // -------------------------------------------------------

  const idempotencyKey =
    getIdempotencyKey(request);

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error:
          "Missing or invalid Idempotency-Key header",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  // -------------------------------------------------------
  // 8. Idempotency lookup
  // -------------------------------------------------------
  //
  // MUST happen before active-run check.
  //
  // Example:
  //
  // Request A
  //   ↓
  // creates AgentRun
  //
  // Request A gets retried
  //   ↓
  // same Idempotency-Key
  //   ↓
  // return existing AgentRun
  //
  // We do NOT return ACTIVE_RUN in this case.
  // -------------------------------------------------------

  const existingRun =
    await prisma.agentRun.findUnique({
      where: {
        idempotencyKey,
      },

      include: {
        task: true,
        message: true,
      },
    });

  if (existingRun) {
    // -----------------------------------------------------
    // Prevent idempotency-key reuse across operations
    // -----------------------------------------------------

    if (
      existingRun.taskId !== taskId ||
      existingRun.task.userId !== user.id
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
        taskId:
          existingRun.taskId,

        messageId:
          existingRun.messageId,

        runId:
          existingRun.id,

        status:
          existingRun.status,

        existing: true,
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  }

  // -------------------------------------------------------
  // 9. Active-run protection
  // -------------------------------------------------------
  //
  // The frontend disables the composer while a run is active.
  //
  // This backend check protects against:
  //
  // - direct API calls
  // - race conditions
  // - duplicate submissions
  // - malicious clients
  // -------------------------------------------------------

  const activeRun =
    await findActiveRun(taskId);

  if (activeRun) {
    return NextResponse.json(
      {
        error:
          "Task already has an active agent run",

        runId:
          activeRun.id,

        status:
          activeRun.status,
      },
      {
        status: 409,
        headers: corsHeaders,
      },
    );
  }

  // -------------------------------------------------------
  // 10. Create USER Message + AgentRun atomically
  // -------------------------------------------------------

  try {
    const result =
      await prisma.$transaction(
        async (tx) => {
          // -----------------------------------------------
          // USER MESSAGE
          // -----------------------------------------------

          const message =
            await tx.message.create({
              data: {
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
            });

          if (parsed.data.attachments.length > 0) {
            await tx.attachment.updateMany({
              where: {
                id: {
                  in: parsed.data.attachments,
                },
                taskId,
                userId: user.id,
                messageId: null,
                status: "READY",
              },
              data: {
                messageId: message.id,
              },
            });
          }

          // -----------------------------------------------
          // AGENT RUN
          // -----------------------------------------------

          const run =
            await tx.agentRun.create({
              data: {
                taskId,

                messageId:
                  message.id,

                status: "QUEUED",

                idempotencyKey,

                modelRoute:
                  "openrouter/free",
              },
            });

          return {
            message,
            run,
          };
        },
      );

    // -----------------------------------------------------
    // 11. Dispatch durable agent execution
    // -----------------------------------------------------

    const triggerRun = await dispatchAgentRun(result.run.id);

    // -----------------------------------------------------
    // 12. Store Trigger.dev run ID
    // -----------------------------------------------------

    await prisma.agentRun.update({
      where: {
        id: result.run.id,
      },

      data: {
        triggerRunId:
          triggerRun.id,
      },
    });

    // -----------------------------------------------------
    // IMPORTANT
    // -----------------------------------------------------
    //
    // Summary generation is NOT triggered here.
    //
    // The agent must first finish the turn and create
    // the ASSISTANT message.
    //
    // Then agent-run.ts will check:
    //
    // "Have we reached every 3rd USER turn?"
    //
    // and trigger summary-update.
    // -----------------------------------------------------

    // -----------------------------------------------------
    // 13. Response
    // -----------------------------------------------------

    return NextResponse.json(
      {
        taskId,

        messageId:
          result.message.id,

        runId:
          result.run.id,

        status:
          result.run.status,

        existing: false,
      },
      {
        status: 201,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    // -------------------------------------------------------
    // 14. Handle idempotency race
    // -------------------------------------------------------
    //
    // Two identical requests could theoretically pass the
    // initial lookup at the same time.
    //
    // The DB unique constraint on:
    //
    // AgentRun.idempotencyKey
    //
    // is the final protection.
    // -------------------------------------------------------

    if (
      isPrismaUniqueConstraintError(
        error,
      )
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
          existingRunAfterRace.taskId !==
            taskId ||
          existingRunAfterRace.task.userId !==
            user.id
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
            taskId:
              existingRunAfterRace.taskId,

            messageId:
              existingRunAfterRace.messageId,

            runId:
              existingRunAfterRace.id,

            status:
              existingRunAfterRace.status,

            existing: true,
          },
          {
            status: 200,
            headers: corsHeaders,
          },
        );
      }
    }

    // -------------------------------------------------------
    // 15. Unexpected error
    // -------------------------------------------------------

    console.error(
      "POST /api/tasks/[taskId] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to create message",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}

// =========================================================
// DELETE /api/tasks/[taskId]
// =========================================================

export async function DELETE(
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

  await prisma.agentRun.updateMany({
    where: {
      taskId,
      status: {
        in: ["QUEUED", "RUNNING", "WAITING", "STOPPING"],
      },
    },
    data: {
      status: "CANCELLED",
      cancelRequestedAt: new Date(),
      cancelledAt: new Date(),
      completedAt: new Date(),
    },
  });

  await prisma.task.delete({
    where: {
      id: taskId,
    },
  });

  return NextResponse.json(
    {
      deleted: true,
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
}
