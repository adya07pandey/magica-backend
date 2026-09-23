import { prisma } from "../../lib/prisma";
import { openRouterProvider } from "../agent/openrouter";
import type { AgentMessage } from "../agent/model.types";

const DEFAULT_TITLE = "New Task";

export async function generateAndSaveTaskTitle(params: {
  taskId: string;
  userMessage: string;
}) {
  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: { id: true, title: true },
  });

  if (!task || task.title !== DEFAULT_TITLE) {
    return { taskId: params.taskId, skipped: true };
  }

  const title = await generateTaskTitle(params.userMessage);

  const updated = await prisma.task.updateMany({
    where: {
      id: params.taskId,
      title: DEFAULT_TITLE,
    },
    data: { title },
  });

  return {
    taskId: params.taskId,
    title,
    updated: updated.count === 1,
  };
}

async function generateTaskTitle(userMessage: string) {
  const messages: AgentMessage[] = [
    {
      role: "system",
      content:
        "Create a short task title from the user's first message. Return only the title, no quotes, no markdown. Use 2 to 6 words when possible. Keep it under 60 characters.",
    },
    {
      role: "user",
      content: userMessage,
    },
  ];

  try {
    const response = await openRouterProvider.generate(messages, []);
    return normalizeTitle(response.content ?? "", userMessage);
  } catch (error) {
    console.warn("Task title generation failed", error);
    return fallbackTitle(userMessage);
  }
}

function normalizeTitle(rawTitle: string, userMessage: string) {
  const title = rawTitle
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) {
    return fallbackTitle(userMessage);
  }

  return title.length > 60 ? `${title.slice(0, 57).trim()}...` : title;
}

function fallbackTitle(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 60 ? `${compact.slice(0, 57).trim()}...` : compact;
}
