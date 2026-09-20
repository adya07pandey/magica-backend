import { prisma } from "../../lib/prisma";
import { grantCredits } from "../credits/credit.service";

type ClerkUserInput = {
  clerkUserId: string;
  name?: string | null;
  email?: string | null;
};

export async function getOrCreateUser(input: ClerkUserInput) {
  const existing = await prisma.user.findUnique({
    where: { clerkUserId: input.clerkUserId },
  });

  if (existing) {
    await ensureInitialCredits(existing.id);
    return existing;
  }

  let user;

  try {
    user = await prisma.user.create({
      data: {
        clerkUserId: input.clerkUserId,
        name: input.name ?? null,
        email: input.email ?? null,
      },
    });
  } catch (error) {
    // Concurrent requests from Clerk can race the first user upsert.
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) {
      throw error;
    }

    user = await prisma.user.findUnique({
      where: { clerkUserId: input.clerkUserId },
    });

    if (!user) {
      throw error;
    }
  }

  await ensureInitialCredits(user.id);

  return user;
}

const INITIAL_CREDITS = 15_000_000;
const LEGACY_INITIAL_CREDITS = 1_000_000;

async function ensureInitialCredits(userId: string) {
  const currentGrantKey = `initial-credit-grant-v2:${userId}`;
  const currentGrant = await prisma.creditLedger.findUnique({
    where: { idempotencyKey: currentGrantKey },
    select: { id: true },
  });

  if (currentGrant) {
    return;
  }

  const legacyGrant = await prisma.creditLedger.findUnique({
    where: { idempotencyKey: `initial-credit-grant:${userId}` },
    select: { id: true },
  });

  await grantCredits({
    userId,
    amount: legacyGrant
      ? INITIAL_CREDITS - LEGACY_INITIAL_CREDITS
      : INITIAL_CREDITS,
    referenceType: "User",
    referenceId: userId,
    idempotencyKey: currentGrantKey,
  });
}
