import React, { useState, useEffect, useRef, useCallback } from 'react'
import TabBar from './components/TabBar'
import AppHeader from './components/AppHeader'
import MeetingAlert from './components/MeetingAlert'
import TodayView from './components/views/TodayView'
import CalendarView from './components/views/CalendarView'
import JiraView from './components/views/JiraView'
import GithubView from './components/views/GithubView'
import SentryView from './components/views/SentryView'
import NotesView from './components/views/NotesView'
import MarkdownView from './components/views/MarkdownView'
import SettingsView from './components/views/SettingsView'
import { TABS } from './components/tabs'
import type { Todo, Meeting, HistoryDay, AlertMode, TabId, ThemeId } from './types/tracker'

const TODAY_STR = new Date().toLocaleDateString('en-CA')

export default function App() {
  const [currentTab,  setCurrentTab]  = useState<TabId>('today')
  const [todos,       setTodos]       = useState<Todo[]>([])
  const [meetings,    setMeetings]    = useState<Meeting[]>([])
  const [notesData,   setNotesData]   = useState<Record<string, string>>({})
  const [calHistory,  setCalHistory]  = useState<Record<string, HistoryDay>>({})
  const [alertMode,   setAlertMode]   = useState<AlertMode>('alarm')
  const [theme,       setTheme]       = useState<ThemeId>('default')
  const [hiddenTabs,  setHiddenTabs]  = useState<TabId[]>([])
  const [syncVisible, setSyncVisible] = useState(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initial load
  useEffect(() => {
    async function boot() {
      const savedMode  = await window.tracker.getSetting('meeting_alert_mode')
      if (savedMode) setAlertMode(savedMode as AlertMode)

      const savedTheme = await window.tracker.getSetting('app_theme')
      if (savedTheme) {
        setTheme(savedTheme as ThemeId)
        document.documentElement.setAttribute('data-theme', savedTheme)
      }

      try {
        const savedHidden = await window.tracker.getSetting('hidden_tabs')
        if (savedHidden) setHiddenTabs(JSON.parse(savedHidden) as TabId[])
      } catch (_) { /* malformed setting — show every tab */ }

      await window.tracker.archivePastDone(TODAY_STR)

      const [loadedTodos, history, icsResult, notes] = await Promise.all([
        window.tracker.readTodos(),
        window.tracker.readHistory(),
        window.tracker.fetchICSRange(TODAY_STR, TODAY_STR),
        window.tracker.readNotes(),
      ])

      setTodos(loadedTodos)
      setCalHistory(history)
      setMeetings(icsResult[TODAY_STR] || [])
      setNotesData(notes)
    }
    boot()
  }, [])

  // File-change watcher: reload todos when the file changes externally
  useEffect(() => {
    window.tracker.onFileChanged(async () => {
      const fresh = await window.tracker.readTodos()
      setTodos(fresh)
      showSync()
    })
  }, [])

  // Hourly calendar refresh (8am–4pm)
  useEffect(() => {
    function scheduleRefresh() {
      const now  = new Date()
      const next = new Date(now)
      next.setMinutes(0, 0, 0)
      next.setHours(next.getHours() + 1)

      const id = setTimeout(async () => {
        if (new Date().toLocaleDateString('en-CA') !== TODAY_STR) {
          window.location.reload()
          return
        }
        const hour = new Date().getHours()
        if (hour >= 8 && hour < 17) {
          const result = await window.tracker.fetchICSRange(TODAY_STR, TODAY_STR)
          const fresh  = result[TODAY_STR] || []
          setMeetings(fresh)
        }
        scheduleRefresh()
      }, next.getTime() - now.getTime())

      return id
    }
    const id = scheduleRefresh()
    return () => clearTimeout(id)
  }, [])

  function showSync() {
    setSyncVisible(true)
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => setSyncVisible(false), 3000)
  }

  async function save(next: Todo[]) {
    setTodos(next)
    await window.tracker.writeTodos(next)
  }

  const handleToggle = useCallback(async (todo: Todo) => {
    const wasDone = ['done', 'skipped'].includes(todo.status)
    const next = todos.map(t => t === todo
      ? { ...t, status: wasDone ? 'todo' : 'done', completed_date: wasDone ? null : TODAY_STR } as Todo
      : t
    )
    await save(next)
  }, [todos])

  const handleRemove = useCallback(async (todo: Todo) => {
    await save(todos.filter(t => t !== todo))
  }, [todos])

  const handleAdd = useCallback(async (title: string) => {
    await save([...todos, { title, status: 'todo', note: '', completed_date: null }])
  }, [todos])

  const handleReorder = useCallback(async (reordered: Todo[]) => {
    await save(reordered)
  }, [todos])

  const handleUpdateNote = useCallback((date: string, text: string) => {
    setNotesData(prev => ({ ...prev, [date]: text }))
  }, [])

  const handleAlertModeChange = useCallback(async (mode: AlertMode) => {
    setAlertMode(mode)
    await window.tracker.setSetting('meeting_alert_mode', mode)
  }, [])

  const handleHiddenTabsChange = useCallback(async (hidden: TabId[]) => {
    setHiddenTabs(hidden)
    await window.tracker.setSetting('hidden_tabs', JSON.stringify(hidden))
  }, [])

  // If the active tab gets hidden, fall back to the first one still visible
  useEffect(() => {
    const visible = TABS.filter(t => t.locked || !hiddenTabs.includes(t.id))
    if (!visible.some(t => t.id === currentTab)) setCurrentTab(visible[0].id)
  }, [hiddenTabs, currentTab])

  const handleThemeChange = useCallback(async (t: ThemeId) => {
    setTheme(t)
    document.documentElement.setAttribute('data-theme', t)
    await window.tracker.setSetting('app_theme', t)
  }, [])

  return (
    <div className="app" data-bs-theme="dark">
      <AppHeader />
      <div className="frame-body">
        <div className="frame-left">
          <TabBar current={currentTab} hiddenTabs={hiddenTabs} onChange={setCurrentTab} />
        </div>
        <div className="frame-content">
          {currentTab === 'today' && (
            <TodayView
              todos={todos}
              meetings={meetings}
              notesData={notesData}
              calHistory={calHistory}
              onToggle={handleToggle}
              onRemove={handleRemove}
              onAdd={handleAdd}
              onReorder={handleReorder}
            />
          )}
          {currentTab === 'calendar' && (
            <CalendarView
              todos={todos}
              notesData={notesData}
              calHistory={calHistory}
              onHistoryLoaded={setCalHistory}
            />
          )}
          {currentTab === 'jira'    && <JiraView />}
          {currentTab === 'github'  && <GithubView />}
          {currentTab === 'sentry'  && <SentryView />}
          {currentTab === 'notes'   && (
            <NotesView
              notesData={notesData}
              onUpdateNote={handleUpdateNote}
            />
          )}
          {currentTab === 'markdown' && <MarkdownView />}
          {currentTab === 'settings' && (
            <SettingsView
              alertMode={alertMode}
              onAlertModeChange={handleAlertModeChange}
              theme={theme}
              onThemeChange={handleThemeChange}
              hiddenTabs={hiddenTabs}
              onHiddenTabsChange={handleHiddenTabsChange}
            />
          )}
          {syncVisible && <div id="sync-toast" className="show">Synced</div>}
        </div>
      </div>
      <MeetingAlert meetings={meetings} alertMode={alertMode} />
    </div>
  )
}
