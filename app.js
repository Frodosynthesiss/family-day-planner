// Family Day Planner
// - Tonight quiz (modal wizard) saves tomorrow plan, appointments, bath plan, and focus items.
// - Today logs wake + naps; bedtime + overnight notes are tracking-only (no schedule effect).
// - Schedule exports to Google Calendar (for Skylight). Open time is left blank (no "play" blocks).
//
// OPTIONAL SYNC:
// If you want the running list + day plans to be shared between devices (iPhones + Android tablet),
// enable Supabase below and add your keys. Otherwise, everything works per-device via localStorage.

// ==========================
// CONFIG
// ==========================
const GOOGLE_OAUTH_CLIENT_ID =
  "131465293548-qu9aotcttbpqqu4gnulj9paii84aikcl.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events";
const DEFAULT_CALENDAR_ID =
  "57c409db61dc56c175c0f136a8f2fdc610fdde4539de65fb1c43ce2758f72336@group.calendar.google.com";
const TIME_ZONE = "America/Los_Angeles";

// ---- Supabase (optional sync) ----
// 1) Set ENABLE_SUPABASE_SYNC = true
// 2) Fill SUPABASE_URL, SUPABASE_ANON_KEY, HOUSEHOLD_ID
// 3) Create the tables/policies (SQL provided at bottom of this file)
// 4) Sign in on each device in Settings
const ENABLE_SUPABASE_SYNC = false;
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";
const HOUSEHOLD_ID = ""; // UUID from your households table

let supabase = null;
async function initSupabaseIfEnabled() {
  if (!ENABLE_SUPABASE_SYNC) return;
  // dynamic import keeps the file working even if you don't use Supabase
  const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ==========================
// DOM
// ==========================
const $ = (id) => document.getElementById(id);

// Tabs
const tabTonight = $("tabTonight");
const tabToday = $("tabToday");
const tabWeek = $("tabWeek");
const tabSettings = $("tabSettings");
const screenTonight = $("screenTonight");
const screenToday = $("screenToday");
const screenWeek = $("screenWeek");
const screenSettings = $("screenSettings");

// Tonight screen buttons
const startQuizBtn = $("startQuizBtn");
const quickPreviewBtn = $("quickPreviewBtn");
const tonightStatus = $("tonightStatus");
const tomorrowPreview = $("tomorrowPreview");

// Today inputs
const todayDate = $("todayDate");
const todayWake = $("todayWake");
const nannyView = $("nannyView");
const nap1Start = $("nap1Start");
const nap1End = $("nap1End");
const nap2Start = $("nap2Start");
const nap2End = $("nap2End");

const logWakeBtn = $("logWakeBtn");
const nap1StartBtn = $("nap1StartBtn");
const nap1EndBtn = $("nap1EndBtn");
const nap2StartBtn = $("nap2StartBtn");
const nap2EndBtn = $("nap2EndBtn");
const reflowBtn = $("reflowBtn");

const bedtimeActual = $("bedtimeActual");
const bedtimeNowBtn = $("bedtimeNowBtn");
const nightNotes = $("nightNotes");

const calendarId = $("calendarId");
const googleBtn = $("googleBtn");
const publishBtn = $("publishBtn");
const clearBtn = $("clearBtn");
const todayStatus = $("todayStatus");

const todayPreview = $("todayPreview");
const nowPill = $("nowPill");
const nextPill = $("nextPill");

// Running list (today screen)
const brainDumpAdd = $("brainDumpAdd");
const brainDumpAddBtn = $("brainDumpAddBtn");
const showFocusBtn = $("showFocusBtn");
const showAllBtn = $("showAllBtn");
const brainDumpList = $("brainDumpList");

// Week view
const weekStart = $("weekStart");
const refreshWeekBtn = $("refreshWeekBtn");
const weekList = $("weekList");

// Settings inputs
const setWakeDefault = $("setWakeDefault");
const setNapDefault = $("setNapDefault");
const setSoloBedBuffer = $("setSoloBedBuffer");
const setLastBath = $("setLastBath");
const saveSettingsBtn = $("saveSettingsBtn");
const settingsStatus = $("settingsStatus");

// Auth + local transfer (settings)
const authEmail = $("authEmail");
const authPassword = $("authPassword");
const signInBtn = $("signInBtn");
const signOutBtn = $("signOutBtn");
const authStatus = $("authStatus");

const exportLocalBtn = $("exportLocalBtn");
const importLocalBtn = $("importLocalBtn");
const localTransferBox = $("localTransferBox");

// Quiz modal
const quizOverlay = $("quizOverlay");
const quizCloseBtn = $("quizCloseBtn");
const quizTitle = $("quizTitle");
const quizHint = $("quizHint");
const quizProgress = $("quizProgress");
const quizContent = $("quizContent");
const quizBackBtn = $("quizBackBtn");
const quizSkipBtn = $("quizSkipBtn");
const quizNextBtn = $("quizNextBtn");
const quizFooterStatus = $("quizFooterStatus");

// ==========================
// Storage keys
// ==========================
const KEY_SETTINGS = "fdp:settings";
const KEY_BACKLOG = "fdp:backlog"; // local fallback (per-device) if not using sync

const keyPlan = (dateStr) => `fdp:plan:${dateStr}`;
const keyLog = (dateStr) => `fdp:log:${dateStr}`;
const keyPublishedIds = (dateStr) => `fdp:publishedEventIds:${dateStr}`;

// ==========================
// Defaults / Settings
// ==========================
const defaultSettings = {
  wakeDefault: "07:00",
  napDefaultMin: 75,          // midpoint
  soloBedtimeBufferMin: 10,   // if one parent is doing bedtime solo
  lastBathDate: null,         // YYYY-MM-DD
};

function loadSettings() {
  const raw = localStorage.getItem(KEY_SETTINGS);
  if (!raw) return { ...defaultSettings };
  try {
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}
function saveSettings(s) {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
}
let settings = loadSettings();

// ==========================
// Tiny helpers
// ==========================
function setStatus(el, msg, kind = "muted") {
  if (!el) return;
  const cls = kind === "error" ? "status error" : kind === "success" ? "status success" : "status muted";
  el.innerHTML = `<div class="${cls}">${escapeHtml(msg)}</div>`;
}

function pad2(n) { return String(n).padStart(2, "0"); }

function nowHHMM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function dateToYMD(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function ymdToDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function addDays(dateStr, days) {
  const d = ymdToDate(dateStr);
  d.setDate(d.getDate() + days);
  return dateToYMD(d);
}

function makeDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0);
}

function addMin(dt, minutes) {
  return new Date(dt.getTime() + minutes * 60000);
}

function toRFC3339Local(dt) {
  const y = dt.getFullYear();
  const m = pad2(dt.getMonth() + 1);
  const d = pad2(dt.getDate());
  const hh = pad2(dt.getHours());
  const mm = pad2(dt.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
}

function safeJSONParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTime(dt) {
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function clampTimeStr(t, fallback) {
  if (!t) return fallback;
  if (!/^\d{2}:\d{2}$/.test(t)) return fallback;
  return t;
}

function newId(prefix="id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

// ==========================
// Tabs
// ==========================
function setActiveTab(which) {
  const tabs = [tabTonight, tabToday, tabWeek, tabSettings];
  tabs.forEach(t => t.classList.remove("active"));
  screenTonight.style.display = "none";
  screenToday.style.display = "none";
  screenWeek.style.display = "none";
  screenSettings.style.display = "none";

  if (which === "tonight") { tabTonight.classList.add("active"); screenTonight.style.display = ""; }
  if (which === "today") { tabToday.classList.add("active"); screenToday.style.display = ""; }
  if (which === "week") { tabWeek.classList.add("active"); screenWeek.style.display = ""; }
  if (which === "settings") { tabSettings.classList.add("active"); screenSettings.style.display = ""; }
}

tabTonight.onclick = () => setActiveTab("tonight");
tabToday.onclick = () => setActiveTab("today");
tabWeek.onclick = () => setActiveTab("week");
tabSettings.onclick = () => setActiveTab("settings");

// ==========================
// Data shapes
// ==========================
function defaultPlan(dateStr) {
  return {
    date: dateStr,
    wakeDefault: settings.wakeDefault,

    // Considerations
    considerations: {
      bothWFH: false,
      // Unavailability blocks: if a parent is unavailable, naps will be assigned to the other parent if available.
      // If BOTH parents are unavailable, naps will be assigned to Kayden/Nanny (coverage) if available.
      unavailability: {
        Kristyn: [], // [{start,end}]
        Julio: [],   // [{start,end}]
      },
      coverage: {
        Nanny: [],   // [{start,end}]
        Kayden: [],  // [{start,end}]
      },
      bedtimeOwner: "Kristyn",    // Kristyn|Julio|Split
    },

    // Appointments
    appointments: {
      tonight: [],   // array of {id,title,start,end}
      tomorrow: [],  // array of {id,title,start,end}
    },

    // Bath plan
    bathPlan: {
      wantsBath: false,           // should schedule a bath block
      preferredStart: null,       // "HH:MM" (optional)
      reason: "",                 // optional note
    },

    // Notes/one-offs (kept for backwards compatibility)
    tasks: "",
  };
}

function defaultLog() {
  return {
    wakeActual: null,
    nap1Start: null,
    nap1End: null,
    nap2Start: null,
    nap2End: null,
    bedtimeActual: null, // tracking-only
    nightNotes: "",
  };
}

// ==========================
// Local storage load/save
// ==========================
function loadPlanLocal(dateStr) {
  const raw = localStorage.getItem(keyPlan(dateStr));
  if (!raw) return null;
  return safeJSONParse(raw, null);
}
function savePlanLocal(plan) {
  localStorage.setItem(keyPlan(plan.date), JSON.stringify(plan));
}

function loadLogLocal(dateStr) {
  const raw = localStorage.getItem(keyLog(dateStr));
  if (!raw) return { ...defaultLog() };
  const parsed = safeJSONParse(raw, null);
  return parsed ? { ...defaultLog(), ...parsed } : { ...defaultLog() };
}
function saveLogLocal(dateStr, log) {
  localStorage.setItem(keyLog(dateStr), JSON.stringify(log));
}

// Backlog local (fallback)
function loadBacklogLocal() {
  const raw = localStorage.getItem(KEY_BACKLOG);
  const list = safeJSONParse(raw || "[]", []);
  return Array.isArray(list) ? list : [];
}
function saveBacklogLocal(list) {
  localStorage.setItem(KEY_BACKLOG, JSON.stringify(list));
}

// ==========================
// Supabase storage (optional sync)
// ==========================
async function isSignedIn() {
  if (!ENABLE_SUPABASE_SYNC || !supabase) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

async function refreshAuthStatus() {
  if (!authStatus) return;
  if (!ENABLE_SUPABASE_SYNC) {
    setStatus(authStatus, "Sync disabled (ENABLE_SUPABASE_SYNC=false).", "muted");
    return false;
  }
  if (!supabase) {
    setStatus(authStatus, "Supabase not initialized. Check SUPABASE_URL / ANON_KEY.", "error");
    return false;
  }
  const signed = await isSignedIn();
  setStatus(authStatus, signed ? "Signed in ✅ (shared sync enabled)" : "Not signed in", signed ? "success" : "muted");
  return signed;
}

async function signIn(email, password) {
  if (!ENABLE_SUPABASE_SYNC || !supabase) throw new Error("Sync is not enabled.");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signOut() {
  if (!ENABLE_SUPABASE_SYNC || !supabase) return;
  await supabase.auth.signOut();
}

// Plan remote
async function loadPlanRemote(dateStr) {
  const { data, error } = await supabase
    .from("day_plans")
    .select("date, household_id, plan_json")
    .eq("household_id", HOUSEHOLD_ID)
    .eq("date", dateStr)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return safeJSONParse(data.plan_json, null);
}

async function savePlanRemote(plan) {
  const payload = {
    household_id: HOUSEHOLD_ID,
    date: plan.date,
    plan_json: JSON.stringify(plan),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("day_plans")
    .upsert(payload, { onConflict: "household_id,date" });
  if (error) throw error;
}

// Log remote
async function loadLogRemote(dateStr) {
  const { data, error } = await supabase
    .from("day_logs")
    .select("date, household_id, log_json")
    .eq("household_id", HOUSEHOLD_ID)
    .eq("date", dateStr)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ...defaultLog() };
  const parsed = safeJSONParse(data.log_json, null);
  return parsed ? { ...defaultLog(), ...parsed } : { ...defaultLog() };
}

async function saveLogRemote(dateStr, log) {
  const payload = {
    household_id: HOUSEHOLD_ID,
    date: dateStr,
    log_json: JSON.stringify(log),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("day_logs")
    .upsert(payload, { onConflict: "household_id,date" });
  if (error) throw error;
}

// Backlog remote
async function fetchBacklogRemote() {
  const { data, error } = await supabase
    .from("backlog_tasks")
    .select("id, text, done, focus_date, created_at, done_at")
    .eq("household_id", HOUSEHOLD_ID)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function addBacklogRemote(text) {
  const t = (text || "").trim();
  if (!t) return;
  const { error } = await supabase.from("backlog_tasks").insert({
    household_id: HOUSEHOLD_ID,
    text: t,
    done: false,
    focus_date: null
  });
  if (error) throw error;
}

async function toggleBacklogDoneRemote(id, done) {
  const { error } = await supabase
    .from("backlog_tasks")
    .update({ done: !!done, done_at: done ? new Date().toISOString() : null })
    .eq("household_id", HOUSEHOLD_ID)
    .eq("id", id);
  if (error) throw error;
}

async function setBacklogFocusDateRemote(id, focusDateOrNull) {
  const { error } = await supabase
    .from("backlog_tasks")
    .update({ focus_date: focusDateOrNull })
    .eq("household_id", HOUSEHOLD_ID)
    .eq("id", id);
  if (error) throw error;
}

async function removeBacklogRemote(id) {
  const { error } = await supabase
    .from("backlog_tasks")
    .delete()
    .eq("household_id", HOUSEHOLD_ID)
    .eq("id", id);
  if (error) throw error;
}

// Unified accessors (choose remote if enabled + signed in)
async function loadPlan(dateStr) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    const p = await loadPlanRemote(dateStr);
    return p;
  }
  return loadPlanLocal(dateStr);
}

async function savePlan(plan) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    await savePlanRemote(plan);
  }
  savePlanLocal(plan);
}

async function loadLog(dateStr) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    return await loadLogRemote(dateStr);
  }
  return loadLogLocal(dateStr);
}

async function saveLog(dateStr, log) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    await saveLogRemote(dateStr, log);
  }
  saveLogLocal(dateStr, log);
}

