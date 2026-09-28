/*
 * GPS-Check-in for locations: coordinates, radius, and gpsCheckinRequired flag.
 * Part of tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function siteGpsTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => {
    const s = new t.Session();
    await s.login(email);
    return s;
  };

  const admin = await session(users.admin.email);
  const manager = await session(users.managerA.email);
  const staff = await session(users.staffA.email);
  const foreign = await session(users.foreign.email);

  // --- Create customer and branch with defaults ---
  const customer = (await admin.request("/api/customers", "POST", { name: "GPS Test Kunde" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "GPS Test Standort" })).branch;

  check(branch.checkinRadiusM === 50, "default checkinRadiusM is 50");
  check(branch.gpsCheckinRequired === false, "default gpsCheckinRequired is false");
  check(branch.latitude === null, "default latitude is null");
  check(branch.longitude === null, "default longitude is null");

  // --- GET returns GPS fields ---
  const branches = (await admin.request("/api/branches")).branches;
  const retrieved = branches.find((b: any) => b.id === branch.id);
  check(retrieved.latitude === null && retrieved.longitude === null && retrieved.checkinRadiusM === 50 && retrieved.gpsCheckinRequired === false, "GET /api/branches returns GPS fields with defaults");

  // --- PATCH with coordinates and radius and required flag ---
  await admin.request("/api/branches", "PATCH", {
    id: branch.id,
    latitude: 50.7374,
    longitude: 6.6389,
    checkinRadiusM: 80,
    gpsCheckinRequired: true,
  });

  const updated = (await admin.request("/api/branches")).branches.find((b: any) => b.id === branch.id);
  check(updated.latitude === 50.7374 && updated.longitude === 6.6389 && updated.checkinRadiusM === 80 && updated.gpsCheckinRequired === true, "PATCH persists GPS fields correctly");
  // Koordinaten loeschen, solange der Check-in Pflicht ist: abgelehnt, nichts geaendert.
  await admin.request("/api/branches", "PATCH", { id: branch.id, latitude: null, longitude: null }, 400);
  check((await admin.request("/api/branches")).branches.find((b: any) => b.id === branch.id).latitude === 50.7374, "coordinates of a site with required check-in cannot be cleared");

  // --- Only latitude without longitude → 400 ---
  const branch2 = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Zweiter Standort" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch2.id, latitude: 50.5 }, 400);

  // --- Only longitude without latitude → 400 ---
  await admin.request("/api/branches", "PATCH", { id: branch2.id, longitude: 6.5 }, 400);

  // --- gpsCheckinRequired true without coordinates → 400 ---
  const branch3 = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Dritter Standort" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch3.id, gpsCheckinRequired: true }, 400);

  // --- Out-of-range latitude 91 → 400 ---
  const branch4 = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Vierter Standort" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch4.id, latitude: 91, longitude: 6.0 }, 400);

  // --- Out-of-range longitude 181 → 400 ---
  await admin.request("/api/branches", "PATCH", { id: branch4.id, latitude: 50.0, longitude: 181 }, 400);

  // --- Out-of-range radius 9 → 400 ---
  const branch5 = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Fünfter Standort" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch5.id, checkinRadiusM: 9 }, 400);

  // --- Out-of-range radius 1001 → 400 ---
  await admin.request("/api/branches", "PATCH", { id: branch5.id, checkinRadiusM: 1001 }, 400);

  // --- Manager cannot PATCH GPS fields ---
  const branch6 = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Sechster Standort" })).branch;
  await manager.request("/api/branches", "PATCH", { id: branch6.id, latitude: 50.0, longitude: 6.0 }, 403);

  // --- Employee cannot PATCH GPS fields ---
  await staff.request("/api/branches", "PATCH", { id: branch6.id, latitude: 50.0, longitude: 6.0 }, 403);

  // --- Foreign org admin cannot PATCH another org's branch ---
  const foreignCustomer = (await foreign.request("/api/customers", "POST", { name: "Foreign Customer" })).customer;
  await foreign.request("/api/branches", "POST", { customerId: foreignCustomer.id, name: "Foreign Branch" });
  await foreign.request("/api/branches", "PATCH", { id: branch.id, latitude: 50.0, longitude: 6.0 }, 404);

  // --- Admin can clear coordinates by setting both to null ---
  const branch7 = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Siebter Standort", latitude: 50.5, longitude: 6.5, checkinRadiusM: 100, gpsCheckinRequired: false })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch7.id, latitude: null, longitude: null, gpsCheckinRequired: false });
  const cleared = (await admin.request("/api/branches")).branches.find((b: any) => b.id === branch7.id);
  check(cleared.latitude === null && cleared.longitude === null, "admin can set both coordinates to null");

  // --- Negative latitude/longitude is valid (Southern/Western hemispheres) ---
  const branch8 = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Achter Standort" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch8.id, latitude: -33.8688, longitude: -151.2093 });
  const southern = (await admin.request("/api/branches")).branches.find((b: any) => b.id === branch8.id);
  check(southern.latitude === -33.8688 && southern.longitude === -151.2093, "negative coordinates (Southern/Western hemispheres) are valid");

  console.log("GPS: " + t.counter() + " checks so far.");
}
