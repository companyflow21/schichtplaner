import type { TestContext } from "./permissions";

/** HTTP regression checks for organization-scoped file-folder breadcrumbs. */
export async function fileTests(t: TestContext) {
  const admin = new t.Session();
  const foreign = new t.Session();
  await admin.login(t.users.admin.email);
  await foreign.login(t.users.foreign.email);

  const root = (await admin.request("/api/files", "POST", { name: "Interner Ordner" }, 201)).folder;
  const nested = (await admin.request("/api/files", "POST", { name: "Unterordner", parentId: root.id }, 201)).folder;
  const localView = await admin.request("/api/files?folderId=" + encodeURIComponent(nested.id));
  t.check(
    localView.breadcrumb.map((folder: { id: string }) => folder.id).join(",") === [root.id, nested.id].join(","),
    "file breadcrumb includes the validated same-organization folder ancestry",
  );

  const foreignFolder = (await foreign.request("/api/files", "POST", { name: "Fremder Ordner" }, 201)).folder;
  await admin.request("/api/files?folderId=" + encodeURIComponent(foreignFolder.id), "GET", undefined, 404);
  await admin.request("/api/files?folderId=missing-folder-id", "GET", undefined, 404);
}
