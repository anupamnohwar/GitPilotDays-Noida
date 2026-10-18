import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowRight, BadgeCheck, BookOpen, Home,
  Bug, Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, Code2, Command, FileArchive,
  FileCode2, FileJson2, FileText, FolderKanban, Github, Layers3, LoaderCircle, LogOut,
  Plus, RefreshCw, ShieldCheck, Sparkles, TerminalSquare, Trash2, Upload, X,
} from 'lucide-react'

type ProjectSummary = {
  id: string
  name: string
  source: string
  scanned_at: string
  last_opened_at: string
  language: string
  framework: string
  issue_count: number
}

type Attempt = { id: string; description: string; outcome: string; created_at: string }
type Issue = {
  id: string
  title: string
  details: string
  status: 'open' | 'resolved'
  created_at: string
  attempts: Attempt[]
}
type Check = {
  id: string
  command: string
  status: string
  output: string
  duration_ms: number
  created_at: string
}
type Project = ProjectSummary & {
  scan: {
    packageName: string
    packageVersion: string | null
    description: string
    packageManager: string
    dependencyCount: number
    dependencies: string[]
    configs: string[]
    files: string[]
    fileCount: number
    language: string
    framework: string
    commands: { name: string; command: string; script: string }[]
    toolCompatibility: {
      id: string
      name: string
      description: string
      nativeFiles: string[]
      configured: boolean
    }[]
    readme: string
  }
  issues: Issue[]
  constraints: { id: string; content: string; created_at: string }[]
  verifications: Check[]
}

