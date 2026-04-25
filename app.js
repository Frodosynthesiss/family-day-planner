// Vega-Payne Command Center — Alignment Planner
// Rewritten to focus on spousal alignment rather than adaptive baby scheduling.

// ============================================================================
// Firebase Configuration
// ============================================================================
const firebaseConfig = {
    apiKey: "AIzaSyA2YSjOktRbinbKMjIy1pbd_Bkbwp3ruRY",
    authDomain: "vega-payne-command-center.firebaseapp.com",
    projectId: "vega-payne-command-center",
    storageBucket: "vega-payne-command-center.firebasestorage.app",
    messagingSenderId: "325061344708",
    appId: "1:325061344708:web:397bff2f1776308a997891",
    measurementId: "G-JHR2MYTHM1"
};

let auth, db, functions;
let currentUser = null;

const FAMILY_ID = 'default_family';
const COVERAGE_PEOPLE = ['kristyn', 'julio', 'nanny', 'kayden'];
const WORK_PEOPLE = ['kristyn', 'julio'];
const PERSON_LABEL = {
    kristyn: 'Kristyn',
    julio: 'Julio',
    nanny: 'Nanny',
    kayden: 'Kayden'
};

// ============================================================================
// Application State
// ============================================================================
const state = {
    user: null,
    settings: null,
    todayPlan: null,
    tomorrowPlan: null,
    tasks: [],
    meals: [],
    lists: [],
    intentions: [],
    pendingEvents: [],
    wizardStep: 1,
    wizardData: {},
    unsubscribers: []
};

// ============================================================================
// Utilities
// ============================================================================
const utils = {
    formatDate(date) {
        if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = date.split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
            });
        }
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
    },

    formatTime(time) {
        if (!time) return '';
        const [hours, minutes] = time.split(':');
        const h = parseInt(hours, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${displayHour}:${minutes} ${ampm}`;
    },

    // Convert "HH:MM" to minutes since midnight
    toMinutes(time) {
        if (!time) return null;
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    },

    // Check if two [start, end] time ranges overlap
    rangesOverlap(aStart, aEnd, bStart, bEnd) {
        const as = this.toMinutes(aStart);
        const ae = this.toMinutes(aEnd);
        const bs = this.toMinutes(bStart);
        const be = this.toMinutes(bEnd);
        if ([as, ae, bs, be].some(v => v === null)) return false;
        return as < be && bs < ae;
    },

    generateICS(events) {
        const formatICSDate = (date, time, allDay = false) => {
            const d = new Date(date + (time ? 'T' + time : ''));
            if (allDay) return d.toISOString().split('T')[0].replace(/-/g, '');
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
        };
        const uid = () => 'vega-payne-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vega-Payne Command Center//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
        events.forEach(event => {
            ics.push('BEGIN:VEVENT');
            ics.push(`UID:${uid()}`);
            ics.push(`DTSTAMP:${formatICSDate(new Date().toISOString().split('T')[0], new Date().toTimeString().slice(0, 5))}`);
            if (event.allDay) {
                ics.push(`DTSTART;VALUE=DATE:${formatICSDate(event.date, null, true)}`);
                const endDate = new Date(event.date);
                endDate.setDate(endDate.getDate() + 1);
                ics.push(`DTEND;VALUE=DATE:${formatICSDate(endDate.toISOString().split('T')[0], null, true)}`);
            } else {
                ics.push(`DTSTART:${formatICSDate(event.date, event.startTime)}`);
                ics.push(`DTEND:${formatICSDate(event.date, event.endTime || event.startTime)}`);
            }
            ics.push(`SUMMARY:${event.title.replace(/[,;\\]/g, '\\$&')}`);
            ics.push('END:VEVENT');
        });
        ics.push('END:VCALENDAR');
        return ics.join('\r\n');
    },

    downloadICS(events, filename = 'events.ics') {
        const blob = new Blob([this.generateICS(events)], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    getTodayString() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    getTomorrowString() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    daysBetween(aStr, bStr) {
        // Both are YYYY-MM-DD strings
        const [ay, am, ad] = aStr.split('-').map(Number);
        const [by, bm, bd] = bStr.split('-').map(Number);
        const a = new Date(ay, am - 1, ad);
        const b = new Date(by, bm - 1, bd);
        return Math.round((b - a) / (1000 * 60 * 60 * 24));
    },

    daysSince(dateStr) {
        if (!dateStr) return null;
        return this.daysBetween(dateStr, this.getTodayString());
    },

    relativeAge(dateStr) {
        const days = this.daysSince(dateStr);
        if (days === null) return '';
        if (days <= 0) return 'today';
        if (days === 1) return '1 day ago';
        if (days < 14) return `${days} days ago`;
        if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
        return `${Math.floor(days / 30)} months ago`;
    },

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    escapeHtml(str) {
        return (str || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
};

// ============================================================================
// Database Operations
// ============================================================================
const db_ops = {
    async getSettings() {
        try {
            const doc = await db.collection('families').doc(FAMILY_ID).get();
            if (doc.exists) {
                return { ...this.getDefaultSettings(), ...doc.data() };
            }
            return this.getDefaultSettings();
        } catch (e) {
            console.error('getSettings:', e);
            return this.getDefaultSettings();
        }
    },

    getDefaultSettings() {
        return {
            weeklyGoals: '',
            checklistItems: [
                { id: 'skylight', label: 'Skylight calendar up to date?' },
                { id: 'nanny', label: 'Nanny briefed on tomorrow?' },
                { id: 'kitchen', label: 'Kitchen reset for morning?' }
            ],
            googleCalendar: null
        };
    },

    async saveSettings(settings) {
        try {
            await db.collection('families').doc(FAMILY_ID).set({
                ...settings,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        } catch (e) {
            console.error('saveSettings:', e);
            utils.showToast('Failed to save settings', 'error');
            return false;
        }
    },

    async getDayPlan(date) {
        try {
            const doc = await db.collection('families').doc(FAMILY_ID).collection('day_plans').doc(date).get();
            return doc.exists ? doc.data() : null;
        } catch (e) {
            console.error('getDayPlan:', e);
            return null;
        }
    },

    async saveDayPlan(date, planData) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('day_plans').doc(date).set({
                ...planData,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        } catch (e) {
            console.error('saveDayPlan:', e);
            utils.showToast('Failed to save plan', 'error');
            return false;
        }
    },

    async deleteDayPlan(date) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('day_plans').doc(date).delete();
            return true;
        } catch (e) {
            console.error('deleteDayPlan:', e);
            return false;
        }
    },

    // Tasks
    async addTask(title, assignedDate = null, intentionId = null) {
        try {
            const payload = {
                title,
                status: 'open',
                assignedDate,
                intentionId,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                completedAt: null
            };
            const docRef = await db.collection('families').doc(FAMILY_ID).collection('tasks').add(payload);
            return docRef.id;
        } catch (e) {
            console.error('addTask:', e);
            utils.showToast('Failed to add task', 'error');
            return null;
        }
    },

    async updateTask(id, updates) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('tasks').doc(id).update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (e) {
            console.error('updateTask:', e);
            return false;
        }
    },

    async deleteTask(id) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('tasks').doc(id).delete();
            return true;
        } catch (e) {
            console.error('deleteTask:', e);
            return false;
        }
    },

    listenToTasks(cb) {
        return db.collection('families').doc(FAMILY_ID).collection('tasks')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
                err => console.error('listenToTasks:', err));
    },

    // Meals
    async addMeal(content) {
        try {
            const docRef = await db.collection('families').doc(FAMILY_ID).collection('meals').add({
                content,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return docRef.id;
        } catch (e) {
            console.error('addMeal:', e);
            utils.showToast('Failed to add meal', 'error');
            return null;
        }
    },

    async updateMeal(id, content) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('meals').doc(id).update({
                content, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (e) { console.error(e); return false; }
    },

    async deleteMeal(id) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('meals').doc(id).delete();
            return true;
        } catch (e) { console.error(e); return false; }
    },

    listenToMeals(cb) {
        return db.collection('families').doc(FAMILY_ID).collection('meals')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
                err => console.error('listenToMeals:', err));
    },

    // Lists
    async addListItem(category, content) {
        try {
            const docRef = await db.collection('families').doc(FAMILY_ID).collection('lists').add({
                category, content,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return docRef.id;
        } catch (e) {
            console.error('addListItem:', e);
            utils.showToast('Failed to add item', 'error');
            return null;
        }
    },

    async updateListItem(id, content) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('lists').doc(id).update({
                content, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (e) { console.error(e); return false; }
    },

    async deleteListItem(id) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('lists').doc(id).delete();
            return true;
        } catch (e) { console.error(e); return false; }
    },

    listenToLists(cb) {
        return db.collection('families').doc(FAMILY_ID).collection('lists')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
                err => console.error('listenToLists:', err));
    },

    // Intentions
    async addIntention(data) {
        try {
            const now = utils.getTodayString();
            const payload = {
                title: data.title,
                category: data.category || 'other',
                nextStep: data.nextStep || '',
                status: 'active',
                pausedReason: null,
                createdAtStr: now,
                lastProgressAtStr: now,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            const docRef = await db.collection('families').doc(FAMILY_ID).collection('intentions').add(payload);
            return docRef.id;
        } catch (e) {
            console.error('addIntention:', e);
            utils.showToast('Failed to add intention', 'error');
            return null;
        }
    },

    async updateIntention(id, updates) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('intentions').doc(id).update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (e) { console.error(e); return false; }
    },

    async deleteIntention(id) {
        try {
            await db.collection('families').doc(FAMILY_ID).collection('intentions').doc(id).delete();
            return true;
        } catch (e) { console.error(e); return false; }
    },

    listenToIntentions(cb) {
        return db.collection('families').doc(FAMILY_ID).collection('intentions')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
                err => console.error('listenToIntentions:', err));
    },

    // History (past plans)
    async getRecentPlans(limit = 30) {
        try {
            const snap = await db.collection('families').doc(FAMILY_ID).collection('day_plans')
                .orderBy(firebase.firestore.FieldPath.documentId(), 'desc')
                .limit(limit).get();
            return snap.docs.map(d => ({ date: d.id, ...d.data() }));
        } catch (e) {
            console.error('getRecentPlans:', e);
            return [];
        }
    }
};

// ============================================================================
// Coach — rules-based flagging (dry, factual, brisk)
// ============================================================================
const coach = {
    // Each function returns an array of {level: 'warn'|'info', text: string}

    workConflicts(workBlocks) {
        const flags = [];
        const k = workBlocks.kristyn || [];
        const j = workBlocks.julio || [];
        for (const kb of k) {
            for (const jb of j) {
                if (kb.start && kb.end && jb.start && jb.end &&
                    utils.rangesOverlap(kb.start, kb.end, jb.start, jb.end)) {
                    flags.push({
                        level: 'warn',
                        text: `Both in work mode ${utils.formatTime(kb.start)}–${utils.formatTime(kb.end)} overlaps ${utils.formatTime(jb.start)}–${utils.formatTime(jb.end)}. Who's got Kayden?`
                    });
                }
            }
        }
        return flags;
    },

    coverageGaps(coverage, appointments) {
        const flags = [];
        // Build union of covered ranges (any person)
        const blocks = [];
        for (const p of COVERAGE_PEOPLE) {
            for (const b of (coverage[p] || [])) {
                if (b.start && b.end) {
                    blocks.push({ start: utils.toMinutes(b.start), end: utils.toMinutes(b.end) });
                }
            }
        }
        if (blocks.length === 0) {
            flags.push({ level: 'warn', text: 'No coverage blocks set yet.' });
            return flags;
        }
        // Sort + merge
        blocks.sort((a, b) => a.start - b.start);
        const merged = [blocks[0]];
        for (let i = 1; i < blocks.length; i++) {
            const last = merged[merged.length - 1];
            if (blocks[i].start <= last.end) {
                last.end = Math.max(last.end, blocks[i].end);
            } else {
                merged.push(blocks[i]);
            }
        }
        // Find gaps within the overall covered window
        const dayStart = merged[0].start;
        const dayEnd = merged[merged.length - 1].end;
        for (let i = 1; i < merged.length; i++) {
            const gapStart = merged[i - 1].end;
            const gapEnd = merged[i].start;
            if (gapEnd - gapStart >= 15) {
                flags.push({
                    level: 'warn',
                    text: `Uncovered: ${coach._fmtMins(gapStart)}–${coach._fmtMins(gapEnd)}. Who's got it?`
                });
            }
        }
        // Appointments with no coverage
        for (const apt of (appointments || [])) {
            if (!apt.title || !apt.startTime) continue;
            const aStart = utils.toMinutes(apt.startTime);
            const aEnd = apt.endTime ? utils.toMinutes(apt.endTime) : aStart + 30;
            const covered = merged.some(b => b.start <= aStart && b.end >= aEnd);
            if (!covered) {
                flags.push({
                    level: 'warn',
                    text: `Appointment "${apt.title}" at ${utils.formatTime(apt.startTime)} isn't inside a coverage block.`
                });
            }
        }
        return flags;
    },

    appointmentConflicts(appointments, workBlocks) {
        const flags = [];
        for (const apt of (appointments || [])) {
            if (!apt.title || !apt.startTime) continue;
            const aEnd = apt.endTime || apt.startTime;
            for (const person of WORK_PEOPLE) {
                for (const wb of (workBlocks[person] || [])) {
                    if (wb.start && wb.end && utils.rangesOverlap(apt.startTime, aEnd, wb.start, wb.end)) {
                        flags.push({
                            level: 'warn',
                            text: `"${apt.title}" at ${utils.formatTime(apt.startTime)} hits ${PERSON_LABEL[person]}'s work block.`
                        });
                    }
                }
            }
        }
        return flags;
    },

    // Task review: stale rollovers
    staleTaskFlags(taskAges) {
        // taskAges: array of {title, daysOld}
        const stale = taskAges.filter(t => t.daysOld >= 3);
        if (stale.length === 0) return [];
        return stale.map(t => ({
            level: 'info',
            text: `"${t.title}" has been on the list ${t.daysOld} days. Still worth doing?`
        }));
    },

    tooManyFocusTasks(selected) {
        if (selected.length > 3) {
            return [{
                level: 'warn',
                text: `You picked ${selected.length}. 3 is the ceiling — typically 1-2 of them slip when you pick more.`
            }];
        }
        return [];
    },

    // Stale intentions: no progress in 14+ days
    staleIntentions(intentions) {
        const active = (intentions || []).filter(i => i.status === 'active');
        const stale = active.filter(i => {
            const days = utils.daysSince(i.lastProgressAtStr);
            return days !== null && days >= 14;
        });
        return stale;
    },

    _fmtMins(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const pad = n => String(n).padStart(2, '0');
        return utils.formatTime(`${pad(h)}:${pad(m)}`);
    }
};

