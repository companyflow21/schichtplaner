/**
 * CSV fuer Excel (Semikolon, UTF-8 mit BOM). Texte, die Excel als Formel lesen
 * wuerde, bekommen einen Apostroph; reine Zahlen im deutschen Format (auch
 * negative wie "-1,50") bleiben Zahlen.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^-?\d+(,\d+)?$/.test(text) ? text : text.replace(/^[=+@\-\t\r]/, "'$&");
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function csvFile(rows: (string | number | null | undefined)[][], filename: string): Response {
  return new Response("﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + filename + '"' },
  });
}
