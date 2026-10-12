/*
 * ⓘ-Erklärung (InfoHint), statisch gerendert ohne Browser oder Datenbank:
 *   npx tsx tests/info-hint.tsx
 * Der Popover-Inhalt liegt in einem Portal und erscheint erst nach dem Öffnen
 * im Browser - im statischen Markup steht nur der Auslöser.
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { InfoHint } from "../src/components/ui/info-hint";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }

const text = "Arbeitsbeginn, Pause und Arbeitsende werden sofort gespeichert.";
const html = renderToStaticMarkup(<InfoHint thema="Stoppuhr" titel="Stoppuhr-Titel"><p>{text}</p></InfoHint>);
check(html.includes('aria-label="Erklärung zu Stoppuhr"'), "Auslöser trägt aria-label mit dem Thema");
check(/^<button[^>]*type="button"/.test(html), "Auslöser ist ein eigener Knopf (type=button, sendet kein Formular ab)");
check(html.includes('aria-haspopup="dialog"') && html.includes('aria-expanded="false"') && html.includes('data-state="closed"'), "geschlossen: Popover-Zustand am Knopf erkennbar");
check(!html.includes(text) && !html.includes("Stoppuhr-Titel"), "Erklärtext und Titel stehen vor dem Öffnen nicht im Markup");
check(html.includes("size-8") && html.includes("size-4"), "Tippfläche 32 px, Symbol 16 px");
check(html.includes('aria-hidden="true"'), "Symbol ist für Screenreader ausgeblendet");

console.log("SUCCESS: " + checks + " InfoHint-Prüfungen bestanden.");
