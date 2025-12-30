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

---

## 1) Supabase setup

### A) Create the project
1. Create a new Supabase project.
2. Confirm your project matches `app.js`:
   - URL: `https://qsnmuojajbtyxdvijwon.supabase.co`
   - Publishable key: `sb_publishable_9AFfe1UiuDpQs8FpRUWCvw_wmzFKTMm`

> Important: The browser uses **publishable** key only. Never put a service role key client-side.

### B) Create tables + RLS
1. Supabase → **SQL Editor**
2. Paste `supabase.sql`
3. Run it

This creates:
- `households`, `household_members`, `settings`, `tasks`, `day_plans`, `day_logs`
- RLS policies + RPC function `join_household(join_code)`

### C) Enable email/password auth
1. Supabase → **Authentication → Providers**
2. Enable **Email**
3. After you deploy to GitHub Pages, set:
   - **Authentication → URL Configuration → Site URL** to your GitHub Pages URL
   - Add the same URL to **Redirect URLs**

---

## 2) First login + household
1. Run the app locally (Step 4).
2. Create an account → sign in.
3. In “Household setup”:
   - Click **Create household** (first person)
4. Go to **Settings** and copy the **Join code**
5. Other users create accounts and join with that code.

All data is scoped by household membership (RLS enforces this).

---

## 3) Google Calendar export (Apps Script Web App)

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

**Placeholders you must create/paste:**
- Apps Script Web App URL
- Calendar ID
- Shared API key

---

## 4) Run locally

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

## 5) Deploy to GitHub Pages

1. Create a repo (e.g., `family-day-planner`)
2. Upload all files from this folder to the repo root
3. Repo Settings → **Pages**
   - Deploy from branch → `main` / root
4. When published, copy your GitHub Pages URL
5. Supabase → Auth → URL Configuration:
   - Set Site URL + Redirect URLs to your GitHub Pages URL

---

## 6) Test checklist (key flows)

### Wizard save/edit
- Evening → Prepare for the Day Ahead
- Step 1: check a box → close/open → still saved
- Step 2: add 3 lines → Convert → tasks appear in Tasks
- Step 3: pick focus tasks → Save → tasks assigned to the plan date
- Step 4: add availability + appointments → Step 5 preview shows changes
- Save → Evening shows tomorrow timeline
- Quick edit → adjust blocks/appointments without redoing everything

### Today regeneration
- Today → set wake time → timeline changes
- Enable Nap 1 tracking and set start/end → timeline changes
- Enable Nap 2 tracking and set start/end → timeline changes
- Edit plan (quick edit) → timeline updates immediately

### Kayden nap exclusion (critical)
- Make both parents unavailable during a nap window
- Add Kayden available block covering the nap
- Confirm nap is **NOT** assigned to Kayden
- Confirm nap is assigned to **Nanny** only if nanny working covers the entire nap window
- Otherwise nap shows **Uncovered**

### Bath overdue logic
- In tomorrow’s plan, set `bath.lastBathISO` to 3+ days ago (you can do it by editing the plan in Supabase table `day_plans.data`)
- Preview should warn Bath overdue and (if possible) schedule a Bath after dinner **only if Julio is available**

### Export
- Settings: add Apps Script URL + Calendar ID + key
- Click Export
- Verify events created in your dedicated calendar


## Patch 6 note: Single Household Mode + Debug panel

This build is locked to one household:
- Household ID: `c69f39a8-aeee-428f-a26d-18a3ac28f97b` (VegaPayne Household)

### Required DB constraint (for upsert)
Make sure `household_members` has a unique constraint on `(household_id, user_id)` so upsert works:

```sql
alter table public.household_members
  add constraint household_members_household_user_key unique (household_id, user_id);
```

### Required RLS policies (minimum)
```sql
drop policy if exists household_members_select on public.household_members;
create policy household_members_select
on public.household_members
for select using (user_id = auth.uid());

drop policy if exists household_members_insert_self on public.household_members;
create policy household_members_insert_self
on public.household_members
for insert with check (user_id = auth.uid());
```

Open Settings → Debug to confirm build + auth + household status.
