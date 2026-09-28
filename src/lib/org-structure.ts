import { z } from "zod";

export const customerInput = z.object({
  name: z.string().trim().min(1, "Name fehlt.").max(120),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const branchFields = {
  customerId: z.string().min(1, "Bitte einen Kunden wählen."),
  name: z.string().trim().min(1, "Name fehlt.").max(100),
  address: z.string().max(500),
  meetingPoint: z.string().max(500),
  notes: z.string().max(2000),
  positions: z.array(z.string().trim().min(1).max(100)).max(30),
  isActive: z.boolean(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  checkinRadiusM: z.number().int().min(10).max(1000),
  gpsCheckinRequired: z.boolean(),
};

export const branchInput = z.object({
  ...branchFields,
  address: branchFields.address.default(""),
  meetingPoint: branchFields.meetingPoint.default(""),
  notes: branchFields.notes.default(""),
  positions: branchFields.positions.default([]),
  isActive: branchFields.isActive.default(true),
  latitude: branchFields.latitude.default(null),
  longitude: branchFields.longitude.default(null),
  checkinRadiusM: branchFields.checkinRadiusM.default(50),
  gpsCheckinRequired: branchFields.gpsCheckinRequired.default(false),
}).refine(
  (data) => {
    // latitude and longitude must be set together or both null
    const latSet = data.latitude !== null;
    const lonSet = data.longitude !== null;
    return latSet === lonSet;
  },
  {
    message: "Breitengrad und Längengrad müssen zusammen gesetzt oder beide leer sein.",
    path: ["latitude"],
  }
).refine(
  (data) => {
    // gpsCheckinRequired=true requires coordinates
    if (data.gpsCheckinRequired && (data.latitude === null || data.longitude === null)) {
      return false;
    }
    return true;
  },
  {
    message: "Für den GPS-Check-in fehlen die Koordinaten des Standorts.",
    path: ["gpsCheckinRequired"],
  }
);

/** Aenderung einzelner Felder - ohne Standardwerte, damit nichts ueberschrieben wird. */
/** GPS-Regeln prueft PATCH /api/branches am zusammengefuehrten Stand. */
export const branchPatch = z.object(branchFields).partial().extend({ id: z.string().min(1) });
