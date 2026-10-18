import fs from 'node:fs'
import path from 'node:path'

const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.venv'])
const knownConfigs = [
  'vite.config.js', 'vite.config.ts', 'webpack.config.js', 'next.config.js', 'next.config.ts',
  'tsconfig.json', 'eslint.config.js', '.eslintrc', '.prettierrc', 'jest.config.js',
  'vitest.config.ts', 'playwright.config.ts', 'tailwind.config.js', 'tailwind.config.ts',
  'postcss.config.js', 'babel.config.js',
]
const assistantTools = [
  {
    id: 'copilot',
    name: 'VS Code + GitHub Copilot',
    description: 'Repository-wide instructions and path-specific Copilot instructions.',
    directFiles: ['AGENTS.md', '.github/copilot-instructions.md'],
    directory: '.github/instructions',
    match: (file) => file.endsWith('.instructions.md'),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'Project rules, including current .mdc rules and the legacy rules file.',
    directFiles: ['.cursorrules'],
    directory: '.cursor/rules',
    match: (file) => file.endsWith('.mdc'),
  },
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Project instructions and directory-scoped Claude rules.',
    directFiles: ['CLAUDE.md', '.claude/CLAUDE.md'],
    directory: '.claude/rules',
    match: (file) => file.endsWith('.md'),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'Repository context instructions in GEMINI.md.',
    directFiles: ['GEMINI.md'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'Workspace rules, including legacy and directory-based rules.',
    directFiles: ['.windsurfrules'],
    directory: '.windsurf/rules',
    match: (file) => file.endsWith('.md'),
  },
  {
    id: 'cline',
    name: 'Cline',
    description: 'Project rules from a .clinerules file or rules directory.',
    directFiles: ['.clinerules'],
    directory: '.clinerules',
    match: (file) => file.endsWith('.md'),
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    description: 'Repository-level AGENTS.md instructions.',
    directFiles: ['AGENTS.md'],
  },
  {
    id: 'jetbrains',
    name: 'JetBrains AI Assistant',
    description: 'Project rules from the .aiassistant/rules directory.',
    directory: '.aiassistant/rules',
    match: (file) => file.endsWith('.md'),
  },
]

function walk(dir, base = dir, found = []) {
  if (found.length >= 250) return found
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.eslintrc') continue
    if (ignored.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, found)
    else found.push(path.relative(base, full).replaceAll(path.sep, '/'))
    if (found.length >= 250) break
  }
  return found
}

function listRuleFiles(rootPath, relativeDir) {
  const directory = path.join(rootPath, relativeDir)
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name).replaceAll(path.sep, '/')
    if (entry.isFile()) files.push(relativePath)
    else if (entry.isDirectory() && files.length < 100) files.push(...listRuleFiles(rootPath, relativePath))
    if (files.length >= 100) break
  }
  return files
}

export function scanProject(rootPath) {
  const packagePath = path.join(rootPath, 'package.json')
  let pkg = {}
  if (fs.existsSync(packagePath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    } catch (error) {
      throw new Error(`Could not parse package.json: ${error.message}`)
    }
  }
  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const dependencyNames = Object.keys(dependencies).sort()
  const files = walk(rootPath)
  const configs = knownConfigs.filter((name) => fs.existsSync(path.join(rootPath, name)))
  const scripts = pkg.scripts || {}
  const readmePath = ['README.md', 'readme.md', 'Readme.md'].find((name) => fs.existsSync(path.join(rootPath, name)))
  const readme = readmePath
    ? fs.readFileSync(path.join(rootPath, readmePath), 'utf8').slice(0, 10000)
    : ''
  const toolCompatibility = assistantTools.map((tool) => {
    const rules = [
      ...(tool.directFiles || []).filter((file) => fs.existsSync(path.join(rootPath, file))),
      ...(tool.directory ? listRuleFiles(rootPath, tool.directory).filter((file) => tool.match(file)) : []),
    ]
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      nativeFiles: [...new Set(rules)].sort(),
      configured: rules.length > 0,
    }
  })
  const hasReact = Boolean(dependencies.react || dependencies['react-dom'])
  const framework = dependencies.next
    ? 'Next.js'
    : dependencies.vite && hasReact
      ? 'React + Vite'
      : hasReact
        ? 'React'
        : dependencies.vite
          ? 'Vite'
          : 'Node.js'
  const commands = []
  for (const script of ['build', 'test', 'lint', 'typecheck', 'check']) {
    if (typeof scripts[script] === 'string') {
      commands.push({ name: script, command: `npm run ${script}`, script })
    }
  }
  if (typeof scripts.test !== 'string' && dependencies.jest) {
    commands.push({ name: 'test', command: 'npx jest', script: null })
  }
  return {
    language: files.some((file) => /\.tsx?$/.test(file)) ? 'TypeScript' : 'JavaScript',
    framework,
    packageName: pkg.name || path.basename(rootPath),
    packageVersion: pkg.version || null,
    description: pkg.description || '',
    dependencies: dependencyNames,
    dependencyCount: dependencyNames.length,
    configs,
    scripts,
    commands,
    toolCompatibility,
    fileCount: files.length,
    files: files.slice(0, 80),
    readme,
    packageManager: fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : fs.existsSync(path.join(rootPath, 'yarn.lock'))
        ? 'yarn'
        : 'npm',
  }
}
