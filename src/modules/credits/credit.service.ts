import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { isPrismaUniqueConstraintError } from "../../lib/prisma-errors";

export async function getUserCreditBalance(userId: string) {
  const result = await prisma.creditLedger.aggregate({
    where: {
      userId,
    },
    _sum: {
      amount: true,
    },
  });

  return result._sum.amount ?? new Prisma.Decimal(0);
}

export async function grantCredits(params: {
  userId: string;
  amount: number | Prisma.Decimal;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
}) {
  const amount = toPositiveDecimal(params.amount);

  if (amount.isZero()) {
    return new Prisma.Decimal(0);
  }

  await createLedgerEntry({
    userId: params.userId,
    amount,
    type: "GRANT",
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    idempotencyKey: params.idempotencyKey,
  });

  return amount;
}

export async function reserveCredits(params: {
  userId: string;
  runId: string;
  amount: number | Prisma.Decimal;
  idempotencyKey: string;
}) {
  const amount = toPositiveDecimal(params.amount);

  if (amount.isZero()) {
    return new Prisma.Decimal(0);
  }

  const existing = await prisma.creditLedger.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    select: { id: true },
  });

  if (existing) {
    return amount;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const racedReservation = await tx.creditLedger.findUnique({
            where: { idempotencyKey: params.idempotencyKey },
            select: { id: true },
          });

          if (racedReservation) {
            return;
          }

          const result = await tx.creditLedger.aggregate({
            where: { userId: params.userId },
            _sum: { amount: true },
          });
          const balance = result._sum.amount ?? new Prisma.Decimal(0);

          if (balance.lessThan(amount)) {
            throw new Error("Insufficient credits");
          }

          await tx.creditLedger.create({
            data: {
              userId: params.userId,
              amount: amount.negated(),
              type: "RESERVATION",
              referenceType: "AgentRun",
              referenceId: params.runId,
              idempotencyKey: params.idempotencyKey,
            },
          });

          await tx.agentRun.update({
            where: { id: params.runId },
            data: {
              reservedCredits: { increment: amount },
              estimatedCredits: { increment: amount },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return amount;
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return amount;
      }

      if (isPrismaTransactionConflict(error) && attempt < 3) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to reserve credits");
}

export async function settleCredits(params: {
  userId: string;
  runId: string;
  reservedAmount: number | Prisma.Decimal;
  actualAmount: number | Prisma.Decimal;
  idempotencyKey: string;
}) {
  const reservedAmount =
    toPositiveDecimal(params.reservedAmount);

  const actualAmount =
    toPositiveDecimal(params.actualAmount);

  const releaseKey = `${params.idempotencyKey}:release`;
  const chargeKey = `${params.idempotencyKey}:charge`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const [existingRelease, existingCharge] = await Promise.all([
            reservedAmount.isZero()
              ? null
              : tx.creditLedger.findUnique({
                  where: { idempotencyKey: releaseKey },
                  select: { id: true },
                }),
            actualAmount.isZero()
              ? null
              : tx.creditLedger.findUnique({
                  where: { idempotencyKey: chargeKey },
                  select: { id: true },
                }),
          ]);

          if (!reservedAmount.isZero() && !existingRelease) {
            await tx.creditLedger.create({
              data: {
                userId: params.userId,
                amount: reservedAmount,
                type: "RELEASE",
                referenceType: "AgentRun",
                referenceId: params.runId,
                idempotencyKey: releaseKey,
              },
            });
          }

          let charged = false;
          if (!actualAmount.isZero() && !existingCharge) {
            await tx.creditLedger.create({
              data: {
                userId: params.userId,
                amount: actualAmount.negated(),
                type: "CHARGE",
                referenceType: "AgentRun",
                referenceId: params.runId,
                idempotencyKey: chargeKey,
              },
            });
            charged = true;
          }

          if (charged) {
            await tx.agentRun.update({
              where: { id: params.runId },
              data: { actualCredits: { increment: actualAmount } },
            });
          }

          return {
            released: !reservedAmount.isZero() && !existingRelease,
            charged,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return {
        released: result.released ? reservedAmount : new Prisma.Decimal(0),
        charged: result.charged ? actualAmount : new Prisma.Decimal(0),
      };
    } catch (error) {
      if (
        (isPrismaTransactionConflict(error) ||
          isPrismaUniqueConstraintError(error)) &&
        attempt < 3
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to settle credits");
}

export async function refundCredits(params: {
  userId: string;
  runId: string;
  amount: number | Prisma.Decimal;
  idempotencyKey: string;
}) {
  const amount = toPositiveDecimal(params.amount);

  if (amount.isZero()) {
    return new Prisma.Decimal(0);
  }

  await createLedgerEntry({
    userId: params.userId,
    amount,
    type: "REFUND",
    referenceType: "AgentRun",
    referenceId: params.runId,
    idempotencyKey: params.idempotencyKey,
  });

  return amount;
}

async function createLedgerEntry(params: {
  userId: string;
  amount: Prisma.Decimal;
  type:
    | "GRANT"
    | "RESERVATION"
    | "RELEASE"
    | "CHARGE"
    | "REFUND"
    | "ADJUSTMENT";
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
}) {
  try {
    const entry = await prisma.creditLedger.create({
      data: params,
    });
    return { entry, created: true };
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      const entry = await prisma.creditLedger.findUniqueOrThrow({
        where: {
          idempotencyKey: params.idempotencyKey,
        },
      });
      return { entry, created: false };
    }

    throw error;
  }
}

function toPositiveDecimal(
  value: number | Prisma.Decimal,
) {
  const decimal =
    value instanceof Prisma.Decimal
      ? value
      : new Prisma.Decimal(value);

  if (decimal.isNegative()) {
    throw new Error(
      "Credit amount must be non-negative",
    );
  }

  return decimal;
}

function isPrismaTransactionConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}
