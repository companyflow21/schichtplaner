-- Planungsregeln: allgemeine Regeln je Organisation und Abweichungen je Person.
-- Rein additiv; ohne Eintrag sind alle Regeln aus.
-- CreateTable
CREATE TABLE "planning_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_rule_overrides" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_rule_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planning_rules_organizationId_key" ON "planning_rules"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "planning_rule_overrides_memberId_key" ON "planning_rule_overrides"("memberId");

-- AddForeignKey
ALTER TABLE "planning_rules" ADD CONSTRAINT "planning_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_rule_overrides" ADD CONSTRAINT "planning_rule_overrides_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_rule_overrides" ADD CONSTRAINT "planning_rule_overrides_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

