-- Abwesenheit wirkt auf Schichten: Entscheidung je Schicht (bezahlt, unbezahlt, freigegeben),
-- genehmigt von/am und Lohnart-Code je Abwesenheitsart. Rein additiv; Altbestand ohne Wirkung.

-- CreateEnum
CREATE TYPE "AbsenceHandling" AS ENUM ('PAID', 'UNPAID', 'RELEASED');

-- AlterTable
ALTER TABLE "absences" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT;

-- AlterTable
ALTER TABLE "absence_categories" ADD COLUMN     "payCode" TEXT;

-- CreateTable
CREATE TABLE "absence_shifts" (
    "id" TEXT NOT NULL,
    "absenceId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "handling" "AbsenceHandling" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absence_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "absence_shifts_shiftId_idx" ON "absence_shifts"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "absence_shifts_absenceId_shiftId_key" ON "absence_shifts"("absenceId", "shiftId");

-- AddForeignKey
ALTER TABLE "absence_shifts" ADD CONSTRAINT "absence_shifts_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "absences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_shifts" ADD CONSTRAINT "absence_shifts_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

