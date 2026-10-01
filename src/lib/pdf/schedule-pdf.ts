/**
 * Dienstplan als PDF (DIN A4 quer). Rein und isomorph: laeuft im Browser und
 * in Node, ohne DOM-Zugriff. Die Daten stammen aus GET /api/schedules/export
 * und enthalten nur, was die Person im Plan ohnehin sehen darf; das PDF
 * entsteht lokal, nichts wird hochgeladen. Die eingebaute Helvetica kennt nur
 * WinAnsi (Umlaute, Halbgeviertstrich); andere Buchstaben in Namen werden auf
 * ihren Grundbuchstaben abgebildet (pdfText).
 */
import { jsPDF } from "jspdf";
import autoTable, { type CellDef, type CellHookData } from "jspdf-autotable";
import type { ScheduleExport, ScheduleExportRow } from "@/types/schedule-export";

export type SchedulePdfOptions = {
  /** Logo als PNG-Data-URL (z. B. /akro/img/app-icon-192.png); ohne Logo bleibt die Stelle leer. */
  logoPng?: string;
};

type Rgb = [number, number, number];
// AKRO-Designsystem (globals.css): Marke, Tinte, Linien; Fire-Rot fuer Unbesetztes, Orange fuer Entwuerfe.
const BRAND: Rgb = [7, 58, 232];
const INK: Rgb = [11, 27, 54];
const MUTED: Rgb = [53, 71, 97];
const LINE: Rgb = [190, 205, 224];
const FIRE: Rgb = [175, 67, 31];
const NOTICE: Rgb = [161, 87, 0];
const OK: Rgb = [35, 114, 73];
const WHITE: Rgb = [255, 255, 255];
const DAY_TINT: Rgb = [243, 247, 252];
const OPEN_TINT: Rgb = [250, 232, 224];

// Seite: A4 quer in mm.
const PAGE_W = 297, PAGE_H = 210;
const MARGIN_X = 12;
const BODY_TOP_FIRST = 36;
const BODY_TOP_NEXT = 21;
const BODY_BOTTOM = 17;
const NBSP = String.fromCharCode(160);

/** Zeichen ausser Latin-1 (U+00A0-U+00FF), die WinAnsi im Bereich 0x80-0x9F zusaetzlich kennt. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const BASE_LETTER: Record<string, string> = { "đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ı": "i", "ħ": "h", "Ħ": "H", "ẞ": "SS" };

/** Text fuer die eingebaute Helvetica: nicht darstellbare Buchstaben auf den Grundbuchstaben, Symbole entfallen. */
export function pdfText(text: string): string {
  let out = "";
  for (const ch of text.replace(/[\r\n\t]+/g, " ")) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) { out += ch; continue; }
    const base = BASE_LETTER[ch] ?? ch.normalize("NFD").replace(/\p{M}/gu, "");
    if (/^[\x20-\x7e]+$/.test(base)) out += base;
    else if (/\p{L}/u.test(ch)) out += "?";
  }
  return out;
}

const dateLabel = (d: string) => d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
const periodLabel = (data: ScheduleExport) => dateLabel(data.period.from) + " – " + dateLabel(data.period.to);

/** "01.10.2026, 14:32" in Europe/Berlin. */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
  return parts.day + "." + parts.month + "." + parts.year + ", " + parts.hour + ":" + parts.minute;
}

const timeLabel = (r: ScheduleExportRow) => r.shiftFrom + "–" + r.shiftTo + (r.endsNextDay ? " (+1)" : "");
const locationLabel = (r: ScheduleExportRow) => r.branch + (r.customer ? " (" + r.customer + ")" : "");
const isWeekend = (r: ScheduleExportRow) => r.weekday === "Samstag" || r.weekday === "Sonntag";
const dayLabel = (r: ScheduleExportRow) => r.weekday.slice(0, 2) + ", " + dateLabel(r.date);

function filterLine(data: ScheduleExport): string {
  const f = data.filters;
  const parts = [f.customer && "Kunde: " + f.customer, f.branch && "Standort: " + f.branch, f.person && "Mitarbeiter: " + f.person].filter(Boolean);
  return parts.length ? "Filter: " + parts.join("   |   ") : "Filter: keine – alle für Sie sichtbaren Schichten";
}

/** Dateiname aus Standort, Kunde, Person oder "Alle" - nur sichere Zeichen. */
export function schedulePdfFileName(data: ScheduleExport): string {
  const label = data.filters.branch ?? data.filters.customer ?? data.filters.person ?? "Alle";
  const safe = label
    .replace(/[Ää]/g, m => (m === "Ä" ? "Ae" : "ae")).replace(/[Öö]/g, m => (m === "Ö" ? "Oe" : "oe")).replace(/[Üü]/g, m => (m === "Ü" ? "Ue" : "ue")).replace(/ß/g, "ss")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return "AKRO-Dienstplan_" + (safe || "Alle") + "_" + data.period.from + "_" + data.period.to + ".pdf";
}