async function fetchBacklog() {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    return await fetchBacklogRemote();
  }
  return loadBacklogLocal();
}

async function addBacklogItem(text) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    await addBacklogRemote(text);
  } else {
    const list = loadBacklogLocal();
    const t = (text || "").trim();
    if (!t) return;
    list.push({ id: newId("task"), text: t, done: false, focus_date: null, created_at: new Date().toISOString(), done_at: null });
    saveBacklogLocal(list);
  }
}

async function toggleBacklogDone(id, done) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    await toggleBacklogDoneRemote(id, done);
  } else {
    const list = loadBacklogLocal();
    const item = list.find(x => x.id === id);
    if (item) { item.done = !!done; item.done_at = done ? new Date().toISOString() : null; }
    saveBacklogLocal(list);
  }
}

async function setBacklogFocusDate(id, focusDateOrNull) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    await setBacklogFocusDateRemote(id, focusDateOrNull);
  } else {
    const list = loadBacklogLocal();
    const item = list.find(x => x.id === id);
    if (item) item.focus_date = focusDateOrNull;
    saveBacklogLocal(list);
  }
}

async function removeBacklogItem(id) {
  if (ENABLE_SUPABASE_SYNC && supabase && (await isSignedIn())) {
    await removeBacklogRemote(id);
  } else {
    const list = loadBacklogLocal().filter(x => x.id !== id);
    saveBacklogLocal(list);
  }
}

