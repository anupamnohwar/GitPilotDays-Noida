import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import express from 'express'
import Database from 'better-sqlite3'
import test from 'node:test'
import { configureAuth } from '../server/auth.js'

test('Google sign-in gates private project routes and reports local setup status', async (context) => {
  const original = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    appUrl: process.env.APP_URL,
  }
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
  delete process.env.GOOGLE_REDIRECT_URI
  delete process.env.APP_URL

  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT);
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      expires_at TEXT
    );
  `)
  const app = express()
  configureAuth(app, db, 3001)
  app.get('/api/projects', (_request, response) => response.json([]))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    db.close()
    for (const [key, value] of Object.entries({
      GOOGLE_CLIENT_ID: original.clientId,
      GOOGLE_CLIENT_SECRET: original.clientSecret,
      GOOGLE_REDIRECT_URI: original.redirectUri,
      APP_URL: original.appUrl,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const session = await fetch(`${base}/api/auth/session`)
  assert.deepEqual(await session.json(), { authenticated: false, user: null, googleConfigured: false })

  const privateRoute = await fetch(`${base}/api/projects`)
  assert.equal(privateRoute.status, 401)

  const csrf = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example' },
  })
  assert.equal(csrf.status, 403)

  const signIn = await fetch(`${base}/api/auth/google`, { redirect: 'manual' })
  assert.equal(signIn.status, 302)
  assert.match(signIn.headers.get('location'), /authError=google-not-configured/)

  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
  const configuredSignIn = await fetch(`${base}/api/auth/google`, { redirect: 'manual' })
  assert.equal(configuredSignIn.status, 302)
  const authUrl = new URL(configuredSignIn.headers.get('location'))
  assert.equal(authUrl.origin, 'https://accounts.google.com')
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(authUrl.searchParams.get('code_challenge'))
  assert.ok(authUrl.searchParams.get('nonce'))
  assert.ok(authUrl.searchParams.get('state'))

  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run('google-user-1', 'person@example.com', 'Example Person')
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash,
    'google-user-1',
    new Date(Date.now() + 60_000).toISOString(),
  )
  app.get('/api/private-test', (request, response) => response.json({ user: request.user }))
  const authenticated = await fetch(`${base}/api/private-test`, { headers: { Cookie: `projectpassport_session=${token}` } })
  assert.equal(authenticated.status, 200)
  assert.equal((await authenticated.json()).user.email, 'person@example.com')

  const expiredToken = 'expired-token'
  const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex')
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    expiredHash,
    'google-user-1',
    new Date(Date.now() - 60_000).toISOString(),
  )
  const expired = await fetch(`${base}/api/private-test`, { headers: { Cookie: `projectpassport_session=${expiredToken}` } })
  assert.equal(expired.status, 401)
})
