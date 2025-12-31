# 🚀 Quick Start Guide

Welcome to your Family Day Planner! Follow these steps to get up and running.

## 📦 What's Included

Your zip file contains:
- Complete PWA frontend (HTML/CSS/JS)
- Supabase database schema
- Serverless OAuth backend (2 options)
- Comprehensive documentation
- Deployment guides

## ⚡ Fast Track (30 minutes)

### 1. Supabase (5 minutes)
```
1. Go to supabase.com → Create project
2. Copy supabase.sql contents → SQL Editor → Run
3. Copy Project URL and anon key
```

### 2. Google Calendar API (10 minutes)
```
1. console.cloud.google.com → New Project
2. Enable "Google Calendar API"
3. OAuth consent screen → External → Add family emails as test users
4. Create OAuth credentials → Save Client ID & Secret
```

### 3. Serverless Backend (5 minutes)

**Cloudflare Workers (Easiest):**
```bash
npm install -g wrangler
wrangler login
wrangler kv:namespace create "CALENDAR_TOKENS"
# Edit serverless/cloudflare-worker.js with your KV ID
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET  
wrangler secret put ENCRYPTION_KEY
wrangler deploy
```

### 4. Configure Frontend (2 minutes)
```
Edit app.js:
- SUPABASE_URL: (from step 1)
- SUPABASE_ANON_KEY: (from step 1)
- SERVERLESS_ENDPOINT: (from step 3)
```

### 5. Deploy to GitHub Pages (5 minutes)
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_REPO_URL
git push -u origin main

# On GitHub: Settings → Pages → Enable
```

### 6. Create Icons (3 minutes)
```
Open create-icons.html in browser
Screenshot the icons
Save as icon-192.png and icon-512.png
Commit and push
```

## 📱 First Use

1. Visit your GitHub Pages URL
2. Enter password: `JuneR0cks!`
3. Go to Settings → Connect Google Calendar
4. Start using!

## 📚 Full Documentation

- **SETUP.md** - Detailed step-by-step instructions with screenshots
- **CONFIG_TEMPLATE.md** - How to fill in configuration values
- **DEPLOYMENT_CHECKLIST.md** - Verify everything is working
- **README.md** - Project overview and features

## 🆘 Stuck?

1. Check browser console (F12) for errors
2. Review SETUP.md troubleshooting section
3. Verify all configuration values in app.js
4. Check Supabase logs
5. Check serverless function logs

## 🎯 Key Files to Edit

1. **app.js** (lines 5-11) - Add your Supabase & serverless URLs
2. **supabase.sql** - Run this in Supabase SQL Editor
3. **serverless/cloudflare-worker.js** - Deploy this as your OAuth backend

## ✅ Verification

After setup, test:
- [ ] Password unlocks app
- [ ] All tabs load
- [ ] Can plan tomorrow (Evening wizard)
- [ ] Can track today (wake time, naps)
- [ ] Can add/complete tasks
- [ ] Can connect Google Calendar
- [ ] Can export to calendar

## 🔐 Security Reminders

- Keep Google Client Secret in serverless environment only
- Supabase anon key is safe in frontend
- Change default password in app.js
- Use HTTPS (GitHub Pages provides this)

## 🎉 You're Ready!

Once deployed:
1. Share the GitHub Pages URL with family
2. Share the password (use secure method)
3. Everyone can access from any device
4. Data syncs automatically via Supabase

---

**Need more help?** See SETUP.md for the complete guide with screenshots and detailed explanations.

**Want to customize?** Edit styles.css for colors, or modify constraints in Settings tab.

Enjoy your Family Day Planner! 🏡
