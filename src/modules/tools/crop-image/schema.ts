import { z } from "zod";

export const CropImageInputSchema = z
  .object({
    image_url: z.string().url(),

    x_percent: z.number().min(0).max(100).default(0),
    y_percent: z.number().min(0).max(100).default(0),

    width_percent: z
      .number()
      .positive()
      .max(100)
      .default(100),

    height_percent: z
      .number()
      .positive()
      .max(100)
      .default(100),

    width_px: z.number().int().positive().optional(),
    height_px: z.number().int().positive().optional(),

    x_px: z.number().int().min(0).optional(),
    y_px: z.number().int().min(0).optional(),
  })
  .superRefine((input, ctx) => {
    const hasWidthPx = input.width_px !== undefined;
    const hasHeightPx = input.height_px !== undefined;

    if (hasWidthPx !== hasHeightPx) {
      ctx.addIssue({
        code: "custom",
        message:
          "width_px and height_px must be provided together",
        path: ["width_px"],
      });
    }

    const hasXPx = input.x_px !== undefined;
    const hasYPx = input.y_px !== undefined;

    if (hasXPx !== hasYPx) {
      ctx.addIssue({
        code: "custom",
        message:
          "x_px and y_px must be provided together",
        path: ["x_px"],
      });
    }

    if (input.x_percent + input.width_percent > 100) {
      ctx.addIssue({
        code: "custom",
        message:
          "x_percent plus width_percent must not exceed 100",
        path: ["width_percent"],
      });
    }

    if (input.y_percent + input.height_percent > 100) {
      ctx.addIssue({
        code: "custom",
        message:
          "y_percent plus height_percent must not exceed 100",
        path: ["height_percent"],
      });
    }
  });

export const CropImageOutputSchema = z.object({
  providerRunId: z.string(),
  status: z.enum([
    "QUEUED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
  ]),
  image_url: z.string().url().optional(),
  creditUsed: z.number().nonnegative().optional(),
  error: z.string().optional(),
});

export type CropImageInput =
  z.infer<typeof CropImageInputSchema>;

export type CropImageOutput =
  z.infer<typeof CropImageOutputSchema>;
