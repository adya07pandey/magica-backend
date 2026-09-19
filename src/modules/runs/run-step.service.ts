import { prisma } from "../../lib/prisma";

export async function createRunStep(params: {
  runId: string;
  stepNumber: number;
  type: string;
  name: string;
  input?: unknown;
  model?: string;
  prompt?: string;
  metadata?: unknown;
}) {
  return prisma.runStep.create({
    data: {
      runId: params.runId,
      stepNumber: params.stepNumber,
      type: params.type,
      name: params.name,

      status: "RUNNING",
      startedAt: new Date(),

      model: params.model,
      prompt: params.prompt,

      input: params.input as object | undefined,
      metadata: params.metadata as object | undefined,
    },
  });
}

export async function completeRunStep(
  stepId: string,
  output?: unknown,
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  },
) {
  const completedAt = new Date();

  const step = await prisma.runStep.findUnique({
    where: {
      id: stepId,
    },
  });

  if (!step) {
    throw new Error(`RunStep ${stepId} not found`);
  }

  const durationMs = step.startedAt
    ? completedAt.getTime() - step.startedAt.getTime()
    : undefined;

  return prisma.runStep.update({
    where: {
      id: stepId,
    },
    data: {
      status: "COMPLETED",
      completedAt,
      durationMs,
      output: output as object | undefined,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
    },
  });
}

export async function failRunStep(
  stepId: string,
  error: unknown,
  errorCode?: string,
) {
  const completedAt = new Date();

  const step = await prisma.runStep.findUnique({
    where: {
      id: stepId,
    },
  });

  if (!step) {
    throw new Error(`RunStep ${stepId} not found`);
  }

  const durationMs = step.startedAt
    ? completedAt.getTime() - step.startedAt.getTime()
    : undefined;

  return prisma.runStep.update({
    where: {
      id: stepId,
    },
    data: {
      status: "FAILED",
      completedAt,
      durationMs,
      errorCode,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unknown error",
    },
  });
}
