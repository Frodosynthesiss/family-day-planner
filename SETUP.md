# Family Day Planner — Setup Guide (beginner friendly)

This is a **private**, mobile-friendly PWA (“family intranet”) that runs as a static GitHub Pages site and syncs across devices using Supabase.

## What you get
- Bottom tabs: Evening / Today / Tasks / History / Settings
- **Evening wizard** (modal stepper) that autosaves and saves tomorrow’s plan
- **Today** timeline that regenerates when you log wake/nap actuals
- Persistent master **Tasks**
- **History** of day logs
- **Settings** that control forecasting
- **Google Calendar export** (writes scheduled blocks only) via an Apps Script Web App (no reading calendar)
- **One shared password gate**: anyone with the link + password can use the app (**no individual sign-ins**)

> Password is currently hard-coded in `app.js` as: `JuneR0cks!`

---

## 1) Supabase setup (shared space)

### A) Create the project
1. Create a new Supabase project.
2. In your project settings, copy:
   - **Project URL**
   - **Publishable anon key** (Supabase calls this “anon” / “publishable”)

3. Update `app.js` at the top:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`

### B) Create tables + RLS
1. Supabase → **SQL Editor**
2. Paste `supabase.sql`
3. Run it

This creates:
- `spaces`, `settings`, `tasks`, `day_plans`, `day_logs`

**Important security note:** this version allows anonymous read/write at the database level, and relies on the **password gate in the UI** plus an unlisted URL. If you want stronger security, you’d add authenticated access or a server-side proxy later.

### C) Shared space id
The app stores everything under a namespace called `SPACE_ID` (in `app.js`).
- Default: `family_shared_v1`
- If you change it, update **both**:
  - `SPACE_ID` in `app.js`
  - the `insert into public.spaces(id) ...` line in `supabase.sql`

---

## 2) Run locally

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

## 3) Deploy to GitHub Pages

1. Create a repo (e.g., `family-day-planner`)
2. Upload all files from this folder to the repo root
3. Repo Settings → **Pages**
   - Deploy from branch → `main` / root
4. When published, open your GitHub Pages URL and enter the shared password.

---

## 4) Google Calendar export (Apps Script Web App)

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

    // Simple approach: delete existing events for that date, then write fresh
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

## 5) Test checklist (key flows)

### Wizard save/edit
- Evening → Prepare for the Day Ahead
- Step 1: check a box → close/open → still saved
- Step 2: add 3 lines → Convert → tasks appear in Tasks
- Step 3: pick focus tasks → Save → tasks assigned to the plan date
- Step 4: add availability + appointments → Step 5 preview shows changes
- Save → Evening shows tomorrow timeline
- Quick edit → adjust blocks/appointments without redoing everything

### Today regeneration (timers)
- Today → set wake time → timeline changes
- Enable Nap 1 tracking → press **Start** (sets start time) → timeline shifts immediately
- Press **Stop** (sets end time) → timeline updates again
- Same for Nap 2
- Edit plan (quick edit) → timeline updates immediately

### Kayden nap exclusion (critical)
- Make both parents unavailable during a nap window
- Add Kayden available block covering the nap
- Confirm nap is **NOT** assigned to Kayden
- Confirm nap is assigned to **Nanny** only if nanny working covers the entire nap window
- Otherwise nap shows **Uncovered**

### Export
- Settings: add Apps Script URL + Calendar ID + key
- Click Export
- Verify events created in your dedicated calendar
