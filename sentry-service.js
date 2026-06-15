/**
 * Sentry microservice — runs as a forked child process.
 */
const { execFile } = require('child_process')

// Tokenize a flags string into argv tokens, respecting quoted strings.
function tokenizeFlags(str) {
  if (!str || !str.trim()) return []
  const tokens = []
  let current = ''
  let inSingle = false
  let inDouble = false
  for (const ch of str) {
    if      (ch === '"' && !inSingle)              { inDouble = !inDouble }
    else if (ch === "'" && !inDouble)              { inSingle = !inSingle }
    else if (ch === ' ' && !inSingle && !inDouble) { if (current) { tokens.push(current); current = '' } }
    else                                           { current += ch }
  }
  if (current) tokens.push(current)
  return tokens
}

// Parse the ASCII box-drawing table from `sentry issue list`.
function parseIssueTable(output) {
  const lines = output.split('\n').filter(l => l.startsWith('│'))
  if (lines.length === 0) return []

  const colMap = {}
  for (const line of lines) {
    const cells = line.split('│').slice(1, -1).map(c => c.trim())
    if (cells[0] === 'SHORT ID') {
      cells.forEach((h, i) => { colMap[h] = i })
      break
    }
  }

  const idIdx     = colMap['SHORT ID'] ?? 0
  const issueIdx  = colMap['ISSUE']    ?? 1
  const seenIdx   = colMap['SEEN']     ?? 2
  const ageIdx    = colMap['AGE']      ?? 3
  const trendIdx  = colMap['TREND']    ?? -1
  const eventsIdx = colMap['EVENTS']   ?? (trendIdx >= 0 ? 5 : 4)
  const triageIdx = colMap['TRIAGE']   ?? (trendIdx >= 0 ? 7 : 6)

  const issues = []

  for (const line of lines) {
    const cells = line.split('│').slice(1, -1).map(c => c.trim())
    if (cells.length < 5) continue
    if (cells[idIdx] === 'SHORT ID') continue

    if (!cells[idIdx]) {
      const extra = cells[issueIdx]
      if (extra && issues.length > 0) {
        issues[issues.length - 1].title += ': ' + extra.replace(/\.{3}$/, '').trim()
      }
      continue
    }

    const trendRaw   = trendIdx >= 0 ? (cells[trendIdx] || '') : ''
    const trendMatch = trendRaw.match(/\b(New|Ongoing|Regressed|Escalating|Improving)\b/i)

    issues.push({
      shortId: cells[idIdx],
      title:   cells[issueIdx].replace(/\.{3}$/, '').trim(),
      seen:    cells[seenIdx]     || '',
      age:     cells[ageIdx]      || '',
      trend:   trendMatch ? trendMatch[1] : null,
      events:  cells[eventsIdx]   || '',
      triage:  cells[triageIdx]   || '',
    })
  }

  return issues
}