// ============================================================================
// Google Calendar (unchanged except export builds from new plan shape)
// ============================================================================
const googleCalendar = {
    async requestAccess() {
        try {
            const requestAccess = functions.httpsCallable('requestCalendarAccess');
            const result = await requestAccess({ familyId: FAMILY_ID });
            if (result.data.authUrl) window.location.href = result.data.authUrl;
        } catch (e) {
            console.error('requestAccess:', e);
            utils.showToast('Failed to connect Google Calendar', 'error');
        }
    },

    async disconnect() {
        try {
            const disconnect = functions.httpsCallable('disconnectCalendar');
            await disconnect({ familyId: FAMILY_ID });
            state.settings.googleCalendar = null;
            await db_ops.saveSettings(state.settings);
            renderSettings();
            utils.showToast('Google Calendar disconnected', 'success');
        } catch (e) {
            console.error('disconnect:', e);
            utils.showToast('Failed to disconnect', 'error');
        }
    },

    async exportPlan(date, plan) {
        try {
            if (!state.settings?.googleCalendar?.connected) {
                utils.showToast('Please connect Google Calendar first', 'warning');
                return;
            }
            const events = [];
            // Work blocks
            for (const person of WORK_PEOPLE) {
                for (const b of (plan.workBlocks?.[person] || [])) {
                    if (b.start && b.end) {
                        events.push({
                            summary: `${PERSON_LABEL[person]} — work${b.label ? ': ' + b.label : ''}`,
                            description: b.label || '',
                            start: { dateTime: `${date}T${b.start}:00` },
                            end: { dateTime: `${date}T${b.end}:00` }
                        });
                    }
                }
            }
            // Coverage
            for (const person of COVERAGE_PEOPLE) {
                for (const b of (plan.coverage?.[person] || [])) {
                    if (b.start && b.end) {
                        events.push({
                            summary: `${PERSON_LABEL[person]} covers Kayden${b.label ? ' — ' + b.label : ''}`,
                            description: b.label || '',
                            start: { dateTime: `${date}T${b.start}:00` },
                            end: { dateTime: `${date}T${b.end}:00` }
                        });
                    }
                }
            }
            // Appointments
            for (const apt of (plan.appointments || [])) {
                if (apt.title && apt.startTime) {
                    events.push({
                        summary: apt.title,
                        description: apt.notes || '',
                        start: { dateTime: `${date}T${apt.startTime}:00` },
                        end: { dateTime: `${date}T${apt.endTime || apt.startTime}:00` }
                    });
                }
            }

            const exportEvents = functions.httpsCallable('exportToCalendar');
            const result = await exportEvents({ familyId: FAMILY_ID, date, events });
            if (result.data.success) utils.showToast('Exported to Google Calendar', 'success');
        } catch (e) {
            console.error('exportPlan:', e);
            utils.showToast('Failed to export to calendar', 'error');
        }
    }
};

// ============================================================================
// UI — rendering
// ============================================================================
const ui = {
    renderTasks(tasks) {
        const todayStr = utils.getTodayString();
        const todayTasks = tasks.filter(t => t.status === 'open' && t.assignedDate === todayStr);
        const brainDump = tasks.filter(t => t.status === 'open' && !t.assignedDate);
        const done = tasks.filter(t => t.status === 'done');

        const renderList = (list, containerId) => {
            const el = document.getElementById(containerId);
            if (!el) return;
            if (list.length === 0) {
                el.innerHTML = `<div class="empty-state-text">No tasks</div>`;
                return;
            }
            el.innerHTML = list.map(task => {
                const intention = task.intentionId ? state.intentions.find(i => i.id === task.intentionId) : null;
                return `
                <div class="task-item ${task.status === 'done' ? 'completed' : ''}">
                    <input type="checkbox" class="task-checkbox"
                           data-id="${task.id}" ${task.status === 'done' ? 'checked' : ''}>
                    <div class="task-text-wrap">
                        <span class="task-text">${utils.escapeHtml(task.title)}</span>
                        ${intention ? `<span class="intention-tag" title="Long-game: ${utils.escapeHtml(intention.title)}">long-game</span>` : ''}
                    </div>
                    <button class="task-delete" data-id="${task.id}">×</button>
                </div>`;
            }).join('');
        };

        renderList(todayTasks, 'todayTasks');
        renderList(brainDump, 'brainDumpTasks');
        renderList(done, 'completedTasks');
    },

    renderMeals(meals) {
        const container = document.getElementById('mealsList');
        if (!container) return;
        if (meals.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🍽️</div>
                    <div class="empty-state-text">No meals planned yet</div>
                </div>`;
            return;
        }
        container.innerHTML = meals.map(meal => `
            <div class="meal-card" data-id="${meal.id}">
                <div class="meal-content" id="meal-content-${meal.id}">${utils.escapeHtml(meal.content)}</div>
                <div class="meal-actions">
                    <button class="meal-edit-btn" data-id="${meal.id}">✎</button>
                    <button class="meal-delete-btn" data-id="${meal.id}">×</button>
                </div>
                <div class="meal-edit-form" id="meal-edit-${meal.id}" style="display: none;">
                    <textarea class="meal-textarea" rows="3">${utils.escapeHtml(meal.content)}</textarea>
                    <div class="meal-edit-actions">
                        <button class="secondary-btn meal-cancel-btn" data-id="${meal.id}">Cancel</button>
                        <button class="primary-btn meal-save-btn" data-id="${meal.id}">Save</button>
                    </div>
                </div>
            </div>`).join('');
    },

    renderLists(items) {
        const categories = ['groceries', 'shopping', 'notes', 'links'];
        categories.forEach(category => {
            const container = document.getElementById(`${category}List`);
            if (!container) return;
            const categoryItems = items.filter(i => i.category === category);
            if (categoryItems.length === 0) {
                container.innerHTML = `<div class="empty-state-text">No items yet</div>`;
                return;
            }
            container.innerHTML = categoryItems.map(item => `
                <div class="list-item-card" data-id="${item.id}">
                    <div class="list-item-content" id="list-content-${item.id}">${this.linkifyText(item.content)}</div>
                    <div class="list-item-actions">
                        <button class="list-edit-btn" data-id="${item.id}" data-category="${category}">✎</button>
                        <button class="list-delete-btn" data-id="${item.id}">×</button>
                    </div>
                    <div class="list-edit-form" id="list-edit-${item.id}" style="display: none;">
                        <textarea class="list-textarea" rows="2">${utils.escapeHtml(item.content)}</textarea>
                        <div class="list-input-actions">
                            <button class="secondary-btn list-cancel-edit-btn" data-id="${item.id}">Cancel</button>
                            <button class="primary-btn list-save-edit-btn" data-id="${item.id}">Save</button>
                        </div>
                    </div>
                </div>`).join('');
        });
    },

    linkifyText(text) {
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        const escaped = utils.escapeHtml(text);
        return escaped.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    },

    renderIntentions(intentions) {
        const active = intentions.filter(i => i.status === 'active');
        const paused = intentions.filter(i => i.status === 'paused');
        const archived = intentions.filter(i => i.status === 'done' || i.status === 'dropped');

        const render = (list, containerId, emptyText) => {
            const el = document.getElementById(containerId);
            if (!el) return;
            if (list.length === 0) {
                el.innerHTML = `<div class="empty-state-text">${emptyText}</div>`;
                return;
            }
            el.innerHTML = list.map(i => this._intentionCard(i)).join('');
        };

        render(active, 'activeIntentionsList', 'No active intentions yet.');
        render(paused, 'pausedIntentionsList', 'None paused.');
        render(archived, 'archivedIntentionsList', 'None yet.');
    },

    _intentionCard(i) {
        const ageStr = i.createdAtStr ? utils.relativeAge(i.createdAtStr) : '';
        const movedStr = i.lastProgressAtStr ? utils.relativeAge(i.lastProgressAtStr) : '';
        const daysSinceProgress = utils.daysSince(i.lastProgressAtStr);
        const isStale = daysSinceProgress !== null && daysSinceProgress >= 14 && i.status === 'active';

        const categoryLabel = {
            family: 'Family', community: 'Community', health: 'Health',
            home: 'Home', us: 'Us', other: 'Other'
        }[i.category || 'other'] || 'Other';

        const statusActions = i.status === 'active' ? `
            <button class="intention-action-btn" data-action="promote" data-id="${i.id}">Promote next step</button>
            <button class="intention-action-btn" data-action="progress" data-id="${i.id}">Mark progress</button>
            <button class="intention-action-btn" data-action="pause" data-id="${i.id}">Pause</button>
            <button class="intention-action-btn" data-action="done" data-id="${i.id}">Done</button>
            <button class="intention-action-btn danger" data-action="drop" data-id="${i.id}">Drop</button>
        ` : i.status === 'paused' ? `
            <button class="intention-action-btn" data-action="resume" data-id="${i.id}">Resume</button>
            <button class="intention-action-btn danger" data-action="drop" data-id="${i.id}">Drop</button>
        ` : `
            <button class="intention-action-btn" data-action="resume" data-id="${i.id}">Reactivate</button>
            <button class="intention-action-btn danger" data-action="delete" data-id="${i.id}">Delete</button>
        `;

        return `
            <div class="intention-card ${isStale ? 'stale' : ''}" data-id="${i.id}">
                <div class="intention-card-header">
                    <span class="intention-category">${categoryLabel}</span>
                    <span class="intention-age">${ageStr ? 'added ' + ageStr : ''}</span>
                </div>
                <div class="intention-title">${utils.escapeHtml(i.title)}</div>
                <div class="intention-next-step-row">
                    <label>Next step:</label>
                    <div class="intention-next-step-edit">
                        <input type="text" class="intention-next-step-input" data-id="${i.id}"
                               value="${utils.escapeHtml(i.nextStep || '')}"
                               placeholder="What's the smallest thing that moves this forward?">
                        <button class="intention-next-step-save" data-id="${i.id}">Save</button>
                    </div>
                </div>
                ${movedStr && i.status === 'active' ? `<div class="intention-progress-line ${isStale ? 'stale' : ''}">Last moved ${movedStr}${isStale ? ' — stalled' : ''}</div>` : ''}
                ${i.status === 'paused' && i.pausedReason ? `<div class="intention-progress-line">Paused: ${utils.escapeHtml(i.pausedReason)}</div>` : ''}
                <div class="intention-actions">
                    ${statusActions}
                </div>
            </div>`;
    },

    async renderHistory() {
        const plans = await db_ops.getRecentPlans(30);
        const container = document.getElementById('historyList');
        if (!container) return;
        if (plans.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📖</div>
                    <div class="empty-state-text">No past alignments yet</div>
                </div>`;
            return;
        }

        container.innerHTML = plans.map(plan => {
            const appts = (plan.appointments || []).filter(a => a.title);
            const focusCount = (plan.focusTaskIds || []).length;
            const summaryBits = [];
            if (plan.checkIn) {
                const label = { better: 'Better', expected: 'As expected', worse: 'Worse' }[plan.checkIn] || '';
                if (label) summaryBits.push(label);
            }
            if (focusCount) summaryBits.push(`${focusCount} focus task${focusCount === 1 ? '' : 's'}`);
            if (appts.length) summaryBits.push(`${appts.length} appt${appts.length === 1 ? '' : 's'}`);

            return `
                <div class="history-item" data-date="${plan.date}">
                    <div class="history-header">
                        <div class="history-date">${utils.formatDate(plan.date)}</div>
                        <div class="history-summary">${summaryBits.join(' • ') || 'Plan recorded'}</div>
                        <svg class="history-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </div>
                    <div class="history-details">
                        ${this._historyDetailsHTML(plan)}
                    </div>
                </div>`;
        }).join('');
    },

    _historyDetailsHTML(plan) {
        const parts = [];
        if (plan.checkInNote) {
            parts.push(`<div class="history-detail-row"><strong>Check-in note:</strong> ${utils.escapeHtml(plan.checkInNote)}</div>`);
        }
        if (plan.weeklyGoals) {
            parts.push(`<div class="history-detail-row"><strong>Weekly goals:</strong><br>${utils.escapeHtml(plan.weeklyGoals).replace(/\n/g, '<br>')}</div>`);
        }
        // Work blocks
        const workBits = [];
        for (const p of WORK_PEOPLE) {
            for (const b of (plan.workBlocks?.[p] || [])) {
                if (b.start && b.end) workBits.push(`${PERSON_LABEL[p]} work ${utils.formatTime(b.start)}–${utils.formatTime(b.end)}${b.label ? ' (' + utils.escapeHtml(b.label) + ')' : ''}`);
            }
        }
        if (workBits.length) parts.push(`<div class="history-detail-row"><strong>Work:</strong><br>${workBits.join('<br>')}</div>`);

        // Coverage
        const coverBits = [];
        for (const p of COVERAGE_PEOPLE) {
            for (const b of (plan.coverage?.[p] || [])) {
                if (b.start && b.end) coverBits.push(`${PERSON_LABEL[p]} ${utils.formatTime(b.start)}–${utils.formatTime(b.end)}`);
            }
        }
        if (coverBits.length) parts.push(`<div class="history-detail-row"><strong>Coverage:</strong><br>${coverBits.join('<br>')}</div>`);

        // Appointments
        const apts = (plan.appointments || []).filter(a => a.title);
        if (apts.length) {
            parts.push(`<div class="history-detail-row"><strong>Appointments:</strong><br>${apts.map(a => `${utils.formatTime(a.startTime)} — ${utils.escapeHtml(a.title)}`).join('<br>')}</div>`);
        }

        // Asks
        if (plan.asks?.kristyn) parts.push(`<div class="history-detail-row"><strong>Kristyn asked:</strong> ${utils.escapeHtml(plan.asks.kristyn)}</div>`);
        if (plan.asks?.julio) parts.push(`<div class="history-detail-row"><strong>Julio asked:</strong> ${utils.escapeHtml(plan.asks.julio)}</div>`);

        if (parts.length === 0) return `<div class="history-detail-row">No details recorded</div>`;
        return parts.join('');
    }
};

