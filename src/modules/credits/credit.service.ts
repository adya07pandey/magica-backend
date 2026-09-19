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

  const balance =
    await getUserCreditBalance(params.userId);

  if (balance.lessThan(amount)) {
    throw new Error("Insufficient credits");
  }

  const reservation = await createLedgerEntry({
    userId: params.userId,
    amount: amount.negated(),
    type: "RESERVATION",
    referenceType: "AgentRun",
    referenceId: params.runId,
    idempotencyKey: params.idempotencyKey,
  });

  if (reservation.created) {
    await prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        reservedCredits: { increment: amount },
        estimatedCredits: { increment: amount },
      },
    });
  }

  return amount;
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

  let released = false;
  let charged = false;

  if (!reservedAmount.isZero()) {
    const release = await createLedgerEntry({
      userId: params.userId,
      amount: reservedAmount,
      type: "RELEASE",
      referenceType: "AgentRun",
      referenceId: params.runId,
      idempotencyKey:
        `${params.idempotencyKey}:release`,
    });
    released = release.created;
  }

  if (!actualAmount.isZero()) {
    const charge = await createLedgerEntry({
      userId: params.userId,
      amount: actualAmount.negated(),
      type: "CHARGE",
      referenceType: "AgentRun",
      referenceId: params.runId,
      idempotencyKey:
        `${params.idempotencyKey}:charge`,
    });
    charged = charge.created;
  }

  if (charged) {
    await prisma.agentRun.update({
      where: { id: params.runId },
      data: { actualCredits: { increment: actualAmount } },
    });
  }

  return {
    released: released ? reservedAmount : new Prisma.Decimal(0),
    charged: charged ? actualAmount : new Prisma.Decimal(0),
  };
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
