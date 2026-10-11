/*
 * Regression: Beim Bearbeiten einer Schicht darf das Formular Einsatzort und
 * Arbeitsbereich nicht still verstellen, auch wenn deren Auswahllisten erst
 * nach dem Oeffnen geladen werden (erster Aufruf nach dem Laden der Seite).
 * Fehlerbild vorher: der erste Standort der Liste wurde gewaehlt, Speichern
 * verschob die Schicht dorthin.
 *
 * Nur gegen die isolierte synthetische Installation (tests/load-local.ts --serve):
 *   PLAYWRIGHT_MODULE=… node tests/ui-shift-location.mjs <credentials.json>
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const loadModule = createRequire(import.meta.url);
const { chromium } = loadModule(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.ok(['http://localhost:3337', 'http://127.0.0.1:3337'].includes(config.base), 'Requires isolated synthetic loopback server on port 3337');

const failures = [];
function check(ok, label) { console.log((ok ? 'PASS ' : 'FEHLER ') + label); if (!ok) failures.push(label); }
async function api(context, method, url, data) {
  const response = await context.request.fetch(config.base + url, { method, data });
  assert.ok(response.ok(), `${method} ${url}: HTTP ${response.status()} ${await response.text()}`);
  return response.json();
}
function isoWeek(date) {
  const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { year, kw: Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7) };
}
const slow = (path, query) => url => url.pathname === path && (!query || url.search.includes(query));
const isBranches = slow('/api/branches', 'right=EDIT_SHIFTS'), isDivisions = slow('/api/divisions');

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Berlin', locale: 'de-DE' });
  const page = await context.newPage();
  await page.goto(config.base + '/login');
  await page.getByLabel('E-Mail', { exact: true }).fill(config.adminEmail);
  await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60000 });

  // Zwei Standorte hinter den Grunddaten: der Zielort steht nicht an erster Stelle,
  // und andere Browserpruefungen, die den ersten Standort nehmen, bleiben unberuehrt.
  const stamp = Date.now();
  const customer = (await api(context, 'POST', '/api/customers', { name: 'Regression Einsatzort ' + stamp })).customer;
  const other = (await api(context, 'POST', '/api/branches', { name: 'Regression Ort A ' + stamp, customerId: customer.id })).branch;
  const target = (await api(context, 'POST', '/api/branches', { name: 'Regression Ort Z ' + stamp, customerId: customer.id })).branch;
  const division = (await api(context, 'POST', '/api/divisions', { title: 'Regression Bereich ' + stamp, color: '#0637cb' })).division;
  const future = new Date(); future.setUTCDate(future.getUTCDate() + 14);
  const week = isoWeek(future), weekId = `${String(week.kw).padStart(2, '0')}-${week.year}`;
  const plan = (await api(context, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${target.id}`)).schedule;
  const title = 'Ortsregression ' + stamp;
  await api(context, 'POST', '/api/shifts', { scheduleId: plan.id, dayOfWeek: 1, repeatDays: [1], shiftFrom: '10:00', shiftTo: '12:00', maxEmployees: 1, divisionId: division.id, title });
  const created = (await api(context, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${target.id}`)).schedule.shifts.find(s => s.title === title);
  assert.ok(created && created.divisionId === division.id, 'Testschicht am Zielort mit Arbeitsbereich angelegt');

  // Frisch geladene Seite (leerer Cache); Standort- und Bereichsliste antworten verzoegert.
  // Ein durch Navigation abgebrochener Aufruf ist kein Pruefergebnis; geprueft wird der Formularzustand.
  const delay = route => new Promise(resolve => setTimeout(resolve, 2000)).then(() => route.continue()).catch(() => {});
  await page.route(isBranches, delay);
  await page.route(isDivisions, delay);
  await page.goto(config.base + `/schedule/flexible/${weekId}?standort=${target.id}`);
  const shiftButton = page.getByRole('button', { name: 'Schicht 10:00–12:00 bearbeiten' }).filter({ visible: true }).first();
  await shiftButton.waitFor({ state: 'visible', timeout: 45000 });
  const loaded = Promise.all([page.waitForResponse(r => isBranches(new URL(r.url()))), page.waitForResponse(r => isDivisions(new URL(r.url())))]);
  await shiftButton.click();
  const editor = page.getByRole('dialog');
  await editor.getByText('Schicht bearbeiten', { exact: true }).waitFor({ state: 'visible' });
  await loaded;
  await editor.locator(`select[name=branchId] option[value="${other.id}"]`).waitFor({ state: 'attached' });
  await editor.locator(`select[name=divisionId] option[value="${division.id}"]`).waitFor({ state: 'attached' });

  const shownBranch = await editor.locator('select[name=branchId]').inputValue();
  const firstOption = await editor.locator('select[name=branchId] option').first().getAttribute('value');
  const shownDivision = await editor.locator('select[name=divisionId]').inputValue();
  check(shownBranch === target.id, `Einsatzort nach verzögertem Laden bleibt der bisherige (${shownBranch === firstOption ? 'angezeigt: erster Ort der Liste' : shownBranch === target.id ? 'Zielort' : 'anderer Wert'})`);
  check(shownDivision === division.id, `Arbeitsbereich nach verzögertem Laden bleibt der bisherige (${shownDivision === '' ? 'angezeigt: kein Arbeitsbereich' : shownDivision === division.id ? 'bisheriger' : 'anderer Wert'})`);

  // Unveraendert speichern: weder Ort noch Bereich duerfen sich aendern.
  const patch = page.waitForRequest(r => r.method() === 'PATCH' && r.url().endsWith('/api/shifts/' + created.id));
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  const body = (await patch).postDataJSON();
  await editor.waitFor({ state: 'hidden', timeout: 30000 });
  check(!('branchId' in body), 'Unverändertes Speichern sendet keinen Standortwechsel');
  const atTarget = (await api(context, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${target.id}`)).schedule.shifts.find(s => s.id === created.id);
  check(!!atTarget, 'Schicht liegt nach dem Speichern weiter am bisherigen Einsatzort');
  check(atTarget?.divisionId === division.id, 'Arbeitsbereich ist nach dem Speichern unverändert');

  // Nur Titel und Pause aendern: Standort und Planzuordnung bleiben.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.reload();
  const branchOf = async () => editor.locator('select[name=branchId]').inputValue();
  const openShift = async (from, to) => {
    await page.getByRole('button', { name: `Schicht ${from}–${to} bearbeiten` }).filter({ visible: true }).first().click();
    await editor.getByText('Schicht bearbeiten', { exact: true }).waitFor({ state: 'visible' });
    await editor.locator(`select[name=branchId] option[value="${target.id}"]`).waitFor({ state: 'attached' });
  };
  await openShift('10:00', '12:00');
  await editor.getByLabel('Tätigkeit / Titel', { exact: true }).fill(title + ' geändert');
  await editor.getByLabel('Pause in Minuten', { exact: true }).fill('15');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await editor.waitFor({ state: 'hidden', timeout: 30000 });
  const retitled = (await api(context, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${target.id}`)).schedule.shifts.find(s => s.id === created.id);
  check(retitled?.scheduleId === created.scheduleId && retitled?.pauseValue === 15 && retitled?.divisionId === division.id, 'Titel/Pause geändert: gleicher Plan, gleicher Einsatzort, Arbeitsbereich erhalten');

  // Erneutes Oeffnen und Wechsel zu einer zweiten Schicht.
  await api(context, 'POST', '/api/shifts', { scheduleId: plan.id, dayOfWeek: 2, repeatDays: [2], shiftFrom: '13:00', shiftTo: '15:00', maxEmployees: 1, title: 'Zweite ' + stamp });
  await page.reload();
  await openShift('10:00', '12:00');
  const firstOpen = await branchOf();
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await openShift('13:00', '15:00');
  const secondOpen = await branchOf();
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await openShift('10:00', '12:00');
  const reopened = await branchOf();
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  check(firstOpen === target.id && secondOpen === target.id && reopened === target.id, 'Erneutes Öffnen und Wechsel zwischen Schichten zeigen immer den tatsächlichen Einsatzort');

  // Smartphone-Breite mit verzoegerter Standortliste.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(isBranches, delay);
  await page.reload();
  await openShift('13:00', '15:00');
  const mobile = await branchOf();
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await editor.waitFor({ state: 'hidden', timeout: 30000 });
  const mobileSaved = (await api(context, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${target.id}`)).schedule.shifts.some(s => s.title === 'Zweite ' + stamp);
  check(mobile === target.id && mobileSaved, 'Smartphone (375 px): Einsatzort korrekt, unverändertes Speichern verschiebt nichts');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.setViewportSize({ width: 1280, height: 900 });

  // Bewusste Aenderung funktioniert weiterhin.
  await page.reload();
  const again = page.getByRole('button', { name: 'Schicht 10:00–12:00 bearbeiten' }).filter({ visible: true }).first();
  if (atTarget) {
    await again.click();
    await editor.locator(`select[name=branchId] option[value="${other.id}"]`).waitFor({ state: 'attached' });
    await editor.locator('select[name=branchId]').selectOption(other.id);
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await editor.waitFor({ state: 'hidden', timeout: 30000 });
    const moved = (await api(context, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${other.id}`)).schedule.shifts.find(s => s.id === created.id);
    check(!!moved, 'Bewusst gewählter neuer Einsatzort wird übernommen');
  }

  // Anlegen ueber das Formular: der gewaehlte Arbeitsbereich wird gespeichert.
  const newTitle = 'Ortsregression neu ' + stamp;
  await page.goto(config.base + `/schedule/flexible/${weekId}?standort=${target.id}`);
  await page.getByRole('button', { name: 'Schicht hinzufügen', exact: true }).first().click();
  await editor.getByText('Schicht erstellen', { exact: true }).waitFor({ state: 'visible' });
  await editor.getByLabel('Beginn', { exact: true }).fill('13:00');
  await editor.getByLabel('Ende', { exact: true }).fill('15:00');
  await editor.getByLabel('Tätigkeit / Titel', { exact: true }).fill(newTitle);
  const monday = editor.getByRole('button', { name: 'Mo', exact: true });
  if (await monday.getAttribute('aria-pressed') !== 'true') await monday.click();
  for (const day of ['Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) {
    const dayButton = editor.getByRole('button', { name: day, exact: true });
    if (await dayButton.getAttribute('aria-pressed') === 'true') await dayButton.click();
  }
  await editor.locator(`select[name=divisionId] option[value="${division.id}"]`).waitFor({ state: 'attached' });
  await editor.locator('select[name=divisionId]').selectOption(division.id);
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await editor.waitFor({ state: 'hidden', timeout: 30000 });
  const fresh = (await api(context, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${target.id}`)).schedule.shifts.find(s => s.title === newTitle);
  check(!!fresh && fresh.divisionId === division.id, 'Neue Schicht über Formular mit gewähltem Arbeitsbereich angelegt');
} finally {
  await browser.close();
}
console.log(failures.length ? `ERGEBNIS: ${failures.length} Fehler.` : 'ERGEBNIS: Einsatzort-Regression bestanden.');
if (failures.length) process.exitCode = 1;
