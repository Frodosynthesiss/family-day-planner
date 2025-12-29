// Family Day Planner (PWA + Supabase sync)
// Designed for simple, low-friction family use (Kristyn, Julio, nanny, Kayden).
// GitHub Pages friendly (relative paths). No top-level await. No use-before-init.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const LS = {
  config: "fdp.config.v1",
  localCache: "fdp.localCache.v1",
  lastView: "fdp.lastView.v1",
};

const DEFAULTS = {
  expectedWake: "06:30",
  defaultNapMinutes: 75,
  napRoutineMinutes: 15,
  bathEveryDays: 3,
  timezoneHint: "America/Los_Angeles",
};

let supabase = null; // created after reading config
let authSession = null;

const state = {
  online: navigator.onLine,
  route: "#today",
  me: { email: null },
  householdId: null,

  // Cached data (from Supabase or local fallback)
  tasks: [],
  plansByDate: {}, // { "YYYY-MM-DD": planObj }
  logsByDate: {},  // { "YYYY-MM-DD": logObj }

  // UI
  toastTimer: null,

  // Quiz
  quiz: {
    open: false,
    step: 0,
    tomorrow: null, // YYYY-MM-DD
    draft: null,
  },
};

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function nowLocal() {
  // Local device time; keep scheduling simple and human.
  return new Date();
}
function pad2(n) { return String(n).padStart(2, "0"); }
function toISODate(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}
function addDays(isoDate, days) {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
function parseTimeToMinutes(hhmm) {
  if (!hhmm || !/^\d\d:\d\d$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHHMM(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function uid() { return crypto.randomUUID(); }

function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(LS.config);
    const cfg = raw ? JSON.parse(raw) : {};
    return {
      supabaseUrl: cfg.supabaseUrl || "",
      supabaseAnonKey: cfg.supabaseAnonKey || "",
      householdId: cfg.householdId || "",
      expectedWake: cfg.expectedWake || DEFAULTS.expectedWake,
      defaultNapMinutes: Number.isFinite(cfg.defaultNapMinutes) ? cfg.defaultNapMinutes : DEFAULTS.defaultNapMinutes,
    };
  } catch {
    return {
      supabaseUrl: "",
      supabaseAnonKey: "",
      householdId: "",
      expectedWake: DEFAULTS.expectedWake,
      defaultNapMinutes: DEFAULTS.defaultNapMinutes,
    };
  }
}
function saveConfig(partial) {
  const cur = loadConfig();
  const next = { ...cur, ...partial };
  localStorage.setItem(LS.config, JSON.stringify(next));
  return next;
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(LS.localCache);
    return raw ? JSON.parse(raw) : { tasks: [], plansByDate: {}, logsByDate: {} };
  } catch {
    return { tasks: [], plansByDate: {}, logsByDate: {} };
  }
}
function saveLocalCache() {
  const payload = { tasks: state.tasks, plansByDate: state.plansByDate, logsByDate: state.logsByDate };
  localStorage.setItem(LS.localCache, JSON.stringify(payload));
}

function setActiveTab(route) {
  ["evening","today","tasks","history","settings"].forEach(k => {
    const t = $(`#tab-${k}`);
    if (!t) return;
    t.classList.toggle("active", `#${k}` === route);
  });
}

function setAuthPill() {
  const dot = $("#authDot");
  const text = $("#authText");
  if (!state.online) {
    dot.textContent = "Offline";
    dot.className = "badge warn";
    text.textContent = "Offline mode (showing cached data)";
    return;
  }
  if (!supabase) {
    dot.textContent = "Setup";
    dot.className = "badge warn";
    text.textContent = "Add Supabase settings to sync";
    return;
  }
  if (!authSession) {
    dot.textContent = "Signed out";
    dot.className = "badge warn";
    text.textContent = "Sign in to sync across devices";
    return;
  }
  dot.textContent = "Synced";
  dot.className = "badge good";
  text.textContent = state.me.email ? state.me.email : "Signed in";
}

function listenConnectivity() {
  window.addEventListener("online", () => {
    state.online = true;
    setAuthPill();
    showToast("Back online.");
    // Try a gentle refresh
    refreshAll().catch(()=>{});
  });
  window.addEventListener("offline", () => {
    state.online = false;
    setAuthPill();
    showToast("You're offline. We'll show cached info.");
  });
}


/* ---------------------------
   Google Calendar export (ICS)
   - We do NOT read Google Calendar.
   - We generate an .ics file containing only scheduled blocks (no open time).
---------------------------- */
function icsEscape(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function yyyymmdd(isoDate) {
  return isoDate.replaceAll("-", "");
}
function toICSDateTimeLocal(isoDate, hhmm) {
  // Returns YYYYMMDDTHHMM00 in local clock time (TZID provided in DTSTART/DTEND)
  const [h, m] = hhmm.split(":").map(Number);
  return `${yyyymmdd(isoDate)}T${String(h).padStart(2,"0")}${String(m).padStart(2,"0")}00`;
}
function utcStamp() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth()+1).padStart(2,"0");
  const da = String(d.getUTCDate()).padStart(2,"0");
  const h = String(d.getUTCHours()).padStart(2,"0");
  const mi = String(d.getUTCMinutes()).padStart(2,"0");
  const s = String(d.getUTCSeconds()).padStart(2,"0");
  return `${y}${mo}${da}T${h}${mi}${s}Z`;
}
function vtimezoneAmericaLosAngeles() {
  // Minimal VTIMEZONE that works well for Google Calendar imports.
  // (We keep it stable and small; it covers typical US DST rules.)
  return [
    "BEGIN:VTIMEZONE",
    "TZID:America/Los_Angeles",
    "X-LIC-LOCATION:America/Los_Angeles",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
}
function blockToVEVENT({ isoDate, block, householdId }) {
  const start = minutesToHHMM(block.startMin);
  const end = minutesToHHMM(block.endMin);

  const tzid = DEFAULTS.timezoneHint;
  const dtStart = toICSDateTimeLocal(isoDate, start);
  const dtEnd = toICSDateTimeLocal(isoDate, end);

  const who = (block.meta?.kind === "nap") ? (block.meta?.caregiver?.who || "") : "";
  const descParts = [];
  if (block.meta?.kind === "nap" && who) descParts.push(`Caregiver: ${who}`);
  if (block.meta?.kind === "bedtime" && block.meta?.bedtimeBy) descParts.push(`Bedtime by: ${block.meta.bedtimeBy}`);
  if (block.meta?.kind === "bath") descParts.push("Bath due (rule: at least every 3 days)");
  if (block.meta?.kind === "appointment") descParts.push("Appointment");

  const description = descParts.length ? descParts.join("\\n") : "";

  // Deterministic-ish UID to reduce duplicates if you export/import multiple times
  const uid = `${householdId || "household"}-${isoDate}-${block.meta?.kind || "block"}-${block.startMin}-${block.endMin}@familydayplanner`;

  return [
    "BEGIN:VEVENT",
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${utcStamp()}`,
    `DTSTART;TZID=${tzid}:${dtStart}`,
    `DTEND;TZID=${tzid}:${dtEnd}`,
    `SUMMARY:${icsEscape(block.title)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}
function buildICSForDay({ isoDate, blocks, calendarName, householdId }) {
  const lines = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Family Day Planner//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(`X-WR-CALNAME:${icsEscape(calendarName || "Family Day Planner")}`);
  lines.push(`X-WR-TIMEZONE:${DEFAULTS.timezoneHint}`);
  lines.push(vtimezoneAmericaLosAngeles());
  (blocks || []).forEach(b => {
    lines.push(blockToVEVENT({ isoDate, block: b, householdId }));
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function downloadTextFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function exportScheduleToGoogleCalendarICS(isoDate, scheduleBlocks) {
  const hid = state.householdId || loadConfig().householdId || "";
  const ics = buildICSForDay({
    isoDate,
    blocks: scheduleBlocks,
    calendarName: "Family Day Planner",
    householdId: hid,
  });
  downloadTextFile(`fdp-${isoDate}.ics`, ics, "text/calendar;charset=utf-8");
  showToast("Downloaded calendar file (.ics). Open it to add to Google Calendar.");
}

/* ---------------------------
   Supabase wiring + sync
---------------------------- */
async function initSupabaseFromConfig() {
  const cfg = loadConfig();
  state.householdId = cfg.householdId || null;

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    supabase = null;
    authSession = null;
    setAuthPill();
    return;
  }
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const { data: { session } } = await supabase.auth.getSession();
  authSession = session;
  await ensureProfileRow();
  state.me.email = session?.user?.email ?? null;

  // Observe auth changes
  supabase.auth.onAuthStateChange((_evt, session2) => {
    authSession = session2;
    state.me.email = session2?.user?.email ?? null;
    setAuthPill();
    ensureProfileRow().catch(()=>{});
    refreshAll().catch(()=>{});
  });

  setAuthPill();
}


/* ---------------------------
   Google Calendar "dynamic sync" (via Google Apps Script web app)
   Why: GitHub Pages cannot safely store Google OAuth secrets.
   Approach: a tiny Google Apps Script endpoint writes events to the chosen calendar.
   Security: use a shared API key + restrict calendar permissions.
---------------------------- */
async function syncScheduleToGoogleCalendar({ isoDate, scheduleBlocks }) {
  const cfg = loadConfig();
  const url = (cfg.gcalWebhookUrl || "").trim();
  const apiKey = (cfg.gcalApiKey || "").trim();
  const calendarId = (cfg.gcalCalendarId || "").trim();

  if (!url || !apiKey || !calendarId) {
    showToast("Add Google Calendar Sync settings first (Settings → Google Calendar Sync).");
    return;
  }

  const hid = state.householdId || cfg.householdId || "";
  const payload = {
    apiKey,
    action: "syncDay",
    householdId: hid,
    calendarId,
    date: isoDate,
    blocks: (scheduleBlocks || []).map(b => ({
      title: b.title,
      startMin: b.startMin,
      endMin: b.endMin,
      meta: b.meta || {}
    })),
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Sync failed: ${resp.status} ${resp.statusText} ${t}`);
    }
    const data = await resp.json().catch(() => ({}));
    if (data && data.ok) {
      showToast("Synced to Google Calendar ✅");
    } else {
      showToast("Sync request sent. (If you don’t see events, check Apps Script deployment + calendar permissions.)");
    }
  } catch (e) {
    console.error(e);
    showToast("Couldn’t sync to Google Calendar. Check Settings + Apps Script deployment.");
  }
}


async function sbUpsert(table, row, onConflict) {
  if (!supabase || !authSession) throw new Error("Not signed in");
  const q = supabase.from(table).upsert(row, { onConflict, ignoreDuplicates: false }).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
async function sbSelect(table, filters = {}, orderBy = null, limit = null) {
  if (!supabase || !authSession) throw new Error("Not signed in");
  let q = supabase.from(table).select("*");
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  if (orderBy) q = q.order(orderBy.key, { ascending: !!orderBy.asc });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}


async function ensureProfileRow() {
  // Creates/updates the profile row so RLS can scope household data.
  // Runs after sign-in and also on refresh (safe no-op if already exists).
  const cfg = loadConfig();
  const hid = (cfg.householdId || "").trim();
  if (!supabase || !authSession || !hid) return;

  try {
    const userId = authSession.user.id;
    const { error } = await supabase.from("profiles").upsert({ id: userId, household_id: hid });
    if (error) throw error;
  } catch (e) {
    console.warn("ensureProfileRow failed:", e);
  }
}

async function refreshAll() {
  // Always load local first (instant UI), then Supabase if possible.
  const local = loadLocalCache();
  state.tasks = local.tasks || [];
  state.plansByDate = local.plansByDate || {};
  state.logsByDate = local.logsByDate || {};
  render();

  if (!state.online || !supabase || !authSession || !state.householdId) {
    setAuthPill();
    return;
  }

  try {
    const hid = state.householdId;

    // Pull tasks
    const tasks = await sbSelect("tasks", { household_id: hid }, { key: "created_at", asc: false }, 500);
    // Pull last ~90 days of plans/logs
    const today = toISODate(nowLocal());
    const minDate = addDays(today, -120);

    let plansQ = supabase.from("day_plans").select("*").eq("household_id", hid).gte("date", minDate);
    let logsQ  = supabase.from("day_logs").select("*").eq("household_id", hid).gte("date", minDate);

    const [{ data: plans, error: pErr }, { data: logs, error: lErr }] = await Promise.all([plansQ, logsQ]);
    if (pErr) throw pErr;
    if (lErr) throw lErr;

    state.tasks = (tasks || []).map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      completedAt: t.completed_at,
      assignedDate: t.assigned_date,
      createdAt: t.created_at,
    }));

    state.plansByDate = {};
    (plans || []).forEach(r => { state.plansByDate[r.date] = r.data; });

    state.logsByDate = {};
    (logs || []).forEach(r => { state.logsByDate[r.date] = r.data; });

    saveLocalCache();
    setAuthPill();
    render();
  } catch (e) {
    console.warn(e);
    showToast("Couldn’t refresh from sync — showing cached data.");
  }
}

async function ensureSignedIn(email, password) {
  if (!supabase) throw new Error("Supabase not configured yet");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  authSession = data.session;
  await ensureProfileRow();
  state.me.email = data.session?.user?.email ?? null;
  setAuthPill();
}

async function signUp(email, password) {
  if (!supabase) throw new Error("Supabase not configured yet");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  // Note: depending on Supabase auth settings, email confirmation may be required.
  authSession = data.session ?? null;
  await ensureProfileRow();
  state.me.email = data.user?.email ?? null;
  setAuthPill();
}

async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  authSession = null;
  state.me.email = null;
  setAuthPill();
}

/* ---------------------------
   Scheduling model
---------------------------- */
// We keep routine items as real, purposeful blocks only (no filler).
// Times are minutes since midnight.

function normalizeBlocks(blocks) {
  // blocks: [{start:"HH:MM", end:"HH:MM"}]
  const out = [];
  (blocks || []).forEach(b => {
    const s = parseTimeToMinutes(b.start);
    const e = parseTimeToMinutes(b.end);
    if (s == null || e == null) return;
    if (e <= s) return;
    out.push({ startMin: s, endMin: e });
  });
  // merge overlaps
  out.sort((a,b)=>a.startMin-b.startMin);
  const merged = [];
  for (const b of out) {
    const last = merged[merged.length-1];
    if (!last || b.startMin > last.endMin) merged.push({ ...b });
    else last.endMin = Math.max(last.endMin, b.endMin);
  }
  return merged;
}

function intervalFullyCovered(availabilityBlocks, startMin, endMin) {
  // availabilityBlocks: merged intervals that represent AVAILABLE time
  // return true if union covers [startMin, endMin]
  let cursor = startMin;
  for (const b of availabilityBlocks) {
    if (b.endMin <= cursor) continue;
    if (b.startMin > cursor) return false;
    cursor = Math.max(cursor, b.endMin);
    if (cursor >= endMin) return true;
  }
  return cursor >= endMin;
}

function invertToAvailability(unavailBlocks) {
  // given merged UNAVAILABLE blocks, return AVAILABLE blocks for whole day [0,1440)
  const un = normalizeBlocks(unavailBlocks);
  const avail = [];
  let cursor = 0;
  for (const b of un) {
    if (b.startMin > cursor) avail.push({ startMin: cursor, endMin: b.startMin });
    cursor = Math.max(cursor, b.endMin);
  }
  if (cursor < 1440) avail.push({ startMin: cursor, endMin: 1440 });
  return avail;
}

function withinWorkingBlocks(workingBlocks) {
  // workingBlocks are AVAILABLE; normalize directly
  return normalizeBlocks(workingBlocks);
}

function pickNapCaregiver(plan, napStartMin, napEndMin) {
  const kUn = invertToAvailability(plan.kristynUnavail || []);
  const jUn = invertToAvailability(plan.julioUnavail || []);
  const nannyAvail = (plan.nannyWorking === true) ? withinWorkingBlocks(plan.nannyBlocks || []) : [];
  const kaydenAvail = withinWorkingBlocks(plan.kaydenBlocks || []);

  const kristynCovers = intervalFullyCovered(kUn, napStartMin, napEndMin);
  const julioCovers   = intervalFullyCovered(jUn, napStartMin, napEndMin);

  if (kristynCovers && julioCovers) return { who: "Kristyn or Julio", status: "ok" };
  if (kristynCovers) return { who: "Kristyn", status: "ok" };
  if (julioCovers) return { who: "Julio", status: "ok" };

  // only if no parent can cover the whole nap:
  const kaydenCovers = intervalFullyCovered(kaydenAvail, napStartMin, napEndMin);
  if (kaydenCovers) return { who: "Kayden", status: "ok" };

  const nannyCovers = intervalFullyCovered(nannyAvail, napStartMin, napEndMin);
  if (nannyCovers) return { who: "Nanny", status: "ok" };

  return { who: "Uncovered", status: "bad" };
}

function buildSchedule({ isoDate, plan, log, mode }) {
  // mode: "forecast" or "today"
  // plan: tomorrow plan (availability, appointments, bedtimeParent)
  // log: actuals for today (wake/nap1/nap2); can be partial
  const cfg = loadConfig();
  const expectedWakeMin = parseTimeToMinutes(cfg.expectedWake) ?? 390;
  const wakeMin = (() => {
    if (mode === "today") {
      const w = log?.wakeTime ? parseTimeToMinutes(log.wakeTime) : null;
      return (w != null) ? w : expectedWakeMin;
    }
    return expectedWakeMin;
  })();

  const defaultNap = clamp(Number(cfg.defaultNapMinutes) || DEFAULTS.defaultNapMinutes, 40, 90);

  // Use default midpoints for wake windows (in minutes).
  const ww1 = 195; // 3h15
  const ww2 = 225; // 3h45
  const ww3 = 248; // 4h08

  // Nap 1 start/end
  const nap1StartMin = (() => {
    if (mode === "today" && log?.nap1Start) {
      const t = parseTimeToMinutes(log.nap1Start);
      if (t != null) return t;
    }
    return wakeMin + ww1;
  })();

  const nap1EndMin = (() => {
    if (mode === "today") {
      const end = log?.nap1End ? parseTimeToMinutes(log.nap1End) : null;
      if (end != null) return end;
      // if started but not ended, forecast end:
      const s = log?.nap1Start ? parseTimeToMinutes(log.nap1Start) : null;
      if (s != null) return s + defaultNap;
    }
    return nap1StartMin + defaultNap;
  })();

  const nap2StartMin = (() => {
    if (mode === "today" && log?.nap2Start) {
      const t = parseTimeToMinutes(log.nap2Start);
      if (t != null) return t;
    }
    return nap1EndMin + ww2;
  })();

  const nap2EndMin = (() => {
    if (mode === "today") {
      const end = log?.nap2End ? parseTimeToMinutes(log.nap2End) : null;
      if (end != null) return end;
      const s = log?.nap2Start ? parseTimeToMinutes(log.nap2Start) : null;
      if (s != null) return s + defaultNap;
    }
    return nap2StartMin + defaultNap;
  })();

  const bedtimeAsleepMin = nap2EndMin + ww3; // target asleep time
  const bedtimeRoutineMin = 20;
  const bedtimeStartMin = bedtimeAsleepMin - bedtimeRoutineMin;

  // Routine blocks (durations in minutes)
  const morningBlocks = [
    { title: "Family cuddle", dur: 15 },
    { title: "Get dressed", dur: 10 },
    { title: "Prep + eat breakfast", dur: 35 },
    { title: "Brush teeth", dur: 5 },
  ];

  const blocks = [];

  // Helper for adding blocks
  function addBlock(title, startMin, endMin, meta = {}) {
    blocks.push({ id: uid(), title, startMin, endMin, meta });
  }

  // Morning routine right after wake
  let cursor = wakeMin;
  for (const b of morningBlocks) {
    addBlock(b.title, cursor, cursor + b.dur, { kind: "routine" });
    cursor += b.dur;
  }

  // Nap 1 routine + nap
  addBlock("Nap routine (before Nap 1)", nap1StartMin - DEFAULTS.napRoutineMinutes, nap1StartMin, { kind: "napRoutine" });
  {
    const caregiver = pickNapCaregiver(plan || {}, nap1StartMin, nap1EndMin);
    addBlock("Nap 1", nap1StartMin, nap1EndMin, { kind: "nap", caregiver });
  }

  // Lunch + snack in the midday open window
  const lunchStart = clamp(nap1EndMin + 30, wakeMin + 240, nap2StartMin - 60);
  addBlock("Prep + eat lunch", lunchStart, lunchStart + 35, { kind: "meal" });
  addBlock("Snack + milk", lunchStart + 60, lunchStart + 70, { kind: "meal" });

  // Nap 2 routine + nap
  addBlock("Nap routine (before Nap 2)", nap2StartMin - DEFAULTS.napRoutineMinutes, nap2StartMin, { kind: "napRoutine" });
  {
    const caregiver = pickNapCaregiver(plan || {}, nap2StartMin, nap2EndMin);
    addBlock("Nap 2", nap2StartMin, nap2EndMin, { kind: "nap", caregiver });
  }

  // Dinner and evening routine
  const dinnerStart = clamp(bedtimeStartMin - 95, nap2EndMin + 60, bedtimeStartMin - 70);
  addBlock("Prep + eat dinner", dinnerStart, dinnerStart + 45, { kind: "meal" });

  // Bath due?
  const bathDue = isBathDue();
  if (bathDue) {
    addBlock("Bath (due today)", dinnerStart + 55, dinnerStart + 75, { kind: "bath", rule: "every3days" });
  }

  addBlock("Snack + milk", bedtimeStartMin - 35, bedtimeStartMin - 25, { kind: "meal" });
  addBlock("Brush teeth", bedtimeStartMin - 20, bedtimeStartMin - 15, { kind: "routine" });

  // Bedtime routine with assigned parent (plan)
  const bedtimeBy = (plan?.bedtimeBy === "Julio") ? "Julio" : "Kristyn";
  addBlock(`Bedtime routine (${bedtimeBy})`, bedtimeStartMin, bedtimeAsleepMin, { kind: "bedtime", bedtimeBy });

  // Appointments (scheduling only if overlap with existing blocks)
  const appts = (plan?.appointments || []).map(a => ({
    id: a.id || uid(),
    title: a.title || "Appointment",
    startMin: parseTimeToMinutes(a.start) ?? null,
    endMin: parseTimeToMinutes(a.end) ?? null
  })).filter(a => a.startMin != null && a.endMin != null && a.endMin > a.startMin);

  // Mark overlaps; do not force reschedule unless it overlaps naps
  for (const ap of appts) {
    addBlock(`📅 ${ap.title}`, ap.startMin, ap.endMin, { kind: "appointment" });

    // If appointment overlaps Nap blocks, shift nap slightly if possible, else flag.
    for (const b of blocks.filter(x => x.meta?.kind === "nap")) {
      const overlap = !(ap.endMin <= b.startMin || ap.startMin >= b.endMin);
      if (!overlap) continue;

      const duration = b.endMin - b.startMin;
      // try shift earlier up to 30 minutes
      let shifted = false;
      const tryEarlierStart = b.startMin - 20;
      if (tryEarlierStart >= wakeMin && (tryEarlierStart + duration) <= ap.startMin) {
        b.startMin = tryEarlierStart;
        b.endMin = b.startMin + duration;
        b.meta.adjustedForAppt = true;
        shifted = true;
      }
      // try shift later up to 60 minutes
      if (!shifted) {
        const tryLaterStart = ap.endMin + 10;
        if (tryLaterStart + duration <= bedtimeStartMin - 30) {
          b.startMin = tryLaterStart;
          b.endMin = b.startMin + duration;
          b.meta.adjustedForAppt = true;
          shifted = true;
        }
      }
      if (!shifted) {
        b.meta.conflict = `Overlaps ${ap.title}`;
      }
    }
  }

  // Sort blocks; remove any with bad times
  const cleaned = blocks
    .map(b => ({ ...b, startMin: Math.round(b.startMin), endMin: Math.round(b.endMin) }))
    .filter(b => b.endMin > b.startMin)
    .sort((a,b) => a.startMin - b.startMin);

  // Nap caregiver assignment after potential shifts
  cleaned.forEach(b => {
    if (b.meta?.kind === "nap") {
      b.meta.caregiver = pickNapCaregiver(plan || {}, b.startMin, b.endMin);
    }
  });

  return { wakeMin, bedtimeAsleepMin, blocks: cleaned };
}

/* ---------------------------
   Bath tracking (rule: at least every 3 days; cannot be scheduled when Julio is unavailable)
---------------------------- */
function lastBathISODate() {
  // Find most recent day log with bathDone=true.
  const entries = Object.entries(state.logsByDate || {});
  let best = null;
  for (const [date, log] of entries) {
    if (log?.bathDone === true) {
      if (!best || date > best) best = date;
    }
  }
  return best;
}
function isBathDue() {
  const today = toISODate(nowLocal());
  const last = lastBathISODate();
  if (!last) return true;
  const d1 = new Date(last + "T12:00:00");
  const d2 = new Date(today + "T12:00:00");
  const diffDays = Math.round((d2 - d1) / (1000*60*60*24));
  return diffDays >= DEFAULTS.bathEveryDays;
}
function bathWarningTextForTomorrow(plan) {
  const due = isBathDue();
  if (!due) return null;

  // Rule: bath cannot be scheduled when Julio is unavailable/working.
  // We'll look at tomorrow's dinner->bedtime window and check if Julio has ANY availability.
  const jAvail = invertToAvailability(plan?.julioUnavail || []);
  const dinnerToBedStart = parseTimeToMinutes("17:00"); // heuristic check window
  const bed = parseTimeToMinutes("20:30");
  const someAvail = jAvail.some(b => b.endMin > dinnerToBedStart && b.startMin < bed);
  if (!someAvail) return "Bath is due, but Julio appears unavailable in the evening window. Plan intentionally (or log bath earlier).";
  return "Bath is due (every 3 days). Consider fitting it in tonight.";
}

/* ---------------------------
   Data helpers: plans, logs, tasks
---------------------------- */
function getPlan(isoDate) {
  return state.plansByDate[isoDate] || null;
}
function getLog(isoDate) {
  return state.logsByDate[isoDate] || null;
}
function setPlan(isoDate, planObj) {
  state.plansByDate[isoDate] = planObj;
  saveLocalCache();
}
function setLog(isoDate, logObj) {
  state.logsByDate[isoDate] = logObj;
  saveLocalCache();
}
function upsertTask(task) {
  const ix = state.tasks.findIndex(t => t.id === task.id);
  if (ix >= 0) state.tasks[ix] = task;
  else state.tasks.unshift(task);
  saveLocalCache();
}
function deleteTaskLocal(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveLocalCache();
}

async function syncPlan(isoDate) {
  if (!state.online || !supabase || !authSession || !state.householdId) return;
  const data = state.plansByDate[isoDate];
  if (!data) return;
  await sbUpsert("day_plans", { household_id: state.householdId, date: isoDate, data }, "household_id,date");
}

async function syncLog(isoDate) {
  if (!state.online || !supabase || !authSession || !state.householdId) return;
  const data = state.logsByDate[isoDate];
  if (!data) return;
  await sbUpsert("day_logs", { household_id: state.householdId, date: isoDate, data }, "household_id,date");
}

async function syncTask(task) {
  if (!state.online || !supabase || !authSession || !state.householdId) return;
  await sbUpsert("tasks", {
    household_id: state.householdId,
    id: task.id,
    title: task.title,
    status: task.status,
    completed_at: task.completedAt,
    assigned_date: task.assignedDate,
    created_at: task.createdAt || new Date().toISOString(),
  }, "id");
}

/* ---------------------------
   UI Views
---------------------------- */
function render() {
  const root = $("#viewRoot");
  if (!root) return;

  const route = state.route;
  setActiveTab(route);

  if (route === "#evening") root.innerHTML = viewEvening();
  else if (route === "#today") root.innerHTML = viewToday();
  else if (route === "#tasks") root.innerHTML = viewTasks();
  else if (route === "#history") root.innerHTML = viewHistory();
  else if (route === "#settings") root.innerHTML = viewSettings();
  else root.innerHTML = viewToday();

  // Wire handlers for the visible view
  wireViewHandlers();
}

function viewEvening() {
  const today = toISODate(nowLocal());
  const tomorrow = addDays(today, 1);
  const plan = getPlan(tomorrow);

  const warning = plan ? bathWarningTextForTomorrow(plan) : null;

  return `
    <div class="grid two">
      <section class="card">
        <h2>Evening</h2>
        <div class="note">This is the simple end-of-day flow. It helps you: clean up today, brain dump tasks, pick tomorrow’s focus, and capture availability so naps get auto-assigned.</div>
        <div class="hr"></div>
        <div class="row">
          <button class="btn primary" id="btnLaunchQuiz">Prepare for the Day Ahead</button>
          <button class="btn" id="btnPreviewTomorrow">Preview tomorrow</button>
          <button class="btn" id="btnExportTomorrowICS">Sync tomorrow to Google Calendar</button>
        </div>
        <div class="kpi">
          <div class="chip"><b>Tomorrow:</b> ${tomorrow}</div>
          <div class="chip"><b>Expected wake:</b> ${loadConfig().expectedWake}</div>
        </div>
        ${warning ? `<div class="hr"></div><div class="badge warn">⚠ ${escapeHtml(warning)}</div>` : ""}
        <div class="hr"></div>
        <div class="note"><b>Tip:</b> The quiz saves a “Day Plan” for tomorrow. During the day, the Today page uses your actual wake/nap times to keep the schedule realistic.</div>
      </section>

      <section class="card">
        <h2>Tomorrow plan (saved)</h2>
        ${plan ? renderPlanSummary(plan) : `<div class="note">No plan saved yet. Tap <b>Prepare for the Day Ahead</b> to make one.</div>`}
      </section>
    </div>
  `;
}

function viewToday() {
  const today = toISODate(nowLocal());
  const plan = getPlan(today) || getPlan(addDays(today, 0)) || {}; // allow plan for today
  const log = getLog(today) || {
    wakeTime: null,
    nap1Start: null, nap1End: null,
    nap2Start: null, nap2End: null,
    bedtimeTime: null,
    overnightNotes: "",
    bathDone: false,
    updatedAt: new Date().toISOString(),
  };

  const schedule = buildSchedule({ isoDate: today, plan, log, mode: "today" });
  const tasksForToday = state.tasks.filter(t => t.assignedDate === today && t.status !== "done");

  const wakeLabel = log.wakeTime ? log.wakeTime : "(not set yet)";
  const nap1Label = `${log.nap1Start || "—"} → ${log.nap1End || "—"}`;
  const nap2Label = `${log.nap2Start || "—"} → ${log.nap2End || "—"}`;

  const bathDue = isBathDue();

  return `
    <div class="grid two">
      <section class="card">
        <h2>Today</h2>
        <div class="note">Use the quick buttons to log real times. The schedule below updates automatically.</div>
        <div class="hr"></div>

        <div class="row" style="justify-content: space-between;">
          <div class="tiny"><b>Date:</b> ${today}</div>
          ${bathDue ? `<span class="badge warn">⚠ Bath is due</span>` : `<span class="badge good">Bath OK</span>`}
        </div>

        <div class="hr"></div>

        <div class="card" style="padding:12px; box-shadow:none;">
          <div class="row" style="justify-content: space-between;">
            <div class="tiny"><b>Wake time:</b> <span id="wakeLabel">${wakeLabel}</span></div>
            <div class="row">
              <button class="btn mini" id="btnWakeNow">Set wake to now</button>
            </div>
          </div>
          <div class="field">
            <label>Or type it (HH:MM)</label>
            <input inputmode="numeric" placeholder="06:45" id="wakeInput" value="${log.wakeTime || ""}">
          </div>

          <div class="hr"></div>

          <div class="row" style="justify-content: space-between;">
            <div class="tiny"><b>Nap 1:</b> <span id="nap1Label">${nap1Label}</span></div>
            <div class="row">
              <button class="btn mini" id="btnNap1Toggle">Tap to log Nap 1 start/end</button>
            </div>
          </div>
          <div class="split">
            <div class="field">
              <label>Nap 1 start</label>
              <input inputmode="numeric" placeholder="09:50" id="nap1StartInput" value="${log.nap1Start || ""}">
            </div>
            <div class="field">
              <label>Nap 1 end</label>
              <input inputmode="numeric" placeholder="11:05" id="nap1EndInput" value="${log.nap1End || ""}">
            </div>
          </div>

          <div class="hr"></div>

          <div class="row" style="justify-content: space-between;">
            <div class="tiny"><b>Nap 2:</b> <span id="nap2Label">${nap2Label}</span></div>
            <div class="row">
              <button class="btn mini" id="btnNap2Toggle">Tap to log Nap 2 start/end</button>
            </div>
          </div>
          <div class="split">
            <div class="field">
              <label>Nap 2 start</label>
              <input inputmode="numeric" placeholder="15:00" id="nap2StartInput" value="${log.nap2Start || ""}">
            </div>
            <div class="field">
              <label>Nap 2 end</label>
              <input inputmode="numeric" placeholder="16:15" id="nap2EndInput" value="${log.nap2End || ""}">
            </div>
          </div>

          <div class="hr"></div>

          <div class="row" style="justify-content: space-between;">
            <div class="tiny"><b>Bedtime (tracking only):</b></div>
            <div class="row">
              <button class="btn mini" id="btnBedtimeNow">Set bedtime to now</button>
            </div>
          </div>
          <div class="split">
            <div class="field">
              <label>Bedtime time</label>
              <input inputmode="numeric" placeholder="19:50" id="bedtimeInput" value="${log.bedtimeTime || ""}">
            </div>
            <div class="field">
              <label>Overnight notes</label>
              <input placeholder="Anything to remember..." id="overnightInput" value="${escapeAttr(log.overnightNotes || "")}">
            </div>
          </div>

          <div class="row" style="justify-content: space-between;">
            <div class="row">
              <input type="checkbox" id="bathDoneChk" ${log.bathDone ? "checked" : ""} />
              <label for="bathDoneChk" style="margin:0; color:var(--text)">Bath done today</label>
            </div>
            <button class="btn primary" id="btnSaveLog">Save today’s log</button>
          </div>
          <div class="note" style="margin-top:8px;">Saving writes to your History (and syncs if signed in).</div>
        </div>
      </section>

      <section class="card">
        <h2>Today’s schedule + tasks</h2>
        <div class="row" style="margin-top:8px"><button class="btn" id="btnExportTodayICS">Sync today to Google Calendar</button></div>
        <div class="note">Open gaps stay blank on purpose. Only real routine items and appointments show.</div>
        <div class="hr"></div>

        ${renderTimeline(schedule.blocks)}

        <div class="hr"></div>
        <h2 style="margin-top:0">Tasks for today</h2>
        ${tasksForToday.length ? `<div class="list">${tasksForToday.map(t => renderTaskRow(t, { context: "today" })).join("")}</div>` :
          `<div class="note">No tasks assigned for today yet. Go to <b>Tasks</b> to add something, then tap “Move to today”.</div>`}
      </section>
    </div>
  `;
}

function viewTasks() {
  const today = toISODate(nowLocal());
  const open = state.tasks.filter(t => t.status !== "done");
  const done = state.tasks.filter(t => t.status === "done");

  return `
    <div class="grid two">
      <section class="card">
        <h2>Tasks</h2>
        <div class="note">Brain dump here anytime. Then assign tasks to today whenever you want.</div>
        <div class="hr"></div>

        <div class="field">
          <label>Add a new task</label>
          <div class="row stretch">
            <input id="newTaskTitle" placeholder="e.g., Prep nursery for bed" />
            <button class="btn primary" id="btnAddTask">Add</button>
          </div>
        </div>

        <div class="hr"></div>
        <div class="note"><b>Open tasks</b></div>
        ${open.length ? `<div class="list">${open.map(t => renderTaskRow(t, { context: "tasks", today })).join("")}</div>` :
          `<div class="note">Nothing here yet. Add a quick brain dump task above.</div>`}

        <div class="hr"></div>
        <details>
          <summary class="note">Show completed (${done.length})</summary>
          <div style="margin-top:10px" class="list">${done.slice(0, 120).map(t => renderTaskRow(t, { context: "tasks", today })).join("") || `<div class="note">No completed tasks yet.</div>`}</div>
        </details>
      </section>

      <section class="card">
        <h2>Quick actions</h2>
        <div class="note">These are meant to be dead-simple for non-techy days.</div>
        <div class="hr"></div>

        <div class="row">
          <button class="btn" id="btnAssignAllOpenToToday">Move ALL open tasks to today</button>
          <button class="btn danger" id="btnClearTodayAssignments">Clear today's assignments</button>
        </div>

        <div class="hr"></div>
        <div class="note"><b>Today:</b> ${today}</div>
        <div class="note">Anything “moved to today” will show on the Today page.</div>
      </section>
    </div>
  `;
}

function viewHistory() {
  const dates = Object.keys(state.logsByDate || {}).sort().reverse();
  const items = dates.map(d => {
    const log = state.logsByDate[d];
    const w = log?.wakeTime || "—";
    const n1 = (log?.nap1Start && log?.nap1End) ? `${log.nap1Start}→${log.nap1End}` : "—";
    const n2 = (log?.nap2Start && log?.nap2End) ? `${log.nap2Start}→${log.nap2End}` : "—";
    const bath = log?.bathDone ? "Bath ✅" : "Bath —";
    const note = log?.overnightNotes ? ` • ${escapeHtml(log.overnightNotes)}` : "";
    return `
      <div class="item">
        <div class="left">
          <div class="title">${d}</div>
          <div class="sub">Wake ${w} • Nap1 ${n1} • Nap2 ${n2} • ${bath}${note}</div>
        </div>
        <div class="actions">
          <button class="btn mini" data-openlog="${d}">Open</button>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="grid two">
      <section class="card">
        <h2>History</h2>
        <div class="note">This is the actual day log archive. Tap any day to view details.</div>
        <div class="hr"></div>

        ${dates.length ? `<div class="list">${items}</div>` : `<div class="note">No day logs saved yet. Save a log from the Today page.</div>`}
      </section>

      <section class="card">
        <h2>Bath tracker</h2>
        <div class="note">Rule: bath at least every 3 days. Mark it on the Today page.</div>
        <div class="hr"></div>
        <div class="kpi">
          <div class="chip"><b>Last bath:</b> ${lastBathISODate() || "None yet"}</div>
          <div class="chip"><b>Status:</b> ${isBathDue() ? "Due ⚠" : "OK ✅"}</div>
        </div>

        <div class="hr"></div>
        <div class="note">If bath is due, the schedule will show “Bath (due today)”. Also note: bath cannot be scheduled if Julio is unavailable—plan intentionally on those evenings.</div>
      </section>
    </div>
  `;
}

function viewSettings() {
  const cfg = loadConfig();

  const needsSetup = !cfg.supabaseUrl || !cfg.supabaseAnonKey;
  const signedIn = !!authSession;
  const hidOk = !!cfg.householdId;

  return `
    <div class="grid two">
      <section class="card">
        <h2>Sync settings (Supabase)</h2>
        <div class="note">This app is private by design. Supabase stores your household’s plans, logs, and tasks — and Row Level Security keeps other households out.</div>
        <div class="hr"></div>

        <div class="field">
          <label>Supabase URL</label>
          <input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${escapeAttr(cfg.supabaseUrl)}" />
        </div>
        <div class="field">
          <label>Supabase Anon key (publishable)</label>
          <input id="sbKey" placeholder="sb_publishable_..." value="${escapeAttr(cfg.supabaseAnonKey)}" />
        </div>
        <div class="field">
          <label>Household ID (UUID)</label>
          <input id="householdId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${escapeAttr(cfg.householdId)}" />
          <div class="note">All family members should use the same household ID to share data.</div>
        </div>

        <div class="row">
          <button class="btn primary" id="btnSaveConfig">Save settings</button>
          <button class="btn" id="btnTestConnection">Test connection</button>
        </div>

        ${needsSetup ? `<div class="hr"></div><div class="badge warn">⚠ Add your Supabase URL + key to enable sync.</div>` : ``}
        ${!hidOk ? `<div class="hr"></div><div class="badge warn">⚠ Add a Household ID to scope your data.</div>` : ``}
      </section>

      <section class="card">
        <h2>Account</h2>
        <div class="note">Use email/password sign-in. (If your Supabase project requires email confirmation, you may need to confirm the signup email.)</div>
        <div class="hr"></div>

        ${signedIn ? `
          <div class="note">Signed in as <b>${escapeHtml(state.me.email || "")}</b></div>
          <div class="hr"></div>
          <button class="btn danger" id="btnSignOut">Sign out</button>
        ` : `
          <div class="field">
            <label>Email</label>
            <input id="authEmail" type="email" placeholder="you@example.com" />
          </div>
          <div class="field">
            <label>Password</label>
            <input id="authPass" type="password" placeholder="••••••••" />
          </div>
          <div class="row">
            <button class="btn primary" id="btnSignIn">Sign in</button>
            <button class="btn" id="btnSignUp">Create account</button>
          </div>
        `}

        <div class="hr"></div>
        <h2 style="margin-top:0">Planner defaults</h2>

        <div class="field">
          <label>Expected wake time for forecasts (HH:MM)</label>
          <input id="expectedWake" inputmode="numeric" placeholder="06:30" value="${escapeAttr(cfg.expectedWake)}" />
        </div>
        <div class="field">
          <label>Default nap duration (minutes)</label>
          <input id="defaultNapMinutes" inputmode="numeric" placeholder="75" value="${escapeAttr(String(cfg.defaultNapMinutes ?? DEFAULTS.defaultNapMinutes))}" />
          <div class="note">Forecast uses this. During the day, actual nap end times override.</div>
        </div>

        <div class="row">
          <button class="btn primary" id="btnSaveDefaults">Save defaults</button>
          <button class="btn" id="btnResetCache">Reset local cache</button>
        </div>

        <div class="hr"></div>
        <div class="note"><b>PWA tip:</b> If you ever see stale UI after an update, you can “Reset local cache” and also re-open the app. The service worker cache name is bumped with each zip.</div>
      </section>
    </div>
  `;
}

/* ---------------------------
   Timeline rendering
---------------------------- */
function renderTimeline(blocks) {
  // 2-hour grid from 6:00 to 22:00 by default, but expand if needed.
  const minStart = Math.min(...blocks.map(b=>b.startMin), 6*60);
  const maxEnd = Math.max(...blocks.map(b=>b.endMin), 22*60);
  const startGrid = Math.floor(minStart / 120) * 120;
  const endGrid = Math.ceil(maxEnd / 120) * 120;

  const totalMinutes = endGrid - startGrid;
  const rows = [];
  for (let t = startGrid; t < endGrid; t += 120) {
    rows.push({ label: minutesToHHMM(t), startMin: t, endMin: t + 120 });
  }

  const heightPx = 560;
  const pxPerMin = heightPx / totalMinutes;

  const gridHtml = rows.map((r, i) => `
    <div class="gridRow" style="height:${Math.round((r.endMin-r.startMin)*pxPerMin)}px">
      <div class="tlabel">${r.label}</div>
    </div>
  `).join("");

  const blockHtml = blocks.map(b => {
    const top = Math.round((b.startMin - startGrid) * pxPerMin) + 10;
    const h = Math.max(34, Math.round((b.endMin - b.startMin) * pxPerMin) - 6);

    const meta = [];
    meta.push(`${minutesToHHMM(b.startMin)}–${minutesToHHMM(b.endMin)}`);

    let badges = "";
    if (b.meta?.kind === "nap") {
      const c = b.meta.caregiver || { who:"—", status:"warn" };
      const cls = c.status === "ok" ? "good" : (c.status === "bad" ? "bad" : "warn");
      badges += ` <span class="badge ${cls}">🛌 ${escapeHtml(c.who)}</span>`;
      if (b.meta.conflict) badges += ` <span class="badge warn">⚠ ${escapeHtml(b.meta.conflict)}</span>`;
      if (b.meta.adjustedForAppt) badges += ` <span class="badge warn">↔ Adjusted</span>`;
    }
    if (b.meta?.kind === "bath") badges += ` <span class="badge warn">🛁 Due</span>`;
    if (b.meta?.kind === "appointment") badges += ` <span class="badge good">📍 Appointment</span>`;
    if (b.meta?.kind === "bedtime") badges += ` <span class="badge">🌙 ${escapeHtml(b.meta.bedtimeBy || "")}</span>`;

    return `
      <div class="block" style="top:${top}px; height:${h}px">
        <div class="title">${escapeHtml(b.title)}</div>
        <div class="meta">
          <span>${meta.join(" • ")}</span>
          ${badges}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="timelineWrap" aria-label="Timeline schedule">
      <div class="timelineGrid">${gridHtml}</div>
      <div class="blocks">${blockHtml}</div>
    </div>
  `;
}

/* ---------------------------
   Task row rendering
---------------------------- */
function renderTaskRow(t, { context, today }) {
  const done = t.status === "done";
  const assigned = !!t.assignedDate;
  const isToday = t.assignedDate === (today || toISODate(nowLocal()));

  const subBits = [];
  if (assigned) subBits.push(`Assigned: ${t.assignedDate}`);
  if (done && t.completedAt) subBits.push(`Done: ${new Date(t.completedAt).toLocaleString()}`);

  const sub = subBits.length ? subBits.join(" • ") : "Brain dump task";

  const actions = [];
  if (!done) actions.push(`<button class="btn mini" data-done="${t.id}">Mark done</button>`);
  else actions.push(`<button class="btn mini" data-undone="${t.id}">Undo</button>`);

  if (!done) {
    if (isToday) actions.push(`<button class="btn mini" data-unassign="${t.id}">Remove from today</button>`);
    else actions.push(`<button class="btn mini" data-assign="${t.id}">Move to today</button>`);
  }

  actions.push(`<button class="btn mini danger" data-delete="${t.id}">Delete</button>`);

  return `
    <div class="item ${done ? "done" : ""}">
      <div class="left">
        <div class="title"><span class="check">${done ? "✓" : ""}</span>${escapeHtml(t.title)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      <div class="actions">${actions.join("")}</div>
    </div>
  `;
}

/* ---------------------------
   Plans summary
---------------------------- */
function renderPlanSummary(plan) {
  const blocks = (label, arr) => {
    const b = normalizeBlocks(arr || []).map(x => `${minutesToHHMM(x.startMin)}–${minutesToHHMM(x.endMin)}`);
    return b.length ? `<div class="note"><b>${escapeHtml(label)}:</b> ${b.join(", ")}</div>` : `<div class="note"><b>${escapeHtml(label)}:</b> None</div>`;
  };
  const appts = (plan.appointments || []).length ? `
    <div class="note"><b>Appointments:</b> ${(plan.appointments||[]).map(a => `${escapeHtml(a.title)} (${escapeHtml(a.start)}–${escapeHtml(a.end)})`).join(", ")}</div>
  ` : `<div class="note"><b>Appointments:</b> None</div>`;

  const bedtimeBy = plan.bedtimeBy === "Julio" ? "Julio" : "Kristyn";
  const nanny = plan.nannyWorking ? "Yes" : "No";

  return `
    <div class="note"><b>Bedtime by:</b> ${bedtimeBy}</div>
    <div class="note"><b>Nanny working:</b> ${nanny}</div>
    ${blocks("Julio unavailable", plan.julioUnavail)}
    ${blocks("Kristyn unavailable", plan.kristynUnavail)}
    ${plan.nannyWorking ? blocks("Nanny working blocks", plan.nannyBlocks) : ""}
    ${blocks("Kayden working blocks", plan.kaydenBlocks)}
    ${appts}
    <div class="hr"></div>
    <div class="row">
      <button class="btn" id="btnEditTomorrowPlan">Edit tomorrow plan</button>
    </div>
  `;
}

/* ---------------------------
   Event wiring
---------------------------- */
function wireViewHandlers() {
  // Global: history open buttons, etc.
  $all("[data-openlog]").forEach(btn => {
    btn.addEventListener("click", () => openHistoryModal(btn.getAttribute("data-openlog")));
  });

  // Evening
  const launch = $("#btnLaunchQuiz");
  if (launch) launch.addEventListener("click", () => openEveningQuiz());

  const prev = $("#btnPreviewTomorrow");
  if (prev) prev.addEventListener("click", () => previewTomorrow());

  const expT = $("#btnExportTomorrowICS");
  if (expT) expT.addEventListener("click", () => {
    const today = toISODate(nowLocal());
    const tomorrow = addDays(today, 1);
    const plan = getPlan(tomorrow) || state.quiz.draft || {};
    const sched = buildSchedule({ isoDate: tomorrow, plan, log: null, mode: "forecast" });
    syncScheduleToGoogleCalendar({ isoDate: tomorrow, scheduleBlocks: sched.blocks });
  });


  const editTomorrow = $("#btnEditTomorrowPlan");
  if (editTomorrow) editTomorrow.addEventListener("click", () => openEveningQuiz({ editExisting: true }));

  // Today logging
  const btnWake = $("#btnWakeNow");
  if (btnWake) btnWake.addEventListener("click", () => {
    const t = minutesToHHMM(nowLocal().getHours()*60 + nowLocal().getMinutes());
    $("#wakeInput").value = t;
    showToast("Wake time set. Tap Save.");
  });

  const btnNap1 = $("#btnNap1Toggle");
  if (btnNap1) btnNap1.addEventListener("click", () => toggleNap(1));

  const btnNap2 = $("#btnNap2Toggle");
  if (btnNap2) btnNap2.addEventListener("click", () => toggleNap(2));

  const btnBed = $("#btnBedtimeNow");
  if (btnBed) btnBed.addEventListener("click", () => {
    const t = minutesToHHMM(nowLocal().getHours()*60 + nowLocal().getMinutes());
    $("#bedtimeInput").value = t;
    showToast("Bedtime set. Tap Save.");
  });

  const btnSaveLog = $("#btnSaveLog");
  if (btnSaveLog) btnSaveLog.addEventListener("click", saveTodayLog);

  const expToday = $("#btnExportTodayICS");
  if (expToday) expToday.addEventListener("click", () => {
    const today = toISODate(nowLocal());
    const plan = getPlan(today) || {};
    const log = getLog(today) || {};
    const sched = buildSchedule({ isoDate: today, plan, log, mode: "today" });
    syncScheduleToGoogleCalendar({ isoDate: today, scheduleBlocks: sched.blocks });
  });


  // Task actions
  $all("[data-assign]").forEach(btn => btn.addEventListener("click", () => taskAssign(btn.dataset.assign)));
  $all("[data-unassign]").forEach(btn => btn.addEventListener("click", () => taskUnassign(btn.dataset.unassign)));
  $all("[data-done]").forEach(btn => btn.addEventListener("click", () => taskDone(btn.dataset.done)));
  $all("[data-undone]").forEach(btn => btn.addEventListener("click", () => taskUndone(btn.dataset.undone)));
  $all("[data-delete]").forEach(btn => btn.addEventListener("click", () => taskDelete(btn.dataset.delete)));

  const btnAdd = $("#btnAddTask");
  if (btnAdd) btnAdd.addEventListener("click", addTaskFromInput);

  const btnAll = $("#btnAssignAllOpenToToday");
  if (btnAll) btnAll.addEventListener("click", assignAllOpenToToday);

  const btnClear = $("#btnClearTodayAssignments");
  if (btnClear) btnClear.addEventListener("click", clearTodayAssignments);

  // Settings
  const btnSaveCfg = $("#btnSaveConfig");
  if (btnSaveCfg) btnSaveCfg.addEventListener("click", saveSettingsConfig);

  const btnTest = $("#btnTestConnection");
  if (btnTest) btnTest.addEventListener("click", testConnection);

  const btnSignIn = $("#btnSignIn");
  if (btnSignIn) btnSignIn.addEventListener("click", () => doAuth("signin"));

  const btnSignUp = $("#btnSignUp");
  if (btnSignUp) btnSignUp.addEventListener("click", () => doAuth("signup"));

  const btnOut = $("#btnSignOut");
  if (btnOut) btnOut.addEventListener("click", async () => {
    await signOut();
    showToast("Signed out.");
    render();
  });

  const btnSaveDefaults = $("#btnSaveDefaults");
  if (btnSaveDefaults) btnSaveDefaults.addEventListener("click", saveDefaults);

  const btnResetCache = $("#btnResetCache");
  if (btnResetCache) btnResetCache.addEventListener("click", () => {
    localStorage.removeItem(LS.localCache);
    state.tasks = [];
    state.plansByDate = {};
    state.logsByDate = {};
    showToast("Local cache reset.");
    render();
  });

  // Quiz modal
  wireQuizModal();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/* ---------------------------
   Today log save + nap toggles
---------------------------- */
function getTodayDraftLog() {
  const today = toISODate(nowLocal());
  const cur = getLog(today) || {};
  return {
    wakeTime: valueHHMM($("#wakeInput")?.value) || null,
    nap1Start: valueHHMM($("#nap1StartInput")?.value) || null,
    nap1End: valueHHMM($("#nap1EndInput")?.value) || null,
    nap2Start: valueHHMM($("#nap2StartInput")?.value) || null,
    nap2End: valueHHMM($("#nap2EndInput")?.value) || null,
    bedtimeTime: valueHHMM($("#bedtimeInput")?.value) || null,
    overnightNotes: $("#overnightInput")?.value || "",
    bathDone: !!$("#bathDoneChk")?.checked,
    updatedAt: new Date().toISOString(),
    _v: 1,
    _source: "today",
  };
}

function valueHHMM(v) {
  const s = (v || "").trim();
  if (!s) return null;
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

async function saveTodayLog() {
  const today = toISODate(nowLocal());
  const log = getTodayDraftLog();
  setLog(today, log);
  showToast("Saved today’s log.");
  render();
  try {
    await syncLog(today);
  } catch (e) {
    console.warn(e);
    showToast("Saved locally (sync pending).");
  }
}

function toggleNap(n) {
  const now = minutesToHHMM(nowLocal().getHours()*60 + nowLocal().getMinutes());
  if (n === 1) {
    const s = valueHHMM($("#nap1StartInput").value);
    const e = valueHHMM($("#nap1EndInput").value);
    if (!s) {
      $("#nap1StartInput").value = now;
      showToast("Nap 1 start set. Tap again to set Nap 1 end.");
    } else if (!e) {
      $("#nap1EndInput").value = now;
      showToast("Nap 1 end set.");
    } else {
      // both set: gently ask to edit manually
      showToast("Nap 1 already has start & end. Edit the fields if needed.");
    }
  } else if (n === 2) {
    const s = valueHHMM($("#nap2StartInput").value);
    const e = valueHHMM($("#nap2EndInput").value);
    if (!s) {
      $("#nap2StartInput").value = now;
      showToast("Nap 2 start set. Tap again to set Nap 2 end.");
    } else if (!e) {
      $("#nap2EndInput").value = now;
      showToast("Nap 2 end set.");
    } else {
      showToast("Nap 2 already has start & end. Edit the fields if needed.");
    }
  }
}

/* ---------------------------
   Tasks logic
---------------------------- */
async function addTaskFromInput() {
  const input = $("#newTaskTitle");
  const title = (input?.value || "").trim();
  if (!title) { showToast("Type a task first."); return; }

  const task = {
    id: uid(),
    title,
    status: "open",
    completedAt: null,
    assignedDate: null,
    createdAt: new Date().toISOString(),
  };
  upsertTask(task);
  input.value = "";
  showToast("Task added.");
  render();

  try { await syncTask(task); } catch (e) { console.warn(e); }
}

async function taskAssign(id) {
  const today = toISODate(nowLocal());
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.assignedDate = today;
  upsertTask(t);
  showToast("Moved to today.");
  render();
  try { await syncTask(t); } catch (e) { console.warn(e); }
}
async function taskUnassign(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.assignedDate = null;
  upsertTask(t);
  showToast("Removed from today.");
  render();
  try { await syncTask(t); } catch (e) { console.warn(e); }
}
async function taskDone(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = "done";
  t.completedAt = new Date().toISOString();
  // Keep assignment date as history of what it was done for.
  upsertTask(t);
  showToast("Marked done.");
  render();
  try { await syncTask(t); } catch (e) { console.warn(e); }
}
async function taskUndone(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = "open";
  t.completedAt = null;
  upsertTask(t);
  showToast("Reopened.");
  render();
  try { await syncTask(t); } catch (e) { console.warn(e); }
}
async function taskDelete(id) {
  // local delete
  deleteTaskLocal(id);
  showToast("Deleted.");
  render();

  // remote delete if possible
  try {
    if (state.online && supabase && authSession) {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    }
  } catch (e) {
    console.warn(e);
    showToast("Deleted locally (sync pending).");
  }
}
async function assignAllOpenToToday() {
  const today = toISODate(nowLocal());
  const open = state.tasks.filter(t => t.status !== "done");
  for (const t of open) {
    t.assignedDate = today;
    upsertTask(t);
    try { await syncTask(t); } catch {}
  }
  showToast("All open tasks moved to today.");
  render();
}
async function clearTodayAssignments() {
  const today = toISODate(nowLocal());
  const targets = state.tasks.filter(t => t.assignedDate === today && t.status !== "done");
  for (const t of targets) {
    t.assignedDate = null;
    upsertTask(t);
    try { await syncTask(t); } catch {}
  }
  showToast("Cleared today’s assignments.");
  render();
}

/* ---------------------------
   Evening quiz wizard
---------------------------- */
const QUIZ_STEPS = [
  { key: "cleanup", label: "Quick cleanup" },
  { key: "braindump", label: "Brain dump" },
  { key: "pick", label: "Pick tomorrow’s tasks" },
  { key: "parents", label: "Parent availability" },
  { key: "helpers", label: "Nanny + Kayden" },
  { key: "bedtime", label: "Bedtime" },
  { key: "appts", label: "Appointments" },
  { key: "preview", label: "Preview + save" },
];

function openEveningQuiz({ editExisting } = {}) {
  const today = toISODate(nowLocal());
  const tomorrow = addDays(today, 1);
  state.quiz.tomorrow = tomorrow;
  state.quiz.step = 0;

  const existing = getPlan(tomorrow);
  state.quiz.draft = existing && editExisting ? structuredClone(existing) : makeEmptyPlanDraft();

  $("#quizOverlay").classList.add("show");
  state.quiz.open = true;
  renderQuiz();
}
function closeEveningQuiz() {
  $("#quizOverlay").classList.remove("show");
  state.quiz.open = false;
}

function makeEmptyPlanDraft() {
  return {
    kristynUnavail: [],
    julioUnavail: [],
    nannyWorking: false,
    nannyBlocks: [],
    kaydenBlocks: [],
    bedtimeBy: "Kristyn",
    appointments: [],
    tasksChosen: [],
    cleanupTaskIds: [],
    _v: 1,
    updatedAt: new Date().toISOString(),
  };
}

function wireQuizModal() {
  const closeBtn = $("#quizCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeEveningQuiz);

  const backBtn = $("#quizBackBtn");
  if (backBtn) backBtn.addEventListener("click", () => {
    state.quiz.step = Math.max(0, state.quiz.step - 1);
    renderQuiz();
  });

  const nextBtn = $("#quizNextBtn");
  if (nextBtn) nextBtn.addEventListener("click", async () => {
    // Validate/save step data into draft
    const ok = readQuizStepIntoDraft();
    if (!ok) return;

    if (state.quiz.step < QUIZ_STEPS.length - 1) {
      state.quiz.step += 1;
      renderQuiz();
      return;
    }

    // Save plan
    await saveTomorrowPlanFromDraft();
  });
}

function renderQuiz() {
  const stepper = $("#quizStepper");
  const body = $("#quizBody");
  const hint = $("#quizHint");
  const nextBtn = $("#quizNextBtn");
  const backBtn = $("#quizBackBtn");

  if (!stepper || !body || !hint || !nextBtn || !backBtn) return;

  stepper.innerHTML = QUIZ_STEPS.map((s, i) => `<div class="step ${i===state.quiz.step ? "active":""}">${i+1}. ${escapeHtml(s.label)}</div>`).join("");

  hint.textContent = `Step ${state.quiz.step + 1} of ${QUIZ_STEPS.length}`;
  backBtn.style.visibility = (state.quiz.step === 0) ? "hidden" : "visible";
  nextBtn.textContent = (state.quiz.step === QUIZ_STEPS.length - 1) ? "Save tomorrow" : "Next";

  const stepKey = QUIZ_STEPS[state.quiz.step].key;
  body.innerHTML = quizStepView(stepKey);

  // Attach dynamic handlers inside step
  wireQuizStepHandlers(stepKey);
}

function quizStepView(stepKey) {
  const tomorrow = state.quiz.tomorrow;
  const draft = state.quiz.draft;

  if (stepKey === "cleanup") {
    const today = toISODate(nowLocal());
    const todays = state.tasks.filter(t => t.assignedDate === today && t.status !== "done");
    const open = state.tasks.filter(t => t.status !== "done").slice(0, 24);
    const options = (todays.length ? todays : open);

    return `
      <div class="note"><b>Before anything else:</b> quickly check off anything you already finished today.</div>
      <div class="note">This keeps tomorrow’s plan clean.</div>
      <div class="hr"></div>

      ${options.length ? `
        <div class="list">
          ${options.map(t => `
            <div class="item">
              <div class="left">
                <div class="title">${escapeHtml(t.title)}</div>
                <div class="sub">${t.assignedDate ? `Assigned: ${t.assignedDate}` : "Open task"}</div>
              </div>
              <div class="actions">
                <label class="badge"><input type="checkbox" data-cleanup="${t.id}" ${draft.cleanupTaskIds?.includes(t.id) ? "checked":""} /> Mark done</label>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="note">No open tasks to clean up right now.</div>`}

      <div class="hr"></div>
      <div class="note">Tomorrow we’re planning for: <b>${tomorrow}</b></div>
    `;
  }

  if (stepKey === "braindump") {
    return `
      <div class="note">Brain dump anything on your mind. Each line becomes a task in your master list.</div>
      <div class="hr"></div>
      <div class="field">
        <label>Brain dump</label>
        <textarea id="brainDumpText" placeholder="One task per line..."></textarea>
      </div>
      <div class="note">Examples: “Prep baby’s lunch”, “Fold laundry”, “Email daycare”, “Restock wipes”.</div>
    `;
  }

  if (stepKey === "pick") {
    const openTasks = state.tasks.filter(t => t.status !== "done");
    return `
      <div class="note">Pick what you want to focus on tomorrow. You can always move tasks to today later.</div>
      <div class="hr"></div>
      ${openTasks.length ? `
        <div class="list">
          ${openTasks.slice(0, 120).map(t => `
            <div class="item">
              <div class="left">
                <div class="title">${escapeHtml(t.title)}</div>
                <div class="sub">${t.assignedDate ? `Currently assigned: ${t.assignedDate}` : "Not assigned yet"}</div>
              </div>
              <div class="actions">
                <label class="badge"><input type="checkbox" data-pick="${t.id}" ${draft.tasksChosen?.includes(t.id) ? "checked":""} /> Do tomorrow</label>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="note">No tasks yet. Add a few in the Brain dump step.</div>`}
    `;
  }

  if (stepKey === "parents") {
    return `
      <div class="note">Add time blocks when each parent is unavailable tomorrow.</div>
      <div class="note">Tip: leave this blank if someone is available all day.</div>
      <div class="hr"></div>

      <h2 style="margin:0 0 6px">Julio unavailable</h2>
      ${timeBlockEditor("julioUnavail", draft.julioUnavail)}

      <div class="hr"></div>

      <h2 style="margin:0 0 6px">Kristyn unavailable</h2>
      ${timeBlockEditor("kristynUnavail", draft.kristynUnavail)}
    `;
  }

  if (stepKey === "helpers") {
    return `
      <div class="note">Tell the app when helpers are available. This only affects nap caregiver assignment.</div>
      <div class="hr"></div>

      <div class="row" style="justify-content: space-between;">
        <h2 style="margin:0">Nanny working?</h2>
        <label class="badge"><input type="checkbox" id="nannyWorkingChk" ${draft.nannyWorking ? "checked":""} /> Yes</label>
      </div>

      <div class="note">If yes, add working blocks:</div>
      ${timeBlockEditor("nannyBlocks", draft.nannyBlocks, { disabled: !draft.nannyWorking })}

      <div class="hr"></div>

      <h2 style="margin:0 0 6px">Kayden working hours</h2>
      ${timeBlockEditor("kaydenBlocks", draft.kaydenBlocks)}
    `;
  }

  if (stepKey === "bedtime") {
    return `
      <div class="note">Who is doing bedtime tomorrow?</div>
      <div class="hr"></div>

      <div class="field">
        <label>Bedtime parent (Kristyn or Julio)</label>
        <select id="bedtimeBySel">
          <option value="Kristyn" ${draft.bedtimeBy === "Kristyn" ? "selected":""}>Kristyn</option>
          <option value="Julio" ${draft.bedtimeBy === "Julio" ? "selected":""}>Julio</option>
        </select>
      </div>
      <div class="note">Bedtime is a scheduled block, but bedtime time itself is tracking-only on the Today page.</div>
    `;
  }

  if (stepKey === "appts") {
    const appts = draft.appointments || [];
    return `
      <div class="note">Add appointments for tomorrow (they only affect the schedule if they overlap a scheduled block).</div>
      <div class="hr"></div>

      <div class="row">
        <button class="btn" id="btnAddAppt">Add an appointment</button>
      </div>

      <div class="hr"></div>

      ${appts.length ? `
        <div class="list">
          ${appts.map(a => `
            <div class="item">
              <div class="left" style="flex:1">
                <div class="split">
                  <div class="field" style="margin:0">
                    <label>Title</label>
                    <input data-appt-title="${a.id}" value="${escapeAttr(a.title||"")}" placeholder="Doctor" />
                  </div>
                  <div class="field" style="margin:0">
                    <label>Start</label>
                    <input data-appt-start="${a.id}" inputmode="numeric" value="${escapeAttr(a.start||"")}" placeholder="10:30" />
                  </div>
                  <div class="field" style="margin:0">
                    <label>End</label>
                    <input data-appt-end="${a.id}" inputmode="numeric" value="${escapeAttr(a.end||"")}" placeholder="11:15" />
                  </div>
                </div>
              </div>
              <div class="actions">
                <button class="btn mini danger" data-appt-del="${a.id}">Remove</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="note">No appointments added.</div>`}
      <div class="note" style="margin-top:10px;">Format: <b>HH:MM</b> (24-hour time). Example: 14:05.</div>
    `;
  }

  if (stepKey === "preview") {
    const schedule = buildSchedule({ isoDate: tomorrow, plan: draft, log: null, mode: "forecast" });
    const warning = bathWarningTextForTomorrow(draft);

    const tasksChosen = (draft.tasksChosen || []).map(id => state.tasks.find(t => t.id === id)).filter(Boolean);

    return `
      <div class="note">Here’s the forecast schedule for <b>${tomorrow}</b>, anchored on the default wake time <b>${loadConfig().expectedWake}</b>.</div>
      ${warning ? `<div class="hr"></div><div class="badge warn">⚠ ${escapeHtml(warning)}</div>` : ""}
      <div class="hr"></div>

      ${renderTimeline(schedule.blocks)}

      <div class="hr"></div>
      <h2 style="margin-top:0">Tasks you picked for tomorrow</h2>
      ${tasksChosen.length ? `
        <div class="list">
          ${tasksChosen.map(t => `<div class="item"><div class="left"><div class="title">${escapeHtml(t.title)}</div><div class="sub">Will be assigned to tomorrow when you save</div></div></div>`).join("")}
        </div>
      ` : `<div class="note">No tasks selected. That’s okay — you can assign tasks anytime.</div>`}

      <div class="hr"></div>
      <div class="note">When you tap <b>Save tomorrow</b>, we will:</div>
      <ul class="note" style="margin-top:8px">
        <li>Save the “Day Plan” (availability + appointments + bedtime parent)</li>
        <li>Assign your chosen tasks to tomorrow</li>
        <li>Mark any cleanup tasks as done</li>
      </ul>
    `;
  }

  return `<div class="note">Unknown step.</div>`;
}

function timeBlockEditor(fieldKey, blocks, { disabled } = {}) {
  const list = (blocks || []).map((b, idx) => `
    <div class="item">
      <div class="left" style="flex:1">
        <div class="split">
          <div class="field" style="margin:0">
            <label>Start</label>
            <input ${disabled ? "disabled":""} data-block-start="${fieldKey}:${idx}" inputmode="numeric" value="${escapeAttr(b.start||"")}" placeholder="09:00" />
          </div>
          <div class="field" style="margin:0">
            <label>End</label>
            <input ${disabled ? "disabled":""} data-block-end="${fieldKey}:${idx}" inputmode="numeric" value="${escapeAttr(b.end||"")}" placeholder="11:30" />
          </div>
        </div>
      </div>
      <div class="actions">
        <button class="btn mini danger" ${disabled ? "disabled":""} data-block-del="${fieldKey}:${idx}">Remove</button>
      </div>
    </div>
  `).join("");

  return `
    <div class="row" style="margin:10px 0">
      <button class="btn" ${disabled ? "disabled":""} data-block-add="${fieldKey}">Add a time block</button>
    </div>
    ${list ? `<div class="list">${list}</div>` : `<div class="note">No time blocks added.</div>`}
    ${disabled ? `<div class="note">Turn on “Nanny working” to edit these blocks.</div>` : ``}
  `;
}

function wireQuizStepHandlers(stepKey) {
  const draft = state.quiz.draft;

  // Nanny working toggle re-render
  if (stepKey === "helpers") {
    const chk = $("#nannyWorkingChk");
    if (chk) chk.addEventListener("change", () => {
      draft.nannyWorking = !!chk.checked;
      renderQuiz();
    });
  }

  // Add block buttons
  $all("[data-block-add]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-block-add");
      draft[key] = draft[key] || [];
      draft[key].push({ start: "", end: "" });
      renderQuiz();
    });
  });

  // Remove block buttons
  $all("[data-block-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [key, idxS] = btn.getAttribute("data-block-del").split(":");
      const idx = Number(idxS);
      if (!Array.isArray(draft[key])) return;
      draft[key].splice(idx, 1);
      renderQuiz();
    });
  });

  // Appointments add/remove
  if (stepKey === "appts") {
    const add = $("#btnAddAppt");
    if (add) add.addEventListener("click", () => {
      draft.appointments = draft.appointments || [];
      draft.appointments.push({ id: uid(), title: "", start: "", end: "" });
      renderQuiz();
    });
    $all("[data-appt-del]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-appt-del");
        draft.appointments = (draft.appointments || []).filter(a => a.id !== id);
        renderQuiz();
      });
    });
  }
}

