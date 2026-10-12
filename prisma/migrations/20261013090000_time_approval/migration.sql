-- Stunden pruefen und genehmigen: Schichtbezug und Genehmigung je Zeitbuchung,
-- Einstellung "automatisch genehmigen". Additiv; bestehende Werte bleiben.

-- AlterTable
ALTER TABLE "time_records" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "shiftId" TEXT;

-- AlterTable
ALTER TABLE "time_settings" ADD COLUMN     "autoApprove" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Schichtbezug aus dem Check-in uebernehmen. Uebrige Altbuchungen ordnet die
-- Anwendung beim Lesen ueber die Zuordnungsregel zu (time-service.ts).
UPDATE "time_records" t SET "shiftId" = c."shiftId" FROM "checkins" c WHERE c."timeRecordId" = t."id";

-- Abgeschlossene Altbuchungen gelten als genehmigt (bisher gab es keine
-- Genehmigung der Stunden, nur der Korrekturen). Laufende Stoppuhren bekommen
-- ihren Status beim Beenden.
UPDATE "time_records" SET "approvedAt" = "updatedAt" WHERE NOT ("type" = 'WATCH' AND "timeTo" IS NULL);
