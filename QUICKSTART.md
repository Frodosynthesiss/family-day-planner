# ⚡ Quick Start Checklist

Get your Family Day Planner running in 30 minutes!

## ✅ Step 1: Firebase Setup (10 minutes)

- [ ] Go to [console.firebase.google.com](https://console.firebase.google.com)
- [ ] Click "Add project" → Name it "Family Day Planner"
- [ ] **Authentication**: Enable Google Sign-In
- [ ] **Firestore**: Create database in test mode
- [ ] **Config**: Copy firebaseConfig from Project Settings

## ✅ Step 2: Configure App (5 minutes)

- [ ] Open `app.js` in text editor
- [ ] Find `firebaseConfig` (lines 4-11)
- [ ] Paste your Firebase config
- [ ] Save file

## ✅ Step 3: Deploy (5 minutes)

```bash
cd family-planner-firebase
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_REPO_URL
git push -u origin main
```

- [ ] GitHub: Settings → Pages → Enable (main branch)
- [ ] Wait 2 minutes for deployment
- [ ] Open your GitHub Pages URL

## ✅ Step 4: Security Rules (5 minutes)

- [ ] Firebase Console → Firestore → Rules tab
- [ ] Copy rules from SETUP.md
- [ ] Click "Publish"

## ✅ Step 5: Test (5 minutes)

- [ ] Open app URL
- [ ] Click "Continue with Google"
- [ ] Sign in
- [ ] Test Evening wizard
- [ ] Test Today tab
- [ ] Add a task
- [ ] Open on second device → See data sync! ✨

## 🎉 You're Done!

Your app is live at: `https://YOUR-USERNAME.github.io/family-day-planner/`

## 🔧 Optional: Google Calendar (15 minutes)

For automatic calendar export:

- [ ] Enable Calendar API in Google Cloud Console
- [ ] Configure OAuth consent screen
- [ ] Add test users (family emails)
- [ ] Deploy Firebase Functions (see FUNCTIONS.md)

**Or** use simple ICS export (no setup needed)!

## 👨‍👩‍👧‍👦 Add Family Members

- [ ] Share your GitHub Pages URL
- [ ] They sign in with their Google accounts
- [ ] Everyone sees the same data
- [ ] Changes sync in real-time

## 💡 Tips

- **Bookmark the app** - Add to home screen on mobile
- **Plan every evening** - Use the wizard before bed
- **Track in real-time** - Update wake times and naps as they happen
- **Check together** - Both parents can see the same schedule
- **Brain dump** - Add tasks whenever they pop into your head

## 📚 Need Help?

- Detailed guide: **SETUP.md**
- Troubleshooting: **SETUP.md → Troubleshooting**
- Code questions: Comments in app.js

---

## Time Estimate Breakdown

| Step | Time | Difficulty |
|------|------|-----------|
| Firebase Setup | 10 min | ⭐ Easy |
| Configure App | 5 min | ⭐ Very Easy |
| Deploy | 5 min | ⭐ Easy |
| Security Rules | 5 min | ⭐ Easy |
| Test | 5 min | ⭐ Very Easy |
| **Total** | **30 min** | **⭐ Easy** |

## 🆚 Compared to Supabase Version

| Task | Firebase | Supabase |
|------|----------|----------|
| Services to configure | 1 | 3 |
| OAuth setup | Same provider | Separate backend |
| Setup time | 30 min | 60+ min |
| Complexity | Low | High |

---

Ready? Start with **SETUP.md** for detailed instructions!