function readQuizStepIntoDraft() {
  const stepKey = QUIZ_STEPS[state.quiz.step].key;
  const draft = state.quiz.draft;

  if (stepKey === "cleanup") {
    const picked = $all("[data-cleanup]").filter(chk => chk.checked).map(chk => chk.getAttribute("data-cleanup"));
    draft.cleanupTaskIds = picked;
    return true;
  }

  if (stepKey === "braindump") {
    const text = $("#brainDumpText")?.value || "";
    draft._brainDumpLines = text.split("\n").map(s => s.trim()).filter(Boolean);
    return true;
  }

  if (stepKey === "pick") {
    const chosen = $all("[data-pick]").filter(chk => chk.checked).map(chk => chk.getAttribute("data-pick"));
    draft.tasksChosen = chosen;
    return true;
  }

  if (stepKey === "parents" || stepKey === "helpers") {
    // Read all block inputs back into draft (preserving order)
    for (const key of ["julioUnavail","kristynUnavail","nannyBlocks","kaydenBlocks"]) {
      if (!Array.isArray(draft[key])) continue;
      for (let i = 0; i < draft[key].length; i++) {
        const sEl = document.querySelector(`[data-block-start="${key}:${i}"]`);
        const eEl = document.querySelector(`[data-block-end="${key}:${i}"]`);
        const s = valueHHMM(sEl?.value);
        const e = valueHHMM(eEl?.value);
        draft[key][i].start = s || (sEl?.value || "").trim();
        draft[key][i].end = e || (eEl?.value || "").trim();
      }
    }
    // nannyWorking already captured
    return true;
  }

  if (stepKey === "bedtime") {
    const sel = $("#bedtimeBySel");
    draft.bedtimeBy = (sel?.value === "Julio") ? "Julio" : "Kristyn";
    return true;
  }

  if (stepKey === "appts") {
    // Read appointment edits
    draft.appointments = (draft.appointments || []).map(a => {
      const title = document.querySelector(`[data-appt-title="${a.id}"]`)?.value || a.title || "";
      const start = valueHHMM(document.querySelector(`[data-appt-start="${a.id}"]`)?.value) || (document.querySelector(`[data-appt-start="${a.id}"]`)?.value || "").trim();
      const end   = valueHHMM(document.querySelector(`[data-appt-end="${a.id}"]`)?.value) || (document.querySelector(`[data-appt-end="${a.id}"]`)?.value || "").trim();
      return { ...a, title, start, end };
    });
    // lightweight validation warning for wrong formats
    const bad = (draft.appointments || []).some(a => a.start && !valueHHMM(a.start) || a.end && !valueHHMM(a.end));
    if (bad) {
      showToast("One or more appointment times don’t look like HH:MM yet.");
      // Still allow continuing (user might fix on preview)
    }
    return true;
  }

  if (stepKey === "preview") return true;

  return true;
}

