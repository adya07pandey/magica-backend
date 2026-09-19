import { NextResponse } from "next/server";

import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/modules/auth/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const attachments = await prisma.attachment.findMany({
    where: { userId: user.id, status: "READY" },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true, filename: true, mimeType: true, status: true, url: true,
      sizeBytes: true, position: true,
    },
  });

  return NextResponse.json({
    attachments: attachments.map(({ sizeBytes, ...attachment }) => ({
      ...attachment,
      sizeBytes: sizeBytes.toString(),
    })),
  });
}
