# Family Day Planner - Setup Guide

This guide will walk you through setting up the Family Day Planner from scratch, including Supabase, GitHub Pages, serverless OAuth backend, and Google Calendar integration.

## Overview

The Family Day Planner consists of:
- **Static frontend** (HTML/CSS/JS) hosted on GitHub Pages
- **Supabase backend** for data storage
- **Serverless OAuth backend** for Google Calendar integration (Cloudflare Workers, Netlify, or Vercel)

## Prerequisites

- GitHub account
- Supabase account (free tier works)
- Google Cloud account
- Cloudflare account (for Workers) OR Netlify account OR Vercel account

---

## Part 1: Supabase Setup

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Fill in:
   - **Name**: Family Day Planner
   - **Database Password**: (generate a strong password and save it)
   - **Region**: Choose closest to your location
4. Click "Create new project" and wait for initialization

### 1.2 Run Database Schema

1. In your Supabase project, go to the **SQL Editor** (left sidebar)
2. Click "New query"
3. Copy the entire contents of `supabase.sql` and paste it into the editor
4. Click "Run" (or press Ctrl/Cmd + Enter)
5. Verify success: You should see "Success. No rows returned"

### 1.3 Get API Credentials

1. Go to **Project Settings** (gear icon in sidebar) → **API**
2. Copy and save:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key (this is safe to expose in your frontend)

### 1.4 Disable Email Confirmations (Optional but Recommended)

Since this app uses a password gate instead of authentication:
1. Go to **Authentication** → **Providers**
2. Scroll to "Email"
3. Toggle off "Enable email confirmations"

---

## Part 2: Google Calendar API Setup

### 2.1 Create Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → "New Project"
3. **Project name**: Family Day Planner
4. Click "Create"

### 2.2 Enable Calendar API

1. In your new project, go to **APIs & Services** → **Library**
2. Search for "Google Calendar API"
3. Click on it and click "Enable"

### 2.3 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type and click "Create"
3. Fill in:
   - **App name**: Family Day Planner
   - **User support email**: Your email
   - **Developer contact**: Your email
4. Click "Save and Continue"
5. On **Scopes** page, click "Add or Remove Scopes"
   - Search for `calendar.events`
   - Check the box for `https://www.googleapis.com/auth/calendar.events`
   - Click "Update" then "Save and Continue"
6. On **Test users** page:
   - Click "Add Users"
   - Add email addresses of family members who will use the app
   - Click "Save and Continue"
7. Review and click "Back to Dashboard"

### 2.4 Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click "Create Credentials" → "OAuth client ID"
3. **Application type**: Web application
4. **Name**: Family Planner OAuth
5. **Authorized redirect URIs**: (Add based on your serverless choice)
   
   **For Cloudflare Workers:**
   ```
   https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/auth/callback
   ```
   
   **For Netlify:**
   ```
   https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback
   ```
   
   **For Vercel:**
   ```
   https://YOUR-PROJECT.vercel.app/api/auth-callback
   ```

6. Click "Create"
7. **IMPORTANT**: Save your **Client ID** and **Client Secret**

---

## Part 3: Serverless Backend Setup

Choose ONE of the following options:

### Option A: Cloudflare Workers (Recommended for Simplicity)

#### 3.1 Install Wrangler CLI

```bash
npm install -g wrangler
```

#### 3.2 Login to Cloudflare

```bash
wrangler login
```

#### 3.3 Create KV Namespace

```bash
wrangler kv:namespace create "CALENDAR_TOKENS"
```

Save the namespace ID shown in the output.

#### 3.4 Configure Worker

1. Create `wrangler.toml` in the `serverless` directory:

```toml
name = "family-planner-oauth"
main = "cloudflare-worker.js"
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "CALENDAR_TOKENS", id = "YOUR_KV_NAMESPACE_ID" }
]

[vars]
REDIRECT_URI = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/auth/callback"
```

#### 3.5 Set Secrets

```bash
wrangler secret put GOOGLE_CLIENT_ID
# Paste your Google Client ID when prompted

wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Google Client Secret when prompted

wrangler secret put ENCRYPTION_KEY
# Generate a random 32-character string (e.g., use `openssl rand -base64 32`)
```

#### 3.6 Deploy Worker

```bash
cd serverless
wrangler deploy
```

The output will show your Worker URL (e.g., `https://family-planner-oauth.your-subdomain.workers.dev`)

#### 3.7 Update OAuth Redirect URI

1. Go back to Google Cloud Console → Credentials
2. Edit your OAuth client
3. Update the redirect URI with your actual Worker URL
4. Save

---

### Option B: Netlify Functions

#### 3.1 Create netlify.toml

Create in project root:

```toml
[build]
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"
```

#### 3.2 Prepare Functions

Create directory structure:
```
netlify/
  functions/
    auth-start.js
    auth-callback.js
    calendar-export.js
    auth-disconnect.js
```

Copy the appropriate exports from `serverless/netlify-functions.js` into each file.

#### 3.3 Set Environment Variables

1. In Netlify dashboard, go to **Site settings** → **Environment variables**
2. Add:
   - `GOOGLE_CLIENT_ID`: Your Google Client ID
   - `GOOGLE_CLIENT_SECRET`: Your Google Client Secret
   - `REDIRECT_URI`: `https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback`
   - `ENCRYPTION_KEY`: A random 32-character string

