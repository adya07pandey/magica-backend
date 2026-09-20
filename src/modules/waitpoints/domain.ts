import {
  UserInputResultSchema,
  WaitpointResolutionSchema,
  validateResolutionForRequest,
  type UserInputRequest,
  type WaitpointResolution,
} from "./schemas";

type ResolutionRecord = {
  ownerUserId: string;
  status: string;
  expiresAt: Date | null;
  resolution: unknown;
};

export type ResolutionDecision =
  | { kind: "ACCEPT" }
  | { kind: "DUPLICATE" }
  | { kind: "NOT_FOUND" }
  | { kind: "EXPIRED" }
  | { kind: "INVALID_RESOLUTION" }
  | { kind: "ALREADY_RESOLVED" }
  | { kind: "NOT_PENDING"; status: string };

export function classifyResolutionAttempt(params: {
  record: ResolutionRecord | null;
  request: UserInputRequest | null;
  userId: string;
  resolution: WaitpointResolution;
  now: Date;
}): ResolutionDecision {
  const { record, request, userId, resolution, now } = params;

  if (!record || record.ownerUserId !== userId || !request) {
    return { kind: "NOT_FOUND" };
  }

  if (!validateResolutionForRequest(request, resolution)) {
    return { kind: "INVALID_RESOLUTION" };
  }

  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    return { kind: "EXPIRED" };
  }

  if (record.status === "RESOLVED") {
    const existing = WaitpointResolutionSchema.safeParse(record.resolution);
    return existing.success && resolutionsEqual(existing.data, resolution)
      ? { kind: "DUPLICATE" }
      : { kind: "ALREADY_RESOLVED" };
  }

  if (record.status !== "PENDING") {
    return { kind: "NOT_PENDING", status: record.status };
  }

  return { kind: "ACCEPT" };
}

export function readCanonicalWaitpointResult(waitpoint: {
  status: string;
  resolution: unknown;
}) {
  if (waitpoint.status === "EXPIRED") {
    return UserInputResultSchema.parse({ status: "EXPIRED" });
  }

  if (waitpoint.status !== "RESOLVED") {
    return null;
  }

  return UserInputResultSchema.parse({
    status: "RESOLVED",
    resolution: WaitpointResolutionSchema.parse(waitpoint.resolution),
  });
}

function resolutionsEqual(
  left: WaitpointResolution,
  right: WaitpointResolution,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
