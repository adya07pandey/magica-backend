import { NextResponse } from "next/server";

import { prisma } from "@/src/lib/prisma";
import { corsHeaders } from "@/src/lib/cors";
import {
  attachmentStorageKey,
  isR2Configured,
  uploadAssetToR2,
} from "@/src/lib/storage/r2";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  SupportedMimeTypes,
} from "@/src/modules/uploads/transloadit";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "Cloudflare R2 is not configured" },
      { status: 503, headers: corsHeaders },
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart upload" },
      { status: 400, headers: corsHeaders },
    );
  }

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);

  if (files.length === 0 || files.length > MAX_ATTACHMENT_COUNT) {
    return NextResponse.json(
      { error: `Choose between 1 and ${MAX_ATTACHMENT_COUNT} files` },
      { status: 400, headers: corsHeaders },
    );
  }

  for (const file of files) {
    if (!SupportedMimeTypes.includes(file.type as never)) {
      return NextResponse.json(
        { error: `${file.name} has an unsupported file type` },
        { status: 400, headers: corsHeaders },
      );
    }

    if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `${file.name} must be between 1 byte and 512 MB` },
        { status: 400, headers: corsHeaders },
      );
    }
  }

  const requestedTaskId = formData.get("taskId");
  let taskId =
    typeof requestedTaskId === "string" && requestedTaskId
      ? requestedTaskId
      : undefined;

  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, userId: user.id },
      select: { id: true },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404, headers: corsHeaders },
      );
    }
  } else {
    const task = await prisma.task.create({
      data: { userId: user.id, title: "New Task" },
      select: { id: true },
    });
    taskId = task.id;
  }

  const uploaded = [];

  for (const [position, file] of files.entries()) {
    const attachment = await prisma.attachment.create({
      data: {
        userId: user.id,
        taskId,
        source: "UPLOAD",
        status: "PROCESSING",
        filename: file.name,
        mimeType: file.type,
        sizeBytes: BigInt(file.size),
        position,
      },
    });

    try {
      const stored = await uploadAssetToR2({
        body: file.stream(),
        storageKey: attachmentStorageKey({
          userId: user.id,
          taskId,
          attachmentId: attachment.id,
          filename: file.name,
        }),
        mimeType: file.type,
        sizeBytes: file.size,
      });

      const ready = await prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          status: "READY",
          storageKey: stored.storageKey,
          url: stored.url,
        },
      });
      uploaded.push({
        id: ready.id,
        filename: ready.filename,
        mimeType: ready.mimeType,
        status: ready.status,
        url: ready.url,
        sizeBytes: ready.sizeBytes.toString(),
        position: ready.position,
      });
    } catch (error) {
      await prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          status: "FAILED",
          metadata: {
            error:
              error instanceof Error ? error.message : "R2 upload failed",
          },
        },
      });
      throw error;
    }
  }

  return NextResponse.json(
    { taskId, attachments: uploaded },
    { headers: corsHeaders },
  );
}
