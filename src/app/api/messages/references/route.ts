import { api } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { referencableBranches, referencableShifts } from "@/lib/messages";

// GET /api/messages/references - Standorte und Schichten, auf die eine neue Nachricht verweisen darf (siehe POST /api/messages)
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const [branches, shifts] = await Promise.all([referencableBranches(a), referencableShifts(a)]);
    return { branches, shifts };
  });
}
