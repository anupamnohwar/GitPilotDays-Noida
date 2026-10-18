import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, dataDir } from './database.js'
import { scanProject } from './scanner.js'
import { createPassport, passportMarkdown } from './passport.js'
import { configureAuth } from './auth.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const here = path.dirname(fileURLToPath(import.meta.url))
const projectsDir = path.join(dataDir, 'projects')
const tempDir = path.join(dataDir, 'uploads')
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(tempDir, { recursive: true })
app.use(express.json({ limit: '1mb' }))
configureAuth(app, db, port)

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      callback(new Error('Only .zip archives can be imported.'))
      return
    }
    callback(null, true)
  },
})

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const cleanText = (value, maxLength = 5000) => typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
const findProject = (projectId, userId) => db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(projectId, userId)

function getProjectDetail(project) {
  const scan = JSON.parse(project.summary_json)
  if (!Array.isArray(scan.toolCompatibility)) {
    scan.toolCompatibility = scanProject(project.root_path).toolCompatibility
    db.prepare('UPDATE projects SET summary_json = ? WHERE id = ? AND owner_id = ?')
      .run(JSON.stringify(scan), project.id, project.owner_id)
  }
  const issues = db.prepare('SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC').all(project.id)
    .map((issue) => ({
      ...issue,
      attempts: db.prepare('SELECT * FROM attempts WHERE issue_id = ? ORDER BY created_at DESC').all(issue.id),
    }))
  const constraints = db.prepare('SELECT * FROM constraints WHERE project_id = ? ORDER BY created_at DESC').all(project.id)
  const verifications = db.prepare('SELECT * FROM verifications WHERE project_id = ? ORDER BY created_at DESC LIMIT 30').all(project.id)
  return {
    id: project.id,
    name: project.name,
    source: project.source,
    scanned_at: project.scanned_at,
    created_at: project.created_at,
    last_opened_at: project.last_opened_at || project.created_at,
    language: scan.language,
    framework: scan.framework,
    issue_count: issues.filter((issue) => issue.status === 'open').length,
    scan,
    issues,
    constraints,
    verifications,
  }
}

