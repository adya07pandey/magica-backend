import { prisma } from "../../lib/prisma";

export async function getTaskSummary(taskId: string) {
  return prisma.taskSummary.findUnique({
    where: {
      taskId,
    },
  });
}

export async function getUserMessageCount(taskId: string) {
  return prisma.message.count({
    where: {
      taskId,
      role: "USER",
    },
  });
}

export async function shouldUpdateSummary(taskId: string) {
  const count = await getUserMessageCount(taskId);

  return count > 0 && count % 3 === 0;
}

export async function getMessagesForSummary(taskId: string) {
  const summary = await getTaskSummary(taskId);

  // First summary: summarize the whole conversation.
  if (!summary?.summarizedThroughId) {
    return prisma.message.findMany({
      where: {
        taskId,
        role: {
          in: ["USER", "ASSISTANT"],
        },
      },
      orderBy: [
        {
          createdAt: "asc",
        },
        {
          id: "asc",
        },
      ],
    });
  }

  // Subsequent summaries:
  // only retrieve messages created after
  // the previous summary boundary.
  const boundary = await prisma.message.findUnique({
    where: {
      id: summary.summarizedThroughId,
    },
  });

  if (!boundary) {
    return [];
  }

  return prisma.message.findMany({
    where: {
      taskId,
      role: {
        in: ["USER", "ASSISTANT"],
      },

      OR: [
        {
          createdAt: {
            gt: boundary.createdAt,
          },
        },
        {
          createdAt: boundary.createdAt,
          id: {
            gt: boundary.id,
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
  });
}