async function saveTomorrowPlanFromDraft() {
  const tomorrow = state.quiz.tomorrow;
  const draft = state.quiz.draft;

  // 1) Add brain dump tasks to master list
  const lines = (draft._brainDumpLines || []).slice(0, 80);
  for (const title of lines) {
    const t = {
      id: uid(),
      title,
      status: "open",
      completedAt: null,
      assignedDate: null,
      createdAt: new Date().toISOString(),
    };
    upsertTask(t);
    try { await syncTask(t); } catch {}
  }

  // 2) Mark cleanup tasks as done
  for (const id of (draft.cleanupTaskIds || [])) {
    const t = state.tasks.find(x => x.id === id);
    if (t && t.status !== "done") {
      t.status = "done";
      t.completedAt = new Date().toISOString();
      upsertTask(t);
      try { await syncTask(t); } catch {}
    }
  }

  // 3) Assign chosen tasks to tomorrow
  for (const id of (draft.tasksChosen || [])) {
    const t = state.tasks.find(x => x.id === id);
    if (t && t.status !== "done") {
      t.assignedDate = tomorrow;
      upsertTask(t);
      try { await syncTask(t); } catch {}
    }
  }

  // 4) Save the plan itself (without transient fields)
  const plan = {
    kristynUnavail: draft.kristynUnavail || [],
    julioUnavail: draft.julioUnavail || [],
    nannyWorking: !!draft.nannyWorking,
    nannyBlocks: draft.nannyBlocks || [],
    kaydenBlocks: draft.kaydenBlocks || [],
    bedtimeBy: draft.bedtimeBy === "Julio" ? "Julio" : "Kristyn",
    appointments: (draft.appointments || []).map(a => ({
      id: a.id || uid(),
      title: (a.title || "").trim(),
      start: valueHHMM(a.start) || "",
      end: valueHHMM(a.end) || "",
    })).filter(a => a.title || a.start || a.end),
    tasksChosen: draft.tasksChosen || [], // keep for context
    updatedAt: new Date().toISOString(),
    _v: 1,
  };

  setPlan(tomorrow, plan);
  showToast("Tomorrow plan saved.");
  closeEveningQuiz();
  render();

  try {
    await syncPlan(tomorrow);
  } catch (e) {
    console.warn(e);
    showToast("Saved locally (sync pending).");
  }
}