// ==========================
// Schedule engine
// ==========================
// Blocks: { id, title, start, end, category, visibility, fixed? }
function baseSchedule(dateStr, plan, log) {
  const napDefault = settings.napDefaultMin;

  const bedtimeOwnerValue = plan?.considerations?.bedtimeOwner || "Kristyn";
  const soloBedtime = bedtimeOwnerValue === "Kristyn" || bedtimeOwnerValue === "Julio";
  const soloBuffer = soloBedtime ? settings.soloBedtimeBufferMin : 0;

  const wakeTime = log.wakeActual || plan?.wakeDefault || settings.wakeDefault;
  const wake = makeDate(dateStr, wakeTime);

  // Wake window midpoints (your ranges)
  const ww1 = 195; // 3.25h
  const ww2 = 225; // 3.75h
  const ww3 = 248; // 4.13h

  const blocks = [];
  const add = (b) => blocks.push(b);

  // Bedtime label
  const bedtimeLabel =
    bedtimeOwnerValue === "Split" ? "Bedtime (Split)" : `Bedtime (${bedtimeOwnerValue})`;

  // Morning routine
  let t = wake;
  add({ id:"wake", title:"Wake up", start:t, end:addMin(t,5), category:"baby", visibility:"nanny" });
  t = addMin(t,5);
  add({ id:"cuddle", title:"Family cuddle", start:t, end:addMin(t,15), category:"family", visibility:"full" });
  t = addMin(t,15);
  add({ id:"dress", title:"Get dressed", start:t, end:addMin(t,15), category:"baby", visibility:"nanny" });
  t = addMin(t,15);
  add({ id:"breakfast_prep", title:"Prep baby's breakfast", start:t, end:addMin(t,20), category:"baby", visibility:"nanny" });
  t = addMin(t,20);
  add({ id:"breakfast", title:"Breakfast", start:t, end:addMin(t,20), category:"baby", visibility:"nanny" });
  t = addMin(t,20);
  add({ id:"teeth_am", title:"Brush teeth", start:t, end:addMin(t,5), category:"baby", visibility:"nanny" });
  t = addMin(t,5);

  // Nap 1 timing: actuals if available; else WW1 midpoint
  const nap1StartT = log.nap1Start || toHHMM(addMin(wake, ww1));
  const nap1StartDt = makeDate(dateStr, nap1StartT);

  const nap1EndT = log.nap1End || toHHMM(addMin(nap1StartDt, napDefault));
  const nap1EndDt = makeDate(dateStr, nap1EndT);

  const nap1Care = caregiverFor(addMin(nap1StartDt, -10), nap1EndDt);

  add({
    id:"nap1_routine",
    title:`Nap routine (${nap1Care})`,
    start:addMin(nap1StartDt,-10),
    end:nap1StartDt,
    category:"baby",
    visibility:"nanny"
  });

  add({
    id:"nap1",
    title:`Nap 1 (${nap1Care})`,
    start:nap1StartDt,
    end:nap1EndDt,
    category:"sleep",
    visibility:"nanny"
  });

  // Lunch + snack anchors (no play blocks)
  const lunchPrepStart = addMin(nap1EndDt, 90);
  add({ id:"lunch_prep", title:"Prep baby's lunch", start:lunchPrepStart, end:addMin(lunchPrepStart,20), category:"baby", visibility:"nanny" });
  add({ id:"lunch", title:"Lunch", start:addMin(lunchPrepStart,20), end:addMin(lunchPrepStart,45), category:"baby", visibility:"nanny" });

  const snackStart = addMin(nap1EndDt, 170);
  add({ id:"snack", title:"Snack + milk", start:snackStart, end:addMin(snackStart,15), category:"baby", visibility:"nanny" });

  // Nap 2 timing: actuals or WW2 midpoint from nap1 end
  const nap2StartT = log.nap2Start || toHHMM(addMin(nap1EndDt, ww2));
  const nap2StartDt = makeDate(dateStr, nap2StartT);

  const nap2EndT = log.nap2End || toHHMM(addMin(nap2StartDt, napDefault));
  const nap2EndDt = makeDate(dateStr, nap2EndT);

  const nap2Care = caregiverFor(addMin(nap2StartDt, -10), nap2EndDt);

  add({
    id:"nap2_routine",
    title:`Nap routine (${nap2Care})`,
    start:addMin(nap2StartDt,-10),
    end:nap2StartDt,
    category:"baby",
    visibility:"nanny"
  });

  add({
    id:"nap2",
    title:`Nap 2 (${nap2Care})`,
    start:nap2StartDt,
    end:nap2EndDt,
    category:"sleep",
    visibility:"nanny"
  });

  // Evening anchors
  const dinnerPrepStart = addMin(nap2EndDt, 120);
  const dinnerPrepStartAdj = soloBedtime ? addMin(dinnerPrepStart, -10) : dinnerPrepStart;

  add({ id:"dinner_prep", title:"Prep baby's dinner", start:dinnerPrepStartAdj, end:addMin(dinnerPrepStartAdj,30), category:"baby", visibility:"nanny" });
  add({ id:"dinner", title:"Dinner", start:addMin(dinnerPrepStartAdj,30), end:addMin(dinnerPrepStartAdj,55), category:"baby", visibility:"nanny" });

  // Bath planning: bath every 3 days, but can't be when Julio is working/unavailable.
  // We'll schedule at preferredStart if set, otherwise default window after dinner.
  const wantsBath = !!plan?.bathPlan?.wantsBath;
  const preferred = plan?.bathPlan?.preferredStart;
  let bathStart = preferred ? makeDate(dateStr, preferred) : addMin(dinnerPrepStartAdj, 70);
  let bathEnd = addMin(bathStart, 15);

  const ua0 = plan?.considerations?.unavailability || { Kristyn: [], Julio: [] };
  const cov0 = plan?.considerations?.coverage || { Nanny: [], Kayden: [] };

  const julioUnavail = (ua0.Julio || [])
    .filter(x => x && x.start && x.end)
    .map(x => ({ start: makeDate(dateStr, x.start), end: makeDate(dateStr, x.end), raw: x }));

  const kristynUnavail = (ua0.Kristyn || [])
    .filter(x => x && x.start && x.end)
    .map(x => ({ start: makeDate(dateStr, x.start), end: makeDate(dateStr, x.end), raw: x }));

  const nannyCov = (cov0.Nanny || [])
    .filter(x => x && x.start && x.end)
    .map(x => ({ start: makeDate(dateStr, x.start), end: makeDate(dateStr, x.end), raw: x }));

  const kaydenCov = (cov0.Kayden || [])
    .filter(x => x && x.start && x.end)
    .map(x => ({ start: makeDate(dateStr, x.start), end: makeDate(dateStr, x.end), raw: x }));

  function overlapsAny(s, e, ranges) {
    return (ranges || []).some(r => overlaps(s, e, r.start, r.end));
  }
  function coveredFully(s, e, ranges) {
    return (ranges || []).some(r => r.start.getTime() <= s.getTime() && r.end.getTime() >= e.getTime());
  }
  function caregiverFor(s, e) {
    const kAvail = !overlapsAny(s, e, kristynUnavail);
    const jAvail = !overlapsAny(s, e, julioUnavail);
    if (kAvail && jAvail) return "Kristyn or Julio";
    if (kAvail) return "Kristyn";
    if (jAvail) return "Julio";
    // Both unavailable → only then assign to coverage
    if (coveredFully(s, e, kaydenCov)) return "Kayden";
    if (coveredFully(s, e, nannyCov)) return "Nanny";
    return "Uncovered";
  }

  if (wantsBath) {
    if (overlapsAny(bathStart, bathEnd, julioUnavail)) {
      // If bath overlaps Julio unavailable, skip bath and add a note block for parents (so you see why).
      add({
        id:"bath_skipped",
        title:"Bath skipped (Julio unavailable)",
        start:bathStart,
        end:bathEnd,
        category:"note",
        visibility:"full"
      });
    } else {
      add({ id:"bath", title:"Bath", start:bathStart, end:bathEnd, category:"baby", visibility:"nanny" });
    }
  }

  // PM snack + teeth + bedtime routine (anchored after bath time window)
  const anchorAfterBath = wantsBath ? bathEnd : addMin(dinnerPrepStartAdj, 85);
  add({ id:"snack_pm", title:"Snack + milk", start:anchorAfterBath, end:addMin(anchorAfterBath,15), category:"baby", visibility:"nanny" });
  add({ id:"teeth_pm", title:"Brush teeth", start:addMin(anchorAfterBath,15), end:addMin(anchorAfterBath,20), category:"baby", visibility:"nanny" });

  // Bedtime routine: add solo buffer if solo bedtime
  const bedRoutineStart = addMin(anchorAfterBath,20);
  const bedRoutineEnd = addMin(bedRoutineStart, 25 + soloBuffer);
  add({ id:"bed_routine", title: bedtimeLabel, start: bedRoutineStart, end: bedRoutineEnd, category:"baby", visibility:"nanny" });

  // Parent after-bed tasks are NOT scheduled automatically anymore (you asked to remove floating tasks)
  // You can add them as appointments if you want them visible on the calendar.

  // Unavailability + coverage blocks
  for (const r of julioUnavail) {
    add({
      id: newId("julio_unavail"),
      title: `Julio unavailable (${toHHMM(r.start)}–${toHHMM(r.end)})`,
      start: r.start,
      end: r.end,
      category: "availability",
      visibility: "full",
      fixed: true
    });
  }

  for (const r of kristynUnavail) {
    add({
      id: newId("kristyn_unavail"),
      title: `Kristyn unavailable (${toHHMM(r.start)}–${toHHMM(r.end)})`,
      start: r.start,
      end: r.end,
      category: "availability",
      visibility: "full",
      fixed: true
    });
  }

  for (const r of kaydenCov) {
    add({
      id: newId("kayden_cov"),
      title: `Kayden coverage (${toHHMM(r.start)}–${toHHMM(r.end)})`,
      start: r.start,
      end: r.end,
      category: "availability",
      visibility: "full",
      fixed: true
    });
  }

  for (const r of nannyCov) {
    add({
      id: newId("nanny_cov"),
      title: `Nanny coverage (${toHHMM(r.start)}–${toHHMM(r.end)})`,
      start: r.start,
      end: r.end,
      category: "availability",
      visibility: "full",
      fixed: true
    });
  }

// Sort
  blocks.sort((a,b)=>a.start-b.start);
  return blocks;
}

