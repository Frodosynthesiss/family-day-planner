# Deployment Checklist

Use this checklist to ensure everything is set up correctly.

## ☑️ Pre-Deployment

- [ ] Node.js installed (for serverless deployment)
- [ ] Git installed
- [ ] GitHub account created
- [ ] Supabase account created
- [ ] Google Cloud account created
- [ ] Cloudflare/Netlify/Vercel account created

## ☑️ Supabase Setup

- [ ] Created Supabase project
- [ ] Ran `supabase.sql` in SQL Editor
- [ ] Verified tables created (settings, day_plans, day_logs, tasks)
- [ ] Copied Project URL
- [ ] Copied anon public key
- [ ] Tested connection in Supabase dashboard

## ☑️ Google Cloud Setup

- [ ] Created Google Cloud project
- [ ] Enabled Google Calendar API
- [ ] Configured OAuth consent screen
- [ ] Added test users (family members)
- [ ] Created OAuth credentials
- [ ] Saved Client ID
- [ ] Saved Client Secret
- [ ] Added redirect URI (will update after serverless deployment)

## ☑️ Serverless Backend

### If using Cloudflare Workers:
- [ ] Installed Wrangler CLI: `npm install -g wrangler`
- [ ] Logged in: `wrangler login`
- [ ] Created KV namespace: `wrangler kv:namespace create "CALENDAR_TOKENS"`
- [ ] Created `wrangler.toml` with KV namespace ID
- [ ] Set secrets (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_KEY)
- [ ] Deployed worker: `wrangler deploy`
- [ ] Copied Worker URL
- [ ] Updated Google OAuth redirect URI with Worker callback URL

### If using Netlify:
- [ ] Created `netlify.toml`
- [ ] Split functions into separate files
- [ ] Set environment variables in Netlify dashboard
- [ ] Deployed: `netlify deploy --prod`
- [ ] Updated Google OAuth redirect URI

### If using Vercel:
- [ ] Created `/api` directory structure
- [ ] Set environment variables in Vercel dashboard
- [ ] Deployed: `vercel --prod`
- [ ] Updated Google OAuth redirect URI

## ☑️ Frontend Configuration

- [ ] Updated `app.js` with:
  - [ ] Supabase URL
  - [ ] Supabase anon key
  - [ ] Serverless endpoint URL
- [ ] Created or downloaded icon-192.png
- [ ] Created or downloaded icon-512.png
- [ ] Tested all URLs are correct (no localhost, no placeholders)

## ☑️ GitHub Pages Deployment

- [ ] Created GitHub repository
- [ ] Repository is PRIVATE (recommended for family app)
- [ ] Pushed all files to repository
- [ ] Enabled GitHub Pages in repository settings
- [ ] Selected main branch / (root)
- [ ] Waited 1-2 minutes for deployment
- [ ] Visited GitHub Pages URL
- [ ] Verified app loads

## ☑️ Testing

- [ ] Password gate works (password: JuneR0cks!)
- [ ] App unlocks and shows main interface
- [ ] Bottom navigation works (all 5 tabs)
- [ ] Can open Evening wizard
- [ ] Can complete wizard and save plan
- [ ] Today tab loads
- [ ] Can set actual wake time
- [ ] Can toggle naps on/off
- [ ] Can start/stop nap tracking
- [ ] Schedule regenerates on changes
- [ ] Can add tasks
- [ ] Can check off tasks
- [ ] Can delete tasks
- [ ] History tab shows logs
- [ ] Settings tab loads
- [ ] Can connect Google Calendar
- [ ] OAuth flow completes successfully
- [ ] Can export today to Google Calendar
- [ ] Events appear in Google Calendar
- [ ] Can disconnect Google Calendar

## ☑️ Mobile Testing

- [ ] Tested on iOS Safari
- [ ] Tested on Chrome Android
- [ ] Bottom nav doesn't cover content
- [ ] Keyboard doesn't break layout
- [ ] Can "Add to Home Screen"
- [ ] PWA installs correctly
- [ ] Works offline (after initial load)

## ☑️ Family Onboarding

- [ ] Shared GitHub Pages URL with family
- [ ] Shared password with family (via secure method)
- [ ] Explained how to use Evening wizard
- [ ] Showed how to track Today
- [ ] Demonstrated task management
- [ ] Connected Google Calendar for family
- [ ] Verified all family members can access
- [ ] Answered questions

## ☑️ Ongoing Maintenance

- [ ] Bookmarked Supabase dashboard
- [ ] Bookmarked serverless function dashboard
- [ ] Set up monitoring/alerts (optional)
- [ ] Documented any custom changes
- [ ] Created backup of database (optional)

## 🎉 Deployment Complete!

When all items are checked, your Family Day Planner is ready to use!

---

## Common Issues

**Can't connect to Supabase:**
- Verify URL and key in `app.js`
- Check browser console for errors
- Re-run `supabase.sql` if tables missing

**Google Calendar not connecting:**
- Verify redirect URI matches exactly
- Check test users are added
- Look at serverless function logs

**GitHub Pages 404:**
- Ensure files are in root of repository
- Check GitHub Pages is enabled
- Wait 2-5 minutes after enabling

**Service Worker errors:**
- Clear cache: DevTools → Application → Clear storage
- Unregister old worker
- Hard refresh (Ctrl+Shift+R)

**Password doesn't work:**
- Check case sensitivity: `JuneR0cks!`
- Clear browser data and try again
- Verify no typos in `app.js`
