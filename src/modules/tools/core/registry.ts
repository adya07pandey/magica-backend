import {
  cropImageTool,
} from "../crop-image";

import {
  gptImage2Tool,
} from "../gpt-image-2";

import {
  mergeVideosTool,
} from "../merge-videos";

import {
  loadSkillTool,
  readSkillAssetTool,
} from "../skills";

export const toolRegistry = {
  load_skill: loadSkillTool,
  read_skill_asset:
    readSkillAssetTool,
  crop_image: cropImageTool,
  gpt_image_2: gptImage2Tool,
  merge_videos: mergeVideosTool,
} as const;

export type ToolName =
  keyof typeof toolRegistry;

export function getTool(
  name: string,
) {
  const tool =
    toolRegistry[
      name as ToolName
    ];

  if (!tool) {
    throw new Error(
      `Unknown tool: ${name}`,
    );
  }

  return tool;
}

export function getAllTools() {
  return Object.values(
    toolRegistry,
  );
}