function toHHMM(dt) {
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

// Apply fixed appointments to base schedule
// Rule: appointments are fixed. If an appointment overlaps an existing block, we push the overlapped block
// and all later *non-fixed* blocks forward so the appointment stays intact.
// If the appointment lands in open time, nothing moves.
function applyAppointments(dateStr, blocks, appts) {
  if (!appts || !appts.length) return blocks;
  const fixed = appts
    .filter(a => a && a.start && a.end)
    .map(a => ({
      id: a.id || newId("appt"),
      title: a.title || "Appointment",
      start: makeDate(dateStr, a.start),
      end: makeDate(dateStr, a.end),
      category: "appointment",
      visibility: "full",
      fixed: true
    }))
    .sort((a,b)=>a.start-b.start);

  // Clone blocks (we may shift)
  const out = blocks.map(b => ({...b}));

  for (const f of fixed) {
    // Insert fixed itself
    out.push(f);

    // Shift overlapping blocks that are not fixed
    // We'll do it in chronological order so shifts cascade forward.
    out.sort((a,b)=>a.start-b.start);

    for (let i=0; i<out.length; i++) {
      const b = out[i];
      if (b.fixed) continue;
      if (!overlaps(b.start, b.end, f.start, f.end)) continue;

      // We only shift blocks that start before appointment ends
      const shiftBy = (f.end.getTime() - Math.max(b.start.getTime(), f.start.getTime())) / 60000;
      if (shiftBy <= 0) continue;

      // Shift this block and any subsequent non-fixed blocks that start at/after this block's start
      const pivot = b.start.getTime();
      for (let j=0; j<out.length; j++) {
        const x = out[j];
        if (x.fixed) continue;
        if (x.start.getTime() >= pivot) {
          x.start = addMin(x.start, shiftBy);
          x.end = addMin(x.end, shiftBy);
        }
      }
      // re-sort before continuing
      out.sort((a,b)=>a.start-b.start);
      break; // re-check with updated positions
    }
  }

  // Final sort
  out.sort((a,b)=>a.start-b.start);
  return out;
}

function generateSchedule(dateStr, plan, log, viewMode) {
  const blocks0 = baseSchedule(dateStr, plan, log);

  // Use tomorrow appointments if schedule for tomorrow; otherwise use plan's appts for that date
  const appts = plan?.appointments?.tomorrow || [];
  const withAppts = applyAppointments(dateStr, blocks0, appts);

  const filtered = viewMode === "nanny"
    ? withAppts.filter(b => b.visibility !== "full")
    : withAppts;
  filtered.sort((a,b)=>a.start-b.start);
  return filtered;
}

// ==========================
// Rendering
// ==========================
function renderScheduleList(ulEl, blocks) {
  ulEl.innerHTML = "";
  if (!blocks.length) {
    const li = document.createElement("li");
    li.textContent = "(No schedule yet)";
    ulEl.appendChild(li);
    return;
  }

  blocks.forEach(b => {
    const li = document.createElement("li");
    const time = `${fmtTime(b.start)}–${fmtTime(b.end)}`;
    const cat = b.category ? ` <span class="catTag">• ${escapeHtml(b.category)}</span>` : "";
    li.innerHTML = `<span class="timeTag">${escapeHtml(time)}</span> ${escapeHtml(b.title)}${cat}`;
    ulEl.appendChild(li);
  });
}

function renderTimeline(containerEl, blocks, opts = {}) {
  // 2-hour grid timeline. Shows only scheduled blocks; open time is blank.
  const startHour = opts.startHour ?? 0;
  const endHour = opts.endHour ?? 24;
  const pxPerMin = opts.pxPerMin ?? 1.2; // 24h ≈ 1728px tall (scrollable)
  const totalMins = (endHour - startHour) * 60;

  containerEl.innerHTML = "";
  const viewport = document.createElement("div");
  viewport.className = "timelineViewport";

  const inner = document.createElement("div");
  inner.className = "timelineInner";
  inner.style.minHeight = `${Math.max(900, totalMins * pxPerMin)}px`;

  // Markers every 2 hours
  for (let h = startHour; h <= endHour; h += 2) {
    const minsFromStart = (h - startHour) * 60;
    const top = minsFromStart * pxPerMin;

    const label = document.createElement("div");
    label.className = "timeMarker";
    label.style.top = `${top}px`;
    label.textContent = fmtHourLabel(h);

    const line = document.createElement("div");
    line.className = "gridLine";
    line.style.top = `${top}px`;

    inner.appendChild(label);
    inner.appendChild(line);
  }

  // Blocks
  if (!blocks?.length) {
    const empty = document.createElement("div");
    empty.className = "status muted";
    empty.style.margin = "12px";
    empty.textContent = "No schedule yet — log a wake time or run the tonight quiz.";
    viewport.appendChild(empty);
    containerEl.appendChild(viewport);
    return;
  }

  blocks.forEach(b => {
    const s = b.start;
    const e = b.end;
    const startMins = (s.getHours() - startHour) * 60 + s.getMinutes();
    const endMins = (e.getHours() - startHour) * 60 + e.getMinutes();
    const top = startMins * pxPerMin;
    const height = Math.max(18, (endMins - startMins) * pxPerMin);

    // Skip if outside window
    if (endMins < 0 || startMins > totalMins) return;

    const block = document.createElement("div");
    block.className = "tlBlock";
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;

    const title = document.createElement("div");
    title.className = "tltitle";
    title.textContent = b.title;

    const time = document.createElement("div");
    time.className = "tltime";
    time.textContent = `${fmtTime(b.start)} – ${fmtTime(b.end)}`;

    block.appendChild(title);
    block.appendChild(time);

    if (b.category) {
      const meta = document.createElement("div");
      meta.className = "tlmeta";
      meta.textContent = b.category;
      block.appendChild(meta);
    }

    inner.appendChild(block);
  });

  viewport.appendChild(inner);
  containerEl.appendChild(viewport);
}

function fmtHourLabel(h24) {
  // h24: 0-24
  const h = h24 % 24;
  const ampm = h < 12 ? "AM" : "PM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:00 ${ampm}`;
}



function updateNowNext(blocks) {
  const now = new Date();
  const current = blocks.find(b => now >= b.start && now < b.end);
  const next = blocks.find(b => b.start > now);

  nowPill.textContent = `Now — ${current ? current.title : "—"}`;
  nextPill.textContent = `Next — ${next ? next.title : "—"}`;
}

// ==========================
// Running list rendering
// ==========================
let runningListMode = "focus"; // focus|all

async function refreshRunningList() {
  try {
    const dateStr = todayDate.value;
    const list = await fetchBacklog();

    let view = list;
    if (runningListMode === "focus" && dateStr) {
      view = list.filter(x => !x.done && x.focus_date === dateStr);
    }

    // Sort: undone first, then created_at
    view = [...view].sort((a,b) => Number(a.done) - Number(b.done) || (new Date(a.created_at) - new Date(b.created_at)));

    brainDumpList.innerHTML = "";
    if (!view.length) {
      brainDumpList.innerHTML = `<div class="muted">${runningListMode === "focus" ? "No focus items for this day." : "Nothing yet."}</div>`;
      return;
    }

    for (const item of view) {
      const row = document.createElement("div");
      row.className = "apptCard";
      row.innerHTML = `
        <div class="apptHeader">
          <div style="display:flex; align-items:flex-start; gap:10px; width:100%;">
            <input type="checkbox" data-done="${escapeHtml(item.id)}" ${item.done ? "checked" : ""} style="width:auto; margin-top:3px;" />
            <div style="flex:1;">
              <div class="apptTitle" style="${item.done ? "text-decoration:line-through; color:#6b7280;" : ""}">
                ${escapeHtml(item.text)}
              </div>
              <div class="apptMeta">${item.focus_date ? `Focus: ${escapeHtml(item.focus_date)}` : ""}</div>
            </div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${dateStr ? `<button type="button" class="ghost" data-focus="${escapeHtml(item.id)}">${item.focus_date === dateStr ? "Unfocus" : "Focus"}</button>` : ""}
            <button type="button" class="danger" data-del="${escapeHtml(item.id)}">Remove</button>
          </div>
        </div>
      `;
      brainDumpList.appendChild(row);
    }

    brainDumpList.querySelectorAll("input[data-done]").forEach(cb => {
      cb.onchange = async () => {
        await toggleBacklogDone(cb.getAttribute("data-done"), cb.checked);
        await refreshRunningList();
      };
    });
    brainDumpList.querySelectorAll("button[data-del]").forEach(btn => {
      btn.onclick = async () => {
        await removeBacklogItem(btn.getAttribute("data-del"));
        await refreshRunningList();
      };
    });
    brainDumpList.querySelectorAll("button[data-focus]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-focus");
        const listNow = await fetchBacklog();
        const item = listNow.find(x => x.id === id);
        const newVal = item?.focus_date === dateStr ? null : dateStr;
        await setBacklogFocusDate(id, newVal);
        await refreshRunningList();
      };
    });

  } catch (e) {
    brainDumpList.innerHTML = `<div class="status error">${escapeHtml(e.message || String(e))}</div>`;
  }
}

// ==========================
// Today UI + reflow
// ==========================
async function loadTodayUI(dateStr) {
  todayDate.value = dateStr;
  calendarId.value = localStorage.getItem("calendarId") || DEFAULT_CALENDAR_ID;

  const plan = (await loadPlan(dateStr)) || defaultPlan(dateStr);
  const log = await loadLog(dateStr);

  // Wake default if needed
  const wake = log.wakeActual || plan?.wakeDefault || settings.wakeDefault;
  todayWake.value = wake;

  nap1Start.value = log.nap1Start || "";
  nap1End.value = log.nap1End || "";
  nap2Start.value = log.nap2Start || "";
  nap2End.value = log.nap2End || "";

  bedtimeActual.value = log.bedtimeActual || "";
  nightNotes.value = log.nightNotes || "";

  await reflowToday(false);
  await refreshRunningList();
}

async function reflowToday(showToast=true) {
  const dateStr = todayDate.value;
  if (!dateStr) return;

  const plan = (await loadPlan(dateStr)) || defaultPlan(dateStr);
  const log = await loadLog(dateStr);

  // Pull from UI into log, then save
  log.wakeActual = todayWake.value || plan.wakeDefault || settings.wakeDefault;
  log.nap1Start = nap1Start.value || null;
  log.nap1End = nap1End.value || null;
  log.nap2Start = nap2Start.value || null;
  log.nap2End = nap2End.value || null;
  log.bedtimeActual = bedtimeActual.value || null;
  log.nightNotes = nightNotes.value || "";

  await saveLog(dateStr, log);

  const viewMode = nannyView.checked ? "nanny" : "full";
  const blocks = generateSchedule(dateStr, plan, log, viewMode);

  renderTimeline(todayPreview, blocks);
  updateNowNext(blocks);

  if (showToast) setStatus(todayStatus, "Updated.", "success");
}

// ==========================
// Tonight quiz
// ==========================
let quizIndex = 0;
let quizDraftPlan = null; // plan for tomorrow
let quizTonightAppts = []; // appointments for tonight (optional)
let quizTempBacklog = null; // cached backlog list for rendering

function openQuiz() {
  if (!quizOverlay) {
    alert("Quiz UI not found on the page. (quizOverlay missing)");
    return;
  }
  quizOverlay.style.display = "flex";
  quizOverlay.setAttribute("aria-hidden", "false");
  quizIndex = 0;

  // Make it obvious something is happening even if rendering hits an error
  if (quizContent) {
    quizContent.innerHTML = `
      <div class="status muted">
        Loading quiz… (If this hangs, open DevTools → Console to see the error.)
      </div>
    `;
  }
  setStatus(quizFooterStatus, "", "muted");

  // Render async, but never let an exception make the modal “feel dead”
  Promise.resolve()
    .then(() => renderQuizStep())
    .catch((err) => {
      console.error("Quiz render error:", err);
      setStatus(quizFooterStatus, "Something went wrong opening the quiz. Please reload the page and try again.", "error");
    });
}

function closeQuiz() {
  quizOverlay.style.display = "none";
  quizOverlay.setAttribute("aria-hidden", "true");
}

quizCloseBtn.onclick = closeQuiz;
quizOverlay.addEventListener("click", (e) => {
  if (e.target === quizOverlay) closeQuiz();
});

function quizSteps() {
  return [
    { title: "Tomorrow basics", hint: "Set tomorrow’s date and a best-guess wake time.", render: renderStepBasics, onNext: readStepBasics },
    { title: "What’s different tomorrow?", hint: "Work coverage and bedtime owner.", render: renderStepConsiderations, onNext: readStepConsiderations },
    { title: "Appointments tonight", hint: "Optional — use for your own planning (does not affect tomorrow schedule).", render: renderStepTonightAppts, onNext: readStepTonightAppts, skippable:true },
    { title: "Appointments tomorrow", hint: "Fixed blocks. If they overlap routine blocks, the routine shifts after the appointment.", render: renderStepTomorrowAppts, onNext: readStepTomorrowAppts },
    { title: "Bath planning", hint: "Bath at least every 3 days. Not allowed when Julio is unavailable/working.", render: renderStepBath, onNext: readStepBath, skippable:true },
    { title: "Pick focus items", hint: "Choose a few items from the running list to focus on tomorrow.", render: renderStepFocus, onNext: readStepFocus, skippable:true },
    { title: "Review + save", hint: "Save the plan. You can still adjust tomorrow by logging actual wake + naps.", render: renderStepReview, onNext: saveQuizPlan }
  ];
}

function updateQuizProgress() {
  const steps = quizSteps();
  const pct = Math.round(((quizIndex + 1) / steps.length) * 100);
  quizProgress.style.width = `${pct}%`;
}

async function renderQuizStep() {
  const steps = quizSteps();
  const step = steps[quizIndex];
  quizTitle.textContent = step.title;
  quizHint.textContent = step.hint;
  updateQuizProgress();

  quizBackBtn.disabled = quizIndex === 0;
  quizSkipBtn.style.display = step.skippable ? "" : "none";
  quizNextBtn.textContent = (quizIndex === steps.length - 1) ? "Save" : "Next";

  // Ensure draft plan exists
  if (!quizDraftPlan) {
    const tomorrow = addDays(dateToYMD(new Date()), 1);
    const existing = await loadPlan(tomorrow);
    quizDraftPlan = existing ? normalizePlan(existing, tomorrow) : defaultPlan(tomorrow);
    // Ensure appointments shape exists
    quizDraftPlan.appointments = quizDraftPlan.appointments || { tonight: [], tomorrow: [] };
    quizTonightAppts = (quizDraftPlan.appointments.tonight || []);
  }

  // load backlog cache for focus step
  if (quizTempBacklog === null) {
    try { quizTempBacklog = await fetchBacklog(); }
    catch { quizTempBacklog = []; }
  }

  // render
  await step.render();
}

