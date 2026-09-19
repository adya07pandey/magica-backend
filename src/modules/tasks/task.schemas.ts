import { z } from "zod";

export const createTaskSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(32_000, "Message is too long"),

  attachments: z
    .array(z.string().uuid())
    .default([]),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;