function previewTomorrow() {
  // Lightweight preview: open quiz to preview step (without forcing edits)
  if (!state.quiz.open) openEveningQuiz({ editExisting: true });
  state.quiz.step = QUIZ_STEPS.findIndex(s => s.key === "preview");
  if (state.quiz.step < 0) state.quiz.step = QUIZ_STEPS.length - 1;
  renderQuiz();
}

/* ---------------------------
   History modal (simple)
---------------------------- */
function openHistoryModal(isoDate) {
  const log = getLog(isoDate);
  if (!log) return;

  // Reuse quiz modal overlay for simplicity (friendly)
  const overlay = $("#quizOverlay");
  overlay.classList.add("show");

  $("#quizStepper").innerHTML = `<div class="step active">History • ${escapeHtml(isoDate)}</div>`;
  $("#quizHint").textContent = "Viewing saved day log";
  $("#quizBackBtn").style.visibility = "hidden";
  $("#quizNextBtn").textContent = "Close";
  $("#quizNextBtn").onclick = () => closeEveningQuiz();
  $("#quizCloseBtn").onclick = () => closeEveningQuiz();

  $("#quizBody").innerHTML = `
    <div class="note">Saved actuals for <b>${escapeHtml(isoDate)}</b>.</div>
    <div class="hr"></div>

    <div class="note"><b>Wake:</b> ${escapeHtml(log.wakeTime || "—")}</div>
    <div class="note"><b>Nap 1:</b> ${escapeHtml(log.nap1Start || "—")} → ${escapeHtml(log.nap1End || "—")}</div>
    <div class="note"><b>Nap 2:</b> ${escapeHtml(log.nap2Start || "—")} → ${escapeHtml(log.nap2End || "—")}</div>
    <div class="note"><b>Bedtime (tracking):</b> ${escapeHtml(log.bedtimeTime || "—")}</div>
    <div class="note"><b>Bath done:</b> ${log.bathDone ? "Yes ✅" : "No"}</div>

    <div class="hr"></div>
    <div class="note"><b>Overnight notes:</b></div>
    <div class="card" style="box-shadow:none; margin-top:10px">${escapeHtml(log.overnightNotes || "(none)")}</div>

    <div class="hr"></div>
    <div class="note">To edit: open the Today page on that date (coming soon). For now, you can re-save today’s log only.</div>
  `;
}

