# Configuration Template

This file shows you exactly what values to replace in `app.js` before deployment.

## Step 1: Open app.js

Find the CONFIG object at the top of the file (around line 5-11).

## Step 2: Replace These Values

```javascript
const CONFIG = {
    PASSWORD: 'JuneR0cks!',           // ← Change this to your own password
    SPACE_ID: 'default',               // ← Leave as 'default'
    USERS: ['Kristyn', 'Julio', 'Nanny', 'Kayden'],  // ← Optional: customize names
    
    // ↓ REQUIRED: Replace these with your actual values
    SUPABASE_URL: 'https://xxxxx.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    SERVERLESS_ENDPOINT: 'https://your-worker.workers.dev'
};
```

## Step 3: Where to Find Each Value

### SUPABASE_URL
1. Log into Supabase
2. Select your project
3. Go to Settings (gear icon) → API
4. Copy "Project URL"
5. Paste into `SUPABASE_URL`

### SUPABASE_ANON_KEY
1. Same page as above (Settings → API)
2. Copy "anon public" key (the long string starting with "eyJ...")
3. Paste into `SUPABASE_ANON_KEY`

### SERVERLESS_ENDPOINT
This depends on which serverless platform you chose:

**Cloudflare Workers:**
```
https://family-planner-oauth.YOUR-SUBDOMAIN.workers.dev
```

**Netlify:**
```
https://YOUR-SITE-NAME.netlify.app/.netlify/functions
```

**Vercel:**
```
https://YOUR-PROJECT-NAME.vercel.app/api
```

## Step 4: Verify

Before deploying, double-check:
- [ ] No placeholder text like "YOUR_SUPABASE_URL"
- [ ] URLs start with `https://`
- [ ] Anon key is the full long string (starts with "eyJ")
- [ ] Serverless endpoint matches your deployed function

## Example (Filled In)

```javascript
const CONFIG = {
    PASSWORD: 'FamilyRocks2024!',
    SPACE_ID: 'default',
    USERS: ['Kristyn', 'Julio', 'Nanny', 'Kayden'],
    SUPABASE_URL: 'https://abcdefgh123456.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoMTIzNDU2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODk2ODg4MDAsImV4cCI6MjAwNTI2NDgwMH0.YourActualKeyHere',
    SERVERLESS_ENDPOINT: 'https://family-planner.my-subdomain.workers.dev'
};
```

## Security Note

⚠️ **Important**: The Supabase anon key is SAFE to include in your frontend code. It's designed to be public and is protected by Row Level Security (RLS) policies in your database.

However, NEVER commit:
- Google Client Secret (only in serverless environment)
- Database passwords
- Private API keys

These should only exist in:
- Serverless function environment variables
- Local .env files (which are in .gitignore)

## Need Help?

If you're stuck finding these values, see SETUP.md for detailed screenshots and instructions.