function normalizePlan(plan, dateStr) {
  // Upgrade older plan structures to newer one
  const p = { ...defaultPlan(dateStr), ...plan, date: dateStr };
  // Migrate old considerations format
  if (!p.considerations && plan.considerations) p.considerations = plan.considerations;
  p.considerations = { ...defaultPlan(dateStr).considerations, ...(p.considerations || {}) };
  // Ensure new block structures exist
  if (!p.considerations.unavailability) p.considerations.unavailability = { Kristyn: [], Julio: [] };
  if (!p.considerations.unavailability.Kristyn) p.considerations.unavailability.Kristyn = [];
  if (!p.considerations.unavailability.Julio) p.considerations.unavailability.Julio = [];

  if (!p.considerations.coverage) p.considerations.coverage = { Nanny: [], Kayden: [] };
  if (!p.considerations.coverage.Nanny) p.considerations.coverage.Nanny = [];
  if (!p.considerations.coverage.Kayden) p.considerations.coverage.Kayden = [];

  // Migrate older single-block fields (backward compatibility)
  if (p.considerations.julioCampus && !p.considerations.unavailability.Julio.length) {
    p.considerations.unavailability.Julio.push(p.considerations.julioCampus);
  }
  if (p.considerations.kristynLateMeeting && !p.considerations.unavailability.Kristyn.length) {
    p.considerations.unavailability.Kristyn.push(p.considerations.kristynLateMeeting);
  }
  if (p.considerations.nanny && !p.considerations.coverage.Nanny.length) {
    p.considerations.coverage.Nanny.push(p.considerations.nanny);
  }

  // Appointments
  if (!p.appointments) p.appointments = { tonight: [], tomorrow: [] };
  p.appointments.tonight = Array.isArray(p.appointments.tonight) ? p.appointments.tonight : [];
  p.appointments.tomorrow = Array.isArray(p.appointments.tomorrow) ? p.appointments.tomorrow : [];
  // Bath plan
  p.bathPlan = { ...defaultPlan(dateStr).bathPlan, ...(p.bathPlan || {}) };
  return p;
}

// Quiz nav
quizBackBtn.onclick = async () => {
  if (quizIndex === 0) return;
  quizIndex--;
  await renderQuizStep();
};

quizSkipBtn.onclick = async () => {
  const steps = quizSteps();
  const step = steps[quizIndex];
  if (step.onNext) step.onNext(true); // skip flag
  quizIndex = Math.min(quizIndex + 1, steps.length - 1);
  await renderQuizStep();
};

quizNextBtn.onclick = async () => {
  try {
    const steps = quizSteps();
    const step = steps[quizIndex];
    if (step.onNext) await step.onNext(false);

    if (quizIndex === steps.length - 1) {
      // saved
      closeQuiz();
      setStatus(tonightStatus, `Saved plan for ${quizDraftPlan.date}.`, "success");
      // refresh preview
      await previewTomorrow();
      return;
    }
    quizIndex++;
    await renderQuizStep();
  } catch (e) {
    setStatus(quizFooterStatus, e.message || String(e), "error");
  }
};

// ---- Step 1: basics ----
async function renderStepBasics() {
  const dateStr = quizDraftPlan.date;
  quizContent.innerHTML = `
    <div class="row">
      <div>
        <label>Tomorrow date</label>
        <input id="qDate" type="date" value="${escapeHtml(dateStr)}" />
      </div>
      <div>
        <label>Best-guess wake time</label>
        <input id="qWake" type="time" value="${escapeHtml(quizDraftPlan.wakeDefault || settings.wakeDefault)}" />
        <div class="small">This is just a guess. Tomorrow’s actual wake time drives the schedule.</div>
      </div>
    </div>
  `;
}
async function readStepBasics() {
  const qDate = $("qDate").value;
  if (!qDate) throw new Error("Choose tomorrow’s date.");
  const qWake = clampTimeStr($("qWake").value, settings.wakeDefault);
  quizDraftPlan = normalizePlan(quizDraftPlan, qDate);
  quizDraftPlan.wakeDefault = qWake;
}

// ---- Step 2: considerations ----
async function renderStepConsiderations() {
  const c = quizDraftPlan.considerations || {};
  if (!c.unavailability) c.unavailability = { Kristyn: [], Julio: [] };
  if (!c.unavailability.Kristyn) c.unavailability.Kristyn = [];
  if (!c.unavailability.Julio) c.unavailability.Julio = [];

  if (!c.coverage) c.coverage = { Nanny: [], Kayden: [] };
  if (!c.coverage.Nanny) c.coverage.Nanny = [];
  if (!c.coverage.Kayden) c.coverage.Kayden = [];

  const uaK = c.unavailability.Kristyn;
  const uaJ = c.unavailability.Julio;
  const covN = c.coverage.Nanny;
  const covKa = c.coverage.Kayden;

  function pillsHtml(list, key) {
    if (!list.length) return `<div class="muted">None.</div>`;
    return `<div class="pillRow">` + list.map((b, i) => `
      <span class="pill">
        <b>${escapeHtml(b.start)}–${escapeHtml(b.end)}</b>
        <button type="button" class="danger" style="padding:6px 10px; border-radius:999px; font-size:11px;" data-rm="${escapeHtml(key)}:${i}">Remove</button>
      </span>
    `).join("") + `</div>`;
  }

  quizContent.innerHTML = `
    <div class="toggleRow">
      <input id="qBothWFH" type="checkbox" ${c.bothWFH ? "checked":""} />
      <label style="margin:0;">Both working from home</label>
    </div>

    <div class="hr"></div>

    <div class="sectionTitle">Parent unavailability (tomorrow)</div>
    <div class="muted">Add as many blocks as you need. These blocks help the app assign naps to an available parent automatically.</div>

    <div class="apptCard">
      <div class="apptTitle">Kristyn unavailable / working</div>
      ${pillsHtml(uaK, "uaK")}
      <div class="row" style="margin-top:10px;">
        <div>
          <label>Start</label>
          <input id="qUaKStart" type="time" value="18:00" />
        </div>
        <div>
          <label>End</label>
          <input id="qUaKEnd" type="time" value="19:00" />
        </div>
      </div>
      <div class="btnbar" style="margin-top:10px;">
        <button type="button" class="primary" id="qUaKAddBtn">Add block</button>
      </div>
    </div>

    <div class="apptCard">
      <div class="apptTitle">Julio unavailable / working</div>
      ${pillsHtml(uaJ, "uaJ")}
      <div class="row" style="margin-top:10px;">
        <div>
          <label>Start</label>
          <input id="qUaJStart" type="time" value="09:00" />
        </div>
        <div>
          <label>End</label>
          <input id="qUaJEnd" type="time" value="17:00" />
        </div>
      </div>
      <div class="btnbar" style="margin-top:10px;">
        <button type="button" class="primary" id="qUaJAddBtn">Add block</button>
      </div>
    </div>

    <div class="hr"></div>

    <div class="sectionTitle">Coverage (only used if BOTH parents are unavailable)</div>
    <div class="muted">If both parents are unavailable during a nap, the app assigns naps to Kayden (if covered), otherwise Nanny (if covered).</div>

    <div class="apptCard">
      <div class="apptTitle">Kayden coverage</div>
      ${pillsHtml(covKa, "covKa")}
      <div class="row" style="margin-top:10px;">
        <div>
          <label>Start</label>
          <input id="qCovKaStart" type="time" value="10:00" />
        </div>
        <div>
          <label>End</label>
          <input id="qCovKaEnd" type="time" value="14:00" />
        </div>
      </div>
      <div class="btnbar" style="margin-top:10px;">
        <button type="button" class="primary" id="qCovKaAddBtn">Add block</button>
      </div>
    </div>

    <div class="apptCard">
      <div class="apptTitle">Nanny coverage</div>
      ${pillsHtml(covN, "covN")}
      <div class="row" style="margin-top:10px;">
        <div>
          <label>Start</label>
          <input id="qCovNStart" type="time" value="10:00" />
        </div>
        <div>
          <label>End</label>
          <input id="qCovNEnd" type="time" value="14:00" />
        </div>
      </div>
      <div class="btnbar" style="margin-top:10px;">
        <button type="button" class="primary" id="qCovNAddBtn">Add block</button>
      </div>
    </div>

    <label>Bedtime owner</label>
    <select id="qBedOwner">
      <option value="Kristyn" ${c.bedtimeOwner==="Kristyn"?"selected":""}>Kristyn</option>
      <option value="Julio" ${c.bedtimeOwner==="Julio"?"selected":""}>Julio</option>
      <option value="Split" ${c.bedtimeOwner==="Split"?"selected":""}>Split / Hand-off</option>
    </select>
  `;

  function addBlock(list, startId, endId) {
    const start = clampTimeStr($(startId).value, "09:00");
    const end = clampTimeStr($(endId).value, "10:00");
    if (end <= start) throw new Error("End must be after start.");
    list.push({ start, end });
  }

  // Add buttons
  $("qUaKAddBtn").onclick = () => { try { addBlock(uaK, "qUaKStart", "qUaKEnd"); renderStepConsiderations(); } catch(e){ setStatus(quizFooterStatus, e.message || "Could not add block.", "error"); } };
  $("qUaJAddBtn").onclick = () => { try { addBlock(uaJ, "qUaJStart", "qUaJEnd"); renderStepConsiderations(); } catch(e){ setStatus(quizFooterStatus, e.message || "Could not add block.", "error"); } };
  $("qCovKaAddBtn").onclick = () => { try { addBlock(covKa, "qCovKaStart", "qCovKaEnd"); renderStepConsiderations(); } catch(e){ setStatus(quizFooterStatus, e.message || "Could not add block.", "error"); } };
  $("qCovNAddBtn").onclick = () => { try { addBlock(covN, "qCovNStart", "qCovNEnd"); renderStepConsiderations(); } catch(e){ setStatus(quizFooterStatus, e.message || "Could not add block.", "error"); } };

  // Remove buttons
  quizContent.querySelectorAll("button[data-rm]").forEach(btn => {
    btn.onclick = () => {
      const spec = btn.getAttribute("data-rm") || "";
      const [key, idxStr] = spec.split(":");
      const idx = Number(idxStr);
      const map = { uaK, uaJ, covKa, covN };
      const list = map[key];
      if (!list || !Number.isFinite(idx)) return;
      list.splice(idx, 1);
      renderStepConsiderations();
    };
  });
}

