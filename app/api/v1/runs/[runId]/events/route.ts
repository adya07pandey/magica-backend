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
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  const { runId } = await params;

  const run = await prisma.agentRun.findFirst({
    where: {
      id: runId,
      task: {
        userId: user.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (!run) {
    return new Response("Run not found", {
      status: 404,
    });
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      let lastPayload = "";

      for (let i = 0; i < 120; i += 1) {
        if (cancelled) {
          return;
        }

        const snapshot =
          await prisma.agentRun.findUnique({
            where: {
              id: runId,
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
            },
          });

        const payload = JSON.stringify(
          snapshot
            ? {
                ...snapshot,
                totalCreditsUsed: snapshot.actualCredits ?? 0,
              }
            : snapshot,
        );

        if (payload !== lastPayload) {
          try {
            controller.enqueue(
              encoder.encode(
                `event: run.snapshot\ndata: ${payload}\n\n`,
              ),
            );
          } catch {
            return;
          }

          lastPayload = payload;
        }

        if (
          snapshot &&
          [
            "COMPLETED",
            "FAILED",
            "CANCELLED",
          ].includes(snapshot.status)
        ) {
          controller.close();
          return;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, 1_000),
        );
      }

      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