#### 3.4 Deploy

```bash
netlify deploy --prod
```

---

### Option C: Vercel Functions

Similar process to Netlify - create `/api` directory with serverless functions. See Vercel documentation for details.

---

## Part 4: Frontend Configuration

### 4.1 Update Configuration

Edit `app.js` and update these values:

```javascript
const CONFIG = {
    PASSWORD: 'JuneR0cks!',
    SPACE_ID: 'default',
    USERS: ['Kristyn', 'Julio', 'Nanny', 'Kayden'],
    SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL',  // From Part 1.3
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY', // From Part 1.3
    SERVERLESS_ENDPOINT: 'YOUR_WORKER_OR_FUNCTION_URL' // From Part 3
};
```

### 4.2 Create Icons

Create placeholder icons (or use a tool like [favicon.io](https://favicon.io)):

**icon-192.png**: 192x192px PNG
**icon-512.png**: 512x512px PNG

You can use this emoji-to-image technique:
```html
<!-- Create an HTML file with this and screenshot it -->
<div style="font-size: 150px; background: #8B7355; color: white; 
            width: 192px; height: 192px; display: flex; 
            align-items: center; justify-content: center;">
    🏡
</div>
```

---

## Part 5: GitHub Pages Deployment

### 5.1 Create GitHub Repository

1. Go to GitHub and create a new repository
   - Name: `family-day-planner` (or your choice)
   - **Important**: Make it PRIVATE if you want password protection
   - Don't initialize with README

### 5.2 Push Code

```bash
cd family-planner
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/family-day-planner.git
git push -u origin main
```

### 5.3 Enable GitHub Pages

1. Go to repository **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: main / (root)
4. Click "Save"
5. Wait 1-2 minutes for deployment
6. Your site will be at: `https://YOUR-USERNAME.github.io/family-day-planner/`

### 5.4 Test the App

1. Visit your GitHub Pages URL
2. Enter password: `JuneR0cks!`
3. You should see the app load

---

## Part 6: Connect Google Calendar

### 6.1 In the App

1. Open the app and unlock it
2. Go to **Settings** tab
3. Click "Connect Google Calendar"
4. Sign in with Google and grant permissions
5. You'll be redirected back to the app

### 6.2 Test Export

1. Go to **Evening** tab
2. Plan tomorrow using the wizard
3. Go to **Today** tab
4. Set actual wake time
5. Click "Export Today to Google Calendar"
6. Check your Google Calendar - events should appear!

---

## Troubleshooting

### Supabase Connection Issues

- Verify your project URL and anon key are correct in `app.js`
- Check browser console for errors
- Ensure RLS policies are applied (re-run `supabase.sql` if needed)

### Google Calendar Not Connecting

- Verify redirect URI in Google Cloud Console matches your serverless endpoint
- Check serverless function logs for errors
- Ensure test users are added in OAuth consent screen
- Try revoking access in Google account settings and reconnecting

### GitHub Pages Not Loading

- Check that all files are committed and pushed
- Verify GitHub Pages is enabled in repository settings
- Check for HTTPS errors in browser console
- Try accessing via incognito/private browsing

### Service Worker Issues

- Clear browser cache and reload
- Open DevTools → Application → Service Workers → Unregister
- Reload page

---

## Security Notes

1. **Password Protection**: The password is client-side only. For true security, consider adding server-side authentication
2. **Supabase RLS**: Policies limit access to `space_id = 'default'` but anyone with the anon key can access that data
3. **HTTPS**: Always use HTTPS (GitHub Pages provides this automatically)
4. **Secrets**: Never commit secrets to Git. Use environment variables for serverless functions

---

## Customization

### Change Password

Edit `app.js`:
```javascript
PASSWORD: 'YourNewPassword!'
```

### Modify Constraints

Edit default values in `supabase.sql` or change them in the Settings tab of the app

### Styling

Edit `styles.css` - all colors are defined in CSS variables at the top

---

## Maintenance

### Updating the App

1. Make changes to your code
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Update feature"
   git push
   ```
3. GitHub Pages will automatically redeploy (1-2 minutes)

### Backing Up Data

Export from Supabase:
1. Go to Table Editor
2. Select each table
3. Click "..." → "Export to CSV"

---

## Support

For issues:
1. Check browser console for errors (F12 → Console)
2. Check Supabase logs (Logs section in dashboard)
3. Check serverless function logs (Cloudflare/Netlify/Vercel dashboards)

---

## File Structure Summary

```
family-planner/
├── index.html              # Main HTML file
├── styles.css              # Styles
├── app.js                  # Application logic
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline caching
├── icon-192.png           # App icon (192x192)
├── icon-512.png           # App icon (512x512)
├── supabase.sql           # Database schema
├── serverless/
│   ├── cloudflare-worker.js     # Cloudflare Workers implementation
│   └── netlify-functions.js     # Netlify Functions implementation
└── SETUP.md               # This file
```

---

## Next Steps

After setup is complete:
1. Test all features thoroughly
2. Add app to home screen on mobile devices
3. Plan your first day!
4. Share the link with family members

Enjoy your Family Day Planner! 🏡
