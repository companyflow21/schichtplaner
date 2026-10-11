/*
 * Feiertage je Einsatzort (Bundesland am Standort). Grundlage:
 * Feiertagsgesetz NW § 2 Abs. 1 und Thueringer Feier- und Gedenktagsgesetz
 * § 2 Abs. 1 (Abruf 11.10.2026, siehe docs/FERTIGSTELLUNG.md).
 *   npx tsx tests/branch-holidays.ts
 */
import assert from "node:assert/strict";
import { branchHolidays } from "../src/lib/holidays";
import { branchInput, branchPatch } from "../src/lib/org-structure";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }
const names = (state: string | null, from: string, to: string) => branchHolidays(state, from, to).map(h => h.date + " " + h.name);
const has = (state: string | null, date: string) => branchHolidays(state, date, date).length > 0;

check(has("TH", "2026-10-31"), "Thüringen: 31.10.2026 Reformationstag");
check(!has("NW", "2026-10-31"), "NRW: 31.10.2026 kein Feiertag");
check(has("NW", "2026-11-01") && !has("TH", "2026-11-01"), "Allerheiligen nur in NRW");
check(has("TH", "2026-09-20") && !has("NW", "2026-09-20"), "Weltkindertag nur in Thüringen");
check(has("NW", "2026-06-04") && !has("TH", "2026-06-04"), "Fronleichnam landesweit nur in NRW (Thüringen nur gebietsweise, nicht pauschal)");
check(!has(null, "2026-10-31") && !has(null, "2026-11-01") && has(null, "2026-10-03"), "ohne Bundesland nur bundeseinheitliche Feiertage");
check(!has("NW", "2026-04-05") && !has("TH", "2026-05-24"), "Oster- und Pfingstsonntag sind keine gesetzlichen Feiertage");
// Gleichzeitig: dieselbe Woche ergibt je Standort unterschiedliche Feiertage.
const kw44 = ["2026-10-26", "2026-11-01"] as const;
check(names("TH", ...kw44).join() === "2026-10-31 Reformationstag" && names("NW", ...kw44).join() === "2026-11-01 Allerheiligen", "KW 44/2026: Jena und Köln bekommen ihre eigenen Feiertage");
check(names("NW", "2026-12-24", "2027-01-01").join() === "2026-12-25 1. Weihnachtstag,2026-12-26 2. Weihnachtstag,2027-01-01 Neujahr", "Jahreswechsel: Zeitraum über zwei Jahre");

// Eingabepruefung: nur bekannte Bundeslaender, leer bleibt erlaubt.
const base = { customerId: "k", name: "Köln" };
check(branchInput.parse(base).holidayState === null, "neuer Standort ohne Angabe: Bundesland nicht festgelegt");
check(branchInput.parse({ ...base, holidayState: "NW" }).holidayState === "NW", "Bundesland NW wird übernommen");
check(!branchInput.safeParse({ ...base, holidayState: "XX" }).success, "unbekanntes Bundesland wird abgelehnt");
check(!("holidayState" in branchPatch.parse({ id: "b", name: "Köln" })), "Änderung ohne Bundesland lässt das gespeicherte unverändert");
console.log("SUCCESS: " + checks + " Feiertags-Prüfungen bestanden.");
