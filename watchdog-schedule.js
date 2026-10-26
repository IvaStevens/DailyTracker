/**
 * Watchdog schedule math — pure helpers (no Electron, no DB, no Claude) so main.js
 * owns settings and timers, and claude-service.js owns the Claude call.
 *
 * Schedule shape (stored as JSON in the `watchdog_schedules` setting):
 *   { id, enabled, created, time: 'HH:MM', repeat: 'daily' | 'weekly' | 'monthly' | 'yearly',
 *     weekdays: number[]   // weekly  — 0 = Sunday … 6 = Saturday
 *     dayOfMonth: number   // monthly / yearly — clamped to the last day of short months
 *     month: number }      // yearly  — 1–12
 */
const DAY_MS = 86400000

function daysInMonth(year, month0) { return new Date(year, month0 + 1, 0).getDate() }

function matchesDate(s, d) {
  switch (s.repeat) {
    case 'daily':
      return true
    case 'weekly':
      return Array.isArray(s.weekdays) && s.weekdays.includes(d.getDay())
    case 'monthly':
      return d.getDate() === Math.min(s.dayOfMonth, daysInMonth(d.getFullYear(), d.getMonth()))
    case 'yearly':
      return d.getMonth() + 1 === s.month &&
             d.getDate() === Math.min(s.dayOfMonth, daysInMonth(d.getFullYear(), d.getMonth()))
    default:
      return false
  }
}

function occurrenceOn(s, d) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.time || '')
  if (!m) return null
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10)
  if (h > 23 || min > 59) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min, 0, 0)
}

// Most recent occurrence within `graceMs` of `now` that was scheduled after the
// schedule was created, or null. Looks at today and yesterday so a window that
// straddles midnight is still caught.
function dueOccurrence(s, now, graceMs) {
  if (!s.enabled) return null
  for (const back of [0, 1]) {
    const day = new Date(now.getTime() - back * DAY_MS)
    if (!matchesDate(s, day)) continue
    const occ = occurrenceOn(s, day)
    if (!occ) continue
    const age = now - occ
    if (age >= 0 && age <= graceMs && occ.getTime() >= (s.created || 0)) return occ
  }
  return null
}

// First occurrence strictly after `now`, or null if the schedule is invalid.
function nextOccurrence(s, now) {
  if (!s.enabled) return null
  for (let i = 0; i <= 400; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    if (!matchesDate(s, day)) continue
    const occ = occurrenceOn(s, day)
    if (occ && occ > now) return occ
  }
  return null
}

module.exports = { dueOccurrence, nextOccurrence }