/* ---------------------------
   Settings actions
---------------------------- */
async function saveSettingsConfig() {
  const url = ($("#sbUrl")?.value || "").trim();
  const key = ($("#sbKey")?.value || "").trim();
  const householdId = ($("#householdId")?.value || "").trim();

  saveConfig({ supabaseUrl: url, supabaseAnonKey: key, householdId });
  showToast("Saved settings. Reconnecting…");

  await initSupabaseFromConfig();
  await refreshAll();
  render();
}

async function testConnection() {
  try {
    await initSupabaseFromConfig();
    if (!supabase) throw new Error("No Supabase config");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    showToast("Connection looks OK.");
  } catch (e) {
    console.warn(e);
    showToast("Could not connect. Double-check URL/key.");
  }
}

async function doAuth(mode) {
  const email = ($("#authEmail")?.value || "").trim();
  const pass = ($("#authPass")?.value || "").trim();
  if (!email || !pass) { showToast("Enter email + password."); return; }
  try {
    if (mode === "signin") await ensureSignedIn(email, pass);
    else await signUp(email, pass);
    showToast(mode === "signin" ? "Signed in." : "Account created.");
    await refreshAll();
    render();
  } catch (e) {
    console.warn(e);
    showToast(e?.message || "Auth failed.");
  }
}

