import type { ToolContract } from "../core/types";

import {
  MergeVideosInputSchema,
  MergeVideosOutputSchema,
} from "./schema";

import { executeMergeVideos } from "./adapter";

export const mergeVideosTool = {
  name: "merge_videos",

  description:
    "Merge 2 to 100 attached or generated videos in the requested order. Use the exact video URLs from the conversation; keep query strings on signed URLs. Use transition none by default unless the user asks for fade or dissolve.",

  inputSchema: MergeVideosInputSchema,

  outputSchema: MergeVideosOutputSchema,

  execute: executeMergeVideos,

  estimateCredits: () => 400_000,
} satisfies ToolContract<
  typeof MergeVideosInputSchema,
  typeof MergeVideosOutputSchema
>;
