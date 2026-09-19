import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL!),
  max: 10,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function normalizeDatabaseUrl(connectionString: string) {
  return connectionString.replace(
    /([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/i,
    "$1sslmode=verify-full",
  );
}