function storeProject({ projectId = id(), name, rootPath, source, ownerId }) {
  const summary = scanProject(rootPath)
  const timestamp = now()
  db.prepare(`
    INSERT INTO projects (id, name, root_path, owner_id, source, scanned_at, summary_json, created_at, last_opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, cleanText(name, 120) || summary.packageName, rootPath, ownerId, source, timestamp, JSON.stringify(summary), timestamp, timestamp)
  return getProjectDetail(findProject(projectId, ownerId))
}

function resolveZipEntry(destination, entryName) {
  const normalized = entryName.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error('Archive contains an absolute path.')
  const target = path.resolve(destination, normalized)
  if (target !== destination && !target.startsWith(`${destination}${path.sep}`)) {
    throw new Error('Archive contains a path outside the project directory.')
  }
  return target
}

function extractZipSafely(zipPath, destination) {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  if (entries.length > 10000) throw new Error('Archive contains too many files (10,000 maximum).')
  let totalBytes = 0
  for (const entry of entries) {
    totalBytes += entry.header.size
    if (totalBytes > 250 * 1024 * 1024) throw new Error('Expanded project must be 250 MB or smaller.')
    const target = resolveZipEntry(destination, entry.entryName)
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, entry.getData())
  }
  const children = fs.readdirSync(destination, { withFileTypes: true })
  if (children.length === 1 && children[0].isDirectory()) return path.join(destination, children[0].name)
  return destination
}

function runProcess(command, args, cwd, timeoutMs = 120000, useShell = process.platform === 'win32') {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: useShell,
      windowsHide: true,
      env: { ...process.env, CI: '1', npm_config_audit: 'false', npm_config_fund: 'false' },
    })
    let output = ''
    let timedOut = false
    const append = (chunk) => {
      output = (output + chunk.toString()).slice(-30000)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, output: `${output}\n${error.message}`.trim(), timedOut: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output: output.trim(), timedOut })
    })
  })
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY last_opened_at DESC, created_at DESC').all(req.user.id)
    .map((project) => {
      const scan = JSON.parse(project.summary_json)
      return {
        id: project.id,
        name: project.name,
        source: project.source,
        scanned_at: project.scanned_at,
        last_opened_at: project.last_opened_at || project.created_at,
        language: scan.language,
        framework: scan.framework,
        issue_count: db.prepare("SELECT COUNT(*) AS count FROM issues WHERE project_id = ? AND status = 'open'").get(project.id).count,
      }
    })
  res.json(projects)
})

app.get('/api/projects/:id', (req, res) => {
  db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ? AND owner_id = ?').run(now(), req.params.id, req.user.id)
  const project = findProject(req.params.id, req.user.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  res.json(getProjectDetail(project))
})

app.post('/api/projects/import/zip', upload.single('archive'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a ZIP archive to import.' })
  const projectId = id()
  const destination = path.join(projectsDir, projectId)
  try {
    fs.mkdirSync(destination, { recursive: true })
    const rootPath = extractZipSafely(req.file.path, destination)
    const project = storeProject({ projectId, name: cleanText(req.body.name, 120), rootPath, source: 'ZIP upload', ownerId: req.user.id })
    res.status(201).json(project)
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true })
    res.status(400).json({ error: error.message || 'Could not import ZIP archive.' })
  } finally {
    fs.rmSync(req.file.path, { force: true })
  }
})

app.post('/api/projects/import/git', async (req, res) => {
  const repositoryUrl = cleanText(req.body.url, 500)
  let parsed
  try {
    parsed = new URL(repositoryUrl)
  } catch {
    return res.status(400).json({ error: 'Enter a valid HTTPS repository URL.' })
  }
  if (
    parsed.protocol !== 'https:' ||
    !['github.com', 'gitlab.com', 'bitbucket.org'].includes(parsed.hostname.toLowerCase()) ||
    parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
    !/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(parsed.pathname)
  ) {
    return res.status(400).json({ error: 'Use a public HTTPS GitHub, GitLab, or Bitbucket repository URL.' })
  }
  const projectId = id()
  const destination = path.join(projectsDir, projectId)
  fs.mkdirSync(projectsDir, { recursive: true })
  const clone = await runProcess('git', ['clone', '--depth', '1', '--', repositoryUrl, destination], projectsDir, 90000, false)
  if (clone.code !== 0) {
    fs.rmSync(destination, { recursive: true, force: true })
    return res.status(400).json({ error: clone.timedOut ? 'Git clone timed out.' : `Git clone failed: ${clone.output.slice(-1500)}` })
  }
  try {
    const name = cleanText(req.body.name, 120) || path.basename(parsed.pathname.replace(/\/$/, '').replace(/\.git$/, ''))
    res.status(201).json(storeProject({ projectId, name, rootPath: destination, source: repositoryUrl, ownerId: req.user.id }))
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true })
    res.status(400).json({ error: error.message || 'Could not scan the cloned project.' })
  }
})

app.post('/api/projects/:id/rescan', (req, res) => {
  const project = findProject(req.params.id, req.user.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  try {
    const scan = scanProject(project.root_path)
    db.prepare('UPDATE projects SET summary_json = ?, scanned_at = ? WHERE id = ? AND owner_id = ?')
      .run(JSON.stringify(scan), now(), project.id, req.user.id)
    res.json(getProjectDetail(findProject(project.id, req.user.id)))
  } catch (error) {
    res.status(400).json({ error: error.message || 'Project scan failed.' })
  }
})

app.delete('/api/projects/:id', (req, res) => {
  const project = findProject(req.params.id, req.user.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(project.id, req.user.id)
  const projectRoot = path.resolve(project.root_path)
  const storageDir = path.basename(projectRoot) === project.id ? projectRoot : path.dirname(projectRoot)
  if (path.dirname(storageDir) === path.resolve(projectsDir)) {
    fs.rmSync(storageDir, { recursive: true, force: true })
  }
  res.status(204).end()
})

app.post('/api/projects/:id/issues', (req, res) => {
  const project = findProject(req.params.id, req.user.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  const title = cleanText(req.body.title, 200)
  if (!title) return res.status(400).json({ error: 'Issue title is required.' })
  const issueId = id()
  db.prepare(`INSERT INTO issues (id, project_id, title, details, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?)`)
    .run(issueId, project.id, title, cleanText(req.body.details), now(), now())
  res.status(201).json(getProjectDetail(project).issues.find((issue) => issue.id === issueId))
})

app.patch('/api/projects/:id/issues/:issueId', (req, res) => {
  if (!findProject(req.params.id, req.user.id)) return res.status(404).json({ error: 'Project not found.' })
  const issue = db.prepare('SELECT * FROM issues WHERE id = ? AND project_id = ?').get(req.params.issueId, req.params.id)
  if (!issue) return res.status(404).json({ error: 'Issue not found.' })
  if (!['open', 'resolved'].includes(req.body.status)) return res.status(400).json({ error: 'Status must be open or resolved.' })
  db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').run(req.body.status, now(), issue.id)
  res.json({ ...issue, status: req.body.status, updated_at: now() })
})

app.post('/api/projects/:id/issues/:issueId/attempts', (req, res) => {
  if (!findProject(req.params.id, req.user.id)) return res.status(404).json({ error: 'Project not found.' })
  const issue = db.prepare('SELECT * FROM issues WHERE id = ? AND project_id = ?').get(req.params.issueId, req.params.id)
  if (!issue) return res.status(404).json({ error: 'Issue not found.' })
  const description = cleanText(req.body.description, 2000)
  const outcome = cleanText(req.body.outcome, 40)
  if (!description) return res.status(400).json({ error: 'Describe the attempted fix.' })
  if (!['failed', 'worked', 'inconclusive'].includes(outcome)) return res.status(400).json({ error: 'Choose a valid attempt outcome.' })
  const attemptId = id()
  const timestamp = now()
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO attempts (id, issue_id, description, outcome, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(attemptId, issue.id, description, outcome, timestamp)
    db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?')
      .run(outcome === 'worked' ? 'resolved' : 'open', timestamp, issue.id)
  })
  tx()
  res.status(201).json({ id: attemptId, description, outcome, created_at: timestamp })
})

app.post('/api/projects/:id/constraints', (req, res) => {
  const project = findProject(req.params.id, req.user.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  const content = cleanText(req.body.content, 1000)
  if (!content) return res.status(400).json({ error: 'Constraint text is required.' })
  const constraint = { id: id(), project_id: project.id, content, created_at: now() }
  db.prepare('INSERT INTO constraints (id, project_id, content, created_at) VALUES (?, ?, ?, ?)')
    .run(constraint.id, constraint.project_id, constraint.content, constraint.created_at)
  res.status(201).json(constraint)
})

app.delete('/api/projects/:id/constraints/:constraintId', (req, res) => {
  if (!findProject(req.params.id, req.user.id)) return res.status(404).json({ error: 'Project not found.' })
  const result = db.prepare('DELETE FROM constraints WHERE id = ? AND project_id = ?')
    .run(req.params.constraintId, req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Constraint not found.' })
  res.status(204).end()
})

app.post('/api/projects/:id/verify', async (req, res) => {
  const project = findProject(req.params.id, req.user.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  const scan = JSON.parse(project.summary_json)
  const selected = scan.commands.find((command) => command.script === req.body.script)
  if (!selected || !/^[\w:-]+$/.test(selected.script)) {
    return res.status(400).json({ error: 'That command is not an available project check.' })
  }
  const started = Date.now()
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = await runProcess(npmCommand, ['run', selected.script], project.root_path, 120000)
  const duration = Date.now() - started
  const status = result.timedOut ? 'timeout' : result.code === 0 ? 'passed' : 'failed'
  const check = {
    id: id(),
    project_id: project.id,
    command: selected.command,
    status,
    output: result.output || (status === 'passed' ? 'Command completed successfully.' : 'Command produced no output.'),
    duration_ms: duration,
    created_at: now(),
  }
  db.prepare(`INSERT INTO verifications (id, project_id, command, status, output, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(check.id, check.project_id, check.command, check.status, check.output, check.duration_ms, check.created_at)
  res.json(check)
})

app.get('/api/projects/:id/export/:format', (req, res) => {
  const project = findProject(req.params.id, req.user.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  if (!['json', 'markdown'].includes(req.params.format)) return res.status(400).json({ error: 'Format must be json or markdown.' })
  const detail = getProjectDetail(project)
  const passport = createPassport(detail, detail.issues, detail.constraints, detail.verifications)
  const baseName = detail.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'
  if (req.params.format === 'json') {
    res.type('application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}-passport.json"`)
    return res.send(JSON.stringify(passport, null, 2))
  }
  res.type('text/markdown')
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}-passport.md"`)
  res.send(passportMarkdown(passport))
})

app.use(express.static(path.resolve(here, '../dist')))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.resolve(here, '../dist/index.html'), (error) => {
    if (error) next()
  })
})

app.use((error, _req, res, _next) => {
  console.error(error)
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'ZIP archives must be 50 MB or smaller.' : error.message })
  }
  res.status(500).json({ error: error.message || 'Unexpected server error.' })
})

const host = process.env.HOST || '127.0.0.1'
app.listen(port, host, () => console.log(`ProjectPassport API listening on http://${host}:${port}`))
