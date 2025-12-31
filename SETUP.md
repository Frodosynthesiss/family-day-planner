# Family Day Planner — Setup Guide (Shared / No-Auth)

This is a private, mobile-friendly PWA (“family intranet”) that runs as a static GitHub Pages site and syncs across devices using Supabase.

## Access
- No individual accounts.
- One shared password gate:
  - Password: `JuneR0cks!`

## Supabase
1) Create a Supabase project
2) In `app.js`, set:
- `SUPABASE_URL`
- `SUPABASE_KEY` (Publishable key, starts with `sb_publishable_...`)

3) Run the SQL in `supabase-shared-noauth.sql` in Supabase SQL Editor.

## Local run
Use a local web server (service workers won’t work from file://):
- VS Code Live Server, or
- `python -m http.server 8080`

## GitHub Pages
Upload the folder contents to a repo root and enable Pages (main branch / root).

## Google Calendar export
In Settings, paste your Apps Script Web App URL + Calendar ID + a shared API key.
