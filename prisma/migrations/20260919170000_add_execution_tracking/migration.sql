ALTER TABLE "AgentRun"
ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalTokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RunStep"
ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "totalTokens" INTEGER;

ALTER TABLE "ToolInvocation"
ADD COLUMN "triggerRunId" TEXT;

CREATE INDEX "ToolInvocation_triggerRunId_idx"
ON "ToolInvocation"("triggerRunId");
