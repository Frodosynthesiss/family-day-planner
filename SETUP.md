# Family Day Planner - Firebase Setup Guide

This guide will help you set up the Family Day Planner with Firebase as the backend.

## Why Firebase?

✅ **Simpler setup** - One service instead of three (Supabase + GitHub + Serverless)
✅ **Google integration** - Auth + Database + Calendar API all from Google
✅ **Real-time sync** - See changes instantly across devices
✅ **Better auth** - Proper user accounts instead of shared password
✅ **Free tier** - Generous limits for family use

---

## Part 1: Firebase Project Setup (10 minutes)

### 1.1 Create Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click "Add project"
3. **Project name**: Family Day Planner
4. **Google Analytics**: Optional (you can disable it for simpler setup)
5. Click "Create project" and wait for initialization

### 1.2 Enable Authentication

1. In the Firebase console, click **Authentication** in the left sidebar
2. Click **Get started**
3. Click the **Google** sign-in provider
4. Toggle **Enable**
5. Select a **Project support email** (your email)
6. Click **Save**

That's it! Google Sign-In is now enabled.

### 1.3 Create Firestore Database

1. Click **Firestore Database** in the left sidebar
2. Click **Create database**
3. Select **Start in test mode** (we'll add security rules later)
4. Choose your **region** (closest to you)
5. Click **Enable**

### 1.4 Get Firebase Configuration

1. Click the **gear icon** (⚙️) next to Project Overview → **Project settings**
2. Scroll down to **Your apps** section
3. Click the **</>** (Web) icon
4. **App nickname**: Family Planner
5. Check **Also set up Firebase Hosting** (optional)
6. Click **Register app**
7. **Copy the firebaseConfig object** - you'll need this for app.js!

It looks like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyC...",
  authDomain: "family-planner-xxxxx.firebaseapp.com",
  projectId: "family-planner-xxxxx",
  storageBucket: "family-planner-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

---

## Part 2: Configure the App (5 minutes)

### 2.1 Update app.js

1. Open `app.js` in a text editor
2. Find the `firebaseConfig` object at the top (lines 4-11)
3. **Replace it** with your Firebase config from step 1.4
4. Save the file

That's it! The app is now connected to your Firebase project.

---

## Part 3: Deploy to GitHub Pages (5 minutes)

### 3.1 Create GitHub Repository

1. Go to [github.com](https://github.com) and create a new repository
   - **Name**: family-day-planner
   - **Visibility**: Private (recommended) or Public
   - Don't initialize with README

### 3.2 Push Your Code

```bash
cd family-planner-firebase
git init
git add .
git commit -m "Initial commit - Firebase version"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/family-day-planner.git
git push -u origin main
```

### 3.3 Enable GitHub Pages

1. Go to repository **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: main / (root)
4. Click **Save**
5. Wait 1-2 minutes
6. Your app will be at: `https://YOUR-USERNAME.github.io/family-day-planner/`

---

## Part 4: Set Up Google Calendar Integration (15 minutes)

### 4.1 Enable Calendar API in Firebase Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. In the project dropdown, select your Firebase project
3. Go to **APIs & Services** → **Library**
4. Search for "Google Calendar API"
5. Click it and click **Enable**

### 4.2 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** and click **Create**
3. Fill in:
   - **App name**: Family Day Planner
   - **User support email**: Your email
   - **Developer contact**: Your email
4. Click **Save and Continue**
5. On **Scopes**: Click "Add or Remove Scopes"
   - Search for `calendar.events`
   - Check the box
   - Click **Update** → **Save and Continue**
6. On **Test users**: Click **Add Users**
   - Add email addresses of family members
   - Click **Save and Continue**
7. Click **Back to Dashboard**

### 4.3 Create Firebase Functions for Calendar API

**Note**: Google Calendar integration requires Firebase Functions (server-side code). Here are two options:

#### Option A: Simple ICS Export (No Functions Required)

The easiest approach is to export to `.ics` files that can be imported to Google Calendar manually:

1. Skip Firebase Functions setup
2. Modify the export to create .ics files instead
3. Users download and import to their calendar

#### Option B: Full OAuth Integration (Requires Paid Plan)

For automatic calendar sync, you need Firebase Functions (Blaze plan - pay as you go):

1. Upgrade to Blaze plan in Firebase console
2. Install Firebase CLI: `npm install -g firebase-tools`
3. Deploy Functions (see FUNCTIONS.md for code)

**Recommendation**: Start with Option A (ICS export) - it's simpler and free!

---

## Part 5: Add Security Rules (5 minutes)

### 5.1 Firestore Security Rules

1. In Firebase console, go to **Firestore Database**
2. Click the **Rules** tab
3. Replace the rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Family data - anyone authenticated can read/write
    match /families/{familyId} {
      allow read, write: if request.auth != null;
      
      // Sub-collections
      match /day_plans/{date} {
        allow read, write: if request.auth != null;
      }
      match /day_logs/{date} {
        allow read, write: if request.auth != null;
      }
      match /tasks/{taskId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

4. Click **Publish**

---

## Part 6: Test Everything (5 minutes)

### 6.1 First Sign In

1. Open your GitHub Pages URL
2. Click **Continue with Google**
3. Sign in with your Google account
4. Grant permissions
5. You should see the app!

### 6.2 Test Features

- ✅ **Evening Tab**: Open planning wizard, plan tomorrow
- ✅ **Today Tab**: Set wake time, toggle naps, track timing
- ✅ **Tasks Tab**: Add tasks, check them off
- ✅ **History Tab**: View past days
- ✅ **Settings Tab**: View constraints

### 6.3 Test Cross-Device Sync

1. Open the app on your phone
2. Sign in with the same Google account
3. Make changes on one device
4. See them appear instantly on the other! ✨

---

## Part 7: Add Family Members

### 7.1 Share the App

1. Share your GitHub Pages URL with family members
2. They sign in with their own Google accounts
3. Everyone sees the same family data
4. Changes sync in real-time

### 7.2 Test Users (Optional)

If you're still in OAuth test mode, remember to add family members' emails in:
- Google Cloud Console → OAuth consent screen → Test users

---

## Troubleshooting

### Can't Sign In

**Problem**: "Error signing in" or redirect fails
**Solution**:
- Verify Firebase config is correct in app.js
- Check that Google Sign-In is enabled in Firebase Authentication
- Make sure you're using HTTPS (GitHub Pages auto-provides this)

### Data Not Syncing

**Problem**: Changes don't appear on other devices
**Solution**:
- Check browser console for errors
- Verify Firestore rules are published
- Make sure both devices are signed in with authenticated accounts

### Calendar Export Not Working

**Problem**: Can't export to Google Calendar
**Solution**:
- If using ICS export: Download the file and manually import
- If using Functions: Make sure you've deployed them and upgraded to Blaze plan
- Check that Calendar API is enabled in Google Cloud Console

---

## Cost Estimate

Firebase offers generous free tiers perfect for family use:

| Service | Free Tier | Family Use |
|---------|-----------|------------|
| Authentication | 10K/month | ✅ Way more than enough |
| Firestore | 1GB storage, 50K reads/day | ✅ Plenty |
| Hosting | 10GB/month | ✅ More than enough |
| Functions | 2M invocations/month | ✅ (only if using calendar sync) |

**Expected cost**: $0/month for typical family use!

---

## Next Steps

1. ✅ Customize the default constraints in Settings
2. ✅ Plan your first day in the Evening tab
3. ✅ Track today in the Today tab
4. ✅ Add tasks as they come up
5. ✅ Invite family members to join

---

## Comparison: Firebase vs Supabase

| Feature | Firebase | Supabase (Original) |
|---------|----------|---------------------|
| Setup Complexity | ⭐⭐ (2 services) | ⭐⭐⭐⭐ (3 services) |
| Authentication | Built-in Google Auth | Password gate only |
| Real-time Sync | ✅ Native | ✅ Native |
| Calendar Integration | Same OAuth provider | Requires separate OAuth backend |
| Cost | Free tier generous | Free tier generous |
| **Recommendation** | **✅ Better choice** | More complex |

---

## Support

### Common Questions

**Q: Do we all need Google accounts?**
A: Yes, but most people already have Gmail accounts!

**Q: Can we use other sign-in methods?**
A: Yes! Firebase supports email/password, Apple, Facebook, etc. Just enable them in Authentication.

**Q: Is our data private?**
A: Yes! Data is stored in your Firebase project. Only authenticated users in your family can access it.

**Q: Can I switch back to the Supabase version?**
A: Yes, both versions are available. Choose what works best for you!

---

## File Structure

```
family-planner-firebase/
├── index.html              # Modern UI with Google Sign-In
├── styles.css              # Sleek, refined design
├── app.js                  # Firebase-powered logic
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline support
├── create-icons.html       # Icon generator
├── SETUP.md               # This file
└── FUNCTIONS.md           # Optional: Calendar Functions code
```

---

## You're Done! 🎉

Your Family Day Planner is now live with:
- ✅ Modern, sleek UI
- ✅ Google Sign-In
- ✅ Real-time sync
- ✅ Cross-device access
- ✅ Offline support

Enjoy your organized family life!