function renderSettings() {
    // Weekly goals
    const wgInput = document.getElementById('weeklyGoalsInput');
    if (wgInput) wgInput.value = state.settings?.weeklyGoals || '';

    // Checklist editor
    const editor = document.getElementById('checklistEditor');
    if (editor) {
        const items = state.settings?.checklistItems || [];
        if (items.length === 0) {
            editor.innerHTML = `<div class="empty-state-text">No items yet. Add one below.</div>`;
        } else {
            editor.innerHTML = items.map(it => `
                <div class="checklist-editor-row" data-id="${it.id}">
                    <input type="text" class="task-input checklist-editor-input" data-id="${it.id}" value="${utils.escapeHtml(it.label)}">
                    <button class="icon-btn checklist-editor-delete" data-id="${it.id}" aria-label="Delete">×</button>
                </div>`).join('');
        }
    }

    // Calendar status
    const statusDiv = document.getElementById('calendarStatus');
    const connectBtn = document.getElementById('connectCalendarBtn');
    const disconnectBtn = document.getElementById('disconnectCalendarBtn');
    if (statusDiv && connectBtn && disconnectBtn) {
        if (state.settings?.googleCalendar?.connected) {
            statusDiv.textContent = '✓ Connected';
            statusDiv.className = 'status-badge connected';
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'block';
        } else {
            statusDiv.textContent = 'Not connected';
            statusDiv.className = 'status-badge';
            connectBtn.style.display = 'block';
            disconnectBtn.style.display = 'none';
        }
    }
}

