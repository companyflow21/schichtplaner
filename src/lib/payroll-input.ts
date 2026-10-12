import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ApiError } from "./errors";
import { timeSchema } from "./api";

type Tx = Prisma.TransactionClient;

const code = z.string().trim().max(20).nullable().optional().transform((v) => (v ? v : null));
export const payTypeInput = z.object({
  title: z.string().trim().min(1, "Bitte einen Titel eingeben.").max(100),
  hourlyRateCents: z.number().int().min(0).max(100000, "Stundenlohn höchstens 1.000 €."),
  code,
  isActive: z.boolean().optional(),
});

export const surchargeInput = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen eingeben.").max(100),
  code,
  isActive: z.boolean().optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(50).default([]).transform((v) => [...new Set(v)].sort()),
  holidays: z.boolean().default(false),
  dates: z.array(z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Sonderdaten als MM-TT, z. B. 12-24.")).max(50).default([]).transform((v) => [...new Set(v)].sort()),
  timeFrom: timeSchema.default("00:00"),
  timeTo: timeSchema.default("00:00"),
  allPeople: z.boolean().default(true),
  userIds: z.array(z.string().min(1)).max(2000).default([]),
  allDivisions: z.boolean().default(true),
  divisionIds: z.array(z.string().min(1)).max(500).default([]),
  rateKind: z.enum(["PERCENT", "AMOUNT"]),
  /** PERCENT: Hundertstel Prozent; AMOUNT: Cent je Stunde */
  rate: z.number().int().min(0).max(100000),
}).refine((s) => s.weekdays.length || s.holidays || s.dates.length, "Bitte mindestens einen Wochentag, Feiertage oder ein Sonderdatum wählen.");
export type SurchargeInput = z.output<typeof surchargeInput>;

/** Personen und Arbeitsbereiche muessen zur Organisation gehoeren; ohne Auswahl gilt "alle". */
export async function checkedSurcharge(tx: Tx, orgId: string, s: SurchargeInput) {
  const userIds = s.allPeople ? [] : [...new Set(s.userIds)];
  const divisionIds = s.allDivisions ? [] : [...new Set(s.divisionIds)];
  if (!s.allPeople && !userIds.length) throw new ApiError("Bitte mindestens eine Person wählen oder „alle“.");
  if (!s.allDivisions && !divisionIds.length) throw new ApiError("Bitte mindestens einen Arbeitsbereich wählen oder „alle“.");
  if (userIds.length && await tx.organizationMember.count({ where: { organizationId: orgId, userId: { in: userIds } } }) !== userIds.length) throw new ApiError("Person nicht gefunden.", 404);
  if (divisionIds.length && await tx.division.count({ where: { organizationId: orgId, id: { in: divisionIds } } }) !== divisionIds.length) throw new ApiError("Arbeitsbereich nicht gefunden.", 404);
  return { ...s, userIds, divisionIds };
}

/** Lohnart der eigenen Organisation oder null. */
export async function checkedPayType(tx: Tx, orgId: string, payTypeId: string | null | undefined) {
  if (!payTypeId) return null;
  if (!await tx.payType.findFirst({ where: { id: payTypeId, organizationId: orgId }, select: { id: true } })) throw new ApiError("Lohnart nicht gefunden.", 404);
  return payTypeId;
}
