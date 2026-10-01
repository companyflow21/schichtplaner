import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { berlinDate, berlinTime, validDate, addDate, shiftRange } from "@/lib/berlin";
import { branchIds, requireAccess, staffIds, canSeeTime } from "@/lib/access";
import { notify } from "@/lib/planning";
import { timeReviewers } from "@/lib/time-service";
import { emitToUsers } from "@/lib/emit";
import { CHECKED_IN, CHECKIN_FAILURES, bookedShifts, checkinWindow, evaluatePosition, failureMessage, watchRecord, DEFAULT_RADIUS_M } from "@/lib/checkin";

const checkinView = { id: true, status: true, method: true, createdAt: true, lateMinutes: true, decisionNote: true } as const;
const failureLabel: Record<string, string> = {
  DENIED: "Standortfreigabe abgelehnt", UNAVAILABLE: "Standort nicht ermittelbar", INACCURATE: "Ortung zu ungenau",
  STALE: "Standortangabe veraltet", OUTSIDE: "außerhalb des Radius", NO_COORDINATES: "keine Position am Standort hinterlegt",
};

/**
 * Ohne Parameter: eigene Schichten, deren Check-in-Fenster offen ist oder die
 * heute (Berlin) beginnen, mit vorhandenem Check-in und laufender Stoppuhr.
 * view=team&date=YYYY-MM-DD: Check-ins anderer an Standorten, deren Zeiten
 * man sehen darf (Admin, oder "Zeiterfassung ansehen" am Standort plus
 * "Stunden einsehen" fuer die Person) - offene Antraege immer, sonst die
 * Check-ins dieses Tages (Serverzeit, Berlin).
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const params = new URL(request.url).searchParams;
    const now = new Date();
    if (params.get("view") === "team") {
      const date = params.get("date") || berlinDate(now);
      if (!validDate(date)) throw new ApiError("Ungültiges Datum.");
      const sites = branchIds(a, "VIEW_TIME"), people = staffIds(a, "VIEW_HOURS");
      const scope = sites && people ? { branchId: { in: sites }, userId: { in: people } } : {};
      const rows = await db.checkin.findMany({
        where: {
          organizationId: a.orgId, ...scope,
          // Nicht die eigenen; Zeilen geloeschter Personen (userId leer) bleiben fuer Admins sichtbar - "not" allein liesse NULL aus.
          AND: [
            { OR: [{ userId: null }, { userId: { not: a.userId } }] },
            { OR: [{ status: "PENDING" }, { createdAt: { gte: new Date(addDate(date, -1) + "T12:00:00Z"), lt: new Date(addDate(date, 1) + "T12:00:00Z") } }] },
          ],
        },
        include: { user: { select: { id: true, firstName: true, lastName: true } }, formerEmployee: { select: { id: true, firstName: true, lastName: true } }, branch: { select: { id: true, name: true } }, shift: { include: { schedule: true } } },
        orderBy: { createdAt: "asc" },
        take: 300,
      });
      const checkins = rows
        .filter((c) => c.status === "PENDING" || berlinDate(c.createdAt) === date)
        .map((c) => ({
          id: c.id, status: c.status, method: c.method, createdAt: c.createdAt, time: berlinTime(c.createdAt), lateMinutes: c.lateMinutes,
          distanceM: c.distanceM, accuracyM: c.accuracyM, positionAgeS: c.positionAgeS, failure: c.failure, failureLabel: c.failure ? failureLabel[c.failure] : null,
          reason: c.reason, decisionNote: c.decisionNote, reviewedAt: c.reviewedAt,
          user: c.user ?? (c.formerEmployee ? { ...c.formerEmployee, former: true } : null), branch: c.branch,
          shift: { id: c.shift.id, date: shiftRange(c.shift).date, shiftFrom: c.shift.shiftFrom, shiftTo: c.shift.shiftTo, title: c.shift.title },
          canDecide: c.status === "PENDING" && canSeeTime(a, c, "edit"),
        }));
      return { date, checkins };
    }
    const today = berlinDate(now);
    const [shifts, running] = await Promise.all([
      bookedShifts(db, a.orgId, a.userId, now),
      db.timeRecord.findFirst({ where: { organizationId: a.orgId, userId: a.userId, type: "WATCH", timeTo: null }, select: { id: true, startedAt: true, pauseStartedAt: true, breakSeconds: true, timeFrom: true, branchId: true } }),
    ]);
    const relevant = shifts.filter((s) => s.window.open || s.window.date === today);
    // Neuester Eintrag je Schicht zuerst (abgelehnte bleiben als Verlauf erhalten).
    const checkins = relevant.length ? await db.checkin.findMany({ where: { userId: a.userId, shiftId: { in: relevant.map((s) => s.shift.id) } }, select: { ...checkinView, shiftId: true }, orderBy: { createdAt: "desc" } }) : [];
    return {
      serverTime: now,
      running,
      shifts: relevant.map(({ shift, branch, window }) => {
        const c = checkins.find((x) => x.shiftId === shift.id);
        return {
          id: shift.id, date: window.date, shiftFrom: shift.shiftFrom, shiftTo: shift.shiftTo, title: shift.title,
          branch: { id: branch.id, name: branch.name, isActive: branch.isActive, gpsCheckinRequired: branch.gpsCheckinRequired, hasCoordinates: branch.latitude !== null && branch.longitude !== null, checkinRadiusM: branch.checkinRadiusM },
          window,
          checkin: c ? { id: c.id, status: c.status, method: c.method, createdAt: c.createdAt, time: berlinTime(c.createdAt), lateMinutes: c.lateMinutes, decisionNote: c.decisionNote } : null,
        };
      }),
    };
  });
}

const input = z.object({
  shiftId: z.string().min(1),
  position: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(1e6), timestamp: z.number() }).optional(),
  manual: z.object({ failure: z.enum(CHECKIN_FAILURES), reason: z.string().trim().min(10, "Bitte den Grund in mindestens 10 Zeichen angeben.").max(500) }).optional(),
}).refine((d) => !!d.position !== !!d.manual, "Entweder Position oder manuellen Antrag senden.");

/**
 * GPS-Check-in (position) oder Antrag auf manuelle Freigabe (manual) fuer
 * eine eigene Schicht. Der GPS-Check-in startet die Zeiterfassung sofort;
 * ein Fehlschlag speichert nichts (422 mit Grund). Der Antrag speichert nur
 * den Zeitpunkt; die Zeiterfassung startet erst mit der Freigabe.
 */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input);
    const result = await serial(async (tx) => {
      const now = new Date();
      const booking = await tx.booking.findFirst({
        where: { userId: a.userId, shiftId: data.shiftId, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true } } },
        include: { shift: { include: { schedule: { include: { branch: true } } } } },
      });
      if (!booking) throw new ApiError("Schicht nicht gefunden.", 404);
      const { shift } = booking, branch = shift.schedule.branch;
      if (!branch) throw new ApiError("Diese Schicht hat keinen Einsatzort. Ein Check-in ist nicht möglich.", 409);
      if (!branch.isActive) throw new ApiError("Der Einsatzort ist nicht aktiv.", 409);
      const window = checkinWindow(shift, now);
      if (!window.open) throw new ApiError(window.state === "BEFORE" ? `Der Check-in ist ab ${window.opensAt} Uhr möglich.` : "Die Schicht ist bereits beendet.", 409);
      // Nur wirksame Eintraege zaehlen; abgelehnte bleiben als Verlauf stehen
      // (Teilindex checkins_active_key verhindert zwei wirksame gleichzeitig).
      const existing = await tx.checkin.findFirst({ where: { shiftId: shift.id, userId: a.userId, status: { in: ["CONFIRMED", "APPROVED", "PENDING"] } } });
      if (existing && CHECKED_IN.includes(existing.status)) throw new ApiError("Du bist für diese Schicht bereits eingecheckt.", 409);
      const base = { organizationId: a.orgId, userId: a.userId, shiftId: shift.id, branchId: branch.id, createdAt: now, lateMinutes: window.lateMinutes };

      if (data.manual) {
        if (existing?.status === "PENDING") throw new ApiError("Eine manuelle Freigabe ist bereits beantragt.", 409);
        const checkin = await tx.checkin.create({ data: { ...base, method: "MANUAL", status: "PENDING", failure: data.manual.failure, reason: data.manual.reason } });
        const who = await tx.user.findUnique({ where: { id: a.userId }, select: { firstName: true, lastName: true } });
        const reviewers = await timeReviewers(tx, a.orgId, { userId: a.userId, branchId: branch.id });
        const notified = await notify(tx, a.orgId, a.userId, reviewers, "Check-in: manuelle Freigabe beantragt",
          `${who?.firstName ?? ""} ${who?.lastName ?? ""} bittet um Freigabe des Check-ins für ${branch.name}, Schicht ${window.date} ${shift.shiftFrom}–${shift.shiftTo}. Antrag um ${berlinTime(now)} Uhr (Serverzeit)${window.lateMinutes > 0 ? `, ${window.lateMinutes} Min. nach Beginn` : ""}. Grund: ${failureLabel[data.manual.failure]}. Begründung: ${data.manual.reason}`,
          shift.id);
        return { checkin, notified };
      }

      const position = evaluatePosition({ branch, position: data.position!, now });
      if (!position.ok) {
        const message = failureMessage(position, branch.checkinRadiusM || DEFAULT_RADIUS_M);
        throw new ApiError(message, 422, { failure: position.failure, message, canRequestManual: true });
      }
      if (await tx.timeRecord.findFirst({ where: { organizationId: a.orgId, userId: a.userId, type: "WATCH", timeTo: null } })) throw new ApiError("Deine Zeiterfassung läuft bereits. Bitte zuerst beenden.", 409);
      const record = await tx.timeRecord.create({ data: watchRecord(a.orgId, a.userId, branch.id, now) });
      // Ein offener manueller Antrag ist damit erledigt - er bleibt nachvollziehbar stehen.
      if (existing?.status === "PENDING") await tx.checkin.update({ where: { id: existing.id }, data: { status: "SUPERSEDED", reviewedAt: now, decisionNote: "Durch GPS-Check-in erledigt." } });
      const checkin = await tx.checkin.create({ data: { ...base, method: "GPS", status: "CONFIRMED", distanceM: position.distanceM, accuracyM: position.accuracyM, positionAgeS: position.positionAgeS, timeRecordId: record.id } });
      return { checkin, record, notified: [] as string[] };
    }, { retry: true });
    emitToUsers(result.notified, "message:new");
    emitToUsers([a.userId], "time:watch");
    const { checkin } = result;
    return { checkin: { ...checkin, time: berlinTime(checkin.createdAt) }, record: "record" in result ? result.record : null };
  });
}
