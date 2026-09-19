import { z } from "zod";

export type ToolExecutionContext = {
  userId: string;
  taskId: string;
  runId: string;
  toolCallId: string;
};

export type ToolContract<
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
> = {
  name: string;
  description: string;

  /**
   * JSON-schema-compatible representation sent to the model.
   */
  inputSchema: TInput;

  /**
   * Runtime validation of provider output.
   */
  outputSchema: TOutput;

  /**
   * Execute the actual tool.
   *
   * IMPORTANT:
   * This function receives already validated input.
   */
  execute: (
    input: z.infer<TInput>,
    context: ToolExecutionContext,
  ) => Promise<z.infer<TOutput>>;

  /**
   * Credit estimate for admission / UI.
   */
  estimateCredits?: (
    input: z.infer<TInput>,
  ) => number;
};