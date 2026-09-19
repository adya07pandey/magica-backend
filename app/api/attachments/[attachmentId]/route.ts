import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/src/generated/prisma/client";

import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { signedAssetUrl } from "@/src/lib/storage/r2";

const SelectSchema = z.object({ taskId: z.string().uuid().optional() });

async function ownedAttachment(attachmentId: string, userId: string) {
  return prisma.attachment.findFirst({ where: { id: attachmentId, userId } });
}

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { attachmentId } = await context.params;
  const attachment = await ownedAttachment(attachmentId, user.id);
  if (!attachment || attachment.status !== "READY") return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  if (attachment.storageKey) {
    return NextResponse.redirect(await signedAssetUrl(attachment.storageKey));
  }
  if (attachment.url) return NextResponse.redirect(attachment.url);
  return NextResponse.json({ error: "Attachment is unavailable" }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { attachmentId } = await context.params;
  const parsed = SelectSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const source = await ownedAttachment(attachmentId, user.id);
  if (!source || source.status !== "READY") return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  let taskId = parsed.data.taskId;
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, userId: user.id }, select: { id: true } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  } else {
    const task = await prisma.task.create({ data: { userId: user.id, title: "New Task" }, select: { id: true } });
    taskId = task.id;
  }

  const attachment = await prisma.attachment.create({
    data: {
      userId: user.id, taskId, source: source.source, status: "READY",
      filename: source.filename, mimeType: source.mimeType, sizeBytes: source.sizeBytes,
      storageKey: source.storageKey, url: source.url,
      metadata: source.metadata === null ? Prisma.JsonNull : source.metadata as Prisma.InputJsonValue | undefined,
      position: source.position,
    },
  });
  return NextResponse.json({ taskId, attachment: { id: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType, status: attachment.status, url: attachment.url, sizeBytes: attachment.sizeBytes.toString(), position: attachment.position } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { attachmentId } = await context.params;
  const attachment = await ownedAttachment(attachmentId, user.id);
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  await prisma.attachment.update({ where: { id: attachment.id }, data: { status: "CANCELLED" } });
  return NextResponse.json({ cancelled: true });
}
