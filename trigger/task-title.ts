import { task } from "@trigger.dev/sdk";

import { generateAndSaveTaskTitle } from "../src/modules/tasks/title-generation.service";

type TaskTitlePayload = {
  taskId: string;
  userMessage: string;
};

export const taskTitleTask = task({
  id: "task-title",
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: TaskTitlePayload) => {
    return generateAndSaveTaskTitle(payload);
  },
});
