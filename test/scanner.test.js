import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { scanProject } from '../server/scanner.js'
import { createPassport, passportMarkdown } from '../server/passport.js'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectpassport-test-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'node_modules', 'react'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-app',
    version: '2.1.0',
    dependencies: { react: '^18.0.0', vite: '^6.0.0' },
    scripts: { build: 'vite build', test: 'node --test' },
  }))
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export default function App() { return null }')
  fs.writeFileSync(path.join(root, 'vite.config.ts'), 'export default {}')
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture app')
  return root
}

test('scanner identifies a React project without traversing dependency directories', (context) => {
  const root = fixture()
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const scan = scanProject(root)

  assert.equal(scan.language, 'TypeScript')
  assert.equal(scan.framework, 'React + Vite')
  assert.equal(scan.packageName, 'fixture-app')
  assert.equal(scan.packageVersion, '2.1.0')
  assert.deepEqual(scan.commands.map((command) => command.script), ['build', 'test'])
  assert.equal(scan.fileCount, 4)
  assert.equal(scan.configs.includes('vite.config.ts'), true)
})

test('scanner reports malformed package manifests instead of silently ignoring them', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectpassport-invalid-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), '{ invalid')
  assert.throws(() => scanProject(root), /Could not parse package\.json/)
})

test('scanner detects editor-specific instruction files and exports them as compatibility evidence', (context) => {
  const root = fixture()
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, '.github', 'instructions'), { recursive: true })
  fs.writeFileSync(path.join(root, '.github', 'copilot-instructions.md'), 'Use strict TypeScript.')
  fs.writeFileSync(path.join(root, '.github', 'instructions', 'frontend.instructions.md'), 'Use accessible UI patterns.')
  fs.mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true })
  fs.writeFileSync(path.join(root, '.cursor', 'rules', 'frontend.mdc'), 'Prefer React.')
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Keep changes small.')

  const tools = scanProject(root).toolCompatibility
  const copilot = tools.find((tool) => tool.id === 'copilot')
  const cursor = tools.find((tool) => tool.id === 'cursor')
  const claude = tools.find((tool) => tool.id === 'claude')
  const gemini = tools.find((tool) => tool.id === 'gemini')

  assert.equal(copilot.configured, true)
  assert.deepEqual(copilot.nativeFiles, ['.github/copilot-instructions.md', '.github/instructions/frontend.instructions.md'])
  assert.deepEqual(cursor.nativeFiles, ['.cursor/rules/frontend.mdc'])
  assert.deepEqual(claude.nativeFiles, ['CLAUDE.md'])
  assert.equal(gemini.configured, false)
})

test('passport exports structured context and a readable Markdown handoff', () => {
  const project = {
    id: 'fixture-id',
    name: 'Fixture App',
    source: 'ZIP upload',
    scanned_at: '2026-01-01T00:00:00.000Z',
    scan: {
      language: 'TypeScript',
      framework: 'React + Vite',
      packageName: 'fixture-app',
      packageVersion: '2.1.0',
      description: '',
      packageManager: 'npm',
      configs: ['vite.config.ts'],
      files: ['src/App.tsx'],
      fileCount: 1,
      readme: '',
      dependencies: ['react'],
      commands: [{ command: 'npm run test' }],
      toolCompatibility: [
        { id: 'copilot', name: 'GitHub Copilot', nativeFiles: ['.github/copilot-instructions.md'] },
      ],
    },
  }
  const passport = createPassport(project, [
    { title: 'Refresh bug', details: 'Only on the home route', status: 'open', created_at: '2026-01-01T00:00:00.000Z', attempts: [{ description: 'Tried a route guard', outcome: 'failed', created_at: '2026-01-01T00:00:00.000Z' }] },
  ], [{ content: 'Keep public routes stable.' }], [
    { command: 'npm run test', status: 'passed', output: 'ok', duration_ms: 23, created_at: '2026-01-01T00:00:00.000Z' },
  ])
  const markdown = passportMarkdown(passport)

  assert.equal(passport.schemaVersion, 1)
  assert.equal(passport.knownIssues[0].attempts[0].outcome, 'failed')
  assert.match(markdown, /# Fixture App — Project Passport/)
  assert.match(markdown, /Keep public routes stable\./)
  assert.match(markdown, /npm run test/)
  assert.match(markdown, /Coding assistant compatibility/)
  assert.match(markdown, /\.github\/copilot-instructions\.md/)
})
