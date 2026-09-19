import { NextResponse } from "next/server";

import { env } from "@/src/lib/env";
import { persistTransloaditAssembly } from "@/src/modules/uploads/transloadit-persistence";

export async function POST(request: Request) {
  // The browser uses the authenticated completion route. Keep this optional
  // fallback closed unless a deployment configures a shared webhook secret.
  if (!env.WEBHOOK_SECRET || request.headers.get("x-magica-webhook-secret") !== env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let payload: unknown;
  try {
    const formData = await request.formData();
    const raw = formData.get("transloadit");
    payload = typeof raw === "string" ? JSON.parse(raw) : await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const result = await persistTransloaditAssembly(payload);
  return NextResponse.json(result.body, { status: result.status });
}
