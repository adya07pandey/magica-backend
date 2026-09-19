import { task } from "@trigger.dev/sdk";

import { prisma } from "../src/lib/prisma";

import {
  getTaskSummary,
  getMessagesForSummary,
} from "../src/modules/agent/summary.service";

import { extractText } from "../src/modules/agent/message-content";

type SummaryPayload = {
  taskId: string;
};

export const summaryUpdateTask = task({
  id: "summary-update",

  retry: {
    maxAttempts: 3,
  },

  run: async (payload: SummaryPayload) => {
    const { taskId } = payload;

    console.log(
      "Starting summary update:",
      taskId,
    );

    const task = await prisma.task.findUnique({
      where: {
        id: taskId,
      },
    });

    if (!task) {
      throw new Error(
        `Task ${taskId} not found`,
      );
    }

    const existingSummary =
      await getTaskSummary(taskId);

    const messages =
      await getMessagesForSummary(taskId);

    if (messages.length === 0) {
      console.log(
        "No new messages to summarize.",
      );

      return {
        taskId,
        status: "NO_UPDATE",
      };
    }

    const conversationText = messages
      .map((message) => {
        const text = extractText(
          message.contentBlocks,
        );

        return `${message.role}: ${text}`;
      })
      .filter(Boolean)
      .join("\n\n");

    /*
     * For now this is deliberately a placeholder.
     *
     * In the next step we'll replace this with
     * the actual summarization model call.
     */
    const newSummary = existingSummary
      ? `${existingSummary.content}\n\n${conversationText}`
      : conversationText;

    const lastMessage =
      messages[messages.length - 1];

    await prisma.taskSummary.upsert({
      where: {
        taskId,
      },

      create: {
        taskId,
        content: newSummary,
        summarizedUserTurns:
          await prisma.message.count({
            where: {
              taskId,
              role: "USER",
            },
          }),
        summarizedThroughId:
          lastMessage.id,
      },

      update: {
        content: newSummary,
        summarizedUserTurns:
          await prisma.message.count({
            where: {
              taskId,
              role: "USER",
            },
          }),
        summarizedThroughId:
          lastMessage.id,
      },
    });

    console.log(
      "Summary updated:",
      taskId,
    );

    return {
      taskId,
      status: "COMPLETED",
      summarizedThroughId:
        lastMessage.id,
    };
  },
});