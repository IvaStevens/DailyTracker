import React, { useState } from 'react'

interface Props {
  label:            string
  colorClass:       string
  defaultCollapsed?: boolean
  children:         React.ReactNode
}

export default function CollapsibleSection({ label, colorClass, defaultCollapsed = false, children }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className={`collapsible-section${collapsed ? ' collapsed' : ''}`}>
      <div
        className={`section-header ${colorClass}`}
        onClick={() => setCollapsed(c => !c)}
      >
        <span>{label}</span>
        <span className="section-arrow">›</span>
      </div>
      <div className="section-content">{children}</div>
    </div>
  )
}