/** Alle Freitexte auf darstellbare Zeichen bringen. */
function printable(data: ScheduleExport): ScheduleExport {
  const f = data.filters;
  return {
    ...data,
    filters: { ...(f.customer ? { customer: pdfText(f.customer) } : {}), ...(f.branch ? { branch: pdfText(f.branch) } : {}), ...(f.person ? { person: pdfText(f.person) } : {}) },
    rows: data.rows.map(r => ({ ...r, title: pdfText(r.title), branch: pdfText(r.branch), customer: pdfText(r.customer), assigned: r.assigned.map(pdfText) })),
  };
}

type RowMeta = { firstOfDay: boolean; row: ScheduleExportRow };

/** Zeilen der Tabelle; Datum nur am ersten Eintrag eines Tages, Tage abwechselnd getoent. */
function tableBody(rows: ScheduleExportRow[]): { body: CellDef[][]; meta: RowMeta[] } {
  const body: CellDef[][] = [], meta: RowMeta[] = [];
  let dayIndex = -1, previous = "";
  for (const r of rows) {
    const firstOfDay = r.date !== previous;
    if (firstOfDay) dayIndex++;
    previous = r.date;
    const tint = dayIndex % 2 === 1 ? DAY_TINT : undefined;
    const warn = r.open > 0;
    const hidden = Math.max(0, r.occupied - r.assigned.length);
    // Vor- und Nachname zusammenhalten (geschuetzte Leerzeichen), damit nur zwischen Personen umgebrochen wird.
    const names = r.assigned.map(n => n.replace(/ /g, NBSP)).join(", ") + (r.assigned.length && hidden ? " + " + hidden + " weitere" : "");
    const staff: CellDef = r.occupied === 0 && !r.assigned.length
      ? { content: "unbesetzt", styles: { fontStyle: "bold", textColor: FIRE } }
      : r.assigned.length
        ? { content: names }
        : { content: hidden + (hidden === 1 ? " Platz belegt" : " Plätze belegt"), styles: { textColor: MUTED, fontStyle: "italic" } };
    const cells: CellDef[] = [
      { content: firstOfDay ? dayLabel(r) : "", styles: { fontStyle: "bold", textColor: isWeekend(r) ? BRAND : INK } },
      { content: timeLabel(r), styles: { fontStyle: "bold" } },
      { content: (r.title || "–") + (r.isPublic ? "" : " (Entwurf)"), styles: r.isPublic ? {} : { textColor: NOTICE, fontStyle: "italic" } },
      { content: locationLabel(r) },
      { ...staff, styles: { ...staff.styles, ...(warn ? { fillColor: OPEN_TINT } : {}) } },
      warn
        ? { content: r.open + " offen", styles: { fontStyle: "bold", textColor: FIRE, fillColor: OPEN_TINT } }
        : { content: "–", styles: { textColor: MUTED } },
    ];
    body.push(cells.map(cell => ({ ...cell, styles: { ...(tint ? { fillColor: tint } : {}), ...cell.styles } })));
    meta.push({ firstOfDay, row: r });
  }
  return { body, meta };
}

function drawHeader(doc: jsPDF, data: ScheduleExport, page: number, options: SchedulePdfOptions) {
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, PAGE_W, 3, "F");
  const logo = (x: number, y: number, size: number) => {
    if (!options.logoPng) return;
    try { doc.addImage(options.logoPng, "PNG", x, y, size, size, "akro-logo", "FAST"); } catch { /* ohne Logo weiter */ }
  };
  doc.setDrawColor(...LINE).setLineWidth(0.3);
  if (page === 1) {
    logo(MARGIN_X, 8, 15);
    doc.setFont("helvetica", "bold").setFontSize(21).setTextColor(...INK);
    doc.text("Dienstplan", MARGIN_X + 19, 15.5);
    doc.setFontSize(12).setTextColor(...BRAND);
    doc.text(periodLabel(data), MARGIN_X + 19, 22.5);
    // Rechts: Kennzahlen
    const open = data.rows.reduce((sum, r) => sum + r.open, 0), drafts = data.rows.filter(r => !r.isPublic).length;
    if (data.rows.length) {
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK);
      doc.text(data.rows.length + (data.rows.length === 1 ? " Schicht" : " Schichten"), PAGE_W - MARGIN_X, 13, { align: "right" });
      doc.setTextColor(...(open ? FIRE : OK));
      doc.text(open ? open + (open === 1 ? " Platz offen" : " Plätze offen") : "voll besetzt", PAGE_W - MARGIN_X, 18.5, { align: "right" });
    }
    if (drafts) {
      doc.setFont("helvetica", "italic").setFontSize(9.5).setTextColor(...NOTICE);
      doc.text(drafts + (drafts === 1 ? " Schicht im Entwurf" : " Schichten im Entwurf"), PAGE_W - MARGIN_X, 23.5, { align: "right" });
    }
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED);
    doc.text(filterLine(data), MARGIN_X, 30.5, { maxWidth: PAGE_W - 2 * MARGIN_X });
    doc.line(MARGIN_X, 33, PAGE_W - MARGIN_X, 33);
  } else {
    logo(MARGIN_X, 6, 8);
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK);
    doc.text("Dienstplan", MARGIN_X + 11, 10.5);
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...BRAND);
    doc.text(periodLabel(data), MARGIN_X + 33, 10.5);
    const f = data.filters, extra = [f.customer, f.branch, f.person].filter(Boolean).join(" | ");
    if (extra) {
      doc.setFontSize(9).setTextColor(...MUTED);
      doc.text(extra, PAGE_W - MARGIN_X, 10.5, { align: "right", maxWidth: 150 });
    }
    doc.line(MARGIN_X, 14.5, PAGE_W - MARGIN_X, 14.5);
  }
}