function saveDefaults() {
  const expectedWake = valueHHMM($("#expectedWake")?.value) || DEFAULTS.expectedWake;
  const napMins = Number($("#defaultNapMinutes")?.value || DEFAULTS.defaultNapMinutes);
  const defaultNapMinutes = clamp(Math.round(napMins), 40, 90);
  saveConfig({ expectedWake, defaultNapMinutes });
  showToast("Saved planner defaults.");
  render();
}

/* ---------------------------
   PWA install
---------------------------- */
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (e) {
    console.warn("SW registration failed:", e);
  }
}

/* ---------------------------
   Routing
---------------------------- */
function setRoute(hash) {
  const allowed = ["#evening","#today","#tasks","#history","#settings"];
  state.route = allowed.includes(hash) ? hash : "#today";
  localStorage.setItem(LS.lastView, state.route);
  render();
}

function setupRouting() {
  window.addEventListener("hashchange", () => setRoute(location.hash || "#today"));
  const saved = localStorage.getItem(LS.lastView);
  setRoute(location.hash || saved || "#today");
}

/* ---------------------------
   Boot
---------------------------- */
async function boot() {
  listenConnectivity();
  await registerServiceWorker();

  await initSupabaseFromConfig();

  // Load cache immediately, then refresh from Supabase if possible
  await refreshAll();

  setupRouting();
  setAuthPill();

  // Allow ESC to close modal
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.quiz.open) closeEveningQuiz();
  });

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((e) => {
    console.error(e);
    showToast("Something went wrong booting the app.");
  });
});
