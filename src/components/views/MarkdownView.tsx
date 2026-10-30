import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MdEntry } from '../../types/tracker'

const MAX_OPEN = 4

interface OpenFile {
  path:    string
  name:    string
  content: string   // current editor text
  saved:   string   // text as last read from / written to disk
  mtimeMs: number
  mode:    'preview' | 'edit'
}

interface TreeProps {
  dir:       string
  depth:     number
  tree:      Record<string, MdEntry[]>
  expanded:  Set<string>
  activePath: string | null
  openPaths: Set<string>
  onToggle:  (dir: string) => void
  onOpen:    (entry: MdEntry) => void
}

function Tree({ dir, depth, tree, expanded, activePath, openPaths, onToggle, onOpen }: TreeProps) {
  const entries = tree[dir]
  if (!entries) return <div className="md-tree-empty" style={{ paddingLeft: 12 + depth * 14 }}>Loading…</div>
  if (entries.length === 0) return <div className="md-tree-empty" style={{ paddingLeft: 12 + depth * 14 }}>No markdown files</div>
  return (
    <>
      {entries.map(e => e.isDir ? (
        <React.Fragment key={e.path}>
          <button className="md-tree-item md-tree-dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onToggle(e.path)}>
            <span className="md-tree-caret">{expanded.has(e.path) ? '▾' : '▸'}</span>
            <span className="md-tree-name">{e.name}</span>
          </button>
          {expanded.has(e.path) && (
            <Tree dir={e.path} depth={depth + 1} tree={tree} expanded={expanded}
                  activePath={activePath} openPaths={openPaths} onToggle={onToggle} onOpen={onOpen} />
          )}
        </React.Fragment>
      ) : (
        <button
          key={e.path}
          className={`md-tree-item${activePath === e.path ? ' active' : ''}${openPaths.has(e.path) ? ' open' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={e.path}
          onClick={() => onOpen(e)}
        >
          <span className="md-tree-caret" />
          <span className="md-tree-name">{e.name}</span>
        </button>
      ))}
    </>
  )
}

export default function MarkdownView() {
  const [root,       setRoot]       = useState<string | null>(null)
  const [rootError,  setRootError]  = useState<string | null>(null)
  const [tree,       setTree]       = useState<Record<string, MdEntry[]>>({})
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [files,      setFiles]      = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [navOpen,    setNavOpen]    = useState(true)
  const [notice,     setNotice]     = useState<string | null>(null)
  const scrollPos   = useRef<Record<string, number>>({})
  const bodyRef     = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const active = files.find(f => f.path === activePath) ?? null

  function flash(msg: string) {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3500)
  }

  const loadDir = useCallback(async (dir: string) => {
    const res = await window.tracker.mdListDir(dir)
    if (res.error) { flash(res.error); return }
    setTree(prev => ({ ...prev, [dir]: res.entries ?? [] }))
  }, [])

  const loadRoot = useCallback(async (dir: string) => {
    setRoot(dir)
    setTree({})
    setExpanded(new Set())
    await loadDir(dir)
  }, [loadDir])

  useEffect(() => {
    window.tracker.getSetting('markdown_nav_open').then(v => { if (v === 'false') setNavOpen(false) })
  }, [])

  function toggleNav() {
    setNavOpen(!navOpen)
    window.tracker.setSetting('markdown_nav_open', String(!navOpen))
  }

  useEffect(() => {
    window.tracker.mdGetRoot().then(res => {
      if (res.error || !res.root) setRootError(res.error ?? 'No folder configured')
      else loadRoot(res.root)
    })
  }, [loadRoot])

  async function chooseRoot() {
    if (files.some(f => f.content !== f.saved) && !window.confirm('Open files have unsaved changes that will be discarded. Continue?')) return
    const res = await window.tracker.mdChooseRoot()
    if (res.error) { flash(res.error); return }
    if (res.canceled || !res.root) return
    setFiles([])
    setActivePath(null)
    scrollPos.current = {}
    setRootError(null)
    await loadRoot(res.root)
  }

  function toggleDir(dir: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else { next.add(dir); if (!tree[dir]) loadDir(dir) }
      return next
    })
  }

  async function openFile(entry: MdEntry) {
    if (files.some(f => f.path === entry.path)) { switchTo(entry.path); return }
    if (files.length >= MAX_OPEN) { flash(`You can have ${MAX_OPEN} files open — close one first`); return }
    const res = await window.tracker.mdReadFile(entry.path)
    if (res.error || res.content == null || res.path == null) { flash(res.error ?? 'Could not read file'); return }
    const opened: OpenFile = {
      path: res.path, name: entry.name, content: res.content, saved: res.content,
      mtimeMs: res.mtimeMs ?? 0, mode: 'preview',
    }
    stashScroll()
    setFiles(prev => [...prev, opened])
    setActivePath(opened.path)
  }

  function stashScroll() {
    if (activePath && bodyRef.current) scrollPos.current[activePath] = bodyRef.current.scrollTop
  }

  function switchTo(path: string) {
    if (path === activePath) return
    stashScroll()
    setActivePath(path)
  }

  // Restore the scroll position whenever the visible file or its mode changes
  useEffect(() => {
    if (bodyRef.current && activePath) bodyRef.current.scrollTop = scrollPos.current[activePath] ?? 0
  }, [activePath, active?.mode])

  function closeFile(path: string) {
    const f = files.find(x => x.path === path)
    if (f && f.content !== f.saved && !window.confirm(`Discard unsaved changes to ${f.name}?`)) return
    const idx  = files.findIndex(x => x.path === path)
    const next = files.filter(x => x.path !== path)
    delete scrollPos.current[path]
    setFiles(next)
    if (activePath === path) setActivePath(next.length ? next[Math.min(idx, next.length - 1)].path : null)
  }

  function patchFile(path: string, patch: Partial<OpenFile>) {
    setFiles(prev => prev.map(f => f.path === path ? { ...f, ...patch } : f))
  }

  async function save(file: OpenFile) {
    let res = await window.tracker.mdWriteFile(file.path, file.content, file.mtimeMs)
    if (res.conflict) {
      if (!window.confirm(`${file.name} changed on disk since you opened it. Overwrite it with your version?`)) return
      res = await window.tracker.mdWriteFile(file.path, file.content, file.mtimeMs, true)
    }
    if (res.error) { flash(`Save failed: ${res.error}`); return }
    patchFile(file.path, { saved: file.content, mtimeMs: res.mtimeMs ?? file.mtimeMs })
    flash(`Saved ${file.name}`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && active) {
      e.preventDefault()
      save(active)
    }
  }

  const openPaths = new Set(files.map(f => f.path))

  return (
    <div id="view-markdown" className="view">
      <div className="view-card md-card">
        <div className="md-layout">
          {navOpen && (
            <aside className="md-nav">
              <div className="md-nav-head">
                <span className="md-nav-root" title={root ?? ''}>{root ? root.split('/').filter(Boolean).pop() || '/' : 'Files'}</span>
                <button className="md-icon-btn" title="Choose folder" onClick={chooseRoot}>⌂</button>
                <button className="md-icon-btn" title="Refresh" onClick={() => root && loadRoot(root)}>↻</button>
                <button className="md-icon-btn" title="Hide explorer" onClick={toggleNav}>«</button>
              </div>
              <div className="md-tree">
                {rootError && <div className="md-tree-empty">{rootError}</div>}
                {root && (
                  <Tree dir={root} depth={0} tree={tree} expanded={expanded} activePath={activePath}
                        openPaths={openPaths} onToggle={toggleDir} onOpen={openFile} />
                )}
              </div>
            </aside>
          )}

          <section className="md-main">
            <div className="md-filetabs">
              {!navOpen && (
                <button className="md-nav-toggle" title="Show explorer" onClick={toggleNav}>» Files</button>
              )}
              {files.map(f => (
                <div key={f.path} className={`md-filetab${f.path === activePath ? ' active' : ''}`} title={f.path}>
                  <button className="md-filetab-name" onClick={() => switchTo(f.path)}>
                    {f.content !== f.saved && <span className="md-dirty" title="Unsaved changes">●</span>}
                    {f.name}
                  </button>
                  <button className="md-filetab-close" aria-label={`Close ${f.name}`} onClick={() => closeFile(f.path)}>×</button>
                </div>
              ))}
              <span className="md-filetabs-count">{files.length}/{MAX_OPEN}</span>
            </div>

            {active ? (
              <>
                <div className="md-toolbar">
                  <div className="md-mode-toggle">
                    <button className={active.mode === 'preview' ? 'active' : ''} onClick={() => { stashScroll(); patchFile(active.path, { mode: 'preview' }) }}>Preview</button>
                    <button className={active.mode === 'edit' ? 'active' : ''} onClick={() => { stashScroll(); patchFile(active.path, { mode: 'edit' }) }}>Edit</button>
                  </div>
                  <span className="md-toolbar-status">{notice}</span>
                  <button className="settings-save-btn" disabled={active.content === active.saved} onClick={() => save(active)}>Save</button>
                </div>
                <div className="md-body" ref={bodyRef}>
                  {active.mode === 'edit' ? (
                    <textarea
                      className="md-editor"
                      value={active.content}
                      spellCheck={false}
                      onChange={e => patchFile(active.path, { content: e.target.value })}
                      onKeyDown={onKeyDown}
                    />
                  ) : (
                    <div className="md-preview">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} onClick={e => {
                              e.preventDefault()
                              if (href && /^https?:\/\//i.test(href)) window.tracker.openUrl(href)
                            }}>{children}</a>
                          ),
                        }}
                      >{active.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="md-empty">
                <div>Select a markdown file to open it.</div>
                <div className="md-empty-sub">Up to {MAX_OPEN} files can be open at once.</div>
                {notice && <div className="md-empty-sub">{notice}</div>}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
