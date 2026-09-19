import { z } from "zod";

export type ToolExecutionContext = {
  userId: string;
  taskId: string;
  runId: string;
  toolCallId: string;
};

export type ToolContract<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> = {
  name: string;
  description: string;
  executionMode?: "inline" | "child";

  inputSchema: TInput;

  outputSchema: TOutput;

  execute: (
    input: z.infer<TInput>,
    context: ToolExecutionContext,
  ) => Promise<z.infer<TOutput>>;

  estimateCredits?: (
    input: z.infer<TInput>,
  ) => number;
};
