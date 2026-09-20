import type { ToolContract } from "../core/types";

import {
  GPTImage2InputSchema,
  GPTImage2OutputSchema,
} from "./schema";

import { executeGPTImage2 } from "./adapter";

export const gptImage2Tool = {
  name: "gpt_image_2",

  description:
    "Generate an image from a text prompt using GPT Image 2.",

  executionMode: "child",

  inputSchema: GPTImage2InputSchema,

  outputSchema: GPTImage2OutputSchema,

  execute: executeGPTImage2,

  estimateCredits: () => 270_000,
} satisfies ToolContract<
  typeof GPTImage2InputSchema,
  typeof GPTImage2OutputSchema
>;
