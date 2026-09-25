"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"

/**
 * Freie Eingabe als Uhrzeit "HH:MM" (24 Stunden) oder null. Erlaubt auch
 * Kurzformen wie "8", "14", "830", "1430", "8:30", "8.30" oder "14,30".
 */
export function toTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})(?:[:.,]?(\d{2}))?$/)
  if (!match) return null
  const hours = Number(match[1]), minutes = Number(match[2] ?? 0)
  if (hours > 23 || minutes > 59) return null
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0")
}

const FORMAT_MESSAGE = "Bitte Uhrzeit im 24-Stunden-Format eingeben, z. B. 14:00."

/**
 * Uhrzeitfeld im 24-Stunden-Format mit Beschriftung, unabhaengig von Browser-
 * und Systemsprache (type="time" zeigt dort je nach Sprache AM/PM). Fuer
 * Formulare mit defaultValue und FormData: Kurzformen werden beim Verlassen
 * des Feldes und bei Enter zu "HH:MM" ergaenzt, alles andere blockiert das
 * Absenden. Die Meldung steht sichtbar unter dem Feld, ist per
 * aria-describedby verknuepft und wird angesagt; die Beschriftung haengt
 * ueber htmlFor am Feld, damit die Meldung nicht Teil des Namens wird.
 */
function TimeInput({ label, id, onBlur, onKeyDown, onInput, onInvalid, "aria-describedby": describedBy, ...props }: Omit<React.ComponentProps<"input">, "type" | "value"> & { label: string }) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const errorId = inputId + "-error"
  const [error, setError] = React.useState<string | null>(null)
  const complete = (el: HTMLInputElement) => {
    const time = toTime(el.value)
    if (time) el.value = time
    el.setCustomValidity("")
    setError(el.value !== "" && !time ? FORMAT_MESSAGE : null)
  }
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <Input
        id={inputId}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="HH:MM"
        maxLength={5}
        pattern="([01]\d|2[0-3]):[0-5]\d"
        {...props}
        type="text"
        aria-invalid={!!error}
        aria-describedby={[describedBy, error && errorId].filter(Boolean).join(" ") || undefined}
        onBlur={e => { complete(e.currentTarget); onBlur?.(e) }}
        onKeyDown={e => { if (e.key === "Enter") complete(e.currentTarget); onKeyDown?.(e) }}
        onInput={e => { e.currentTarget.setCustomValidity(""); setError(null); onInput?.(e) }}
        onInvalid={e => {
          if (e.currentTarget.validity.patternMismatch) {
            e.currentTarget.setCustomValidity(FORMAT_MESSAGE)
            setError(FORMAT_MESSAGE)
          }
          onInvalid?.(e)
        }}
      />
      <p id={errorId} aria-live="polite" className={error ? "pt-1 text-xs text-destructive" : undefined}>{error}</p>
    </div>
  )
}

export { TimeInput }
