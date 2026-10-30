import type React from 'react'
import { CheckCircle, Calendar, Ticket, Github, AlertTriangle, StickyNote, FileText, Settings } from 'griddy-icons'
import type { TabId } from '../types/tracker'

export interface TabDef {
  id:     TabId
  label:  string
  Icon:   React.ComponentType<{ size?: number | string; color?: string }>
  /** Settings must stay reachable, so it can never be hidden. */
  locked?: boolean
}

export const TABS: TabDef[] = [
  { id: 'today',    label: 'Today',    Icon: CheckCircle   },
  { id: 'calendar', label: 'Calendar', Icon: Calendar      },
  { id: 'jira',     label: 'Jira',     Icon: Ticket        },
  { id: 'github',   label: 'GitHub',   Icon: Github        },
  { id: 'sentry',   label: 'Sentry',   Icon: AlertTriangle },
  { id: 'notes',    label: 'Notes',    Icon: StickyNote    },
  { id: 'markdown', label: 'Markdown', Icon: FileText      },
  { id: 'settings', label: 'Settings', Icon: Settings, locked: true },
]
