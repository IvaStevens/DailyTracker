# Daily Tracker

A personal Electron desktop app for staying on top of daily work — todos, calendar, Jira, GitHub PRs, and Sentry issues in one place.

## Features

- **Today** — Todo list with in-progress, done, and skipped states. Past items are auto-archived to history.
- **Calendar** — Pulls meetings from an ICS/Outlook calendar URL with meeting link detection.
- **Jira** — Shows your current sprint issues and their statuses.
- **GitHub** — Lists your PRs, review-requested PRs, and open PRs. Run Claude AI reviews on any PR and post selected feedback as GitHub comments.
- **Sentry** — Monitors error issues across projects with skill-based triage (root cause, fix suggestions).
- **Notes** — Daily scratchpad, one note per day.

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [Electron](https://www.electronjs.org/) (installed via npm)
- [gh CLI](https://cli.github.com/) — authenticated via `gh auth login`
- [sentry-cli](https://docs.sentry.io/cli/) — authenticated via `sentry-cli login`
- A Jira account with API token

## Setup

```bash
npm install
```

Configure integrations in the app's Settings tab after launching:

| Setting | Description |
|---|---|
| Jira domain | e.g. `yourcompany.atlassian.net` |
| Jira email | Your Atlassian account email |
| Jira API token | Generate at id.atlassian.com |
| Jira project key | e.g. `PROJ` |
| Calendar URL | ICS/webcal URL from Outlook or Google Calendar |
| GitHub repos | Comma-separated list of `owner/repo` for PR diff reviews |
| Sentry projects | Project slugs to monitor |

GitHub and Sentry auth is handled by their respective CLIs — no tokens stored in the app.

## Running

```bash
# Development (hot reload)
npm run dev

# Production build
npm start
```

## Tech Stack

- Electron + React + TypeScript
- Vite
- SQLite (via better-sqlite3) for local storage
- Electron safeStorage for credential encryption
