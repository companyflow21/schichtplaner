-- Planungsplatzhalter ohne Benutzerkonto. Bestehende Personen und Buchungen bleiben erhalten.
CREATE TABLE "subcontractors" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subcontractors_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "subcontractors_organizationId_name_key" UNIQUE ("organizationId", "name")
);
CREATE TABLE "contractor_workers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "subcontractorId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contractor_workers_subcontractorId_organizationId_fkey" FOREIGN KEY ("subcontractorId", "organizationId") REFERENCES "subcontractors"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "contractor_workers_subcontractorId_name_key" UNIQUE ("subcontractorId", "name")
);
CREATE INDEX "contractor_workers_organizationId_idx" ON "contractor_workers"("organizationId");
ALTER TABLE "bookings" ADD COLUMN "contractorWorkerId" TEXT;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contractorWorkerId_fkey" FOREIGN KEY ("contractorWorkerId") REFERENCES "contractor_workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "bookings_shiftId_contractorWorkerId_key" ON "bookings"("shiftId", "contractorWorkerId");
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_person_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_check" CHECK (num_nonnulls("userId", "formerEmployeeId", "contractorWorkerId") = 1);

-- Auch direkte Datenbankzugriffe und spaetere Planverschiebungen bleiben organisationsgetrennt.
CREATE FUNCTION "akro_contractor_booking_organization"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."contractorWorkerId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "contractor_workers" w, "shifts" s JOIN "schedules" p ON p."id" = s."scheduleId"
    WHERE w."id" = NEW."contractorWorkerId" AND s."id" = NEW."shiftId" AND w."organizationId" = p."organizationId"
  ) THEN
    RAISE EXCEPTION 'Subunternehmer und Schicht gehoeren nicht zur gleichen Organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "bookings_contractor_same_organization" BEFORE INSERT OR UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "akro_contractor_booking_organization"();

CREATE FUNCTION "akro_contractor_shift_organization"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "bookings" b JOIN "contractor_workers" w ON w."id" = b."contractorWorkerId"
    JOIN "schedules" p ON p."id" = NEW."scheduleId"
    WHERE b."shiftId" = NEW."id" AND w."organizationId" <> p."organizationId"
  ) THEN
    RAISE EXCEPTION 'Schicht kann nicht in eine fremde Organisation verschoben werden.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "shifts_contractor_same_organization" BEFORE UPDATE OF "scheduleId" ON "shifts"
  FOR EACH ROW EXECUTE FUNCTION "akro_contractor_shift_organization"();

CREATE FUNCTION "akro_contractor_schedule_organization"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "shifts" s JOIN "bookings" b ON b."shiftId" = s."id"
    JOIN "contractor_workers" w ON w."id" = b."contractorWorkerId"
    WHERE s."scheduleId" = NEW."id" AND w."organizationId" <> NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Plan mit Sub-Einsaetzen kann nicht in eine fremde Organisation verschoben werden.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "schedules_contractor_same_organization" BEFORE UPDATE OF "organizationId" ON "schedules"
  FOR EACH ROW EXECUTE FUNCTION "akro_contractor_schedule_organization"();

CREATE FUNCTION "akro_contractor_worker_organization"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "bookings" b JOIN "shifts" s ON s."id" = b."shiftId"
    JOIN "schedules" p ON p."id" = s."scheduleId"
    WHERE b."contractorWorkerId" = NEW."id" AND p."organizationId" <> NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Platzhalter mit Einsaetzen kann nicht in eine fremde Organisation verschoben werden.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER "contractor_workers_bookings_same_organization" BEFORE UPDATE OF "organizationId" ON "contractor_workers"
  FOR EACH ROW EXECUTE FUNCTION "akro_contractor_worker_organization"();
