/*
 * Namensformat (Einstellungen -> Schichtplan) fuer Planansichten und PDF.
 *   npx tsx tests/names.ts
 */
import assert from "node:assert/strict";
import { formatName } from "../src/lib/names";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

const laith = { firstName: "Laith", lastName: "Alaeldin" };
check(formatName(laith, "LASTNAME_FIRSTNAME") === "Alaeldin, Laith", "Nachname, Vorname");
check(formatName(laith, "FIRSTNAME_LASTNAME") === "Laith Alaeldin", "Vorname Nachname");
check(formatName(laith, "LASTNAME") === "Alaeldin", "nur Nachname");
check(formatName(laith, "FIRSTNAME") === "Laith", "nur Vorname");
check(formatName(laith, "NICKNAME") === "Laith Alaeldin", "Altwert Spitzname zeigt Vorname Nachname, keine Spitznamen");
check(formatName(laith, undefined) === "Laith Alaeldin", "noch nicht geladenes Format: bisherige Anzeige");
check(formatName(laith, "LASTNAME_FIRSTNAME", { short: true }) === "Alaeldin, L.", "Monatsansicht kompakt: Nachname, V.");
check(formatName(laith, "FIRSTNAME_LASTNAME", { short: true }) === "Laith A.", "Monatsansicht kompakt: Vorname N.");
const placeholder = { firstName: "Sub A", lastName: "· MA 1" };
check(formatName(placeholder, "LASTNAME_FIRSTNAME", { contractor: true }) === "Sub A · MA 1", "Platzhalter bleibt Firma · Name");
check(formatName(placeholder, "LASTNAME", { contractor: true, short: true }) === "Sub A · MA 1", "Platzhalter auch kompakt unveraendert");
check(formatName({ firstName: "", lastName: "Nur" }, "LASTNAME_FIRSTNAME") === "Nur", "fehlender Vorname ohne haengendes Komma");
check(formatName({ firstName: "Ohne", lastName: "" }, "LASTNAME") === "Ohne", "fehlender Nachname faellt auf Vorname zurueck");
console.log("SUCCESS: " + checks + " Namensformat-Pruefungen bestanden.");