// Parse `sentry issue view <tag>` output into structured data.
function parseIssueView(raw) {
  const text  = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
  const lines = text.split('\n')

  const result = {
    shortId: '', title: '', status: '', priority: '', level: '',
    assignee: '', events: '', firstSeen: '', lastSeen: '', link: '',
    message: '', frames: [], breadcrumbs: [], tags: [],
  }

  // First non-empty, non-separator line = "SHORT-ID: Title"
  for (const l of lines) {
    const t = l.trim()
    if (t && !t.startsWith('━') && !t.startsWith('─')) {
      const sep = t.indexOf(': ')
      if (sep > 0) { result.shortId = t.slice(0, sep); result.title = t.slice(sep + 2) }
      break
    }
  }

  // Parse a ╭...╰ box table starting at or after `startIdx`.
  function parseBox(startIdx) {
    let i = startIdx
    while (i < lines.length && !lines[i].includes('╭')) i++
    i++ // skip ╭ line
    const map = {}
    while (i < lines.length) {
      const l = lines[i]
      if (l.includes('╰')) { i++; break }
      if (l.includes('│') && !l.includes('├')) {
        const cells = l.split('│').slice(1, -1).map(c => c.trim())
        if (cells.length >= 2 && cells[0]) map[cells[0]] = cells[1]
      }
      i++
    }
    return { map, end: i }
  }

  let i = 0
  let metaDone = false

  while (i < lines.length) {
    const line    = lines[i]
    const trimmed = line.trim()

    // First ╭ box → main metadata
    if (!metaDone && line.includes('╭')) {
      const { map, end } = parseBox(i)
      result.status    = (map['Status']     || '').replace(/^[✓✗]\s*/, '').trim()
      result.priority  =  map['Priority']   || ''
      result.level     =  map['Level']      || ''
      result.assignee  =  map['Assignee']   || ''
      result.events    =  map['Events']     || ''
      result.firstSeen =  map['First seen'] || ''
      result.lastSeen  =  map['Last seen']  || ''
      result.link      =  map['Link']       || ''
      metaDone = true
      i = end
      continue
    }

    // Message section
    if (/^message:?$/i.test(trimmed)) {
      i++
      const parts = []
      while (i < lines.length) {
        const l = lines[i]
        const lt = l.trim()
        if (lt.startsWith('File:') || lt.startsWith('Function:') ||
            lt.startsWith('Latest') || l.includes('━') || l.includes('╭')) break
        if (lt) parts.push(lt)
        i++
      }
      result.message = parts.join(' ')
      continue
    }

    // Stack Trace section
    if (/^stack trace$/i.test(trimmed)) {
      i++
      while (i < lines.length) {
        const l  = lines[i]
        const lt = l.trim()
        if (/^breadcrumbs$/i.test(lt) || /^tags$/i.test(lt) || lt.startsWith('─── Span')) break

        // Frame line: " at <location> (<file>:<line>:?)"
        if (/^ at .+\(.+:\d+/.test(l)) {
          const isInApp = l.includes('[in-app]')
          // Strip "at " prefix and "[in-app]" suffix
          const content = l.trim().replace(/^\bat\b\s*/, '').replace(/\s*\[in-app\]\s*$/, '').trim()
          // Split on last " (" to separate class::method from (file:line:col)
          const parenStart = content.lastIndexOf(' (')
          const parenEnd   = content.lastIndexOf(')')
          let location = content
          let file = '', lineNum = null
          if (parenStart > 0 && parenEnd > parenStart) {
            location = content.slice(0, parenStart).trim()
            const fileStr = content.slice(parenStart + 2, parenEnd).trim()
            const fparts = fileStr.split(':')
            // Format: file:line:col or file:line
            if (fparts.length >= 2) {
              const last = fparts[fparts.length - 1]
              if (last === '?' || isNaN(parseInt(last))) fparts.pop()
              lineNum = parseInt(fparts.pop()) || null
              file = fparts.join(':')
            }
          }
          const frame = { location, file, line: lineNum, code: [], isInApp }
          i++
          while (i < lines.length) {
            const cl = lines[i]
            if (/^ at .+\(.+:\d+/.test(cl) ||
                /^breadcrumbs$/i.test(cl.trim()) || /^tags$/i.test(cl.trim()) ||
                cl.trim().startsWith('─── Span')) break
            const cm = cl.match(/^(\s*)(>?)\s*(\d+)\s+\|\s?(.*)$/)
            if (cm) frame.code.push({ num: parseInt(cm[3]), text: cm[4], highlight: cm[2] === '>' })
            i++
          }
          result.frames.push(frame)
          continue
        }

        i++
      }
      continue
    }

    // Breadcrumbs section
    if (/^breadcrumbs$/i.test(trimmed)) {
      i++
      while (i < lines.length && !lines[i].includes('╭')) i++
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (l.includes('╰')) { i++; break }
        if (l.includes('│') && !l.includes('Time') && !l.includes('├')) {
          const cells = l.split('│').slice(1, -1).map(c => c.trim())
          if (cells.length >= 4) {
            result.breadcrumbs.push({ time: cells[0], level: cells[1], category: cells[2], message: cells[3] })
          }
        }
        i++
      }
      continue
    }

    // Tags section
    if (/^tags$/i.test(trimmed)) {
      i++
      while (i < lines.length && !lines[i].includes('╭')) i++
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (l.includes('╰')) { i++; break }
        if (l.includes('│') && !l.includes('Key') && !l.includes('├')) {
          const cells = l.split('│').slice(1, -1).map(c => c.trim())
          if (cells.length >= 2 && cells[0]) result.tags.push({ key: cells[0], value: cells[1] })
        }
        i++
      }
      continue
    }

    i++
  }

  return result
}

process.on('message', ({ id, type, params = {} }) => {

  if (type === 'issue-list') {
    const { project, flags } = params
    if (!project || !/^[^/]+\/[^/]+$/.test(project)) {
      process.send({ id, error: 'issue-list: expected org/project format' })
      return
    }
    const extraArgs = tokenizeFlags(flags || '')
    const argv = ['issue', 'list', ...extraArgs, project]
    execFile('sentry', argv, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) { process.send({ id, error: stderr || err.message }); return }
      try {
        const clean = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
        process.send({ id, data: parseIssueTable(clean) })
      } catch (e) { process.send({ id, error: String(e) }) }
    })
    return
  }

  if (type === 'issue-view') {
    const { tag } = params
    if (!tag) { process.send({ id, error: 'issue-view: tag required' }); return }
    execFile('sentry', ['issue', 'view', tag], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) { process.send({ id, error: stderr || err.message }); return }
      try {
        process.send({ id, data: parseIssueView(stdout) })
      } catch (e) { process.send({ id, error: String(e) }) }
    })
    return
  }

  if (type === 'issue-open') {
    const { tag } = params
    if (!tag) { process.send({ id, error: 'issue-open: tag required' }); return }
    // -w opens the issue in the web browser; fire-and-forget
    execFile('sentry', ['issue', 'view', tag, '-w'], { timeout: 10000 }, () => {
      process.send({ id, data: null })
    })
    return
  }

  process.send({ id, error: `sentry-service: unknown command: ${type}` })
})
