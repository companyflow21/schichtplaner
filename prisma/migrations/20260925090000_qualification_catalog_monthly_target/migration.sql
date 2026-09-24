-- Qualifikationskatalog je Organisation und Sollstunden pro Monat.
-- Rein additiv: keine Spalte wird entfernt oder umgeschrieben.

-- --- Qualifikationskatalog ------------------------------------------------
CREATE TABLE "qualifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qualifications_pkey" PRIMARY KEY ("id")
);

-- Eindeutig je Organisation, unabhaengig von Gross-/Kleinschreibung und
-- aeusseren Leerzeichen (normalizedName = getrimmt, klein) - auch bei
-- gleichzeitiger Anlage.
CREATE UNIQUE INDEX "qualifications_organizationId_normalizedName_key" ON "qualifications"("organizationId", "normalizedName");

ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uebernahme: jede bei Mitarbeitenden oder Schichten (auch geloeschten)
-- vorhandene Qualifikation wird ein Katalogeintrag ihrer Organisation. Bei
-- mehreren Schreibweisen gilt die haeufigste, bei Gleichstand die
-- alphabetisch erste. Die Zuordnungen in
-- organization_members.qualifications und shifts."requiredQualifications"
-- bleiben unveraendert; der Abgleich erfolgt ohne Gross-/Kleinschreibung.
INSERT INTO "qualifications" ("id", "organizationId", "name", "normalizedName")
SELECT 'qual_' || md5(q."organizationId" || '|' || q."normalizedName"), q."organizationId", mode() WITHIN GROUP (ORDER BY q."name"), q."normalizedName"
FROM (
    SELECT m."organizationId", btrim(v) AS "name", lower(btrim(v)) AS "normalizedName"
    FROM "organization_members" m, unnest(m."qualifications") AS v
    UNION ALL
    SELECT p."organizationId", btrim(v), lower(btrim(v))
    FROM "shifts" s
    JOIN "schedules" p ON p."id" = s."scheduleId",
    unnest(s."requiredQualifications") AS v
) q
WHERE q."normalizedName" <> ''
GROUP BY q."organizationId", q."normalizedName";

-- --- Sollstunden pro Monat --------------------------------------------------
-- Leer (NULL = nicht festgelegt). Bewusst keine Umrechnung aus den
-- Wochenstunden; "targetHoursPerWeek" bleibt erhalten.
ALTER TABLE "organization_members" ADD COLUMN "targetHoursPerMonth" DOUBLE PRECISION;
