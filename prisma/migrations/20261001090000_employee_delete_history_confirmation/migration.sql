-- 1. Echtes Loeschen von Mitarbeitenden ohne Verlust der Historie:
--    Arbeitszeiten, Check-ins und Einsaetze haengen nicht mehr per CASCADE am
--    Benutzerkonto. Sie bleiben nach dem Loeschen mit einer Momentaufnahme
--    (former_employees: nur Vor- und Nachname) erhalten. Die Fremdschluessel
--    auf users sind RESTRICT, damit nie still Historie mitgeloescht wird.
--    Autorenschaft von Nachrichten, Beitraegen, Notizen und Dateien wird beim
--    Loeschen eines Kontos leer (SET NULL); die Inhalte bleiben.
-- 2. Neues Personalrecht DELETE_EMPLOYEE (nur ausdruecklich vergeben).
-- 3. Herkunft der Bestaetigung einer Zuweisung (PLANNER / EMPLOYEE).
-- Bestehende Zeilen behalten ihre Person; es wird nichts geloescht.

-- CreateEnum
CREATE TYPE "BookingConfirmation" AS ENUM ('PLANNER', 'EMPLOYEE');

-- AlterEnum
ALTER TYPE "StaffRight" ADD VALUE 'DELETE_EMPLOYEE';

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_userId_fkey";

-- DropForeignKey
ALTER TABLE "live_logs" DROP CONSTRAINT "live_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "time_records" DROP CONSTRAINT "time_records_userId_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_senderId_fkey";

-- DropForeignKey
ALTER TABLE "portal_files" DROP CONSTRAINT "portal_files_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "topic_posts" DROP CONSTRAINT "topic_posts_userId_fkey";

-- DropForeignKey
ALTER TABLE "employee_notes" DROP CONSTRAINT "employee_notes_authorId_fkey";

-- DropForeignKey
ALTER TABLE "checkins" DROP CONSTRAINT "checkins_userId_fkey";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "confirmation" "BookingConfirmation",
ADD COLUMN     "formerEmployeeId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "time_records" ADD COLUMN     "formerEmployeeId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "senderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "portal_files" ALTER COLUMN "uploadedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "topic_posts" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "employee_notes" ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "checkins" ADD COLUMN     "formerEmployeeId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "former_employees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "former_employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "former_employees_organizationId_idx" ON "former_employees"("organizationId");

-- CreateIndex
CREATE INDEX "bookings_formerEmployeeId_idx" ON "bookings"("formerEmployeeId");

-- CreateIndex
CREATE INDEX "time_records_formerEmployeeId_idx" ON "time_records"("formerEmployeeId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_formerEmployeeId_fkey" FOREIGN KEY ("formerEmployeeId") REFERENCES "former_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_logs" ADD CONSTRAINT "live_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_formerEmployeeId_fkey" FOREIGN KEY ("formerEmployeeId") REFERENCES "former_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_files" ADD CONSTRAINT "portal_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_posts" ADD CONSTRAINT "topic_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_notes" ADD CONSTRAINT "employee_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_formerEmployeeId_fkey" FOREIGN KEY ("formerEmployeeId") REFERENCES "former_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "former_employees" ADD CONSTRAINT "former_employees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Genau eine Personenreferenz je historischem Datensatz.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_check" CHECK (("userId" IS NULL) <> ("formerEmployeeId" IS NULL));
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_person_check" CHECK (("userId" IS NULL) <> ("formerEmployeeId" IS NULL));
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_person_check" CHECK (("userId" IS NULL) <> ("formerEmployeeId" IS NULL));

-- Bestaetigungsherkunft - nur eindeutig zuordenbare Altzuweisungen:
-- a) confirmedAt gesetzt: Das setzte bisher ausschliesslich die Bestaetigung
--    durch die Person selbst (PATCH /api/bookings) -> EMPLOYEE.
UPDATE "bookings" SET "confirmation" = 'EMPLOYEE' WHERE "confirmedAt" IS NOT NULL;
-- b) Von einer anderen Person eingeteilt (bookedBy gesetzt und ungleich der
--    eingeteilten Person; Zuweisungen legt nur die Planung an, auch bei
--    genehmigten Antraegen) -> PLANNER, verbindlich ab dem Einteilungszeitpunkt.
--    Das ist keine Mitarbeiterbestaetigung und wird nicht als solche angezeigt.
UPDATE "bookings" SET "confirmation" = 'PLANNER', "confirmedAt" = "bookedAt" WHERE "confirmedAt" IS NULL AND "bookedBy" IS NOT NULL AND "bookedBy" <> "userId";
-- Alle uebrigen (ohne bookedBy oder von der Person selbst eingetragen) bleiben
-- unbestaetigt; ihre Herkunft ist nicht eindeutig.
