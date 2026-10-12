-- Urlaubskonto: Regeln der Organisation, Abweichungen je Person, manuelle Korrekturen.
-- Rein additiv; das Urlaubskonto ist zunaechst ausgeschaltet.

-- CreateEnum
CREATE TYPE "VacationAllocation" AS ENUM ('YEARLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "vacation_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "yearStart" TEXT NOT NULL DEFAULT '01-01',
    "startDate" DATE,
    "daysPerYear" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "allocation" "VacationAllocation" NOT NULL DEFAULT 'YEARLY',
    "carryOver" BOOLEAN NOT NULL DEFAULT true,
    "carryOverMax" DOUBLE PRECISION,
    "excludedWeekdays" INTEGER[] DEFAULT ARRAY[6, 7]::INTEGER[],
    "countHolidays" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "daysPerYear" DOUBLE PRECISION,
    "startDate" DATE,
    "carryOver" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacation_adjustments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "comment" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacation_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vacation_settings_organizationId_key" ON "vacation_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "vacation_rules_memberId_key" ON "vacation_rules"("memberId");

-- CreateIndex
CREATE INDEX "vacation_adjustments_memberId_date_idx" ON "vacation_adjustments"("memberId", "date");

-- AddForeignKey
ALTER TABLE "vacation_settings" ADD CONSTRAINT "vacation_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_rules" ADD CONSTRAINT "vacation_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_rules" ADD CONSTRAINT "vacation_rules_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_adjustments" ADD CONSTRAINT "vacation_adjustments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_adjustments" ADD CONSTRAINT "vacation_adjustments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

