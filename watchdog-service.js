/**
 * Watchdog service — schedule math and terminal launching for the Claude watchdog.
 * Pure helpers (no Electron, no DB) so main.js owns settings and timers.
 *
 * Schedule shape (stored as JSON in the `watchdog_schedules` setting):
 *   { id, enabled, created, time: 'HH:MM', repeat: 'daily' | 'weekly' | 'monthly' | 'yearly',
 *     weekdays: number[]   // weekly  — 0 = Sunday … 6 = Saturday
 *     dayOfMonth: number   // monthly / yearly — clamped to the last day of short months
 *     month: number }      // yearly  — 1–12
 */
const fs   = require('fs')
const path = require('path')
const { spawn } = require('child_process')

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

// ── Terminal launching ────────────────────────────────────────────────────────
// Runs `claude -p <message>` in a visible terminal. -p prints the reply and exits,
// so the session ends by itself; the terminal closes a few seconds later. On a
// non-zero exit it stays open so the error can be read.
const RUN_SCRIPT =
  '"$1" -p "$2"; s=$?; echo; ' +
  'if [ $s -eq 0 ]; then echo "[Daily Tracker] Claude replied — closing."; sleep 4; ' +
  'else echo "[Daily Tracker] claude exited with code $s — press Enter to close."; read -r _; fi'

// [binary, args placed before the command]
const LINUX_TERMINALS = [
  ['gnome-terminal',     ['--']],
  ['konsole',            ['-e']],
  ['xfce4-terminal',     ['-x']],
  ['x-terminal-emulator', ['-e']],
  ['xterm',              ['-e']],
]

function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, name)
    try { fs.accessSync(p, fs.constants.X_OK); return p } catch (_) {}
  }
  return null
}

const shQuote  = s => `'${String(s).replace(/'/g, `'\\''`)}'`
const asEscape = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')

function terminalCommand(claudePath, message) {
  if (process.platform === 'darwin') {
    const line = `${shQuote(claudePath)} -p ${shQuote(message)}; sleep 4; exit`
    return { bin: 'osascript', args: ['-e', `tell application "Terminal" to do script "${asEscape(line)}"`, '-e', 'tell application "Terminal" to activate'] }
  }
  for (const [name, lead] of LINUX_TERMINALS) {
    const bin = findOnPath(name)
    if (bin) return { bin, args: [...lead, 'bash', '-lc', RUN_SCRIPT, '_', claudePath, message] }
  }
  return null
}

function launchClaudeInTerminal(claudePath, message) {
  return new Promise((resolve) => {
    const cmd = terminalCommand(claudePath, message)
    if (!cmd) return resolve({ error: 'No supported terminal emulator found' })

    let settled = false
    const done = r => { if (!settled) { settled = true; resolve(r) } }
    try {
      const proc = spawn(cmd.bin, cmd.args, { detached: true, stdio: 'ignore', cwd: require('os').homedir() })
      proc.on('error', e => done({ error: `Failed to open terminal: ${e.message}` }))
      proc.on('exit', code => { if (code) done({ error: `${path.basename(cmd.bin)} exited with code ${code}` }) })
      proc.unref()
      // Terminals that stay in the foreground never exit while open — treat a live process as launched.
      setTimeout(() => done({}), 1500)
    } catch (e) { done({ error: `Failed to open terminal: ${e.message}` }) }
  })
}

module.exports = { dueOccurrence, nextOccurrence, launchClaudeInTerminal }
