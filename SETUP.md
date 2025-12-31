# Family Day Planner (Shared Password + Supabase)

This is a static PWA meant to be hosted on GitHub Pages.
It uses Supabase as a shared backend (no individual user accounts).

## 1) Create a Supabase project
- Create a new Supabase project in the Supabase dashboard.

## 2) Run the SQL
In the Supabase project:
- Open **SQL Editor**
- Run `supabase.sql` (included in this repo)

This creates:
- `settings`
- `tasks`
- `day_plans`
- `day_logs`

All data is shared under `space_id = 'default'`.

## 3) CORS
In Supabase:
- Project Settings → API → CORS
- Add your GitHub Pages origin(s), e.g.:
  - https://YOURUSER.github.io
  - https://YOURUSER.github.io/YOURREPO

## 4) Deploy to GitHub Pages
Upload these files to your repo root:
- index.html
- app.js
- styles.css
- manifest.json
- service-worker.js
- icon-192.png
- icon-512.png

Enable Pages:
- Settings → Pages → Deploy from branch → root

## 5) If you see old behavior after updating
PWAs cache aggressively. Do ONE of these after deploying:
- Hard refresh: Ctrl+Shift+R
- DevTools → Application → Service Workers → Unregister
- Clear site data
