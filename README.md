# ProjectPassport

ProjectPassport keeps the engineering context that tends to disappear between AI coding tools: a project map, known issues and repair attempts, constraints, and verification evidence. It exports that context as portable Markdown or JSON.

## Run locally

Requirements: Node.js 20 or newer, npm, and Git (only needed for Git URL imports).

```sh
npm install
# Copy .env.example to .env, then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
npm run dev
```

Open the Vite URL printed in the terminal (usually `http://localhost:5173`). The Express API listens on `http://localhost:3001`. For a production build, run `npm run build` and then `npm start`; Express serves the generated frontend from `dist`.

Project metadata and imported source archives are stored locally in `data/`. Keep that directory private and back it up if you need to preserve your passports. Removing a project in the UI also removes its imported files.

## Google sign-in

Create an OAuth 2.0 **Web application** client in the Google Cloud Console and add `http://127.0.0.1:3001/api/auth/google/callback` as an authorized redirect URI. Add your Google account as a test user if the OAuth consent screen is in testing mode. Copy `.env.example` to `.env`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. `APP_URL` and `GOOGLE_REDIRECT_URI` can be configured in `.env` when using another local address or a deployment origin; the redirect URI must exactly match the Google client configuration. Set `HOST=0.0.0.0` only when running the server behind a trusted deployment firewall or reverse proxy. Restart the app after changing credentials.

Google sign-in also creates an account on first use. Each account sees only its own projects. Existing local projects without an account are assigned to the first Google account that signs in.

Do not commit `.env` or paste the OAuth client secret into source code. For local development, the Vite server listens on loopback and blocks HTTP access to the `data/` storage directory. Use HTTPS and an appropriate deployment host when running on a remote server.

## What it does

- Imports a ZIP archive (50 MB upload limit; 250 MB expanded limit) or clones a public HTTPS GitHub, GitLab, or Bitbucket repository.
- Scans JavaScript/TypeScript project files, `package.json`, dependencies, common configuration files, README excerpts, and build/test/lint scripts.
- Tracks when projects were last opened and lists them in a dedicated recent-projects view.
- Detects recognized repository instruction files for GitHub Copilot, Cursor, Claude Code, Gemini CLI, Windsurf, Cline, OpenAI Codex, and JetBrains AI Assistant; exports a provider-neutral Markdown/JSON handoff for all tools.
- Stores debugging issues, repair attempts and outcomes, project constraints, and command results in SQLite.
- Exports the current project record as a standalone Markdown handoff or structured JSON document.
- Runs detected `package.json` scripts only after an explicit click, with a two-minute timeout and bounded output.

Tool compatibility is evidence-based file detection, not an integration test or a guarantee for a particular IDE, plugin, or model version. If a project has no native tool-specific instruction file, use its exported passport as context in the coding tool.

Google sign-in uses an OAuth state parameter, PKCE, a verified Google identity token, and an opaque, hashed server-side session. Session cookies are HTTP-only and same-site; use HTTPS in production.

## Execution and privacy notes

The scanner does not execute imported code. Verification runs a project-defined npm script in a local child process; those scripts can execute arbitrary code with the permissions of the ProjectPassport user. Only run checks for projects you trust. This initial version applies a timeout and output limit, but is **not a sandbox**.

Imported source and passport data are kept on the local machine and are not sent to an AI service. Git import accepts public HTTPS URLs from the three supported hosting sites; private repository authentication is not supported. ZIP extraction validates that resolved destinations remain inside the imported project and enforces expanded-size and entry-count limits.

## Storage

`data/passport.sqlite` is the SQLite database. Imported project files and temporary uploads are in `data/projects/` and `data/uploads/`. Do not commit `data/`; it contains project source and local passport data.
