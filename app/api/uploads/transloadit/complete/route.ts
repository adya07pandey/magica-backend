import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { persistTransloaditAssembly } from "@/src/modules/uploads/transloadit-persistence";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await request.json().catch(() => null);
  const result = await persistTransloaditAssembly(payload, user.id);
  return NextResponse.json(result.body, { status: result.status });
}
