import React from 'react'

export default function AppHeader() {
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="app-header">
      <h1 className="app-title">Daily Tracker</h1>
      <span className="app-date">{dateLabel}</span>
    </div>
  )
}
