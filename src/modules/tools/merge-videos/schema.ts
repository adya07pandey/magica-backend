import { z } from "zod";

export const MergeVideosInputSchema =
  z.object({
    video_urls: z
      .array(z.string().url())
      .min(2)
      .max(100),

    transition: z.enum([
      "none",
      "fade",
      "dissolve",
    ]).default("none"),
  });

export const MergeVideosOutputSchema = z.object({
  providerRunId: z.string().min(1),

  status: z.enum([
    "QUEUED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
  ]),

  video_url: z
    .string()
    .url()
    .optional(),

  creditUsed: z
    .number()
    .nonnegative()
    .optional(),

  error: z.string().optional(),
});

export type MergeVideosInput =
  z.infer<typeof MergeVideosInputSchema>;

export type MergeVideosOutput =
  z.infer<typeof MergeVideosOutputSchema>;
