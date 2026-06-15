import React, { useState, useEffect } from 'react'
import CollapsibleSection from '../CollapsibleSection'
import type { JiraIssue } from '../../types/tracker'

interface Group {
  key:   string
  label: string
  match: (s: string) => boolean
}

const GROUPS: Group[] = [
  { key: 'progress', label: 'In Progress',  match: s => /progress|development|doing/i.test(s) },
  { key: 'review',   label: 'Code Review',  match: s => /review/i.test(s) },
  { key: 'testing',  label: 'Testing',      match: s => /test|qa|verif/i.test(s) },
  { key: 'todo',     label: 'To Do',        match: s => /to.?do|backlog|open|new|selected/i.test(s) },
  { key: 'done',     label: 'Done',         match: s => /done|closed|complete|released|merged/i.test(s) },
]

function getGroup(status: string) {
  for (const g of GROUPS) if (g.match(status)) return g
  return { key: 'other', label: status }
}

export default function JiraView() {
  const [loaded,   setLoaded]   = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [grouped,  setGrouped]  = useState<Map<string, { label: string; items: JiraIssue[] }>>(new Map())

  async function load() {
    setSpinning(true)
    const { issues, error: err } = await window.tracker.fetchJiraSprint()
    setSpinning(false)
    setLoaded(true)
    if (err) { setError(err); return }
    const map = new Map<string, { label: string; items: JiraIssue[] }>()
    for (const issue of issues ?? []) {
      const g = getGroup(issue.status)
      if (!map.has(g.key)) map.set(g.key, { label: g.label, items: [] })
      map.get(g.key)!.items.push(issue)
    }
    setGrouped(map)
    setError(null)
  }

  useEffect(() => { if (!loaded) load() }, [])

  const orderedKeys = [...GROUPS.map(g => g.key), 'other']

  return (
    <div id="view-jira" className="view">
      <div className="view-card">
      <div className="tab-toolbar">
        <span className="toolbar-title">Sprint</span>
        <button className={`refresh-btn${spinning ? ' spinning' : ''}`} onClick={load}>↻</button>
      </div>
      <div className="issue-list">
        {!loaded && <div className="loading-state">Loading…</div>}
        {error === 'not_configured' && (
          <div className="config-hint">
            Configure your Jira credentials in <strong>Settings</strong>.
          </div>
        )}
        {error && error !== 'not_configured' && (
          <div className="config-hint">Error: {error}</div>
        )}
        {loaded && !error && grouped.size === 0 && (
          <div className="loading-state">No issues in current sprint</div>
        )}
        {orderedKeys.map(key => {
          const group = grouped.get(key)
          if (!group) return null
          return (
            <CollapsibleSection key={key} label={group.label} colorClass={`group-${key}`}>
              {group.items.map(issue => (
                <div
                  key={issue.key}
                  className="issue-row"
                  onClick={() => window.tracker.openUrl(issue.url)}
                >
                  <span className="jira-key">{issue.key}</span>
                  <span className="issue-title">{issue.title}</span>
                </div>
              ))}
            </CollapsibleSection>
          )
        })}
      </div>
      </div>
    </div>
  )
}
