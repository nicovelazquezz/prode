/*
  Warnings:

  - You are about to drop the column `position` on the `players` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "players" DROP COLUMN "position",
ADD COLUMN     "shirtNumber" INTEGER;