type Section = 'Overview' | 'Issues & memory' | 'Constraints' | 'Activity' | 'Tool compatibility'
type AuthUser = { id: string; name: string; email: string; picture: string | null }
type AuthSession = { authenticated: boolean; user: AuthUser | null; googleConfigured: boolean }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Request failed.' }))
    throw new Error(body.error || `Request failed (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

const relativeDate = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}
const prettyDate = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function App() {
  const [auth, setAuth] = useState<AuthSession | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [section, setSection] = useState<Section>('Overview')
  const [showRecents, setShowRecents] = useState(false)
  const [showHome, setShowHome] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [dialog, setDialog] = useState<'import' | 'issue' | 'constraint' | null>(null)
  const [importMode, setImportMode] = useState<'zip' | 'git'>('zip')
  const [busy, setBusy] = useState(false)
  const [runningScript, setRunningScript] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('authError')
    if (authError) {
      const messages: Record<string, string> = {
        'google-not-configured': 'Google sign-in needs an OAuth client. Add the credentials to your local .env file and restart the server.',
        'login-expired': 'The sign-in attempt expired. Please try again.',
        'google-sign-in-failed': 'Google could not verify the sign-in. Please try again.',
      }
      setError(messages[authError] || messages['google-sign-in-failed'])
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    request<AuthSession>('/api/auth/session')
      .then(setAuth)
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setAuthLoading(false))
  }, [])

  const refreshProjects = useCallback(async (selectId?: string) => {
    const result = await request<ProjectSummary[]>('/api/projects')
    setProjects(result)
    const nextId = selectId || (showRecents || showHome || showProfile ? '' : selectedId || result[0]?.id || '')
    setSelectedId(nextId)
    if (nextId) {
      const detail = await request<Project>(`/api/projects/${nextId}`)
      setProject(detail)
      setProjects((current) => current
        .map((item) => item.id === detail.id ? { ...item, last_opened_at: detail.last_opened_at } : item)
        .sort((a, b) => new Date(b.last_opened_at).getTime() - new Date(a.last_opened_at).getTime()))
    } else {
      setProject(null)
    }
  }, [selectedId, showHome, showProfile, showRecents])

  useEffect(() => {
    if (!auth?.authenticated) return
    refreshProjects().catch((cause: Error) => setError(cause.message))
  }, [auth, refreshProjects])

  const selectProject = async (id: string) => {
    setShowRecents(false)
    setShowHome(false)
    setShowProfile(false)
    setSelectedId(id)
    setSection('Overview')
    setError('')
    try {
      const detail = await request<Project>(`/api/projects/${id}`)
      setProject(detail)
      setProjects((current) => current
        .map((item) => item.id === detail.id ? { ...item, last_opened_at: detail.last_opened_at } : item)
        .sort((a, b) => new Date(b.last_opened_at).getTime() - new Date(a.last_opened_at).getTime()))
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const goHome = () => {
    setShowHome(true)
    setShowProfile(false)
    setShowRecents(false)
    setProject(null)
    setSelectedId('')
    setError('')
  }

  const showProfilePage = () => {
    setShowProfile(true)
    setShowHome(false)
    setShowRecents(false)
    setProject(null)
    setError('')
  }

  const reload = async () => {
    if (!selectedId) return
    try {
      await refreshProjects(selectedId)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const submitImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    setBusy(true)
    setError('')
    try {
      const imported = importMode === 'zip'
        ? await request<Project>('/api/projects/import/zip', { method: 'POST', body: formData })
        : await request<Project>('/api/projects/import/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formData.get('name'), url: formData.get('url') }),
        })
      setShowRecents(false)
      setShowHome(false)
      setShowProfile(false)
      await refreshProjects(imported.id)
      setDialog(null)
      setNotice('Project scanned and passport created.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const addIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!project) return
    const data = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await request(`/api/projects/${project.id}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: data.get('title'), details: data.get('details') }),
      })
      await reload()
      setDialog(null)
      setNotice('Issue added to project memory.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const addConstraint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!project) return
    const data = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await request(`/api/projects/${project.id}/constraints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: data.get('content') }),
      })
      await reload()
      setDialog(null)
      setNotice('Constraint saved to the passport.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runCheck = async (script: string) => {
    if (!project) return
    setRunningScript(script)
    setError('')
    try {
      const result = await request<Check>(`/api/projects/${project.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      })
      await reload()
      setNotice(`${result.command}: ${result.status}${result.status === 'timeout' ? ' (2 minute limit)' : ''}`)
      if (result.status !== 'passed') setSection('Activity')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setRunningScript('')
    }
  }

  const rescan = async () => {
    if (!project) return
    setBusy(true)
    try {
      const updated = await request<Project>(`/api/projects/${project.id}/rescan`, { method: 'POST' })
      setProject(updated)
      await refreshProjects(project.id)
      setNotice('Project scan refreshed.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const addAttempt = async (issue: Issue) => {
    if (!project) return
    const description = window.prompt('What did you try?')
    if (!description?.trim()) return
    const outcome = window.prompt('Outcome: failed, worked, or inconclusive', 'failed')
    if (!outcome) return
    try {
      await request(`/api/projects/${project.id}/issues/${issue.id}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, outcome }),
      })
      await reload()
      setNotice('Repair attempt recorded.')
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const removeConstraint = async (constraintId: string) => {
    if (!project) return
    try {
      await request(`/api/projects/${project.id}/constraints/${constraintId}`, { method: 'DELETE' })
      await reload()
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const deleteProject = async () => {
    if (!project || !window.confirm(`Remove ${project.name} and its imported files?`)) return
    try {
      await request(`/api/projects/${project.id}`, { method: 'DELETE' })
      const remaining = await request<ProjectSummary[]>('/api/projects')
      setProjects(remaining)
      const nextProject = remaining[0]
      if (nextProject) await selectProject(nextProject.id)
      else {
        setProject(null)
        setSelectedId('')
      }
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const logout = async () => {
    setLoggingOut(true)
    try {
      await request('/api/auth/logout', { method: 'POST' })
      setAuth((current) => current ? { ...current, authenticated: false, user: null } : current)
      setProjects([])
      setProject(null)
      setSelectedId('')
      setShowRecents(false)
      setShowHome(false)
      setShowProfile(false)
      setSection('Overview')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoggingOut(false)
    }
  }

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const openIssues = project?.issues.filter((issue) => issue.status === 'open') ?? []
  const resolvedIssues = project?.issues.filter((issue) => issue.status === 'resolved') ?? []
  const activity = useMemo(() => {
    if (!project) return []
    return [
      ...project.verifications.map((item) => ({ id: item.id, type: 'verification', text: `${item.command} ${item.status}`, date: item.created_at, status: item.status })),
      ...project.issues.flatMap((issue) => [
        { id: issue.id, type: 'issue', text: `Issue recorded: ${issue.title}`, date: issue.created_at, status: issue.status },
        ...issue.attempts.map((attempt) => ({ id: attempt.id, type: 'attempt', text: `${attempt.description} — ${attempt.outcome}`, date: attempt.created_at, status: attempt.outcome })),
      ]),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [project])

  const navItems: { label: Section; icon: ReactNode; count?: number }[] = [
    { label: 'Overview', icon: <Layers3 size={16} /> },
    { label: 'Issues & memory', icon: <Bug size={16} />, count: openIssues.length },
    { label: 'Constraints', icon: <ShieldCheck size={16} />, count: project?.constraints.length },
    { label: 'Activity', icon: <Activity size={16} /> },
    { label: 'Tool compatibility', icon: <Code2 size={16} /> },
  ]

  if (authLoading) return <div className="auth-loading"><LoaderCircle size={20} className="spin" /><span>Opening your workspace…</span></div>
  if (!auth?.authenticated || !auth.user) return <LoginPage googleConfigured={auth?.googleConfigured ?? false} error={error} onClearError={() => setError('')} />

  const userInitials = auth.user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span /></div>
          <div><strong>project<span>passport</span></strong><small>PORTABLE PROJECT MEMORY</small></div>
        </div>
        <button className="workspace-switch"><div className="workspace-avatar">A</div><span><b>Acme workspace</b><small>Personal workspace</small></span><ChevronDown size={14} /></button>
        <button className={`recent-nav ${showHome ? 'active' : ''}`} aria-label="Home" title="Home" onClick={goHome}>
          <Home size={15} /><span>Home</span>
        </button>
        <button className={`recent-nav ${showRecents ? 'active' : ''}`} aria-label="Recent projects" title="Recent projects" onClick={() => { setShowRecents(true); setShowHome(false); setShowProfile(false); setProject(null); setError('') }}>
          <Clock3 size={15} /><span>Recent projects</span><b>{projects.length}</b>
        </button>
        <div className="side-label">YOUR PROJECTS <button title="Add a project" onClick={() => { setDialog('import'); setError('') }}><Plus size={15} /></button></div>
        <div className="project-list">
          {projects.map((item) => (
            <button key={item.id} className={`project-nav ${selectedId === item.id ? 'active' : ''}`} onClick={() => selectProject(item.id)}>
              <span className="project-mini-icon"><Code2 size={15} /></span>
              <span className="project-nav-copy"><b>{item.name}</b><small>{item.framework}</small></span>
              {item.issue_count > 0 && <span className="issue-count">{item.issue_count}</span>}
            </button>
          ))}
          {!projects.length && <p className="sidebar-empty">Your imported projects will show up here.</p>}
        </div>
        <button className="add-project-link" onClick={() => { setDialog('import'); setError('') }}><Plus size={15} /> Import a project</button>
        <div className="sidebar-bottom">
          <div className="sidebar-promo"><div className="promo-icon"><Sparkles size={16} /></div><b>Context that travels.</b><p>One reliable handoff, wherever you code.</p><span>HOW IT WORKS <ArrowRight size={12} /></span></div>
          <button className="help-link"><CircleHelp size={16} /> Help & documentation <ArrowRight size={13} /></button>
          <div className="profile"><button className="profile-open" onClick={showProfilePage} aria-label="Open profile"><Avatar user={auth.user} initials={userInitials} /><span className="profile-info"><b>{auth.user.name}</b><small>{auth.user.email}</small></span></button><button title="Sign out" aria-label="Sign out" onClick={logout} disabled={loggingOut}>{loggingOut ? <LoaderCircle size={15} className="spin" /> : <LogOut size={15} />}</button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{showProfile ? 'Profile' : showHome ? 'Home' : showRecents ? 'Recent projects' : project?.name || 'Projects'}</b></div>
          <button className="home-top-button" aria-label="Home" title="Home" onClick={goHome}><Home size={14} /> Home</button>
          <button className="recent-top-button" aria-label="Recent projects" title="Recent projects" onClick={() => { setShowRecents(true); setShowHome(false); setShowProfile(false); setProject(null); setError('') }}><Clock3 size={15} /> Recent</button>
          <div className="topbar-right"><span className="saved-label"><span className="saved-dot" /> All changes saved</span><button className="icon-button" title="Help"><CircleHelp size={17} /></button><button className={`profile-trigger ${showProfile ? 'active' : ''}`} title="Profile" aria-label="Open profile" onClick={showProfilePage}><Avatar user={auth.user} initials={userInitials} topbar /></button></div>
        </header>
        {error && <div className="alert-banner"><AlertCircle size={16} /><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}
        {notice && <div className="notice-toast"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}

        {showProfile ? (
          <ProfilePanel user={auth.user} initials={userInitials} loggingOut={loggingOut} onSignOut={logout} />
        ) : showHome ? (
          <HomeDashboard projects={projects} onOpen={selectProject} onImport={() => { setDialog('import'); setError('') }} userName={auth.user.name} />
        ) : showRecents ? (
          <RecentProjects projects={projects} onOpen={selectProject} onImport={() => { setDialog('import'); setError('') }} />
        ) : project ? (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" /> PROJECT PASSPORT <span className="heading-separator">/</span> {project.scan.framework.toUpperCase()}</div>
                <h1>{project.name}<span className="project-state"><Check size={12} /> Scanned</span></h1>
                <p className="heading-subtitle">{project.scan.description || 'Your project context, ready to travel with you.'}</p>
              </div>
              <div className="heading-actions">
                <button className="button button-light" onClick={rescan} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} /> Rescan</button>
                <button className="icon-button remove-project-button" onClick={deleteProject} title="Remove project"><Trash2 size={15} /></button>
                <div className="export-wrap">
                  <a className="button button-primary" href={`/api/projects/${project.id}/export/markdown`}><ArrowDownToLine size={15} /> Export passport <ChevronDown size={14} /></a>
                  <div className="export-menu"><a href={`/api/projects/${project.id}/export/markdown`}><FileText size={15} /> Markdown handoff <small>.md</small></a><a href={`/api/projects/${project.id}/export/json`}><FileJson2 size={15} /> Structured data <small>.json</small></a></div>
                </div>
              </div>
            </div>

            <div className="section-tabs">
              {navItems.map((item) => <button key={item.label} className={section === item.label ? 'selected' : ''} onClick={() => setSection(item.label)}>{item.icon}{item.label}{item.count !== undefined && item.count > 0 && <span className="tab-count">{item.count}</span>}</button>)}
            </div>

            {section === 'Overview' && <Overview project={project} openIssues={openIssues} resolvedIssues={resolvedIssues} runningScript={runningScript} onRunCheck={runCheck} onOpenIssue={() => setDialog('issue')} onOpenConstraint={() => setDialog('constraint')} onAddAttempt={addAttempt} onSection={setSection} />}
            {section === 'Issues & memory' && <IssuesPanel project={project} onAdd={() => setDialog('issue')} onAttempt={addAttempt} onReload={reload} />}
            {section === 'Constraints' && <ConstraintsPanel project={project} onAdd={() => setDialog('constraint')} onRemove={removeConstraint} />}
            {section === 'Activity' && <ActivityPanel items={activity} />}
            {section === 'Tool compatibility' && <ToolCompatibilityPanel project={project} />}

            <footer className="page-footer"><span><span className="footer-lock"><ShieldCheck size={13} /></span> Your passport is stored locally on this machine.</span><span>Last scanned {relativeDate(project.scanned_at)} <button onClick={rescan}>Scan again</button></span></footer>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-illustration"><div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" /><div className="empty-card"><div className="empty-logo"><BookOpen size={23} /></div><span /><span className="short-line" /><span /></div><Sparkles className="empty-spark" size={20} /></div>
            <span className="eyebrow"><span className="eyebrow-dot" /> YOUR ENGINEERING MEMORY</span>
            <h1>Good context makes<br />better code.</h1>
            <p>Bring your project in. We’ll map its structure, capture the decisions that matter, and create a handoff any coding assistant can pick up.</p>
            <button className="button button-primary empty-cta" onClick={() => { setDialog('import'); setError('') }}><Plus size={16} /> Import your first project</button>
            <div className="empty-footnotes"><span><CheckCircle2 size={14} /> Nothing runs without your say-so</span><span><ShieldCheck size={14} /> Stored on this machine</span></div>
          </div>
        )}
      </main>

      {dialog && <Modal title={dialog === 'import' ? 'Bring a project into Passport' : dialog === 'issue' ? 'Add to debugging memory' : 'Record a project constraint'} onClose={() => !busy && setDialog(null)}>
        {dialog === 'import' && <form onSubmit={submitImport} className="dialog-form">
          <p className="dialog-intro">We’ll scan the project structure and build your portable engineering context.</p>
          <div className="segmented"><button type="button" className={importMode === 'zip' ? 'active' : ''} onClick={() => { setImportMode('zip'); setError('') }}><FileArchive size={15} /> Upload ZIP</button><button type="button" className={importMode === 'git' ? 'active' : ''} onClick={() => { setImportMode('git'); setError('') }}><Github size={15} /> Git repository</button></div>
          {importMode === 'zip' ? <label className="upload-zone"><Upload size={20} /><b>Choose a project ZIP</b><span>Up to 50 MB · package.json recommended</span><input type="file" name="archive" accept=".zip,application/zip" required /></label> : <label className="field-label">Public repository URL<input name="url" type="url" placeholder="https://github.com/you/project" required /></label>}
          <label className="field-label">Project name <span className="optional">(optional)</span><input name="name" placeholder="Detected automatically if blank" /></label>
          {error && <p className="form-error"><AlertCircle size={14} />{error}</p>}
          <div className="dialog-note"><ShieldCheck size={15} /><span>Project files stay on this machine. We never send source code to an AI service.</span></div>
          <div className="dialog-actions"><button type="button" className="button button-light" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{busy ? 'Scanning…' : 'Scan project'}</button></div>
        </form>}
        {dialog === 'issue' && <form onSubmit={addIssue} className="dialog-form">
          <p className="dialog-intro">Capture a bug and its context so you—and your next coding assistant—don’t have to rediscover it.</p>
          <label className="field-label">Issue title<input name="title" placeholder="e.g. Sign-in redirect fails on refresh" required maxLength={200} /></label>
          <label className="field-label">Error, symptoms, or context<textarea name="details" placeholder="What happens, where it occurs, and any useful error output…" rows={4} /></label>
          <div className="dialog-actions"><button type="button" className="button button-light" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}><Plus size={15} /> Save issue</button></div>
        </form>}
        {dialog === 'constraint' && <form onSubmit={addConstraint} className="dialog-form">
          <p className="dialog-intro">Record a requirement or decision that future changes must preserve.</p>
          <label className="field-label">Constraint or architectural decision<textarea name="content" placeholder="e.g. Keep the public API backward compatible; do not change the /v1 routes." rows={4} required maxLength={1000} /></label>
          <div className="dialog-note"><ShieldCheck size={15} /><span>Constraints are included in both Markdown and JSON handoffs.</span></div>
          <div className="dialog-actions"><button type="button" className="button button-light" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}><Plus size={15} /> Save constraint</button></div>
        </form>}
      </Modal>}
    </div>
  )
}

function HomeDashboard({ projects, onOpen, onImport, userName }: {
  projects: ProjectSummary[]
  onOpen: (id: string) => void
  onImport: () => void
  userName: string
}) {
  const firstName = userName.trim().split(/\s+/)[0] || 'there'
  return <div className="content-area inner-page home-page">
    <section className="home-welcome panel">
      <div><span className="eyebrow"><span className="eyebrow-dot" /> YOUR WORKSPACE</span><h1>Welcome back, {firstName}.</h1><p>Your projects and their engineering context are ready when you are.</p></div>
      <button className="button button-primary" onClick={onImport}><Plus size={15} /> Import a project</button>
    </section>
    <div className="home-section-heading"><div><h2>Your projects</h2><p>{projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'} in your local library` : 'Start by importing a project to create its passport.'}</p></div></div>
    {projects.length ? <div className="home-project-list">{projects.slice(0, 4).map((project) => <button className="panel home-project-row" key={project.id} onClick={() => onOpen(project.id)}>
      <span className="recent-project-mark"><Code2 size={18} /></span><span className="home-project-copy"><b>{project.name}</b><small>{project.framework} · {project.language}</small></span><span className="home-project-issues">{project.issue_count} open {project.issue_count === 1 ? 'issue' : 'issues'}</span><ArrowRight size={15} />
    </button>)}</div> : <div className="panel blank-panel"><span className="blank-icon"><FolderKanban size={19} /></span><h3>No projects yet</h3><p>Import a ZIP or public Git repository to scan its structure and start building a portable passport.</p><button className="button button-primary" onClick={onImport}><Plus size={15} /> Import your first project</button></div>}
  </div>
}

function ProfilePanel({ user, initials, loggingOut, onSignOut }: {
  user: AuthUser
  initials: string
  loggingOut: boolean
  onSignOut: () => void
}) {
  return <div className="content-area inner-page profile-page">
    <div className="subpage-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> ACCOUNT</span><h2>Your profile</h2><p>Manage the account currently connected to this ProjectPassport workspace.</p></div></div>
    <section className="panel profile-card">
      <div className="profile-card-heading"><Avatar user={user} initials={initials} /><div><h3>{user.name}</h3><p>Google account</p></div></div>
      <div className="profile-detail"><span>Email address</span><b>{user.email}</b></div>
      <div className="profile-security"><ShieldCheck size={17} /><div><b>Secure sign-in</b><p>Your Google account verifies your identity. Project files and passport data remain stored locally on this machine.</p></div></div>
      <button className="button button-light profile-signout" onClick={onSignOut} disabled={loggingOut}>{loggingOut ? <LoaderCircle size={15} className="spin" /> : <LogOut size={15} />}{loggingOut ? 'Signing out…' : 'Sign out'}</button>
    </section>
  </div>
}

function LoginPage({ googleConfigured, error, onClearError }: {
  googleConfigured: boolean
  error: string
  onClearError: () => void
}) {
  return <main className="login-shell">
    <div className="login-brand-lockup">
      <div className="brand-mark"><span /></div>
      <div><strong>project<span>passport</span></strong><small>PORTABLE PROJECT MEMORY</small></div>
    </div>
    <div className="login-layout">
      <section className="login-card">
        <span className="login-eyebrow"><span className="eyebrow-dot" /> YOUR ENGINEERING MEMORY</span>
        <h1>Good context.<br /><span>Better handoffs.</span></h1>
        <p className="login-description">Sign in to open your workspace, pick up recent projects, and take your engineering context wherever you code.</p>
        {error && <div className="login-error"><AlertCircle size={15} /><span>{error}</span><button aria-label="Dismiss" onClick={onClearError}><X size={14} /></button></div>}
        <button className="google-login-button" disabled={!googleConfigured} onClick={() => window.location.assign('/api/auth/google')}>
          <span className="google-letter">G</span>{googleConfigured ? 'Continue with Google' : 'Google sign-in needs setup'}
          {googleConfigured && <ArrowRight size={15} />}
        </button>
        {!googleConfigured && <div className="oauth-setup"><b>One-time setup</b><p>Add your Google OAuth client ID and secret to the local <code>.env</code> file, then restart the server.</p><span>See <code>.env.example</code> and the README for setup instructions.</span></div>}
        <div className="login-privacy"><ShieldCheck size={14} /> Google verifies your account; project data stays on this machine.</div>
        <p className="login-terms">Your first Google sign-in creates an account automatically. Sessions last seven days unless you sign out.</p>
      </section>
      <aside className="login-story">
        <div className="login-illustration"><div className="login-orbit login-orbit-one" /><div className="login-orbit login-orbit-two" /><div className="passport-card-art"><div className="passport-art-mark"><BookOpen size={21} /></div><span className="passport-art-line" /><span className="passport-art-line short" /><div className="passport-art-chip"><Check size={11} /> context saved</div></div><div className="login-floating-icon"><Code2 size={15} /></div><Sparkles className="login-spark" size={19} /></div>
        <span className="login-story-kicker">PICK UP WHEREVER YOU LEFT OFF</span>
        <h2>Your projects,<br />with their context intact.</h2>
        <p>Project maps, debugging history, constraints, and verified checks—ready to hand off to the next IDE or AI tool.</p>
        <div className="login-story-points"><span><CheckCircle2 size={14} /> Recent projects saved locally</span><span><CheckCircle2 size={14} /> One passport for every coding tool</span><span><CheckCircle2 size={14} /> Verification you can point to</span></div>
      </aside>
    </div>
    <footer className="login-footer"><span><ShieldCheck size={13} /> Local-first project storage</span><span>PROJECTPASSPORT <span>·</span> SECURE GOOGLE SIGN-IN</span></footer>
  </main>
}

function Avatar({ user, initials, topbar = false }: { user: AuthUser; initials: string; topbar?: boolean }) {
  return <span className={`user-avatar ${topbar ? 'topbar-avatar' : 'profile-avatar'}`}>
    {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initials}
  </span>
}

function RecentProjects({ projects, onOpen, onImport }: {
  projects: ProjectSummary[]
  onOpen: (id: string) => void
  onImport: () => void
}) {
  return <div className="content-area inner-page recent-projects-page">
    <div className="subpage-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> PROJECT LIBRARY</span><h2>Recent projects</h2><p>Your locally saved projects, ordered by the last time you opened them.</p></div><button className="button button-primary" onClick={onImport}><Plus size={15} /> Import a project</button></div>
    {projects.length ? <div className="recent-project-grid">{projects.map((project, index) => <article className="panel recent-project-card" key={project.id}>
      <div className="recent-card-top"><span className="recent-project-mark"><Code2 size={18} /></span><span className={`recent-position ${index === 0 ? 'most-recent' : ''}`}>{index === 0 ? 'MOST RECENT' : `RECENT ${String(index + 1).padStart(2, '0')}`}</span></div>
      <h3>{project.name}</h3><p className="recent-framework">{project.framework} · {project.language}</p>
      <div className="recent-card-meta"><span><Clock3 size={13} /> Opened {relativeDate(project.last_opened_at)}</span><span>{project.issue_count} open {project.issue_count === 1 ? 'issue' : 'issues'}</span></div>
      <div className="recent-card-footer"><span className="recent-source">{project.source}</span><button className="button button-light button-small" onClick={() => onOpen(project.id)}>Open project <ArrowRight size={13} /></button></div>
    </article>)}</div> : <div className="panel blank-panel"><span className="blank-icon"><Clock3 size={19} /></span><h3>No recent projects yet.</h3><p>Import a ZIP or a public Git repository. ProjectPassport will keep it here so you can reopen its project map, debugging memory, and handoff.</p><button className="button button-primary" onClick={onImport}><Plus size={14} /> Import a project</button></div>}
  </div>
}

function ToolCompatibilityPanel({ project }: { project: Project }) {
  const tools = project.scan.toolCompatibility ?? []
  return <div className="content-area inner-page compatibility-page">
    <div className="subpage-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> PORTABLE CONTEXT</span><h2>IDE & AI tool compatibility</h2><p>See which repository-native instruction files this scan detected.</p></div></div>
    <div className="compatibility-explainer panel"><span className="compatibility-explainer-icon"><Sparkles size={18} /></span><div><b>One passport, two ways to hand off context.</b><p>Coding tools read project files and their own instruction conventions. ProjectPassport detects those conventions and exports a provider-neutral Markdown or JSON handoff for everything else.</p></div></div>
    <div className="compatibility-grid">{tools.map((tool) => <article className="panel compatibility-card" key={tool.id}>
      <div className="compatibility-card-heading"><span className="compatibility-tool-icon"><Code2 size={16} /></span><div><h3>{tool.name}</h3><p>{tool.description}</p></div></div>
      <div className={`compatibility-status ${tool.configured ? 'configured' : 'portable'}`}><span />{tool.configured ? 'Native instruction file found' : 'Portable passport supported'}</div>
      {tool.configured ? <div className="native-files"><b>Detected in project</b>{tool.nativeFiles.map((file) => <code key={file}><FileText size={12} />{file}</code>)}</div> : <p className="compatibility-no-config">No recognized native instruction file detected. This is not a compatibility failure; provide the exported passport as context.</p>}
    </article>)}</div>
    <div className="compatibility-footnote"><ShieldCheck size={15} /><span><b>What this assessment means:</b> “Native instruction file found” means a recognized convention was present during the last scan. Otherwise, use the Markdown or JSON passport with your AI tool. This is file-format detection—not a live check of IDE versions, plugins, or model capabilities.</span></div>
  </div>
}

function Overview({ project, openIssues, resolvedIssues, runningScript, onRunCheck, onOpenIssue, onOpenConstraint, onAddAttempt, onSection }: {
  project: Project
  openIssues: Issue[]
  resolvedIssues: Issue[]
  runningScript: string
  onRunCheck: (script: string) => void
  onOpenIssue: () => void
  onOpenConstraint: () => void
  onAddAttempt: (issue: Issue) => void
  onSection: (section: Section) => void
}) {
  const latestCheck = project.verifications[0]
  return <div className="content-area">
    <div className="stats-grid">
      <StatCard icon={<FileCode2 size={17} />} label="PROJECT FILES" value={project.scan.fileCount.toLocaleString()} detail="files mapped" tone="blue" />
      <StatCard icon={<Layers3 size={17} />} label="DEPENDENCIES" value={project.scan.dependencyCount.toString()} detail="packages detected" tone="violet" />
      <StatCard icon={<Bug size={17} />} label="OPEN ISSUES" value={openIssues.length.toString()} detail={resolvedIssues.length ? `${resolvedIssues.length} resolved` : 'in project memory'} tone="orange" />
      <StatCard icon={<BadgeCheck size={17} />} label="LATEST CHECK" value={latestCheck ? latestCheck.status : 'Not run'} detail={latestCheck ? latestCheck.command : 'Verification pending'} tone={latestCheck?.status === 'passed' ? 'green' : 'slate'} />
    </div>

    <div className="overview-grid">
      <section className="panel project-map-panel">
        <div className="panel-heading"><div><span className="panel-icon icon-blue"><FolderKanban size={16} /></span><div><h2>Project map</h2><p>The essentials, at a glance</p></div></div><button className="text-button" onClick={() => onSection('Constraints')}>View passport <ArrowRight size={14} /></button></div>
        <div className="map-identity"><div className="map-project-mark"><Code2 size={21} /></div><div><b>{project.scan.packageName}{project.scan.packageVersion ? <span className="version"> v{project.scan.packageVersion}</span> : null}</b><small>{project.source}</small></div><span className="detected-pill"><span /> Detected</span></div>
        <div className="map-details">
          <Detail label="LANGUAGE" value={project.scan.language} icon={<FileCode2 size={15} />} />
          <Detail label="FRAMEWORK" value={project.scan.framework} icon={<Layers3 size={15} />} />
          <Detail label="PACKAGE MANAGER" value={project.scan.packageManager} icon={<Command size={15} />} />
          <Detail label="CONFIGURATION" value={`${project.scan.configs.length} files`} icon={<TerminalSquare size={15} />} />
        </div>
        <div className="map-files-heading"><b>Project structure</b><span>{project.scan.files.length} paths</span></div>
        <div className="file-chips">{project.scan.files.slice(0, 9).map((file) => <span key={file}><FileText size={12} />{file}</span>)}{project.scan.fileCount > 9 && <span className="more-files">+{project.scan.fileCount - 9} more</span>}</div>
        <div className="map-footer"><span><Clock3 size={13} /> Scanned {prettyDate(project.scanned_at)}</span><button onClick={() => onSection('Activity')}>See scan history <ArrowRight size={13} /></button></div>
      </section>

      <section className="panel verification-panel">
        <div className="panel-heading"><div><span className="panel-icon icon-green"><ShieldCheck size={16} /></span><div><h2>Verification</h2><p>Evidence, not assumptions</p></div></div><span className="local-badge"><span /> LOCAL</span></div>
        <div className="verification-callout"><div className="callout-check"><CheckCircle2 size={17} /></div><div><b>Run a check when you’re ready</b><p>Choose a detected project command. Nothing runs automatically.</p></div></div>
        <div className="command-list">
          {project.scan.commands.length ? project.scan.commands.map((item) => {
            const latest = project.verifications.find((check) => check.command === item.command)
            return <div className="command-row" key={item.script}><div className="command-status"><span className={latest ? `status-dot ${latest.status}` : 'status-dot'} /></div><div className="command-copy"><b>{item.name}</b><code>{item.command}</code></div>{latest && <span className={`run-result ${latest.status}`}>{latest.status}</span>}<button className="run-button" onClick={() => onRunCheck(item.script)} disabled={Boolean(runningScript)}>{runningScript === item.script ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />}</button></div>
          }) : <div className="no-commands"><TerminalSquare size={17} /><span>No build or test scripts detected in package.json.</span></div>}
        </div>
        <div className="verification-warning"><AlertCircle size={13} /> Project scripts execute locally with a 2-minute timeout. Only run checks for projects you trust.</div>
        {latestCheck && <button className="verification-history-link" onClick={() => onSection('Activity')}>Latest: <b>{latestCheck.command}</b> · {relativeDate(latestCheck.created_at)} <ArrowRight size={12} /></button>}
      </section>

      <section className="panel memory-panel">
        <div className="panel-heading"><div><span className="panel-icon icon-orange"><Bug size={16} /></span><div><h2>Debugging memory</h2><p>Keep the hard-won context</p></div></div><button className="text-button" onClick={() => onSection('Issues & memory')}>All issues <ArrowRight size={14} /></button></div>
        {openIssues.length ? <div className="issue-preview-list">{openIssues.slice(0, 3).map((issue) => <div className="issue-preview" key={issue.id}><span className="issue-bullet" /><div><b>{issue.title}</b><small>{issue.attempts.length ? `${issue.attempts.length} repair ${issue.attempts.length === 1 ? 'attempt' : 'attempts'} · ` : ''}Added {relativeDate(issue.created_at)}</small></div><button title="Record a repair attempt" onClick={() => onAddAttempt(issue)}><Plus size={15} /></button></div>)}</div> : <div className="memory-empty"><div className="memory-empty-icon"><CheckCircle2 size={18} /></div><div><b>No unresolved issues</b><p>When a bug appears, save it here instead of in a forgotten tab.</p></div></div>}
        <button className="panel-bottom-link" onClick={onOpenIssue}><Plus size={14} /> Add an issue to memory</button>
      </section>

      <section className="panel constraints-card">
        <div className="panel-heading"><div><span className="panel-icon icon-violet"><ShieldCheck size={16} /></span><div><h2>Project constraints</h2><p>Decisions future-you shouldn't undo</p></div></div><button className="icon-button small" onClick={onOpenConstraint} title="Add constraint"><Plus size={16} /></button></div>
        {project.constraints.length ? <div className="constraint-preview">{project.constraints.slice(0, 3).map((item) => <div key={item.id}><span className="constraint-line" /><p>{item.content}</p></div>)}</div> : <div className="constraint-empty">No constraints yet. Capture a convention or architectural decision.</div>}
        <button className="panel-bottom-link" onClick={() => onSection('Constraints')}>Manage constraints <ArrowRight size={13} /></button>
      </section>
    </div>

    <section className="handoff-banner">
      <div className="handoff-mark"><ArrowDownToLine size={19} /></div><div><span>THE PORTABLE HANDOFF</span><b>Take the context with you.</b><p>Share one file with any coding assistant to pick up right where you left off.</p></div>
      <div className="handoff-buttons"><a href={`/api/projects/${project.id}/export/markdown`} className="handoff-md"><FileText size={15} /> Markdown <ArrowRight size={13} /></a><a href={`/api/projects/${project.id}/export/json`} className="handoff-json"><FileJson2 size={15} /> JSON <ArrowRight size={13} /></a></div>
    </section>
  </div>
}

function StatCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><b className="stat-value">{value}</b><small>{detail}</small><span className={`stat-accent ${tone}`} /></div>
}
function Detail({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="map-detail"><span>{icon}</span><div><small>{label}</small><b>{value}</b></div></div>
}

function IssuesPanel({ project, onAdd, onAttempt, onReload }: { project: Project; onAdd: () => void; onAttempt: (issue: Issue) => void; onReload: () => void }) {
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [expanded, setExpanded] = useState('')
  const [statusBusy, setStatusBusy] = useState('')
  const issues = project.issues.filter((issue) => filter === 'all' || issue.status === filter)
  const toggle = async (issue: Issue) => {
    setStatusBusy(issue.id)
    try {
      await request(`/api/projects/${project.id}/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: issue.status === 'open' ? 'resolved' : 'open' }),
      })
      await onReload()
    } catch (cause) {
      window.alert((cause as Error).message)
    } finally {
      setStatusBusy('')
    }
  }
  return <div className="content-area inner-page">
    <div className="subpage-heading"><div><h2>Debugging memory</h2><p>Record the bug, the attempted fixes, and what actually worked.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={15} /> Record an issue</button></div>
    <div className="filter-bar"><div>{(['all', 'open', 'resolved'] as const).map((item) => <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item === 'all' ? `All issues · ${project.issues.length}` : `${item === 'open' ? 'Open' : 'Resolved'} · ${project.issues.filter((issue) => issue.status === item).length}`}</button>)}</div><span><ShieldCheck size={14} /> Part of this project’s portable context</span></div>
    {issues.length ? <div className="issue-cards">{issues.map((issue) => <article className="panel issue-card" key={issue.id}><div className="issue-card-top"><span className={`issue-state ${issue.status}`}><span />{issue.status}</span><span className="issue-date">{relativeDate(issue.created_at)}</span></div><h3>{issue.title}</h3><p className="issue-details">{issue.details || 'No additional context recorded.'}</p><button className="expand-history" onClick={() => setExpanded(expanded === issue.id ? '' : issue.id)}><Clock3 size={14} /> {issue.attempts.length} repair {issue.attempts.length === 1 ? 'attempt' : 'attempts'} <ChevronDown className={expanded === issue.id ? 'rotated' : ''} size={14} /></button>
      {expanded === issue.id && <div className="attempt-list">{issue.attempts.length ? issue.attempts.map((attempt) => <div className="attempt-row" key={attempt.id}><span className={`attempt-outcome ${attempt.outcome}`}>{attempt.outcome === 'worked' ? <Check size={13} /> : <X size={13} />}</span><div><b>{attempt.description}</b><small>{attempt.outcome} · {prettyDate(attempt.created_at)}</small></div></div>) : <p className="no-attempts">No repair attempts recorded yet. Keep failed approaches here so they aren’t repeated.</p>}</div>}
      <div className="issue-card-footer"><button className="button button-light button-small" onClick={() => onAttempt(issue)}><Plus size={13} /> Log a repair attempt</button><button className={`resolve-button ${issue.status}`} onClick={() => toggle(issue)} disabled={statusBusy === issue.id}>{statusBusy === issue.id ? <LoaderCircle size={14} className="spin" /> : issue.status === 'open' ? <CheckCircle2 size={14} /> : <RefreshCw size={13} />}{issue.status === 'open' ? 'Mark resolved' : 'Reopen issue'}</button></div>
    </article>)}</div> : <div className="panel blank-panel"><span className="blank-icon"><Bug size={19} /></span><h3>{filter === 'all' ? 'A clean debugging slate.' : `No ${filter} issues.`}</h3><p>Save the details of a bug—and what you’ve already tried—so the next coding session starts ahead.</p>{filter !== 'resolved' && <button className="button button-primary" onClick={onAdd}><Plus size={14} /> Record the first issue</button>}</div>}
  </div>
}

function ConstraintsPanel({ project, onAdd, onRemove }: { project: Project; onAdd: () => void; onRemove: (id: string) => void }) {
  return <div className="content-area inner-page">
    <div className="subpage-heading"><div><h2>Constraints & decisions</h2><p>Rules, conventions, and architecture decisions your coding assistant needs to keep intact.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={15} /> Add a constraint</button></div>
    <div className="constraint-intro panel"><span className="constraint-intro-icon"><ShieldCheck size={18} /></span><div><b>Make the invisible rules visible.</b><p>These notes travel in your exported passport, right alongside architecture and verification history.</p></div><span className="intro-count">{project.constraints.length} SAVED</span></div>
    {project.constraints.length ? <div className="saved-constraints">{project.constraints.map((item, index) => <article className="panel saved-constraint" key={item.id}><span className="constraint-number">{String(index + 1).padStart(2, '0')}</span><div><p>{item.content}</p><small>Added {prettyDate(item.created_at)}</small></div><button className="icon-button small danger-icon" title="Remove constraint" onClick={() => onRemove(item.id)}><Trash2 size={15} /></button></article>)}</div> : <div className="panel blank-panel"><span className="blank-icon"><ShieldCheck size={19} /></span><h3>What should never change?</h3><p>Capture backward-compatibility requirements, coding conventions, or architectural decisions.</p><button className="button button-primary" onClick={onAdd}><Plus size={14} /> Add your first constraint</button></div>}
  </div>
}

function ActivityPanel({ items }: { items: { id: string; type: string; text: string; date: string; status: string }[] }) {
  return <div className="content-area inner-page">
    <div className="subpage-heading"><div><h2>Project activity</h2><p>A traceable record of fixes tried and checks run.</p></div></div>
    {items.length ? <div className="panel activity-panel"><div className="activity-timeline">{items.map((item) => <div className="timeline-row" key={item.id}><div className={`timeline-icon ${item.type} ${item.status}`}><TimelineIcon type={item.type} /></div><div className="timeline-content"><b>{item.text}</b><small>{item.type === 'verification' ? 'Verification' : item.type === 'attempt' ? 'Repair attempt' : 'Debugging memory'}</small></div><span className="timeline-date">{prettyDate(item.date)}</span></div>)}</div></div> : <div className="panel blank-panel"><span className="blank-icon"><Activity size={19} /></span><h3>Your project history starts here.</h3><p>Run a build or test, record a repair attempt, or add an issue to build a verifiable timeline.</p></div>}
    <div className="activity-note"><ShieldCheck size={15} /> Each check captures its command, result, output, duration, and timestamp.</div>
  </div>
}
function TimelineIcon({ type }: { type: string }) {
  if (type === 'verification') return <TerminalSquare size={15} />
  if (type === 'attempt') return <RefreshCw size={15} />
  return <Bug size={15} />
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal-card"><div className="modal-heading"><div><span className="modal-kicker">PROJECTPASSPORT</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} title="Close"><X size={17} /></button></div>{children}</div></div>
}

export default App
