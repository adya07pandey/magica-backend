import type { ToolContract } from "../core/types";

import {
  CropImageInputSchema,
  CropImageOutputSchema,
} from "./schema";

import { executeCropImage } from "./adapter";

export const cropImageTool = {
  name: "crop_image",

  description:
    "Crop an attached or previously generated image. Use the exact image URL from the conversation. Percentage coordinates start at the top-left; x_percent + width_percent and y_percent + height_percent must each be at most 100. For pixel crops, provide width_px and height_px together, and provide x_px and y_px together when setting an offset.",

  inputSchema: CropImageInputSchema,

  outputSchema: CropImageOutputSchema,

  execute: executeCropImage,

  estimateCredits: () => 5_000,
} satisfies ToolContract<
  typeof CropImageInputSchema,
  typeof CropImageOutputSchema
>;
