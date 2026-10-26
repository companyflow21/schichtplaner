-- Kunden und Einsatzorte archivieren: rein additiv. NULL = nicht archiviert; bestehende
-- Kunden und Einsatzorte bleiben unveraendert sichtbar. Archivierte verschwinden aus Planung,
-- Auswahllisten und Startseite; Schichten, Zeiten, Meldungen und Check-ins bleiben erhalten.
ALTER TABLE "customers" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "branches" ADD COLUMN "archivedAt" TIMESTAMP(3);