function readStepConsiderations() {
  const c = quizDraftPlan.considerations;
  c.bothWFH = $("qBothWFH").checked;
  c.bedtimeOwner = $("qBedOwner").value;

  // Ensure structures exist (in case of older plans)
  if (!c.unavailability) c.unavailability = { Kristyn: [], Julio: [] };
  if (!c.unavailability.Kristyn) c.unavailability.Kristyn = [];
  if (!c.unavailability.Julio) c.unavailability.Julio = [];

  if (!c.coverage) c.coverage = { Nanny: [], Kayden: [] };
  if (!c.coverage.Nanny) c.coverage.Nanny = [];
  if (!c.coverage.Kayden) c.coverage.Kayden = [];

  // Remove any empty/invalid blocks
  const clean = (arr) => (arr || []).filter(x => x && x.start && x.end && x.end > x.start);
  c.unavailability.Kristyn = clean(c.unavailability.Kristyn);
  c.unavailability.Julio = clean(c.unavailability.Julio);
  c.coverage.Nanny = clean(c.coverage.Nanny);
  c.coverage.Kayden = clean(c.coverage.Kayden);

  // Back-compat fields are no longer used, but keep them if they exist.
}


// ---- Appointment helpers ----
function apptCardHtml(prefix, appt) {
  return `
    <div class="apptCard" data-appt="${escapeHtml(appt.id)}">
      <div class="apptHeader">
        <div style="flex:1;">
          <div class="apptTitle">${escapeHtml(appt.title || "Appointment")}</div>
          <div class="apptMeta">${escapeHtml(appt.start)}–${escapeHtml(appt.end)}</div>
        </div>
        <button class="danger" type="button" data-del="${escapeHtml(appt.id)}">Remove</button>
      </div>
    </div>
  `;
}

function renderApptList(containerId, list) {
  const el = $(containerId);
  el.innerHTML = list.length ? list.map(a => apptCardHtml(containerId, a)).join("") : `<div class="muted">None yet.</div>`;
  el.querySelectorAll("button[data-del]").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-del");
      const idx = list.findIndex(x => x.id === id);
      if (idx >= 0) list.splice(idx, 1);
      renderApptList(containerId, list);
    };
  });
}

function addApptTo(list, title, start, end) {
  const t = (title || "").trim();
  if (!t) throw new Error("Give the appointment a short title.");
  if (!start || !end) throw new Error("Add start and end times.");
  if (end <= start) throw new Error("End must be after start.");
  list.push({ id: newId("appt"), title: t, start, end });
}

// ---- Step 3: appointments tonight ----
async function renderStepTonightAppts() {
  const tonightDate = dateToYMD(new Date());
  const list = quizTonightAppts;
  quizContent.innerHTML = `
    <div class="muted">These are for tonight only (your planning). They don't change tomorrow’s baby schedule.</div>

    <div class="apptCard">
      <div class="apptTitle">Add an appointment tonight</div>
      <div class="row" style="margin-top:10px;">
        <div>
          <label>Title</label>
          <input id="qTonightTitle" placeholder="e.g., Late meeting, Dinner with friends" />
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="primary" id="qTonightAddBtn" type="button">Add</button>
        </div>
      </div>

      <div class="row" style="margin-top:10px;">
        <div>
          <label>Start</label>
          <input id="qTonightStart" type="time" value="18:00" />
        </div>
        <div>
          <label>End</label>
          <input id="qTonightEnd" type="time" value="19:00" />
        </div>
      </div>

      <div class="small" style="margin-top:8px;">Date: ${escapeHtml(tonightDate)}</div>
    </div>

    <div style="margin-top:12px;">
      <div class="sectionTitle">Tonight appointments</div>
      <div id="qTonightList"></div>
    </div>
  `;
  renderApptList("qTonightList", list);

  $("qTonightAddBtn").onclick = () => {
    try {
      addApptTo(list, $("qTonightTitle").value, $("qTonightStart").value, $("qTonightEnd").value);
      $("qTonightTitle").value = "";
      renderApptList("qTonightList", list);
    } catch (e) {
      setStatus(quizFooterStatus, e.message || String(e), "error");
    }
  };
}

async function readStepTonightAppts(skip=false) {
  // save into draft plan
  quizDraftPlan.appointments.tonight = quizTonightAppts;
}

// ---- Step 4: appointments tomorrow ----
async function renderStepTomorrowAppts() {
  const list = quizDraftPlan.appointments.tomorrow;
  quizContent.innerHTML = `
    <div class="muted">Appointments are fixed. If an appointment overlaps routine blocks, the routine shifts after the appointment. If it lands in open time, nothing changes.</div>

    <div class="apptCard">
      <div class="apptTitle">Add an appointment tomorrow</div>
      <div class="row" style="margin-top:10px;">
        <div>
          <label>Title</label>
          <input id="qTomorrowTitle" placeholder="e.g., Pediatrician, Errand, Call" />
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="primary" id="qTomorrowAddBtn" type="button">Add</button>
        </div>
      </div>

      <div class="row" style="margin-top:10px;">
        <div>
          <label>Start</label>
          <input id="qTomorrowStart" type="time" value="10:00" />
        </div>
        <div>
          <label>End</label>
          <input id="qTomorrowEnd" type="time" value="10:30" />
        </div>
      </div>
    </div>

    <div style="margin-top:12px;">
      <div class="sectionTitle">Tomorrow appointments</div>
      <div id="qTomorrowList"></div>
    </div>
  `;
  renderApptList("qTomorrowList", list);

  $("qTomorrowAddBtn").onclick = () => {
    try {
      addApptTo(list, $("qTomorrowTitle").value, $("qTomorrowStart").value, $("qTomorrowEnd").value);
      $("qTomorrowTitle").value = "";
      renderApptList("qTomorrowList", list);
    } catch (e) {
      setStatus(quizFooterStatus, e.message || String(e), "error");
    }
  };
}

async function readStepTomorrowAppts() {
  // already in draft
}

// ---- Step 5: bath planning ----
function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = ymdToDate(dateStr);
  const now = new Date();
  const diff = Math.floor((ymdToDate(dateToYMD(now)).getTime() - d.getTime()) / (24*60*60*1000));
  return diff;
}

async function renderStepBath() {
  const since = daysSince(settings.lastBathDate);
  const shouldBath = (since === null) ? false : (since >= 3);
  const c = quizDraftPlan.considerations || {};
  const hasJulioBlocks = ((c.unavailability?.Julio) || []).length > 0;

  quizContent.innerHTML = `
    <div class="apptCard">
      <div class="apptTitle">Bath reminder</div>
      <div class="apptMeta">
        Last bath date: ${settings.lastBathDate ? escapeHtml(settings.lastBathDate) : "Not set"}<br/>
        ${since === null ? "Set it in Settings to enable reminders." : `Days since last bath: <b>${since}</b>`}
      </div>
      <div class="small" style="margin-top:6px;">
        Rule: bath at least every 3 days. Not allowed when Julio is unavailable/working.
      </div>
    </div>

    <div class="toggleRow">
      <input id="qWantsBath" type="checkbox" ${quizDraftPlan.bathPlan.wantsBath ? "checked" : ""} />
      <label style="margin:0;">Schedule a bath tomorrow</label>
    </div>

    <div class="row" id="qBathTimes" style="${quizDraftPlan.bathPlan.wantsBath ? "" : "display:none;"}">
      <div>
        <label>Preferred start (optional)</label>
        <input id="qBathStart" type="time" value="${escapeHtml(quizDraftPlan.bathPlan.preferredStart || "18:10")}" />
      </div>
      <div>
        <label>Note (optional)</label>
        <input id="qBathNote" placeholder="e.g., messy day / hair wash" value="${escapeHtml(quizDraftPlan.bathPlan.reason || "")}" />
      </div>
    </div>

    ${hasJulioBlocks ? `<div class="status muted" style="margin-top:10px;">Note: Julio has one or more unavailable blocks tomorrow. If your bath time overlaps those blocks, the schedule will automatically skip bath and add a note.</div>` : ""}

    ${shouldBath ? `<div class="status success" style="margin-top:10px;">Reminder: it’s been 3+ days — consider doing bath tomorrow.</div>` : ""}
  `;

  const qWantsBath = $("qWantsBath");
  const qBathTimes = $("qBathTimes");
  qWantsBath.onchange = () => {
    qBathTimes.style.display = qWantsBath.checked ? "" : "none";
  };
}



function readStepBath(skip=false) {
  if (skip) return;
  const wants = $("qWantsBath")?.checked ?? false;

  if (!wants) {
    quizDraftPlan.bathPlan = { wantsBath: false, preferredStart: null, reason: "" };
    return;
  }
  quizDraftPlan.bathPlan.wantsBath = true;
  quizDraftPlan.bathPlan.preferredStart = clampTimeStr($("qBathStart").value, "18:10");
  quizDraftPlan.bathPlan.reason = ($("qBathNote").value || "").trim();
}


