import { z } from "zod";

export const GPTImage2InputSchema = z.object({
  prompt: z.string().min(1).max(4000),

  size: z.enum([
    "Auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1152",
    "3840x2160",
    "2160x3840",
  ]).default("Auto"),

  quality: z.enum([
    "Low",
    "Medium",
    "High",
  ]).default("Low"),

  background: z
    .enum([
      "Auto",
      "Transparent",
      "Opaque",
    ])
    .default("Auto"),

  n: z.number().int().min(1).max(10).default(1),

  output_format: z
    .enum([
      "PNG",
      "JPEG",
      "WEBP",
    ])
    .default("PNG"),
});

export const GPTImage2OutputSchema = z.object({
  providerRunId: z.string().min(1),

  status: z.enum([
    "QUEUED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
  ]),

  image_urls: z.array(z.string().url()).default([]),

  creditUsed: z.number().nonnegative().optional(),

  error: z.string().optional(),
});

export type GPTImage2Input =
  z.infer<typeof GPTImage2InputSchema>;

export type GPTImage2Output =
  z.infer<typeof GPTImage2OutputSchema>;
