/* Family Day Planner (vanilla JS + Supabase)
   - Stable init order (no use-before-init)
   - Defensive Supabase calls + toasts
   - Deterministic schedule generation
   - Kayden NEVER assigned naps (hard rule)
*/
(() => {
  "use strict";

const SUPABASE_URL = "https://onphitewfrmawyixzufc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YjTPPg2V2O6W7MV7rPSK5w_TBJPohp7";

  // Shared access gate (no individual sign-ins)
  const ACCESS_PASSWORD = "JuneR0cks!";
  // All shared data in Supabase is namespaced under this space id.
  const SPACE_ID = "family_shared_v1";

  const PARENTS = ["Kristyn","Julio"];

  const DEFAULT_SETTINGS = {
    defaultWake: "07:00",
    breakfastMin: 35,
    lunchMin: 35,
    dinnerMin: 40,
    napRoutineMin: 15,
    bedRoutineMin: 25,
    nap1ForecastMin: 70,
    nap2ForecastMin: 60,
    ww1Min: 3.0, ww1Max: 3.5,
    ww2Min: 3.5, ww2Max: 4.0,
    ww3Min: 4.0, ww3Max: 4.25,
    gcal: { scriptUrl:"", calendarId:"", apiKey:"" }
  };

  const STEP1 = [
    { key:"bottles", text:"Bottles/pump parts ready", hint:"Wash, assemble, set out." },
    { key:"bags", text:"Bags packed", hint:"Diaper bag, work bag, snacks." },
    { key:"clothes", text:"Clothes set out", hint:"Baby + adult outfits." },
    { key:"kitchen", text:"Kitchen reset", hint:"Quick reset for calm morning." }
  ];

  // ---------- State ----------
  const App = {
    supa: null,
    state: {
      gate: { unlocked:false },
      settings: { ...DEFAULT_SETTINGS },
      tasks: [],
      plans: new Map(), // dateISO -> plan
      logs: new Map(),  // dateISO -> log
      wizard: { open:false, dateISO:null, step:1, maxStep:1, draft:null }
    }
  };

  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2,"0");
  const clamp = (n,lo,hi) => Math.max(lo, Math.min(hi,n));

  function toast(msg, ms=2600){
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), ms);
  }

  function debounce(fn, wait=300){
    let t=null;
    return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args), wait); };
  }

  function dateToISO(d){
    const x = new Date(d); x.setHours(0,0,0,0);
    return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
  }
  function addDays(isoOrDate, days){
    const d = (isoOrDate instanceof Date) ? new Date(isoOrDate) : new Date(isoOrDate+"T00:00:00");
    d.setDate(d.getDate()+days);
    return d;
  }
  function isoToShort(iso){
    const [y,m,d] = iso.split("-"); return `${m}/${d}/${String(y).slice(-2)}`;
  }
  function timeToMin(t){
    if (!t || !t.includes(":")) return null;
    const [hh,mm] = t.split(":").map(n=>parseInt(n,10));
    if (Number.isNaN(hh)||Number.isNaN(mm)) return null;
    return hh*60+mm;
  }
  function minToTime(min){
    min = clamp(Math.round(min), 0, 24*60-1);
    return `${pad2(Math.floor(min/60))}:${pad2(min%60)}`;
  }
  function minTo12h(min){
    min = clamp(Math.round(min), 0, 24*60);
    let h = Math.floor(min/60), m=min%60;
    const ampm = h>=12 ? "PM":"AM";
    h = h%12; if (h===0) h=12;
    return `${h}:${pad2(m)} ${ampm}`;
  }
  function overlaps(a1,a2,b1,b2){ return a1 < b2 && b1 < a2; }
  function withinAny(blocks, s, e){ return blocks.some(b => overlaps(s,e,b.start,b.end)); }
  function covers(blocks, s, e){ return blocks.some(b => b.start<=s && b.end>=e); }
  function uid(prefix="id"){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }

  // ---------- Supabase ----------
  function initSupabase(){
    if (!window.supabase) throw new Error("Supabase library not loaded.");
    App.supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
    });
  }

  async function sbTry(fn, failMsg){
    try {
      const res = await fn();
      if (res && typeof res === "object" && "error" in res && res.error){
        console.error(res.error);
        toast(failMsg || res.error.message || "Supabase error");
      }
      return res;
    } catch (e){
      console.error(e);
      toast(failMsg || (e && e.message) || "Supabase error");
      return { error: e };
    }
  }
  // ---------- Access Gate ----------
  function gateStorageKey(){ return `fdp_gate_${SPACE_ID}`; }

  function isGateUnlocked(){
    try{
      const raw = localStorage.getItem(gateStorageKey());
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.ok !== true) return false;
      // optional expiry (30 days)
      const ageMs = Date.now() - (Number(data.ts)||0);
      if (ageMs > 30*24*60*60*1000) return false;
      return true;
    }catch(_e){ return false; }
  }

  function setGateUnlocked(ok){
    App.state.gate.unlocked = !!ok;
    try{
      if (ok) localStorage.setItem(gateStorageKey(), JSON.stringify({ ok:true, ts: Date.now() }));
      else localStorage.removeItem(gateStorageKey());
    }catch(_e){}
  }

  function showGate(open){
    const m = $("#gateModal");
    if (!m) return;
    if (open){
      m.classList.remove("hidden");
      m.removeAttribute("inert");
      m.setAttribute("aria-hidden","false");
      setTimeout(()=>{ try{ $("#gatePass")?.focus(); }catch(_e){} }, 0);
    } else {
      const fallback = document.querySelector(".tabbar .tab.active") || document.querySelector(".tabbar .tab");
      try{ fallback?.focus(); }catch(_e){}
      m.setAttribute("aria-hidden","true");
      m.setAttribute("inert","");
      m.classList.add("hidden");
    }
  }

  function lockApp(){
    setGateUnlocked(false);
    showGate(true);
    toast("Locked.");
  }


    async function loadSettings(){
    const res = await sbTry(
      ()=>App.supa.from("settings").select("data").eq("space", SPACE_ID).maybeSingle(),
      "Could not load settings."
    );
    const data = res?.data?.data || {};
    const merged = { ...DEFAULT_SETTINGS, ...data, gcal: { ...DEFAULT_SETTINGS.gcal, ...(data.gcal||{}) } };
    App.state.settings = merged;

    // Ensure a shared row exists (so new devices instantly see defaults)
    if (!res?.data){
      await sbTry(()=>App.supa.from("settings").upsert({ space: SPACE_ID, data: merged }), "Could not initialize settings.");
    }
    return merged;
  }

  async function saveSettings(s){
    const res = await sbTry(()=>App.supa.from("settings").upsert({ space: SPACE_ID, data: s }), "Settings save failed.");
    if (res?.error) return false;
    App.state.settings = s;
    toast("Settings saved.");
    return true;
  }

    // ---------- Data: tasks/plans/logs ----------
  async function loadTasks(){
    const res = await sbTry(
      ()=>App.supa.from("tasks").select("id,title,status,assigned_date,created_at,completed_at").eq("space", SPACE_ID).order("created_at",{ascending:false}),
      "Could not load tasks."
    );
    App.state.tasks = res?.data || [];
    return App.state.tasks;
  }

  async function addTask(title, assignedDate=null){
    const t = String(title||"").trim();
    if (!t) return false;

    const res = await sbTry(()=>App.supa.from("tasks").insert({
      space: SPACE_ID,
      title: t,
      status: "open",
      assigned_date: assignedDate
    }), "Task add failed.");
    if (res?.error) return false;

    await loadTasks();
    renderTasks();
    toast("Task added.");
    return true;
  }

  async function updateTask(id, patch){
    const res = await sbTry(()=>App.supa.from("tasks").update(patch).eq("space", SPACE_ID).eq("id", id), "Task update failed.");
    if (res?.error) return false;
    await loadTasks(); renderTasks();
    return true;
  }

  function blankPlan(dateISO){
    return {
      date: dateISO,
      step1: Object.fromEntries(STEP1.map(x=>[x.key,false])),
      brainDump: "",
      focusTaskIds: [],
      constraints: {
        blocks: { julio:[], kristyn:[], nanny:[], kayden:[] },
        nannyWorking:false,
        bedtimeCaregiver:"Kristyn",
        appointments:[]
      },
      bath: { lastBathISO: null }
    };
  }
  function normPlan(plan, dateISO){
    const b = blankPlan(dateISO);
    const p = { ...b, ...(plan||{}) };
    p.step1 = { ...b.step1, ...(p.step1||{}) };
    p.constraints = { ...b.constraints, ...(p.constraints||{}) };
    p.constraints.blocks = { ...b.constraints.blocks, ...(p.constraints.blocks||{}) };
    p.constraints.appointments = Array.isArray(p.constraints.appointments) ? p.constraints.appointments : [];
    p.focusTaskIds = Array.isArray(p.focusTaskIds) ? p.focusTaskIds : [];
    p.bath = { ...b.bath, ...(p.bath||{}) };
    return p;
  }
  function blankLog(dateISO){
    return { date:dateISO, wakeTime:null, nap1:{enabled:false,start:null,end:null,running:false}, nap2:{enabled:false,start:null,end:null,running:false}, bedtime:null };
  }
  function normLog(log, dateISO){
    const b = blankLog(dateISO);
    const l = { ...b, ...(log||{}) };
    l.nap1 = { ...b.nap1, ...(l.nap1||{}) };
    l.nap2 = { ...b.nap2, ...(l.nap2||{}) };
    return l;
  }

    async function loadPlan(dateISO){
    const res = await sbTry(
      ()=>App.supa.from("day_plans").select("data").eq("space", SPACE_ID).eq("date", dateISO).maybeSingle(),
      "Could not load plan."
    );
    const plan = res?.data?.data || null;
    App.state.plans.set(dateISO, plan);
    return plan;
  }
  async function savePlan(dateISO, planData){
    const res = await sbTry(()=>App.supa.from("day_plans").upsert({ space:SPACE_ID, date:dateISO, data:planData }), "Plan save failed.");
    if (res?.error) return false;
    App.state.plans.set(dateISO, planData);
    return true;
  }

  async function loadLog(dateISO){
    const res = await sbTry(
      ()=>App.supa.from("day_logs").select("data,updated_at").eq("space", SPACE_ID).eq("date", dateISO).maybeSingle(),
      "Could not load log."
    );
    const log = res?.data?.data || null;
    App.state.logs.set(dateISO, log);
    return log;
  }
  async function saveLog(dateISO, logData){
    const res = await sbTry(()=>App.supa.from("day_logs").upsert({ space:SPACE_ID, date:dateISO, data:logData }), "Log save failed.");
    if (res?.error) return false;
    App.state.logs.set(dateISO, logData);
    return true;
  }

  async function loadHistory(limit=60){
    const res = await sbTry(
      ()=>App.supa.from("day_logs").select("date,data,updated_at").eq("space", SPACE_ID).order("date",{ascending:false}).limit(limit),
      "Could not load history."
    );
    return res?.data || [];
  }

  // ---------- Scheduling ----------
  function parseBlocks(list){
    return (Array.isArray(list)?list:[])
      .map(b => ({ start: timeToMin(b.start), end: timeToMin(b.end) }))
      .filter(b => b.start!=null && b.end!=null && b.end>b.start);
  }
  function buildAvail(constraints){
    const c = constraints || {};
    const blocks = c.blocks || {};
    return {
      julioUnavail: parseBlocks(blocks.julio),
      kristynUnavail: parseBlocks(blocks.kristyn),
      nannyWorking: c.nannyWorking ? parseBlocks(blocks.nanny) : [],
      kaydenAvail: parseBlocks(blocks.kayden),
      appts: (c.appointments||[])
        .map(a=>({ title:a.title||"Appointment", start: timeToMin(a.start), end: timeToMin(a.end) }))
        .filter(a=>a.start!=null && a.end!=null && a.end>a.start)
    };
  }

  function pickNapCaregiver(avail, s, e){
    // HARD RULE: Kayden never naps.
    const kAvail = !withinAny(avail.kristynUnavail, s, e);
    const jAvail = !withinAny(avail.julioUnavail, s, e);
    if (kAvail) return { who:"Kristyn", status:"covered" };
    if (jAvail) return { who:"Julio", status:"covered" };
    if (covers(avail.nannyWorking, s, e)) return { who:"Nanny", status:"covered" };
    return { who:"Uncovered", status:"uncovered" };
  }

  function pickRoutineAssignee(avail, s, e){
    const kAvail = !withinAny(avail.kristynUnavail, s, e);
    const jAvail = !withinAny(avail.julioUnavail, s, e);
    if (kAvail) return "Kristyn";
    if (jAvail) return "Julio";
    if (covers(avail.nannyWorking, s, e)) return "Nanny";
    if (covers(avail.kaydenAvail, s, e)) return "Kayden";
    return "Uncovered";
  }

  function splitAround(block, cutS, cutE){
    const out=[];
    if (block.start < cutS) out.push({ ...block, end: Math.min(cutS, block.end), key: uid(block.key+"_a") });
    if (block.end > cutE) out.push({ ...block, start: Math.max(cutE, block.start), key: uid(block.key+"_b") });
    return out.filter(x => x.end > x.start + 2);
  }

  function applyAppointments(blocks, appts){
    const out = [...blocks];
    const sorted = [...appts].sort((a,b)=>a.start-b.start);
    for (const appt of sorted){
      out.push({ key: uid("appt"), title: appt.title, type:"appt", start: appt.start, end: appt.end, assignee:"—" });
      // If overlaps routine block, push or split
      for (let i=0;i<out.length;i++){
        const b = out[i];
        if (b.type !== "routine") continue;
        if (!overlaps(b.start,b.end, appt.start, appt.end)) continue;

        const dur = b.end-b.start;
        const pushed = { ...b, start: appt.end, end: appt.end + dur };
        const conflict = out.some(o => o!==b && o.type!=="appt" && overlaps(pushed.start,pushed.end,o.start,o.end));
        if (!conflict) out[i]=pushed;
        else out.splice(i,1,...splitAround(b, appt.start, appt.end));
      }
    }
    return out;
  }

  function maybeBath(blocks, avail, plan){
    const dateISO = plan?.date;
    const last = plan?.bath?.lastBathISO;
    let overdue = !last;
    if (last){
      const a = new Date(last+"T00:00:00");
      const b = new Date(dateISO+"T00:00:00");
      overdue = Math.floor((b-a)/(24*3600*1000)) >= 3;
    }
    if (!overdue) return { blocks, warn:null };

    const dinner = blocks.find(b => b.key==="dinner");
    const bathLen=15;
    if (dinner){
      const s = dinner.end, e=s+bathLen;
      const julioUnavailable = withinAny(avail.julioUnavail, s, e);
      const conflict = blocks.some(b => overlaps(s,e,b.start,b.end));
      if (!julioUnavailable && !conflict){
        blocks.push({ key:"bath", title:"Bath", type:"routine", start:s, end:e, assignee: pickRoutineAssignee(avail,s,e) });
        return { blocks, warn:"Bath was overdue — scheduled Bath after dinner." };
      }
    }
    return { blocks, warn:"Bath is overdue — no obvious slot found (and it cannot be scheduled while Julio is unavailable)." };
  }

  function assignLanes(blocks){
    const sorted = [...blocks].sort((a,b)=>a.start-b.start || (a.end-a.start)-(b.end-b.start));
    const lanes=[];
    const out = sorted.map(b=>({ ...b, lane:0, laneCount:1 }));
    for (const b of out){
      let placed=false;
      for (let i=0;i<lanes.length;i++){
        const lane = lanes[i];
        const last = lane[lane.length-1];
        if (!last || !overlaps(last.start,last.end,b.start,b.end)){
          b.lane=i; lane.push(b); placed=true; break;
        }
      }
      if (!placed){ b.lane=lanes.length; lanes.push([b]); }
    }
    for (const b of out){
      const group = out.filter(o => overlaps(b.start,b.end,o.start,o.end));
      const minLane = Math.min(...group.map(o=>o.lane));
      const maxLane = Math.max(...group.map(o=>o.lane));
      b.laneCount = (maxLane-minLane)+1;
    }
    return out;
  }

    function resolveNap(nap, defaultStart, defaultDur, earliest){
    const enabled = !!nap?.enabled;
    const s = enabled ? timeToMin(nap.start) : null;
    const e = enabled ? timeToMin(nap.end) : null;

    // If we have a real start but no end yet (or end invalid), treat as "in progress / start-only"
    // and forecast the end from the actual start so the schedule shifts immediately.
    if (enabled && s!=null){
      if (e!=null && e>s) return { start:s, end:e, source:"actual" };
      return { start:s, end:s + defaultDur, source:"start_only" };
    }

    const st = (defaultStart!=null) ? defaultStart : (earliest!=null ? earliest : null);
    if (st==null) return { start:null, end:null, source:"none" };
    return { start: st, end: st + defaultDur, source:"forecast" };
  }

  function generateSchedule(dateISO, plan, log, settings){
    const p = normPlan(plan, dateISO);
    const l = normLog(log, dateISO);
    const s = settings || DEFAULT_SETTINGS;
    const avail = buildAvail(p.constraints);
    const warns = [];

    const wakeMinRaw = timeToMin(l.wakeTime || s.defaultWake) ?? timeToMin(DEFAULT_SETTINGS.defaultWake);
    const wake = clamp(wakeMinRaw, 240, 720);

    const blocks = [];
    const addRoutine = (key,title,start,end) => {
      if (start==null||end==null||end<=start) return;
      blocks.push({ key, title, type:"routine", start, end });
    };

    // Morning (no filler)
    addRoutine("cuddle","Family cuddle", wake, wake+20);
    addRoutine("dress","Get dressed", wake+20, wake+35);
    addRoutine("breakfast","Breakfast (prep + eat)", wake+35, wake+35+s.breakfastMin);
    addRoutine("teethAM","Brush teeth", wake+35+s.breakfastMin, wake+35+s.breakfastMin+5);

    // WW1 nap forecast
    const ww1Start = wake + Math.round(s.ww1Min*60);
    const ww1End = wake + Math.round(s.ww1Max*60);
    const nap1 = resolveNap(l.nap1, ww1End, s.nap1ForecastMin, ww1Start);

    if (nap1.start!=null){
      const routineS = clamp(nap1.start - s.napRoutineMin, wake+60, nap1.start);
      addRoutine("nap1Routine","Nap routine", routineS, nap1.start);

      const care = pickNapCaregiver(avail, nap1.start, nap1.end);
      blocks.push({ key:"nap1", title:"Nap 1", type:"nap", start:nap1.start, end:nap1.end, assignee: care.who, status: care.status });
      if (care.status==="uncovered") warns.push("Nap 1 is uncovered.");
    }

    let afterNap1 = nap1.end!=null ? nap1.end : (ww1End + s.nap1ForecastMin);
    afterNap1 = clamp(afterNap1, wake+120, wake+600);

    // WW2 + lunch + snack
    const ww2MinEnd = afterNap1 + Math.round(s.ww2Min*60);
    const ww2MaxEnd = afterNap1 + Math.round(s.ww2Max*60);
    const lunchStart = clamp(afterNap1+50, afterNap1+20, ww2MinEnd - s.lunchMin - 10);
    addRoutine("lunch","Lunch (prep + eat)", lunchStart, lunchStart+s.lunchMin);
    addRoutine("snack1","Snack + milk", lunchStart+s.lunchMin+90, lunchStart+s.lunchMin+105);

    // Nap 2
    const nap2 = resolveNap(l.nap2, ww2MaxEnd, s.nap2ForecastMin, null);
    if (nap2.start!=null){
      const routineS = clamp(nap2.start - s.napRoutineMin, afterNap1+60, nap2.start);
      addRoutine("nap2Routine","Nap routine", routineS, nap2.start);

      const care = pickNapCaregiver(avail, nap2.start, nap2.end);
      blocks.push({ key:"nap2", title:"Nap 2", type:"nap", start:nap2.start, end:nap2.end, assignee: care.who, status: care.status });
      if (care.status==="uncovered") warns.push("Nap 2 is uncovered.");
    }

    let afterNap2 = nap2.end!=null ? nap2.end : (ww2MaxEnd + s.nap2ForecastMin);
    afterNap2 = clamp(afterNap2, afterNap1+180, wake+1000);

    // WW3 + dinner + bedtime
    const ww3MinEnd = afterNap2 + Math.round(s.ww3Min*60);
    const ww3MaxEnd = afterNap2 + Math.round(s.ww3Max*60);

    const dinnerStart = clamp(afterNap2+80, afterNap2+40, ww3MinEnd - s.dinnerMin - 10);
    addRoutine("dinner","Dinner (prep + eat)", dinnerStart, dinnerStart+s.dinnerMin);
    addRoutine("snack2","Snack + milk", dinnerStart+s.dinnerMin+45, dinnerStart+s.dinnerMin+60);
    addRoutine("teethPM","Brush teeth", dinnerStart+s.dinnerMin+60, dinnerStart+s.dinnerMin+65);
    const bedStart = ww3MaxEnd - s.bedRoutineMin;
    addRoutine("prepNursery","Prep nursery for bed", Math.max(dinnerStart + s.dinnerMin + 10, bedStart-15), bedStart);

    const bedCare = (p.constraints?.bedtimeCaregiver==="Julio") ? "Julio":"Kristyn";
    blocks.push({ key:"bedtimeRoutine", title:"Bedtime routine", type:"routine", start: bedStart, end: ww3MaxEnd, assignee: bedCare });

    // Bath rule
    const bathRes = maybeBath(blocks, avail, p);
    if (bathRes.warn) warns.push(bathRes.warn);

    // Assign assignees for routine blocks (except bedtime already set)
    for (const b of blocks){
      if (b.type==="routine" && !b.assignee){
        b.assignee = pickRoutineAssignee(avail, b.start, b.end);
      }
      if (b.type==="nap" && !b.assignee){
        const care = pickNapCaregiver(avail, b.start, b.end);
        b.assignee = care.who; b.status = care.status;
      }
      if (b.assignee==="Uncovered" || b.status==="uncovered") b.status="uncovered";
    }

    // Appointments
    let finalBlocks = applyAppointments(blocks, avail.appts);

    // Appointment overlaps nap warning
    for (const a of avail.appts){
      if (finalBlocks.some(b => b.type==="nap" && overlaps(b.start,b.end,a.start,a.end))){
        warns.push(`Appointment overlaps a nap window: “${a.title}”.`);
      }
    }

    finalBlocks = finalBlocks
      .filter(b => b.start!=null && b.end!=null && b.end>b.start)
      .sort((a,b)=>a.start-b.start);

    return { blocks: assignLanes(finalBlocks), warnings: warns };
  }

  // ---------- Timeline rendering ----------
  function buildTimeline(el, blocks){
    if (!el) return;
    el.innerHTML = "";

    const minStart = blocks.length ? Math.min(...blocks.map(b=>b.start)) : 7*60;
    const maxEnd = blocks.length ? Math.max(...blocks.map(b=>b.end)) : 20*60;
    const startHour = clamp(Math.floor((minStart-60)/60), 0, 23);
    const endHour = clamp(Math.ceil((maxEnd+60)/60), startHour+1, 24);

    // Taller timeline so short blocks don't visually collide.
    const pxPerMin = 1.6; // ~96px/hour
    const dayOffset = startHour*60;
    const totalMin = (endHour*60) - dayOffset;

    const rowHeight = 60 * pxPerMin; // 1-hour grid
    for (let h=startHour; h<endHour; h++){
      const row = document.createElement("div");
      row.className = "timeRow" + ((h%2===0) ? " major" : "");
      row.style.height = `${rowHeight}px`;

      // Label every 2 hours to reduce clutter
      if (h%2===0 || h===startHour){
        const label = document.createElement("div");
        label.className = "timeLabel";
        label.textContent = minTo12h(h*60).replace(":00","");
        row.appendChild(label);
      }
      el.appendChild(row);
    }

    const layer = document.createElement("div");
    layer.className = "layer";
    layer.style.height = `${totalMin*pxPerMin}px`;
    el.style.height = `${totalMin*pxPerMin}px`;

    for (const b of blocks){
      const div = document.createElement("div");
      div.className = "event";
      if (b.type==="nap") div.classList.add("nap");
      if (b.type==="appt") div.classList.add("appt");
      if (b.status==="uncovered") div.classList.add("warn");

      const top = (b.start - dayOffset) * pxPerMin;
      const rawH = (b.end-b.start)*pxPerMin;
      const height = Math.max(10, rawH - 2);

      const leftPct = (b.lane / b.laneCount) * 100;
      const widthPct = (1 / b.laneCount) * 100;

      div.style.top = `${top}px`;
      div.style.height = `${height}px`;
      div.style.left = `calc(${leftPct}% + 6px)`;
      div.style.width = `calc(${widthPct}% - 10px)`;

      const range = `${minTo12h(b.start)}–${minTo12h(b.end)}`;
      const who = b.assignee && b.assignee!=="—" ? ` • ${b.assignee}` : "";
      const tip = `${b.title} • ${range}${who}`;
      div.title = tip;
      div.onclick = () => toast(tip);

      if (height < 34) div.classList.add("compact");
      if (height < 22) div.classList.add("tiny");

      const t = document.createElement("div");
      t.className = "eventTitle";
      t.textContent = b.title;

      const meta = document.createElement("div");
      meta.className = "eventMeta";
      meta.textContent = `${range}${who}`;

      div.appendChild(t); div.appendChild(meta);
      layer.appendChild(div);
    }

    el.appendChild(layer);
  }

  // ---------- Rendering: tasks / history / settings ----------
  function renderTasks(){
    const tasks = App.state.tasks || [];
    const todayISO = dateToISO(new Date());

    const open = tasks.filter(t=>t.status!=="done");
    const done = tasks.filter(t=>t.status==="done");

    const openWrap = $("#tasksOpen"); const doneWrap = $("#tasksDone"); const todayWrap = $("#todayTasks");
    if (openWrap) openWrap.innerHTML="";
    if (doneWrap) doneWrap.innerHTML="";
    if (todayWrap) todayWrap.innerHTML="";

    const makeRow = (t, showAssign) => {
      const row = document.createElement("div");
      row.className = "task" + (t.status==="done" ? " taskDone" : "");
      const cb = document.createElement("input");
      cb.type="checkbox"; cb.checked = t.status==="done";
      cb.onchange = async () => {
        await updateTask(t.id, { status: cb.checked ? "done" : "open", completed_at: cb.checked ? new Date().toISOString() : null });
      };

      const title = document.createElement("div");
      title.className="taskTitle"; title.textContent=t.title;

      const meta = document.createElement("div");
      meta.className="taskMeta"; meta.textContent = t.assigned_date ? `Assigned: ${isoToShort(t.assigned_date)}` : "Unassigned";

      row.appendChild(cb); row.appendChild(title); row.appendChild(meta);

      if (showAssign){
        const btnToday = document.createElement("button");
        btnToday.className="btn btnTiny"; btnToday.textContent="Today";
        btnToday.onclick = async ()=>{ await updateTask(t.id, { assigned_date: todayISO }); };

        const btnClear = document.createElement("button");
        btnClear.className="btn btnTiny"; btnClear.textContent="Clear";
        btnClear.onclick = async ()=>{ await updateTask(t.id, { assigned_date: null }); };

        row.appendChild(btnToday); row.appendChild(btnClear);
      }
      return row;
    };

    if (openWrap) open.slice(0,120).forEach(t=>openWrap.appendChild(makeRow(t,true)));
    if (doneWrap) done.slice(0,60).forEach(t=>doneWrap.appendChild(makeRow(t,false)));

    const todays = open.filter(t=>t.assigned_date===todayISO);
    if (todayWrap){
      if (!todays.length) todayWrap.innerHTML = '<div class="empty">No tasks assigned to Today.</div>';
      else todays.forEach(t=>todayWrap.appendChild(makeRow(t,false)));
    }
  }

  async function renderHistory(){
    const list = $("#historyList");
    const detail = $("#historyDetail");
    if (!list) return;
    list.innerHTML = '<div class="empty">Loading…</div>';
    const rows = await loadHistory(60);
    if (!rows.length){ list.innerHTML = '<div class="empty">No history yet.</div>'; return; }
    list.innerHTML="";
    rows.forEach(r=>{
      const item = document.createElement("div");
      item.className="histRow";
      item.innerHTML = `<div><div style="font-weight:900">${isoToShort(r.date)}</div>
        <div class="muted small">Wake: ${r.data?.wakeTime || "—"} • Bedtime: ${r.data?.bedtime || "—"}</div></div>
        <div class="muted small">View</div>`;
      item.onclick = () => {
        $("#histTitle").textContent = `Day log: ${isoToShort(r.date)}`;
        $("#histMeta").textContent = `Updated: ${new Date(r.updated_at).toLocaleString()}`;
        $("#histBody").textContent = JSON.stringify(r.data||{}, null, 2);
        detail.classList.remove("hidden");
        detail.scrollIntoView({ behavior:"smooth", block:"start" });
      };
      list.appendChild(item);
    });
  }

  function renderSettings(){
    const s = App.state.settings || DEFAULT_SETTINGS;
    $("#setWake").value = s.defaultWake || DEFAULT_SETTINGS.defaultWake;
    $("#setBreakfast").value = s.breakfastMin;
    $("#setLunch").value = s.lunchMin;
    $("#setDinner").value = s.dinnerMin;
    $("#setNapRoutine").value = s.napRoutineMin;
    $("#setBedRoutine").value = s.bedRoutineMin;
    $("#setNap1").value = s.nap1ForecastMin;
    $("#setNap2").value = s.nap2ForecastMin;

    $("#ww1Min").value = s.ww1Min; $("#ww1Max").value = s.ww1Max;
    $("#ww2Min").value = s.ww2Min; $("#ww2Max").value = s.ww2Max;
    $("#ww3Min").value = s.ww3Min; $("#ww3Max").value = s.ww3Max;

    $("#gcalUrl").value = s.gcal?.scriptUrl || "";
    $("#gcalCalId").value = s.gcal?.calendarId || "";
    $("#gcalKey").value = s.gcal?.apiKey || "";
  }

  // ---------- Views ----------
  function showTab(name){
    const map = { Evening:"#viewEvening", Today:"#viewToday", Tasks:"#viewTasks", History:"#viewHistory", Settings:"#viewSettings" };
    for (const [k,sel] of Object.entries(map)){
      const v = $(sel); if (!v) continue;
      v.classList.toggle("hidden", k!==name);
    }
    $$(".tab").forEach(b=>b.classList.toggle("active", b.dataset.tab===name));
  }

  // ---------- Wizard ----------
  function showWizard(open){
    const m = $("#wizardModal");
    if (!m) return;
    if (open){
      m.classList.remove("hidden");
      m.removeAttribute("inert");
      m.setAttribute("aria-hidden","false");
      setTimeout(()=>{ try{ $("#wizChecklist1")?.focus(); }catch(_e){} }, 0);
    } else {
      const fallback = document.querySelector(".tabbar .tab.active") || document.querySelector(".tabbar .tab");
      try{ fallback?.focus(); }catch(_e){}
      m.setAttribute("aria-hidden","true");
      m.setAttribute("inert","");
      m.classList.add("hidden");
    }
  }

  function buildStepper(){
    const st = $("#stepper"); st.innerHTML="";
    for (let i=1;i<=5;i++){
      const b = document.createElement("button");
      b.className="stepDot" + (i===App.state.wizard.step ? " active":"") + (i>App.state.wizard.maxStep ? " disabled":"");
      b.textContent = `Step ${i}`;
      b.onclick = () => { if (i<=App.state.wizard.maxStep) goStep(i); };
      st.appendChild(b);
    }
  }

  function goStep(step){
    App.state.wizard.step = step;
    App.state.wizard.maxStep = Math.max(App.state.wizard.maxStep, step);
    $$(".step").forEach(s=>s.classList.toggle("hidden", Number(s.dataset.step)!==step));
    $("#btnPrev").disabled = step===1;
    $("#btnNext").disabled = step===5;
    buildStepper();
    if (step===1) renderFocusSummary();
    if (step===3) renderFocusPicker();
    if (step===4) renderConstraints();
    if (step===5) renderPreview();
  }

  async function openWizardFor(dateISO){
    showWizard(true);
    const existing = await loadPlan(dateISO);
    const draft = normPlan(existing, dateISO);
    App.state.wizard = { open:true, dateISO, step:1, maxStep:1, draft };
    $("#wizardMeta").textContent = `Planning for ${isoToShort(dateISO)} • Autosaves as you go.`;
    renderWizard();
    showWizard(true);
  }

  
  function renderFocusSummary(){
    const d = App.state.wizard?.draft;
    const wrap = $("#focusSummary");
    if (!wrap || !d) return;
    wrap.innerHTML = "";

    const ids = Array.isArray(d.focusTaskIds) ? d.focusTaskIds : [];
    const tasks = App.state.tasks || [];
    const byId = new Map(tasks.map(t=>[t.id, t]));
    const picked = ids.map(id=>byId.get(id)).filter(Boolean);

    if (!picked.length){
      wrap.innerHTML = `<div class="empty">No focus tasks selected yet. Add tasks in Step 2 and pick your focus list in Step 3.</div>`;
      return;
    }

    for (const t of picked){
      const row = document.createElement("div");
      row.className = "task";
      row.innerHTML = `<div class="check" style="opacity:.55">•</div>
        <div class="tBody">
          <div class="tTitle">${escapeHtml(t.title)}</div>
          <div class="muted small">Planned for ${isoToShort(d.date)}</div>
        </div>`;
      wrap.appendChild(row);
    }
  }
