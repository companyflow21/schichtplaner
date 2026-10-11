/* Browser acceptance for the isolated synthetic app; never targets a live server. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const loadModule = createRequire(import.meta.url);
const { chromium } = loadModule(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.ok(['http://localhost:3337', 'http://127.0.0.1:3337'].includes(config.base), 'Requires isolated synthetic loopback server on port 3337');
const output = path.resolve('docs/design-abnahme-2026-10-01');
fs.mkdirSync(output, { recursive: true });
let checks = 0;
const pageErrors = [];
function passed(label) { checks++; console.log('PASS ' + label); }
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 45000 }); }
async function api(context, method, url, data) {
  const response = await context.request.fetch(config.base + url, { method, data });
  assert.ok(response.ok(), `${method} ${url}: HTTP ${response.status()}`);
  return response.json();
}
async function login(page, email, role) {
  await page.goto(config.base + '/login');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(config.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60000 });
  await visible(page.locator('main'));
  passed(role + ': Anmeldung über Formular');
}
function isoWeek(date) {
  const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { year, kw: Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7) };
}
async function fits(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.width + 1 && dimensions.body <= dimensions.width + 1, `${label}: Seitenüberlauf ${JSON.stringify(dimensions)}`);
  passed(label + ': kein horizontaler Seitenüberlauf');
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true, animations: 'disabled' });
}
async function keyboardCheck(page, role) {
  await page.goto(config.base + '/dashboard');
  await visible(page.locator('main'));
  await page.keyboard.press('Tab');
  const focus = page.locator(':focus');
  await visible(focus);
  assert.equal((await focus.textContent()).trim(), 'Zum Inhalt springen');
  const box = await focus.boundingBox();
  assert.ok(box && box.width > 50 && box.height > 20 && box.x >= 0 && box.y >= 0, 'Skip link visibly reachable by keyboard');
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#inhalt');
  passed(role + ': sichtbarer Tastaturzugang zum Inhalt');
}
async function visitPages(page, role, routes, width) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  const endpoint = { '/dashboard': '/api/dashboard', '/employees': '/api/employees', '/divisions': '/api/branches', '/time': '/api/time', '/reporting': '/api/reporting', '/portal/inbox': '/api/messages', '/settings': '/api/settings', '/employees/absences': '/api/absences', '/schedule/employee': '/api/schedules' };
  const heading = { '/dashboard': role === 'mitarbeiter' ? 'Heute' : 'Übersicht', '/employees': 'Mitarbeiter', '/divisions': 'Kunden und Einsatzorte', '/time': 'Zeiterfassung', '/reporting': 'Auswertung', '/portal/inbox': 'Posteingang', '/settings': 'Einstellungen', '/employees/absences': 'Abwesenheiten' };
  for (const route of routes) {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === endpoint[route] && response.request().method() === 'GET');
    await page.goto(config.base + route);
    assert.ok((await loaded).ok(), role + ' ' + route + ': tatsächliche Datenanfrage erfolgreich');
    await visible(page.locator('main'));
    if (heading[route]) await visible(page.locator('main').getByRole('heading', { name: heading[route], exact: true, level: route === '/divisions' ? 2 : 1 }));
    // Wait for real query completion rather than capturing a loading skeleton.
    await page.waitForFunction(() => {
      const main = document.querySelector('main');
      return main && main.innerText.trim().length > 20 && !main.querySelector('[aria-busy="true"]') && !main.querySelector('[data-slot="skeleton"]') && !/Lädt|wird geladen/i.test(main.innerText);
    });
    assert.ok(!new URL(page.url()).pathname.startsWith('/login'), role + ' keeps authenticated session');
    assert.equal(await page.getByText('Application error', { exact: false }).count(), 0);
    await fits(page, `${role} ${route} ${width}px`);
    if (['/dashboard', '/employees', '/divisions', '/time', '/reporting', '/portal/inbox', '/settings'].includes(route)) {
      await screenshot(page, `${role}-${route.replaceAll('/', '-')}-${width}`);
    }
  }
}
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Berlin' });
    const employee = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Berlin', hasTouch: true });
    const manager = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Berlin' });
    const a = await admin.newPage(), e = await employee.newPage(), m = await manager.newPage();
    for (const page of [a, e, m]) { page.setDefaultTimeout(30000); page.on('pageerror', error => pageErrors.push(error.message)); }
    await login(a, config.adminEmail, 'Admin');
    const members = (await api(admin, 'GET', '/api/employees')).members;
    const employeeMember = members.find(member => member.user.email === config.employeeEmail);
    const managerMember = members.find(member => member.user.email === 'load-user-001@akro-test.invalid');
    const branch = (await api(admin, 'GET', '/api/branches')).branches.find(b => b.isActive && b.customerId);
    assert.ok(employeeMember && managerMember && branch, 'Synthetic role/branch fixtures');
    await api(admin, 'PATCH', `/api/employees/${managerMember.id}/role`, { role: 'MANAGER' });
    await api(admin, 'PUT', `/api/employees/${managerMember.id}/access`, { kind: 'branch', branchId: branch.id, rights: ['VIEW_SCHEDULE', 'EDIT_SHIFTS', 'PUBLISH_SCHEDULE', 'VIEW_TIME'] });
    await api(admin, 'PUT', `/api/employees/${managerMember.id}/access`, { kind: 'staff', memberId: employeeMember.id, rights: ['VIEW_PROFILE', 'ASSIGN_SHIFTS', 'VIEW_HOURS'] });
    await login(m, managerMember.user.email, 'Manager');
    await login(e, config.employeeEmail, 'Mitarbeiter');
    assert.equal((await api(manager, 'GET', '/api/me')).role, 'MANAGER');
    assert.equal((await api(employee, 'GET', '/api/me')).role, 'EMPLOYEE');
    passed('Rollen und explizite Manager-Freigaben wirksam');
    const unauthorized = await employee.request.get(config.base + '/api/employees');
    assert.equal(unauthorized.status(), 403);
    const forbiddenSettings = await manager.request.get(config.base + '/api/settings');
    assert.equal(forbiddenSettings.status(), 403);
    passed('Mitarbeiter-Personalliste und Manager-Einstellungen bleiben serverseitig gesperrt');

    // Remove only the synthetic employee's seed booking to make the new future shift their next shift.
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
    const current = isoWeek(new Date(today + 'T12:00:00Z'));
    const seedSchedule = (await api(admin, 'GET', `/api/schedules?kw=${current.kw}&year=${current.year}&standort=${branch.id}`)).schedule;
    // Lange Besetzung in der Folgewoche: Die Seed-Schichten der laufenden Woche sind je nach Wochentag und Uhrzeit
    // schon beendet und zeigen dann bewusst keinen Entfernen-Knopf. 13 Personen wie eine Seed-Grundschicht.
    const nextWeek = new Date(today + 'T12:00:00Z'); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const longWeek = isoWeek(nextWeek);
    const longTitle = 'Lange Besetzung (Design-Abnahme)';
    const longPlan = (await api(admin, 'GET', `/api/schedules?kw=${longWeek.kw}&year=${longWeek.year}&standort=${branch.id}`)).schedule;
    if (!longPlan.shifts.some(shift => shift.title === longTitle && shift.bookings.length > 4)) {
      const crew = members.filter(member => /^load-user-\d{3}@/.test(member.user.email) && member.id !== employeeMember.id && member.id !== managerMember.id).slice(0, 13);
      assert.equal(crew.length, 13, 'Synthetic crew for long staffing');
      await api(admin, 'POST', '/api/shifts', { scheduleId: longPlan.id, dayOfWeek: 1, shiftFrom: '06:00', shiftTo: '14:00', maxEmployees: crew.length, title: longTitle, assignees: crew.map(member => member.user.id), confirm: true });
    }
    await a.setViewportSize({ width: 375, height: 812 });
    await a.goto(config.base + '/schedule/flexible/' + String(longWeek.kw).padStart(2, '0') + '-' + longWeek.year + '?standort=' + branch.id);
    const longCard = a.locator('article').filter({ has: a.locator('details') }).filter({ visible: true }).first();
    await visible(longCard);
    const extraPeople = longCard.locator('details');
    assert.equal(await extraPeople.evaluate(detail => detail.open), false);
    assert.ok(await extraPeople.locator('summary').textContent().then(text => /Weitere \d+ Personen/.test(text)));
    await extraPeople.locator('summary').click();
    const extraRemove = extraPeople.getByRole('button', { name: /aus der Schicht entfernen/ }).first();
    await visible(extraRemove);
    const touchTarget = await extraRemove.boundingBox();
    assert.ok(touchTarget && touchTarget.width >= 44 && touchTarget.height >= 44, 'Mobile remove target is at least 44px');
    await extraRemove.click();
    await visible(a.getByRole('dialog').getByText('Zuweisung aufheben', { exact: true }));
    await a.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
    passed('Lange Besetzungslisten aufklappbar; zusätzliche Personen mit 44px-Aktion und sicherem Abbrechen erreichbar');
    await fits(a, 'Lange Besetzung 375px');
    await screenshot(a, 'lange-besetzung-375');
    await a.setViewportSize({ width: 1440, height: 900 });
    // Beendete Schichten behalten ihre Zuweisungen als Nachweis (409); fuer die naechste Schicht zaehlen nur offene.
    const nowBerlin = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
    const endOf = shift => { const d = new Date(shift.date + 'T12:00:00Z'); if (shift.endsNextDay) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) + ' ' + shift.shiftTo; };
    for (const shift of seedSchedule.shifts) if (endOf(shift) > nowBerlin && shift.bookings.some(b => b.userId === employeeMember.user.id)) {
      await api(admin, 'DELETE', '/api/bookings', { shiftId: shift.id, userId: employeeMember.user.id });
    }
    const future = new Date(today + 'T12:00:00Z'); future.setUTCDate(future.getUTCDate() + 14);
    const week = isoWeek(future), weekId = `${String(week.kw).padStart(2, '0')}-${week.year}`;
    const scheduleUrl = `/schedule/flexible/${weekId}?standort=${branch.id}`;
    const title = 'Design-Abnahme ' + Date.now();
    const fixturePlan = (await api(admin, 'GET', '/api/schedules?kw=' + week.kw + '&year=' + week.year + '&standort=' + branch.id)).schedule;
    if (fixturePlan.isPublic) await api(admin, 'PATCH', '/api/schedules/' + fixturePlan.id, { isPublic: false });
    for (const old of fixturePlan.shifts.filter(s => s.title?.startsWith('Design-Abnahme '))) await api(admin, 'DELETE', '/api/shifts/' + old.id);
    await a.goto(config.base + scheduleUrl);
    await a.getByRole('button', { name: 'Schicht hinzufügen', exact: true }).click();
    const editor = a.getByRole('dialog');
    await visible(editor.getByText('Schicht erstellen', { exact: true }));
    await editor.getByLabel('Beginn', { exact: true }).fill('10:00');
    await editor.getByLabel('Ende', { exact: true }).fill('12:00');
    await editor.getByLabel('Tätigkeit / Titel', { exact: true }).fill(title);
    // Select Monday first: the editor keeps at least one day selected.
    const monday = editor.getByRole('button', { name: 'Mo', exact: true });
    if (await monday.getAttribute('aria-pressed') !== 'true') await monday.click();
    for (const day of ['Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) {
      const dayButton = editor.getByRole('button', { name: day, exact: true });
      if (await dayButton.getAttribute('aria-pressed') === 'true') await dayButton.click();
    }
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await visible(a.getByText(title, { exact: true }).filter({ visible: true }));
    const card = a.locator('article').filter({ hasText: title }).filter({ visible: true });
    await card.getByRole('button', { name: 'Mitarbeiter zuweisen', exact: true }).click();
    await a.getByPlaceholder('Mitarbeiter suchen...').fill(employeeMember.user.firstName + ' ' + employeeMember.user.lastName);
    await a.getByRole('option').filter({ hasText: employeeMember.user.firstName + ' ' + employeeMember.user.lastName }).click();
    const hints = a.getByRole('dialog').filter({ hasText: 'Trotz Hinweis einteilen?' });
    if (await hints.isVisible()) await hints.getByRole('button', { name: 'Trotzdem einteilen', exact: true }).click();
    await visible(card.getByText(employeeMember.user.firstName + ' ' + employeeMember.user.lastName, { exact: true }));
    passed('Schicht über Formular erstellt und über Kandidatenauswahl besetzt');
    const saved = (await api(admin, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${branch.id}`)).schedule;
    const target = saved.shifts.find(shift => shift.title === title);
    assert.ok(target && target.bookings.some(b => b.userId === employeeMember.user.id));
    assert.equal(saved.isPublic, false);
    const draftEmployee = await api(employee, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}`);
    assert.ok(!draftEmployee.schedule?.shifts?.some(shift => shift.id === target.id), 'Draft invisible to employee');
    passed('Entwurf bleibt für Mitarbeiter unsichtbar');
    await a.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
    await a.getByRole('dialog').getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
    await visible(a.getByText('Veröffentlicht', { exact: true }));
    await a.reload(); await visible(a.getByText('Veröffentlicht', { exact: true }));
    await e.goto(config.base + '/dashboard');
    await visible(e.getByText(title, { exact: false }).first());
    // Einteilungen der Planung gelten sofort als fest (ANLEITUNG.md); kein Bestätigen-Schritt mehr.
    await visible(e.getByText('fest eingeteilt', { exact: true }).first());
    assert.equal(await e.getByRole('button', { name: 'Schicht bestätigen', exact: true }).count(), 0, 'Feste Einteilung ohne Bestätigen-Knopf');
    await e.reload(); await visible(e.getByText('fest eingeteilt', { exact: true }).first());
    const confirmed = (await api(admin, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${branch.id}`)).schedule.shifts.find(s => s.id === target.id);
    const ownBooking = confirmed.bookings.find(b => b.userId === employeeMember.user.id);
    assert.ok(ownBooking.confirmedAt && ownBooking.confirmation === 'PLANNER');
    passed('Veröffentlichen, mobile Anzeige „fest eingeteilt“ und Neuladen erhalten den gespeicherten Stand');

    // Unbooking must be explicit and reachable on a touch device, even without hover.
    const touchAdmin = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Berlin', hasTouch: true });
    const touchA = await touchAdmin.newPage();
    touchA.setDefaultTimeout(30000);
    touchA.on('pageerror', error => pageErrors.push(error.message));
    await touchA.goto(config.base + scheduleUrl);
    const mobileCard = touchA.locator('article').filter({ hasText: title }).filter({ visible: true });
    const remove = mobileCard.getByRole('button', { name: /aus der Schicht entfernen$/ });
    await visible(remove);
    const opacity = await remove.evaluate(el => getComputedStyle(el).opacity);
    assert.ok(Number(opacity) > 0, 'Mobile unbooking visible without hover');
    await remove.tap();
    await visible(touchA.getByRole('dialog').getByText('Zuweisung aufheben', { exact: true }));
    await touchA.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).tap();
    assert.ok((await api(admin, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${branch.id}`)).schedule.shifts.find(s => s.id === target.id).bookings.length === 1);
    await remove.tap();
    await touchA.getByRole('dialog').getByRole('button', { name: 'Entfernen', exact: true }).tap();
    await visible(mobileCard.getByRole('button', { name: 'Mitarbeiter zuweisen', exact: true }));
    assert.equal((await api(admin, 'GET', `/api/schedules?kw=${week.kw}&year=${week.year}&standort=${branch.id}`)).schedule.shifts.find(s => s.id === target.id).bookings.length, 0);
    passed('Mobiles Abbuchen ist sichtbar, Abbrechen schützt die Zuweisung, Bestätigen entfernt sie');
    await screenshot(touchA, 'mobiler-plan-touch');
    await touchAdmin.close();
    await api(admin, 'POST', '/api/bookings', { shiftId: target.id, userId: employeeMember.user.id, confirm: true });

    for (const width of [1280, 1440, 375]) {
      await a.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await a.goto(config.base + scheduleUrl); await visible(a.getByText(title, { exact: true }).filter({ visible: true }));
      await fits(a, `Wochenplan ${width}px`); await screenshot(a, `wochenplan-${width}`);
      const views = a.getByRole('group', { name: 'Ansicht', exact: true });
      await views.getByRole('link', { name: 'Mitarbeiter', exact: true }).click();
      await a.waitForURL('**/schedule/employee/**');
      await visible(a.locator('main').getByText(employeeMember.user.firstName + ' ' + employeeMember.user.lastName, { exact: true }).filter({ visible: true }).first());
      await visible(a.locator('main').getByText('10:00–12:00', { exact: false }).filter({ visible: true }).first());
      await fits(a, `Mitarbeiterplan ${width}px`);
      await views.getByRole('link', { name: 'Monat', exact: true }).click();
      await a.waitForURL('**/schedule/month/**'); await visible(a.locator('main'));
      await fits(a, `Monatsplan ${width}px`);
      passed(`Ansichtswechsel Woche → Mitarbeiter → Monat erhält Standort ${width}px`);
      assert.equal(new URL(a.url()).searchParams.get('standort'), branch.id);
    }
    await m.goto(config.base + scheduleUrl);
    await visible(m.getByRole('button', { name: 'Schicht hinzufügen', exact: true }));
    await screenshot(m, 'manager-wochenplan-1280');
    passed('Manager kann explizit freigegebenen Standort planen');
    const restrictedStaff = await api(manager, 'GET', '/api/employees');
    assert.ok(restrictedStaff.members.length === 1 && restrictedStaff.members[0].id === employeeMember.id);
    passed('Manager-Personalliste bleibt auf die zugeordnete Person begrenzt');

    await a.setViewportSize({ width: 1440, height: 900 });
    await a.goto(config.base + '/dashboard');
    await a.getByRole('button', { name: 'Navigation einklappen', exact: true }).click();
    await visible(a.getByRole('button', { name: 'Navigation ausklappen', exact: true }));
    await a.reload();
    await visible(a.getByRole('button', { name: 'Navigation ausklappen', exact: true }));
    await a.locator('aside').getByRole('link', { name: 'Mitarbeiter', exact: true }).click();
    await a.waitForURL('**/employees');
    await a.getByRole('button', { name: 'Navigation ausklappen', exact: true }).click();
    await visible(a.getByRole('button', { name: 'Navigation einklappen', exact: true }));
    passed('Seitenleiste bleibt nach Neuladen eingeklappt; Navigation mit benannten Symbolen funktioniert');
    const adminRoutes = ['/dashboard', '/employees', '/divisions', '/time', '/reporting', '/portal/inbox', '/settings', '/employees/absences'];
    const managerRoutes = ['/dashboard', '/employees', '/divisions', '/time', '/reporting', '/portal/inbox', '/employees/absences'];
    const employeeRoutes = ['/dashboard', '/schedule/employee', '/time', '/portal/inbox', '/employees/absences'];
    for (const width of [1440, 375]) await visitPages(a, 'admin', adminRoutes, width);
    for (const width of [1280, 375]) await visitPages(m, 'manager', managerRoutes, width);
    for (const width of [1280, 375]) await visitPages(e, 'mitarbeiter', employeeRoutes, width);
    for (const [page, role] of [[a, 'Admin'], [m, 'Manager'], [e, 'Mitarbeiter']]) await keyboardCheck(page, role);
    await e.setViewportSize({ width: 375, height: 812 }); await e.goto(config.base + '/dashboard');
    await e.getByRole('button', { name: 'Mehr', exact: true }).tap();
    const more = e.getByRole('dialog'); await visible(more.getByText('Alle Bereiche', { exact: true }));
    await more.getByRole('link', { name: 'Nachrichten', exact: false }).tap();
    await e.waitForURL('**/portal/inbox');
    await more.waitFor({ state: 'hidden', timeout: 5000 });
    passed('Mobile Mehr-Navigation öffnet Nachrichten und schließt das Menü');
    assert.deepEqual(pageErrors, [], 'No uncaught browser runtime errors');
    passed('Keine unbehandelten Browserfehler in den geprüften Abläufen');
    console.log(`DESIGN-ABNAHME BESTANDEN: ${checks} Prüfungen; Screenshots ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => {
  let safe = String(error.stack || error);
  for (const value of [config.password, config.adminEmail, config.employeeEmail]) if (value) safe = safe.split(value).join('[TESTKONTO]');
  console.error(safe); process.exitCode = 1;
});
