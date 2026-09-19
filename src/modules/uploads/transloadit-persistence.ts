import { z } from "zod";

import { prisma } from "@/src/lib/prisma";
import { attachmentStorageKey, copyRemoteAssetToR2, isR2Configured } from "@/src/lib/storage/r2";
import { AttachmentMetadataSchema, SupportedMimeTypes } from "./transloadit";

const ResultSchema = z.object({
  id: z.string().optional(), name: z.string().optional(), basename: z.string().optional(),
  mime: z.string().optional(), size: z.number().optional(), ssl_url: z.string().url().optional(), url: z.string().url().optional(),
});
const AssemblySchema = z.object({
  assembly_id: z.string().min(1), ok: z.string().optional(),
  fields: z.object({ userId: z.string().uuid(), taskId: z.string().uuid().optional() }).passthrough(),
  results: z.record(z.string(), z.array(ResultSchema)).default({}),
});

export async function persistTransloaditAssembly(payload: unknown, expectedUserId?: string) {
  const parsed = AssemblySchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "Invalid upload completion payload", details: parsed.error.flatten() } };
  if (expectedUserId && parsed.data.fields.userId !== expectedUserId) return { status: 403, body: { error: "Upload does not belong to this user" } };
  const taskId = parsed.data.fields.taskId;
  if (!taskId) return { status: 200, body: { ok: true, persisted: 0 } };
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: parsed.data.fields.userId }, select: { id: true } });
  if (!task) return { status: 404, body: { error: "Task not found" } };
  let persisted = 0;
  for (const [index, result] of Object.values(parsed.data.results).flat().entries()) {
    const mimeType = result.mime;
    if (!mimeType || !SupportedMimeTypes.includes(mimeType as never)) continue;
    const metadata = AttachmentMetadataSchema.safeParse({ filename: result.name ?? result.basename ?? "upload", mimeType, sizeBytes: result.size ?? 0 });
    if (!metadata.success) continue;
    const sourceUrl = result.ssl_url ?? result.url;
    const existing = await prisma.attachment.findFirst({ where: { taskId, transloaditAssemblyId: parsed.data.assembly_id, position: index } });
    const attachment = existing ?? await prisma.attachment.create({
      data: { userId: parsed.data.fields.userId, taskId, source: "UPLOAD", status: "PROCESSING", filename: metadata.data.filename, mimeType: metadata.data.mimeType, sizeBytes: BigInt(metadata.data.sizeBytes), url: sourceUrl, transloaditAssemblyId: parsed.data.assembly_id, position: index, metadata: result },
    });
    if (parsed.data.ok === "ASSEMBLY_COMPLETED" && sourceUrl) {
      try {
        if (!isR2Configured()) throw new Error("Cloudflare R2 is not configured");
        const stored = await copyRemoteAssetToR2({ sourceUrl, storageKey: attachmentStorageKey({ userId: parsed.data.fields.userId, taskId, attachmentId: attachment.id, filename: metadata.data.filename }), mimeType });
        await prisma.attachment.update({ where: { id: attachment.id }, data: { status: "READY", storageKey: stored.storageKey, url: stored.url } });
      } catch (error) {
        await prisma.attachment.update({ where: { id: attachment.id }, data: { status: "FAILED", metadata: { ...result, error: error instanceof Error ? error.message : "R2 persistence failed" } } });
      }
    }
    persisted += 1;
  }
  return { status: 200, body: { ok: true, persisted } };
}
