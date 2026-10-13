-- Lohn: Lohnarten, Zuschlaege, Personalnummer und Lohnart je Person bzw. Arbeitsbereich.
-- Rein additiv: keine Spalte wird entfernt oder umgeschrieben, Bestand bleibt unveraendert.

-- CreateEnum
CREATE TYPE "SurchargeRateKind" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN     "payTypeId" TEXT,
ADD COLUMN     "personnelNumber" TEXT;

-- AlterTable
ALTER TABLE "divisions" ADD COLUMN     "payTypeId" TEXT;

-- CreateTable
CREATE TABLE "pay_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hourlyRateCents" INTEGER NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surcharges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "holidays" BOOLEAN NOT NULL DEFAULT false,
    "dates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeFrom" TEXT NOT NULL DEFAULT '00:00',
    "timeTo" TEXT NOT NULL DEFAULT '00:00',
    "allPeople" BOOLEAN NOT NULL DEFAULT true,
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allDivisions" BOOLEAN NOT NULL DEFAULT true,
    "divisionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateKind" "SurchargeRateKind" NOT NULL,
    "rate" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pay_types_organizationId_title_key" ON "pay_types"("organizationId", "title");

-- CreateIndex
CREATE INDEX "surcharges_organizationId_idx" ON "surcharges"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_personnelNumber_key" ON "organization_members"("organizationId", "personnelNumber");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_payTypeId_fkey" FOREIGN KEY ("payTypeId") REFERENCES "pay_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_payTypeId_fkey" FOREIGN KEY ("payTypeId") REFERENCES "pay_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_types" ADD CONSTRAINT "pay_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surcharges" ADD CONSTRAINT "surcharges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