// ---- Step 6: focus items ----
async function renderStepFocus() {
  const dateStr = quizDraftPlan.date;
  const list = quizTempBacklog || [];

  quizContent.innerHTML = `
    <div class="apptCard">
      <div class="apptTitle">Add a new item (optional)</div>
      <div class="row" style="margin-top:10px;">
        <div>
          <label>Item</label>
          <input id="qNewTask" placeholder="e.g., refill diaper caddy, order wipes" />
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="primary" id="qAddTaskBtn" type="button">Add</button>
        </div>
      </div>
      <div class="small" style="margin-top:8px;">Then tap “Focus” on a few items for tomorrow.</div>
    </div>

    <div style="margin-top:12px;">
      <div class="sectionTitle">Running list</div>
      <div id="qTaskList"></div>
    </div>
  `;

  const qTaskList = $("qTaskList");

  async function rerender() {
    // refresh cache each render so focus toggles reflect
    quizTempBacklog = await fetchBacklog();
    const view = [...quizTempBacklog].sort((a,b)=>Number(a.done)-Number(b.done) || (new Date(a.created_at)-new Date(b.created_at)));

    qTaskList.innerHTML = view.length ? "" : `<div class="muted">Nothing yet.</div>`;
    for (const item of view) {
      const focused = item.focus_date === dateStr;
      const row = document.createElement("div");
      row.className = "apptCard";
      row.innerHTML = `
        <div class="apptHeader">
          <div style="flex:1;">
            <div class="apptTitle" style="${item.done ? "text-decoration:line-through; color:#6b7280;" : ""}">${escapeHtml(item.text)}</div>
            <div class="apptMeta">${item.focus_date ? `Focus: ${escapeHtml(item.focus_date)}` : ""}</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="ghost" data-focus="${escapeHtml(item.id)}">${focused ? "Unfocus" : "Focus"}</button>
          </div>
        </div>
      `;
      qTaskList.appendChild(row);
    }

    qTaskList.querySelectorAll("button[data-focus]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-focus");
        const now = await fetchBacklog();
        const item = now.find(x => x.id === id);
        const newVal = item?.focus_date === dateStr ? null : dateStr;
        await setBacklogFocusDate(id, newVal);
        await rerender();
      };
    });
  }

  $("qAddTaskBtn").onclick = async () => {
    try {
      await addBacklogItem($("qNewTask").value);
      $("qNewTask").value = "";
      await rerender();
    } catch (e) {
      setStatus(quizFooterStatus, e.message || String(e), "error");
    }
  };

  await rerender();
}

async function readStepFocus(skip=false) {
  // focus toggles already persisted
}

// ---- Step 7: review + save ----
async function renderStepReview() {
  const p = quizDraftPlan;
  const c = p.considerations || {};

  const appts = p.appointments.tomorrow || [];
  const apptSummary = appts.length ? appts.map(a => `${a.title} (${a.start}–${a.end})`).join(", ") : "None";
  const bathSummary = p.bathPlan?.wantsBath ? `Yes (${p.bathPlan.preferredStart || "default time"})` : "No";

  const fmtBlocks = (arr) => (arr && arr.length) ? arr.map(b => `${b.start}–${b.end}`).join(", ") : "No";
  const uaKSummary = fmtBlocks(c.unavailability?.Kristyn || []);
  const uaJSummary = fmtBlocks(c.unavailability?.Julio || []);
  const covKaSummary = fmtBlocks(c.coverage?.Kayden || []);
  const covNSummary = fmtBlocks(c.coverage?.Nanny || []);

  quizContent.innerHTML = `
    <div class="apptCard">
      <div class="apptTitle">Summary</div>
      <div class="apptMeta" style="line-height:1.5; margin-top:6px;">
        <b>Date:</b> ${escapeHtml(p.date)}<br/>
        <b>Wake guess:</b> ${escapeHtml(p.wakeDefault)}<br/>
        <b>Bedtime owner:</b> ${escapeHtml(c.bedtimeOwner || "Kristyn")}<br/>
        <b>Kristyn unavailable / working:</b> ${escapeHtml(uaKSummary)}<br/>
        <b>Julio unavailable / working:</b> ${escapeHtml(uaJSummary)}<br/>
        <b>Kayden coverage:</b> ${escapeHtml(covKaSummary)}<br/>
        <b>Nanny coverage:</b> ${escapeHtml(covNSummary)}<br/>
        <b>Bath:</b> ${escapeHtml(bathSummary)}<br/>
        <b>Tomorrow appointments:</b> ${escapeHtml(apptSummary)}<br/>
      </div>
    </div>

    <div class="apptCard">
      <div class="apptTitle">Preview</div>
      <div class="small">This is a forecast using your wake guess. Actual wake + naps tomorrow will update it.</div>
      <ul id="qReviewPreview"></ul>
    </div>
  `;

  const fakeLog = { ...defaultLog(), wakeActual: p.wakeDefault };
  const blocks = generateSchedule(p.date, p, fakeLog, "full");
  renderScheduleList($("qReviewPreview"), blocks);
}

async function saveQuizPlan() {
  // Persist plan locally (always), plus remote if enabled + signed in
  // Normalize once more
  quizDraftPlan = normalizePlan(quizDraftPlan, quizDraftPlan.date);
  await savePlan(quizDraftPlan);

  // Reset caches
  quizTempBacklog = null;
}

// ==========================
// Tomorrow preview actions
// ==========================
async function previewTomorrow() {
  const tomorrow = addDays(dateToYMD(new Date()), 1);
  const plan = (await loadPlan(tomorrow)) || defaultPlan(tomorrow);
  const log = await loadLog(tomorrow);
  if (!log.wakeActual) log.wakeActual = plan.wakeDefault || settings.wakeDefault;

  const blocks = generateSchedule(tomorrow, plan, log, "full");
  renderTimeline(tomorrowPreview, blocks);
}

startQuizBtn.onclick = async () => {
  quizDraftPlan = null;
  quizTempBacklog = null;
  setStatus(tonightStatus, "Opening the quiz…", "muted");
  openQuiz();
};

quickPreviewBtn.onclick = async () => {
  await previewTomorrow();
  setStatus(tonightStatus, "Preview updated. (You can adjust in the quiz.)", "success");
};

// ==========================
// Today actions / log buttons
// ==========================
reflowBtn.onclick = async () => { await reflowToday(true); };

logWakeBtn.onclick = async () => {
  todayWake.value = nowHHMM();
  await reflowToday(true);
  setStatus(todayStatus, "Logged wake time.", "success");
};

nap1StartBtn.onclick = async () => { nap1Start.value = nowHHMM(); await reflowToday(true); setStatus(todayStatus, "Logged Nap 1 start.", "success"); };
nap1EndBtn.onclick = async () => { nap1End.value = nowHHMM(); await reflowToday(true); setStatus(todayStatus, "Logged Nap 1 end.", "success"); };
nap2StartBtn.onclick = async () => { nap2Start.value = nowHHMM(); await reflowToday(true); setStatus(todayStatus, "Logged Nap 2 start.", "success"); };
nap2EndBtn.onclick = async () => { nap2End.value = nowHHMM(); await reflowToday(true); setStatus(todayStatus, "Logged Nap 2 end.", "success"); };

bedtimeNowBtn.onclick = async () => {
  bedtimeActual.value = nowHHMM();
  await reflowToday(true);
};

todayDate.onchange = async () => await loadTodayUI(todayDate.value);
nannyView.onchange = async () => await reflowToday(false);
todayWake.onchange = async () => await reflowToday(false);
nap1Start.onchange = async () => await reflowToday(false);
nap1End.onchange = async () => await reflowToday(false);
nap2Start.onchange = async () => await reflowToday(false);
nap2End.onchange = async () => await reflowToday(false);
bedtimeActual.onchange = async () => await reflowToday(false);
nightNotes.onchange = async () => await reflowToday(false);

// Running list UI actions
brainDumpAddBtn.onclick = async () => {
  await addBacklogItem(brainDumpAdd.value);
  brainDumpAdd.value = "";
  await refreshRunningList();
};
showFocusBtn.onclick = async () => { runningListMode = "focus"; await refreshRunningList(); };
showAllBtn.onclick = async () => { runningListMode = "all"; await refreshRunningList(); };

