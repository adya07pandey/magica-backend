import { tasks } from "@trigger.dev/sdk";

import { prisma } from "../../lib/prisma";
import { executeAgentRun, failAgentRunWebhook } from "./executor";
import { getAgentExecutionMode } from "./execution-mode";

export async function dispatchAgentRun(runId: string) {
  try {
    const mode = getAgentExecutionMode();

    if (mode !== "inline") {
      return await tasks.trigger("agent-run", { runId });
    }

    const localRunId = `local:${runId}`;

    void executeAgentRun(runId).catch(async (error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      const run =
        await prisma.agentRun.updateManyAndReturn({
          where: { id: runId },
          data: {
            status: message === "Agent run cancelled" ? "CANCELLED" : "FAILED",
            completedAt: new Date(),
            errorCode:
              message === "Agent run cancelled" ? "CANCELLED" : "AGENT_RUN_FAILED",
            errorMessage: message,
          },
          select: {
            taskId: true,
          },
        });

      if (!run[0]) {
        return;
      }

      await failAgentRunWebhook({ runId, taskId: run[0].taskId, error });
    });

    return { id: localRunId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await prisma.agentRun.updateMany({
      where: { id: runId, status: "QUEUED" },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "AGENT_DISPATCH_FAILED",
        errorMessage: message,
      },
    });

    throw error;
  }
}
