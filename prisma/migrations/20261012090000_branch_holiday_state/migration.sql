-- Bundesland je Einsatzort fuer gesetzliche Feiertage (Europe/Berlin, nur DE).
-- NULL = nicht festgelegt; bestehende Standorte bleiben ohne Angabe, bis die
-- Administration das Bundesland ausdruecklich waehlt (keine Ableitung aus Namen).
ALTER TABLE "branches" ADD COLUMN "holidayState" TEXT;
