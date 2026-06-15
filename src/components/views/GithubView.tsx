import React, { useState, useEffect } from 'react'
import CollapsibleSection from '../CollapsibleSection'
import ReviewPanel from '../ReviewPanel'
import type { PR } from '../../types/tracker'

interface GithubData {
  myPRs:   PR[]
  reviews: PR[]
  openPRs: PR[]
}

export default function GithubView() {
  const [loaded,       setLoaded]       = useState(false)
  const [spinning,     setSpinning]     = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [data,         setData]         = useState<GithubData | null>(null)
  const [reposMissing, setReposMissing] = useState(false)
  const [reviewCache,  setReviewCache]  = useState<Record<string, string>>({})
  const [running,      setRunning]      = useState<Set<string>>(new Set())
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [commented,    setCommented]    = useState<Set<string>>(new Set())

  async function load() {
    setSpinning(true)
    const { myPRs, reviews, openPRs, error: err } = await window.tracker.fetchGithub()
    setSpinning(false)
    setLoaded(true)

    if (err === 'not_configured') { setError('not_configured'); return }
    if (err)                      { setError(err ?? null); return }

    setError(null)
    const freshData: GithubData = { myPRs: myPRs || [], reviews: reviews || [], openPRs: openPRs || [] }
    setData(freshData)

    // Pre-load cached reviews
    const all = [...(myPRs || []), ...(reviews || []), ...(openPRs || [])]
    const pairs = await Promise.all(all.map(async pr => {
      const cached = await window.tracker.getPrReview(pr.url)
      return [pr.url, cached] as [string, string | null]
    }))
    const cacheMap: Record<string, string> = {}
    for (const [url, text] of pairs) {
      if (text) cacheMap[url] = text
    }
    setReviewCache(cacheMap)

    const commentedUrls = await window.tracker.getCommentedPrUrls()
    setCommented(new Set(commentedUrls))

    const reposSetting = await window.tracker.getSetting('github_repos')
    setReposMissing(!reposSetting)
  }

  useEffect(() => { if (!loaded) load() }, [])

  async function runReview(pr: PR) {
    setRunning(prev => new Set(prev).add(pr.url))
    const result = await window.tracker.runPrReview(pr.url, pr.jiraKey)
    setRunning(prev => { const next = new Set(prev); next.delete(pr.url); return next })
    const text = result.review || `Error: ${result.error}`
    setReviewCache(prev => ({ ...prev, [pr.url]: text }))
  }

  function markCommented(url: string) {
    setCommented(prev => new Set(prev).add(url))
  }

  function toggleExpand(url: string) {
    setExpanded(prev => prev === url ? null : url)
  }

  function toggleSelect(url: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      checked ? next.add(url) : next.delete(url)
      return next
    })
  }

  function toggleSelectAll(prs: PR[], checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      prs.forEach(p => checked ? next.add(p.url) : next.delete(p.url))
      return next
    })
  }

  function runSelected() {
    if (!data) return
    const all = [...data.myPRs, ...data.reviews, ...data.openPRs]
    all.filter(p => selected.has(p.url) && !running.has(p.url)).forEach(pr => runReview(pr))
  }

  const selectCount = [...selected].filter(u => !running.has(u)).length

  if (!loaded && !error) {
    return (
      <div id="view-github" className="view">
        <div className="view-card">
          <div className="loading-state">Loading…</div>
        </div>
      </div>
    )
  }

  const myActive    = data?.myPRs.filter(pr => pr.reviewDecision !== 'APPROVED')   ?? []
  const revActive   = data?.reviews.filter(pr => pr.reviewDecision !== 'APPROVED') ?? []
  const openActive  = data?.openPRs.filter(pr => pr.reviewDecision !== 'APPROVED') ?? []
  const allApproved = [...(data?.myPRs ?? []), ...(data?.reviews ?? []), ...(data?.openPRs ?? [])].filter(pr => pr.reviewDecision === 'APPROVED')

  return (
    <div id="view-github" className="view">
      <div className="view-card">
      <div className="tab-toolbar">
        <span className="toolbar-title">GitHub</span>
        <button
          id="github-bulk-btn"
          className="review-bulk-btn"
          disabled={selectCount === 0}
          onClick={runSelected}
        >
          {selectCount > 0 ? `Review ${selectCount} Selected` : 'Review Selected'}
        </button>
        <button
          className={`refresh-btn${spinning ? ' spinning' : ''}`}
          onClick={load}
        >↻</button>
      </div>

      <div className="issue-list">
        {error === 'not_configured' && (
          <div className="config-hint">
            Run <code>gh auth login</code> in your terminal to authenticate with GitHub.
          </div>
        )}
        {error && error !== 'not_configured' && (
          <div className="config-hint">Error loading GitHub data</div>
        )}

        {!error && reposMissing && (
          <div className="github-repos-hint">
            💡 Add repos in Settings to enable PR diff reviews and Jira matching.
          </div>
        )}

        {!error && data && myActive.length === 0 && revActive.length === 0 && openActive.length === 0 && allApproved.length === 0 && (
          <div className="loading-state">No open pull requests</div>
        )}

        {!error && myActive.length > 0 && (
          <CollapsibleSection label="My PRs" colorClass="group-progress">
            <PRGroup
              prs={myActive}
              selected={selected}
              running={running}
              expanded={expanded}
              reviewCache={reviewCache}
              commented={commented}
              onMarkCommented={markCommented}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={prs => toggleSelectAll(prs, !prs.every(p => selected.has(p.url)))}
              onToggleExpand={toggleExpand}
              onRunReview={runReview}
            />
          </CollapsibleSection>
        )}

        {!error && revActive.length > 0 && (
          <CollapsibleSection label="Review Requested" colorClass="group-review">
            <PRGroup
              prs={revActive}
              selected={selected}
              running={running}
              expanded={expanded}
              reviewCache={reviewCache}
              commented={commented}
              onMarkCommented={markCommented}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={prs => toggleSelectAll(prs, !prs.every(p => selected.has(p.url)))}
              onToggleExpand={toggleExpand}
              onRunReview={runReview}
            />
          </CollapsibleSection>
        )}

        {!error && openActive.length > 0 && (
          <CollapsibleSection label="Open PRs" colorClass="group-open">
            <PRGroup
              prs={openActive}
              selected={selected}
              running={running}
              expanded={expanded}
              reviewCache={reviewCache}
              commented={commented}
              onMarkCommented={markCommented}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={prs => toggleSelectAll(prs, !prs.every(p => selected.has(p.url)))}
              onToggleExpand={toggleExpand}
              onRunReview={runReview}
            />
          </CollapsibleSection>
        )}

        {!error && allApproved.length > 0 && (
          <CollapsibleSection label="Already Approved" colorClass="group-approved" defaultCollapsed={true}>
            <PRGroup
              prs={allApproved}
              selected={selected}
              running={running}
              expanded={expanded}
              reviewCache={reviewCache}
              commented={commented}
              onMarkCommented={markCommented}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={prs => toggleSelectAll(prs, !prs.every(p => selected.has(p.url)))}
              onToggleExpand={toggleExpand}
              onRunReview={runReview}
            />
          </CollapsibleSection>
        )}
      </div>
      </div>
    </div>
  )
}