// ============================================================================
// Wizard — 9 steps
// ============================================================================
const wizard = {
    totalSteps: 9,

    emptyData() {
        return {
            checkIn: null,
            checkInNote: '',
            checklistResponses: {}, // id -> true/false
            workBlocks: { kristyn: [], julio: [] },
            coverage: { kristyn: [], julio: [], nanny: [], kayden: [] },
            appointments: [],
            taskReview: {}, // taskId -> 'done'|'rolled'|'drop'
            brainDumpText: '',
            selectedTaskIds: [], // open tasks chosen for tomorrow
            newTasksFromBrainDump: [],
            promotedIntentions: [], // {intentionId, title} — promoted next-steps
            weeklyGoals: '',
            asks: { kristyn: '', julio: '' }
        };
    },

    async open() {
        state.wizardStep = 1;
        state.wizardData = this.emptyData();

        // Prefill from settings
        state.wizardData.weeklyGoals = state.settings?.weeklyGoals || '';

        // If we're re-opening a plan that exists, load its data (editing mode)
        const tomorrow = utils.getTomorrowString();
        const existing = await db_ops.getDayPlan(tomorrow);
        if (existing) {
            Object.assign(state.wizardData, {
                checkIn: existing.checkIn || null,
                checkInNote: existing.checkInNote || '',
                checklistResponses: existing.checklistResponses || {},
                workBlocks: existing.workBlocks || { kristyn: [], julio: [] },
                coverage: existing.coverage || { kristyn: [], julio: [], nanny: [], kayden: [] },
                appointments: existing.appointments || [],
                weeklyGoals: existing.weeklyGoals || state.wizardData.weeklyGoals,
                asks: existing.asks || { kristyn: '', julio: '' }
            });
        }

        document.getElementById('wizardModal').classList.add('active');
        this.showStep(1);
        this.renderStep1();
    },

    close() {
        document.getElementById('wizardModal').classList.remove('active');
    },

    showStep(n) {
        state.wizardStep = n;
        for (let i = 1; i <= this.totalSteps; i++) {
            const el = document.getElementById(`step${i}`);
            if (el) el.style.display = (i === n) ? 'block' : 'none';
        }
        const pct = (n / this.totalSteps) * 100;
        document.getElementById('wizardProgress').style.width = `${pct}%`;
        document.getElementById('wizardProgressText').textContent = `Step ${n} of ${this.totalSteps}`;
        // Scroll modal body to top
        const body = document.querySelector('#wizardModal .modal-body');
        if (body) body.scrollTop = 0;
    },

    // Step navigation
    next() {
        const step = state.wizardStep;
        // Collect data from current step before moving on
        if (step === 1) this.collectStep1();
        else if (step === 2) this.collectStep2();
        else if (step === 3) this.collectStep3();
        else if (step === 4) this.collectStep4();
        else if (step === 5) this.collectStep5();
        else if (step === 6) this.collectStep6();
        else if (step === 7) this.collectStep7();
        else if (step === 8) this.collectStep8();

        if (step < this.totalSteps) {
            this.showStep(step + 1);
            this.renderStep(step + 1);
        }
    },

    back() {
        const step = state.wizardStep;
        if (step > 1) {
            // Collect current step data so user can return
            if (step === 2) this.collectStep2();
            else if (step === 3) this.collectStep3();
            else if (step === 4) this.collectStep4();
            else if (step === 5) this.collectStep5();
            else if (step === 6) this.collectStep6();
            else if (step === 7) this.collectStep7();
            else if (step === 8) this.collectStep8();

            this.showStep(step - 1);
            this.renderStep(step - 1);
        }
    },

    renderStep(n) {
        const fn = this[`renderStep${n}`];
        if (fn) fn.call(this);
    },

    // --------------- Step 1: Check-in + checklist ---------------
    renderStep1() {
        // Check-in selection
        document.querySelectorAll('.check-in-btn').forEach(btn => {
            btn.classList.toggle('selected', state.wizardData.checkIn === btn.dataset.value);
        });
        document.getElementById('checkInNote').value = state.wizardData.checkInNote || '';

        // Checklist
        const container = document.getElementById('eveningChecklistItems');
        const items = state.settings?.checklistItems || [];
        if (items.length === 0) {
            container.innerHTML = `<div class="empty-state-text">No checklist items. Add some in Settings.</div>`;
        } else {
            container.innerHTML = items.map(it => {
                const checked = state.wizardData.checklistResponses[it.id] ? 'checked' : '';
                return `
                    <label class="checklist-row">
                        <input type="checkbox" class="checklist-checkbox" data-id="${it.id}" ${checked}>
                        <span>${utils.escapeHtml(it.label)}</span>
                    </label>`;
            }).join('');
        }
    },

    collectStep1() {
        state.wizardData.checkInNote = document.getElementById('checkInNote').value.trim();
        const responses = {};
        document.querySelectorAll('#eveningChecklistItems .checklist-checkbox').forEach(cb => {
            responses[cb.dataset.id] = cb.checked;
        });
        state.wizardData.checklistResponses = responses;
    },

    // --------------- Step 2: Work blocks ---------------
    renderStep2() {
        WORK_PEOPLE.forEach(p => this._renderBlockList('work', p, state.wizardData.workBlocks[p]));
        this._renderFlags('workFlags', coach.workConflicts(state.wizardData.workBlocks));
    },

    collectStep2() {
        WORK_PEOPLE.forEach(p => this._collectBlockList('work', p));
    },

    // --------------- Step 3: Coverage ---------------
    renderStep3() {
        COVERAGE_PEOPLE.forEach(p => this._renderBlockList('cover', p, state.wizardData.coverage[p]));
        this._renderFlags('coverageFlags', coach.coverageGaps(state.wizardData.coverage, state.wizardData.appointments));
    },

    collectStep3() {
        COVERAGE_PEOPLE.forEach(p => this._collectBlockList('cover', p));
    },

    // Shared time-block renderer
    _renderBlockList(kind, person, blocks) {
        const idMap = {
            work: { kristyn: 'kristynWorkList', julio: 'julioWorkList' },
            cover: { kristyn: 'kristynCoverList', julio: 'julioCoverList', nanny: 'nannyCoverList', kayden: 'kaydenCoverList' }
        };
        const container = document.getElementById(idMap[kind][person]);
        if (!container) return;
        if (!blocks || blocks.length === 0) {
            container.innerHTML = `<div class="empty-state-text small">No blocks yet.</div>`;
            return;
        }
        container.innerHTML = blocks.map((b, i) => `
            <div class="time-block-row" data-kind="${kind}" data-person="${person}" data-idx="${i}">
                <input type="time" class="time-input block-start" value="${b.start || ''}" data-field="start">
                <span class="time-dash">–</span>
                <input type="time" class="time-input block-end" value="${b.end || ''}" data-field="end">
                <input type="text" class="time-label-input" placeholder="Label (optional)" value="${utils.escapeHtml(b.label || '')}" data-field="label">
                <button class="block-remove" data-kind="${kind}" data-person="${person}" data-idx="${i}">×</button>
            </div>`).join('');
    },

    _collectBlockList(kind, person) {
        const target = kind === 'work' ? state.wizardData.workBlocks[person] : state.wizardData.coverage[person];
        const idMap = {
            work: { kristyn: 'kristynWorkList', julio: 'julioWorkList' },
            cover: { kristyn: 'kristynCoverList', julio: 'julioCoverList', nanny: 'nannyCoverList', kayden: 'kaydenCoverList' }
        };
        const container = document.getElementById(idMap[kind][person]);
        if (!container) return;
        const rows = container.querySelectorAll('.time-block-row');
        const newBlocks = [];
        rows.forEach((row, idx) => {
            if (idx >= target.length) target.push({});
            target[idx].start = row.querySelector('[data-field="start"]').value;
            target[idx].end = row.querySelector('[data-field="end"]').value;
            target[idx].label = row.querySelector('[data-field="label"]').value.trim();
            newBlocks.push(target[idx]);
        });
        if (kind === 'work') state.wizardData.workBlocks[person] = newBlocks;
        else state.wizardData.coverage[person] = newBlocks;
    },

    addBlock(kind, person) {
        // Sync any in-progress edits before re-render
        this._collectBlockList(kind, person);
        if (kind === 'work') {
            state.wizardData.workBlocks[person].push({ start: '', end: '', label: '' });
        } else {
            state.wizardData.coverage[person].push({ start: '', end: '', label: '' });
        }
        this.renderStep(state.wizardStep);
    },

    removeBlock(kind, person, idx) {
        // Sync current DOM values before mutation
        this._collectBlockList(kind, person);
        if (kind === 'work') state.wizardData.workBlocks[person].splice(idx, 1);
        else state.wizardData.coverage[person].splice(idx, 1);
        this.renderStep(state.wizardStep);
    },

    // --------------- Step 4: Appointments ---------------
    renderStep4() {
        const container = document.getElementById('appointmentsList');
        if (!container) return;
        const apts = state.wizardData.appointments;
        if (apts.length === 0) {
            container.innerHTML = `<div class="empty-state-text small">None yet.</div>`;
        } else {
            container.innerHTML = apts.map((a, i) => `
                <div class="appointment-row" data-idx="${i}">
                    <input type="text" class="apt-title-input" placeholder="Title" value="${utils.escapeHtml(a.title || '')}" data-field="title">
                    <div class="apt-time-row">
                        <input type="time" class="time-input" value="${a.startTime || ''}" data-field="startTime">
                        <span class="time-dash">–</span>
                        <input type="time" class="time-input" value="${a.endTime || ''}" data-field="endTime">
                    </div>
                    <input type="text" class="apt-notes-input" placeholder="Who goes / notes" value="${utils.escapeHtml(a.notes || '')}" data-field="notes">
                    <button class="block-remove" data-remove-apt="${i}">×</button>
                </div>`).join('');
        }
        this._renderFlags('appointmentFlags', [
            ...coach.appointmentConflicts(apts, state.wizardData.workBlocks),
            ...coach.coverageGaps(state.wizardData.coverage, apts).filter(f => f.text.includes('Appointment'))
        ]);
    },

    collectStep4() {
        const container = document.getElementById('appointmentsList');
        if (!container) return;
        const rows = container.querySelectorAll('.appointment-row');
        const apts = [];
        rows.forEach(row => {
            apts.push({
                title: row.querySelector('[data-field="title"]').value.trim(),
                startTime: row.querySelector('[data-field="startTime"]').value,
                endTime: row.querySelector('[data-field="endTime"]').value,
                notes: row.querySelector('[data-field="notes"]').value.trim()
            });
        });
        state.wizardData.appointments = apts;
    },

    addAppointment() {
        this.collectStep4();
        state.wizardData.appointments.push({ title: '', startTime: '', endTime: '', notes: '' });
        this.renderStep4();
    },

    removeAppointment(idx) {
        this.collectStep4();
        state.wizardData.appointments.splice(idx, 1);
        this.renderStep4();
    },

    // --------------- Step 5: Today's task review ---------------
    renderStep5() {
        const container = document.getElementById('todayTaskReview');
        if (!container) return;
        const todayStr = utils.getTodayString();
        const candidates = state.tasks.filter(t =>
            (t.status === 'open' && t.assignedDate === todayStr) ||
            (t.status === 'done' && t.assignedDate === todayStr)
        );
        if (candidates.length === 0) {
            container.innerHTML = `<div class="empty-state-text small">No tasks were scheduled for today.</div>`;
            this._renderFlags('taskReviewFlags', []);
            return;
        }

        container.innerHTML = candidates.map(t => {
            const existing = state.wizardData.taskReview[t.id] ||
                (t.status === 'done' ? 'done' : 'rolled');
            const daysOld = t.createdAtStr ? utils.daysSince(t.createdAtStr) : 0;
            return `
                <div class="task-review-row" data-id="${t.id}">
                    <div class="task-review-title">${utils.escapeHtml(t.title)}</div>
                    <div class="task-review-buttons">
                        <button class="task-review-btn ${existing === 'done' ? 'selected' : ''}" data-review="done" data-id="${t.id}">Done</button>
                        <button class="task-review-btn ${existing === 'rolled' ? 'selected' : ''}" data-review="rolled" data-id="${t.id}">Roll over</button>
                        <button class="task-review-btn ${existing === 'drop' ? 'selected' : ''}" data-review="drop" data-id="${t.id}">Drop</button>
                    </div>
                </div>`;
        }).join('');

        // Compute rollover ages for flags
        const ages = candidates.map(t => {
            const daysOld = t.createdAtStr ? utils.daysSince(t.createdAtStr) : 0;
            return { title: t.title, daysOld: daysOld || 0 };
        });
        this._renderFlags('taskReviewFlags', coach.staleTaskFlags(ages));
    },

    collectStep5() {
        // Collected inline by click handler
    },

    // --------------- Step 6: Brain dump ---------------
    renderStep6() {
        document.getElementById('brainDumpText').value = state.wizardData.brainDumpText || '';
    },

    collectStep6() {
        state.wizardData.brainDumpText = document.getElementById('brainDumpText').value;
    },

    // --------------- Step 7: Focus + stale intentions ---------------
    renderStep7() {
        // Stale intentions surfacing
        const stale = coach.staleIntentions(state.intentions);
        const block = document.getElementById('staleIntentionsBlock');
        const staleList = document.getElementById('staleIntentionsList');
        if (stale.length > 0) {
            block.style.display = 'block';
            staleList.innerHTML = stale.map(i => {
                const promoted = state.wizardData.promotedIntentions.some(p => p.intentionId === i.id);
                const movedStr = i.lastProgressAtStr ? utils.relativeAge(i.lastProgressAtStr) : '';
                return `
                    <div class="stale-intention-item ${promoted ? 'promoted' : ''}" data-id="${i.id}">
                        <div>
                            <div class="stale-intention-title">${utils.escapeHtml(i.title)}</div>
                            <div class="stale-intention-next">Next step: ${i.nextStep ? utils.escapeHtml(i.nextStep) : '<em>(none defined — edit in Long-game tab)</em>'}</div>
                            <div class="stale-intention-meta">Last moved ${movedStr || 'never'}</div>
                        </div>
                        <button class="promote-intention-btn" data-id="${i.id}" ${!i.nextStep ? 'disabled' : ''}>
                            ${promoted ? '✓ Promoted' : 'Promote to tomorrow'}
                        </button>
                    </div>`;
            }).join('');
        } else {
            block.style.display = 'none';
        }

        // Candidate pool: open tasks (today + brain dump) + brain dump text lines + already-selected
        const container = document.getElementById('taskSelectionList');
        if (!container) return;

        const brainDumpLines = (state.wizardData.brainDumpText || '')
            .split('\n').map(s => s.trim()).filter(Boolean);
        // Promoted intentions appear at the top
        const promoted = state.wizardData.promotedIntentions;

        const openTasks = state.tasks.filter(t => t.status === 'open');
        // Only surface uncompleted tasks + the brain-dump-derived lines
        const candidates = [
            ...promoted.map(p => ({ kind: 'intention', id: p.intentionId, title: p.title })),
            ...openTasks.map(t => ({ kind: 'task', id: t.id, title: t.title })),
            ...brainDumpLines.map((line, idx) => ({ kind: 'dump', id: `dump-${idx}`, title: line }))
        ];

        if (candidates.length === 0) {
            container.innerHTML = `<div class="empty-state-text small">No candidates. Add some in the brain dump or Tasks tab.</div>`;
        } else {
            container.innerHTML = candidates.map(c => {
                const selected = this._isFocusSelected(c);
                return `
                    <div class="task-selection-item ${selected ? 'selected' : ''} ${c.kind === 'intention' ? 'intention-item' : ''}" data-kind="${c.kind}" data-id="${c.id}">
                        <span class="task-selection-text">
                            ${utils.escapeHtml(c.title)}
                            ${c.kind === 'intention' ? '<span class="intention-tag-inline">long-game</span>' : ''}
                            ${c.kind === 'dump' ? '<span class="dump-tag-inline">brain dump</span>' : ''}
                        </span>
                        <span class="task-selection-check">${selected ? '✓' : ''}</span>
                    </div>`;
            }).join('');
        }

        const selectedCount = state.wizardData.selectedTaskIds.length + state.wizardData.promotedIntentions.length + state.wizardData.newTasksFromBrainDump.length;
        const flags = [];
        if (selectedCount > 3) {
            flags.push({
                level: 'warn',
                text: `You picked ${selectedCount}. 3 is the ceiling — typically 1-2 of them slip when you pick more.`
            });
        }
        this._renderFlags('focusFlags', flags);
    },

    _isFocusSelected(c) {
        if (c.kind === 'intention') {
            return state.wizardData.promotedIntentions.some(p => p.intentionId === c.id);
        }
        if (c.kind === 'task') {
            return state.wizardData.selectedTaskIds.includes(c.id);
        }
        if (c.kind === 'dump') {
            return state.wizardData.newTasksFromBrainDump.some(t => t.tempId === c.id);
        }
        return false;
    },

    toggleFocusSelection(kind, id) {
        if (kind === 'intention') {
            const idx = state.wizardData.promotedIntentions.findIndex(p => p.intentionId === id);
            if (idx >= 0) {
                state.wizardData.promotedIntentions.splice(idx, 1);
            } else {
                const i = state.intentions.find(x => x.id === id);
                if (i && i.nextStep) {
                    state.wizardData.promotedIntentions.push({
                        intentionId: id,
                        title: i.nextStep,
                        intentionTitle: i.title
                    });
                }
            }
        } else if (kind === 'task') {
            const idx = state.wizardData.selectedTaskIds.indexOf(id);
            if (idx >= 0) state.wizardData.selectedTaskIds.splice(idx, 1);
            else state.wizardData.selectedTaskIds.push(id);
        } else if (kind === 'dump') {
            const idx = state.wizardData.newTasksFromBrainDump.findIndex(t => t.tempId === id);
            if (idx >= 0) {
                state.wizardData.newTasksFromBrainDump.splice(idx, 1);
            } else {
                // Find the line text from brain dump
                const lines = (state.wizardData.brainDumpText || '').split('\n').map(s => s.trim()).filter(Boolean);
                const dumpIdx = parseInt(id.replace('dump-', ''), 10);
                if (!isNaN(dumpIdx) && lines[dumpIdx]) {
                    state.wizardData.newTasksFromBrainDump.push({ tempId: id, title: lines[dumpIdx] });
                }
            }
        }
        this.renderStep7();
    },

    togglePromoteIntention(id) {
        const idx = state.wizardData.promotedIntentions.findIndex(p => p.intentionId === id);
        if (idx >= 0) {
            state.wizardData.promotedIntentions.splice(idx, 1);
        } else {
            const i = state.intentions.find(x => x.id === id);
            if (i && i.nextStep) {
                state.wizardData.promotedIntentions.push({
                    intentionId: id,
                    title: i.nextStep,
                    intentionTitle: i.title
                });
            } else if (i && !i.nextStep) {
                utils.showToast('Add a next step in the Long-game tab first', 'warning');
                return;
            }
        }
        this.renderStep7();
    },

    collectStep7() {
        // Selection is live, no-op
    },

    // --------------- Step 8: Alignment ---------------
    renderStep8() {
        document.getElementById('wizardWeeklyGoals').value = state.wizardData.weeklyGoals || '';
        document.getElementById('kristynAsk').value = state.wizardData.asks.kristyn || '';
        document.getElementById('julioAsk').value = state.wizardData.asks.julio || '';

        // Show flag about asks being skipped often — by looking at recent plans
        this._loadRecentAskSkipFlag();
    },

    async _loadRecentAskSkipFlag() {
        try {
            const recent = await db_ops.getRecentPlans(3);
            // Only consider plans older than today (to avoid flagging our own draft)
            const flags = [];
            const skipped = recent.filter(p =>
                !p.asks || (!p.asks.kristyn && !p.asks.julio)
            );
            if (recent.length >= 3 && skipped.length >= 3) {
                flags.push({
                    level: 'info',
                    text: 'Asks have been skipped the last 3 nights. Even a small one helps.'
                });
            }
            this._renderFlags('alignmentFlags', flags);
        } catch (e) {
            this._renderFlags('alignmentFlags', []);
        }
    },

    collectStep8() {
        state.wizardData.weeklyGoals = document.getElementById('wizardWeeklyGoals').value.trim();
        state.wizardData.asks.kristyn = document.getElementById('kristynAsk').value.trim();
        state.wizardData.asks.julio = document.getElementById('julioAsk').value.trim();
    },

    // --------------- Step 9: Review ---------------
    renderStep9() {
        // Gather all flags one more time
        const allFlags = [
            ...coach.workConflicts(state.wizardData.workBlocks),
            ...coach.coverageGaps(state.wizardData.coverage, state.wizardData.appointments),
            ...coach.appointmentConflicts(state.wizardData.appointments, state.wizardData.workBlocks)
        ];
        // Dedupe by text
        const seen = new Set();
        const unique = allFlags.filter(f => {
            if (seen.has(f.text)) return false;
            seen.add(f.text); return true;
        });
        this._renderFlags('reviewFlags', unique);

        // Build summary
        const d = state.wizardData;
        const summary = document.getElementById('reviewSummary');
        const parts = [];

        // Check-in
        if (d.checkIn) {
            const label = { better: 'Better than expected', expected: 'About what we expected', worse: 'Worse than expected' }[d.checkIn];
            parts.push(`<div class="review-line"><strong>Today:</strong> ${label}${d.checkInNote ? ' — ' + utils.escapeHtml(d.checkInNote) : ''}</div>`);
        }

        // Work
        const workBits = [];
        for (const p of WORK_PEOPLE) {
            for (const b of d.workBlocks[p]) {
                if (b.start && b.end) workBits.push(`${PERSON_LABEL[p]}: ${utils.formatTime(b.start)}–${utils.formatTime(b.end)}${b.label ? ' (' + utils.escapeHtml(b.label) + ')' : ''}`);
            }
        }
        if (workBits.length) parts.push(`<div class="review-line"><strong>Work:</strong><br>${workBits.join('<br>')}</div>`);

        // Coverage
        const coverBits = [];
        for (const p of COVERAGE_PEOPLE) {
            for (const b of d.coverage[p]) {
                if (b.start && b.end) coverBits.push(`${PERSON_LABEL[p]}: ${utils.formatTime(b.start)}–${utils.formatTime(b.end)}`);
            }
        }
        if (coverBits.length) parts.push(`<div class="review-line"><strong>Coverage:</strong><br>${coverBits.join('<br>')}</div>`);

        // Appointments
        const apts = d.appointments.filter(a => a.title);
        if (apts.length) {
            parts.push(`<div class="review-line"><strong>Appointments:</strong><br>${apts.map(a => `${utils.formatTime(a.startTime)} — ${utils.escapeHtml(a.title)}${a.notes ? ' (' + utils.escapeHtml(a.notes) + ')' : ''}`).join('<br>')}</div>`);
        }

        // Focus tasks (promoted + selected + brain-dump)
        const focusList = [
            ...d.promotedIntentions.map(p => `${utils.escapeHtml(p.title)} (long-game: ${utils.escapeHtml(p.intentionTitle || '')})`),
            ...d.selectedTaskIds.map(id => {
                const t = state.tasks.find(x => x.id === id);
                return t ? utils.escapeHtml(t.title) : null;
            }).filter(Boolean),
            ...d.newTasksFromBrainDump.map(t => utils.escapeHtml(t.title))
        ];
        if (focusList.length) {
            parts.push(`<div class="review-line"><strong>Tomorrow's focus:</strong><br>${focusList.map(t => '• ' + t).join('<br>')}</div>`);
        }

        // Weekly goals + asks
        if (d.weeklyGoals) parts.push(`<div class="review-line"><strong>Weekly goals:</strong><br>${utils.escapeHtml(d.weeklyGoals).replace(/\n/g, '<br>')}</div>`);
        if (d.asks.kristyn) parts.push(`<div class="review-line"><strong>Kristyn's ask:</strong> ${utils.escapeHtml(d.asks.kristyn)}</div>`);
        if (d.asks.julio) parts.push(`<div class="review-line"><strong>Julio's ask:</strong> ${utils.escapeHtml(d.asks.julio)}</div>`);

        summary.innerHTML = parts.length > 0 ? parts.join('') :
            `<div class="empty-state-text">Nothing captured yet.</div>`;
    },

    // ---------- Flag renderer ----------
    _renderFlags(containerId, flags) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!flags || flags.length === 0) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = flags.map(f => `
            <div class="coach-flag ${f.level === 'warn' ? 'warn' : 'info'}">
                <span class="coach-flag-icon">${f.level === 'warn' ? '⚠' : 'ℹ'}</span>
                <span>${utils.escapeHtml(f.text)}</span>
            </div>`).join('');
    },

    // ---------- Save ----------
    async save() {
        const d = state.wizardData;
        const tomorrow = utils.getTomorrowString();
        const today = utils.getTodayString();

        // 1. Process today's task review
        for (const [taskId, action] of Object.entries(d.taskReview)) {
            if (action === 'done') {
                await db_ops.updateTask(taskId, {
                    status: 'done',
                    completedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else if (action === 'rolled') {
                // Leave assigned to today? Actually, remove the assignment so it goes to brain dump;
                // the user will re-assign via focus if they want it for tomorrow.
                await db_ops.updateTask(taskId, { assignedDate: null });
            } else if (action === 'drop') {
                await db_ops.deleteTask(taskId);
            }
        }

        // 2. Create new tasks from brain dump items that were selected
        const newTaskIds = [];
        for (const nt of d.newTasksFromBrainDump) {
            const id = await db_ops.addTask(nt.title, tomorrow);
            if (id) newTaskIds.push(id);
        }

        // 3. Create tasks for promoted intentions
        const intentionTaskIds = [];
        for (const pi of d.promotedIntentions) {
            const id = await db_ops.addTask(pi.title, tomorrow, pi.intentionId);
            if (id) intentionTaskIds.push({ taskId: id, intentionId: pi.intentionId });
        }

        // 4. Assign selected open tasks to tomorrow
        for (const taskId of d.selectedTaskIds) {
            await db_ops.updateTask(taskId, { assignedDate: tomorrow });
        }

        // 5. Save the day plan
        const allFocusTaskIds = [
            ...d.selectedTaskIds,
            ...newTaskIds,
            ...intentionTaskIds.map(x => x.taskId)
        ];
        const planData = {
            date: tomorrow,
            checkIn: d.checkIn,
            checkInNote: d.checkInNote,
            checklistResponses: d.checklistResponses,
            workBlocks: d.workBlocks,
            coverage: d.coverage,
            appointments: d.appointments,
            focusTaskIds: allFocusTaskIds,
            promotedIntentionIds: d.promotedIntentions.map(p => p.intentionId),
            weeklyGoals: d.weeklyGoals,
            asks: d.asks
        };
        await db_ops.saveDayPlan(tomorrow, planData);

        // 6. Persist weekly goals to settings
        if (state.settings) {
            state.settings.weeklyGoals = d.weeklyGoals;
            await db_ops.saveSettings({ weeklyGoals: d.weeklyGoals });
        }

        // 7. Any remaining brain-dump lines that weren't promoted become unassigned tasks
        const dumpLines = (d.brainDumpText || '').split('\n').map(s => s.trim()).filter(Boolean);
        const selectedDumpTitles = new Set(d.newTasksFromBrainDump.map(t => t.title));
        for (const line of dumpLines) {
            if (!selectedDumpTitles.has(line)) {
                await db_ops.addTask(line, null);
            }
        }

        this.close();
        utils.showToast('Plan saved. Goodnight.', 'success');
        await loadData();
    }
};

// ============================================================================
// Edit Today — light editor for same-day adjustments
// ============================================================================
const editToday = {
    data: null,

    open() {
        if (!state.todayPlan) {
            utils.showToast('No plan for today to edit', 'warning');
            return;
        }
        // Deep clone
        this.data = JSON.parse(JSON.stringify({
            workBlocks: state.todayPlan.workBlocks || { kristyn: [], julio: [] },
            coverage: state.todayPlan.coverage || { kristyn: [], julio: [], nanny: [], kayden: [] },
            appointments: state.todayPlan.appointments || []
        }));
        document.getElementById('editTodayModal').classList.add('active');
        this.render();
    },

    close() {
        document.getElementById('editTodayModal').classList.remove('active');
    },

    render() {
        const renderList = (kind, person, blocks, containerId) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            if (!blocks || blocks.length === 0) {
                container.innerHTML = `<div class="empty-state-text small">No blocks.</div>`;
                return;
            }
            container.innerHTML = blocks.map((b, i) => `
                <div class="time-block-row" data-edit-kind="${kind}" data-edit-person="${person}" data-edit-idx="${i}">
                    <input type="time" class="time-input edit-block-field" value="${b.start || ''}" data-field="start">
                    <span class="time-dash">–</span>
                    <input type="time" class="time-input edit-block-field" value="${b.end || ''}" data-field="end">
                    <input type="text" class="time-label-input edit-block-field" placeholder="Label" value="${utils.escapeHtml(b.label || '')}" data-field="label">
                    <button class="block-remove" data-edit-remove-kind="${kind}" data-edit-remove-person="${person}" data-edit-remove-idx="${i}">×</button>
                </div>`).join('');
        };
        WORK_PEOPLE.forEach(p => renderList('work', p, this.data.workBlocks[p],
            p === 'kristyn' ? 'editKristynWorkList' : 'editJulioWorkList'));
        const coverIds = { kristyn: 'editKristynCoverList', julio: 'editJulioCoverList', nanny: 'editNannyCoverList', kayden: 'editKaydenCoverList' };
        COVERAGE_PEOPLE.forEach(p => renderList('cover', p, this.data.coverage[p], coverIds[p]));

        // Appointments
        const aptContainer = document.getElementById('editAppointmentsList');
        if (aptContainer) {
            if (this.data.appointments.length === 0) {
                aptContainer.innerHTML = `<div class="empty-state-text small">No appointments.</div>`;
            } else {
                aptContainer.innerHTML = this.data.appointments.map((a, i) => `
                    <div class="appointment-row" data-edit-apt-idx="${i}">
                        <input type="text" class="apt-title-input edit-apt-field" placeholder="Title" value="${utils.escapeHtml(a.title || '')}" data-field="title">
                        <div class="apt-time-row">
                            <input type="time" class="time-input edit-apt-field" value="${a.startTime || ''}" data-field="startTime">
                            <span class="time-dash">–</span>
                            <input type="time" class="time-input edit-apt-field" value="${a.endTime || ''}" data-field="endTime">
                        </div>
                        <input type="text" class="apt-notes-input edit-apt-field" placeholder="Notes" value="${utils.escapeHtml(a.notes || '')}" data-field="notes">
                        <button class="block-remove" data-edit-remove-apt="${i}">×</button>
                    </div>`).join('');
            }
        }
    },

    collect() {
        // Sync from DOM
        WORK_PEOPLE.forEach(p => {
            const id = p === 'kristyn' ? 'editKristynWorkList' : 'editJulioWorkList';
            const rows = document.getElementById(id).querySelectorAll('.time-block-row');
            const newBlocks = [];
            rows.forEach(row => {
                newBlocks.push({
                    start: row.querySelector('[data-field="start"]').value,
                    end: row.querySelector('[data-field="end"]').value,
                    label: row.querySelector('[data-field="label"]').value.trim()
                });
            });
            this.data.workBlocks[p] = newBlocks;
        });
        const coverIds = { kristyn: 'editKristynCoverList', julio: 'editJulioCoverList', nanny: 'editNannyCoverList', kayden: 'editKaydenCoverList' };
        COVERAGE_PEOPLE.forEach(p => {
            const rows = document.getElementById(coverIds[p]).querySelectorAll('.time-block-row');
            const newBlocks = [];
            rows.forEach(row => {
                newBlocks.push({
                    start: row.querySelector('[data-field="start"]').value,
                    end: row.querySelector('[data-field="end"]').value,
                    label: row.querySelector('[data-field="label"]').value.trim()
                });
            });
            this.data.coverage[p] = newBlocks;
        });
        const aptRows = document.getElementById('editAppointmentsList').querySelectorAll('.appointment-row');
        const apts = [];
        aptRows.forEach(row => {
            apts.push({
                title: row.querySelector('[data-field="title"]').value.trim(),
                startTime: row.querySelector('[data-field="startTime"]').value,
                endTime: row.querySelector('[data-field="endTime"]').value,
                notes: row.querySelector('[data-field="notes"]').value.trim()
            });
        });
        this.data.appointments = apts;
    },

    addBlock(kind, person) {
        this.collect();
        if (kind === 'work') this.data.workBlocks[person].push({ start: '', end: '', label: '' });
        else this.data.coverage[person].push({ start: '', end: '', label: '' });
        this.render();
    },

    removeBlock(kind, person, idx) {
        this.collect();
        if (kind === 'work') this.data.workBlocks[person].splice(idx, 1);
        else this.data.coverage[person].splice(idx, 1);
        this.render();
    },

    addAppointment() {
        this.collect();
        this.data.appointments.push({ title: '', startTime: '', endTime: '', notes: '' });
        this.render();
    },

    removeAppointment(idx) {
        this.collect();
        this.data.appointments.splice(idx, 1);
        this.render();
    },

    async save() {
        this.collect();
        const today = utils.getTodayString();
        const updated = {
            ...state.todayPlan,
            workBlocks: this.data.workBlocks,
            coverage: this.data.coverage,
            appointments: this.data.appointments
        };
        await db_ops.saveDayPlan(today, updated);
        this.close();
        utils.showToast('Today updated', 'success');
        await loadData();
    }
};

// ============================================================================
// Plan rendering — "The Plan" tab
// ============================================================================
function renderTodayPlan() {
    const container = document.getElementById('planContent');
    const exportBtn = document.getElementById('exportTodayBtn');
    const planActions = document.getElementById('planActions');
    if (!container) return;

    if (!state.todayPlan) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🌅</div>
                <div class="empty-state-text">No plan for today yet.</div>
                <div class="empty-state-subtext">Plans are made the night before — head to Evening Planning.</div>
            </div>`;
        if (exportBtn) exportBtn.style.display = 'none';
        if (planActions) planActions.style.display = 'none';
        return;
    }
    if (exportBtn) exportBtn.style.display = 'flex';
    if (planActions) planActions.style.display = 'block';

    const p = state.todayPlan;
    const sections = [];

    // Asks (high signal — show first)
    if (p.asks?.kristyn || p.asks?.julio) {
        const asks = [];
        if (p.asks.kristyn) asks.push(`<div class="ask-line"><strong>Kristyn asked:</strong> ${utils.escapeHtml(p.asks.kristyn)}</div>`);
        if (p.asks.julio) asks.push(`<div class="ask-line"><strong>Julio asked:</strong> ${utils.escapeHtml(p.asks.julio)}</div>`);
        sections.push(`
            <div class="plan-section asks-section">
                <h3 class="section-title">Asks for today</h3>
                ${asks.join('')}
            </div>`);
    }

    // Weekly goals
    if (p.weeklyGoals) {
        sections.push(`
            <div class="plan-section">
                <h3 class="section-title">Weekly goals</h3>
                <div class="weekly-goals-display">${utils.escapeHtml(p.weeklyGoals).replace(/\n/g, '<br>')}</div>
            </div>`);
    }

    // Focus tasks
    const focusIds = p.focusTaskIds || [];
    const focusTasks = focusIds.map(id => state.tasks.find(t => t.id === id)).filter(Boolean);
    if (focusTasks.length > 0) {
        sections.push(`
            <div class="plan-section">
                <h3 class="section-title">Today's focus</h3>
                <div class="task-list">
                    ${focusTasks.map(t => {
                        const intention = t.intentionId ? state.intentions.find(i => i.id === t.intentionId) : null;
                        return `
                            <div class="task-item ${t.status === 'done' ? 'completed' : ''}">
                                <input type="checkbox" class="task-checkbox" data-id="${t.id}" ${t.status === 'done' ? 'checked' : ''}>
                                <div class="task-text-wrap">
                                    <span class="task-text">${utils.escapeHtml(t.title)}</span>
                                    ${intention ? `<span class="intention-tag">long-game: ${utils.escapeHtml(intention.title)}</span>` : ''}
                                </div>
                            </div>`;
                    }).join('')}
                </div>
            </div>`);
    }

    // Build chronological timeline
    const timelineItems = [];
    for (const person of WORK_PEOPLE) {
        for (const b of (p.workBlocks?.[person] || [])) {
            if (b.start && b.end) {
                timelineItems.push({
                    type: 'work',
                    start: b.start, end: b.end,
                    title: `${PERSON_LABEL[person]} — work${b.label ? ': ' + b.label : ''}`,
                    person
                });
            }
        }
    }
    for (const person of COVERAGE_PEOPLE) {
        for (const b of (p.coverage?.[person] || [])) {
            if (b.start && b.end) {
                timelineItems.push({
                    type: 'cover',
                    start: b.start, end: b.end,
                    title: `${PERSON_LABEL[person]} covers Kayden${b.label ? ' — ' + b.label : ''}`,
                    person
                });
            }
        }
    }
    for (const a of (p.appointments || [])) {
        if (a.title && a.startTime) {
            timelineItems.push({
                type: 'appointment',
                start: a.startTime, end: a.endTime || a.startTime,
                title: a.title,
                notes: a.notes
            });
        }
    }
    timelineItems.sort((x, y) => (x.start || '').localeCompare(y.start || ''));

    if (timelineItems.length > 0) {
        sections.push(`
            <div class="plan-section">
                <h3 class="section-title">Timeline</h3>
                <div class="schedule-timeline">
                    ${timelineItems.map(item => `
                        <div class="schedule-block block-type-${item.type}">
                            <div class="block-time">
                                ${utils.formatTime(item.start)}<br>
                                ${item.end !== item.start ? utils.formatTime(item.end) : ''}
                            </div>
                            <div class="block-content">
                                <div class="block-title">${utils.escapeHtml(item.title)}</div>
                                ${item.notes ? `<div class="block-notes">${utils.escapeHtml(item.notes)}</div>` : ''}
                            </div>
                        </div>`).join('')}
                </div>
            </div>`);
    }

    // Check-in note (yesterday's reflection)
    if (p.checkInNote) {
        sections.push(`
            <div class="plan-section">
                <h3 class="section-title">Note from last night</h3>
                <div class="checkin-note-display">${utils.escapeHtml(p.checkInNote)}</div>
            </div>`);
    }

    container.innerHTML = sections.length > 0 ? sections.join('') :
        `<div class="empty-state-text">Plan saved but empty — try editing it.</div>`;
}

function renderTomorrowPreview() {
    const container = document.getElementById('tomorrowPreview');
    if (!container) return;

    if (!state.tomorrowPlan) {
        container.innerHTML = `
            <div class="control-card">
                <h4>No plan for tomorrow yet</h4>
                <p>Tap "Start Alignment" to walk through the wizard with your partner.</p>
            </div>`;
        return;
    }

    const p = state.tomorrowPlan;
    const focusCount = (p.focusTaskIds || []).length;
    const aptCount = (p.appointments || []).filter(a => a.title).length;
    const workCount = (p.workBlocks?.kristyn?.length || 0) + (p.workBlocks?.julio?.length || 0);
    const coverCount = COVERAGE_PEOPLE.reduce((sum, person) => sum + (p.coverage?.[person]?.length || 0), 0);

    container.innerHTML = `
        <div class="control-card">
            <h4>Tomorrow's plan is set ✓</h4>
            <div class="preview-stats">
                <div class="preview-stat"><strong>${focusCount}</strong> focus task${focusCount === 1 ? '' : 's'}</div>
                <div class="preview-stat"><strong>${workCount}</strong> work block${workCount === 1 ? '' : 's'}</div>
                <div class="preview-stat"><strong>${coverCount}</strong> coverage block${coverCount === 1 ? '' : 's'}</div>
                <div class="preview-stat"><strong>${aptCount}</strong> appointment${aptCount === 1 ? '' : 's'}</div>
            </div>
            ${p.asks?.kristyn || p.asks?.julio ? `
                <div class="preview-asks">
                    ${p.asks.kristyn ? `<div><strong>Kristyn asked:</strong> ${utils.escapeHtml(p.asks.kristyn)}</div>` : ''}
                    ${p.asks.julio ? `<div><strong>Julio asked:</strong> ${utils.escapeHtml(p.asks.julio)}</div>` : ''}
                </div>` : ''}
        </div>`;
}

// ============================================================================
// Data loading
// ============================================================================
async function loadData() {
    try {
        state.settings = await db_ops.getSettings();
        state.todayPlan = await db_ops.getDayPlan(utils.getTodayString());
        state.tomorrowPlan = await db_ops.getDayPlan(utils.getTomorrowString());

        const todayDate = document.getElementById('todayDate');
        const tomorrowDate = document.getElementById('tomorrowDate');
        if (todayDate) todayDate.textContent = utils.formatDate(utils.getTodayString());
        if (tomorrowDate) tomorrowDate.textContent = utils.formatDate(utils.getTomorrowString());

        renderSettings();
        renderTodayPlan();
        renderTomorrowPreview();
    } catch (e) {
        console.error('loadData:', e);
        utils.showToast('Failed to load data', 'error');
    }
}

// ============================================================================
// Event Handlers
// ============================================================================
function setupEventHandlers() {
    // ---------- Sign out ----------
    document.getElementById('signOutBtn').addEventListener('click', async () => {
        try { await auth.signOut(); }
        catch (e) { console.error('signOut:', e); }
    });

    // ---------- Tab navigation ----------
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = btn.dataset.tab;
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            const pane = document.getElementById(`${tab}Tab`);
            if (pane) pane.classList.add('active');
            if (tab === 'history') ui.renderHistory();
            else if (tab === 'tasks') ui.renderTasks(state.tasks);
            else if (tab === 'intentions') ui.renderIntentions(state.intentions);
        });
    });

    // ---------- Wizard ----------
    document.getElementById('openWizardBtn').addEventListener('click', () => wizard.open());
    document.getElementById('closeWizard').addEventListener('click', () => wizard.close());
    document.querySelectorAll('.wizard-next').forEach(btn => btn.addEventListener('click', () => wizard.next()));
    document.querySelectorAll('.wizard-back').forEach(btn => btn.addEventListener('click', () => wizard.back()));
    document.getElementById('saveWizard').addEventListener('click', () => wizard.save());

    // Step 1 — check-in buttons + dynamic checklist
    document.querySelectorAll('.check-in-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.wizardData.checkIn = btn.dataset.value;
            document.querySelectorAll('.check-in-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });

    // Step 2 + 3 — add/remove blocks (event delegation)
    document.addEventListener('click', (e) => {
        const addWork = e.target.closest('[data-add-work]');
        if (addWork) { wizard.addBlock('work', addWork.dataset.addWork); return; }
        const addCover = e.target.closest('[data-add-cover]');
        if (addCover) { wizard.addBlock('cover', addCover.dataset.addCover); return; }
        const blockRemove = e.target.closest('.block-remove[data-kind]');
        if (blockRemove) {
            wizard.removeBlock(blockRemove.dataset.kind, blockRemove.dataset.person, parseInt(blockRemove.dataset.idx, 10));
            return;
        }
    });

    // Step 2 + 3 — recompute coach flags as user types
    document.addEventListener('input', (e) => {
        // Live update inside wizard time-block rows
        if (e.target.closest('.wizard-step .time-block-row')) {
            const row = e.target.closest('.time-block-row');
            const kind = row.dataset.kind;
            const person = row.dataset.person;
            const idx = parseInt(row.dataset.idx, 10);
            const field = e.target.dataset.field;
            const target = kind === 'work' ? state.wizardData.workBlocks[person] : state.wizardData.coverage[person];
            if (target[idx]) {
                target[idx][field] = field === 'label' ? e.target.value.trim() : e.target.value;
            }
            // Refresh flags only (not whole list, to preserve focus)
            if (state.wizardStep === 2) {
                wizard._renderFlags('workFlags', coach.workConflicts(state.wizardData.workBlocks));
            } else if (state.wizardStep === 3) {
                wizard._renderFlags('coverageFlags', coach.coverageGaps(state.wizardData.coverage, state.wizardData.appointments));
            }
        }

        // Appointments live editing
        if (e.target.closest('.wizard-step .appointment-row')) {
            const row = e.target.closest('.appointment-row');
            const idx = parseInt(row.dataset.idx, 10);
            const field = e.target.dataset.field;
            if (state.wizardData.appointments[idx]) {
                state.wizardData.appointments[idx][field] = ['title', 'notes'].includes(field)
                    ? e.target.value.trim() : e.target.value;
            }
            if (state.wizardStep === 4) {
                wizard._renderFlags('appointmentFlags', [
                    ...coach.appointmentConflicts(state.wizardData.appointments, state.wizardData.workBlocks)
                ]);
            }
        }

        // Edit Today live editing
        if (e.target.closest('#editTodayModal .time-block-row')) {
            const row = e.target.closest('.time-block-row');
            const kind = row.dataset.editKind;
            const person = row.dataset.editPerson;
            const idx = parseInt(row.dataset.editIdx, 10);
            const field = e.target.dataset.field;
            if (editToday.data) {
                const target = kind === 'work' ? editToday.data.workBlocks[person] : editToday.data.coverage[person];
                if (target[idx]) target[idx][field] = field === 'label' ? e.target.value.trim() : e.target.value;
            }
        }
        if (e.target.closest('#editTodayModal .appointment-row')) {
            const row = e.target.closest('.appointment-row');
            const idx = parseInt(row.dataset.editAptIdx, 10);
            const field = e.target.dataset.field;
            if (editToday.data && editToday.data.appointments[idx]) {
                editToday.data.appointments[idx][field] = ['title', 'notes'].includes(field)
                    ? e.target.value.trim() : e.target.value;
            }
        }
    });

    // Step 4 — appointments
    document.getElementById('addAppointment').addEventListener('click', () => wizard.addAppointment());
    document.addEventListener('click', (e) => {
        const removeApt = e.target.closest('[data-remove-apt]');
        if (removeApt && removeApt.closest('.wizard-step')) {
            wizard.removeAppointment(parseInt(removeApt.dataset.removeApt, 10));
        }
    });

    // Step 5 — task review
    document.addEventListener('click', (e) => {
        const reviewBtn = e.target.closest('.task-review-btn');
        if (reviewBtn) {
            const id = reviewBtn.dataset.id;
            const review = reviewBtn.dataset.review;
            state.wizardData.taskReview[id] = review;
            // Update visual state
            document.querySelectorAll(`.task-review-btn[data-id="${id}"]`).forEach(b => b.classList.remove('selected'));
            reviewBtn.classList.add('selected');
        }
    });

    // Step 7 — focus selection + intention promote
    document.addEventListener('click', (e) => {
        const selItem = e.target.closest('.task-selection-item');
        if (selItem && state.wizardStep === 7) {
            wizard.toggleFocusSelection(selItem.dataset.kind, selItem.dataset.id);
            return;
        }
        const promoteBtn = e.target.closest('.promote-intention-btn');
        if (promoteBtn && state.wizardStep === 7) {
            wizard.togglePromoteIntention(promoteBtn.dataset.id);
            return;
        }
    });

    // Step 1 — checklist toggle
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('checklist-checkbox')) {
            state.wizardData.checklistResponses[e.target.dataset.id] = e.target.checked;
        }
    });

    // ---------- Edit Today modal ----------
    document.getElementById('editTodayPlanBtn')?.addEventListener('click', () => editToday.open());
    document.getElementById('closeEditToday').addEventListener('click', () => editToday.close());
    document.getElementById('cancelEditToday').addEventListener('click', () => editToday.close());
    document.getElementById('saveEditToday').addEventListener('click', () => editToday.save());
    document.getElementById('editAddAppointment').addEventListener('click', () => editToday.addAppointment());

    document.addEventListener('click', (e) => {
        const addEditWork = e.target.closest('[data-edit-work]');
        if (addEditWork && addEditWork.closest('#editTodayModal')) {
            editToday.addBlock('work', addEditWork.dataset.editWork); return;
        }
        const addEditCover = e.target.closest('[data-edit-cover]');
        if (addEditCover && addEditCover.closest('#editTodayModal')) {
            editToday.addBlock('cover', addEditCover.dataset.editCover); return;
        }
        const editRemove = e.target.closest('.block-remove[data-edit-remove-kind]');
        if (editRemove) {
            editToday.removeBlock(
                editRemove.dataset.editRemoveKind,
                editRemove.dataset.editRemovePerson,
                parseInt(editRemove.dataset.editRemoveIdx, 10)
            );
            return;
        }
        const editRemoveApt = e.target.closest('[data-edit-remove-apt]');
        if (editRemoveApt) {
            editToday.removeAppointment(parseInt(editRemoveApt.dataset.editRemoveApt, 10));
            return;
        }
    });

    // ---------- Clear tomorrow's plan ----------
    document.getElementById('clearPlanBtn').addEventListener('click', async () => {
        if (!confirm("Clear tomorrow's plan? This cannot be undone.")) return;
        const ok = await db_ops.deleteDayPlan(utils.getTomorrowString());
        if (ok) {
            utils.showToast('Plan cleared', 'success');
            await loadData();
        } else {
            utils.showToast('Failed to clear plan', 'error');
        }
    });

    // ---------- Refresh button ----------
    document.getElementById('refreshScheduleBtn').addEventListener('click', async () => {
        await loadData();
        utils.showToast('Refreshed', 'success');
    });

    // ---------- Tasks ----------
    document.getElementById('addTaskBtn').addEventListener('click', async () => {
        const input = document.getElementById('newTaskInput');
        const title = input.value.trim();
        if (title) {
            await db_ops.addTask(title);
            input.value = '';
        }
    });
    document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('addTaskBtn').click();
    });

    // Task interactions (delegation)
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('task-checkbox')) {
            const id = e.target.dataset.id;
            const checked = e.target.checked;

            // If task linked to an intention and was just completed — bump intention's last progress
            if (checked) {
                const task = state.tasks.find(t => t.id === id);
                if (task && task.intentionId) {
                    const intention = state.intentions.find(i => i.id === task.intentionId);
                    if (intention) {
                        await db_ops.updateIntention(task.intentionId, {
                            lastProgressAtStr: utils.getTodayString()
                        });
                    }
                }
            }

            await db_ops.updateTask(id, {
                status: checked ? 'done' : 'open',
                completedAt: checked ? firebase.firestore.FieldValue.serverTimestamp() : null
            });
        }
        if (e.target.classList.contains('task-delete')) {
            const id = e.target.dataset.id;
            await db_ops.deleteTask(id);
        }
    });

    // ---------- Meals ----------
    document.getElementById('addMealBtn').addEventListener('click', async () => {
        const input = document.getElementById('newMealInput');
        const content = input.value.trim();
        if (content) {
            await db_ops.addMeal(content);
            input.value = '';
            utils.showToast('Meal added', 'success');
        }
    });

    // Meal edit/delete (delegation)
    document.addEventListener('click', async (e) => {
        if (e.target.closest('.meal-edit-btn')) {
            const btn = e.target.closest('.meal-edit-btn');
            const id = btn.dataset.id;
            document.getElementById(`meal-content-${id}`).style.display = 'none';
            btn.parentElement.style.display = 'none';
            document.getElementById(`meal-edit-${id}`).style.display = 'block';
        }
        if (e.target.closest('.meal-cancel-btn')) {
            const btn = e.target.closest('.meal-cancel-btn');
            const id = btn.dataset.id;
            const contentEl = document.getElementById(`meal-content-${id}`);
            contentEl.style.display = 'block';
            contentEl.parentElement.querySelector('.meal-actions').style.display = 'flex';
            document.getElementById(`meal-edit-${id}`).style.display = 'none';
        }
        if (e.target.closest('.meal-save-btn')) {
            const btn = e.target.closest('.meal-save-btn');
            const id = btn.dataset.id;
            const textarea = document.getElementById(`meal-edit-${id}`).querySelector('textarea');
            const newContent = textarea.value.trim();
            if (newContent) {
                await db_ops.updateMeal(id, newContent);
                utils.showToast('Meal updated', 'success');
            }
        }
        if (e.target.closest('.meal-delete-btn')) {
            const btn = e.target.closest('.meal-delete-btn');
            const id = btn.dataset.id;
            if (confirm('Delete this meal?')) {
                await db_ops.deleteMeal(id);
                utils.showToast('Meal deleted', 'success');
            }
        }
    });

    // ---------- Lists ----------
    document.querySelectorAll('.add-list-item-btn[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            document.getElementById(`${category}Input`).style.display = 'block';
            btn.style.display = 'none';
        });
    });
    document.querySelectorAll('.cancel-list-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            const c = document.getElementById(`${category}Input`);
            c.style.display = 'none';
            c.querySelector('textarea').value = '';
            document.querySelector(`.add-list-item-btn[data-category="${category}"]`).style.display = 'block';
        });
    });
    document.querySelectorAll('.save-list-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const category = btn.dataset.category;
            const c = document.getElementById(`${category}Input`);
            const textarea = c.querySelector('textarea');
            const content = textarea.value.trim();
            if (content) {
                await db_ops.addListItem(category, content);
                textarea.value = '';
                c.style.display = 'none';
                document.querySelector(`.add-list-item-btn[data-category="${category}"]`).style.display = 'block';
                utils.showToast('Item added', 'success');
            }
        });
    });
    // List item edit/delete (delegation)
    document.addEventListener('click', async (e) => {
        if (e.target.closest('.list-edit-btn')) {
            const btn = e.target.closest('.list-edit-btn');
            const id = btn.dataset.id;
            document.getElementById(`list-content-${id}`).style.display = 'none';
            btn.parentElement.style.display = 'none';
            document.getElementById(`list-edit-${id}`).style.display = 'block';
        }
        if (e.target.closest('.list-cancel-edit-btn')) {
            const btn = e.target.closest('.list-cancel-edit-btn');
            const id = btn.dataset.id;
            const contentEl = document.getElementById(`list-content-${id}`);
            contentEl.style.display = 'block';
            contentEl.parentElement.querySelector('.list-item-actions').style.display = 'flex';
            document.getElementById(`list-edit-${id}`).style.display = 'none';
        }
        if (e.target.closest('.list-save-edit-btn')) {
            const btn = e.target.closest('.list-save-edit-btn');
            const id = btn.dataset.id;
            const textarea = document.getElementById(`list-edit-${id}`).querySelector('textarea');
            const newContent = textarea.value.trim();
            if (newContent) {
                await db_ops.updateListItem(id, newContent);
                utils.showToast('Item updated', 'success');
            }
        }
        if (e.target.closest('.list-delete-btn')) {
            const btn = e.target.closest('.list-delete-btn');
            const id = btn.dataset.id;
            if (confirm('Delete this item?')) {
                await db_ops.deleteListItem(id);
                utils.showToast('Item deleted', 'success');
            }
        }
    });

    // ---------- Calendar Events (.ics export) ----------
    const renderPendingEvents = () => {
        const container = document.getElementById('pendingEventsList');
        const downloadBtn = document.getElementById('downloadEventsBtn');
        if (state.pendingEvents.length === 0) {
            container.innerHTML = '<div class="empty-state-text">No events queued</div>';
            downloadBtn.style.display = 'none';
            return;
        }
        downloadBtn.style.display = 'flex';
        container.innerHTML = state.pendingEvents.map((e, i) => `
            <div class="pending-event-card" data-index="${i}">
                <div class="pending-event-info">
                    <div class="pending-event-title">${utils.escapeHtml(e.title)}</div>
                    <div class="pending-event-datetime">
                        ${utils.formatDate(e.date)}${e.allDay ? ' (All day)' : ` • ${utils.formatTime(e.startTime)}${e.endTime ? ' - ' + utils.formatTime(e.endTime) : ''}`}
                    </div>
                </div>
                <button class="pending-event-remove" data-index="${i}">×</button>
            </div>`).join('');
    };

    document.getElementById('showEventFormBtn').addEventListener('click', () => {
        document.getElementById('eventForm').style.display = 'block';
        document.getElementById('showEventFormBtn').style.display = 'none';
        document.getElementById('eventDate').value = utils.getTodayString();
    });
    document.getElementById('cancelEventBtn').addEventListener('click', () => {
        document.getElementById('eventForm').style.display = 'none';
        document.getElementById('showEventFormBtn').style.display = 'block';
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventDate').value = '';
        document.getElementById('eventStartTime').value = '';
        document.getElementById('eventEndTime').value = '';
        document.getElementById('eventAllDay').checked = false;
    });
    document.getElementById('eventAllDay').addEventListener('change', (e) => {
        document.querySelectorAll('#eventStartTime, #eventEndTime').forEach(input => {
            input.disabled = e.target.checked;
            if (e.target.checked) input.value = '';
        });
    });
    document.getElementById('addEventBtn').addEventListener('click', () => {
        const title = document.getElementById('eventTitle').value.trim();
        const date = document.getElementById('eventDate').value;
        const startTime = document.getElementById('eventStartTime').value;
        const endTime = document.getElementById('eventEndTime').value;
        const allDay = document.getElementById('eventAllDay').checked;
        if (!title) return utils.showToast('Please enter an event title', 'error');
        if (!date) return utils.showToast('Please select a date', 'error');
        if (!allDay && !startTime) return utils.showToast('Please enter a start time or mark as all day', 'error');
        state.pendingEvents.push({ title, date, startTime, endTime, allDay });
        renderPendingEvents();
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventStartTime').value = '';
        document.getElementById('eventEndTime').value = '';
        document.getElementById('eventAllDay').checked = false;
        document.querySelectorAll('#eventStartTime, #eventEndTime').forEach(i => i.disabled = false);
        utils.showToast('Event added to list', 'success');
    });
    document.getElementById('pendingEventsList').addEventListener('click', (e) => {
        if (e.target.classList.contains('pending-event-remove')) {
            const idx = parseInt(e.target.dataset.index, 10);
            state.pendingEvents.splice(idx, 1);
            renderPendingEvents();
        }
    });
    document.getElementById('downloadEventsBtn').addEventListener('click', () => {
        if (state.pendingEvents.length === 0) return;
        const filename = state.pendingEvents.length === 1
            ? `${state.pendingEvents[0].title.replace(/[^a-z0-9]/gi, '_')}.ics`
            : `events_${utils.getTodayString()}.ics`;
        utils.downloadICS(state.pendingEvents, filename);
        utils.showToast('Calendar file downloaded', 'success');
        state.pendingEvents = [];
        renderPendingEvents();
        document.getElementById('eventForm').style.display = 'none';
        document.getElementById('showEventFormBtn').style.display = 'block';
    });
    renderPendingEvents();

    // ---------- History expand/collapse ----------
    document.getElementById('historyList').addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (item && e.target.closest('.history-header')) {
            item.classList.toggle('expanded');
        }
    });

    // ---------- Settings link from History ----------
    document.getElementById('openSettingsBtn').addEventListener('click', () => {
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.getElementById('settingsTab').classList.add('active');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    });

    // ---------- Settings ----------
    document.getElementById('saveWeeklyGoalsBtn').addEventListener('click', async () => {
        const v = document.getElementById('weeklyGoalsInput').value.trim();
        state.settings.weeklyGoals = v;
        await db_ops.saveSettings({ weeklyGoals: v });
        utils.showToast('Weekly goals saved', 'success');
    });

    document.getElementById('addChecklistItemBtn').addEventListener('click', async () => {
        const input = document.getElementById('newChecklistItem');
        const label = input.value.trim();
        if (!label) return;
        if (!state.settings.checklistItems) state.settings.checklistItems = [];
        const id = 'cl-' + Date.now();
        state.settings.checklistItems.push({ id, label });
        await db_ops.saveSettings({ checklistItems: state.settings.checklistItems });
        input.value = '';
        renderSettings();
    });

    // Checklist editor — inline edit + delete (delegation)
    document.addEventListener('click', async (e) => {
        const del = e.target.closest('.checklist-editor-delete');
        if (del) {
            const id = del.dataset.id;
            state.settings.checklistItems = (state.settings.checklistItems || []).filter(it => it.id !== id);
            await db_ops.saveSettings({ checklistItems: state.settings.checklistItems });
            renderSettings();
        }
    });
    document.addEventListener('change', async (e) => {
        if (e.target.classList.contains('checklist-editor-input')) {
            const id = e.target.dataset.id;
            const newLabel = e.target.value.trim();
            if (!newLabel) return;
            state.settings.checklistItems = (state.settings.checklistItems || []).map(it =>
                it.id === id ? { ...it, label: newLabel } : it
            );
            await db_ops.saveSettings({ checklistItems: state.settings.checklistItems });
        }
    });

    // ---------- Google Calendar ----------
    document.getElementById('connectCalendarBtn').addEventListener('click', () => googleCalendar.requestAccess());
    document.getElementById('disconnectCalendarBtn').addEventListener('click', () => googleCalendar.disconnect());
    document.getElementById('exportTodayBtn').addEventListener('click', async () => {
        if (!state.todayPlan) return utils.showToast('No plan to export', 'warning');
        await googleCalendar.exportPlan(utils.getTodayString(), state.todayPlan);
    });

    // ---------- Clear data ----------
    document.getElementById('clearDataBtn').addEventListener('click', async () => {
        if (!confirm('Clear ALL data? This cannot be undone.')) return;
        try {
            const collections = ['tasks', 'meals', 'lists', 'day_plans', 'intentions', 'day_logs'];
            for (const col of collections) {
                const snap = await db.collection('families').doc(FAMILY_ID).collection(col).get();
                const batch = db.batch();
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
            utils.showToast('All data cleared', 'success');
            await loadData();
        } catch (e) {
            console.error('clearData:', e);
            utils.showToast('Failed to clear data', 'error');
        }
    });

    // ---------- Intentions ----------
    document.getElementById('addIntentionBtn').addEventListener('click', async () => {
        const title = document.getElementById('newIntentionTitle').value.trim();
        const category = document.getElementById('newIntentionCategory').value;
        const nextStep = document.getElementById('newIntentionNextStep').value.trim();
        if (!title) return utils.showToast('Title required', 'warning');
        await db_ops.addIntention({ title, category, nextStep });
        document.getElementById('newIntentionTitle').value = '';
        document.getElementById('newIntentionNextStep').value = '';
        utils.showToast('Intention added', 'success');
    });

    // Intention next-step save
    document.addEventListener('click', async (e) => {
        const saveBtn = e.target.closest('.intention-next-step-save');
        if (saveBtn) {
            const id = saveBtn.dataset.id;
            const input = document.querySelector(`.intention-next-step-input[data-id="${id}"]`);
            const newStep = (input?.value || '').trim();
            await db_ops.updateIntention(id, { nextStep: newStep });
            utils.showToast('Next step saved', 'success');
        }
        const action = e.target.closest('.intention-action-btn');
        if (action) {
            const id = action.dataset.id;
            const a = action.dataset.action;
            const intention = state.intentions.find(i => i.id === id);
            if (!intention) return;
            if (a === 'pause') {
                const reason = prompt('Pause reason (optional)?', intention.pausedReason || '') || '';
                await db_ops.updateIntention(id, { status: 'paused', pausedReason: reason.trim() });
            } else if (a === 'resume') {
                await db_ops.updateIntention(id, { status: 'active', pausedReason: null });
            } else if (a === 'done') {
                await db_ops.updateIntention(id, { status: 'done', lastProgressAtStr: utils.getTodayString() });
                utils.showToast('Intention completed ✓', 'success');
            } else if (a === 'drop') {
                if (!confirm(`Drop "${intention.title}"?`)) return;
                await db_ops.updateIntention(id, { status: 'dropped' });
            } else if (a === 'progress') {
                await db_ops.updateIntention(id, { lastProgressAtStr: utils.getTodayString() });
                utils.showToast('Progress logged', 'success');
            } else if (a === 'delete') {
                if (!confirm(`Delete "${intention.title}" permanently?`)) return;
                await db_ops.deleteIntention(id);
            } else if (a === 'promote') {
                if (!intention.nextStep) return utils.showToast('Add a next step first', 'warning');
                const tomorrow = utils.getTomorrowString();
                await db_ops.addTask(intention.nextStep, tomorrow, intention.id);
                utils.showToast('Promoted to tomorrow', 'success');
            }
        }
    });
}

// ============================================================================
// Init
// ============================================================================
async function init() {
    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        functions = firebase.functions();

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                state.user = user;
                document.getElementById('signInScreen').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                document.getElementById('userBadge').textContent = user.displayName || user.email;

                await loadData();

                // Real-time listeners
                state.unsubscribers.push(
                    db_ops.listenToTasks((tasks) => {
                        state.tasks = tasks;
                        ui.renderTasks(tasks);
                        renderTodayPlan();
                    })
                );
                state.unsubscribers.push(
                    db_ops.listenToMeals((meals) => {
                        state.meals = meals;
                        ui.renderMeals(meals);
                    })
                );
                state.unsubscribers.push(
                    db_ops.listenToLists((items) => {
                        state.lists = items;
                        ui.renderLists(items);
                    })
                );
                state.unsubscribers.push(
                    db_ops.listenToIntentions((intentions) => {
                        state.intentions = intentions;
                        ui.renderIntentions(intentions);
                        renderTodayPlan(); // re-render in case intention tags need update
                    })
                );

                if (!window.handlersSetup) {
                    setupEventHandlers();
                    window.handlersSetup = true;
                }
            } else {
                document.getElementById('signInScreen').style.display = 'flex';
                document.getElementById('app').style.display = 'none';
                state.unsubscribers.forEach(u => u());
                state.unsubscribers = [];
            }
        });

        document.getElementById('signInBtn').addEventListener('click', async () => {
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                await auth.signInWithPopup(provider);
            } catch (e) {
                console.error('signIn:', e);
                utils.showToast('Failed to sign in', 'error');
            }
        });

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./service-worker.js')
                .then(() => console.log('SW registered'))
                .catch(err => console.error('SW failed:', err));
        }
    } catch (e) {
        console.error('init:', e);
        utils.showToast('Failed to initialize', 'error');
    }
}

init();
