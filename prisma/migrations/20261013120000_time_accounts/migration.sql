-- Zeitkonten: Einstellungen, Konto je Person, Soll-Phasen mit Startdatum, Ausgleichsbuchungen.
-- Rein additiv; Zeitkonten sind zunaechst ausgeschaltet.

-- CreateEnum
CREATE TYPE "AccountMethod" AS ENUM ('ACTUAL_MINUS_TARGET', 'PLAN_MINUS_TARGET', 'ACTUAL_MINUS_PLAN');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('WEEK', 'MONTH');

-- AlterTable
ALTER TABLE "time_settings" ADD COLUMN     "accountMethod" "AccountMethod" NOT NULL DEFAULT 'ACTUAL_MINUS_TARGET',
ADD COLUMN     "accountVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accountsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "time_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "method" "AccountMethod",
    "visible" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_hours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "period" "TargetPeriod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_compensations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_compensations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "time_accounts_memberId_key" ON "time_accounts"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "target_hours_memberId_startDate_key" ON "target_hours"("memberId", "startDate");

-- CreateIndex
CREATE INDEX "time_compensations_memberId_date_idx" ON "time_compensations"("memberId", "date");

-- AddForeignKey
ALTER TABLE "time_accounts" ADD CONSTRAINT "time_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_accounts" ADD CONSTRAINT "time_accounts_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_hours" ADD CONSTRAINT "target_hours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_hours" ADD CONSTRAINT "target_hours_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_compensations" ADD CONSTRAINT "time_compensations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_compensations" ADD CONSTRAINT "time_compensations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

