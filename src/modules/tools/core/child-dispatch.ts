import { tasks } from "@trigger.dev/sdk";

import { prisma } from "../../../lib/prisma";
import { getAgentExecutionMode } from "../../agent/execution-mode";
import {
  executeTool,
  executeToolInvocation,
  prepareToolInvocation,
} from "./execution-service";
import { getTool } from "./registry";
import type { ToolExecutionContext } from "./types";

export async function executeToolAsChild(params: {
  toolName: string;
  input: unknown;
  context: ToolExecutionContext;
  idempotencyKey: string;
}) {
  const tool = getTool(params.toolName);

  if (!("executionMode" in tool) || tool.executionMode !== "child") {
    return executeTool(params);
  }

  const invocation = await prepareToolInvocation(params);

  if (invocation.status === "COMPLETED") {
    return { invocation, output: invocation.output, reused: true };
  }

  const mode = getAgentExecutionMode();

  if (mode === "inline") {
    return executeToolInvocation({
      invocationId: invocation.id,
      context: params.context,
      triggerRunId: `local:${invocation.id}`,
    });
  }

  const result = await tasks.triggerAndWait(
    "tool-run",
    {
      invocationId: invocation.id,
      context: params.context,
    },
    {
      idempotencyKey: params.idempotencyKey,
      idempotencyKeyTTL: "24h",
    },
  );

  if (!result.ok) {
    throw new Error("Child tool run failed");
  }

  const completed = await prisma.toolInvocation.findUniqueOrThrow({
    where: { id: invocation.id },
  });

  if (completed.status !== "COMPLETED") {
    throw new Error(
      `Child tool run finished with invocation status ${completed.status}`,
    );
  }

  return { invocation: completed, output: completed.output, reused: false };
}
