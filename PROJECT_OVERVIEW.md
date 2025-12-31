# Family Day Planner - Project Overview

## 🎯 What You're Building

A **mobile-first Progressive Web App** for family day planning that:
- Eliminates mental load through smart evening planning
- Adapts schedules dynamically as the day unfolds
- Syncs across all family devices
- Exports to Google Calendar automatically
- Works offline after first load

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Pages                        │
│            (Static PWA Hosting)                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │          index.html                           │  │
│  │          styles.css (warm design)             │  │
│  │          app.js (main logic)                  │  │
│  │          service-worker.js (offline)          │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────┬──────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌───────────────────┐
│   Supabase   │    │  Serverless OAuth  │
│  PostgreSQL  │    │  (Cloudflare/etc)  │
│              │    │                    │
│  • settings  │    │  • Token storage   │
│  • day_plans │    │  • OAuth flow      │
│  • day_logs  │    │  • Calendar API    │
│  • tasks     │    │                    │
└──────────────┘    └─────────┬──────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Google Calendar  │
                    │      API         │
                    └──────────────────┘
```

## 🎨 Design System

### Colors
- **Primary**: #8B7355 (warm brown)
- **Background**: #FAF8F5 (off-white)
- **Accents**: Earth tones (sage, terracotta, gold)

### Typography
- **Headers**: Instrument Serif (warmth)
- **Body**: Karla (readability)

### Components
- Password gate with gradient background
- Bottom tab navigation (5 tabs)
- Card-based layouts with shadows
- Modal wizard (5 steps)
- Toast notifications

## 📊 Data Flow

### Evening Planning Flow
```
User Opens Wizard
    ↓
Step 1: Set wake target
    ↓
Step 2: Add appointments
    ↓
Step 3: Select nap caregivers
    ↓
Step 4: Review constraints
    ↓
Step 5: Brain dump tasks
    ↓
Save to day_plans table (tomorrow's date)
    ↓
Tasks added to tasks table
```

### Today Tracking Flow
```
Load day_plan for today
    ↓
User sets actual wake time
    ↓
User toggles naps on/off
    ↓
User starts/stops nap timers
    ↓
Schedule regenerates in real-time
    ↓
All changes saved to day_logs
    ↓
User exports to Google Calendar
    ↓
Events created via OAuth backend
```

## 🔑 Key Features

### 1. Password Gate
- Single shared password (`JuneR0cks!`)
- Client-side validation
- No individual accounts needed
- All data shared across devices

### 2. Evening Wizard
- 5-step modal interface
- Plan tomorrow before bed
- Add appointments
- Assign nap caregivers (Kayden excluded from baby naps)
- Quick task brain dump

### 3. Dynamic Today View
- Calendar-style timeline
- Regenerates on every change
- Actual wake time input
- Nap toggle switches
- Start/Stop nap timers
- Real-time schedule updates

### 4. Task Manager
- **Brain Dump**: Unassigned tasks
- **Today's Focus**: Tasks for today
- **Completed**: Done tasks
- Simple checkbox interface
- Delete functionality

### 5. History
- View past day logs
- See actual wake times
- Review schedule history

### 6. Google Calendar Export
- OAuth 2.0 + PKCE flow
- Exports scheduled blocks (excludes "open time")
- Idempotent (updates existing events)
- Serverless backend handles tokens

## 🔒 Security Model

### Public (Safe to Expose)
- Supabase anon key
- Supabase project URL
- Serverless function endpoint
- Frontend code

### Private (Environment Variables)
- Google Client Secret
- Encryption keys
- Refresh tokens (encrypted in KV storage)

### Access Control
- Row Level Security (RLS) policies
- All data scoped to `space_id = 'default'`
- Anonymous access allowed
- No user authentication

## 📱 Progressive Web App

### Features
- Installable on mobile/desktop
- Offline support via service worker
- App-like experience
- Safe area insets for notched devices
- Bottom nav with extra padding

### Caching Strategy
- Cache static assets on install
- Network-first for API calls
- Fallback to cache if offline

## 🚀 Deployment Strategy

1. **Database**: Supabase (managed PostgreSQL)
2. **OAuth Backend**: Serverless function (stateless)
3. **Frontend**: GitHub Pages (free static hosting)
4. **DNS**: GitHub subdomain (username.github.io)

### Why This Stack?
- ✅ **Free hosting** (GitHub Pages + Supabase free tier)
- ✅ **No server management** (serverless + managed DB)
- ✅ **Global CDN** (GitHub Pages)
- ✅ **Automatic HTTPS** (GitHub provides SSL)
- ✅ **Easy updates** (git push = deploy)

## 📝 Critical Constraints

### Hard Requirements
- Kayden MUST NEVER be assigned baby naps
- All data shared (no per-user data)
- Password is client-side only
- Export only scheduled blocks (not open time)
- Use Google Calendar API (not ICS export)

### Technical Requirements
- No localStorage/sessionStorage in artifacts
- Relative paths for GitHub Pages
- CORS handling for API calls
- Error handling with toasts
- Null checks everywhere
- Try/catch around Supabase calls

## 🎓 Learning Points

### For Users
- Evening planning reduces morning chaos
- Dynamic schedules adapt to reality
- Shared visibility keeps everyone aligned
- Google Calendar integration connects to existing tools

### For Developers
- Building PWAs with vanilla JS
- OAuth 2.0 + PKCE flow
- Supabase RLS policies
- Serverless architecture
- Static site deployment

## 📦 Deliverables

1. **index.html** - Main app interface
2. **styles.css** - Warm, family-friendly design
3. **app.js** - Complete application logic
4. **manifest.json** - PWA configuration
5. **service-worker.js** - Offline support
6. **supabase.sql** - Database schema with RLS
7. **serverless/** - OAuth backend (2 implementations)
8. **Documentation**:
   - QUICKSTART.md (30-min setup)
   - SETUP.md (detailed guide)
   - CONFIG_TEMPLATE.md (fill-in help)
   - DEPLOYMENT_CHECKLIST.md (verification)
   - README.md (overview)

## 🎯 Success Criteria

- [ ] App loads and password gate works
- [ ] Can plan tomorrow via wizard
- [ ] Today schedule regenerates dynamically
- [ ] Tasks can be added/completed/deleted
- [ ] History shows past logs
- [ ] Google Calendar connects successfully
- [ ] Export creates events in calendar
- [ ] Works offline after first load
- [ ] Mobile-friendly (bottom nav, safe areas)
- [ ] No console errors
- [ ] All family members can access

## 🔄 Future Enhancements (Not Included)

Potential improvements for later:
- Multiple households/spaces
- User accounts with Supabase Auth
- Recurring appointments
- Meal planning integration
- Shopping list sync
- Weather integration
- Push notifications
- Weekly/monthly views

---

**This project demonstrates**: Modern web development, serverless architecture, OAuth implementation, real-time data sync, and user-centered design for family productivity.
