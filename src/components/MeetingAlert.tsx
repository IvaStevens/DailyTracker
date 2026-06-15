import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { Meeting, AlertMode } from '../types/tracker'

interface AlertItem {
  meeting:   Meeting
  threshold: number
}

function getMeetingKey(m: Meeting) { return `${m.sortKey}:${m.summary}` }

interface Props {
  meetings:  Meeting[]
  alertMode: AlertMode
}

export default function MeetingAlert({ meetings, alertMode }: Props) {
  const [current, setCurrent]   = useState<AlertItem | null>(null)
  const [ringing, setRinging]   = useState(false)

  const audioCtxRef       = useRef<AudioContext | null>(null)
  const ringIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const alertTimeoutsRef  = useRef<ReturnType<typeof setTimeout>[]>([])
  const queueRef          = useRef<AlertItem[]>([])
  const dismissedRef      = useRef<Set<string>>(new Set())

  const playBell = useCallback(() => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()
      for (let i = 0; i < 3; i++) {
        const t    = ctx.currentTime + i * 0.65
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(1047, t)
        osc.frequency.exponentialRampToValueAtTime(523, t + 0.6)
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.45, t + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
        osc.start(t); osc.stop(t + 1.1)
      }
    } catch (e) { console.error('[alert] bell error:', e) }
  }, [])

  const stopRinging = useCallback(() => {
    setRinging(false)
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null }
  }, [])

  const showNext = useCallback(() => {
    if (queueRef.current.length === 0) { setCurrent(null); return }
    if (alertMode === 'none') { queueRef.current = []; setCurrent(null); return }
    const item = queueRef.current.shift()!
    setCurrent(item)
    setRinging(true)
    if (alertMode === 'alarm') {
      playBell()
      ringIntervalRef.current = setInterval(playBell, 5000)
    }
  }, [alertMode, playBell])

  // Schedule alerts whenever meetings change
  useEffect(() => {
    alertTimeoutsRef.current.forEach(id => clearTimeout(id))
    alertTimeoutsRef.current = []

    const now = Date.now()
    for (const m of meetings) {
      if (!m.sortKey) continue
      const key = getMeetingKey(m)
      if (dismissedRef.current.has(key)) continue

      for (const mins of [15, 5, 2]) {
        const delay = m.sortKey - mins * 60000 - now
        if (delay <= 0) continue
        const id = setTimeout(() => {
          if (dismissedRef.current.has(key)) return
          queueRef.current.push({ meeting: m, threshold: mins })
          if (!current) showNext()
        }, delay)
        alertTimeoutsRef.current.push(id)
      }
    }
  }, [meetings]) // eslint-disable-line react-hooks/exhaustive-deps

  const snooze = () => {
    stopRinging()
    setCurrent(null)
    showNext()
  }

  const dismiss = () => {
    stopRinging()
    if (current) {
      const key = getMeetingKey(current.meeting)
      dismissedRef.current.add(key)
      queueRef.current = queueRef.current.filter(a => getMeetingKey(a.meeting) !== key)
    }
    setCurrent(null)
    showNext()
  }

  // Apply ringing class to app shell
  useEffect(() => {
    const app = document.querySelector('.app')
    if (!app) return
    app.classList.toggle('ringing', ringing)
    return () => { app.classList.remove('ringing') }
  }, [ringing])

  if (!current) return null

  const timeLabel =
    current.threshold === 2 ? 'Starting in 2 minutes' :
    current.threshold === 5 ? 'Starting in 5 minutes' :
                               'Starting in 15 minutes'

  return (
    <div className="meeting-alert" style={{ display: 'flex' }}>
      <div className="alert-icon">📅</div>
      <div className="alert-body">
        <div className="alert-title">{current.meeting.summary}</div>
        <div className="alert-time">{timeLabel}</div>
      </div>
      <div className="alert-actions">
        {current.meeting.meetUrl && (
          <button className="alert-btn-join" onClick={() => window.tracker.openUrl(current.meeting.meetUrl!)}>Join ↗</button>
        )}
        <button className="alert-btn-snooze"  onClick={snooze}>Snooze</button>
        <button className="alert-btn-dismiss" onClick={dismiss}>Dismiss All</button>
      </div>
    </div>
  )
}
