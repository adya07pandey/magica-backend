import { z } from "zod";

const RawMagicaRunResponseSchema = z.object({
  // Magica deployments have returned each of these names. Normalize at the
  // boundary so tool adapters never need to know which gateway answered.
  providerRunId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  run_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).passthrough();

export const MagicaRunResponseSchema = RawMagicaRunResponseSchema.transform(
  (value, context) => {
    const providerRunId = value.providerRunId ?? value.runId ?? value.run_id ?? value.id;
    if (!providerRunId) {
      context.addIssue({
        code: "custom",
        message: "Magica start response did not include a run identifier",
      });
      return z.NEVER;
    }
    return { providerRunId };
  },
);

export const MagicaStatusResponseSchema = z.object({
  id: z.string().min(1),

  nodeType: z.string().min(1),

  status: z.enum([
    "QUEUED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
  ]),

  output: z
    .object({
      result: z.array(z.string()).optional(),
      image_url: z.string().url().optional(),
      image_urls: z.array(z.string().url()).optional(),
      video_url: z.string().url().optional(),
      video_urls: z.array(z.string().url()).optional(),
      creditUsed: z.number().nonnegative().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),

  error: z.string().nullable().optional(),

  creditUsed: z.number().nonnegative().optional(),

  createdAt: z.string().optional(),
});

export type MagicaStatusResponse =
  z.infer<typeof MagicaStatusResponseSchema>;
