-- Veroeffentlichen mit Aenderungsliste und Bearbeitungsmodus: Stand, den Mitarbeitende
-- zuletzt gesehen haben, und Kennzeichen "wird bearbeitet". Rein additiv.
-- AlterTable
ALTER TABLE "schedules" ADD COLUMN     "editing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "schedule_snapshots" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "shifts" JSONB NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_snapshots_scheduleId_key" ON "schedule_snapshots"("scheduleId");

-- AddForeignKey
ALTER TABLE "schedule_snapshots" ADD CONSTRAINT "schedule_snapshots_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bereits veroeffentlichte Plaene gelten als veroeffentlicht (Zeitpunkt unbekannt: letzte Aenderung).
UPDATE "schedules" SET "publishedAt" = "updatedAt" WHERE "isPublic" = true;
