import { prisma } from "../../../lib/prisma";
import {
  loadSkill,
  readSkillAsset,
} from "../../skills/registry";
import type { ToolContract } from "../core/types";
import {
  LoadSkillInputSchema,
  LoadSkillOutputSchema,
  ReadSkillAssetInputSchema,
  ReadSkillAssetOutputSchema,
  type LoadSkillInput,
  type LoadSkillOutput,
  type ReadSkillAssetInput,
  type ReadSkillAssetOutput,
} from "./schema";

export const loadSkillTool: ToolContract<
  typeof LoadSkillInputSchema,
  typeof LoadSkillOutputSchema
> = {
  name: "load_skill",
  description:
    "Load the full instructions for a trusted application skill by name when the current turn needs that guidance.",
  inputSchema: LoadSkillInputSchema,
  outputSchema: LoadSkillOutputSchema,
  async execute(
    input: LoadSkillInput,
    context,
  ): Promise<LoadSkillOutput> {
    const skill = await loadSkill(input.skillName);

    await prisma.runSkill.upsert({
      where: {
        runId_skillName: {
          runId: context.runId,
          skillName: skill.name,
        },
      },
      update: {
        contentHash: skill.contentHash,
      },
      create: {
        runId: context.runId,
        skillName: skill.name,
        contentHash: skill.contentHash,
      },
    });

    return skill;
  },
};

export const readSkillAssetTool: ToolContract<
  typeof ReadSkillAssetInputSchema,
  typeof ReadSkillAssetOutputSchema
> = {
  name: "read_skill_asset",
  description:
    "Read a small trusted text asset from an already approved skill directory. Rejects traversal and unsupported files.",
  inputSchema: ReadSkillAssetInputSchema,
  outputSchema: ReadSkillAssetOutputSchema,
  async execute(
    input: ReadSkillAssetInput,
  ): Promise<ReadSkillAssetOutput> {
    return readSkillAsset(input);
  },
};
