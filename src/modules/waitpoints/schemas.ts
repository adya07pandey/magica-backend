import { z } from "zod";

export const WaitpointImportanceSchema = z.enum([
  "IRREVERSIBLE_ACTION",
  "MATERIAL_AMBIGUITY",
  "HIGH_IMPACT_CHOICE",
]);

const CommonRequestSchema = z.object({
  question: z.string().trim().min(12).max(500),
  importance: WaitpointImportanceSchema,
  whyItMatters: z.string().trim().min(12).max(300),
  expiresInMinutes: z.coerce.number().int().min(5).max(1_440).default(30),
});

const ApprovalRequestSchema = CommonRequestSchema.extend({
  type: z.literal("APPROVAL"),
});

const OptionsRequestSchema = CommonRequestSchema.extend({
  type: z.literal("OPTIONS"),
  options: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(100),
        description: z.string().trim().min(1).max(240),
      }),
    )
    .min(2)
    .max(4)
    .superRefine((options, context) => {
      if (new Set(options.map((option) => option.id)).size !== options.length) {
        context.addIssue({
          code: "custom",
          message: "Option IDs must be unique",
        });
      }
    }),
});

export const UserInputRequestSchema = z.discriminatedUnion("type", [
  ApprovalRequestSchema,
  OptionsRequestSchema,
]);

export const WaitpointResolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approval"),
    decision: z.enum(["approve", "reject"]),
  }),
  z.object({
    kind: z.literal("option"),
    optionId: z.string().trim().min(1).max(80),
  }),
]);

export const StoredWaitpointPayloadSchema = z.object({
  request: UserInputRequestSchema,
});

export const UserInputResultSchema = z.object({
  status: z.enum(["RESOLVED", "EXPIRED"]),
  resolution: WaitpointResolutionSchema.optional(),
});

export type UserInputRequest = z.infer<typeof UserInputRequestSchema>;
export type WaitpointResolution = z.infer<typeof WaitpointResolutionSchema>;
export type UserInputResult = z.infer<typeof UserInputResultSchema>;

export function validateResolutionForRequest(
  request: UserInputRequest,
  resolution: WaitpointResolution,
) {
  if (request.type === "APPROVAL") {
    return resolution.kind === "approval";
  }

  return (
    resolution.kind === "option" &&
    request.options.some((option) => option.id === resolution.optionId)
  );
}
