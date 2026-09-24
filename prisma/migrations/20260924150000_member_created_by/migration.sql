-- Wer ein Konto angelegt hat. Manager duerfen nur fuer selbst angelegte,
-- noch nicht aktivierte Konten einen Aktivierungslink erzeugen.
-- Bestehende Konten bleiben unveraendert (NULL = unbekannt bzw. Administration).
ALTER TABLE "organization_members" ADD COLUMN "createdByMemberId" TEXT;

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Die anlegende Person gehoert immer zur selben Organisation.
CREATE TRIGGER "organization_members_creator_same_organization" BEFORE INSERT OR UPDATE ON "organization_members"
  FOR EACH ROW EXECUTE FUNCTION "akro_same_organization"('organization_members', 'createdByMemberId');
