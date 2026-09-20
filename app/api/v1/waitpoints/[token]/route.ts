import { NextResponse } from "next/server";
import { z } from "zod";

import { getIdempotencyKey } from "@/src/lib/idempotency";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { WaitpointResolutionSchema } from "@/src/modules/waitpoints/schemas";
import {
  resolveWaitpointForUser,
  WaitpointRequestError,
} from "@/src/modules/waitpoints/waitpoint.service";

const ResolveWaitpointSchema = z.object({
  resolution: WaitpointResolutionSchema,
});

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ token: string }>;
  },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const idempotencyKey =
    getIdempotencyKey(request);

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error:
          "Missing or invalid Idempotency-Key header",
      },
      { status: 400 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed =
    ResolveWaitpointSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details:
          parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { token } = await params;

  try {
    const waitpoint = await resolveWaitpointForUser({
      token,
      userId: user.id,
      idempotencyKey,
      resolution: parsed.data.resolution,
    });

    return NextResponse.json({
      waitpoint: {
        id: waitpoint.id,
        token: waitpoint.token,
        type: waitpoint.type,
        status: waitpoint.status,
        payload: waitpoint.payload,
        resolution: waitpoint.resolution,
        expiresAt: waitpoint.expiresAt,
        resolvedAt: waitpoint.resolvedAt,
      },
    });
  } catch (error) {
    if (error instanceof WaitpointRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
