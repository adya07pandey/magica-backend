import { createHmac } from "node:crypto";
import { z } from "zod";

import { env } from "../../lib/env";

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;

export const SupportedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
] as const;

export const AttachmentMetadataSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(SupportedMimeTypes),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_ATTACHMENT_BYTES),
});

export const CreateTransloaditParamsSchema =
  z.object({
    taskId: z.string().uuid().optional(),
    files: z
      .array(AttachmentMetadataSchema)
      .min(1)
      .max(MAX_ATTACHMENT_COUNT),
  });

export function createSignedAssemblyParams(params: {
  userId: string;
  taskId?: string;
}) {
  if (
    !env.TRANSLOADIT_KEY ||
    !env.TRANSLOADIT_SECRET
  ) {
    throw new Error(
      "Transloadit is not configured",
    );
  }

  const assemblyParams = {
    auth: {
      key: env.TRANSLOADIT_KEY,
      expires: new Date(
        Date.now() + 15 * 60 * 1000,
      ).toISOString(),
    },
    template_id:
      env.TRANSLOADIT_TEMPLATE_ID,
    fields: {
      userId: params.userId,
      ...(params.taskId
        ? { taskId: params.taskId }
        : {}),
    },
  };

  const serialized =
    JSON.stringify(assemblyParams);

  return {
    params: serialized,
    signature: signTransloaditParams(
      serialized,
    ),
  };
}

export function signTransloaditParams(
  serializedParams: string,
) {
  if (!env.TRANSLOADIT_SECRET) {
    throw new Error(
      "Transloadit secret is not configured",
    );
  }

  return createHmac(
    "sha384",
    env.TRANSLOADIT_SECRET,
  )
    .update(Buffer.from(serializedParams))
    .digest("hex");
}