// ==========================
// Week view
// ==========================
function dayName(d) {
  return d.toLocaleDateString([], { weekday: "short" });
}
function monthDay(d) {
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

async function refreshWeek() {
  const start = weekStart.value;
  if (!start) return;

  const dates = Array.from({length: 7}, (_,i)=>addDays(start, i));
  const backlog = await fetchBacklog();

  weekList.innerHTML = "";
  for (const ds of dates) {
    const plan = (await loadPlan(ds)) || null;
    const focusCount = backlog.filter(x => !x.done && x.focus_date === ds).length;
    const apptCount = (plan?.appointments?.tomorrow || []).length;

    const d = ymdToDate(ds);
    const title = `${dayName(d)} • ${monthDay(d)} (${ds})`;
    const wake = plan?.wakeDefault || settings.wakeDefault;
    const bedOwner = plan?.considerations?.bedtimeOwner || "—";
    const hasPlan = !!plan;

    const row = document.createElement("div");
    row.className = "dayRow";
    row.innerHTML = `
      <div class="dayTitle">
        <div>${escapeHtml(title)}</div>
        <button class="ghost" type="button" data-open="${escapeHtml(ds)}">Open</button>
      </div>
      <div class="dayBadges">
        <span class="badge ${hasPlan ? "" : "dim"}">${hasPlan ? "Plan saved" : "No plan"}</span>
        <span class="badge">Wake: ${escapeHtml(wake)}</span>
        <span class="badge">Bedtime: ${escapeHtml(bedOwner)}</span>
        <span class="badge">${apptCount} appt</span>
        <span class="badge">${focusCount} focus</span>
      </div>
    `;
    weekList.appendChild(row);
  }

  weekList.querySelectorAll("button[data-open]").forEach(btn => {
    btn.onclick = async () => {
      const ds = btn.getAttribute("data-open");
      todayDate.value = ds;
      setActiveTab("today");
      await loadTodayUI(ds);
    };
  });
}

refreshWeekBtn.onclick = refreshWeek;

// ==========================
// Settings screen
// ==========================
function loadSettingsUI() {
  setWakeDefault.value = settings.wakeDefault;
  setNapDefault.value = settings.napDefaultMin;
  setSoloBedBuffer.value = settings.soloBedtimeBufferMin;
  setLastBath.value = settings.lastBathDate || "";
}

saveSettingsBtn.onclick = async () => {
  const s = {    wakeDefault: setWakeDefault.value || defaultSettings.wakeDefault,
    napDefaultMin: Number(setNapDefault.value || defaultSettings.napDefaultMin),
    soloBedtimeBufferMin: Number(setSoloBedBuffer.value || defaultSettings.soloBedtimeBufferMin),
    lastBathDate: setLastBath.value || null,  };
  settings = s;
  saveSettings(settings);
  setStatus(settingsStatus, "Saved settings.", "success");

  // Reflow today so you immediately see the effect
  await reflowToday(false);
};

// ==========================
// Local export/import (per-device)
// ==========================
exportLocalBtn.onclick = () => {
  const all = {
    settings: loadSettings(),
    backlog: loadBacklogLocal(),
    plans: {},
    logs: {},
    calendarId: localStorage.getItem("calendarId") || DEFAULT_CALENDAR_ID
  };

  // export next 60 days of keys (simple heuristic)
  const today = dateToYMD(new Date());
  for (let i=-7; i<=60; i++) {
    const ds = addDays(today, i);
    const p = loadPlanLocal(ds);
    const l = loadLogLocal(ds);
    if (p) all.plans[ds] = p;
    if (l && (l.wakeActual || l.nap1Start || l.nap1End || l.nap2Start || l.nap2End || l.bedtimeActual || l.nightNotes)) all.logs[ds] = l;
  }

  localTransferBox.value = JSON.stringify(all, null, 2);
};

importLocalBtn.onclick = () => {
  const raw = (localTransferBox.value || "").trim();
  if (!raw) return alert("Paste exported JSON first.");
  const data = safeJSONParse(raw, null);
  if (!data || typeof data !== "object") return alert("Invalid JSON.");

  if (data.settings) saveSettings({ ...defaultSettings, ...data.settings });
  if (Array.isArray(data.backlog)) saveBacklogLocal(data.backlog);
  if (data.plans && typeof data.plans === "object") {
    Object.entries(data.plans).forEach(([ds, p]) => {
      if (p && p.date) savePlanLocal(p);
    });
  }
  if (data.logs && typeof data.logs === "object") {
    Object.entries(data.logs).forEach(([ds, l]) => {
      if (l) saveLogLocal(ds, { ...defaultLog(), ...l });
    });
  }
  if (data.calendarId) localStorage.setItem("calendarId", data.calendarId);

  alert("Imported. Refreshing…");
  location.reload();
};

// ==========================
// Supabase auth UI (optional sync)
// ==========================
signInBtn.onclick = async () => {
  try {
    if (!ENABLE_SUPABASE_SYNC) throw new Error("Enable sync first: set ENABLE_SUPABASE_SYNC=true in app.js.");
    setStatus(authStatus, "Signing in…", "muted");
    await signIn(authEmail.value.trim(), authPassword.value);
    await refreshAuthStatus();
    await refreshRunningList();
    await loadTodayUI(todayDate.value);
  } catch (e) {
    setStatus(authStatus, e.message || String(e), "error");
  }
};

signOutBtn.onclick = async () => {
  try {
    await signOut();
    await refreshAuthStatus();
  } catch (e) {
    setStatus(authStatus, e.message || String(e), "error");
  }
};

// ==========================
// Google Auth + Publish (export)
// ==========================
let accessToken = null;
let tokenClient = null;

function ensureTokenClientReady() {
  if (tokenClient) return;
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google sign-in library not loaded yet. Refresh and try again.");
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (resp) => {
      if (resp?.access_token) {
        accessToken = resp.access_token;
        setStatus(todayStatus, "Signed in. Ready to publish.", "success");
      } else {
        setStatus(todayStatus, "Sign-in did not return an access token.", "error");
      }
    },
  });
}

googleBtn.onclick = () => {
  try {
    ensureTokenClientReady();
    setStatus(todayStatus, "Opening Google sign-in…", "muted");
    tokenClient.requestAccessToken({ prompt: "" });
  } catch (e) {
    setStatus(todayStatus, e.message, "error");
  }
};

async function gcalFetch(url, options = {}) {
  if (!accessToken) throw new Error("Sign in to Google first.");

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API error ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function insertEvent(calId, body) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
  return gcalFetch(url, { method: "POST", body: JSON.stringify(body) });
}

async function deleteEvent(calId, eventId) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`;
  return gcalFetch(url, { method: "DELETE" });
}

async function clearPublishedForDate(calId, dateStr) {
  const ids = safeJSONParse(localStorage.getItem(keyPublishedIds(dateStr)) || "[]", []);
  if (!ids.length) return 0;

  let deleted = 0;
  for (const id of ids) {
    try { await deleteEvent(calId, id); deleted++; }
    catch { /* ignore */ }
  }
  localStorage.removeItem(keyPublishedIds(dateStr));
  return deleted;
}

async function publishForDate(dateStr) {
  const calId = calendarId.value || DEFAULT_CALENDAR_ID;
  localStorage.setItem("calendarId", calId);

  const plan = (await loadPlan(dateStr)) || defaultPlan(dateStr);
  const log = await loadLog(dateStr);

  // Update log from UI if publishing "today"
  if (dateStr === todayDate.value) {
    log.wakeActual = todayWake.value || plan.wakeDefault || settings.wakeDefault;
    log.nap1Start = nap1Start.value || null;
    log.nap1End = nap1End.value || null;
    log.nap2Start = nap2Start.value || null;
    log.nap2End = nap2End.value || null;
  }

  const blocksFull = generateSchedule(dateStr, plan, log, "full");
  const blocks = blocksFull;

  setStatus(todayStatus, "Clearing previous publish for this date…", "muted");
  await clearPublishedForDate(calId, dateStr);

  setStatus(todayStatus, "Publishing…", "muted");
  const dayPlanId = `${dateStr}-${Math.random().toString(16).slice(2)}`;
  const createdIds = [];

  for (const b of blocks) {
    const body = {
      summary: b.title,
      description: `${b.category || ""}${b.category ? " • " : ""}${b.visibility || ""}`.trim(),
      start: { dateTime: toRFC3339Local(b.start), timeZone: TIME_ZONE },
      end: { dateTime: toRFC3339Local(b.end), timeZone: TIME_ZONE },
      extendedProperties: {
        private: {
          app: "family-day-planner",
          dayPlanId,
          blockId: b.id,
          category: b.category || "",
          visibility: b.visibility || "",
        },
      },
    };
    const created = await insertEvent(calId, body);
    createdIds.push(created.id);
  }

  localStorage.setItem(keyPublishedIds(dateStr), JSON.stringify(createdIds));
  setStatus(todayStatus, `Published ${createdIds.length} events to Google Calendar.`, "success");
}

publishBtn.onclick = async () => {
  try {
    await publishForDate(todayDate.value);
  } catch (e) {
    setStatus(todayStatus, e.message, "error");
  }
};

clearBtn.onclick = async () => {
  try {
    const dateStr = todayDate.value;
    const calId = calendarId.value || DEFAULT_CALENDAR_ID;
    if (!dateStr) throw new Error("Choose a date.");
    setStatus(todayStatus, "Clearing…", "muted");
    const deleted = await clearPublishedForDate(calId, dateStr);
    setStatus(todayStatus, `Cleared ${deleted} events.`, "success");
  } catch (e) {
    setStatus(todayStatus, e.message, "error");
  }
};

// ==========================
// Bootstrapping
// ==========================
function initDates() {
  const now = new Date();
  const todayStr = dateToYMD(now);
  const tomorrowStr = addDays(todayStr, 1);

  // Default today
  todayDate.value = todayStr;
  todayWake.value = settings.wakeDefault;

  // Week start default = today
  weekStart.value = todayStr;

  calendarId.value = localStorage.getItem("calendarId") || DEFAULT_CALENDAR_ID;
}

async function boot() {
  settings = loadSettings();
  loadSettingsUI();
  initDates();

  await initSupabaseIfEnabled();
  await refreshAuthStatus();

  await loadTodayUI(todayDate.value);
  await previewTomorrow();

  // Start on Tonight tab
  setActiveTab("tonight");
}

boot();

// ==========================
// SUPABASE SQL (optional)
// ==========================
// If you enable sync, create these tables + policies in Supabase:
//
// -- tables
// create table if not exists households (
//   id uuid primary key default gen_random_uuid(),
//   name text not null
// );
//
// create table if not exists household_members (
//   household_id uuid not null references households(id) on delete cascade,
//   user_id uuid not null,
//   role text not null default 'member',
//   created_at timestamptz not null default now(),
//   primary key (household_id, user_id)
// );
//
// create table if not exists backlog_tasks (
//   id uuid primary key default gen_random_uuid(),
//   household_id uuid not null references households(id) on delete cascade,
//   text text not null,
//   done boolean not null default false,
//   focus_date date null,
//   created_at timestamptz not null default now(),
//   done_at timestamptz null
// );
//
// create table if not exists day_plans (
//   date date not null,
//   household_id uuid not null references households(id) on delete cascade,
//   plan_json text not null,
//   updated_at timestamptz not null default now(),
//   primary key (household_id, date)
// );
//
// create table if not exists day_logs (
//   date date not null,
//   household_id uuid not null references households(id) on delete cascade,
//   log_json text not null,
//   updated_at timestamptz not null default now(),
//   primary key (household_id, date)
// );
//
// -- RLS + policies
// alter table households enable row level security;
// alter table household_members enable row level security;
// alter table backlog_tasks enable row level security;
// alter table day_plans enable row level security;
// alter table day_logs enable row level security;
//
// create or replace function public.is_household_member(hid uuid)
// returns boolean language sql stable as $$
//   select exists (select 1 from household_members m where m.household_id = hid and m.user_id = auth.uid());
// $$;
//
// create policy "households read" on households for select to authenticated using (public.is_household_member(id));
// create policy "memberships read" on household_members for select to authenticated using (user_id = auth.uid() or public.is_household_member(household_id));
//
// create policy "tasks read" on backlog_tasks for select to authenticated using (public.is_household_member(household_id));
// create policy "tasks insert" on backlog_tasks for insert to authenticated with check (public.is_household_member(household_id));
// create policy "tasks update" on backlog_tasks for update to authenticated using (public.is_household_member(household_id));
// create policy "tasks delete" on backlog_tasks for delete to authenticated using (public.is_household_member(household_id));
//
// create policy "plans read" on day_plans for select to authenticated using (public.is_household_member(household_id));
// create policy "plans upsert" on day_plans for insert to authenticated with check (public.is_household_member(household_id));
// create policy "plans update" on day_plans for update to authenticated using (public.is_household_member(household_id));
//
// create policy "logs read" on day_logs for select to authenticated using (public.is_household_member(household_id));
// create policy "logs upsert" on day_logs for insert to authenticated with check (public.is_household_member(household_id));
// create policy "logs update" on day_logs for update to authenticated using (public.is_household_member(household_id));
