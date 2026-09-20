import { prisma } from "../../../lib/prisma";

export async function throwIfRunCancelled(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });

  if (!run || run.status === "STOPPING" || run.status === "CANCELLED") {
    throw new Error("Agent run cancelled");
  }
}