function renderWizard(){
    const d = App.state.wizard.draft;
    if (!d) return;

    // Step 1 focus summary (no checklist)
    renderFocusSummary();

    // Step 2 brain dump
    $("#brainDump").value = d.brainDump || "";
    $("#brainDump").oninput = debounce(() => { d.brainDump=$("#brainDump").value; autosavePlan(); }, 250);

    // Bedtime radios
    $$('input[name="bedCare"]').forEach(r=>{
      r.checked = r.value === (d.constraints?.bedtimeCaregiver || "Kristyn");
      r.onchange = () => { if (r.checked){ d.constraints.bedtimeCaregiver=r.value; autosavePlan(); } };
    });

    // Nanny working
    $("#nannyOn").checked = !!d.constraints.nannyWorking;
    $("#nannyOn").onchange = () => { d.constraints.nannyWorking=$("#nannyOn").checked; autosavePlan(); renderConstraints(); };

    $("#btnJumpFocus").onclick = ()=>{ goStep(3); };

    goStep(1);
  }

  const autosavePlan = debounce(async () => {
    const d = App.state.wizard.draft;
    if (!d) return;
    if (!App.state.user){ $("#saveStatus").textContent = "Autosave off (sign in)."; return; }
    if (!App.state.household){ $("#saveStatus").textContent = "Autosave off (no household)."; return; }
    $("#saveStatus").textContent = "Autosaving…";
    const ok = await savePlan(d.date, d);
    $("#saveStatus").textContent = ok ? "Autosaved." : "Autosave failed.";
  }, 450);

  async function convertBrainDump(){
    const d = App.state.wizard.draft;
    const lines = (d.brainDump||"").split("\n").map(s=>s.trim()).filter(Boolean);
    if (!lines.length){ toast("Nothing to convert."); return; }
    $("#bdStatus").textContent = "Converting…";
    for (const line of lines.slice(0,50)) await addTask(line, null);
    d.brainDump=""; $("#brainDump").value="";
    await savePlan(d.date, d);
    $("#bdStatus").textContent = `Added ${Math.min(lines.length,50)} tasks.`;
    await loadTasks(); renderFocusPicker();
  }

  function renderFocusPicker(){
    const d = App.state.wizard.draft;
    const wrap = $("#focusPicker"); wrap.innerHTML="";
    const open = (App.state.tasks||[]).filter(t=>t.status!=="done");
    if (!open.length){ wrap.innerHTML = '<div class="empty">No open tasks yet. Add some in Tasks or use Brain Dump.</div>'; return; }
    open.slice(0,80).forEach(t=>{
      const row = document.createElement("div");
      row.className="task";
      row.innerHTML = `<input type="checkbox" ${d.focusTaskIds.includes(t.id)?"checked":""}>
        <div class="taskTitle">${escapeHtml(t.title)}</div>
        <div class="taskMeta">Focus ${isoToShort(d.date)}</div>`;
      const cb = row.querySelector("input");
      cb.onchange = () => {
        if (cb.checked){ if (!d.focusTaskIds.includes(t.id)) d.focusTaskIds.push(t.id); }
        else d.focusTaskIds = d.focusTaskIds.filter(x=>x!==t.id);
        autosavePlan();
      };
      wrap.appendChild(row);
    });
  }

  function renderConstraints(){
    const d = App.state.wizard.draft;
    const mount = (key, elId) => {
      const el = $(elId); el.innerHTML="";
      const list = d.constraints.blocks[key] || [];
      list.forEach((b, idx)=>{
        const row = document.createElement("div");
        row.className="blkRow";
        row.innerHTML = `<input class="input inputTime" type="time" value="${b.start||""}">
          <span>→</span>
          <input class="input inputTime" type="time" value="${b.end||""}">
          <button class="btn btnTiny">Remove</button>`;
        const [s,e] = row.querySelectorAll("input");
        const del = row.querySelector("button");
        s.onchange=()=>{ b.start=s.value; autosavePlan(); };
        e.onchange=()=>{ b.end=e.value; autosavePlan(); };
        del.onclick=()=>{ d.constraints.blocks[key]=list.filter((_,i)=>i!==idx); autosavePlan(); renderConstraints(); };
        el.appendChild(row);
      });
    };
    mount("julio","#blkJulio"); mount("kristyn","#blkKristyn"); mount("nanny","#blkNanny"); mount("kayden","#blkKayden");

    // Appointments
    const ap = $("#apptList"); ap.innerHTML="";
    (d.constraints.appointments||[]).forEach((a, idx)=>{
      const card = document.createElement("div");
      card.className="apptCard";
      card.innerHTML = `<input class="input" placeholder="Appointment title" value="${escapeHtml(a.title||"")}">
        <input class="input inputTime" type="time" value="${a.start||""}">
        <input class="input inputTime" type="time" value="${a.end||""}">
        <button class="btn btnTiny">Remove</button>`;
      const [t,s,e] = card.querySelectorAll("input");
      const del = card.querySelector("button");
      t.oninput = debounce(()=>{ a.title=t.value; autosavePlan(); }, 200);
      s.onchange=()=>{ a.start=s.value; autosavePlan(); };
      e.onchange=()=>{ a.end=e.value; autosavePlan(); };
      del.onclick=()=>{ d.constraints.appointments = d.constraints.appointments.filter((_,i)=>i!==idx); autosavePlan(); renderConstraints(); };
      ap.appendChild(card);
    });
  }

  function renderPreview(){
    const d = App.state.wizard.draft;
    const sched = generateSchedule(d.date, d, blankLog(d.date), App.state.settings);
    const warn = $("#warnings");
    if (sched.warnings.length){
      warn.classList.remove("hidden");
      warn.innerHTML = `<div class="noticeTitle">Notes</div><div class="noticeBody">${sched.warnings.map(w=>"• "+escapeHtml(w)).join("<br>")}</div>`;
    } else {
      warn.classList.add("hidden"); warn.innerHTML="";
    }
    buildTimeline($("#wizardPreview"), sched.blocks);
  }

  async function saveWizard(){
    const d = App.state.wizard.draft;
    const dateISO = d.date;

    // assign focus tasks to plan date
    for (const id of (d.focusTaskIds||[])){
      const t = (App.state.tasks||[]).find(x=>x.id===id);
      if (t && t.status!=="done") await updateTask(id, { assigned_date: dateISO });
    }

    const ok = await savePlan(dateISO, d);
    $("#saveStatus").textContent = ok ? "Saved." : "Save failed.";
    toast(ok ? "Plan saved." : "Save failed.");
  }

  // ---------- Quick edit ----------
  function showQuick(open){
    const m = $("#quickModal");
    if (!m) return;
    if (open){
      m.classList.remove("hidden");
      m.removeAttribute("inert");
      m.setAttribute("aria-hidden","false");
      setTimeout(()=>{ try{ $("#quickConstraints")?.focus(); }catch(_e){} }, 0);
    } else {
      const fallback = document.querySelector(".tabbar .tab.active") || document.querySelector(".tabbar .tab");
      try{ fallback?.focus(); }catch(_e){}
      m.setAttribute("aria-hidden","true");
      m.setAttribute("inert","");
      m.classList.add("hidden");
    }
  }

  function renderQuick(dateISO, title){
    $("#quickTitle").textContent = title || "Quick edit";
    const plan = normPlan(App.state.plans.get(dateISO), dateISO);
    const body = $("#quickBody");
    body.innerHTML = `
      <div class="sectionTitle">Availability blocks</div>
      <div class="availGrid">
        <div class="availCol"><div class="availTitle">Julio unavailable</div><div id="qJulio" class="blkList"></div><button class="btn btnTiny" data-qadd="julio">+ Add block</button></div>
        <div class="availCol"><div class="availTitle">Kristyn unavailable</div><div id="qKristyn" class="blkList"></div><button class="btn btnTiny" data-qadd="kristyn">+ Add block</button></div>
        <div class="availCol"><div class="availTitle">Nanny working?</div><label class="toggle"><input type="checkbox" id="qNannyOn"> <span>Yes</span></label><div id="qNanny" class="blkList"></div><button class="btn btnTiny" data-qadd="nanny">+ Add block</button></div>
        <div class="availCol"><div class="availTitle">Kayden available</div><div class="muted small">Kayden can help with routines, but <b>never naps</b>.</div><div id="qKayden" class="blkList"></div><button class="btn btnTiny" data-qadd="kayden">+ Add block</button></div>
      </div>

      <div class="divider"></div>
      <div class="sectionTitle">Bedtime caregiver (Kristyn or Julio only)</div>
      <div class="row wrap">
        <label class="pillRadio"><input type="radio" name="qBed" value="Kristyn"> Kristyn</label>
        <label class="pillRadio"><input type="radio" name="qBed" value="Julio"> Julio</label>
      </div>

      <div class="divider"></div>
      <div class="sectionTitle">Appointments</div>
      <div id="qAppts" class="apptList"></div>
      <button class="btn btnTiny" id="qAddAppt">+ Add appointment</button>
    `;

    const mount = (key, elId) => {
      const el = $(elId); el.innerHTML="";
      const list = plan.constraints.blocks[key] || [];
      list.forEach((b, idx)=>{
        const row = document.createElement("div");
        row.className="blkRow";
        row.innerHTML = `<input class="input inputTime" type="time" value="${b.start||""}">
          <span>→</span>
          <input class="input inputTime" type="time" value="${b.end||""}">
          <button class="btn btnTiny">Remove</button>`;
        const [s,e] = row.querySelectorAll("input");
        const del = row.querySelector("button");
        s.onchange=()=>{ b.start=s.value; };
        e.onchange=()=>{ b.end=e.value; };
        del.onclick=()=>{ plan.constraints.blocks[key]=list.filter((_,i)=>i!==idx); renderQuick(dateISO, title); };
        el.appendChild(row);
      });
    };
    mount("julio","#qJulio"); mount("kristyn","#qKristyn"); mount("nanny","#qNanny"); mount("kayden","#qKayden");

    $("#qNannyOn").checked = !!plan.constraints.nannyWorking;
    $("#qNannyOn").onchange = ()=>{ plan.constraints.nannyWorking=$("#qNannyOn").checked; };

    $$('input[name="qBed"]').forEach(r=>{
      r.checked = r.value === (plan.constraints.bedtimeCaregiver || "Kristyn");
      r.onchange = ()=>{ if (r.checked) plan.constraints.bedtimeCaregiver=r.value; };
    });

    const ap = $("#qAppts"); ap.innerHTML="";
    (plan.constraints.appointments||[]).forEach((a, idx)=>{
      const card = document.createElement("div");
      card.className="apptCard";
      card.innerHTML = `<input class="input" placeholder="Appointment title" value="${escapeHtml(a.title||"")}">
        <input class="input inputTime" type="time" value="${a.start||""}">
        <input class="input inputTime" type="time" value="${a.end||""}">
        <button class="btn btnTiny">Remove</button>`;
      const [t,s,e] = card.querySelectorAll("input");
      const del = card.querySelector("button");
      t.oninput = ()=>{ a.title=t.value; };
      s.onchange=()=>{ a.start=s.value; };
      e.onchange=()=>{ a.end=e.value; };
      del.onclick=()=>{ plan.constraints.appointments = plan.constraints.appointments.filter((_,i)=>i!==idx); renderQuick(dateISO, title); };
      ap.appendChild(card);
    });

    $$("[data-qadd]").forEach(btn=>{
      btn.onclick = ()=>{
        const who = btn.dataset.qadd;
        plan.constraints.blocks[who] = plan.constraints.blocks[who] || [];
        plan.constraints.blocks[who].push({ start:"", end:"" });
        renderQuick(dateISO, title);
      };
    });
    $("#qAddAppt").onclick = ()=>{
      plan.constraints.appointments = plan.constraints.appointments || [];
      plan.constraints.appointments.push({ title:"", start:"", end:"" });
      renderQuick(dateISO, title);
    };

    $("#quickModal").dataset.dateIso = dateISO;
    $("#quickModal")._plan = plan;
  }

  async function saveQuick(){
    const modal = $("#quickModal");
    const dateISO = modal.dataset.dateIso;
    const plan = modal._plan;
    $("#quickStatus").textContent = "Saving…";
    const ok = await savePlan(dateISO, plan);
    $("#quickStatus").textContent = ok ? "Saved." : "Save failed.";
    if (ok){
      await loadPlan(dateISO);
      await refreshViewsFor(dateISO);
    }
  }

  async function refreshViewsFor(dateISO){
    const todayISO = dateToISO(new Date());
    const tomorrowISO = dateToISO(addDays(new Date(),1));
    if (dateISO===todayISO) await loadAndRenderToday();
    if (dateISO===tomorrowISO) await loadAndRenderTomorrow();
  }

  // ---------- Today ----------
  async function loadAndRenderToday(){
    const iso = dateToISO(new Date());
    let log = await loadLog(iso);
    log = normLog(log, iso);
    App.state.logs.set(iso, log);

    // Prefill UI
    const wakeEl = $("#wakeTime"); if (wakeEl) wakeEl.value = log.wakeTime || "";
    const bedEl = $("#bedtime"); if (bedEl) bedEl.value = log.bedtime || "";

    const nap1En = $("#nap1Enabled"); if (nap1En) nap1En.checked = !!log.nap1.enabled;
    const nap2En = $("#nap2Enabled"); if (nap2En) nap2En.checked = !!log.nap2.enabled;
    const nap1S = $("#nap1Start"); if (nap1S) nap1S.value = log.nap1.start || "";
    const nap1E = $("#nap1End"); if (nap1E) nap1E.value = log.nap1.end || "";
    const nap2S = $("#nap2Start"); if (nap2S) nap2S.value = log.nap2.start || "";
    const nap2E = \$\(\"#nap2End\"\); if \(nap2E\) nap2E\.value = log\.nap2\.end \|\| \"\";

    const btnNap1 = $("#btnNap1Toggle");
    const btnNap2 = $("#btnNap2Toggle");

    const plan = App.state.todayPlan || blankPlan(iso);
    const settings = App.state.settings || DEFAULT_SETTINGS;

    const debouncedSave = debounce(async () => {
      const current = normLog(App.state.logs.get(iso), iso);
      await saveLog(iso, current);
    }, 350);

    const rerender = () => {
      const current = normLog(App.state.logs.get(iso), iso);
      const sched = generateSchedule(iso, plan, current, settings);
      buildTimeline($("#todayTimeline"), sched.blocks);
      $("#todayMeta").textContent = `Date: ${isoToShort(iso)} • Blocks: ${sched.blocks.length}`;
      const b = bathStatus(iso);
      $("#bathFlag").classList.toggle("hidden", !b.overdue);
      $("#bathFlag").textContent = b.overdue ? `Bath overdue (${b.daysSince}d). Suggest: ${b.suggest}` : "";
      // tasks sidebar always refreshes in case today date rolled over
      renderTasks();
      syncNapControls();
    };

    const setLog = (updater) => {
      const cur = App.state.logs.get(iso) || normLog(null, iso);
      updater(cur);
      App.state.logs.set(iso, cur);
      rerender();
      debouncedSave();
    };

    const nowHHMM = () => {
      const now = new Date();
      const hh24 = String(now.getHours()).padStart(2,"0");
      const mm = String(now.getMinutes()).padStart(2,"0");
      return `${hh24}:${mm}`;
    };

    const syncNapControls = () => {
      const current = normLog(App.state.logs.get(iso), iso);

      // Nap 1
      if (nap1En) nap1En.checked = !!current.nap1.enabled;
      if (nap1S) nap1S.disabled = !current.nap1.enabled;
      if (nap1E) nap1E.disabled = !current.nap1.enabled;
      if (btnNap1){
        btnNap1.disabled = !current.nap1.enabled;
        btnNap1.textContent = current.nap1.running ? "Stop" : "Start";
      }

      // Nap 2
      if (nap2En) nap2En.checked = !!current.nap2.enabled;
      if (nap2S) nap2S.disabled = !current.nap2.enabled;
      if (nap2E) nap2E.disabled = !current.nap2.enabled;
      if (btnNap2){
        btnNap2.disabled = !current.nap2.enabled;
        btnNap2.textContent = current.nap2.running ? "Stop" : "Start";
      }
    };

    const toggleNap = (which) => {
      setLog(l => {
        const n = l[which];
        if (!n.enabled) n.enabled = true;
        const t = nowHHMM();

        if (n.running){
          n.end = t;
          n.running = false;
        } else {
          n.start = t;
          n.end = null;
          n.running = true;
        }
      });
    };

    if (btnNap1) btnNap1.onclick = () => toggleNap("nap1");
    if (btnNap2) btnNap2.onclick = () => toggleNap("nap2");

    $("#btnWakeNow").onclick = () => {
      const now = new Date();
      const hh24 = String(now.getHours()).padStart(2,"0");
      const mm = String(now.getMinutes()).padStart(2,"0");
      const val = `${hh24}:${mm}`;
      if (wakeEl) wakeEl.value = val; else { const tmp = $("#wakeTime"); if (tmp) tmp.value = val; }
      setLog(l => { l.wakeTime = val; });
    };

    const el_wakeTime = $("#wakeTime"); if (el_wakeTime) el_wakeTime.onchange = () => setLog(l => { l.wakeTime = el_wakeTime.value || null; });

    const el_nap1Enabled = $("#nap1Enabled"); if (el_nap1Enabled) el_nap1Enabled.onchange = () => setLog(l => { l.nap1.enabled = el_nap1Enabled.checked; if (!l.nap1.enabled){ l.nap1.start=null; l.nap1.end=null; l.nap1.running=false; } });
    const el_nap2Enabled = $("#nap2Enabled"); if (el_nap2Enabled) el_nap2Enabled.onchange = () => setLog(l => { l.nap2.enabled = el_nap2Enabled.checked; if (!l.nap2.enabled){ l.nap2.start=null; l.nap2.end=null; l.nap2.running=false; } });

    const el_nap1Start = $("#nap1Start"); if (el_nap1Start) el_nap1Start.onchange = () => setLog(l => { l.nap1.enabled = true; l.nap1.start = el_nap1Start.value || null; l.nap1.running = false; });
    const el_nap1End = $("#nap1End"); if (el_nap1End) el_nap1End.onchange = () => setLog(l => { l.nap1.enabled = true; l.nap1.end = el_nap1End.value || null; l.nap1.running = false; });
    const el_nap2Start = $("#nap2Start"); if (el_nap2Start) el_nap2Start.onchange = () => setLog(l => { l.nap2.enabled = true; l.nap2.start = el_nap2Start.value || null; l.nap2.running = false; });
    const el_nap2End = $("#nap2End"); if (el_nap2End) el_nap2End.onchange = () => setLog(l => { l.nap2.enabled = true; l.nap2.end = el_nap2End.value || null; l.nap2.running = false; });

    const bedInp = $("#bedtime"); if (bedInp) bedInp.onchange = () => setLog(l => { l.bedtime = bedInp.value || null; });

    // Initial render
    rerender();
}

  // ---------- Tomorrow ----------
  async function loadAndRenderTomorrow(){
    const tomorrowISO = dateToISO(addDays(new Date(),1));
    const planRaw = await loadPlan(tomorrowISO);
    if (!planRaw){
      $("#tomorrowEmpty").classList.remove("hidden");
      $("#tomorrowWrap").classList.add("hidden");
      $("#btnQuickEditTomorrow").disabled = true;
      return;
    }
    const plan = normPlan(planRaw, tomorrowISO);
    const sched = generateSchedule(tomorrowISO, plan, blankLog(tomorrowISO), App.state.settings);
    $("#tomorrowMeta").textContent = `Date: ${isoToShort(tomorrowISO)} • Blocks: ${sched.blocks.length}`;
    buildTimeline($("#tomorrowTimeline"), sched.blocks);
    $("#tomorrowEmpty").classList.add("hidden");
    $("#tomorrowWrap").classList.remove("hidden");
    $("#btnQuickEditTomorrow").disabled = false;
  }

  // ---------- Export ----------
  async function exportToday(){
    const s = App.state.settings;
    const url = s.gcal?.scriptUrl;
    const calendarId = s.gcal?.calendarId;
    const apiKey = s.gcal?.apiKey;
    if (!url || !calendarId || !apiKey){
      toast("Set Apps Script URL, Calendar ID, and API key in Settings.");
      return;
    }
    const iso = dateToISO(new Date());
    const plan = normPlan(App.state.plans.get(iso), iso);
    const log = normLog(App.state.logs.get(iso), iso);
    const sched = generateSchedule(iso, plan, log, s);

    // scheduled blocks only (no open time)
    const blocks = sched.blocks
      .filter(b => b.type !== "appt")
      .map(b => ({ title:b.title, start:minToTime(b.start), end:minToTime(b.end), assignee:b.assignee||"", type:b.type||"" }));

    const payload = { apiKey, calendarId, date: iso, blocks };

    const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    const txt = await res.text();
    if (!res.ok){ toast(`Export failed: ${txt || res.status}`); return; }
    toast("Exported to Google Calendar.");
  }

  // ---------- Wire events ----------
  function wire(){
    // Tabs
    $$(".tab").forEach(btn=>{
      btn.onclick = async () => {
        const tab = btn.dataset.tab;
        showTab(tab);
        if (tab==="Evening") await loadAndRenderTomorrow();
        if (tab==="Today") await loadAndRenderToday();
        if (tab==="Tasks") { await loadTasks(); renderTasks(); }
        if (tab==="History") await renderHistory();
        if (tab==="Settings") renderSettings();
      };
    });

        // Gate (shared password, no individual sign-ins)
    $("#btnGateEnter").onclick = async () => {
      const pass = $("#gatePass")?.value || "";
      const status = $("#gateStatus");
      if (pass === ACCESS_PASSWORD){
        setGateUnlocked(true);
        if (status) status.textContent = "✓ Unlocked";
        showGate(false);
        await postUnlockBoot();
      } else {
        if (status) status.textContent = "Incorrect password.";
        toast("Incorrect password.");
      }
    };
    $("#gatePass").onkeydown = (e) => { if (e.key==="Enter"){ e.preventDefault(); $("#btnGateEnter").click(); } };

    // Lock
    $("#btnLock").onclick = () => lockApp();

    // Wizard open/close
    $("#btnOpenWizard").onclick = async () => { try { const iso = dateToISO(addDays(new Date(),1)); await openWizardFor(iso); } catch(e){ console.error(e); toast("Couldn\u2019t open the planner."); } };
    $("#btnCloseWizard").onclick = () => showWizard(false);
    $("#wizardScrim").onclick = () => showWizard(false);

    // Wizard nav
    $("#btnPrev").onclick = () => goStep(Math.max(1, App.state.wizard.step-1));
    $("#btnNext").onclick = () => goStep(Math.min(5, App.state.wizard.step+1));
    $("#btnBackTo4").onclick = () => goStep(4);

    // Wizard actions
    $("#btnConvert").onclick = convertBrainDump;
    $("#btnAddAppt").onclick = () => { const d=App.state.wizard.draft; d.constraints.appointments.push({title:"",start:"",end:""}); autosavePlan(); renderConstraints(); };
    $("#btnSavePlan").onclick = saveWizard;

    // Add blocks in step 4
    $$("[data-add]").forEach(btn=>{
      btn.onclick = () => {
        const who = btn.dataset.add;
        const d = App.state.wizard.draft;
        d.constraints.blocks[who].push({start:"",end:""});
        autosavePlan(); renderConstraints();
      };
    });

    // Quick edit open
    $("#btnQuickEditTomorrow").onclick = async () => {
      const iso = dateToISO(addDays(new Date(),1));
      await loadPlan(iso);
      renderQuick(iso, `Quick edit: ${isoToShort(iso)}`);
      showQuick(true);
    };
    $("#btnEditToday").onclick = async () => {
      const iso = dateToISO(new Date());
      await loadPlan(iso);
      renderQuick(iso, `Quick edit: Today (${isoToShort(iso)})`);
      showQuick(true);
    };
    $("#btnCloseQuick").onclick = () => showQuick(false);
    $("#quickScrim").onclick = () => showQuick(false);
    $("#btnSaveQuick").onclick = saveQuick;

    // Tasks
    $("#btnAddTask").onclick = async () => {
      const v = $("#taskInput").value; $("#taskInput").value="";
      await addTask(v, null);
    };
    $("#taskInput").onkeydown = (e) => { if (e.key==="Enter"){ e.preventDefault(); $("#btnAddTask").click(); } };

    // History
    $("#btnCloseHist").onclick = () => $("#historyDetail").classList.add("hidden");

    // Settings save
    $("#btnSaveSettings").onclick = async () => {
      const s = { ...DEFAULT_SETTINGS, ...(App.state.settings||{}) };
      s.defaultWake = $("#setWake").value || DEFAULT_SETTINGS.defaultWake;
      s.breakfastMin = Number($("#setBreakfast").value) || DEFAULT_SETTINGS.breakfastMin;
      s.lunchMin = Number($("#setLunch").value) || DEFAULT_SETTINGS.lunchMin;
      s.dinnerMin = Number($("#setDinner").value) || DEFAULT_SETTINGS.dinnerMin;
      s.napRoutineMin = Number($("#setNapRoutine").value) || DEFAULT_SETTINGS.napRoutineMin;
      s.bedRoutineMin = Number($("#setBedRoutine").value) || DEFAULT_SETTINGS.bedRoutineMin;
      s.nap1ForecastMin = Number($("#setNap1").value) || DEFAULT_SETTINGS.nap1ForecastMin;
      s.nap2ForecastMin = Number($("#setNap2").value) || DEFAULT_SETTINGS.nap2ForecastMin;

      s.ww1Min = Number($("#ww1Min").value) || DEFAULT_SETTINGS.ww1Min;
      s.ww1Max = Number($("#ww1Max").value) || DEFAULT_SETTINGS.ww1Max;
      s.ww2Min = Number($("#ww2Min").value) || DEFAULT_SETTINGS.ww2Min;
      s.ww2Max = Number($("#ww2Max").value) || DEFAULT_SETTINGS.ww2Max;
      s.ww3Min = Number($("#ww3Min").value) || DEFAULT_SETTINGS.ww3Min;
      s.ww3Max = Number($("#ww3Max").value) || DEFAULT_SETTINGS.ww3Max;

      s.gcal = { scriptUrl: $("#gcalUrl").value.trim(), calendarId: $("#gcalCalId").value.trim(), apiKey: $("#gcalKey").value.trim() };

      await saveSettings(s);
      renderSettings();
    };

    // Export
    $("#btnExport").onclick = exportToday;
  }

  // ---------- Boot ----------
  function setHeader(){
    const todayISO = dateToISO(new Date());
    $("#headerSub").textContent = `Today: ${isoToShort(todayISO)}`;
  }

  async function postUnlockBoot(){
    // Settings + shared data
    await loadSettings();
    await loadTasks();
    renderTasks();
    renderSettings();

    // preload today/tomorrow
    await Promise.all([
      loadPlan(dateToISO(new Date())),
      loadLog(dateToISO(new Date())),
      loadPlan(dateToISO(addDays(new Date(),1)))
    ]);

    await loadAndRenderTomorrow();
    await loadAndRenderToday();
    showTab("Evening");
  }

  async function boot(){
    try{
      initSupabase();
      wire();
      setHeader();

      if ("serviceWorker" in navigator){
        navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
      }

      // Gate
      setGateUnlocked(isGateUnlocked());
      if (!App.state.gate.unlocked){
        const status = $("#gateStatus");
        if (status) status.textContent = "Enter the password to continue.";
        showGate(true);
        return;
      }

      showGate(false);
      await postUnlockBoot();
    }catch(err){
      console.error(err);
      toast("App failed to start. Check console.");
    }
  }
        
function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
