import { z } from "zod";

export const LoadSkillInputSchema = z.object({
  skillName: z.string().min(1),
});

export const LoadSkillOutputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  content: z.string(),
  contentHash: z.string().min(1),
});

export const ReadSkillAssetInputSchema = z.object({
  skillName: z.string().min(1),
  assetPath: z.string().min(1),
});

export const ReadSkillAssetOutputSchema = z.object({
  skillName: z.string().min(1),
  assetPath: z.string().min(1),
  content: z.string(),
  contentHash: z.string().min(1),
});

export type LoadSkillInput = z.infer<
  typeof LoadSkillInputSchema
>;

export type LoadSkillOutput = z.infer<
  typeof LoadSkillOutputSchema
>;

export type ReadSkillAssetInput = z.infer<
  typeof ReadSkillAssetInputSchema
>;

export type ReadSkillAssetOutput = z.infer<
  typeof ReadSkillAssetOutputSchema
>;
