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

  estimateCredits: (input) => {
    if (
      input.quality === "Low"
    ) {
      return 7_644;
    }

    if (
      input.quality === "Medium"
    ) {
      return 68_484;
    }

    return 273_936;
  },
} satisfies ToolContract<
  typeof GPTImage2InputSchema,
  typeof GPTImage2OutputSchema
>;