function drawFooter(doc: jsPDF, data: ScheduleExport, page: number, pages: number) {
  const y = PAGE_H - 7;
  doc.setDrawColor(...LINE).setLineWidth(0.3);
  doc.line(MARGIN_X, y - 4.5, PAGE_W - MARGIN_X, y - 4.5);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
  doc.text("Erstellt am " + stamp(data.generatedAt) + " Uhr   |   AKRO Schichtplaner   |   Vertraulich – enthält personenbezogene Daten", MARGIN_X, y);
  doc.text("Seite " + page + " von " + pages, PAGE_W - MARGIN_X, y, { align: "right" });
}

/** Baut das PDF; speichern oder ausgeben macht der Aufrufer (doc.save, doc.output). */
export function buildSchedulePdf(input: ScheduleExport, options: SchedulePdfOptions = {}): jsPDF {
  const data = printable(input);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: "AKRO Dienstplan " + data.period.from + " bis " + data.period.to, subject: "Dienstplan", author: "AKRO Schichtplaner", creator: "AKRO Schichtplaner" });

  if (!data.rows.length) {
    doc.setFillColor(...DAY_TINT).setDrawColor(...LINE).setLineWidth(0.3);
    doc.roundedRect(MARGIN_X, BODY_TOP_FIRST + 4, PAGE_W - 2 * MARGIN_X, 36, 2, 2, "FD");
    doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...INK);
    doc.text("Keine Schichten im gewählten Zeitraum.", PAGE_W / 2, BODY_TOP_FIRST + 19, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED);
    doc.text("Zeitraum " + periodLabel(data) + (Object.keys(data.filters).length ? " – mit den gewählten Filtern" : ""), PAGE_W / 2, BODY_TOP_FIRST + 28, { align: "center" });
  } else {
    const { body, meta } = tableBody(data.rows);
    let lastPage = 0, carried = -1;
    const separator = (hook: CellHookData) => {
      doc.setDrawColor(...MUTED).setLineWidth(0.4);
      doc.line(hook.cell.x, hook.cell.y, hook.cell.x + hook.cell.width, hook.cell.y);
    };
    autoTable(doc, {
      startY: BODY_TOP_FIRST,
      margin: { top: BODY_TOP_NEXT, bottom: BODY_BOTTOM, left: MARGIN_X, right: MARGIN_X },
      head: [["Datum", "Zeit", "Tätigkeit", "Standort (Kunde)", "Mitarbeiter", "Offen"]],
      body,
      theme: "grid",
      showHead: "everyPage",
      rowPageBreak: "avoid",
      styles: { font: "helvetica", fontSize: 9, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: 0.1, valign: "middle", overflow: "linebreak" },
      headStyles: { fillColor: BRAND, textColor: WHITE, fontStyle: "bold", fontSize: 9.5, lineColor: BRAND, cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 } },
      columnStyles: { 0: { cellWidth: 31 }, 1: { cellWidth: 33 }, 2: { cellWidth: 45 }, 3: { cellWidth: 60 }, 4: { cellWidth: "auto" }, 5: { cellWidth: 22 } },
      willDrawCell: (hook) => {
        if (hook.section !== "body" || hook.column.index !== 0 || hook.pageNumber === lastPage) return;
        // Erste Zeile einer Seite mitten im Tag: das Datum blass wiederholen (unten in didDrawCell gezeichnet).
        lastPage = hook.pageNumber;
        if (!meta[hook.row.index]?.firstOfDay) carried = hook.row.index;
      },
      didDrawCell: (hook) => {
        if (hook.section !== "body") return;
        const m = meta[hook.row.index];
        if (m?.firstOfDay && hook.row.index > 0) separator(hook);
        if (hook.column.index === 0 && hook.row.index === carried && m) {
          doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
          doc.text(dayLabel(m.row), hook.cell.x + 2, hook.cell.y + hook.cell.height / 2, { baseline: "middle" });
        }
      },
    });
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    drawHeader(doc, data, page, options);
    drawFooter(doc, data, page, pages);
  }
  return doc;
}
