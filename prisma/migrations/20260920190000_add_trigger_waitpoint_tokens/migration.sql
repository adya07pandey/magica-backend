ALTER TYPE "WaitpointStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';

ALTER TABLE "Waitpoint"
ADD COLUMN "triggerTokenId" TEXT,
ADD COLUMN "resolutionIdempotencyKey" TEXT,
ADD COLUMN "resolution" JSONB;

CREATE UNIQUE INDEX "Waitpoint_triggerTokenId_key"
ON "Waitpoint"("triggerTokenId");

CREATE UNIQUE INDEX "Waitpoint_resolutionIdempotencyKey_key"
ON "Waitpoint"("resolutionIdempotencyKey");

CREATE UNIQUE INDEX "Waitpoint_one_pending_per_run_idx"
ON "Waitpoint"("runId")
WHERE "status" = 'PENDING';
