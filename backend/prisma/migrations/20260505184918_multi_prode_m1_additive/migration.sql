/*
  Warnings:

  - A unique constraint covering the columns `[entryId]` on the table `special_predictions` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('ACTIVE', 'ANNULLED');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'OVER_CAP';

-- AlterTable
ALTER TABLE "league_memberships" ADD COLUMN     "entryId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "entryAlias" TEXT;

-- AlterTable
ALTER TABLE "phase_winners" ADD COLUMN     "entryId" TEXT;

-- AlterTable
ALTER TABLE "predictions" ADD COLUMN     "entryId" TEXT;

-- AlterTable
ALTER TABLE "special_predictions" ADD COLUMN     "entryId" TEXT;

-- CreateTable
CREATE TABLE "entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "alias" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entries_paymentId_key" ON "entries"("paymentId");

-- CreateIndex
CREATE INDEX "entries_userId_idx" ON "entries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "entries_userId_position_key" ON "entries"("userId", "position");

-- CreateIndex
CREATE INDEX "league_memberships_entryId_idx" ON "league_memberships"("entryId");

-- CreateIndex
CREATE INDEX "phase_winners_entryId_idx" ON "phase_winners"("entryId");

-- CreateIndex
CREATE INDEX "predictions_entryId_idx" ON "predictions"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "special_predictions_entryId_key" ON "special_predictions"("entryId");

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_predictions" ADD CONSTRAINT "special_predictions_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_winners" ADD CONSTRAINT "phase_winners_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
