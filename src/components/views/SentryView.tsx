import React, { useState, useEffect, useRef } from 'react'
import CollapsibleSection from '../CollapsibleSection'
import type { SentryIssue, SentryPreset, SentryProjectResult, IssueDetail, StackFrame, SentrySkill } from '../../types/tracker'

export default function SentryView() {
  const [loaded,       setLoaded]       = useState(false)
  const [spinning,     setSpinning]     = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [projects,     setProjects]     = useState<SentryProjectResult[]>([])
  const [presets,      setPresets]      = useState<SentryPreset[]>([])
  const [activePreset, setActivePreset] = useState<string>('')
  const [claudeSkills, setClaudeSkills] = useState<SentrySkill[]>([])
  const presetsRef = useRef<SentryPreset[]>([])

  useEffect(() => {
    async function init() {
      const [presetsRaw, defaultPreset, skillsRaw, oldSkill] = await Promise.all([
        window.tracker.getSetting('sentry_presets'),
        window.tracker.getSetting('sentry_default_preset'),
        window.tracker.getSetting('sentry_claude_skills'),
        window.tracker.getSetting('sentry_claude_skill'),
      ])
      let skills: SentrySkill[] = []
      try { if (skillsRaw) skills = JSON.parse(skillsRaw) } catch {}
      if (skills.length === 0 && oldSkill) skills = [{ name: oldSkill, command: oldSkill }]
      setClaudeSkills(skills)
      let loaded: SentryPreset[] = []
      try { if (presetsRaw) loaded = JSON.parse(presetsRaw) } catch {}
      setPresets(loaded)
      presetsRef.current = loaded
      const initial = defaultPreset && loaded.some(p => p.name === defaultPreset)
        ? defaultPreset : (loaded[0]?.name ?? '')
      setActivePreset(initial)
      fetchIssues(loaded.find(p => p.name === initial)?.flags ?? '')
    }
    init()
  }, [])

  async function fetchIssues(flags: string) {
    setSpinning(true)
    const { projects: proj, error: err } = await window.tracker.fetchSentry(flags || undefined)
    setSpinning(false)
    setLoaded(true)
    if (err === 'not_configured') { setError('not_configured'); return }
    if (err)                      { setError(err ?? null); return }
    setError(null)
    setProjects(proj || [])
  }

  function handlePresetChange(name: string) {
    setActivePreset(name)
    fetchIssues(presetsRef.current.find(p => p.name === name)?.flags ?? '')
  }

  function reload() {
    fetchIssues(presetsRef.current.find(p => p.name === activePreset)?.flags ?? '')
  }

  useEffect(() => { presetsRef.current = presets }, [presets])

  return (
    <div id="view-sentry" className="view">
      <div className="view-card">
        <div className="tab-toolbar">
          <span className="toolbar-title">Sentry</span>
          {presets.length > 0 && (
            <label className="sentry-filter-label">
              <span className="sentry-filter-text">Filter</span>
              <select
                className="sentry-preset-select"
                value={activePreset}
                onChange={e => handlePresetChange(e.target.value)}
              >
                <option value="">None</option>
                {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button className={`refresh-btn${spinning ? ' spinning' : ''}`} onClick={reload}>↻</button>
        </div>

        <div className="sentry-scroll">
          {!loaded && !error && <div className="loading-state">Loading…</div>}
          {error === 'not_configured' && (
            <div className="config-hint">
              Add projects in Settings → Sentry to get started. Run <code>sentry auth login</code> in your terminal to authenticate.
            </div>
          )}
          {error && error !== 'not_configured' && (
            <div className="config-hint">Error: {error}</div>
          )}
          {!error && projects.length === 0 && loaded && (
            <div className="loading-state">No issues found</div>
          )}
          {!error && projects.map(result => (
            <ProjectSection key={result.project} result={result} claudeSkills={claudeSkills} />
          ))}
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 3

function ProjectSection({ result, claudeSkills }: { result: SentryProjectResult; claudeSkills: SentrySkill[] }) {
  const { project, issues, error } = result
  const issueList = Array.isArray(issues) ? issues as SentryIssue[] : []

  const [page, setPage]       = useState(0)
  const [details, setDetails] = useState<Record<string, IssueDetail | 'loading' | 'error'>>({})

  const totalPages   = Math.max(1, Math.ceil(issueList.length / PAGE_SIZE))
  const currentSlice = issueList.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const issueKey     = issueList.map(i => i.shortId).join(',')

  // Reset page + cache when the issue list changes
  useEffect(() => {
    setPage(0)
    setDetails({})
  }, [issueKey])

  // Fetch details for the current page slice
  useEffect(() => {
    for (const issue of currentSlice) {
      if (!details[issue.shortId]) {
        setDetails(d => ({ ...d, [issue.shortId]: 'loading' }))
        window.tracker.fetchSentryIssue(issue.shortId).then(res => {
          setDetails(d => ({
            ...d,
            [issue.shortId]: res.detail ?? 'error',
          }))
        })
      }
    }
  }, [page, issueKey])

  const label = `${project} (${issueList.length})`

  return (
    <CollapsibleSection label={label} colorClass="group-sentry">
      {error && <div className="config-hint">Failed to load: {error}</div>}
      {!error && issueList.length === 0 && <div className="sentry-empty">No open issues</div>}
      {!error && issueList.length > 0 && (
        <>
          {totalPages > 1 && (
            <div className="sentry-pagination">
              <button
                className="sentry-page-btn"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >‹ Prev</button>
              <span className="sentry-page-info">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, issueList.length)} of {issueList.length}
              </span>
              <button
                className="sentry-page-btn"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >Next ›</button>
            </div>
          )}
          {currentSlice.map(issue => (
            <IssueDetailCard
              key={issue.shortId}
              issue={issue}
              detail={details[issue.shortId] ?? 'loading'}
              claudeSkills={claudeSkills}
            />
          ))}
        </>
      )}
    </CollapsibleSection>
  )
}

function IssueDetailCard({
  issue,
  detail,
  claudeSkills,
}: {
  issue: SentryIssue
  detail: IssueDetail | 'loading' | 'error'
  claudeSkills: SentrySkill[]
}) {
  const [frameOpen,    setFrameOpen]    = useState<boolean[]>([])
  const [skillResults, setSkillResults] = useState<Record<string, string | 'running'>>({})

  useEffect(() => {
    if (detail && detail !== 'loading' && detail !== 'error') {
      setFrameOpen(detail.frames.map(() => false))
    }
  }, [detail])

  const tag = (detail && detail !== 'loading' && detail !== 'error')
    ? (detail.shortId || issue.shortId)
    : issue.shortId

  useEffect(() => {
    if (!tag) return
    window.tracker.getSentrySkillRuns(tag).then(stored => {
      if (Object.keys(stored).length > 0) setSkillResults(stored)
    })
  }, [tag])

  async function runSkill(skill: SentrySkill) {
    setSkillResults(r => ({ ...r, [skill.name]: 'running' }))
    const res = await window.tracker.runSentrySkill(tag, skill.name, skill.command)
    setSkillResults(r => ({ ...r, [skill.name]: res.output ?? `Error: ${res.error}` }))
  }

  function toggleAllFrames() {
    const allOpen = frameOpen.length > 0 && frameOpen.every(v => v)
    setFrameOpen(frameOpen.map(() => !allOpen))
  }

  if (detail === 'loading') {
    return (
      <div className="sentry-detail-card sentry-detail-loading">
        <div className="sentry-detail-id">{issue.shortId}</div>
        <div className="loading-state" style={{ padding: '8px 0' }}>Loading details…</div>
      </div>
    )
  }

  if (detail === 'error') {
    return (
      <div className="sentry-detail-card">
        <div className="sentry-detail-header">
          <span className="sentry-detail-id">{issue.shortId}</span>
          <span className="sentry-detail-title">{issue.title || '(unknown)'}</span>
        </div>
        <div className="config-hint" style={{ margin: '6px 0 0' }}>Failed to load issue details.</div>
      </div>
    )
  }

  const d = detail as IssueDetail

  return (
    <div className="sentry-detail-card">
      {/* Row 1: tag + priority + status + buttons */}
      <div className="sentry-detail-row1">
        <span className="sentry-detail-id">{tag}</span>
        {d.priority && <PriorityChip priority={d.priority} />}
        {d.status   && <StatusChip status={d.status} />}
        <div className="sentry-row1-spacer" />
        {claudeSkills.map(skill => (
          <button
            key={skill.name}
            className="sentry-open-btn"
            disabled={skillResults[skill.name] === 'running'}
            onClick={() => runSkill(skill)}
          >
            {skillResults[skill.name] === 'running' ? `Running /${skill.command}…` : `/${skill.command}`}
          </button>
        ))}
        {d.link && (
          <button className="sentry-open-btn" onClick={() => window.tracker.openUrl(d.link)}>
            Open in browser ↗
          </button>
        )}
      </div>
      {/* Row 2: title */}
      <div className="sentry-detail-title">{d.title || issue.title}</div>

      {/* Meta row */}
      <div className="sentry-detail-meta">
        {d.events   && <span>{d.events} events</span>}
        {d.firstSeen && <><span className="sentry-meta-sep">·</span><span>since {d.firstSeen}</span></>}
        {d.lastSeen  && <><span className="sentry-meta-sep">·</span><span>last {d.lastSeen}</span></>}
        {d.assignee && d.assignee !== 'Unassigned' && (
          <><span className="sentry-meta-sep">·</span><span>{d.assignee}</span></>
        )}
      </div>

      {/* Message */}
      {d.message && (
        <div className="sentry-detail-message">{d.message}</div>
      )}

      {/* Stack Trace */}
      {d.frames.length > 0 && (
        <CollapsibleSection label={`Stack Trace (${d.frames.length} frames)`} colorClass="group-sentry" defaultCollapsed={true}>
          <div className="sentry-frames-toolbar">
            <button className="sentry-toggle-all-btn" onClick={toggleAllFrames}>
              {frameOpen.every(v => v) ? 'Collapse all code' : 'Expand all code'}
            </button>
          </div>
          {d.frames.map((frame, idx) => (
            <StackFrameRow
              key={idx}
              frame={frame}
              open={frameOpen[idx] ?? false}
              onToggle={() => setFrameOpen(f => f.map((v, i) => i === idx ? !v : v))}
            />
          ))}
        </CollapsibleSection>
      )}

      {/* Tags */}
      {d.tags.length > 0 && (
        <div className="sentry-detail-tags">
          {d.tags.map(t => (
            <span key={t.key} className="sentry-tag-item">
              <span className="sentry-tag-key">{t.key}</span>
              <span className="sentry-tag-val">{t.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Breadcrumbs */}
      {d.breadcrumbs.length > 0 && (
        <CollapsibleSection label={`Breadcrumbs (${d.breadcrumbs.length})`} colorClass="group-sentry" defaultCollapsed={true}>
          <div className="sentry-breadcrumbs">
            {d.breadcrumbs.map((b, i) => (
              <div key={i} className={`sentry-crumb sentry-crumb-${b.level}`}>
                <span className="sentry-crumb-time">{b.time}</span>
                <span className="sentry-crumb-level">{b.level}</span>
                <span className="sentry-crumb-cat">{b.category}</span>
                <span className="sentry-crumb-msg">{b.message}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Claude skill outputs */}
      {claudeSkills.map(skill => {
        const result = skillResults[skill.name]
        if (!result) return null
        return (
          <CollapsibleSection
            key={skill.name}
            label={`/${skill.command} output`}
            colorClass="group-sentry"
            defaultCollapsed={false}
          >
            {result === 'running'
              ? <div className="sentry-skill-running">Running /{skill.command}…</div>
              : <pre className="sentry-skill-output">{result}</pre>
            }
          </CollapsibleSection>
        )
      })}
    </div>
  )
}

function StackFrameRow({
  frame,
  open,
  onToggle,
}: {
  frame: StackFrame
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className={`sentry-frame${frame.isInApp ? ' sentry-frame-inapp' : ''}`}>
      <div className="sentry-frame-header" onClick={onToggle}>
        <span className="sentry-frame-toggle">{open ? '▾' : '▸'}</span>
        <span className="sentry-frame-location">{frame.location}</span>
        {frame.isInApp && <span className="sentry-inapp-badge">in-app</span>}
        {frame.file && (
          <span className="sentry-frame-file">
            {frame.file}{frame.line != null ? `:${frame.line}` : ''}
          </span>
        )}
      </div>
      {open && frame.code.length > 0 && (
        <div className="sentry-code-block">
          {frame.code.map((line, i) => (
            <div key={i} className={`sentry-code-line${line.highlight ? ' sentry-code-highlight' : ''}`}>
              <span className="sentry-code-num">{line.num}</span>
              <span className="sentry-code-text">{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const low = status.toLowerCase()
  const cls = low.includes('resolv') ? 'sentry-status-resolved'
            : low.includes('ignor')  ? 'sentry-status-ignored'
            : 'sentry-status-unresolved'
  return <span className={`sentry-chip sentry-status-chip ${cls}`}>{status}</span>
}

function PriorityChip({ priority }: { priority: string }) {
  const low = priority.toLowerCase()
  const cls = low === 'critical' ? 'sentry-triage-critical'
            : low === 'high'     ? 'sentry-triage-high'
            : low === 'medium' || low === 'med' ? 'sentry-triage-medium'
            : 'sentry-triage-low'
  return <span className={`sentry-chip ${cls}`}>{priority}</span>
}
