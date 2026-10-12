-- Plan-Lebenszyklus: Bearbeitung eines veroeffentlichten Wochenplans.
-- Rein additiv. Der Status wird abgeleitet (lib/schedule-status.ts):
-- isPublic = false -> DRAFT, isPublic und editingSince gesetzt -> EDITING,
-- sonst PUBLISHED. Bestehende Plaene behalten damit ihren Zustand.

-- AlterTable
ALTER TABLE "schedules" ADD COLUMN     "editingSince" TIMESTAMP(3),
ADD COLUMN     "editingById" TEXT;

-- CreateTable: veroeffentlichter Stand beim Start der Bearbeitung (je Plan hoechstens einer).
CREATE TABLE "schedule_snapshots" (
    "scheduleId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "schedule_snapshots_pkey" PRIMARY KEY ("scheduleId")
);

-- AddForeignKey
ALTER TABLE "schedule_snapshots" ADD CONSTRAINT "schedule_snapshots_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