interface PRGroupProps {
  prs:               PR[]
  selected:          Set<string>
  running:           Set<string>
  expanded:          string | null
  reviewCache:       Record<string, string>
  commented:         Set<string>
  onMarkCommented:   (url: string) => void
  onToggleSelect:    (url: string, checked: boolean) => void
  onToggleSelectAll: (prs: PR[]) => void
  onToggleExpand:    (url: string) => void
  onRunReview:       (pr: PR) => void
}

function PRGroup({ prs, selected, running, expanded, reviewCache, commented, onMarkCommented, onToggleSelect, onToggleSelectAll, onToggleExpand, onRunReview }: PRGroupProps) {
  const allSelected = prs.length > 0 && prs.every(p => selected.has(p.url))

  return (
    <div>
      <div className="review-sel-all-row">
        <input
          type="checkbox"
          className="review-cb"
          checked={allSelected}
          onChange={() => onToggleSelectAll(prs)}
        />
        <span className="review-sel-all-label">Select all</span>
      </div>
      {prs.map(pr => (
        <PRRow
          key={pr.url}
          pr={pr}
          isSelected={selected.has(pr.url)}
          isRunning={running.has(pr.url)}
          isExpanded={expanded === pr.url}
          cached={reviewCache[pr.url] ?? null}
          isCommented={commented.has(pr.url)}
          onToggleSelect={checked => onToggleSelect(pr.url, checked)}
          onToggleExpand={() => onToggleExpand(pr.url)}
          onRunReview={onRunReview}
          onCommented={() => onMarkCommented(pr.url)}
        />
      ))}
    </div>
  )
}

interface PRRowProps {
  pr:             PR
  isSelected:     boolean
  isRunning:      boolean
  isExpanded:     boolean
  cached:         string | null
  isCommented:    boolean
  onToggleSelect: (checked: boolean) => void
  onToggleExpand: () => void
  onRunReview:    (pr: PR) => void
  onCommented:    () => void
}

function PRRow({ pr, isSelected, isRunning, isExpanded, cached, isCommented, onToggleSelect, onToggleExpand, onRunReview, onCommented }: PRRowProps) {
  const repoShort = pr.repo.split('/').pop() || pr.repo
  const reviewed  = !!cached

  return (
    <div className="review-pr-wrap">
      <div
        className={`review-pr-row${isExpanded ? ' expanded' : ''}${reviewed ? ' reviewed' : ''}`}
        onClick={onToggleExpand}
      >
        <div className="review-pr-main">
          <input
            type="checkbox"
            className="review-cb"
            checked={isSelected}
            onClick={e => e.stopPropagation()}
            onChange={e => onToggleSelect(e.target.checked)}
          />

          {pr.jiraKey && (
            <span
              className="review-jira-key"
              title={pr.jiraKey}
              onClick={e => { e.stopPropagation(); window.tracker.openUrl(pr.jiraUrl!) }}
            >{pr.jiraKey}</span>
          )}

          <span
            className="review-pr-link"
            onClick={e => { e.stopPropagation(); window.tracker.openUrl(pr.url) }}
          >{repoShort}#{pr.number}</span>

          <span className="review-pr-title">{pr.title}</span>

          <span className={`review-badge${isRunning ? ' reviewing' : reviewed ? ' done' : ''}`}>
            {isRunning ? 'reviewing…' : reviewed ? 'Reviewed ✓' : 'Not reviewed'}
          </span>

          {pr.draft && <span className="pr-draft">Draft</span>}
          {isCommented && <span className="pr-commented-tag">Commented</span>}
        </div>

        {pr.additions != null && (
          <div className="review-pr-stats">
            <span className="pr-stat-add">+{pr.additions}</span>
            <span className="pr-stat-del">−{pr.deletions}</span>
            <span className="pr-stat-files">· {pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}</span>
          </div>
        )}
      </div>

      {isExpanded && (
        <ReviewPanel
          pr={pr}
          running={isRunning}
          cached={cached}
          onRun={onRunReview}
          onCommented={onCommented}
        />
      )}
    </div>
  )
}
