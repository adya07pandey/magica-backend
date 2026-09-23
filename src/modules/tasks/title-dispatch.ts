import { tasks } from "@trigger.dev/sdk";

import { getAgentExecutionMode } from "../agent/execution-mode";
import { generateAndSaveTaskTitle } from "./title-generation.service";

export async function dispatchTaskTitleGeneration(params: {
  taskId: string;
  messageId: string;
  userMessage: string;
}) {
  const mode = getAgentExecutionMode();
  const idempotencyKey = `task-title:${params.taskId}:${params.messageId}`;

  if (mode !== "inline") {
    return tasks.trigger(
      "task-title",
      {
        taskId: params.taskId,
        userMessage: params.userMessage,
      },
      {
        idempotencyKey,
        idempotencyKeyTTL: "24h",
      },
    );
  }

  void generateAndSaveTaskTitle({
    taskId: params.taskId,
    userMessage: params.userMessage,
  });

  return { id: `local:${idempotencyKey}` };
}
