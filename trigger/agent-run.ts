import { task } from "@trigger.dev/sdk";

import { prisma } from "../src/lib/prisma";
import {
  executeAgentRun,
  failAgentRunWebhook,
} from "../src/modules/agent/executor";
import { shouldUpdateSummary } from "../src/modules/agent/summary.service";

import { summaryUpdateTask } from "./summary-update";

type AgentRunPayload = {
  runId: string;
};

export const agentRunTask = task({
  id: "agent-run",

  retry: {
    maxAttempts: 1,
  },

  run: async (payload: AgentRunPayload) => {
    const { runId } = payload;

    try {
      const result =
        await executeAgentRun(runId);

      const run =
        await prisma.agentRun.findUniqueOrThrow({
          where: {
            id: runId,
          },
          select: {
            taskId: true,
          },
        });

      const userMessageCount =
        await prisma.message.count({
          where: {
            taskId: run.taskId,
            role: "USER",
          },
        });

      const updateSummary =
        await shouldUpdateSummary(
          run.taskId,
        );

      if (updateSummary) {
        await summaryUpdateTask.trigger(
          {
            taskId: run.taskId,
          },
          {
            idempotencyKey:
              `summary:${run.taskId}:${result.messageId}`,
            idempotencyKeyTTL: "24h",
          },
        );
      }

      return {
        runId,
        status: "COMPLETED",
        messageId: result.messageId,
        stepCount: result.stepCount,
        actualModel: result.actualModel,
        userMessageCount,
        summaryTriggered: updateSummary,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error";

      const run = await prisma.agentRun.findUniqueOrThrow({
        where: {
          id: runId,
        },
        select: {
          taskId: true,
          status: true,
        },
      });

      if (!["FAILED", "CANCELLED", "COMPLETED"].includes(run.status)) {
        await prisma.agentRun.update({
          where: {
            id: runId,
          },
          data: {
            status:
              message === "Agent run cancelled"
                ? "CANCELLED"
                : "FAILED",
            completedAt: new Date(),
            errorCode:
              message === "Agent run cancelled"
                ? "CANCELLED"
                : "AGENT_RUN_FAILED",
            errorMessage: message,
          },
        });
      }

      await failAgentRunWebhook({
        runId,
        taskId: run.taskId,
        error,
      });

      throw error;
    }
  },
});
