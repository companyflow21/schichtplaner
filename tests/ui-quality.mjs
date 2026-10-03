/* Local synthetic UI acceptance; never targets a remote installation. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const loadModule = createRequire(import.meta.url);
const { chromium } = loadModule(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.ok(['http://localhost:3337', 'http://127.0.0.1:3337'].includes(config.base), 'UI test requires isolated loopback port 3337');
const output = path.resolve('docs/pruefungen-2026-10-01');
fs.mkdirSync(output, { recursive: true });
let checks = 0;
function passed(label) { checks++; console.log('PASS ' + label); }
function isoWeek(date) {
  const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { year, kw: Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7) };
}
async function api(context, method, url, data) {
  const result = await context.request.fetch(config.base + url, { method, data });
  assert.ok(result.ok(), method + ' ' + url + ': HTTP ' + result.status());
  return result.json();
}
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 60000 }); }
async function login(page, email) {
  await page.goto(config.base + '/login');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60000 });
  passed('Anmeldung über Formular');
}
async function fits(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': horizontaler Überlauf');
  passed(label + ': kein Seitenüberlauf');
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const admin = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Berlin', acceptDownloads: true });
    const employee = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Berlin', permissions: ['clipboard-read', 'clipboard-write'] });
    const a = await admin.newPage(), e = await employee.newPage();
    a.setDefaultTimeout(30000); e.setDefaultTimeout(30000);
    await login(a, config.adminEmail); await login(e, config.employeeEmail);
    const me = await api(employee, 'GET', '/api/me');
    const branches = (await api(admin, 'GET', '/api/branches')).branches;
    const branch = branches.find(b => b.isActive && b.customerId);
    assert.ok(branch, 'Aktiver synthetischer Standort vorhanden');
    const address = 'UI-Teststraße 100, 10115 Berlin';
    await api(admin, 'PATCH', '/api/branches', { id: branch.id, address, meetingPoint: '' });
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
    const future = new Date(today + 'T00:00:00Z'); future.setUTCDate(future.getUTCDate() + 7);
    const week = isoWeek(future);
    const schedule = (await api(admin, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${branch.id}`)).schedule;
    const created = await api(admin, 'POST', '/api/shifts', { scheduleId: schedule.id, dayOfWeek: 1, shiftFrom: '10:00', shiftTo: '12:00', maxEmployees: 1, title: 'UI-Abnahme Adresse' });
    await api(admin, 'POST', '/api/bookings', { shiftId: created.shifts[0].id, userId: me.user.id, confirm: true });
    await api(admin, 'PATCH', '/api/schedules/' + schedule.id, { isPublic: true });
    await e.goto(config.base + '/dashboard');
    await visible(e.getByText('Adresse: ' + address, { exact: true }));
    assert.equal(await e.getByText(/^Treffpunkt:/).count(), 0);
    passed('Adresse ohne Treffpunkt sichtbar');
    await e.getByRole('button', { name: 'Adresse kopieren', exact: true }).click();
    await visible(e.getByText('Adresse kopiert.', { exact: true }));
    assert.equal(await e.evaluate(() => navigator.clipboard.readText()), address);
    passed('Zwischenablage enthält tatsächliche Adresse');
    await e.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('UI-Test: Zugriff verweigert')) }));
    await e.getByRole('button', { name: 'Adresse kopieren', exact: true }).click();
    await visible(e.getByText('Adresse konnte nicht kopiert werden. Bitte markiere und kopiere sie direkt.', { exact: true }));
    passed('Verweigerte Zwischenablage zeigt verständlichen Fehler');
    await e.setViewportSize({ width: 375, height: 812 });
    await visible(e.getByText('Adresse: ' + address, { exact: true }));
    await fits(e, 'Mitarbeiter-Startseite mobil');
    await e.screenshot({ path: path.join(output, 'ui-adresse-mobil.png'), fullPage: true, animations: 'disabled' });
    async function openExport(kw, year, expected) {
      await a.goto(config.base + `/schedule/flexible/${String(kw).padStart(2, '0')}-${year}?standort=${branch.id}`);
      await a.getByRole('button', { name: 'Stunden als CSV', exact: true }).click();
      await visible(a.getByRole('dialog'));
      assert.equal(await a.getByLabel('Monat', { exact: true }).inputValue(), expected);
      passed('CSV-Vorgabe für KW ' + kw + '/' + year + ': ' + expected);
    }
    await openExport(1, 2026, '2025-12');
    await a.getByLabel('Monat', { exact: true }).fill('2026-09');
    const exportRequest = a.waitForRequest(r => new URL(r.url()).pathname === '/api/reporting/export');
    const downloadPromise = a.waitForEvent('download');
    await a.getByRole('button', { name: 'CSV herunterladen', exact: true }).click();
    const exportUrl = new URL((await exportRequest).url());
    assert.equal(exportUrl.searchParams.get('month'), '9');
    assert.equal(exportUrl.searchParams.get('year'), '2026');
    assert.equal(exportUrl.searchParams.get('standort'), branch.id);
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'AKRO-Stunden-2026-09.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.ok(csv.includes('Geplante Stunden') && csv.includes('Iststunden'));
    passed('CSV-Auswahl: tatsächlicher Standort/Monat/Jahr, Dateiname und Inhalt');
    await openExport(37, 2026, '2026-09');
    await a.setViewportSize({ width: 375, height: 812 });
    const box = await a.getByRole('dialog').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 376 && box.y >= 0 && box.y + box.height <= 813, 'CSV-Dialog passt auf Smartphone');
    passed('CSV-Dialog mobil vollständig erreichbar');
    await a.screenshot({ path: path.join(output, 'ui-csv-mobil.png'), fullPage: true, animations: 'disabled' });
    const subject = 'UI-Abnahme Postfach ' + Date.now();
    const message = (await api(admin, 'POST', '/api/messages', { subject, body: 'Nur synthetischer lokaler UI-Test.', recipientIds: [me.user.id] })).message;
    const failLoad = async route => {
      if (new URL(route.request().url()).pathname === '/api/messages' && route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Lokaler Testfehler' }) });
      else await route.continue();
    };
    await e.route('**/api/messages?*', failLoad);
    await e.goto(config.base + '/portal/inbox');
    await visible(e.getByText('Nachrichten konnten nicht geladen werden.', { exact: true }));
    assert.equal(await e.getByText('Keine Nachrichten im Posteingang', { exact: true }).count(), 0);
    passed('Postfach-Ladefehler statt irreführendem Leerzustand');
    await e.screenshot({ path: path.join(output, 'ui-postfach-fehler-mobil.png'), fullPage: true, animations: 'disabled' });
    await e.unroute('**/api/messages?*', failLoad);
    await e.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await visible(e.getByText(subject, { exact: true }));
    passed('Postfach: Wiederholen lädt tatsächliche Nachricht');
    const row = e.locator('div.cursor-pointer').filter({ hasText: subject });
    await row.getByRole('checkbox').click();
    const failChange = async route => {
      if (['PATCH', 'DELETE'].includes(route.request().method())) await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Lokaler Testfehler' }) });
      else await route.continue();
    };
    await e.route('**/api/messages/' + message.id, failChange);
    await e.getByRole('button', { name: 'Gelesen', exact: true }).click();
    await visible(e.getByText('1 Nachricht(en) konnten nicht geändert werden. Bitte erneut versuchen.', { exact: true }));
    assert.equal(await row.getByRole('checkbox').getAttribute('data-state'), 'checked');
    assert.equal((await api(employee, 'GET', '/api/messages?folder=inbox')).messages.find(m => m.id === message.id).recipients[0].isRead, false);
    passed('Fehlgeschlagenes Gelesen-Markieren: Auswahl bleibt, Daten unverändert');
    await e.getByRole('button', { name: 'Loeschen', exact: true }).click();
    await visible(e.getByText('1 Nachricht(en) konnten nicht geändert werden. Bitte erneut versuchen.', { exact: true }).first());
    assert.equal(await e.getByText('Nachrichten geloescht', { exact: true }).count(), 0);
    assert.ok((await api(employee, 'GET', '/api/messages?folder=inbox')).messages.some(m => m.id === message.id));
    passed('Fehlgeschlagenes Papierkorb-Verschieben: Nachricht bleibt vorhanden');
    await e.unroute('**/api/messages/' + message.id, failChange);
    await api(employee, 'PATCH', '/api/messages/' + message.id, { isDeleted: true });
    await e.goto(config.base + '/portal/trash');
    await visible(e.getByText(subject, { exact: true }));
    await e.locator('div.cursor-pointer').filter({ hasText: subject }).getByRole('checkbox').click();
    await e.route('**/api/messages/' + message.id, failChange);
    await e.getByRole('button', { name: 'Endgueltig loeschen', exact: true }).click();
    await visible(e.getByText('1 Nachricht(en) konnten nicht geändert werden. Bitte erneut versuchen.', { exact: true }).first());
    assert.equal(await e.getByText('Nachrichten geloescht', { exact: true }).count(), 0);
    assert.ok((await api(employee, 'GET', '/api/messages?folder=trash')).messages.some(m => m.id === message.id));
    passed('DELETE-Fehler: keine Erfolgsmeldung und keine verlorene Nachricht');
    await e.screenshot({ path: path.join(output, 'ui-postfach-papierkorb-mobil.png'), fullPage: true, animations: 'disabled' });
    await fits(e, 'Postfach mobil');
    console.log('UI-Abnahme bestanden: ' + checks + ' Prüfungen.');
  } finally { await browser.close(); }
})().catch(error => {
  const safe = String(error.stack || error).split(config.password).join('[TESTPASSWORT]').split(config.adminEmail).join('[TESTKONTO]').split(config.employeeEmail).join('[TESTKONTO]');
  console.error(safe); process.exitCode = 1;
});

