/* Family Day Planner – Vanilla JS PWA (GitHub Pages friendly)
   - Mobile-first, light earth-tone UI
   - Supabase email/password auth + household-scoped RLS
   - Evening wizard saves tomorrow plan (editable)
   - Today timeline regenerates from actual wake/nap times
   - Persistent tasks + History logs + Settings
*/

/* =========================
   CONFIG (edit these)
   ========================= */
const CONFIG = {
  // Supabase
  supabaseUrl: "YOUR_SUPABASE_URL",                       // e.g. https://xxxx.supabase.co
  supabaseKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",   // e.g. sb_publishable_...
  // Apps Script export (optional)
  appsScriptUrl: "YOUR_APPS_SCRIPT_WEB_APP_URL",          // optional; leave blank to hide export button
  appsScriptApiKey: "YOUR_SHARED_API_KEY",                // optional; if using export
  // Display / scheduling
  timezone: "America/Los_Angeles",
};

/* =========================
   Safe helpers
   ========================= */
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function pad2(n){ return String(n).padStart(2, "0"); }

function toIsoDate(d){
  // d: Date
  const y = d.getFullYear();
  const m = pad2(d.getMonth()+1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function fromIsoDate(iso){
  // iso: YYYY-MM-DD -> Date (local)
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}

function formatDateShort(d){
  // MM/DD/YY
  const mm = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function minutesFromHHMM(hhmm){
  if (!hhmm) return null;
  const [h,m] = hhmm.split(":").map(Number);
  return h*60 + m;
}

function hhmmFromMinutes(mins){
  mins = ((mins % (24*60)) + 24*60) % (24*60);
  const h = Math.floor(mins/60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function formatTime12FromMinutes(mins){
  const hhmm = hhmmFromMinutes(mins);
  return formatTime12(hhmm);
}

function formatTime12(hhmm){
  // hhmm: "HH:MM" (24h)
  if (!hhmm) return "—";
  const [hRaw, m] = hhmm.split(":").map(Number);
  const ampm = hRaw >= 12 ? "PM" : "AM";
  let h = hRaw % 12;
  if (h === 0) h = 12;
  return `${h}:${pad2(m)} ${ampm}`;
}

function nowHHMM(){
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function deepCopy(obj){ return JSON.parse(JSON.stringify(obj)); }

function debounce(fn, ms){
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function uniqBy(arr, keyFn){
  const seen = new Set();
  const out = [];
  for (const x of arr){
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function overlaps(aStart, aEnd, bStart, bEnd){
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

/* =========================
   Supabase init (UMD global)
   ========================= */
let supabaseClient = null;
function initSupabase(){
  if (!window.supabase) throw new Error("Supabase library not loaded.");
  // Use global supabase.createClient when loaded via CDN script tag.
  supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return supabaseClient;
}

/* =========================
   Default settings
   ========================= */
const DEFAULT_SETTINGS = {
  defaultWakeTime: "07:00",
  // meal durations include prep + eat
  breakfastDurationMin: 35,
  lunchDurationMin: 35,
  dinnerDurationMin: 40,
  snackMilkDurationMin: 15,
  napRoutineDurationMin: 15,
  bedtimeRoutineDurationMin: 25,
  // forecast nap duration (used when actual is missing)
  nap1ForecastMin: 75,
  nap2ForecastMin: 75,
  // wake window midpoints (minutes) derived from ranges:
  // WW1: 3–3.5 hours -> midpoint 3h15
  // WW2: 3.5–4 hours -> midpoint 3h45
  // WW3: 4–4.25 hours -> midpoint 4h07 (rounded)
  ww1MidMin: 195,
  ww2MidMin: 225,
  ww3MidMin: 247,
  // bedtime cap (helps keep forecast reasonable)
  latestBedtimeHHMM: "20:15",
  earliestBedtimeHHMM: "18:30",
  // Morning mini-items
  cuddleMin: 15,
  getDressedMin: 15,
  brushTeethMin: 5,
};

/* =========================
   App state
   ========================= */
const App = {
  ready: false,
  user: null,
  householdId: null,
  householdRole: null,

  // loaded from DB
  settings: deepCopy(DEFAULT_SETTINGS),
  tasks: [],
  plansByDay: new Map(),  // iso -> payload
  logsByDay: new Map(),   // iso -> log record

  // derived
  activeTab: "today",
  todayIso: toIsoDate(new Date()),
  tomorrowIso: toIsoDate(new Date(Date.now() + 24*60*60*1000)),

  // wizard
  wizard: {
    open: false,
    step: 0,
    isoDay: null,
    draft: null,
    saving: false,
    lastSavedAt: null,
  },

  quickEdit: {
    open: false,
    isoDay: null,
    draft: null,
  },

  // subscriptions
  channels: [],

  // ui
  toastTimer: null,
};

/* =========================
   Data model
   ========================= */
function emptyPlanPayload(isoDay){
  return {
    day: isoDay,
    // step 1: checklist
    beforeChecklist: [
      { id: "prep_bottles", label: "Prep bottles / milk needs", done: false },
      { id: "restock_diapers", label: "Restock changing supplies", done: false },
      { id: "set_outfits", label: "Set out outfits", done: false },
      { id: "charge_devices", label: "Charge devices / baby monitor", done: false },
    ],
    // step 2: brain dump
    brainDump: "",
    // tasks chosen to focus tomorrow (task IDs)
    focusTaskIds: [],
    // constraints
    constraints: {
      julioUnavailable: [],
      kristynUnavailable: [],
      nannyWorking: { enabled: false, blocks: [] },
      kaydenAvailable: [],
      bedtimeBy: "Kristyn", // Kristyn or Julio
      appointments: [], // {id,title,start,end}
    }
  };
}

function emptyLogRecord(isoDay){
  return {
    day: isoDay,
    wake_time: null,
    nap1_start: null,
    nap1_end: null,
    nap2_start: null,
    nap2_end: null,
    bedtime_time: null,
    overnight_notes: "",
    bath_done: false,
  };
}

/* =========================
   Toast
   ========================= */
function toast(msg){
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(App.toastTimer);
  App.toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* =========================
   UI: Tabs + routing
   ========================= */
const TABS = [
  { id:"evening", label:"Evening", icon: `
    <svg viewBox="0 0 24 24" fill="none"><path d="M21 14.5A8 8 0 0 1 9.5 3a6.5 6.5 0 1 0 11.5 11.5Z" stroke="currentColor" stroke-width="1.7"/></svg>
  `},
  { id:"today", label:"Today", icon: `
    <svg viewBox="0 0 24 24" fill="none"><path d="M7 3v3M17 3v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 8h16" stroke="currentColor" stroke-width="1.7"/><path d="M6 12h6M6 16h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
  `},
  { id:"tasks", label:"Tasks", icon: `
    <svg viewBox="0 0 24 24" fill="none"><path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3.5 6.5l1.5 1.5 2.5-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 12.5l1.5 1.5 2.5-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
  `},
  { id:"history", label:"History", icon: `
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v5l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 12a8 8 0 1 0 2.3-5.7" stroke="currentColor" stroke-width="1.7"/><path d="M4 5v4h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
  `},
  { id:"settings", label:"Settings", icon: `
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 15a8.1 8.1 0 0 0 .1-2l2-1.2-2-3.5-2.3.6a7.5 7.5 0 0 0-1.7-1l-.4-2.3H10l-.4 2.3a7.5 7.5 0 0 0-1.7 1L5.6 8.3l-2 3.5 2 1.2a8.1 8.1 0 0 0 .1 2l-2 1.2 2 3.5 2.3-.6c.5.4 1.1.7 1.7 1l.4 2.3h4.1l.4-2.3c.6-.3 1.2-.6 1.7-1l2.3.6 2-3.5-2-1.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
  `},
];

function renderTabs(){
  const root = $("#tabs");
  root.innerHTML = "";
  for (const t of TABS){
    const btn = document.createElement("div");
    btn.className = "tab" + (App.activeTab === t.id ? " active" : "");
    btn.innerHTML = `${t.icon}<div>${t.label}</div>`;
    btn.addEventListener("click", () => {
      App.activeTab = t.id;
      render();
      renderTabs();
    });
    root.appendChild(btn);
  }
}

function setSubhead(text){
  const el = $("#subhead");
  if (el) el.textContent = text;
}

/* =========================
   Time picker (12-hour)
   ========================= */
function timePickerHTML(idPrefix, valueHHMM){
  const mins = valueHHMM ? minutesFromHHMM(valueHHMM) : null;
  let h = 12, m = 0, ap = "AM";
  if (mins !== null){
    const hr24 = Math.floor(mins/60);
    m = mins % 60;
    ap = hr24 >= 12 ? "PM" : "AM";
    h = hr24 % 12; if (h === 0) h = 12;
  }
  const hours = Array.from({length:12}, (_,i)=>i+1).map(x=>`<option ${x===h?"selected":""} value="${x}">${x}</option>`).join("");
  const minutes = [0,15,30,45].map(x=>`<option ${x===m?"selected":""} value="${x}">${pad2(x)}</option>`).join("");
  const apm = ["AM","PM"].map(x=>`<option ${x===ap?"selected":""} value="${x}">${x}</option>`).join("");
  return `
    <div class="row" style="gap:8px; align-items:end;">
      <div style="flex:1.1;">
        <label class="sr" for="${idPrefix}_h">Hour</label>
        <select id="${idPrefix}_h">${hours}</select>
      </div>
      <div style="flex:1.1;">
        <label class="sr" for="${idPrefix}_m">Minute</label>
        <select id="${idPrefix}_m">${minutes}</select>
      </div>
      <div style="flex:1.2;">
        <label class="sr" for="${idPrefix}_ap">AM/PM</label>
        <select id="${idPrefix}_ap">${apm}</select>
      </div>
    </div>
  `;
}

function readTimePicker(idPrefix){
  const h = Number($(`#${idPrefix}_h`)?.value ?? 12);
  const m = Number($(`#${idPrefix}_m`)?.value ?? 0);
  const ap = $(`#${idPrefix}_ap`)?.value ?? "AM";
  let hr24 = h % 12;
  if (ap === "PM") hr24 += 12;
  return `${pad2(hr24)}:${pad2(m)}`;
}

/* =========================
   Data loading
   ========================= */
async function loadHouseholdContext(){
  const { data: { user } } = await supabaseClient.auth.getUser();
  App.user = user;

  if (!user) return;

  const { data: memberships, error } = await supabaseClient
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.id)
    .limit(1);

  if (error){
    console.error(error);
    toast("Couldn’t load household membership.");
    return;
  }

  if (!memberships || memberships.length === 0){
    App.householdId = null;
    App.householdRole = null;
    return;
  }

  App.householdId = memberships[0].household_id;
  App.householdRole = memberships[0].role || "member";
}

async function loadSettings(){
  if (!App.householdId) return;
  const { data, error } = await supabaseClient
    .from("household_settings")
    .select("settings")
    .eq("household_id", App.householdId)
    .maybeSingle();

  if (error){
    console.error(error);
    toast("Couldn’t load settings.");
    return;
  }

  const merged = { ...deepCopy(DEFAULT_SETTINGS), ...(data?.settings || {}) };
  App.settings = merged;
}

async function saveSettings(newSettings){
  if (!App.householdId) return;
  App.settings = { ...deepCopy(DEFAULT_SETTINGS), ...newSettings };
  const payload = { household_id: App.householdId, settings: App.settings, updated_at: new Date().toISOString() };
  const { error } = await supabaseClient
    .from("household_settings")
    .upsert(payload, { onConflict: "household_id" });

  if (error){
    console.error(error);
    toast("Save failed.");
    return;
  }
  toast("Settings saved.");
}

async function loadTasks(){
  if (!App.householdId) return;
  const { data, error } = await supabaseClient
    .from("tasks")
    .select("*")
    .eq("household_id", App.householdId)
    .order("created_at", { ascending: false })
    .limit(400);

  if (error){
    console.error(error);
    toast("Couldn’t load tasks.");
    return;
  }
  App.tasks = data || [];
}

async function loadPlans(days){
  if (!App.householdId || !days?.length) return;
  const { data, error } = await supabaseClient
    .from("day_plans")
    .select("day, payload")
    .eq("household_id", App.householdId)
    .in("day", days);

  if (error){
    console.error(error);
    toast("Couldn’t load plans.");
    return;
  }
  for (const row of (data || [])){
    App.plansByDay.set(row.day, row.payload);
  }
}

async function loadLogs(days=null){
  if (!App.householdId) return;
  let q = supabaseClient
    .from("day_logs")
    .select("*")
    .eq("household_id", App.householdId)
    .order("day", { ascending: false });

  if (days && days.length){
    q = q.in("day", days);
  } else {
    q = q.limit(120);
  }

  const { data, error } = await q;
  if (error){
    console.error(error);
    toast("Couldn’t load history.");
    return;
  }
  for (const row of (data || [])){
    App.logsByDay.set(row.day, row);
  }
}

async function upsertPlan(isoDay, payload){
  if (!App.householdId) return;
  const row = { household_id: App.householdId, day: isoDay, payload, updated_at: new Date().toISOString() };
  const { error } = await supabaseClient.from("day_plans").upsert(row, { onConflict: "household_id,day" });
  if (error){
    console.error(error);
    toast("Plan save failed.");
    return;
  }
  App.plansByDay.set(isoDay, payload);
  toast("Saved.");
}

async function upsertLog(isoDay, record){
  if (!App.householdId) return;
  const row = { household_id: App.householdId, ...record, updated_at: new Date().toISOString() };
  const { error } = await supabaseClient.from("day_logs").upsert(row, { onConflict: "household_id,day" });
  if (error){
    console.error(error);
    toast("Log save failed.");
    return;
  }
  App.logsByDay.set(isoDay, row);
}

async function addTask(title){
  const t = title.trim();
  if (!t) return;
  const row = {
    household_id: App.householdId,
    title: t,
    completed: false,
    assigned_date: null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseClient.from("tasks").insert(row).select("*").single();
  if (error){
    console.error(error);
    toast("Couldn’t add task.");
    return;
  }
  App.tasks = [data, ...App.tasks];
}

async function updateTask(taskId, patch){
  const { data, error } = await supabaseClient
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error){
    console.error(error);
    toast("Update failed.");
    return;
  }
  App.tasks = App.tasks.map(t => (t.id === taskId ? data : t));
}

/* =========================
   Realtime (optional)
   ========================= */
function clearRealtime(){
  for (const ch of App.channels){
    try { supabaseClient.removeChannel(ch); } catch {}
  }
  App.channels = [];
}

function setupRealtime(){
  clearRealtime();
  if (!App.householdId) return;

  const watch = (table, handler) => {
    const ch = supabaseClient
      .channel(`fdp_${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${App.householdId}` }, handler)
      .subscribe();
    App.channels.push(ch);
  };

  watch("tasks", async () => { await loadTasks(); if (App.activeTab==="tasks"||App.activeTab==="today"||App.activeTab==="evening") render(); });
  watch("day_plans", async () => { await loadPlans([App.todayIso, App.tomorrowIso]); if (App.activeTab==="today"||App.activeTab==="evening") render(); });
  watch("day_logs", async () => { await loadLogs(); if (App.activeTab==="today"||App.activeTab==="history") render(); });
  watch("household_settings", async () => { await loadSettings(); if (App.activeTab==="settings"||App.activeTab==="today"||App.activeTab==="evening") render(); });
}

/* =========================
   Evening wizard (autosave draft)
   ========================= */
function draftKey(isoDay){
  const uid = App.user?.id || "anon";
  return `fdp_wizard_draft_${uid}_${isoDay}`;
}

function loadWizardDraft(isoDay){
  const existingPlan = App.plansByDay.get(isoDay);
  const ls = localStorage.getItem(draftKey(isoDay));
  if (ls){
    try { return JSON.parse(ls); } catch {}
  }
  if (existingPlan) return deepCopy(existingPlan);
  return emptyPlanPayload(isoDay);
}

function saveWizardDraftLocal(isoDay, draft){
  localStorage.setItem(draftKey(isoDay), JSON.stringify(draft));
  App.wizard.lastSavedAt = new Date();
  const s = $("#wizStatus");
  if (s) s.textContent = `Autosaved at ${formatTime12(nowHHMM())}`;
}

const saveWizardDraftLocalDebounced = debounce((isoDay, draft) => saveWizardDraftLocal(isoDay, draft), 250);

function openWizard(isoDay){
  App.wizard.open = true;
  App.wizard.isoDay = isoDay;
  App.wizard.step = 0;
  App.wizard.draft = loadWizardDraft(isoDay);
  $("#wizardModal").classList.add("open");
  $("#wizardModal").setAttribute("aria-hidden","false");

  const d = fromIsoDate(isoDay);
  $("#wizSub").textContent = `Plan for ${formatDateShort(d)}`;
  renderWizard();
}

function closeWizard(){
  App.wizard.open = false;
  $("#wizardModal").classList.remove("open");
  $("#wizardModal").setAttribute("aria-hidden","true");
}

function wizardSteps(){
  return [
    { id:"checklist", label:"Checklist" },
    { id:"brain", label:"Brain dump" },
    { id:"focus", label:"Focus tasks" },
    { id:"constraints", label:"Constraints" },
    { id:"preview", label:"Preview + save" },
  ];
}

function renderWizard(){
  const steps = wizardSteps();
  const stepper = $("#wizSteps");
  stepper.innerHTML = "";

  steps.forEach((s, idx) => {
    const el = document.createElement("div");
    el.className = "step" + (idx === App.wizard.step ? " active" : "");
    el.textContent = `${idx+1}. ${s.label}`;
    el.addEventListener("click", () => {
      App.wizard.step = idx;
      renderWizard();
    });
    stepper.appendChild(el);
  });

  const body = $("#wizBody");
  body.innerHTML = "";

  const draft = App.wizard.draft;
  const isoDay = App.wizard.isoDay;

  if (!draft) return;

  if (App.wizard.step === 0){
    body.innerHTML = `
      <div class="card" style="box-shadow:none; border-radius:18px; background:rgba(255,255,255,.65);">
        <div class="hd"><div><h2>Before we plan tomorrow…</h2><p>Quick check-in so tomorrow is smoother.</p></div></div>
        <div class="bd" id="chkList"></div>
      </div>
    `;
    const list = $("#chkList");
    draft.beforeChecklist.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <input type="checkbox" ${it.done ? "checked":""} id="chk_${it.id}">
        <div class="txt">
          <div>${it.label}</div>
        </div>
      `;
      row.querySelector("input").addEventListener("change", (e) => {
        draft.beforeChecklist[i].done = e.target.checked;
        saveWizardDraftLocalDebounced(isoDay, draft);
      });
      list.appendChild(row);
    });
  }

  if (App.wizard.step === 1){
    body.innerHTML = `
      <div class="card" style="box-shadow:none; border-radius:18px; background:rgba(255,255,255,.65);">
        <div class="hd"><div><h2>Brain dump</h2><p>Anything you want captured becomes tasks in the master list. One per line.</p></div></div>
        <div class="bd">
          <label>Brain dump (tasks)</label>
          <textarea id="brainDump" placeholder="Example: Call pediatrician&#10;Example: Order diapers"></textarea>
          <div class="row" style="margin-top:10px;">
            <button class="primary" id="brainAdd">Add to master task list</button>
            <button class="ghost" id="brainClear">Clear</button>
          </div>
          <p class="hint" style="margin-top:10px;">Tip: You can still assign tasks to Today/Tomorrow later.</p>
        </div>
      </div>
    `;
    $("#brainDump").value = draft.brainDump || "";
    $("#brainDump").addEventListener("input", (e) => {
      draft.brainDump = e.target.value;
      saveWizardDraftLocalDebounced(isoDay, draft);
    });
    $("#brainAdd").addEventListener("click", async () => {
      const lines = (draft.brainDump || "").split("\n").map(s=>s.trim()).filter(Boolean);
      if (!lines.length) { toast("Nothing to add."); return; }
      for (const line of lines){
        await addTask(line);
      }
      draft.brainDump = "";
      saveWizardDraftLocal(isoDay, draft);
      toast("Added to tasks.");
      renderWizard();
    });
    $("#brainClear").addEventListener("click", () => {
      draft.brainDump = "";
      saveWizardDraftLocal(isoDay, draft);
      renderWizard();
    });
  }

  if (App.wizard.step === 2){
    const tomorrow = isoDay;
    const uncompleted = App.tasks.filter(t => !t.completed);
    body.innerHTML = `
      <div class="card" style="box-shadow:none; border-radius:18px; background:rgba(255,255,255,.65);">
        <div class="hd"><div><h2>Choose tasks to focus on tomorrow</h2><p>These will show on Tomorrow (and you can move them to Today in the morning).</p></div></div>
        <div class="bd">
          <div class="list" id="focusList"></div>
          <div class="divider"></div>
          <div class="row">
            <button class="ghost" id="focusClear">Clear selection</button>
          </div>
        </div>
      </div>
    `;
    const list = $("#focusList");
    if (uncompleted.length === 0){
      list.innerHTML = `<p class="hint">No open tasks. Add some in Tasks or Brain dump.</p>`;
    } else {
      uncompleted.slice(0, 60).forEach((t) => {
        const chosen = draft.focusTaskIds.includes(t.id);
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <input type="checkbox" ${chosen?"checked":""}>
          <div class="txt">
            <div>${escapeHtml(t.title)}</div>
            <div class="sub">${t.assigned_date ? `Assigned ${formatDateShort(fromIsoDate(t.assigned_date))}` : "Not assigned yet"}</div>
          </div>
        `;
        row.querySelector("input").addEventListener("change", (e) => {
          const on = e.target.checked;
          draft.focusTaskIds = draft.focusTaskIds || [];
          if (on) draft.focusTaskIds.push(t.id);
          else draft.focusTaskIds = draft.focusTaskIds.filter(x => x !== t.id);
          draft.focusTaskIds = Array.from(new Set(draft.focusTaskIds));
          saveWizardDraftLocalDebounced(tomorrow, draft);
        });
        list.appendChild(row);
      });
    }
    $("#focusClear").addEventListener("click", () => {
      draft.focusTaskIds = [];
      saveWizardDraftLocal(tomorrow, draft);
      renderWizard();
    });
  }

  if (App.wizard.step === 3){
    body.appendChild(renderConstraintsEditor(draft.constraints, (newConstraints) => {
      draft.constraints = newConstraints;
      saveWizardDraftLocalDebounced(isoDay, draft);
    }));
  }

  if (App.wizard.step === 4){
    const preview = generateScheduleForDay(isoDay);
    const warnings = preview.warnings;
    body.innerHTML = `
      <div class="card" style="box-shadow:none; border-radius:18px; background:rgba(255,255,255,.65);">
        <div class="hd"><div><h2>Preview</h2><p>Only scheduled blocks appear (open time remains blank).</p></div></div>
        <div class="bd">
          <div class="row" style="margin-bottom:10px; align-items:center;">
            <span class="badge ${warnings.length? "warn":"ok"}">${warnings.length? "Needs attention":"Looks good"}</span>
            ${CONFIG.appsScriptUrl && CONFIG.appsScriptApiKey ? `<button class="mini ghost" id="btnExportTomorrow">Export to Calendar</button>` : ``}
          </div>
          <div id="previewTimeline"></div>
          ${warnings.length ? `<div class="divider"></div><div class="hint"><strong>Flags:</strong><br>${warnings.map(w => "• " + escapeHtml(w)).join("<br>")}</div>` : ""}
          <div class="divider"></div>
          <div class="row">
            <button class="primary" id="btnSavePlan">Save tomorrow plan</button>
            <button class="ghost" id="btnKeepEditing">Keep editing</button>
          </div>
        </div>
      </div>
    `;
    $("#previewTimeline").appendChild(renderTimeline(preview.blocks));

    $("#btnKeepEditing").addEventListener("click", () => {
      App.wizard.step = 3;
      renderWizard();
    });

    $("#btnSavePlan").addEventListener("click", async () => {
      await saveWizardToDb();
    });

    const ex = $("#btnExportTomorrow");
    if (ex){
      ex.addEventListener("click", async () => {
        await exportDayToCalendar(isoDay, preview.blocks);
      });
    }
  }

  // nav buttons
  $("#wizBack").style.visibility = (App.wizard.step === 0) ? "hidden" : "visible";
  $("#wizNext").textContent = (App.wizard.step === steps.length - 1) ? "Done" : "Next";
}

async function saveWizardToDb(){
  const isoDay = App.wizard.isoDay;
  const draft = App.wizard.draft;
  if (!isoDay || !draft) return;
  App.wizard.saving = true;
  $("#wizStatus").textContent = "Saving…";

  // Apply "focusTaskIds" -> assign those tasks to this day
  const focusIds = new Set(draft.focusTaskIds || []);
  for (const t of App.tasks){
    if (!t.completed && focusIds.has(t.id)){
      if (t.assigned_date !== isoDay){
        await updateTask(t.id, { assigned_date: isoDay });
      }
    }
  }

  await upsertPlan(isoDay, draft);
  localStorage.removeItem(draftKey(isoDay));

  $("#wizStatus").textContent = "Saved.";
  App.wizard.saving = false;
  closeWizard();
  render();
}

/* =========================
   Quick edit modal (availability + appointments)
   ========================= */
function openQuickEdit(isoDay){
  App.quickEdit.open = true;
  App.quickEdit.isoDay = isoDay;
  const plan = App.plansByDay.get(isoDay) || emptyPlanPayload(isoDay);
  App.quickEdit.draft = deepCopy(plan);

  $("#quickEditModal").classList.add("open");
  $("#quickEditModal").setAttribute("aria-hidden","false");

  const d = fromIsoDate(isoDay);
  $("#qeSub").textContent = `For ${formatDateShort(d)}`;
  renderQuickEdit();
}

function closeQuickEdit(){
  App.quickEdit.open = false;
  $("#quickEditModal").classList.remove("open");
  $("#quickEditModal").setAttribute("aria-hidden","true");
}

function renderQuickEdit(){
  const body = $("#qeBody");
  body.innerHTML = "";
  const draft = App.quickEdit.draft;
  if (!draft) return;

  body.appendChild(renderConstraintsEditor(draft.constraints, (newConstraints) => {
    draft.constraints = newConstraints;
  }, { compact: true }));

  $("#qeSave").onclick = async () => {
    await upsertPlan(App.quickEdit.isoDay, draft);
    closeQuickEdit();
    render();
  };
}

/* =========================
   Constraints editor (shared)
   ========================= */
function renderConstraintsEditor(constraints, onChange, opts = {}){
  const c = deepCopy(constraints || {});
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="card" style="box-shadow:none; border-radius:18px; background:rgba(255,255,255,.65);">
      <div class="hd">
        <div>
          <h2>Tomorrow’s constraints</h2>
          <p>All times are 12-hour. Add as many blocks as you need.</p>
        </div>
      </div>
      <div class="bd">
        <div id="cx"></div>
      </div>
    </div>
  `;
  const root = wrap.querySelector("#cx");

  const sections = [
    { key:"julioUnavailable", title:"When will Julio be unavailable?", kind:"blocks" },
    { key:"kristynUnavailable", title:"When will Kristyn be unavailable?", kind:"blocks" },
    { key:"nannyWorking", title:"Will the nanny be working?", kind:"toggleBlocks" },
    { key:"kaydenAvailable", title:"What hours will Kayden be working/available?", kind:"blocks", note:"Kayden may help with routines, but will never be assigned naps." },
    { key:"bedtimeBy", title:"Who will be doing bedtime?", kind:"bedtime" },
    { key:"appointments", title:"Any appointments tomorrow?", kind:"appointments" },
  ];

  for (const s of sections){
    const sec = document.createElement("div");
    sec.style.marginBottom = "14px";
    sec.innerHTML = `
      <div style="padding: 10px 10px 12px; border-radius: 16px; border: 1px solid rgba(0,0,0,.07); background: rgba(255,255,255,.62);">
        <div style="font-size:13px; font-weight:650; margin-bottom:6px;">${s.title}</div>
        ${s.note ? `<div class="hint" style="margin-bottom:10px;">${escapeHtml(s.note)}</div>` : ``}
        <div class="cxBody"></div>
      </div>
    `;
    const body = sec.querySelector(".cxBody");

    if (s.kind === "blocks"){
      body.appendChild(renderBlocksEditor(c[s.key] || [], (blocks) => {
        c[s.key] = blocks;
        onChange(deepCopy(c));
      }, { prefix: s.key, compact: !!opts.compact }));
    }

    if (s.kind === "toggleBlocks"){
      const enabled = !!(c.nannyWorking?.enabled);
      const id = "nannyToggle_" + Math.random().toString(16).slice(2);
      body.innerHTML = `
        <div class="row" style="align-items:center; gap:10px;">
          <label style="margin:0; flex: 0 0 auto;">
            <input id="${id}" type="checkbox" ${enabled ? "checked":""} style="width:18px; height:18px; vertical-align:middle; accent-color: var(--accent);" />
            <span style="font-size:13px; color: var(--ink); margin-left:8px;">Yes, nanny is working</span>
          </label>
        </div>
        <div id="nannyBlocks" style="margin-top:10px; ${enabled ? "" : "display:none;"}"></div>
      `;
      const toggle = body.querySelector(`#${id}`);
      const blocksWrap = body.querySelector("#nannyBlocks");
      blocksWrap.appendChild(renderBlocksEditor((c.nannyWorking?.blocks)||[], (blocks) => {
        c.nannyWorking = c.nannyWorking || { enabled:false, blocks:[] };
        c.nannyWorking.blocks = blocks;
        onChange(deepCopy(c));
      }, { prefix:"nannyWorking", compact: !!opts.compact }));
      toggle.addEventListener("change", (e) => {
        const on = e.target.checked;
        c.nannyWorking = c.nannyWorking || { enabled:false, blocks:[] };
        c.nannyWorking.enabled = on;
        blocksWrap.style.display = on ? "" : "none";
        onChange(deepCopy(c));
      });
    }

    if (s.kind === "bedtime"){
      const value = c.bedtimeBy || "Kristyn";
      const a = "bedA_" + Math.random().toString(16).slice(2);
      const b = "bedB_" + Math.random().toString(16).slice(2);
      body.innerHTML = `
        <div class="row" style="gap:10px;">
          <label style="margin:0;">
            <input type="radio" name="bedtimeBy" value="Kristyn" ${value==="Kristyn"?"checked":""} style="accent-color: var(--accent); width:18px; height:18px; vertical-align:middle;" />
            <span style="margin-left:8px; font-size:13px; color: var(--ink);">Kristyn</span>
          </label>
          <label style="margin:0;">
            <input type="radio" name="bedtimeBy" value="Julio" ${value==="Julio"?"checked":""} style="accent-color: var(--accent); width:18px; height:18px; vertical-align:middle;" />
            <span style="margin-left:8px; font-size:13px; color: var(--ink);">Julio</span>
          </label>
        </div>
      `;
      $all('input[name="bedtimeBy"]', body).forEach(r => {
        r.addEventListener("change", () => {
          c.bedtimeBy = body.querySelector('input[name="bedtimeBy"]:checked')?.value || "Kristyn";
          onChange(deepCopy(c));
        });
      });
    }

    if (s.kind === "appointments"){
      body.appendChild(renderAppointmentsEditor(c.appointments || [], (appts) => {
        c.appointments = appts;
        onChange(deepCopy(c));
      }, { compact: !!opts.compact }));
    }

    root.appendChild(sec);
  }

  return wrap;
}

function renderBlocksEditor(blocks, onBlocksChange, opts = {}){
  const list = document.createElement("div");
  list.className = "list";
  const b = deepCopy(blocks || []);
  const prefix = opts.prefix || "blk";

  const render = () => {
    list.innerHTML = "";
    if (b.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No time blocks yet.";
      list.appendChild(empty);
    }
    b.forEach((blk, idx) => {
      const row = document.createElement("div");
      row.className = "item";
      const idp = `${prefix}_${idx}_${Math.random().toString(16).slice(2)}`;
      row.innerHTML = `
        <div style="flex:1;">
          <div class="hint" style="margin-bottom:6px;">${formatTime12(blk.start)} – ${formatTime12(blk.end)}</div>
          ${timePickerHTML(`${idp}_s`, blk.start)}
          <div style="height:8px;"></div>
          ${timePickerHTML(`${idp}_e`, blk.end)}
          <div class="row" style="margin-top:10px;">
            <button class="mini ghost" data-act="apply">Apply</button>
            <button class="mini danger" data-act="remove">Remove</button>
          </div>
        </div>
      `;
      row.querySelector('[data-act="apply"]').addEventListener("click", () => {
        const s = readTimePicker(`${idp}_s`);
        const e = readTimePicker(`${idp}_e`);
        b[idx].start = s;
        b[idx].end = e;
        normalizeBlocksInPlace(b);
        onBlocksChange(deepCopy(b));
        render();
      });
      row.querySelector('[data-act="remove"]').addEventListener("click", () => {
        b.splice(idx, 1);
        onBlocksChange(deepCopy(b));
        render();
      });
      list.appendChild(row);
    });

    const add = document.createElement("button");
    add.className = "ghost";
    add.textContent = "Add time block";
    add.addEventListener("click", () => {
      const start = "09:00";
      const end = "10:00";
      b.push({ start, end });
      normalizeBlocksInPlace(b);
      onBlocksChange(deepCopy(b));
      render();
    });
    list.appendChild(add);
  };

  render();
  return list;
}

function normalizeBlocksInPlace(blocks){
  // Ensure start < end, clamp to day, sort, and de-overlap by keeping order (do not auto-merge).
  blocks.forEach(b => {
    let s = minutesFromHHMM(b.start);
    let e = minutesFromHHMM(b.end);
    if (s === null || e === null){ b.start = "09:00"; b.end="10:00"; return; }
    s = clamp(s, 0, 24*60-1);
    e = clamp(e, 1, 24*60);
    if (e <= s) e = Math.min(24*60, s + 30);
    b.start = hhmmFromMinutes(s);
    b.end = hhmmFromMinutes(e);
  });
  blocks.sort((a,b) => minutesFromHHMM(a.start) - minutesFromHHMM(b.start));
}

function renderAppointmentsEditor(appts, onApptsChange, opts = {}){
  const list = document.createElement("div");
  list.className = "list";
  const a = deepCopy(appts || []);

  const render = () => {
    list.innerHTML = "";
    if (a.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No appointments added.";
      list.appendChild(empty);
    }
    a.forEach((appt, idx) => {
      const row = document.createElement("div");
      row.className = "item";
      const idp = `appt_${idx}_${Math.random().toString(16).slice(2)}`;
      row.innerHTML = `
        <div style="flex:1;">
          <label>Title</label>
          <input id="${idp}_t" value="${escapeAttr(appt.title||"")}" placeholder="Example: Doctor appointment" />
          <label>Start</label>
          ${timePickerHTML(`${idp}_s`, appt.start)}
          <label>End</label>
          ${timePickerHTML(`${idp}_e`, appt.end)}
          <div class="row" style="margin-top:10px;">
            <button class="mini ghost" data-act="apply">Apply</button>
            <button class="mini danger" data-act="remove">Remove</button>
          </div>
        </div>
      `;
      row.querySelector('[data-act="apply"]').addEventListener("click", () => {
        const title = $(`#${idp}_t`)?.value?.trim() || "Appointment";
        const s = readTimePicker(`${idp}_s`);
        const e = readTimePicker(`${idp}_e`);
        a[idx] = { ...a[idx], title, start: s, end: e };
        normalizeAppointmentsInPlace(a);
        onApptsChange(deepCopy(a));
        render();
      });
      row.querySelector('[data-act="remove"]').addEventListener("click", () => {
        a.splice(idx, 1);
        onApptsChange(deepCopy(a));
        render();
      });
      list.appendChild(row);
    });

    const add = document.createElement("button");
    add.className = "ghost";
    add.textContent = "Add appointment";
    add.addEventListener("click", () => {
      a.push({ id: cryptoRandomId(), title:"Appointment", start:"10:00", end:"10:30" });
      normalizeAppointmentsInPlace(a);
      onApptsChange(deepCopy(a));
      render();
    });
    list.appendChild(add);
  };

  render();
  return list;
}

function normalizeAppointmentsInPlace(appts){
  appts.forEach(a => {
    let s = minutesFromHHMM(a.start);
    let e = minutesFromHHMM(a.end);
    if (s === null || e === null){ a.start="10:00"; a.end="10:30"; return; }
    s = clamp(s, 0, 24*60-1);
    e = clamp(e, 1, 24*60);
    if (e <= s) e = Math.min(24*60, s + 30);
    a.start = hhmmFromMinutes(s);
    a.end = hhmmFromMinutes(e);
    if (!a.id) a.id = cryptoRandomId();
  });
  appts.sort((x,y) => minutesFromHHMM(x.start) - minutesFromHHMM(y.start));
}

function cryptoRandomId(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/* =========================
   Scheduling engine
   ========================= */
function generateScheduleForDay(isoDay){
  const settings = App.settings;
  const plan = App.plansByDay.get(isoDay) || emptyPlanPayload(isoDay);
  const log = App.logsByDay.get(isoDay) || emptyLogRecord(isoDay);
  const warnings = [];

  // Determine wake time
  const wakeHHMM = log.wake_time || settings.defaultWakeTime;
  const wakeMin = minutesFromHHMM(wakeHHMM);

  // Determine nap times (actual overrides)
  const ww1 = settings.ww1MidMin;
  const ww2 = settings.ww2MidMin;
  const ww3 = settings.ww3MidMin;

  // Forecasted nap1 start/end
  let nap1StartMin = wakeMin + ww1;
  let nap1EndMin = nap1StartMin + settings.nap1ForecastMin;

  // Actual nap1 overrides
  if (log.nap1_start) nap1StartMin = minutesFromHHMM(log.nap1_start);
  if (log.nap1_end) nap1EndMin = minutesFromHHMM(log.nap1_end);
  else if (log.nap1_start && !log.nap1_end) nap1EndMin = nap1StartMin + settings.nap1ForecastMin;

  // Forecast nap2 start/end based on nap1 end
  let nap2StartMin = nap1EndMin + ww2;
  let nap2EndMin = nap2StartMin + settings.nap2ForecastMin;

  if (log.nap2_start) nap2StartMin = minutesFromHHMM(log.nap2_start);
  if (log.nap2_end) nap2EndMin = minutesFromHHMM(log.nap2_end);
  else if (log.nap2_start && !log.nap2_end) nap2EndMin = nap2StartMin + settings.nap2ForecastMin;

  // Bedtime forecast
  let bedtimeMin = nap2EndMin + ww3;
  const latest = minutesFromHHMM(settings.latestBedtimeHHMM);
  const earliest = minutesFromHHMM(settings.earliestBedtimeHHMM);
  bedtimeMin = clamp(bedtimeMin, earliest, latest);
  if (log.bedtime_time) bedtimeMin = minutesFromHHMM(log.bedtime_time);

  // Build routine blocks (only real tasks)
  const blocks = [];

  function addBlock(title, startMin, endMin, kind="routine", meta={}){
    if (endMin <= startMin) return;
    blocks.push({
      id: cryptoRandomId(),
      title,
      startMin,
      endMin,
      kind,
      meta,
    });
  }

  // Morning: cuddle, get dressed, breakfast, brush teeth
  let t = wakeMin;
  addBlock("Family cuddle", t, t + settings.cuddleMin, "routine"); t += settings.cuddleMin;
  addBlock("Get dressed", t, t + settings.getDressedMin, "routine"); t += settings.getDressedMin;
  addBlock("Breakfast (prep + eat)", t, t + settings.breakfastDurationMin, "routine"); t += settings.breakfastDurationMin;
  addBlock("Brush teeth", t, t + settings.brushTeethMin, "routine"); t += settings.brushTeethMin;

  // Nap 1 routine + nap
  const nap1RoutineStart = nap1StartMin - settings.napRoutineDurationMin;
  addBlock("Nap routine (Nap 1)", nap1RoutineStart, nap1StartMin, "routine", { napIndex: 1 });
  addBlock("Nap 1", nap1StartMin, nap1EndMin, "nap", { napIndex: 1 });

  // Midday: lunch + snack+milk
  // Lunch around 30 min after nap1 end; snack ~2 hours after nap1 end
  let lunchStart = nap1EndMin + 30;
  addBlock("Lunch (prep + eat)", lunchStart, lunchStart + settings.lunchDurationMin, "routine");

  let snack1Start = nap1EndMin + 120;
  addBlock("Snack + milk", snack1Start, snack1Start + settings.snackMilkDurationMin, "routine");

  // Nap 2 routine + nap
  const nap2RoutineStart = nap2StartMin - settings.napRoutineDurationMin;
  addBlock("Nap routine (Nap 2)", nap2RoutineStart, nap2StartMin, "routine", { napIndex: 2 });
  addBlock("Nap 2", nap2StartMin, nap2EndMin, "nap", { napIndex: 2 });

  // Evening: dinner, (sometimes bath), snack+milk, brush, bedtime routine
  let dinnerStart = nap2EndMin + 60;
  addBlock("Dinner (prep + eat)", dinnerStart, dinnerStart + settings.dinnerDurationMin, "routine");

  // Bath: at least every 3 days; not when Julio unavailable
  const bathDue = isBathDue(isoDay);
  if (bathDue){
    const bathSlot = proposeBathSlot(isoDay, plan.constraints, dinnerStart + settings.dinnerDurationMin, bedtimeMin - (settings.bedtimeRoutineDurationMin + 50));
    if (bathSlot){
      addBlock("Bath", bathSlot.startMin, bathSlot.endMin, "routine", { bath: true });
    } else {
      warnings.push("Bath is overdue, but there was no safe slot when Julio is available.");
    }
  }

  let snack2Start = bedtimeMin - 45;
  addBlock("Snack + milk", snack2Start, snack2Start + settings.snackMilkDurationMin, "routine");

  let brush2Start = bedtimeMin - 20;
  addBlock("Brush teeth", brush2Start, brush2Start + settings.brushTeethMin, "routine");

  addBlock("Bedtime routine", bedtimeMin - settings.bedtimeRoutineDurationMin, bedtimeMin, "routine", { bedtimeBy: plan.constraints?.bedtimeBy || "Kristyn" });

  // Appointments: only affect scheduling if overlap scheduled items
  const appts = (plan.constraints?.appointments || []).map(a => ({
    id: a.id || cryptoRandomId(),
    title: a.title || "Appointment",
    startMin: minutesFromHHMM(a.start),
    endMin: minutesFromHHMM(a.end),
  })).filter(a => a.startMin !== null && a.endMin !== null && a.endMin > a.startMin);

  // Add appointment blocks separately
  for (const a of appts){
    addBlock(a.title, a.startMin, a.endMin, "appt", {});
  }

  // Adjust for overlapping appointments
  adjustForAppointments(blocks, appts, warnings);

  // Assign caregivers for naps (and flag uncovered)
  applyCaregiverAssignments(blocks, plan.constraints, warnings);

  // Clean: sort and return
  const outBlocks = blocks
    .filter(b => b.endMin > b.startMin)
    .sort((a,b) => a.startMin - b.startMin)
    .map(b => ({
      ...b,
      startHHMM: hhmmFromMinutes(b.startMin),
      endHHMM: hhmmFromMinutes(b.endMin),
    }));

  return { blocks: outBlocks, warnings };
}

function isBathDue(isoDay){
  // Bath must happen at least every 3 days.
  // We consider "bath done" in logs. If none in past 2 days, due today.
  const today = fromIsoDate(isoDay);
  for (let back = 0; back <= 2; back++){
    const d = new Date(today);
    d.setDate(today.getDate() - back);
    const iso = toIsoDate(d);
    const log = App.logsByDay.get(iso);
    if (log?.bath_done) return false;
  }
  // if we've never logged baths, we treat as due on day 3+ (still due)
  return true;
}

function proposeBathSlot(isoDay, constraints, earliestMin, latestMin){
  // Can't be when Julio is unavailable.
  // We'll pick a 20-min slot (or 25?) that fits and doesn't overlap Julio unavailable blocks.
  const dur = 20;
  const julioUn = (constraints?.julioUnavailable || []).map(b => ({
    s: minutesFromHHMM(b.start), e: minutesFromHHMM(b.end)
  })).filter(x=>x.s!==null&&x.e!==null&&x.e>x.s);

  const start = clamp(earliestMin, 0, 24*60);
  const end = clamp(latestMin, 0, 24*60);
  if (end - start < dur) return null;

  for (let t = start; t <= end - dur; t += 15){
    const ok = julioUn.every(u => !overlaps(t, t+dur, u.s, u.e));
    if (ok) return { startMin: t, endMin: t+dur };
  }
  return null;
}

function adjustForAppointments(blocks, appts, warnings){
  if (!appts.length) return;

  // Appointment priority: keep as-is. For routine items that overlap, try to move if "movable".
  const movableTitles = new Set(["Breakfast (prep + eat)", "Lunch (prep + eat)", "Dinner (prep + eat)", "Snack + milk", "Bath"]);
  const fixedKinds = new Set(["nap"]); // nap is semi-movable, but only within limit

  // Helper: check overlap with any appointment
  const apptOverlap = (s,e) => appts.some(a => overlaps(s,e,a.startMin,a.endMin));

  // Move routine blocks if possible
  for (const b of blocks){
    if (b.kind === "appt") continue;
    if (!apptOverlap(b.startMin, b.endMin)) continue;

    const dur = b.endMin - b.startMin;

    // Nap: allow limited shift if overlap
    if (b.kind === "nap"){
      const nextStart = nextNonOverlappingTime(b.startMin, dur, appts, blocks, 90);
      if (nextStart !== null){
        const delta = nextStart - b.startMin;
        b.startMin = nextStart;
        b.endMin = nextStart + dur;
        // also shift associated nap routine block (if present and same napIndex)
        const idx = b.meta?.napIndex;
        const routine = blocks.find(x => x.meta?.napIndex === idx && x.title.startsWith("Nap routine"));
        if (routine){
          routine.endMin = b.startMin;
          routine.startMin = b.startMin - (routine.endMin - routine.startMin);
        }
        // shift downstream blocks (simple approach) for nap 1 affects nap 2 schedule
        // We'll only do minimal: if nap1 changed, keep nap2 forecasted start anchored on nap1 end.
        // (Instead of rebuilding everything, we flag.)
        warnings.push(`Appointment overlaps ${b.title}. Nap shifted.`);
      } else {
        warnings.push(`Appointment overlaps ${b.title}. Please review.`);
        b.kind = "warn";
      }
      continue;
    }

    // Movable routine blocks
    if (movableTitles.has(b.title)){
      const newStart = nextNonOverlappingTime(b.startMin, dur, appts, blocks, 240);
      if (newStart !== null){
        b.startMin = newStart;
        b.endMin = newStart + dur;
        b.meta.moved = true;
      } else {
        warnings.push(`Appointment overlaps "${b.title}". No open slot found.`);
        b.kind = "warn";
      }
      continue;
    }

    // Non-movable routine
    warnings.push(`Appointment overlaps "${b.title}".`);
    b.kind = "warn";
  }
}

function nextNonOverlappingTime(originalStart, dur, appts, blocks, maxShiftMin){
  // Try forward then backward in 15-min increments, limited by maxShiftMin.
  // Must not overlap any appointment, and must not overlap other non-appointment blocks.
  const other = blocks.filter(b => b.kind !== "appt");
  const step = 15;

  const fits = (s) => {
    const e = s + dur;
    if (s < 0 || e > 24*60) return false;
    if (appts.some(a => overlaps(s,e,a.startMin,a.endMin))) return false;
    // Avoid overlap with other blocks except itself, and except open time.
    for (const b of other){
      if (b.startMin === originalStart && (b.endMin - b.startMin) === dur) continue;
      if (overlaps(s,e,b.startMin,b.endMin)) return false;
    }
    return true;
  };

  if (fits(originalStart)) return originalStart;

  for (let shift = step; shift <= maxShiftMin; shift += step){
    if (fits(originalStart + shift)) return originalStart + shift;
    if (fits(originalStart - shift)) return originalStart - shift;
  }
  return null;
}

function applyCaregiverAssignments(blocks, constraints, warnings){
  const c = constraints || {};
  const parentAvailable = (person, startMin, endMin) => {
    const un = (person === "Kristyn" ? (c.kristynUnavailable||[]) : (c.julioUnavailable||[]))
      .map(b => ({ s: minutesFromHHMM(b.start), e: minutesFromHHMM(b.end) }))
      .filter(x=>x.s!==null&&x.e!==null&&x.e>x.s);

    // Available if no unavailable overlap at all across entire window
    return un.every(u => !overlaps(startMin, endMin, u.s, u.e));
  };

  const nannyCovers = (startMin, endMin) => {
    if (!c.nannyWorking?.enabled) return false;
    const blocks = (c.nannyWorking.blocks || []).map(b => ({ s: minutesFromHHMM(b.start), e: minutesFromHHMM(b.end) }))
      .filter(x=>x.s!==null&&x.e!==null&&x.e>x.s);
    // covers full window if there exists a block that fully contains it
    return blocks.some(b => b.s <= startMin && b.e >= endMin);
  };

  // Kayden is never assigned naps.

  for (const b of blocks){
    if (b.kind !== "nap") continue;

    const napIndex = b.meta?.napIndex;
    const routine = blocks.find(x => x.meta?.napIndex === napIndex && x.title.startsWith("Nap routine"));
    const start = routine ? routine.startMin : b.startMin;
    const end = b.endMin;

    const kristynOk = parentAvailable("Kristyn", start, end);
    const julioOk = parentAvailable("Julio", start, end);

    let assigned = null;

    if (kristynOk || julioOk){
      // at least one parent available -> assign a parent (prefer the parent who is available)
      assigned = kristynOk ? "Kristyn" : "Julio";
    } else if (nannyCovers(start, end)){
      assigned = "Nanny";
    } else {
      assigned = "Uncovered";
      warnings.push(`${b.title} is uncovered (no parent available; nanny does not cover full window).`);
    }

    b.meta.assignedTo = assigned;
    if (routine) routine.meta.assignedTo = assigned;
    if (assigned === "Uncovered"){
      b.kind = "warn";
      if (routine) routine.kind = "warn";
    }
  }
}

/* =========================
   Timeline rendering (2-hour grid + overlap lanes)
   ========================= */
function renderTimeline(blocks){
  const wrap = document.createElement("div");
  wrap.className = "timeline";

  const grid = document.createElement("div");
  grid.className = "tlGrid";
  wrap.appendChild(grid);

  // Hour lines + labels
  for (let h=0; h<=24; h++){
    const top = h * hourPx();
    const line = document.createElement("div");
    line.className = "hourLine";
    line.style.top = `${top}px`;
    grid.appendChild(line);

    if (h < 24 && h % 2 === 0){
      const label = document.createElement("div");
      label.className = "hourLabel";
      label.style.top = `${top}px`;
      label.textContent = formatTime12FromMinutes(h*60);
      grid.appendChild(label);
    }
  }

  const laneWrap = document.createElement("div");
  laneWrap.className = "laneWrap";
  grid.appendChild(laneWrap);

  const rendered = blocks.map(b => ({
    ...b,
    startMin: minutesFromHHMM(b.startHHMM),
    endMin: minutesFromHHMM(b.endHHMM),
  })).filter(b => b.endMin > b.startMin);

  // Assign lanes for overlapping blocks
  const laneInfo = assignLanes(rendered);

  const totalWidth = () => laneWrap.getBoundingClientRect().width || 1;

  for (const b of rendered){
    const lane = laneInfo.laneById.get(b.id) || 0;
    const lanes = laneInfo.lanesInGroupById.get(b.id) || 1;
    const gap = 8;
    const laneW = (100 / lanes);
    const leftPct = laneW * lane;
    const widthPct = laneW;

    const el = document.createElement("div");
    el.className = "block";
    if (b.kind === "appt") el.classList.add("appt");
    if (b.kind === "nap") el.classList.add("nap");
    if (b.kind === "warn") el.classList.add("warn");

    const top = (b.startMin * hourPx())/60;
    const height = ((b.endMin - b.startMin) * hourPx())/60;
    el.style.top = `${top}px`;
    el.style.height = `${Math.max(38, height)}px`;
    el.style.left = `calc(${leftPct}% + ${gap/2}px)`;
    el.style.width = `calc(${widthPct}% - ${gap}px)`;

    const timeLine = `${formatTime12(b.startHHMM)} – ${formatTime12(b.endHHMM)}`;
    const metaLine = metaLineText(b);
    el.innerHTML = `
      <p class="t">${escapeHtml(b.title)}</p>
      <p class="m">${escapeHtml(timeLine)}${metaLine ? ` · ${escapeHtml(metaLine)}` : ""}</p>
    `;
    laneWrap.appendChild(el);
  }

  // Scroll roughly to morning
  setTimeout(() => { wrap.scrollTop = Math.max(0, (7 * hourPx()) - 60); }, 0);

  return wrap;
}

function hourPx(){
  const root = document.documentElement;
  const v = getComputedStyle(root).getPropertyValue("--hourPx").trim();
  const n = Number(v.replace("px",""));
  return Number.isFinite(n) ? n : 78;
}

function assignLanes(blocks){
  // blocks: [{id,startMin,endMin}] -> lane index and lanes per overlap group
  const items = blocks.slice().sort((a,b)=>a.startMin-b.startMin);

  // Build overlap groups by sweep line
  const groups = [];
  let current = [];
  let currentEnd = -1;
  for (const b of items){
    if (current.length === 0){
      current = [b];
      currentEnd = b.endMin;
    } else if (b.startMin < currentEnd){
      current.push(b);
      currentEnd = Math.max(currentEnd, b.endMin);
    } else {
      groups.push(current);
      current = [b];
      currentEnd = b.endMin;
    }
  }
  if (current.length) groups.push(current);

  const laneById = new Map();
  const lanesInGroupById = new Map();

  for (const group of groups){
    // Greedy interval graph coloring
    const lanes = [];
    for (const b of group.sort((a,b)=>a.startMin-b.startMin)){
      let placed = false;
      for (let i=0; i<lanes.length; i++){
        const last = lanes[i][lanes[i].length-1];
        if (last.endMin <= b.startMin){
          lanes[i].push(b);
          laneById.set(b.id, i);
          placed = true;
          break;
        }
      }
      if (!placed){
        lanes.push([b]);
        laneById.set(b.id, lanes.length-1);
      }
    }
    const laneCount = lanes.length;
    for (const b of group){
      lanesInGroupById.set(b.id, laneCount);
    }
  }

  return { laneById, lanesInGroupById };
}

function metaLineText(block){
  const m = block.meta || {};
  if (block.kind === "nap") {
    const who = m.assignedTo ? m.assignedTo : "";
    return who && who !== "Uncovered" ? `Caregiver: ${who}` : (who==="Uncovered" ? "Uncovered" : "");
  }
  if (block.title.startsWith("Nap routine")){
    const who = m.assignedTo ? m.assignedTo : "";
    return who && who !== "Uncovered" ? `Caregiver: ${who}` : (who==="Uncovered" ? "Uncovered" : "");
  }
  if (block.title === "Bedtime routine"){
    return m.bedtimeBy ? `Bedtime by ${m.bedtimeBy}` : "";
  }
  if (m.moved) return "Moved for appointment";
  return "";
}

/* =========================
   Today view: logging controls
   ========================= */
function renderToday(){
  const iso = App.todayIso;
  const d = fromIsoDate(iso);
  setSubhead(`Today · ${formatDateShort(d)}`);

  const plan = App.plansByDay.get(iso) || emptyPlanPayload(iso);
  const log = App.logsByDay.get(iso) || emptyLogRecord(iso);
  const schedule = generateScheduleForDay(iso);

  const todayTasks = App.tasks
    .filter(t => !t.completed && t.assigned_date === iso)
    .slice(0, 100);

  const root = document.createElement("div");
  root.className = "grid";

  // Top card: logging controls
  const c1 = document.createElement("div");
  c1.className = "card";
  c1.innerHTML = `
    <div class="hd">
      <div>
        <h2>Today</h2>
        <p>Wake time updates the schedule instantly. Nap buttons are fast, with optional manual edits.</p>
      </div>
      <div class="row" style="justify-content:flex-end; flex:0 0 auto;">
        <button class="mini ghost" id="btnEditTodayPlan">Edit plan</button>
        ${CONFIG.appsScriptUrl && CONFIG.appsScriptApiKey ? `<button class="mini ghost" id="btnExportToday">Export</button>` : ``}
      </div>
    </div>
    <div class="bd">
      <div class="row">
        <div>
          <label>Actual wake time</label>
          <div class="row">
            <button class="ghost" id="wakeNow">Set now (${formatTime12(nowHHMM())})</button>
            <div id="wakePick"></div>
          </div>
        </div>
        <div>
          <label>Bedtime + overnight notes (tracking only)</label>
          <div class="row">
            <div id="bedPick"></div>
            <button class="ghost" id="bedNow">Set bedtime now</button>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="row">
        <div>
          <label>Nap 1</label>
          <div class="row">
            <button class="primary" id="nap1Toggle"></button>
            <div id="nap1StartPick"></div>
            <div id="nap1EndPick"></div>
          </div>
        </div>
        <div>
          <label>Nap 2</label>
          <div class="row">
            <button class="primary" id="nap2Toggle"></button>
            <div id="nap2StartPick"></div>
            <div id="nap2EndPick"></div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="row">
        <div>
          <label>Overnight notes</label>
          <textarea id="overnightNotes" placeholder="Example: rough night around 2:00 AM, teething"></textarea>
        </div>
        <div>
          <label>Bath done today</label>
          <div class="item">
            <input type="checkbox" id="bathDone" ${log.bath_done ? "checked":""}>
            <div class="txt">
              <div>Bath completed</div>
              <div class="sub">Used to keep the “every 3 days” rule on track.</div>
            </div>
          </div>
          ${schedule.warnings.length ? `<div class="divider"></div>
            <div class="badge warn">Flags</div>
            <div class="hint" style="margin-top:8px;">${schedule.warnings.map(w=>"• "+escapeHtml(w)).join("<br>")}</div>` : ``}
        </div>
      </div>
    </div>
  `;
  root.appendChild(c1);

  // Fill time pickers
  $("#wakePick", c1).innerHTML = timePickerHTML("wake", log.wake_time || App.settings.defaultWakeTime);
  $("#bedPick", c1).innerHTML = timePickerHTML("bed", log.bedtime_time || App.settings.latestBedtimeHHMM);
  $("#nap1StartPick", c1).innerHTML = timePickerHTML("n1s", log.nap1_start || "");
  $("#nap1EndPick", c1).innerHTML = timePickerHTML("n1e", log.nap1_end || "");
  $("#nap2StartPick", c1).innerHTML = timePickerHTML("n2s", log.nap2_start || "");
  $("#nap2EndPick", c1).innerHTML = timePickerHTML("n2e", log.nap2_end || "");

  $("#overnightNotes", c1).value = log.overnight_notes || "";

  // Toggle labels
  updateNapToggleLabels(c1, log);

  // Handlers
  $("#btnEditTodayPlan", c1).onclick = () => openQuickEdit(iso);
  const exp = $("#btnExportToday", c1);
  if (exp){
    exp.onclick = async () => exportDayToCalendar(iso, schedule.blocks);
  }

  $("#wakeNow", c1).onclick = async () => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso, wake_time: nowHHMM() };
    await upsertLog(iso, record);
    render();
  };
  $("#bedNow", c1).onclick = async () => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso, bedtime_time: nowHHMM() };
    await upsertLog(iso, record);
    render();
  };

  // Manual wake/bed apply on change
  $all("#wake_h, #wake_m, #wake_ap", c1).forEach(el => el.addEventListener("change", async () => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso, wake_time: readTimePicker("wake") };
    await upsertLog(iso, record);
    render();
  }));
  $all("#bed_h, #bed_m, #bed_ap", c1).forEach(el => el.addEventListener("change", async () => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso, bedtime_time: readTimePicker("bed") };
    await upsertLog(iso, record);
    render();
  }));

  // Nap toggles
  $("#nap1Toggle", c1).onclick = async () => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso };
    if (!record.nap1_start){
      record.nap1_start = nowHHMM();
    } else if (record.nap1_start && !record.nap1_end){
      record.nap1_end = nowHHMM();
    } else {
      // reset
      record.nap1_start = null; record.nap1_end = null;
    }
    await upsertLog(iso, record);
    render();
  };
  $("#nap2Toggle", c1).onclick = async () => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso };
    if (!record.nap2_start){
      record.nap2_start = nowHHMM();
    } else if (record.nap2_start && !record.nap2_end){
      record.nap2_end = nowHHMM();
    } else {
      record.nap2_start = null; record.nap2_end = null;
    }
    await upsertLog(iso, record);
    render();
  };

  // Manual nap apply on change
  const manualNapChange = async () => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso };
    record.nap1_start = readTimePicker("n1s");
    record.nap1_end = readTimePicker("n1e");
    record.nap2_start = readTimePicker("n2s");
    record.nap2_end = readTimePicker("n2e");
    await upsertLog(iso, record);
    render();
  };
  ["n1s","n1e","n2s","n2e"].forEach(p => {
    $all(`#${p}_h, #${p}_m, #${p}_ap`, c1).forEach(el => el.addEventListener("change", manualNapChange));
  });

  $("#overnightNotes", c1).addEventListener("input", debounce(async (e) => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso, overnight_notes: e.target.value };
    await upsertLog(iso, record);
  }, 400));

  $("#bathDone", c1).addEventListener("change", async (e) => {
    const record = { ...(App.logsByDay.get(iso) || emptyLogRecord(iso)), day: iso, bath_done: e.target.checked };
    await upsertLog(iso, record);
    render();
  });

  // Two-column layout: timeline + tasks
  const c2 = document.createElement("div");
  c2.className = "card";
  c2.innerHTML = `
    <div class="hd">
      <div>
        <h2>Schedule + tasks</h2>
        <p>Open gaps remain blank.</p>
      </div>
    </div>
    <div class="bd">
      <div class="twoCol" id="todayTwo"></div>
    </div>
  `;
  const two = $("#todayTwo", c2);
  const left = document.createElement("div");
  left.appendChild(renderTimeline(schedule.blocks));
  const right = document.createElement("div");
  right.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;">
      <div class="badge">Tasks for Today</div>
      <button class="mini ghost" id="btnGoTasks">Manage</button>
    </div>
    <div class="list" id="todayTaskList"></div>
  `;
  const tl = $("#todayTaskList", right);
  if (todayTasks.length === 0){
    tl.innerHTML = `<div class="hint">No tasks assigned to today.</div>`;
  } else {
    todayTasks.forEach(t => {
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <input type="checkbox">
        <div class="txt">
          <div>${escapeHtml(t.title)}</div>
        </div>
      `;
      row.querySelector("input").addEventListener("change", async (e) => {
        await updateTask(t.id, { completed: true, completed_at: new Date().toISOString() });
        render();
      });
      tl.appendChild(row);
    });
  }
  $("#btnGoTasks", right).onclick = () => {
    App.activeTab = "tasks";
    renderTabs();
    render();
  };

  two.appendChild(left);
  two.appendChild(right);
  root.appendChild(c2);

  return root;
}

