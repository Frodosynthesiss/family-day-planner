# 🏡 Family Day Planner (Firebase Edition)

**Modern, sleek family planning app with real-time sync and Google integration.**

![Version](https://img.shields.io/badge/version-2.0-blue)
![Firebase](https://img.shields.io/badge/backend-Firebase-orange)
![License](https://img.shields.io/badge/license-Private-red)

## ✨ What's New in Firebase Edition

- **Sleeker, Modern UI** - Refined design with smooth animations
- **Google Sign-In** - No more shared passwords
- **Simpler Setup** - One service instead of three
- **Real-Time Sync** - See changes instantly across all devices
- **Better Auth** - Each family member has their own account
- **Unified Google Ecosystem** - Auth + Database + Calendar all from Google

## 🎯 Features

### Evening Planning
Plan tomorrow in a beautiful 5-step wizard:
1. Set wake time target
2. Add appointments
3. Assign nap caregivers (Kayden excluded from baby naps)
4. Review constraints
5. Quick task brain dump

### Dynamic Today View
- Real-time schedule that adapts as the day unfolds
- Track actual wake time
- Start/stop nap timers
- See schedule regenerate automatically
- Export to Google Calendar

### Task Management
- **Brain Dump**: Capture tasks without dates
- **Today's Focus**: Tasks for today
- **Completed**: Checked-off tasks
- Real-time sync across devices

### History
View past day logs with actual timings and schedule details.

## 🚀 Quick Start

**Total time: ~30 minutes**

1. **Create Firebase Project** (10 min)
   - Go to console.firebase.google.com
   - Create project
   - Enable Google Authentication
   - Create Firestore database
   - Copy your config

2. **Configure App** (5 min)
   - Replace firebaseConfig in app.js
   - That's it!

3. **Deploy to GitHub Pages** (5 min)
   - Push to GitHub
   - Enable Pages
   - Done!

4. **Add Security Rules** (5 min)
   - Copy rules from SETUP.md
   - Publish in Firebase console

5. **Test** (5 min)
   - Sign in with Google
   - Start planning!

See **SETUP.md** for detailed step-by-step instructions.

## 🎨 Design

### Modern & Sleek
- **Fonts**: Clash Display (headings) + Inter (body)
- **Colors**: Refined earth tones (#7A6C5D palette)
- **Animations**: Smooth, purposeful transitions
- **Layout**: Clean cards, generous whitespace
- **Mobile-First**: Optimized for phones and tablets

### Improved From Original
- More refined color palette
- Better typography hierarchy
- Smoother animations
- Modernized components (switches, inputs)
- Sleeker navigation

## 👥 Family Members

- **Kristyn**
- **Julio**
- **Nanny**
- **Kayden** (excluded from baby nap assignments)

## 🔒 Authentication & Security

### Google Sign-In
- Each family member signs in with their own Google account
- No shared passwords
- Secure, industry-standard OAuth

### Data Privacy
- Data stored in YOUR Firebase project
- Only authenticated family members can access
- Firestore security rules enforce access control
- Real-time sync encrypted in transit

## 💰 Cost

**$0/month** for typical family use!

Firebase free tier includes:
- ✅ 10K auth users/month
- ✅ 1GB Firestore storage
- ✅ 50K document reads/day
- ✅ 10GB hosting/month

Perfect for a family of 2-6 people with daily use.

## 📱 Progressive Web App

- Install to home screen on any device
- Works offline after first load
- App-like experience
- No app store required

## 🔄 Real-Time Sync

Changes appear instantly across all devices:
- Add a task on your phone → Appears on husband's tablet
- Update wake time → Schedule regenerates everywhere
- Complete a task → Checkmark shows immediately

## 📅 Google Calendar Export

Two options:

### Option A: ICS Export (Simple, Free)
- Download .ics file
- Import to Google Calendar manually
- No additional setup required

### Option B: Automatic Sync (Advanced)
- Requires Firebase Functions (pay-as-you-go)
- OAuth integration
- One-click export
- See FUNCTIONS.md for setup

## 🆚 vs Original Supabase Version

| Feature | Firebase | Supabase |
|---------|----------|----------|
| Setup | ⭐⭐ Easy | ⭐⭐⭐⭐ Complex |
| Services | 1 (Firebase) | 3 (Supabase + GitHub + Serverless) |
| Auth | Google Sign-In | Shared password |
| Calendar | Same provider | Separate OAuth |
| UI | Modern & sleek | Warm & family-friendly |
| **Recommendation** | **✅ Recommended** | Good but more complex |

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Firebase (Auth + Firestore + Functions)
- **Hosting**: GitHub Pages
- **Auth**: Google OAuth
- **Database**: Cloud Firestore
- **PWA**: Service Worker for offline

## 📂 Project Structure

```
family-planner-firebase/
├── index.html              # Modern UI
├── styles.css              # Sleek styling
├── app.js                  # Firebase logic
├── manifest.json           # PWA config
├── service-worker.js       # Offline support
├── create-icons.html       # Icon helper
├── SETUP.md               # Setup guide
├── FUNCTIONS.md           # Optional Functions
└── README.md              # This file
```

## 🎯 Use Cases

Perfect for:
- Busy families with young children
- Tracking nap schedules and wake times
- Coordinating caregivers
- Reducing mental load
- Sharing schedules across devices
- Planning ahead each evening

## 📖 Documentation

- **SETUP.md** - Complete setup guide (30 min)
- **FUNCTIONS.md** - Optional calendar sync setup
- **Comments in code** - Well-documented for customization

## 🔧 Customization

Easy to customize:
- **Colors**: Edit CSS variables in styles.css
- **Constraints**: Change in Settings tab
- **Users**: Modify USERS array in app.js
- **Fonts**: Update Google Fonts link in index.html

## 🐛 Troubleshooting

See SETUP.md "Troubleshooting" section for:
- Sign-in issues
- Data sync problems
- Calendar export errors
- Security rules
- Common questions

## 📝 License

Private family use. Not licensed for distribution or commercial use.

## 🙏 Credits

Built with:
- Firebase by Google
- GitHub Pages
- Modern web standards (PWA, ES6+)
- Love for organized family life ❤️

---

## 🚀 Get Started Now

1. Read SETUP.md
2. Create Firebase project (10 min)
3. Deploy app (15 min)
4. Start planning! 🎉

**Questions?** Check SETUP.md's troubleshooting section.

---

Made with ☕ for families who want better days
