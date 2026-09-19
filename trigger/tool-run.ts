import { task } from "@trigger.dev/sdk";

import { executeToolInvocation } from "../src/modules/tools/core/execution-service";
import type { ToolExecutionContext } from "../src/modules/tools/core/types";

type ToolRunPayload = {
  invocationId: string;
  context: ToolExecutionContext;
};

export const toolRunTask = task({
  id: "tool-run",
  retry: { maxAttempts: 3 },
  run: async (payload: ToolRunPayload, { ctx }) => {
    const result = await executeToolInvocation({
      invocationId: payload.invocationId,
      context: payload.context,
      triggerRunId: ctx.run.id,
    });

    return {
      invocationId: result.invocation.id,
      toolName: result.invocation.toolName,
      status: result.invocation.status,
      providerRunId: result.invocation.providerRunId,
      creditsUsed: result.invocation.creditsUsed?.toString() ?? null,
      durationMs: result.invocation.durationMs,
    };
  },
});
