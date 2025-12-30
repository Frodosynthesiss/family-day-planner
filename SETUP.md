# Family Day Planner — Setup Guide

This is a **mobile-friendly PWA (“family intranet”)** that runs as a static GitHub Pages site and syncs across devices using Supabase.

Important: This version has **no individual sign-ins**. Access is via a single shared **password gate** in the UI.

- Password: **JuneR0cks!**
- Data is shared across devices in one shared space (`space_id = "default"`).

## What you get
- Bottom tabs: Evening / Today / Tasks / History / Settings
- Evening wizard (modal stepper) to plan tomorrow
- Today schedule that regenerates when you log wake/nap actuals
- Nap tracking with **Start/Stop** buttons
- Persistent master Tasks + daily focus list
- History of day logs
- Settings that control forecasting
- Google Calendar export (writes scheduled blocks only) via an Apps Script Web App

---

## 1) Supabase setup

### A) Create the project
1. Create a new Supabase project.
2. In your Supabase project settings, copy:
   - Project URL
   - Publishable (anon) key

### B) Create tables + RLS policies
1. Supabase → **SQL Editor**
2. Paste `supabase.sql`
3. Run it

This creates:
- `settings`, `tasks`, `day_plans`, `day_logs`
- RLS policies that allow **anon** and **authenticated** roles to read/write **only** `space_id = 'default'`.

### Security note (important)
The password gate is client-side. If you post the site publicly, people could still discover your Supabase endpoint and interact with it.

If you need “real” security, you must use authentication and server-side authorization (not possible with a purely static site without some backend component).

---

## 2) Google Calendar export (Apps Script Web App)

### A) Create the destination calendar
1. In Google Calendar, create a new calendar (e.g., **Family Day Planner (Auto)**).
2. Copy the **Calendar ID** (Calendar settings → Integrate calendar).

### B) Create the Apps Script Web App
1. Google Drive → New → **Google Apps Script**
2. Replace the default code with:

```javascript
// Family Day Planner export endpoint
const SHARED_API_KEY = "REPLACE_WITH_SHARED_KEY";

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : "{}");
    if ((body.apiKey || "") !== SHARED_API_KEY) throw new Error("Unauthorized");

    const calendarId = body.calendarId;
    const dateISO = body.date;
    const blocks = body.blocks || [];
    if (!calendarId) throw new Error("Missing calendarId");
    if (!dateISO) throw new Error("Missing date");

    const cal = CalendarApp.getCalendarById(calendarId);
    if (!cal) throw new Error("Calendar not found");

    // Delete existing events for that date, then write fresh
    const start = new Date(dateISO + "T00:00:00");
    const end = new Date(dateISO + "T23:59:59");
    cal.getEvents(start, end).forEach(ev => ev.deleteEvent());

    blocks.forEach(b => {
      const s = new Date(dateISO + "T" + b.start + ":00");
      const en = new Date(dateISO + "T" + b.end + ":00");
      const title = b.title + (b.assignee ? (" — " + b.assignee) : "");
      cal.createEvent(title, s, en, { description: "Created by Family Day Planner" });
    });

    return ContentService.createTextOutput(JSON.stringify({ ok:true, count:blocks.length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok:false, error:String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

### C) Deploy
1. **Deploy → New deployment**
2. Type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Copy the **Web app URL**

### D) Paste into Settings
In the app: Settings → paste:
- Apps Script Web App URL
- Calendar ID
- Shared API key

---

## 3) Run locally

Because this is a PWA with a service worker, run via a local server (don’t double-click `index.html`).

### Option A: VS Code Live Server
- Right click `index.html` → **Open with Live Server**

### Option B: Python
```bash
cd family-day-planner
python -m http.server 8080
```
Open: `http://localhost:8080`

---

## 4) Deploy to GitHub Pages

1. Create a repo (e.g., `family-day-planner`)
2. Upload all files from this folder to the repo root
3. Repo Settings → **Pages**
   - Deploy from branch → `main` / root

---

## 5) If buttons don’t work after an update (service worker cache)

PWAs aggressively cache files. After you update code:
- Do a **hard refresh** (Ctrl+Shift+R)
- Or in Chrome DevTools → Application → Service Workers → **Unregister**
- Also clear Storage → **Clear site data**
