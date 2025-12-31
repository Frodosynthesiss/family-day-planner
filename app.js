/* Family Day Planner (Shared password gate + Supabase)
   - No individual sign-ins
   - Shared data in Supabase under space_id = 'default'
   - Today schedule reflows when wake/nap times change (Start/Stop nap timers)
*/

(() => {
  "use strict";

  // ---- Config ----
  const SUPABASE_URL = "https://cpillnpeulshswjkdmjs.supabase.co";
  const SUPABASE_KEY = "sb_publishable_tztmWNW8Ol5OlrJSbR0Hgw_rBDK6LDr";
  const SPACE_ID = "default";

  // Shared password gate (client-side)
  const APP_PASSWORD = "JuneR0cks!";
  const LS_UNLOCK_KEY = "fdp_unlocked_v1";

  const DEFAULT_SETTINGS = {
    defaultWake: "07:00",
    breakfastMin: 30,
    lunchMin: 30,
    dinnerMin: 35,
    napRoutineMin: 15,
    bedRoutineMin: 25,
    nap1ForecastMin: 90,
    nap2ForecastMin: 75,
    ww1Min: 150, ww1Max: 210,
    ww2Min: 165, ww2Max: 240,
    ww3Min: 165, ww3Max: 240,
    gcal: { scriptUrl: "", calendarId: "", apiKey: "" }
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, "0");

  function toast(msg, ms=2600) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), ms);
  }

  function isUnlocked() {
    try { return localStorage.getItem(LS_UNLOCK_KEY) === "1"; }
    catch { return false; }
  }
  function setUnlocked(v) {
    try { localStorage.setItem(LS_UNLOCK_KEY, v ? "1" : "0"); }
    catch { /* ignore */ }
  }

  function showModal(id, show) {
    const m = $(id);
    if (!m) return;
    m.classList.toggle("hidden", !show);
    m.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function dateToISO(d) {
    const x = new Date(d); x.setHours(0,0,0,0);
    return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
  }
  function addDays(d, days) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }
  function isoToShort(iso) {
    // YYYY-MM-DD -> M/D
    const [y,m,d] = String(iso).split("-").map(Number);
    return `${m}/${d}`;
  }

  function timeToMin(hhmm) {
    if (!hhmm) return null;
    const [h,m] = String(hhmm).split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h*60 + m;
  }
  function minToTime(min) {
    if (min == null) return "";
    min = Math.max(0, Math.min(24*60, Math.round(min)));
    const h = Math.floor(min/60);
    const m = min % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }
  function minToLabel(min) {
    if (min == null) return "";
    min = Math.max(0, Math.min(24*60, Math.round(min)));
    let h = Math.floor(min/60), m=min%60;
    const ampm = h>=12 ? "PM" : "AM";
    h = h%12; if (h===0) h=12;
    return `${h}:${pad2(m)} ${ampm}`;
  }

  function nowTimeHHMM() {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // ---- Supabase ----
  const App = {
    supa: null,
    settings: {...DEFAULT_SETTINGS},
    tasks: [],
    plans: new Map(), // dateISO -> plan.data
    logs: new Map()   // dateISO -> log.data
  };

  function initSupabase() {
    if (!window.supabase) throw new Error("Supabase JS not loaded");
    App.supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async function sbTry(fn, msg) {
    try {
      const res = await fn();
      if (res?.error) {
        console.error(res.error);
        toast(msg || res.error.message || "Supabase error");
      }
      return res;
    } catch (e) {
      console.error(e);
      toast(msg || e?.message || "Supabase error");
      return { error: e };
    }
  }

  // ---- Data model helpers ----
  function normSettings(s) {
    const data = s || {};
    const merged = {
      ...DEFAULT_SETTINGS,
      ...data,
      gcal: { ...DEFAULT_SETTINGS.gcal, ...(data.gcal||{}) }
    };
    return merged;
  }

  function blankPlan(dateISO) {
    return {
      date: dateISO,
      brainDump: "",
      constraints: {
        appointments: [] // {title,start,end}
      }
    };
  }

  function normPlan(plan, dateISO) {
    const p = plan || blankPlan(dateISO);
    if (!p.date) p.date = dateISO;
    if (!p.constraints) p.constraints = { appointments: [] };
    if (!Array.isArray(p.constraints.appointments)) p.constraints.appointments = [];
    if (typeof p.brainDump !== "string") p.brainDump = "";
    return p;
  }

  function blankLog(dateISO) {
    return {
      date: dateISO,
      wakeTime: "",
      bedtime: "",
      nap1: { enabled: true, start: "", end: "", running: false },
      nap2: { enabled: true, start: "", end: "", running: false }
    };
  }

  function normLog(log, dateISO) {
    const l = log || blankLog(dateISO);
    if (!l.date) l.date = dateISO;
    if (!l.nap1) l.nap1 = { enabled:true, start:"", end:"", running:false };
    if (!l.nap2) l.nap2 = { enabled:true, start:"", end:"", running:false };
    l.nap1.enabled = !!l.nap1.enabled;
    l.nap2.enabled = !!l.nap2.enabled;
    l.nap1.start = l.nap1.start || "";
    l.nap1.end = l.nap1.end || "";
    l.nap2.start = l.nap2.start || "";
    l.nap2.end = l.nap2.end || "";
    l.nap1.running = !!l.nap1.running;
    l.nap2.running = !!l.nap2.running;
    l.wakeTime = l.wakeTime || "";
    l.bedtime = l.bedtime || "";
    return l;
  }

  // ---- Supabase CRUD (shared space_id) ----
  async function loadSettings() {
    const res = await sbTry(() =>
      App.supa.from("settings")
        .select("data")
        .eq("space_id", SPACE_ID)
        .maybeSingle(),
      "Could not load settings"
    );
    const data = res?.data?.data || {};
    App.settings = normSettings(data);
    return App.settings;
  }

  async function saveSettings(s) {
    const payload = { space_id: SPACE_ID, data: s, updated_at: new Date().toISOString() };
    const res = await sbTry(() =>
      App.supa.from("settings").upsert(payload, { onConflict: "space_id" }),
      "Settings save failed"
    );
    if (!res?.error) App.settings = normSettings(s);
    return !res?.error;
  }

  async function loadTasks() {
    const res = await sbTry(() =>
      App.supa.from("tasks")
        .select("id,title,status,assigned_date,created_at,completed_at")
        .eq("space_id", SPACE_ID)
        .order("created_at", { ascending: false }),
      "Could not load tasks"
    );
    App.tasks = Array.isArray(res?.data) ? res.data : [];
    return App.tasks;
  }

  async function addTask(title, assignedDate=null) {
    const t = String(title||"").trim();
    if (!t) return false;
    const payload = {
      space_id: SPACE_ID,
      title: t,
      status: "open",
      assigned_date: assignedDate
    };
    const res = await sbTry(() => App.supa.from("tasks").insert(payload), "Task add failed");
    if (!res?.error) {
      await loadTasks();
      renderTasks();
    }
    return !res?.error;
  }

  async function updateTask(id, patch) {
    const res = await sbTry(() =>
      App.supa.from("tasks")
        .update(patch)
        .eq("space_id", SPACE_ID)
        .eq("id", id),
      "Task update failed"
    );
    if (!res?.error) {
      await loadTasks();
      renderTasks();
    }
    return !res?.error;
  }

  async function loadPlan(dateISO) {
    const res = await sbTry(() =>
      App.supa.from("day_plans")
        .select("data")
        .eq("space_id", SPACE_ID)
        .eq("date", dateISO)
        .maybeSingle(),
      "Could not load tomorrow plan"
    );
    const plan = res?.data?.data || null;
    App.plans.set(dateISO, plan);
    return plan;
  }

  async function savePlan(dateISO, planData) {
    const payload = {
      space_id: SPACE_ID,
      date: dateISO,
      data: planData,
      updated_at: new Date().toISOString()
    };
    const res = await sbTry(() =>
      App.supa.from("day_plans").upsert(payload, { onConflict: "space_id,date" }),
      "Plan save failed"
    );
    if (!res?.error) App.plans.set(dateISO, planData);
    return !res?.error;
  }

  async function loadLog(dateISO) {
    const res = await sbTry(() =>
      App.supa.from("day_logs")
        .select("data")
        .eq("space_id", SPACE_ID)
        .eq("date", dateISO)
        .maybeSingle(),
      "Could not load day log"
    );
    const log = res?.data?.data || null;
    App.logs.set(dateISO, log);
    return log;
  }

  async function saveLog(dateISO, logData) {
    const payload = {
      space_id: SPACE_ID,
      date: dateISO,
      data: logData,
      updated_at: new Date().toISOString()
    };
    const res = await sbTry(() =>
      App.supa.from("day_logs").upsert(payload, { onConflict: "space_id,date" }),
      "Log save failed"
    );
    if (!res?.error) App.logs.set(dateISO, logData);
    return !res?.error;
  }

  async function loadHistory(limit=45) {
    const res = await sbTry(() =>
      App.supa.from("day_logs")
        .select("date, data, updated_at")
        .eq("space_id", SPACE_ID)
        .order("date", { ascending: false })
        .limit(limit),
      "Could not load history"
    );
    return Array.isArray(res?.data) ? res.data : [];
  }

  // ---- Schedule generation ----
  function computeTodayBlocks(settings, log) {
    const s = settings;
    const l = log;

    const wake = timeToMin(l.wakeTime || s.defaultWake) ?? timeToMin(s.defaultWake) ?? (7*60);
    const bedtime = timeToMin(l.bedtime) ?? null;

    const blocks = [];
    const push = (start, end, title, meta="") => {
      if (start==null || end==null || end<=start) return;
      blocks.push({ start, end, title, meta });
    };

    let t = wake;
    push(t, t + s.breakfastMin, "Breakfast");
    t += s.breakfastMin;

    // Nap 1
    let nap1Start = l.nap1.enabled ? timeToMin(l.nap1.start) : null;
    let nap1End   = l.nap1.enabled ? timeToMin(l.nap1.end) : null;

    if (l.nap1.enabled) {
      if (nap1Start == null) nap1Start = wake + s.ww1Min;
      if (nap1End == null && nap1Start != null) nap1End = nap1Start + s.nap1ForecastMin;
      // routine
      push(Math.max(t, nap1Start - s.napRoutineMin), Math.max(t, nap1Start), "Nap 1 routine");
      push(Math.max(t, nap1Start), nap1End, "Nap 1", l.nap1.running ? "running…" : (l.nap1.end ? "actual" : "forecast"));
      t = Math.max(t, nap1End);
    }

    // Lunch
    push(t, t + s.lunchMin, "Lunch");
    t += s.lunchMin;

    // Nap 2
    let nap2Start = l.nap2.enabled ? timeToMin(l.nap2.start) : null;
    let nap2End   = l.nap2.enabled ? timeToMin(l.nap2.end) : null;

    if (l.nap2.enabled) {
      const base = t;
      if (nap2Start == null) {
        const anchor = (l.nap1.enabled && nap1End!=null) ? nap1End : base;
        nap2Start = anchor + s.ww2Min;
      }
      if (nap2End == null && nap2Start!=null) nap2End = nap2Start + s.nap2ForecastMin;
      push(Math.max(t, nap2Start - s.napRoutineMin), Math.max(t, nap2Start), "Nap 2 routine");
      push(Math.max(t, nap2Start), nap2End, "Nap 2", l.nap2.running ? "running…" : (l.nap2.end ? "actual" : "forecast"));
      t = Math.max(t, nap2End);
    }

    // Dinner
    push(t, t + s.dinnerMin, "Dinner");
    t += s.dinnerMin;

    // Bed routine + bedtime
    if (bedtime != null) {
      push(Math.max(t, bedtime - s.bedRoutineMin), bedtime, "Bed routine");
      push(bedtime, bedtime + 10, "Bedtime", "target");
    } else {
      // fallback: bed routine 3 hours after last block
      push(t + 120, t + 120 + s.bedRoutineMin, "Bed routine");
    }

    // Sort & merge
    blocks.sort((a,b) => a.start - b.start);
    return blocks;
  }

  function renderTimeline(blocks) {
    const el = $("#todayTimeline");
    if (!el) return;
    if (!blocks.length) {
      el.innerHTML = `<div class="block"><div class="time">—</div><div><div class="title">No blocks yet</div><div class="meta">Set wake time or start a nap timer.</div></div></div>`;
      return;
    }
    el.innerHTML = blocks.map(b => `
      <div class="block">
        <div class="time">${minToLabel(b.start)}<br/><span class="small muted">→ ${minToLabel(b.end)}</span></div>
        <div>
          <div class="title">${escapeHtml(b.title)}</div>
          <div class="meta">${escapeHtml(b.meta||"")}</div>
        </div>
      </div>
    `).join("");
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s]));
  }

  // ---- UI render ----
  function setHeader() {
    const iso = dateToISO(new Date());
    $("#headerSub").textContent = `Today: ${isoToShort(iso)}`;
  }

  function showTab(tab) {
    const map = {
      Evening: "#viewEvening",
      Today: "#viewToday",
      Tasks: "#viewTasks",
      History: "#viewHistory",
      Settings: "#viewSettings"
    };
    Object.values(map).forEach(sel => $(sel)?.classList.add("hidden"));
    $(map[tab])?.classList.remove("hidden");
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  }

  function renderTasks() {
    const el = $("#tasksList");
    if (!el) return;
    if (!App.tasks.length) {
      el.innerHTML = `<div class="muted small" style="margin-top:10px;">No tasks yet.</div>`;
      return;
    }
    el.innerHTML = App.tasks.map(t => {
      const done = t.status === "done";
      const sub = [
        t.assigned_date ? `Assigned: ${t.assigned_date}` : null,
        t.completed_at ? `Done: ${new Date(t.completed_at).toLocaleString()}` : null
      ].filter(Boolean).join(" • ");
      return `
        <div class="task">
          <div class="left">
            <input type="checkbox" ${done?"checked":""} data-task-done="${t.id}" />
            <div>
              <div class="t" style="${done?"text-decoration:line-through;opacity:.75;":""}">${escapeHtml(t.title)}</div>
              <div class="s">${escapeHtml(sub)}</div>
            </div>
          </div>
          <div class="actions">
            <button class="btn ghost" data-task-today="${t.id}">Today</button>
            <button class="btn ghost" data-task-del="${t.id}">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    // wire task actions
    $$("[data-task-done]").forEach(cb => {
      cb.onchange = async () => {
        const id = cb.dataset.taskDone;
        const done = cb.checked;
        await updateTask(id, {
          status: done ? "done" : "open",
          completed_at: done ? new Date().toISOString() : null
        });
      };
    });
    $$("[data-task-today]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.taskToday;
        await updateTask(id, { assigned_date: dateToISO(new Date()) });
      };
    });
    $$("[data-task-del]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.taskDel;
        // soft delete: mark done + clear title if you prefer; but we'll hard delete
        const res = await sbTry(() => App.supa.from("tasks").delete().eq("space_id", SPACE_ID).eq("id", id), "Delete failed");
        if (!res?.error) {
          await loadTasks();
          renderTasks();
        }
      };
    });
  }

  function renderEvening(tomorrowISO) {
    $("#tomorrowLabel").textContent = `Tomorrow: ${isoToShort(tomorrowISO)}`;
    const plan = normPlan(App.plans.get(tomorrowISO), tomorrowISO);
    $("#tomorrowBrainDump").value = plan.brainDump || "";
    renderApptList("#tomorrowConstraints", plan.constraints.appointments);
  }

  function renderApptList(containerSel, appts) {
    const el = $(containerSel);
    if (!el) return;
    if (!appts?.length) {
      el.innerHTML = `<div class="muted small" style="margin-top:8px;">No appointments added.</div>`;
      return;
    }
    el.innerHTML = appts.map((a, idx) => `
      <div class="task" style="margin-top:8px;">
        <div class="left">
          <div>
            <div class="t">${escapeHtml(a.title||"Appointment")}</div>
            <div class="s">${escapeHtml((a.start||"") + "–" + (a.end||""))}</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost" data-appt-del="${idx}">Remove</button>
        </div>
      </div>
    `).join("");
  }

  async function loadAndRenderToday() {
    const iso = dateToISO(new Date());
    let log = await loadLog(iso);
    log = normLog(log, iso);
    App.logs.set(iso, log);

    // fill inputs
    $("#wakeTime").value = log.wakeTime || "";
    $("#bedtime").value = log.bedtime || "";
    $("#nap1Enabled").checked = !!log.nap1.enabled;
    $("#nap2Enabled").checked = !!log.nap2.enabled;
    $("#nap1Start").value = log.nap1.start || "";
    $("#nap1End").value = log.nap1.end || "";
    $("#nap2Start").value = log.nap2.start || "";
    $("#nap2End").value = log.nap2.end || "";

    updateNapPills(log);

    const blocks = computeTodayBlocks(App.settings, log);
    renderTimeline(blocks);
  }

  function updateNapPills(log) {
    const p1 = $("#nap1State");
    const p2 = $("#nap2State");
    if (p1) {
      let s="Off";
      if (log.nap1.enabled) {
        if (log.nap1.running) s="Running";
        else if (log.nap1.start && !log.nap1.end) s="Started";
        else if (log.nap1.start && log.nap1.end) s="Done";
        else s="On";
      }
      p1.textContent = s;
    }
    if (p2) {
      let s="Off";
      if (log.nap2.enabled) {
        if (log.nap2.running) s="Running";
        else if (log.nap2.start && !log.nap2.end) s="Started";
        else if (log.nap2.start && log.nap2.end) s="Done";
        else s="On";
      }
      p2.textContent = s;
    }
  }

  async function loadAndRenderTomorrow() {
    const iso = dateToISO(addDays(new Date(), 1));
    let plan = await loadPlan(iso);
    plan = normPlan(plan, iso);
    App.plans.set(iso, plan);
    renderEvening(iso);
  }

  async function renderHistory() {
    const rows = await loadHistory(45);
    const el = $("#historyList");
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="muted small">No history yet.</div>`;
      return;
    }
    el.innerHTML = rows.map(r => {
      const d = r.date;
      const data = normLog(r.data, d);
      const summary = [
        data.wakeTime ? `Wake ${data.wakeTime}` : null,
        data.nap1?.enabled ? `Nap1 ${data.nap1.start||"—"}-${data.nap1.end||"—"}` : "Nap1 off",
        data.nap2?.enabled ? `Nap2 ${data.nap2.start||"—"}-${data.nap2.end||"—"}` : "Nap2 off"
      ].filter(Boolean).join(" • ");
      return `<div class="history-item" data-hist="${d}">
        <div class="t" style="font-weight:900;">${escapeHtml(d)} <span class="muted small">(${isoToShort(d)})</span></div>
        <div class="muted small">${escapeHtml(summary)}</div>
      </div>`;
    }).join("");

    $$("[data-hist]").forEach(item => {
      item.onclick = async () => {
        const d = item.dataset.hist;
        const log = normLog(await loadLog(d), d);
        openQuick(d, log, `Log: ${d}`);
      };
    });
  }

  function openQuick(dateISO, obj, title) {
    $("#quickTitle").textContent = title || "Quick edit";
    $("#quickJson").value = JSON.stringify(obj, null, 2);
    $("#quickJson").dataset.date = dateISO;
    $("#quickJson").dataset.kind = (title||"").toLowerCase().includes("plan") ? "plan" : "log";
    showModal("#quickModal", true);
  }

  async function saveQuick() {
    const dateISO = $("#quickJson").dataset.date;
    const kind = $("#quickJson").dataset.kind;
    let parsed = null;
    try {
      parsed = JSON.parse($("#quickJson").value);
    } catch (e) {
      toast("Invalid JSON");
      return;
    }
    if (kind === "plan") {
      const plan = normPlan(parsed, dateISO);
      await savePlan(dateISO, plan);
      await loadAndRenderTomorrow();
      toast("Saved plan");
    } else {
      const log = normLog(parsed, dateISO);
      await saveLog(dateISO, log);
      if (dateISO === dateToISO(new Date())) {
        await loadAndRenderToday();
      }
      toast("Saved log");
    }
    showModal("#quickModal", false);
  }

  // ---- Wizard (tomorrow planning) ----
  function renderWizard(plan) {
    $("#wizBrainDump").value = plan.brainDump || "";
    renderWizardAppts(plan.constraints.appointments);
  }

  function renderWizardAppts(appts) {
    const el = $("#apptList");
    if (!el) return;
    if (!appts?.length) {
      el.innerHTML = `<div class="muted small" style="margin-top:8px;">No appointments yet.</div>`;
      return;
    }
    el.innerHTML = appts.map((a, idx) => `
      <div class="task" style="margin-top:8px;">
        <div class="left">
          <div>
            <div class="t">${escapeHtml(a.title||"Appointment")}</div>
            <div class="s">${escapeHtml((a.start||"") + "–" + (a.end||""))}</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost" data-wiz-del="${idx}">Remove</button>
        </div>
      </div>
    `).join("");

    $$("[data-wiz-del]").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.wizDel);
        const iso = dateToISO(addDays(new Date(), 1));
        const plan = normPlan(App.plans.get(iso), iso);
        plan.constraints.appointments.splice(idx,1);
        App.plans.set(iso, plan);
        renderWizard(plan);
      };
    });
  }

  // ---- Export placeholder ----
  function exportToday() {
    const s = App.settings;
    if (!s.gcal?.scriptUrl) {
      toast("Add a Google Apps Script URL in settings to export.");
      return;
    }
    toast("Export is configured via Apps Script in Settings (not wired in this build).");
  }

  // ---- Wiring ----
  function wire() {
    // Tabs
    $$(".tab").forEach(btn => {
      btn.onclick = async () => {
        const tab = btn.dataset.tab;
        showTab(tab);
        if (tab === "Today") await loadAndRenderToday();
        if (tab === "Evening") await loadAndRenderTomorrow();
        if (tab === "Tasks") { await loadTasks(); renderTasks(); }
        if (tab === "History") await renderHistory();
        if (tab === "Settings") renderSettings();
      };
    });

    // Unlock modal
    $("#btnUnlock").onclick = async () => {
      const v = ($("#unlockPass").value || "").trim();
      if (v !== APP_PASSWORD) {
        toast("Wrong password");
        return;
      }
      setUnlocked(true);
      showModal("#unlockModal", false);
      await postUnlockBoot();
    };

    // Close modals
    $("#wizardScrim").onclick = () => showModal("#wizardModal", false);
    $("#btnCloseWizard").onclick = () => showModal("#wizardModal", false);
    $("#quickScrim").onclick = () => showModal("#quickModal", false);
    $("#btnCloseQuick").onclick = () => showModal("#quickModal", false);
    $("#btnSaveQuick").onclick = saveQuick;

    // Tomorrow area
    $("#btnOpenWizard").onclick = async () => {
      const iso = dateToISO(addDays(new Date(), 1));
      let plan = await loadPlan(iso);
      plan = normPlan(plan, iso);
      App.plans.set(iso, plan);
      renderWizard(plan);
      showModal("#wizardModal", true);
    };

    $("#btnAddAppt").onclick = () => {
      const iso = dateToISO(addDays(new Date(), 1));
      const plan = normPlan(App.plans.get(iso), iso);
      const title = ($("#apptTitle").value||"").trim() || "Appointment";
      const start = ($("#apptStart").value||"").trim();
      const end = ($("#apptEnd").value||"").trim();
      if (!start || !end) { toast("Set start and end"); return; }
      plan.constraints.appointments.push({ title, start, end });
      App.plans.set(iso, plan);
      $("#apptTitle").value = "";
      $("#apptStart").value = "";
      $("#apptEnd").value = "";
      renderWizard(plan);
    };

    $("#btnSaveWizard").onclick = async () => {
      const iso = dateToISO(addDays(new Date(), 1));
      const plan = normPlan(App.plans.get(iso), iso);
      plan.brainDump = $("#wizBrainDump").value || "";
      await savePlan(iso, plan);
      await loadAndRenderTomorrow();
      toast("Saved tomorrow");
      showModal("#wizardModal", false);
    };

    $("#btnSaveTomorrow").onclick = async () => {
      const iso = dateToISO(addDays(new Date(), 1));
      const plan = normPlan(App.plans.get(iso), iso);
      plan.brainDump = $("#tomorrowBrainDump").value || "";
      await savePlan(iso, plan);
      toast("Saved tomorrow");
    };

    $("#btnQuickEditTomorrow").onclick = async () => {
      const iso = dateToISO(addDays(new Date(), 1));
      const plan = normPlan(await loadPlan(iso), iso);
      openQuick(iso, plan, `Plan: ${iso}`);
    };

    $("#btnEditToday").onclick = async () => {
      const iso = dateToISO(new Date());
      const log = normLog(await loadLog(iso), iso);
      openQuick(iso, log, `Log: ${iso}`);
    };

    // Tasks
    $("#btnAddTask").onclick = async () => {
      const v = $("#taskInput").value;
      $("#taskInput").value = "";
      await addTask(v, null);
    };
    $("#taskInput").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("#btnAddTask").click();
      }
    };

    // Today inputs -> save + reflow
    const reflow = async () => {
      const iso = dateToISO(new Date());
      const cur = normLog(App.logs.get(iso), iso);
      const blocks = computeTodayBlocks(App.settings, cur);
      renderTimeline(blocks);
      updateNapPills(cur);
    };

    const persistAndReflow = async (mutateFn) => {
      const iso = dateToISO(new Date());
      const cur = normLog(App.logs.get(iso), iso);
      mutateFn(cur);
      App.logs.set(iso, cur);
      await saveLog(iso, cur);
      await reflow();
    };

    $("#wakeTime").onchange = () => persistAndReflow(l => l.wakeTime = $("#wakeTime").value || "");
    $("#bedtime").onchange = () => persistAndReflow(l => l.bedtime = $("#bedtime").value || "");

    $("#nap1Enabled").onchange = () => persistAndReflow(l => {
      l.nap1.enabled = $("#nap1Enabled").checked;
      if (!l.nap1.enabled) { l.nap1.start=""; l.nap1.end=""; l.nap1.running=false; }
    });
    $("#nap2Enabled").onchange = () => persistAndReflow(l => {
      l.nap2.enabled = $("#nap2Enabled").checked;
      if (!l.nap2.enabled) { l.nap2.start=""; l.nap2.end=""; l.nap2.running=false; }
    });

    $("#nap1Start").onchange = () => persistAndReflow(l => l.nap1.start = $("#nap1Start").value || "");
    $("#nap1End").onchange = () => persistAndReflow(l => l.nap1.end = $("#nap1End").value || "");
    $("#nap2Start").onchange = () => persistAndReflow(l => l.nap2.start = $("#nap2Start").value || "");
    $("#nap2End").onchange = () => persistAndReflow(l => l.nap2.end = $("#nap2End").value || "");

    // Nap timers (Start/Stop)
    $("#nap1StartBtn").onclick = () => persistAndReflow(l => {
      if (!l.nap1.enabled) l.nap1.enabled = true;
      l.nap1.start = nowTimeHHMM();
      l.nap1.end = "";
      l.nap1.running = true;
      $("#nap1Enabled").checked = true;
      $("#nap1Start").value = l.nap1.start;
      $("#nap1End").value = "";
    });
    $("#nap1StopBtn").onclick = () => persistAndReflow(l => {
      if (!l.nap1.enabled) return;
      if (!l.nap1.start) l.nap1.start = nowTimeHHMM();
      l.nap1.end = nowTimeHHMM();
      l.nap1.running = false;
      $("#nap1Start").value = l.nap1.start;
      $("#nap1End").value = l.nap1.end;
    });

    $("#nap2StartBtn").onclick = () => persistAndReflow(l => {
      if (!l.nap2.enabled) l.nap2.enabled = true;
      l.nap2.start = nowTimeHHMM();
      l.nap2.end = "";
      l.nap2.running = true;
      $("#nap2Enabled").checked = true;
      $("#nap2Start").value = l.nap2.start;
      $("#nap2End").value = "";
    });
    $("#nap2StopBtn").onclick = () => persistAndReflow(l => {
      if (!l.nap2.enabled) return;
      if (!l.nap2.start) l.nap2.start = nowTimeHHMM();
      l.nap2.end = nowTimeHHMM();
      l.nap2.running = false;
      $("#nap2Start").value = l.nap2.start;
      $("#nap2End").value = l.nap2.end;
    });

    // Settings save
    $("#btnSaveSettings").onclick = async () => {
      const s = {
        ...DEFAULT_SETTINGS,
        ...App.settings,
        defaultWake: $("#setWake").value || DEFAULT_SETTINGS.defaultWake,
        breakfastMin: Number($("#setBreakfast").value) || DEFAULT_SETTINGS.breakfastMin,
        lunchMin: Number($("#setLunch").value) || DEFAULT_SETTINGS.lunchMin,
        dinnerMin: Number($("#setDinner").value) || DEFAULT_SETTINGS.dinnerMin,
        napRoutineMin: Number($("#setNapRoutine").value) || DEFAULT_SETTINGS.napRoutineMin,
        bedRoutineMin: Number($("#setBedRoutine").value) || DEFAULT_SETTINGS.bedRoutineMin,
        nap1ForecastMin: Number($("#setNap1").value) || DEFAULT_SETTINGS.nap1ForecastMin,
        nap2ForecastMin: Number($("#setNap2").value) || DEFAULT_SETTINGS.nap2ForecastMin,
        ww1Min: Number($("#ww1Min").value) || DEFAULT_SETTINGS.ww1Min,
        ww1Max: Number($("#ww1Max").value) || DEFAULT_SETTINGS.ww1Max,
        ww2Min: Number($("#ww2Min").value) || DEFAULT_SETTINGS.ww2Min,
        ww2Max: Number($("#ww2Max").value) || DEFAULT_SETTINGS.ww2Max,
        ww3Min: Number($("#ww3Min").value) || DEFAULT_SETTINGS.ww3Min,
        ww3Max: Number($("#ww3Max").value) || DEFAULT_SETTINGS.ww3Max,
      };
      const ok = await saveSettings(s);
      if (ok) {
        toast("Saved settings");
        await loadAndRenderToday();
      }
    };

    // Export button
    $("#btnExport").onclick = exportToday;
  }

  function renderSettings() {
    const s = App.settings;
    $("#setWake").value = s.defaultWake || DEFAULT_SETTINGS.defaultWake;
    $("#setBreakfast").value = String(s.breakfastMin ?? DEFAULT_SETTINGS.breakfastMin);
    $("#setLunch").value = String(s.lunchMin ?? DEFAULT_SETTINGS.lunchMin);
    $("#setDinner").value = String(s.dinnerMin ?? DEFAULT_SETTINGS.dinnerMin);
    $("#setNapRoutine").value = String(s.napRoutineMin ?? DEFAULT_SETTINGS.napRoutineMin);
    $("#setBedRoutine").value = String(s.bedRoutineMin ?? DEFAULT_SETTINGS.bedRoutineMin);
    $("#setNap1").value = String(s.nap1ForecastMin ?? DEFAULT_SETTINGS.nap1ForecastMin);
    $("#setNap2").value = String(s.nap2ForecastMin ?? DEFAULT_SETTINGS.nap2ForecastMin);

    $("#ww1Min").value = String(s.ww1Min ?? DEFAULT_SETTINGS.ww1Min);
    $("#ww1Max").value = String(s.ww1Max ?? DEFAULT_SETTINGS.ww1Max);
    $("#ww2Min").value = String(s.ww2Min ?? DEFAULT_SETTINGS.ww2Min);
    $("#ww2Max").value = String(s.ww2Max ?? DEFAULT_SETTINGS.ww2Max);
    $("#ww3Min").value = String(s.ww3Min ?? DEFAULT_SETTINGS.ww3Min);
    $("#ww3Max").value = String(s.ww3Max ?? DEFAULT_SETTINGS.ww3Max);
  }

  async function postUnlockBoot() {
    await loadSettings();
    renderSettings();
    await loadTasks();
    renderTasks();
    await loadAndRenderTomorrow();
    await loadAndRenderToday();
    await renderHistory();
    showTab("Evening");
  }

  async function boot() {
    try {
      initSupabase();
      wire();
      setHeader();

      if (!isUnlocked()) {
        showModal("#unlockModal", true);
        $("#unlockPass")?.focus();
        return;
      }

      showModal("#unlockModal", false);
      await postUnlockBoot();
    } catch (e) {
      console.error(e);
      toast("App failed to start. Check console.");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
