-- CreateTable
CREATE TABLE "TaskSummary" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summarizedUserTurns" INTEGER NOT NULL DEFAULT 0,
    "summarizedThroughId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskSummary_taskId_key" ON "TaskSummary"("taskId");

-- CreateIndex
CREATE INDEX "TaskSummary_taskId_updatedAt_idx" ON "TaskSummary"("taskId", "updatedAt");

-- AddForeignKey
ALTER TABLE "TaskSummary" ADD CONSTRAINT "TaskSummary_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
