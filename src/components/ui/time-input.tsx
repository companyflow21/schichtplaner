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

/**
 * Uhrzeitfeld im 24-Stunden-Format, unabhaengig von Browser- und
 * Systemsprache (type="time" zeigt dort je nach Sprache AM/PM). Fuer
 * Formulare mit defaultValue und FormData: Kurzformen werden beim Verlassen
 * des Feldes und bei Enter zu "HH:MM" ergaenzt, alles andere blockiert das
 * Absenden mit einer Meldung.
 */
function TimeInput({ onBlur, onKeyDown, onInput, onInvalid, ...props }: Omit<React.ComponentProps<"input">, "type" | "value">) {
  const [invalid, setInvalid] = React.useState(false)
  const complete = (el: HTMLInputElement) => {
    const time = toTime(el.value)
    if (time) el.value = time
    el.setCustomValidity("")
    setInvalid(el.value !== "" && !time)
  }
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      placeholder="HH:MM"
      maxLength={5}
      pattern="([01]\d|2[0-3]):[0-5]\d"
      aria-invalid={invalid || undefined}
      {...props}
      type="text"
      onBlur={e => { complete(e.currentTarget); onBlur?.(e) }}
      onKeyDown={e => { if (e.key === "Enter") complete(e.currentTarget); onKeyDown?.(e) }}
      onInput={e => { e.currentTarget.setCustomValidity(""); setInvalid(false); onInput?.(e) }}
      onInvalid={e => {
        if (e.currentTarget.validity.patternMismatch) e.currentTarget.setCustomValidity("Bitte Uhrzeit im 24-Stunden-Format eingeben, z. B. 14:00.")
        onInvalid?.(e)
      }}
    />
  )
}

export { TimeInput }
