-- Echter Schichttausch, Standortbezug fuer Nachrichten und GPS-Check-in.
-- Rein additiv: keine Spalte wird entfernt oder umgeschrieben.
-- Check-ins speichern keine Koordinaten, nur Entfernung, Genauigkeit und Alter der Position.

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "checkinRadiusM" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "gpsCheckinRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "mod_requests" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "targetConsentAt" TIMESTAMP(3),
ADD COLUMN     "targetShiftId" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "branchId" TEXT;

-- CreateTable
CREATE TABLE "checkins" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "timeRecordId" TEXT,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lateMinutes" INTEGER NOT NULL,
    "distanceM" INTEGER,
    "accuracyM" INTEGER,
    "positionAgeS" INTEGER,
    "failure" TEXT,
    "reason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkins_timeRecordId_key" ON "checkins"("timeRecordId");

-- CreateIndex
CREATE INDEX "checkins_organizationId_branchId_createdAt_idx" ON "checkins"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "checkins_organizationId_status_idx" ON "checkins"("organizationId", "status");

-- CreateIndex
CREATE INDEX "checkins_shiftId_userId_idx" ON "checkins"("shiftId", "userId");

-- Hoechstens ein wirksamer Check-in je Schicht und Person - auch bei
-- gleichzeitigen Anfragen. Abgelehnte (DECLINED) und durch einen spaeteren
-- GPS-Check-in erledigte (SUPERSEDED) Eintraege bleiben als Verlauf erhalten.
-- Teilindex: in schema.prisma nur als Kommentar beschrieben.
CREATE UNIQUE INDEX "checkins_active_key" ON "checkins"("shiftId", "userId") WHERE "status" IN ('CONFIRMED', 'APPROVED', 'PENDING');

-- AddForeignKey
ALTER TABLE "mod_requests" ADD CONSTRAINT "mod_requests_targetShiftId_fkey" FOREIGN KEY ("targetShiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_timeRecordId_fkey" FOREIGN KEY ("timeRecordId") REFERENCES "time_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

