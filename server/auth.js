import crypto from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'

const SESSION_COOKIE = 'projectpassport_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const LOGIN_DURATION_MS = 10 * 60 * 1000
const rateLimits = new Map()
const oauthStates = new Map()

const timestamp = () => new Date().toISOString()
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
const googleRedirectUri = () => process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:3001/api/auth/google/callback'
const appUrl = () => process.env.APP_URL || 'http://127.0.0.1:5173'
const isSecure = () => new URL(appUrl()).protocol === 'https:'

function googleClient() {
  if (!configured()) throw new Error('Google sign-in is not configured.')
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, googleRedirectUri())
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || ''
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return ''
    }
  }
  return ''
}

function setSessionCookie(response, token) {
  const secure = isSecure() ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${secure}`,
  )
}

function clearSessionCookie(response) {
  const secure = isSecure() ? '; Secure' : ''
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
}

function clientIp(request) {
  return request.socket.remoteAddress || 'unknown'
}

function createLoginRateLimiter() {
  return (request, response, next) => {
    const key = clientIp(request)
    const now = Date.now()
    const state = rateLimits.get(key)
    if (!state || now - state.windowStarted > 15 * 60 * 1000) {
      rateLimits.set(key, { windowStarted: now, count: 1 })
      return next()
    }
    if (state.count >= 20) return response.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' })
    state.count += 1
    next()
  }
}

export function configureAuth(app, db, port) {
  const appOrigin = new URL(appUrl()).origin
  const callbackOrigin = new URL(googleRedirectUri()).origin
  const serverOrigins = new Set([
    appOrigin,
    callbackOrigin,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])

  app.use('/api', (request, response, next) => {
    const publicRoute = request.path === '/health'
      || request.path === '/auth/session'
      || request.path === '/auth/google'
      || request.path === '/auth/google/callback'
    if (['POST', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.get('origin')
      if (origin && !serverOrigins.has(origin)) {
        return response.status(403).json({ error: 'Cross-origin requests are not allowed.' })
      }
    }

    const token = readCookie(request, SESSION_COOKIE)
    request.user = null
    if (token && token.length <= 256) {
      const session = db.prepare(`
        SELECT users.id, users.email, users.name, users.picture
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `).get(sha256(token), timestamp())
      if (session) request.user = session
      else if (!publicRoute) clearSessionCookie(response)
    }
    if (!publicRoute && !request.user) return response.status(401).json({ error: 'Sign in with Google to continue.' })
    next()
  })

  app.get('/api/auth/session', (request, response) => response.json({
    authenticated: Boolean(request.user),
    user: request.user,
    googleConfigured: configured(),
  }))

  app.get('/api/auth/google', createLoginRateLimiter(), async (_request, response, next) => {
    if (!configured()) return response.redirect(`${appUrl()}/?authError=google-not-configured`)
    try {
      const oauth = googleClient()
      const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync()
      const state = crypto.randomBytes(32).toString('base64url')
      const nonce = crypto.randomBytes(32).toString('base64url')
      for (const [key, value] of oauthStates) {
        if (value.expiresAt < Date.now()) oauthStates.delete(key)
      }
      oauthStates.set(state, {
        codeVerifier,
        nonce,
        expiresAt: Date.now() + LOGIN_DURATION_MS,
      })
      const authorizationUrl = oauth.generateAuthUrl({
        access_type: 'online',
        scope: ['openid', 'email', 'profile'],
        prompt: 'select_account',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      response.redirect(authorizationUrl)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/auth/google/callback', async (request, response) => {
    const state = typeof request.query.state === 'string' ? request.query.state : ''
    const code = typeof request.query.code === 'string' ? request.query.code : ''
    const challenge = oauthStates.get(state)
    oauthStates.delete(state)
    if (!challenge || challenge.expiresAt < Date.now() || !code) {
      return response.redirect(`${appUrl()}/?authError=login-expired`)
    }

    try {
      const oauth = googleClient()
      const { tokens } = await oauth.getToken({ code, codeVerifier: challenge.codeVerifier })
      if (!tokens.id_token) throw new Error('Google did not return a valid identity token.')
      const ticket = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      })
      const identity = ticket.getPayload()
      if (
        !identity ||
        identity.nonce !== challenge.nonce ||
        !identity.sub ||
        !identity.email ||
        identity.email_verified !== true
      ) {
        throw new Error('Google account could not be verified.')
      }

      const createdAt = timestamp()
      const user = {
        id: identity.sub,
        email: identity.email,
        name: identity.name || identity.email,
        picture: identity.picture || null,
      }
      const saveUserAndSession = db.transaction(() => {
        db.prepare(`
          INSERT INTO users (id, email, name, picture, created_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            picture = excluded.picture,
            last_login_at = excluded.last_login_at
        `).run(user.id, user.email, user.name, user.picture, createdAt, createdAt)
        db.prepare('UPDATE projects SET owner_id = ? WHERE owner_id IS NULL').run(user.id)
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(createdAt)
        const sessionToken = crypto.randomBytes(32).toString('base64url')
        db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .run(sha256(sessionToken), user.id, createdAt, new Date(Date.now() + SESSION_DURATION_MS).toISOString())
        return sessionToken
      })
      setSessionCookie(response, saveUserAndSession())
      response.redirect(appUrl())
    } catch (error) {
      console.error('Google sign-in failed:', error.message)
      response.redirect(`${appUrl()}/?authError=google-sign-in-failed`)
    }
  })

  app.post('/api/auth/logout', (request, response) => {
    const token = readCookie(request, SESSION_COOKIE)
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
    clearSessionCookie(response)
    response.status(204).end()
  })
}
