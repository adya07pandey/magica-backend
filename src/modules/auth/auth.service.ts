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

  await grantCredits({
    userId: user.id,
    amount: 1_000_000,
    referenceType: "User",
    referenceId: user.id,
    idempotencyKey:
      `initial-credit-grant:${user.id}`,
  });

  return user;
}
