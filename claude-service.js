/**
 * Claude microservice — runs as a forked child process.
 * Owns every interaction with the `claude` CLI; only responds to one predetermined
 * command type and ignores everything else.
 *
 *   run-prompt   headless `claude -p <prompt>`; replies with the output text
 */
const os = require('os')
const { spawn } = require('child_process')

// Resolve `claude` binary path once from the login shell so Electron finds it
// regardless of how the app was launched (Dock, Finder, etc.)
let _claudePath = null
function getClaudePath() {
  return new Promise((resolve) => {
    if (_claudePath) return resolve(_claudePath)
    const proc = spawn('/bin/zsh', ['-lc', 'which claude'], {
      env: { ...process.env, HOME: os.homedir() },
    })
    let out = ''
    proc.stdout.on('data', d => { out += d })
    proc.on('close', () => { _claudePath = out.trim() || 'claude'; resolve(_claudePath) })
    proc.on('error', () => { _claudePath = 'claude'; resolve(_claudePath) })
  })
}

// ── run-prompt ────────────────────────────────────────────────────────────────
function runPrompt(claudeExec, prompt) {
  return new Promise((resolve) => {
    const proc = spawn(claudeExec, ['-p', prompt], {
      env: { ...process.env, HOME: os.homedir() },
      cwd: os.homedir(),
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('close', code => {
      const text = out.trim()
      if (!text) return resolve({ error: err.trim() || `claude exited with code ${code}` })
      resolve({ data: text })
    })
    proc.on('error', e => resolve({ error: `Failed to launch claude: ${e.message}` }))
  })
}

process.on('message', async ({ id, type, params = {} }) => {

  if (type === 'run-prompt') {
    const { prompt } = params
    if (!prompt) { process.send({ id, error: 'run-prompt: prompt required' }); return }
    const res = await runPrompt(await getClaudePath(), prompt)
    process.send({ id, ...res })
    return
  }

  process.send({ id, error: `unknown command: ${type}` })
})
