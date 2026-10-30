import React from 'react'
import Nav from 'react-bootstrap/Nav'
import { TABS } from './tabs'
import type { TabId } from '../types/tracker'

interface Props {
  current:    TabId
  hiddenTabs: TabId[]
  onChange:   (tab: TabId) => void
}

export default function TabBar({ current, hiddenTabs, onChange }: Props) {
  return (
    <Nav className="app-tabs" role="tablist">
      {TABS.filter(t => t.locked || !hiddenTabs.includes(t.id)).map(({ id, label, Icon }) => (
        <Nav.Item key={id}>
          <Nav.Link
            as="button"
            id={`tab-${id}`}
            className={`app-tab${current === id ? ' active' : ''}`}
            title={label}
            aria-selected={current === id}
            onClick={() => onChange(id)}
          >
            <span className="tab-icon">
              <Icon size={28} color="currentColor" />
            </span>
            <span className="tab-label">{label}</span>
          </Nav.Link>
        </Nav.Item>
      ))}
    </Nav>
  )
}