function updateNapToggleLabels(card, log){
  const n1 = $("#nap1Toggle", card);
  const n2 = $("#nap2Toggle", card);
  n1.textContent = !log.nap1_start ? "Start Nap 1 (set now)" : (!log.nap1_end ? "End Nap 1 (set now)" : "Reset Nap 1");
  n2.textContent = !log.nap2_start ? "Start Nap 2 (set now)" : (!log.nap2_end ? "End Nap 2 (set now)" : "Reset Nap 2");
}

/* =========================
   Evening view
   ========================= */
function renderEvening(){
  const iso = App.tomorrowIso;
  const d = fromIsoDate(iso);
  setSubhead(`Evening · Tomorrow ${formatDateShort(d)}`);

  const plan = App.plansByDay.get(iso);
  const root = document.createElement("div");
  root.className = "grid";

  const c1 = document.createElement("div");
  c1.className = "card";
  c1.innerHTML = `
    <div class="hd">
      <div>
        <h2>Tomorrow plan</h2>
        <p>${plan ? "Saved plan is ready. You can edit quickly in the morning." : "No plan saved yet. Use the quick evening flow."}</p>
      </div>
      <div class="row" style="justify-content:flex-end; flex:0 0 auto;">
        <button class="mini primary" id="btnOpenWizard">${plan ? "Edit plan" : "Prepare for the Day Ahead"}</button>
        ${plan ? `<button class="mini ghost" id="btnQuickEdit">Quick edit</button>` : ``}
      </div>
    </div>
    <div class="bd" id="eveningBody"></div>
  `;
  root.appendChild(c1);

  const body = $("#eveningBody", c1);

  if (!plan){
    body.innerHTML = `
      <div class="hint">The wizard never skips steps, and autosaves so edits aren’t lost.</div>
      <div class="divider"></div>
      <div class="hint"><strong>What it captures:</strong><br>
        • Unavailability blocks (Kristyn/Julio)<br>
        • Nanny working blocks (optional)<br>
        • Kayden availability blocks (naps excluded)<br>
        • Bedtime person (Kristyn or Julio)<br>
        • Appointments (only influence schedule if they overlap a scheduled block)
      </div>
    `;
  } else {
    const preview = generateScheduleForDay(iso);
    body.innerHTML = `
      <div class="row" style="margin-bottom:10px; align-items:center;">
        <span class="badge ${preview.warnings.length? "warn":"ok"}">${preview.warnings.length? "Needs attention":"Looks good"}</span>
        ${CONFIG.appsScriptUrl && CONFIG.appsScriptApiKey ? `<button class="mini ghost" id="btnExportTomorrow2">Export to Calendar</button>` : ``}
      </div>
      <div id="tomorrowTl"></div>
      ${preview.warnings.length ? `<div class="divider"></div>
        <div class="hint"><strong>Flags:</strong><br>${preview.warnings.map(w => "• " + escapeHtml(w)).join("<br>")}</div>` : ``}
    `;
    $("#tomorrowTl", c1).appendChild(renderTimeline(preview.blocks));
    const exp = $("#btnExportTomorrow2", c1);
    if (exp){
      exp.onclick = async () => exportDayToCalendar(iso, preview.blocks);
    }
  }

  $("#btnOpenWizard", c1).onclick = () => openWizard(iso);
  const qe = $("#btnQuickEdit", c1);
  if (qe) qe.onclick = () => openQuickEdit(iso);

  // Focus tasks summary
  const c2 = document.createElement("div");
  c2.className = "card";
  const focusIds = (plan?.focusTaskIds || []);
  const focusTasks = App.tasks.filter(t => focusIds.includes(t.id) && !t.completed).slice(0, 50);
  c2.innerHTML = `
    <div class="hd">
      <div>
        <h2>Tomorrow focus</h2>
        <p>Tasks selected in the wizard (you can move them to Today in the morning).</p>
      </div>
    </div>
    <div class="bd">
      <div class="list" id="focusSum"></div>
    </div>
  `;
  const fs = $("#focusSum", c2);
  if (!plan || focusTasks.length === 0){
    fs.innerHTML = `<div class="hint">No focus tasks selected yet.</div>`;
  } else {
    focusTasks.forEach(t => {
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <input type="checkbox">
        <div class="txt">
          <div>${escapeHtml(t.title)}</div>
          <div class="sub">Assigned to ${formatDateShort(fromIsoDate(iso))}</div>
        </div>
      `;
      row.querySelector("input").addEventListener("change", async () => {
        await updateTask(t.id, { completed: true, completed_at: new Date().toISOString() });
        render();
      });
      fs.appendChild(row);
    });
  }
  root.appendChild(c2);

  return root;
}

/* =========================
   Tasks view
   ========================= */
function renderTasks(){
  setSubhead("Tasks");

  const isoToday = App.todayIso;
  const isoTomorrow = App.tomorrowIso;

  const root = document.createElement("div");
  root.className = "grid";

  const c1 = document.createElement("div");
  c1.className = "card";
  c1.innerHTML = `
    <div class="hd">
      <div>
        <h2>Master task list</h2>
        <p>Add tasks anytime. Assign to Today with one tap.</p>
      </div>
    </div>
    <div class="bd">
      <label>Add a task</label>
      <div class="row">
        <input id="newTask" placeholder="Example: Wash bottles" />
        <button class="primary" id="addTaskBtn">Add</button>
      </div>
      <div class="divider"></div>
      <div class="list" id="taskList"></div>
    </div>
  `;
  root.appendChild(c1);

  $("#addTaskBtn", c1).onclick = async () => {
    const v = $("#newTask", c1).value;
    await addTask(v);
    $("#newTask", c1).value = "";
    render();
  };
  $("#newTask", c1).addEventListener("keydown", async (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      await addTask($("#newTask", c1).value);
      $("#newTask", c1).value = "";
      render();
    }
  });

  const list = $("#taskList", c1);
  const tasks = App.tasks.slice(0, 200);

  if (tasks.length === 0){
    list.innerHTML = `<div class="hint">No tasks yet.</div>`;
  } else {
    tasks.forEach(t => {
      const row = document.createElement("div");
      row.className = "item";
      const assigned = t.assigned_date ? formatDateShort(fromIsoDate(t.assigned_date)) : "Not assigned";
      row.innerHTML = `
        <input type="checkbox" ${t.completed ? "checked":""}>
        <div class="txt">
          <div style="${t.completed ? "text-decoration:line-through; color: var(--muted);" : ""}">${escapeHtml(t.title)}</div>
          <div class="sub">${assigned}</div>
          <div class="row" style="margin-top:8px;">
            <button class="mini ghost" data-act="today">Assign to Today (${formatDateShort(fromIsoDate(isoToday))})</button>
            <button class="mini ghost" data-act="tom">Assign to Tomorrow (${formatDateShort(fromIsoDate(isoTomorrow))})</button>
            <button class="mini danger" data-act="clear">Clear date</button>
          </div>
        </div>
      `;
      row.querySelector("input").addEventListener("change", async (e) => {
        await updateTask(t.id, { completed: e.target.checked, completed_at: e.target.checked ? new Date().toISOString() : null });
        render();
      });
      row.querySelector('[data-act="today"]').onclick = async () => { await updateTask(t.id, { assigned_date: isoToday }); render(); };
      row.querySelector('[data-act="tom"]').onclick = async () => { await updateTask(t.id, { assigned_date: isoTomorrow }); render(); };
      row.querySelector('[data-act="clear"]').onclick = async () => { await updateTask(t.id, { assigned_date: null }); render(); };
      list.appendChild(row);
    });
  }

  return root;
}

/* =========================
   History view
   ========================= */
function renderHistory(){
  setSubhead("History");

  const root = document.createElement("div");
  root.className = "grid";

  const c1 = document.createElement("div");
  c1.className = "card";
  c1.innerHTML = `
    <div class="hd">
      <div>
        <h2>Past days</h2>
        <p>Tap a date to view details.</p>
      </div>
    </div>
    <div class="bd">
      <div class="list" id="histList"></div>
    </div>
  `;
  root.appendChild(c1);

  const list = $("#histList", c1);

  const rows = Array.from(App.logsByDay.values())
    .slice()
    .sort((a,b) => (a.day < b.day ? 1 : -1));

  if (rows.length === 0){
    list.innerHTML = `<div class="hint">No saved logs yet. Today will appear here once you log something.</div>`;
    return root;
  }

  rows.slice(0, 60).forEach(r => {
    const date = formatDateShort(fromIsoDate(r.day));
    const line = [
      r.wake_time ? `Wake ${formatTime12(r.wake_time)}` : null,
      (r.nap1_start && r.nap1_end) ? `Nap 1 ${formatTime12(r.nap1_start)}–${formatTime12(r.nap1_end)}` : null,
      (r.nap2_start && r.nap2_end) ? `Nap 2 ${formatTime12(r.nap2_start)}–${formatTime12(r.nap2_end)}` : null,
    ].filter(Boolean).join(" · ") || "No details yet";

    const row = document.createElement("div");
    row.className = "item";
    row.style.cursor = "pointer";
    row.innerHTML = `
      <div class="txt">
        <div style="font-weight:650;">${date}</div>
        <div class="sub">${escapeHtml(line)}</div>
      </div>
      <div style="color:var(--muted); font-size:12px; align-self:center;">›</div>
    `;
    row.addEventListener("click", () => openHistoryDetail(r.day));
    list.appendChild(row);
  });

  return root;
}

function openHistoryDetail(isoDay){
  const rec = App.logsByDay.get(isoDay);
  if (!rec) return;

  const d = fromIsoDate(isoDay);
  const modal = $("#quickEditModal");
  $("#qeTitle").textContent = "Day details";
  $("#qeSub").textContent = formatDateShort(d);

  const b = $("#qeBody");
  b.innerHTML = `
    <div class="card" style="box-shadow:none; border-radius:18px; background:rgba(255,255,255,.65);">
      <div class="hd"><div><h2>Actuals</h2><p>Logged times and notes.</p></div></div>
      <div class="bd">
        <div class="hint">
          <strong>Wake:</strong> ${rec.wake_time ? formatTime12(rec.wake_time) : "—"}<br>
          <strong>Nap 1:</strong> ${(rec.nap1_start && rec.nap1_end) ? `${formatTime12(rec.nap1_start)}–${formatTime12(rec.nap1_end)}` : "—"}<br>
          <strong>Nap 2:</strong> ${(rec.nap2_start && rec.nap2_end) ? `${formatTime12(rec.nap2_start)}–${formatTime12(rec.nap2_end)}` : "—"}<br>
          <strong>Bedtime:</strong> ${rec.bedtime_time ? formatTime12(rec.bedtime_time) : "—"}<br>
          <strong>Bath done:</strong> ${rec.bath_done ? "Yes" : "No"}<br>
        </div>
        <div class="divider"></div>
        <div class="hint"><strong>Notes:</strong><br>${escapeHtml(rec.overnight_notes || "—")}</div>
      </div>
    </div>
  `;
  $("#qeSave").style.display = "none";
  $("#qeClose").textContent = "Close";
  $("#quickEditModal").classList.add("open");
  $("#quickEditModal").setAttribute("aria-hidden","false");

  $("#qeClose").onclick = () => {
    $("#qeSave").style.display = "";
    $("#qeTitle").textContent = "Quick edit";
    $("#qeClose").textContent = "Close";
    closeQuickEdit();
    // closeQuickEdit resets flags; but here we didn't set state. Just hide.
    $("#quickEditModal").classList.remove("open");
    $("#quickEditModal").setAttribute("aria-hidden","true");
  };
}

/* =========================
   Settings view
   ========================= */
function renderSettings(){
  setSubhead("Settings");

  const s = App.settings;
  const root = document.createElement("div");
  root.className = "grid";

  const c1 = document.createElement("div");
  c1.className = "card";
  c1.innerHTML = `
    <div class="hd">
      <div>
        <h2>Routine defaults</h2>
        <p>These settings drive tomorrow forecasting and today regeneration.</p>
      </div>
    </div>
    <div class="bd">
      <div class="row">
        <div>
          <label>Default wake time</label>
          <div id="setWakePick"></div>
        </div>
        <div>
          <label>Latest bedtime cap</label>
          <div id="setLatestBedPick"></div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="row">
        <div>
          <label>Breakfast duration (minutes)</label>
          <input id="breakfastDur" type="number" min="10" max="90" value="${s.breakfastDurationMin}">
        </div>
        <div>
          <label>Lunch duration (minutes)</label>
          <input id="lunchDur" type="number" min="10" max="90" value="${s.lunchDurationMin}">
        </div>
      </div>

      <div class="row">
        <div>
          <label>Dinner duration (minutes)</label>
          <input id="dinnerDur" type="number" min="10" max="120" value="${s.dinnerDurationMin}">
        </div>
        <div>
          <label>Snack + milk duration (minutes)</label>
          <input id="snackDur" type="number" min="5" max="60" value="${s.snackMilkDurationMin}">
        </div>
      </div>

      <div class="divider"></div>

      <div class="row">
        <div>
          <label>Nap routine duration (minutes)</label>
          <input id="napRoutineDur" type="number" min="5" max="45" value="${s.napRoutineDurationMin}">
        </div>
        <div>
          <label>Bedtime routine duration (minutes)</label>
          <input id="bedRoutineDur" type="number" min="10" max="60" value="${s.bedtimeRoutineDurationMin}">
        </div>
      </div>

      <div class="row">
        <div>
          <label>Nap 1 forecast duration (minutes)</label>
          <input id="nap1F" type="number" min="40" max="120" value="${s.nap1ForecastMin}">
        </div>
        <div>
          <label>Nap 2 forecast duration (minutes)</label>
          <input id="nap2F" type="number" min="40" max="120" value="${s.nap2ForecastMin}">
        </div>
      </div>

      <div class="divider"></div>

      <div class="row">
        <div>
          <label>Wake window midpoint WW1 (minutes)</label>
          <input id="ww1" type="number" min="150" max="240" value="${s.ww1MidMin}">
          <div class="hint">Range is 3–3.5 hours; midpoint default is 195 minutes.</div>
        </div>
        <div>
          <label>Wake window midpoint WW2 (minutes)</label>
          <input id="ww2" type="number" min="180" max="270" value="${s.ww2MidMin}">
          <div class="hint">Range is 3.5–4 hours; midpoint default is 225 minutes.</div>
        </div>
      </div>

      <div class="row">
        <div>
          <label>Wake window midpoint WW3 (minutes)</label>
          <input id="ww3" type="number" min="210" max="270" value="${s.ww3MidMin}">
          <div class="hint">Range is 4–4.25 hours; midpoint default is 247 minutes.</div>
        </div>
        <div>
          <label>Morning mini-items</label>
          <div class="row">
            <input id="cuddle" type="number" min="5" max="45" value="${s.cuddleMin}" title="Family cuddle minutes">
            <input id="dress" type="number" min="5" max="45" value="${s.getDressedMin}" title="Get dressed minutes">
            <input id="brush" type="number" min="2" max="15" value="${s.brushTeethMin}" title="Brush teeth minutes">
          </div>
          <div class="hint">Minutes: cuddle / get dressed / brush.</div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="row">
        <button class="primary" id="saveSettings">Save settings</button>
        <button class="ghost" id="resetSettings">Reset to defaults</button>
      </div>
    </div>
  `;
  root.appendChild(c1);

  $("#setWakePick", c1).innerHTML = timePickerHTML("setWake", s.defaultWakeTime);
  $("#setLatestBedPick", c1).innerHTML = timePickerHTML("setLatestBed", s.latestBedtimeHHMM);

  $("#saveSettings", c1).onclick = async () => {
    const newS = {
      ...deepCopy(s),
      defaultWakeTime: readTimePicker("setWake"),
      latestBedtimeHHMM: readTimePicker("setLatestBed"),
      breakfastDurationMin: num("#breakfastDur", c1, 35),
      lunchDurationMin: num("#lunchDur", c1, 35),
      dinnerDurationMin: num("#dinnerDur", c1, 40),
      snackMilkDurationMin: num("#snackDur", c1, 15),
      napRoutineDurationMin: num("#napRoutineDur", c1, 15),
      bedtimeRoutineDurationMin: num("#bedRoutineDur", c1, 25),
      nap1ForecastMin: num("#nap1F", c1, 75),
      nap2ForecastMin: num("#nap2F", c1, 75),
      ww1MidMin: num("#ww1", c1, 195),
      ww2MidMin: num("#ww2", c1, 225),
      ww3MidMin: num("#ww3", c1, 247),
      cuddleMin: num("#cuddle", c1, 15),
      getDressedMin: num("#dress", c1, 15),
      brushTeethMin: num("#brush", c1, 5),
    };
    await saveSettings(newS);
    render();
  };

  $("#resetSettings", c1).onclick = async () => {
    await saveSettings(deepCopy(DEFAULT_SETTINGS));
    render();
  };

  // Household status card
  const c2 = document.createElement("div");
  c2.className = "card";
  c2.innerHTML = `
    <div class="hd">
      <div>
        <h2>Household</h2>
        <p>All data is shared within the household via Supabase (with RLS).</p>
      </div>
    </div>
    <div class="bd">
      <div class="hint"><strong>Signed in as:</strong> ${escapeHtml(App.user?.email || "—")}</div>
      <div class="hint" style="margin-top:6px;"><strong>Household ID:</strong> ${escapeHtml(App.householdId || "Not linked")}</div>
      <div class="divider"></div>
      <div class="hint">If someone can sign in but sees “Not linked”, add them to <code>household_members</code> in Supabase.</div>
    </div>
  `;
  root.appendChild(c2);

  return root;
}

function num(sel, root, fallback){
  const v = Number($(sel, root).value);
  return Number.isFinite(v) ? v : fallback;
}

/* =========================
   Calendar export (Apps Script)
   ========================= */
async function exportDayToCalendar(isoDay, blocks){
  if (!CONFIG.appsScriptUrl || !CONFIG.appsScriptApiKey){
    toast("Calendar export not configured.");
    return;
  }
  try{
    const date = fromIsoDate(isoDay);
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    const toISO = (mins) => {
      const d = new Date(base.getTime() + mins * 60 * 1000);
      return d.toISOString();
    };

    const payload = {
      apiKey: CONFIG.appsScriptApiKey,
      day: isoDay,
      timezone: CONFIG.timezone,
      blocks: blocks
        .filter(b => b.kind !== "open")
        .map(b => ({
          title: b.title,
          start: toISO(minutesFromHHMM(b.startHHMM)),
          end: toISO(minutesFromHHMM(b.endHHMM)),
          description: metaLineText(b),
        })),
    };

    const res = await fetch(CONFIG.appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok){
      const txt = await res.text();
      console.warn(txt);
      toast("Export failed.");
      return;
    }
    toast("Exported.");
  } catch (e){
    console.error(e);
    toast("Export failed.");
  }
}

/* =========================
   Rendering shell
   ========================= */
function render(){
  const view = $("#view");
  view.innerHTML = "";

  if (!App.user){
    // Should be blocked by auth overlay, but keep safe.
    view.innerHTML = `<div class="card"><div class="hd"><div><h2>Sign in required</h2><p>Please sign in.</p></div></div></div>`;
    return;
  }

  if (!App.householdId){
    view.innerHTML = `
      <div class="card">
        <div class="hd"><div><h2>Account not linked to household</h2>
          <p>Ask the household admin to add your user to <code>household_members</code> in Supabase.</p></div></div>
        <div class="bd">
          <div class="hint"><strong>Your email:</strong> ${escapeHtml(App.user.email)}</div>
          <div class="hint" style="margin-top:6px;">After linking, reopen the app.</div>
        </div>
      </div>
    `;
    return;
  }

  if (App.activeTab === "today") view.appendChild(renderToday());
  if (App.activeTab === "evening") view.appendChild(renderEvening());
  if (App.activeTab === "tasks") view.appendChild(renderTasks());
  if (App.activeTab === "history") view.appendChild(renderHistory());
  if (App.activeTab === "settings") view.appendChild(renderSettings());
}

/* =========================
   Auth UI
   ========================= */
function showAuth(show){
  const auth = $("#auth");
  if (show) auth.classList.add("open");
  else auth.classList.remove("open");
}

function wireAuthUI(){
  $("#btnSignIn").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    const password = $("#authPass").value;
    $("#authMsg").textContent = "";
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) $("#authMsg").textContent = error.message;
  });

  $("#btnSignUp").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    const password = $("#authPass").value;
    $("#authMsg").textContent = "";
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) $("#authMsg").textContent = error.message;
    else $("#authMsg").textContent = "Account created. Now sign in.";
  });

  $("#btnSignOut").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
  });
}

/* =========================
   Modal wiring
   ========================= */
function wireModals(){
  $("#wizClose").addEventListener("click", closeWizard);
  $("#wizardModal").addEventListener("click", (e) => {
    if (e.target.id === "wizardModal") closeWizard();
  });
  $("#wizBack").addEventListener("click", () => {
    App.wizard.step = Math.max(0, App.wizard.step - 1);
    renderWizard();
  });
  $("#wizNext").addEventListener("click", () => {
    const max = wizardSteps().length - 1;
    if (App.wizard.step < max) App.wizard.step += 1;
    else closeWizard();
    renderWizard();
  });

  $("#qeClose").addEventListener("click", () => {
    closeQuickEdit();
    // restore default close handler in case history detail changed it
    $("#qeClose").onclick = null;
    $("#qeSave").style.display = "";
    $("#qeTitle").textContent = "Quick edit";
    $("#qeClose").textContent = "Close";
  });
  $("#quickEditModal").addEventListener("click", (e) => {
    if (e.target.id === "quickEditModal") closeQuickEdit();
  });
}

/* =========================
   Boot
   ========================= */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));
}
function escapeAttr(s){
  return escapeHtml(s).replace(/"/g, "&quot;");
}

async function refreshAll(){
  await loadHouseholdContext();
  if (!App.householdId){
    await loadPlans([App.todayIso, App.tomorrowIso]); // harmless; for local/draft use
    await loadLogs();
    renderTabs();
    render();
    return;
  }
  await Promise.all([
    loadSettings(),
    loadTasks(),
    loadPlans([App.todayIso, App.tomorrowIso]),
    loadLogs(),
  ]);
  setupRealtime();
  renderTabs();
  render();
}

async function boot(){
  try{
    initSupabase();
  } catch (e){
    console.error(e);
    setSubhead("Config needed");
    $("#view").innerHTML = `<div class="card"><div class="hd"><div><h2>Config needed</h2><p>Please set CONFIG.supabaseUrl and CONFIG.supabaseKey in app.js.</p></div></div></div>`;
    return;
  }

  wireAuthUI();
  wireModals();
  renderTabs();

  // Auth state changes
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    App.user = session?.user || null;

    if (!App.user){
      App.householdId = null;
      clearRealtime();
      showAuth(true);
      $("#pillUser").textContent = "Signed out";
      setSubhead("Sign in");
      $("#view").innerHTML = "";
      return;
    }

    $("#pillUser").textContent = App.user.email || "Signed in";
    showAuth(false);
    await refreshAll();
  });

  // Initial
  const { data: { session } } = await supabaseClient.auth.getSession();
  App.user = session?.user || null;
  $("#pillUser").textContent = App.user?.email || "Signed out";
  showAuth(!App.user);
  await refreshAll();
}

// Start
boot();
