// Family Day Planner - Firebase Version
// Modern, sleek implementation with Google authentication

// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
let auth, db, functions;
let currentUser = null;

// Constants
const FAMILY_ID = 'default_family'; // Shared family space
const USERS = ['Kristyn', 'Julio', 'Nanny', 'Kayden'];

// Application State
const state = {
    user: null,
    settings: null,
    todayPlan: null,
    tomorrowPlan: null,
    tasks: [],
    wizardStep: 1,
    wizardData: {},
    unsubscribers: []
};

// Utility Functions
const utils = {
    formatDate(date) {
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
    },
    
    formatTime(time) {
        if (!time) return '';
        const [hours, minutes] = time.split(':');
        const h = parseInt(hours);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${displayHour}:${minutes} ${ampm}`;
    },
    
    getTodayString() {
        const today = new Date();
        // Get local date string in YYYY-MM-DD format
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    
    getTomorrowString() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    
    getCurrentTime() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
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
    
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// Firebase Database Operations
const db_ops = {
    // Settings
    async getSettings() {
        try {
            const doc = await db.collection('families').doc(FAMILY_ID).get();
            if (doc.exists) {
                return doc.data();
            }
            return this.getDefaultSettings();
        } catch (error) {
            console.error('Error getting settings:', error);
            return this.getDefaultSettings();
        }
    },
    
    getDefaultSettings() {
        return {
            constraints: [
                { name: 'Wake Window 1', value: '3-3.5 hrs' },
                { name: 'Nap 1 Duration', value: '40-90 min' },
                { name: 'Wake Window 2', value: '3.5-4 hrs' },
                { name: 'Nap 2 Duration', value: '40-90 min' },
                { name: 'Wake Window 3', value: '4-4.25 hrs' },
                { name: 'Bedtime Target', value: '7:00 PM' }
            ],
            routineBlocks: {
                wakeUp: { duration: 5, title: 'Wake Up Time' },
                familyCuddle: { duration: 10, title: 'Family Cuddle' },
                getDressed: { duration: 10, title: 'Get Dressed' },
                breakfastPrep: { duration: 10, title: 'Breakfast Prep' },
                breakfast: { duration: 20, title: 'Breakfast' },
                brushTeethMorning: { duration: 5, title: 'Brush Teeth' },
                napRoutine: { duration: 10, title: 'Nap Time Routine' },
                lunchPrep: { duration: 10, title: 'Lunch Prep' },
                lunch: { duration: 20, title: 'Lunch' },
                snackMilk: { duration: 10, title: 'Snack + Milk' },
                dinnerPrep: { duration: 10, title: 'Dinner Prep' },
                dinner: { duration: 20, title: 'Dinner' },
                bath: { duration: 20, title: 'Bath Time' },
                brushTeethEvening: { duration: 5, title: 'Brush Teeth' },
                bedtimeRoutine: { duration: 15, title: 'Bedtime Routine' }
            },
            lastBathDate: null,
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
        } catch (error) {
            console.error('Error saving settings:', error);
            utils.showToast('Failed to save settings', 'error');
            return false;
        }
    },
    
    // Day Plans
    async getDayPlan(date) {
        try {
            const doc = await db.collection('families').doc(FAMILY_ID)
                .collection('day_plans').doc(date).get();
            return doc.exists ? doc.data() : null;
        } catch (error) {
            console.error('Error getting day plan:', error);
            return null;
        }
    },
    
    async saveDayPlan(date, planData) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('day_plans').doc(date).set({
                    ...planData,
                    createdBy: currentUser.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            return true;
        } catch (error) {
            console.error('Error saving day plan:', error);
            utils.showToast('Failed to save plan', 'error');
            return false;
        }
    },
    
    // Day Logs
    async getDayLog(date) {
        try {
            const doc = await db.collection('families').doc(FAMILY_ID)
                .collection('day_logs').doc(date).get();
            return doc.exists ? doc.data() : null;
        } catch (error) {
            console.error('Error getting day log:', error);
            return null;
        }
    },
    
    async saveDayLog(date, logData) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('day_logs').doc(date).set({
                    ...logData,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            return true;
        } catch (error) {
            console.error('Error saving day log:', error);
            return false;
        }
    },
    
    // Tasks
    async getTasks() {
        try {
            const snapshot = await db.collection('families').doc(FAMILY_ID)
                .collection('tasks')
                .orderBy('createdAt', 'desc')
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error getting tasks:', error);
            return [];
        }
    },
    
    async addTask(title, assignedDate = null) {
        try {
            const docRef = await db.collection('families').doc(FAMILY_ID)
                .collection('tasks').add({
                    title,
                    status: 'open',
                    assignedDate,
                    createdBy: currentUser.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    completedAt: null
                });
            return { id: docRef.id, title, status: 'open', assignedDate };
        } catch (error) {
            console.error('Error adding task:', error);
            utils.showToast('Failed to add task', 'error');
            return null;
        }
    },
    
    async updateTask(id, updates) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('tasks').doc(id).update({
                    ...updates,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            return true;
        } catch (error) {
            console.error('Error updating task:', error);
            return false;
        }
    },
    
    async deleteTask(id) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('tasks').doc(id).delete();
            return true;
        } catch (error) {
            console.error('Error deleting task:', error);
            return false;
        }
    },
    
    // History
    async getRecentLogs(limit = 30) {
        try {
            const snapshot = await db.collection('families').doc(FAMILY_ID)
                .collection('day_logs')
                .orderBy('date', 'desc')
                .limit(limit)
                .get();
            return snapshot.docs.map(doc => ({ 
                date: doc.id, 
                ...doc.data() 
            }));
        } catch (error) {
            console.error('Error getting recent logs:', error);
            return [];
        }
    },
    
    // Real-time listeners
    listenToTasks(callback) {
        const unsubscribe = db.collection('families').doc(FAMILY_ID)
            .collection('tasks')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snapshot => {
                const tasks = snapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data() 
                }));
                callback(tasks);
            }, error => {
                console.error('Error listening to tasks:', error);
            });
        return unsubscribe;
    },
    
    listenToDayLog(date, callback) {
        const unsubscribe = db.collection('families').doc(FAMILY_ID)
            .collection('day_logs').doc(date)
            .onSnapshot(doc => {
                callback(doc.exists ? doc.data() : null);
            }, error => {
                console.error('Error listening to day log:', error);
            });
        return unsubscribe;
    }
};

// Schedule Generation
const scheduler = {
    generateSchedule(plan, actualWake, nap1Data, nap2Data) {
        if (!plan) return [];
        
        const blocks = [];
        let currentTime = actualWake || plan.wakeTarget || '07:00';
        
        const addMinutes = (time, minutes) => {
            const [h, m] = time.split(':').map(Number);
            const date = new Date();
            date.setHours(h, m + minutes);
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        };
        
        const parseDuration = (duration) => {
            const match = duration.match(/(\d+\.?\d*)\s*(hr|min)/);
            if (!match) return 0;
            const value = parseFloat(match[1]);
            return match[2] === 'hr' ? value * 60 : value;
        };
        
        // Wake block
        blocks.push({
            start: currentTime,
            end: addMinutes(currentTime, 30),
            title: 'Wake & Morning Routine',
            type: 'routine',
            caregiver: 'Available'
        });
        
        currentTime = addMinutes(currentTime, 30);
        
        // Get constraints
        const constraints = state.settings?.constraints || this.getDefaultConstraints();
        const wakeWindow1 = parseDuration(constraints.find(c => c.name === 'Wake Window Before Nap 1')?.value || '2.5 hrs');
        const napDuration1 = parseDuration(constraints.find(c => c.name === 'Nap 1 Duration')?.value || '90 min');
        const wakeWindow2 = parseDuration(constraints.find(c => c.name === 'Wake Window Between Naps')?.value || '3 hrs');
        const napDuration2 = parseDuration(constraints.find(c => c.name === 'Nap 2 Duration')?.value || '90 min');
        
        // Handle Nap 1
        if (nap1Data.enabled) {
            const nap1Start = nap1Data.start || addMinutes(currentTime, wakeWindow1 - 30);
            const nap1End = nap1Data.end || addMinutes(nap1Start, napDuration1);
            
            if (currentTime < nap1Start) {
                blocks.push({
                    start: currentTime,
                    end: nap1Start,
                    title: 'Open Time',
                    type: 'open',
                    caregiver: 'Anyone'
                });
            }
            
            const nap1Caregiver = plan.caregiverAvailability?.nap1?.filter(c => c !== 'Kayden')[0] || 'Available';
            blocks.push({
                start: nap1Start,
                end: nap1End,
                title: 'Nap 1',
                type: 'nap',
                caregiver: nap1Caregiver
            });
            
            currentTime = nap1End;
        }
        
        // Insert appointments
        if (plan.appointments && plan.appointments.length > 0) {
            plan.appointments.forEach(apt => {
                if (apt.start && apt.title) {
                    const aptEnd = apt.end || addMinutes(apt.start, 60);
                    
                    if (currentTime < apt.start) {
                        blocks.push({
                            start: currentTime,
                            end: apt.start,
                            title: 'Open Time',
                            type: 'open',
                            caregiver: 'Anyone'
                        });
                    }
                    
                    blocks.push({
                        start: apt.start,
                        end: aptEnd,
                        title: apt.title,
                        type: 'appointment',
                        caregiver: apt.caregiver || 'Family'
                    });
                    
                    currentTime = aptEnd;
                }
            });
        }
        
        // Handle Nap 2
        if (nap2Data.enabled) {
            const nap2Start = nap2Data.start || addMinutes(currentTime, wakeWindow2);
            const nap2End = nap2Data.end || addMinutes(nap2Start, napDuration2);
            
            if (currentTime < nap2Start) {
                blocks.push({
                    start: currentTime,
                    end: nap2Start,
                    title: 'Open Time',
                    type: 'open',
                    caregiver: 'Anyone'
                });
            }
            
            const nap2Caregiver = plan.caregiverAvailability?.nap2?.filter(c => c !== 'Kayden')[0] || 'Available';
            blocks.push({
                start: nap2Start,
                end: nap2End,
                title: 'Nap 2',
                type: 'nap',
                caregiver: nap2Caregiver
            });
            
            currentTime = nap2End;
        }
        
        // Evening routine
        const bedtime = constraints.find(c => c.name === 'Bedtime Target')?.value || '19:00';
        const bedtimeHour = bedtime.match(/(\d+)/)?.[1] || '19';
        const bedtimeTime = `${bedtimeHour.padStart(2, '0')}:00`;
        
        if (currentTime < bedtimeTime) {
            blocks.push({
                start: currentTime,
                end: addMinutes(bedtimeTime, -30),
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            
            blocks.push({
                start: addMinutes(bedtimeTime, -30),
                end: bedtimeTime,
                title: 'Bedtime Routine',
                type: 'routine',
                caregiver: 'Available'
            });
        }
        
        blocks.sort((a, b) => a.start.localeCompare(b.start));
        return blocks;
    },
    
    getDefaultConstraints() {
        return [
            { name: 'Nap 1 Duration', value: '90 min' },
            { name: 'Nap 2 Duration', value: '90 min' },
            { name: 'Wake Window Before Nap 1', value: '2.5 hrs' },
            { name: 'Wake Window Between Naps', value: '3 hrs' },
            { name: 'Bedtime Target', value: '7:00 PM' }
        ];
    },
    
    adjustScheduleForActualWake(plan, actualWake, napData = {}) {
        // Recalculate schedule based on actual wake time
        const blocks = [];
        let currentTime = actualWake;
        
        const addMinutes = (time, minutes) => {
            const [h, m] = time.split(':').map(Number);
            const date = new Date();
            date.setHours(h, m + minutes);
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        };
        
        const parseDuration = (duration) => {
            const match = duration.match(/(\d+\.?\d*)\s*(hr|min)/);
            if (!match) return 0;
            const value = parseFloat(match[1]);
            return match[2] === 'hr' ? value * 60 : value;
        };
        
        // Get constraints
        const constraints = plan.constraints || this.getDefaultConstraints();
        const wakeWindow1 = parseDuration(constraints.find(c => c.name === 'Wake Window Before Nap 1')?.value || '2.5 hrs');
        const napDuration1 = parseDuration(constraints.find(c => c.name === 'Nap 1 Duration')?.value || '90 min');
        const wakeWindow2 = parseDuration(constraints.find(c => c.name === 'Wake Window Between Naps')?.value || '3 hrs');
        const napDuration2 = parseDuration(constraints.find(c => c.name === 'Nap 2 Duration')?.value || '90 min');
        
        // Wake block
        blocks.push({
            start: currentTime,
            end: addMinutes(currentTime, 30),
            title: 'Wake & Morning Routine',
            type: 'routine',
            caregiver: 'Available'
        });
        currentTime = addMinutes(currentTime, 30);
        
        // Nap 1 - use actual if tracked, otherwise calculate
        const nap1Start = napData?.nap1?.start || addMinutes(currentTime, wakeWindow1 - 30);
        const nap1End = napData?.nap1?.end || addMinutes(nap1Start, napDuration1);
        
        // Find original nap 1 caregiver from plan
        const originalNap1 = plan.calculatedSchedule?.find(b => b.title === 'Nap 1');
        const nap1Caregiver = originalNap1?.caregiver || 'Available';
        
        if (currentTime < nap1Start) {
            blocks.push({
                start: currentTime,
                end: nap1Start,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
        }
        
        blocks.push({
            start: nap1Start,
            end: nap1End,
            title: 'Nap 1',
            type: 'nap',
            caregiver: nap1Caregiver
        });
        currentTime = nap1End;
        
        // Insert original appointments (they don't change)
        const appointments = plan.appointments || [];
        const sortedAppointments = appointments
            .filter(apt => apt.start && apt.title)
            .sort((a, b) => a.start.localeCompare(b.start));
        
        for (const apt of sortedAppointments) {
            const aptEnd = apt.end || addMinutes(apt.start, 60);
            
            if (currentTime < apt.start) {
                blocks.push({
                    start: currentTime,
                    end: apt.start,
                    title: 'Open Time',
                    type: 'open',
                    caregiver: 'Anyone'
                });
            }
            
            blocks.push({
                start: apt.start,
                end: aptEnd,
                title: apt.title,
                type: 'appointment',
                caregiver: 'Family'
            });
            currentTime = aptEnd;
        }
        
        // Nap 2 - use actual if tracked, otherwise calculate
        const nap2Start = napData?.nap2?.start || addMinutes(currentTime, wakeWindow2);
        const nap2End = napData?.nap2?.end || addMinutes(nap2Start, napDuration2);
        
        const originalNap2 = plan.calculatedSchedule?.find(b => b.title === 'Nap 2');
        const nap2Caregiver = originalNap2?.caregiver || 'Available';
        
        if (currentTime < nap2Start) {
            blocks.push({
                start: currentTime,
                end: nap2Start,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
        }
        
        blocks.push({
            start: nap2Start,
            end: nap2End,
            title: 'Nap 2',
            type: 'nap',
            caregiver: nap2Caregiver
        });
        currentTime = nap2End;
        
        // Evening & Bedtime
        const bedtime = constraints.find(c => c.name === 'Bedtime Target')?.value || '19:00';
        const bedtimeHour = bedtime.match(/(\d+)/)?.[1] || '19';
        const bedtimeTime = `${bedtimeHour.padStart(2, '0')}:00`;
        
        if (currentTime < addMinutes(bedtimeTime, -30)) {
            blocks.push({
                start: currentTime,
                end: addMinutes(bedtimeTime, -30),
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
        }
        
        blocks.push({
            start: addMinutes(bedtimeTime, -30),
            end: bedtimeTime,
            title: 'Bedtime Routine',
            type: 'routine',
            caregiver: 'Available'
        });
        
        return blocks;
    }
};

// Continue to Part 2...

// Google Calendar Integration
const googleCalendar = {
    async requestAccess() {
        try {
            // Use Firebase Functions to handle OAuth
            const requestAccess = functions.httpsCallable('requestCalendarAccess');
            const result = await requestAccess({ familyId: FAMILY_ID });
            
            if (result.data.authUrl) {
                window.location.href = result.data.authUrl;
            }
        } catch (error) {
            console.error('Error requesting calendar access:', error);
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
        } catch (error) {
            console.error('Error disconnecting:', error);
            utils.showToast('Failed to disconnect', 'error');
        }
    },
    
    async exportDay(date, blocks) {
        try {
            if (!state.settings?.googleCalendar?.connected) {
                utils.showToast('Please connect Google Calendar first', 'warning');
                return;
            }
            
            const exportBlocks = blocks.filter(b => b.type !== 'open');
            const events = exportBlocks.map(block => ({
                summary: `Family Planner — ${block.title}`,
                description: block.caregiver ? `Caregiver: ${block.caregiver}` : '',
                start: { dateTime: `${date}T${block.start}:00` },
                end: { dateTime: `${date}T${block.end}:00` }
            }));
            
            const exportEvents = functions.httpsCallable('exportToCalendar');
            const result = await exportEvents({
                familyId: FAMILY_ID,
                date,
                events
            });
            
            if (result.data.success) {
                const log = await db_ops.getDayLog(date);
                const logData = log || {};
                logData.exportedEvents = result.data.eventIds;
                await db_ops.saveDayLog(date, logData);
                
                utils.showToast('Exported to Google Calendar', 'success');
            }
        } catch (error) {
            console.error('Error exporting to calendar:', error);
            utils.showToast('Failed to export to calendar', 'error');
        }
    }
};

// UI Rendering
const ui = {
    renderSchedule(blocks) {
        const container = document.getElementById('todaySchedule');
        
        if (!blocks || blocks.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📅</div>
                    <div class="empty-state-text">Set actual wake time to generate schedule</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = blocks.map(block => `
            <div class="schedule-block block-type-${block.type}">
                <div class="block-time">
                    ${utils.formatTime(block.start)}<br>
                    ${utils.formatTime(block.end)}
                </div>
                <div class="block-content">
                    <div class="block-title">${block.title}</div>
                    <div class="block-caregiver">${block.caregiver}</div>
                </div>
            </div>
        `).join('');
    },
    
    renderTasks(tasks) {
        const todayStr = utils.getTodayString();
        const todayTasks = tasks.filter(t => t.status === 'open' && t.assignedDate === todayStr);
        const brainDumpTasks = tasks.filter(t => t.status === 'open' && !t.assignedDate);
        const completedTasks = tasks.filter(t => t.status === 'done');
        
        const renderTaskList = (taskList, containerId) => {
            const container = document.getElementById(containerId);
            
            if (taskList.length === 0) {
                container.innerHTML = `<div class="empty-state-text">No tasks</div>`;
                return;
            }
            
            container.innerHTML = taskList.map(task => `
                <div class="task-item ${task.status === 'done' ? 'completed' : ''}">
                    <input type="checkbox" class="task-checkbox" 
                           data-id="${task.id}" 
                           ${task.status === 'done' ? 'checked' : ''}>
                    <span class="task-text">${task.title}</span>
                    <button class="task-delete" data-id="${task.id}">×</button>
                </div>
            `).join('');
        };
        
        renderTaskList(todayTasks, 'todayTasks');
        renderTaskList(brainDumpTasks, 'brainDumpTasks');
        renderTaskList(completedTasks, 'completedTasks');
    },
    
    async renderHistory() {
        const logs = await db_ops.getRecentLogs(30);
        const container = document.getElementById('historyList');
        
        if (logs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📖</div>
                    <div class="empty-state-text">No history yet</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = logs.map(log => `
            <div class="history-item" data-date="${log.date}">
                <div class="history-date">${utils.formatDate(log.date)}</div>
                <div class="history-summary">
                    ${log.actualWake ? `Wake: ${utils.formatTime(log.actualWake)}` : 'No data'}
                </div>
            </div>
        `).join('');
    }
};

function renderSettings() {
    const constraintsContainer = document.getElementById('defaultConstraints');
    const constraints = state.settings?.constraints || scheduler.getDefaultConstraints();
    
    constraintsContainer.innerHTML = constraints.map(c => `
        <div class="constraint-item">
            <span class="constraint-name">${c.name}</span>
            <span class="constraint-value">${c.value}</span>
        </div>
    `).join('');
    
    const statusDiv = document.getElementById('calendarStatus');
    const connectBtn = document.getElementById('connectCalendarBtn');
    const disconnectBtn = document.getElementById('disconnectCalendarBtn');
    
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

// Evening Wizard - Comprehensive 8-step planning
const wizard = {
    currentStep: 1,
    totalSteps: 8,
    data: {},
    
    open() {
        document.getElementById('wizardModal').classList.add('active');
        this.currentStep = 1;
        this.data = {
            wakeTarget: '07:00',
            parentUnavailable: {
                kristyn: [],
                julio: []
            },
            helpersAvailable: {
                nanny: [],
                kayden: []
            },
            appointments: [],
            todayTasksCompleted: {},
            brainDump: '',
            selectedTasks: [],
            constraints: state.settings?.constraints || scheduler.getDefaultConstraints()
        };
        this.renderStep();
    },
    
    close() {
        document.getElementById('wizardModal').classList.remove('active');
    },
    
    renderStep() {
        // Hide all steps
        for (let i = 1; i <= this.totalSteps; i++) {
            const step = document.getElementById(`step${i}`);
            if (step) step.style.display = 'none';
        }
        
        // Show current step
        const currentStepEl = document.getElementById(`step${this.currentStep}`);
        if (currentStepEl) currentStepEl.style.display = 'block';
        
        // Update progress
        const progressFill = document.getElementById('wizardProgress');
        const progressText = document.getElementById('wizardProgressText');
        progressFill.style.width = `${(this.currentStep / this.totalSteps) * 100}%`;
        progressText.textContent = `Step ${this.currentStep} of ${this.totalSteps}`;
        
        // Render step-specific content
        this.renderStepContent();
    },
    
    async renderStepContent() {
        switch(this.currentStep) {
            case 1:
                document.getElementById('wizardDate').textContent = utils.formatDate(utils.getTomorrowString());
                document.getElementById('wakeTarget').value = this.data.wakeTarget;
                break;
            case 2:
                this.renderAvailability();
                break;
            case 3:
                this.renderHelperAvailability();
                break;
            case 4:
                this.renderAppointments();
                await this.checkBathReminder();
                break;
            case 5:
                await this.renderTodayTaskReview();
                break;
            case 6:
                document.getElementById('brainDumpText').value = this.data.brainDump || '';
                break;
            case 7:
                await this.renderTaskSelection();
                break;
            case 8:
                this.renderSchedulePreview();
                break;
        }
    },
    
    async checkBathReminder() {
        const settings = state.settings || await db_ops.getSettings();
        const lastBath = settings.lastBathDate;
        const bathReminder = document.getElementById('bathReminder');
        
        if (!lastBath) {
            // No bath record, show reminder
            bathReminder.style.display = 'block';
            document.getElementById('daysSinceBath').textContent = '?';
            return;
        }
        
        const lastBathDate = new Date(lastBath);
        const today = new Date();
        const daysSince = Math.floor((today - lastBathDate) / (1000 * 60 * 60 * 24));
        
        if (daysSince >= 3) {
            bathReminder.style.display = 'block';
            document.getElementById('daysSinceBath').textContent = daysSince;
        } else {
            bathReminder.style.display = 'none';
        }
    },
    
    renderAvailability() {
        this.renderTimeBlocks('kristyn', 'kristynUnavailableList');
        this.renderTimeBlocks('julio', 'julioUnavailableList');
    },
    
    renderHelperAvailability() {
        this.renderTimeBlocks('nanny', 'nannyAvailableList', true);
        this.renderTimeBlocks('kayden', 'kaydenAvailableList', true);
    },
    
    renderTimeBlocks(person, containerId, isHelper = false) {
        const container = document.getElementById(containerId);
        const blocks = isHelper ? 
            this.data.helpersAvailable[person] : 
            this.data.parentUnavailable[person];
        
        if (blocks.length === 0) {
            container.innerHTML = '<p class="empty-state-text">No time blocks added</p>';
            return;
        }
        
        container.innerHTML = blocks.map((block, idx) => `
            <div class="time-block-item">
                <input type="time" value="${block.start}" data-person="${person}" data-idx="${idx}" data-field="start" data-helper="${isHelper}">
                <input type="time" value="${block.end}" data-person="${person}" data-idx="${idx}" data-field="end" data-helper="${isHelper}">
                <button onclick="wizard.removeTimeBlock('${person}', ${idx}, ${isHelper})">×</button>
            </div>
        `).join('');
    },
    
    addTimeBlock(person, isHelper = false) {
        const block = { start: '09:00', end: '12:00' };
        if (isHelper) {
            this.data.helpersAvailable[person].push(block);
            this.renderTimeBlocks(person, `${person}AvailableList`, true);
        } else {
            this.data.parentUnavailable[person].push(block);
            this.renderTimeBlocks(person, `${person}UnavailableList`);
        }
    },
    
    removeTimeBlock(person, idx, isHelper = false) {
        if (isHelper) {
            this.data.helpersAvailable[person].splice(idx, 1);
            this.renderHelperAvailability();
        } else {
            this.data.parentUnavailable[person].splice(idx, 1);
            this.renderAvailability();
        }
    },
    
    renderAppointments() {
        const container = document.getElementById('appointmentsList');
        
        if (this.data.appointments.length === 0) {
            container.innerHTML = '<p class="empty-state-text">No appointments added</p>';
            return;
        }
        
        container.innerHTML = this.data.appointments.map((apt, idx) => `
            <div class="appointment-item">
                <input type="text" placeholder="Title" value="${apt.title || ''}" 
                       data-idx="${idx}" data-field="title" class="appointment-input">
                <input type="time" value="${apt.start || ''}" 
                       data-idx="${idx}" data-field="start" class="appointment-input">
                <input type="time" placeholder="End (optional)" value="${apt.end || ''}" 
                       data-idx="${idx}" data-field="end" class="appointment-input">
                <button class="secondary-btn full-width" onclick="wizard.removeAppointment(${idx})">Remove</button>
            </div>
        `).join('');
    },
    
    addAppointment() {
        this.data.appointments.push({ title: '', start: '', end: '' });
        this.renderAppointments();
    },
    
    removeAppointment(idx) {
        this.data.appointments.splice(idx, 1);
        this.renderAppointments();
    },
    
    async renderTodayTaskReview() {
        const todayStr = utils.getTodayString();
        const todayTasks = state.tasks.filter(t => t.assignedDate === todayStr && t.status === 'open');
        const container = document.getElementById('todayTaskReview');
        
        if (todayTasks.length === 0) {
            container.innerHTML = '<p class="empty-state-text">No tasks were planned for today</p>';
            return;
        }
        
        container.innerHTML = todayTasks.map(task => `
            <div class="task-review-item ${this.data.todayTasksCompleted[task.id] ? 'completed' : ''}">
                <input type="checkbox" 
                       id="review-${task.id}" 
                       data-task-id="${task.id}"
                       ${this.data.todayTasksCompleted[task.id] ? 'checked' : ''}
                       onchange="wizard.toggleTaskCompletion('${task.id}', this.checked)">
                <label for="review-${task.id}">${task.title}</label>
            </div>
        `).join('');
    },
    
    toggleTaskCompletion(taskId, completed) {
        this.data.todayTasksCompleted[taskId] = completed;
        this.renderTodayTaskReview();
    },
    
    async renderTaskSelection() {
        // Get all open tasks (brain dump + existing)
        const allTasks = state.tasks.filter(t => t.status === 'open' && !t.assignedDate);
        const container = document.getElementById('taskSelectionList');
        
        if (allTasks.length === 0) {
            container.innerHTML = '<p class="empty-state-text">No tasks available. Add some in the brain dump!</p>';
            return;
        }
        
        container.innerHTML = allTasks.map(task => `
            <div class="task-selection-item ${this.data.selectedTasks.includes(task.id) ? 'selected' : ''}">
                <input type="checkbox" 
                       id="select-${task.id}" 
                       data-task-id="${task.id}"
                       ${this.data.selectedTasks.includes(task.id) ? 'checked' : ''}
                       onchange="wizard.toggleTaskSelection('${task.id}', this.checked)">
                <label for="select-${task.id}">${task.title}</label>
            </div>
        `).join('');
    },
    
    toggleTaskSelection(taskId, selected) {
        if (selected) {
            if (!this.data.selectedTasks.includes(taskId)) {
                this.data.selectedTasks.push(taskId);
            }
        } else {
            this.data.selectedTasks = this.data.selectedTasks.filter(id => id !== taskId);
        }
        document.querySelector(`#select-${taskId}`).closest('.task-selection-item').classList.toggle('selected', selected);
    },
    
    renderSchedulePreview() {
        const schedule = this.calculateSchedule();
        const warnings = this.detectConflicts(schedule);
        
        // Render schedule
        const scheduleContainer = document.getElementById('schedulePreview');
        if (schedule.blocks.length === 0) {
            scheduleContainer.innerHTML = '<p class="empty-state-text">No schedule generated</p>';
        } else {
            scheduleContainer.innerHTML = schedule.blocks.map(block => `
                <div class="preview-block">
                    <div class="preview-time">
                        ${utils.formatTime(block.start)}<br>
                        ${utils.formatTime(block.end)}
                    </div>
                    <div class="preview-content">
                        <div class="preview-title">${block.title}</div>
                        <div class="preview-caregiver">${block.caregiver}</div>
                    </div>
                    <span class="preview-badge ${block.type}">${block.type}</span>
                </div>
            `).join('');
        }
        
        // Render warnings
        const warningsContainer = document.getElementById('scheduleWarnings');
        if (warnings.length === 0) {
            warningsContainer.innerHTML = '<div class="warning-item info">✓ No conflicts detected</div>';
        } else {
            warningsContainer.innerHTML = warnings.map(warning => `
                <div class="warning-item ${warning.severity}">
                    ${warning.severity === 'error' ? '⚠️' : 'ℹ️'} ${warning.message}
                </div>
            `).join('');
        }
    },
    
    calculateSchedule() {
        const blocks = [];
        let currentTime = this.data.wakeTarget;
        
        // Helper functions
        const addMinutes = (time, minutes) => {
            const [h, m] = time.split(':').map(Number);
            const date = new Date();
            date.setHours(h, m + minutes);
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        };
        
        const parseWakeWindow = (value) => {
            // Parse ranges like "3-3.5 hrs" -> use middle value
            const match = value.match(/([\d.]+)-([\d.]+)\s*hrs?/);
            if (match) {
                const min = parseFloat(match[1]);
                const max = parseFloat(match[2]);
                return ((min + max) / 2) * 60; // Return minutes
            }
            // Fallback to single value
            const singleMatch = value.match(/([\d.]+)\s*hrs?/);
            if (singleMatch) return parseFloat(singleMatch[1]) * 60;
            return 0;
        };
        
        const parseNapDuration = (value) => {
            // Parse ranges like "40-90 min" -> use middle value
            const match = value.match(/(\d+)-(\d+)\s*min/);
            if (match) {
                const min = parseInt(match[1]);
                const max = parseInt(match[2]);
                return (min + max) / 2;
            }
            return 65; // Default 65 min (middle of 40-90)
        };
        
        const isTimeInRange = (time, start, end) => {
            return time >= start && time < end;
        };
        
        const getAvailableCaregiver = (time, forNap = false) => {
            if (forNap) {
                // Priority: Parents first, then Nanny, never Kayden
                const parents = ['Kristyn', 'Julio'];
                for (const parent of parents) {
                    const personKey = parent.toLowerCase();
                    const isUnavailable = this.data.parentUnavailable[personKey].some(block => 
                        isTimeInRange(time, block.start, block.end)
                    );
                    if (!isUnavailable) return parent;
                }
                
                // Check Nanny
                const nannyAvailable = this.data.helpersAvailable.nanny.some(block =>
                    isTimeInRange(time, block.start, block.end)
                );
                if (nannyAvailable) return 'Nanny';
                
                return 'No one available!';
            } else {
                return 'Anyone';
            }
        };
        
        const areBothParentsAvailable = (time) => {
            const kristynAvailable = !this.data.parentUnavailable.kristyn.some(block =>
                isTimeInRange(time, block.start, block.end)
            );
            const julioAvailable = !this.data.parentUnavailable.julio.some(block =>
                isTimeInRange(time, block.start, block.end)
            );
            return kristynAvailable && julioAvailable;
        };
        
        const addRoutineBlock = (title, duration, type = 'routine') => {
            blocks.push({
                start: currentTime,
                end: addMinutes(currentTime, duration),
                title,
                type,
                caregiver: 'Available'
            });
            currentTime = addMinutes(currentTime, duration);
        };
        
        // Get constraints
        const constraints = this.data.constraints;
        const wakeWindow1 = parseWakeWindow(constraints.find(c => c.name === 'Wake Window 1')?.value || '3-3.5 hrs');
        const wakeWindow2 = parseWakeWindow(constraints.find(c => c.name === 'Wake Window 2')?.value || '3.5-4 hrs');
        const wakeWindow3 = parseWakeWindow(constraints.find(c => c.name === 'Wake Window 3')?.value || '4-4.25 hrs');
        const napDuration1 = parseNapDuration(constraints.find(c => c.name === 'Nap 1 Duration')?.value || '40-90 min');
        const napDuration2 = parseNapDuration(constraints.find(c => c.name === 'Nap 2 Duration')?.value || '40-90 min');
        const bedtime = constraints.find(c => c.name === 'Bedtime Target')?.value || '7:00 PM';
        const bedtimeHour = bedtime.match(/(\d+)/)?.[1] || '19';
        const bedtimeTime = `${bedtimeHour.padStart(2, '0')}:00`;
        
        // ========== WAKE WINDOW 1 (3-3.5 hrs) ==========
        const ww1Start = currentTime;
        
        // Morning routine blocks
        addRoutineBlock('Wake Up Time', 5);
        addRoutineBlock('Family Cuddle', 10);
        addRoutineBlock('Get Dressed', 10);
        addRoutineBlock('Breakfast Prep', 10);
        addRoutineBlock('Breakfast', 20, 'meal');
        addRoutineBlock('Brush Teeth', 5);
        
        // Calculate when Nap 1 should start
        const nap1RoutineStart = addMinutes(ww1Start, wakeWindow1 - 10); // 10 min before nap for routine
        const nap1Start = addMinutes(nap1RoutineStart, 10);
        const nap1End = addMinutes(nap1Start, napDuration1);
        
        // Fill with Open Time until nap routine
        if (currentTime < nap1RoutineStart) {
            blocks.push({
                start: currentTime,
                end: nap1RoutineStart,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = nap1RoutineStart;
        }
        
        // Nap 1 routine and nap
        addRoutineBlock('Nap Time Routine', 10);
        const nap1Caregiver = getAvailableCaregiver(currentTime, true);
        blocks.push({
            start: currentTime,
            end: nap1End,
            title: 'Nap 1',
            type: 'nap',
            caregiver: nap1Caregiver
        });
        currentTime = nap1End;
        
        // ========== WAKE WINDOW 2 (3.5-4 hrs) ==========
        const ww2Start = currentTime;
        
        addRoutineBlock('Wake Up Time', 5);
        
        // Calculate when lunch should be (roughly 1/3 into wake window)
        const lunchStart = addMinutes(ww2Start, Math.floor(wakeWindow2 / 3));
        
        // Open time until lunch
        if (currentTime < addMinutes(lunchStart, -10)) {
            blocks.push({
                start: currentTime,
                end: addMinutes(lunchStart, -10),
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = addMinutes(lunchStart, -10);
        }
        
        addRoutineBlock('Lunch Prep', 10);
        addRoutineBlock('Lunch', 20, 'meal');
        
        // Calculate when Nap 2 should start
        const nap2RoutineStart = addMinutes(ww2Start, wakeWindow2 - 10);
        const nap2Start = addMinutes(nap2RoutineStart, 10);
        const nap2End = addMinutes(nap2Start, napDuration2);
        
        // Calculate when snack should be (10 min before nap routine)
        const snackTime = addMinutes(nap2RoutineStart, -10);
        
        // Open time until snack
        if (currentTime < snackTime) {
            blocks.push({
                start: currentTime,
                end: snackTime,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = snackTime;
        }
        
        addRoutineBlock('Snack + Milk', 10, 'meal');
        addRoutineBlock('Nap Time Routine', 10);
        
        const nap2Caregiver = getAvailableCaregiver(currentTime, true);
        blocks.push({
            start: currentTime,
            end: nap2End,
            title: 'Nap 2',
            type: 'nap',
            caregiver: nap2Caregiver
        });
        currentTime = nap2End;
        
        // ========== WAKE WINDOW 3 (4-4.25 hrs) ==========
        const ww3Start = currentTime;
        
        addRoutineBlock('Wake Up Time', 5);
        
        // Calculate when dinner should be (roughly 1/3 into wake window)
        const dinnerStart = addMinutes(ww3Start, Math.floor(wakeWindow3 / 3));
        
        // Open time until dinner
        if (currentTime < addMinutes(dinnerStart, -10)) {
            blocks.push({
                start: currentTime,
                end: addMinutes(dinnerStart, -10),
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = addMinutes(dinnerStart, -10);
        }
        
        addRoutineBlock('Dinner Prep', 10);
        addRoutineBlock('Dinner', 20, 'meal');
        
        // Calculate bedtime routine start
        const bedtimeRoutineStart = addMinutes(bedtimeTime, -15);
        const brushTeethTime = addMinutes(bedtimeRoutineStart, -5);
        const eveningSnackTime = addMinutes(brushTeethTime, -10);
        
        // Bath logic - needs both parents AND scheduled
        let bathTime = null;
        if (this.data.includeBath) {
            // Place bath after dinner, before evening snack
            bathTime = currentTime;
            const bathEnd = addMinutes(bathTime, 20);
            
            // Check if both parents available
            const bathCaregiver = areBothParentsAvailable(bathTime) ? 'Both Parents' : 'Both Parents (UNAVAILABLE!)';
            
            // Open time before bath if needed
            if (currentTime < bathTime) {
                blocks.push({
                    start: currentTime,
                    end: bathTime,
                    title: 'Open Time',
                    type: 'open',
                    caregiver: 'Anyone'
                });
            }
            
            blocks.push({
                start: bathTime,
                end: bathEnd,
                title: 'Bath Time',
                type: 'bath',
                caregiver: bathCaregiver
            });
            currentTime = bathEnd;
        }
        
        // Open time until evening snack
        if (currentTime < eveningSnackTime) {
            blocks.push({
                start: currentTime,
                end: eveningSnackTime,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = eveningSnackTime;
        }
        
        addRoutineBlock('Snack + Milk', 10, 'meal');
        addRoutineBlock('Brush Teeth', 5);
        addRoutineBlock('Bedtime Routine', 15);
        
        // ========== INSERT APPOINTMENTS ==========
        // Now intelligently insert appointments into the schedule
        const sortedAppointments = [...this.data.appointments]
            .filter(apt => apt.start && apt.title)
            .sort((a, b) => a.start.localeCompare(b.start));
        
        for (const apt of sortedAppointments) {
            const aptStart = apt.start;
            const aptEnd = apt.end || addMinutes(aptStart, 60);
            
            // Find where to insert this appointment
            let insertIndex = blocks.findIndex(b => b.type === 'open' && aptStart >= b.start && aptStart < b.end);
            
            if (insertIndex !== -1) {
                // Split the open time block
                const openBlock = blocks[insertIndex];
                const newBlocks = [];
                
                // Open time before appointment
                if (openBlock.start < aptStart) {
                    newBlocks.push({
                        start: openBlock.start,
                        end: aptStart,
                        title: 'Open Time',
                        type: 'open',
                        caregiver: 'Anyone'
                    });
                }
                
                // Appointment
                newBlocks.push({
                    start: aptStart,
                    end: aptEnd,
                    title: apt.title,
                    type: 'appointment',
                    caregiver: 'Family'
                });
                
                // Open time after appointment (if any)
                if (aptEnd < openBlock.end) {
                    newBlocks.push({
                        start: aptEnd,
                        end: openBlock.end,
                        title: 'Open Time',
                        type: 'open',
                        caregiver: 'Anyone'
                    });
                }
                
                // Replace the open block with new blocks
                blocks.splice(insertIndex, 1, ...newBlocks);
            }
        }
        
        // Sort blocks by start time
        blocks.sort((a, b) => a.start.localeCompare(b.start));
        
        return { blocks, nap1Start, nap2Start };
    },
    
    detectConflicts(schedule) {
        const warnings = [];
        
        const addMinutes = (time, minutes) => {
            const [h, m] = time.split(':').map(Number);
            const date = new Date();
            date.setHours(h, m + minutes);
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        };
        
        // Check for unassigned naps
        schedule.blocks.forEach(block => {
            if (block.type === 'nap' && block.caregiver === 'No one available!') {
                warnings.push({
                    severity: 'error',
                    message: `${block.title}: No caregiver available at ${utils.formatTime(block.start)}`
                });
            }
        });
        
        // Check for bath without both parents
        schedule.blocks.forEach(block => {
            if (block.type === 'bath' && block.caregiver.includes('UNAVAILABLE')) {
                warnings.push({
                    severity: 'error',
                    message: `Bath scheduled at ${utils.formatTime(block.start)} but both parents not available`
                });
            }
        });
        
        // Get all meal and nap blocks
        const meals = schedule.blocks.filter(b => b.type === 'meal');
        const naps = schedule.blocks.filter(b => b.type === 'nap');
        const bath = schedule.blocks.find(b => b.type === 'bath');
        
        // Check if appointments overlap with important blocks
        const appointments = this.data.appointments.filter(apt => apt.start && apt.title);
        
        appointments.forEach(apt => {
            const aptStart = apt.start;
            const aptEnd = apt.end || addMinutes(aptStart, 60);
            
            // Check nap conflicts
            naps.forEach(nap => {
                const hasConflict = (aptStart >= nap.start && aptStart < nap.end) ||
                                   (aptEnd > nap.start && aptEnd <= nap.end) ||
                                   (aptStart <= nap.start && aptEnd >= nap.end);
                
                if (hasConflict) {
                    warnings.push({
                        severity: 'warning',
                        message: `"${apt.title}" overlaps with ${nap.title}`
                    });
                }
            });
            
            // Check meal conflicts
            meals.forEach(meal => {
                const hasConflict = (aptStart >= meal.start && aptStart < meal.end) ||
                                   (aptEnd > meal.start && aptEnd <= meal.end) ||
                                   (aptStart <= meal.start && aptEnd >= meal.end);
                
                if (hasConflict) {
                    warnings.push({
                        severity: 'info',
                        message: `"${apt.title}" during ${meal.title} time`
                    });
                }
            });
            
            // Check bath conflict
            if (bath) {
                const hasConflict = (aptStart >= bath.start && aptStart < bath.end) ||
                                   (aptEnd > bath.start && aptEnd <= bath.end) ||
                                   (aptStart <= bath.start && aptEnd >= bath.end);
                
                if (hasConflict) {
                    warnings.push({
                        severity: 'warning',
                        message: `"${apt.title}" conflicts with Bath Time`
                    });
                }
            }
        });
        
        return warnings;
    },
        const mealTimes = [
            { name: 'Lunch', start: '12:00', end: '13:00' },
            { name: 'Dinner', start: '17:30', end: '18:30' }
        ];
        
        appointments.forEach(apt => {
            mealTimes.forEach(meal => {
                const aptEnd = apt.end || addMinutes(apt.start, 60);
                const hasConflict = (apt.start >= meal.start && apt.start < meal.end) ||
                                   (aptEnd > meal.start && aptEnd <= meal.end);
                
                if (hasConflict) {
                    warnings.push({
                        severity: 'info',
                        message: `"${apt.title}" during typical ${meal.name} time`
                    });
                }
            });
        });
        
        return warnings;
    },
    
    next() {
        this.saveCurrentStep();
        if (this.currentStep < this.totalSteps) {
            this.currentStep++;
            this.renderStep();
        }
    },
    
    back() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.renderStep();
        }
    },
    
    saveCurrentStep() {
        if (this.currentStep === 1) {
            this.data.wakeTarget = document.getElementById('wakeTarget').value;
        } else if (this.currentStep === 4) {
            // Save bath decision
            const bathCheckbox = document.getElementById('scheduleBath');
            this.data.includeBath = bathCheckbox ? bathCheckbox.checked : false;
        } else if (this.currentStep === 6) {
            this.data.brainDump = document.getElementById('brainDumpText').value;
        }
    },
    
    async save() {
        const tomorrow = utils.getTomorrowString();
        
        // Save day plan
        const schedule = this.calculateSchedule();
        const planData = {
            ...this.data,
            calculatedSchedule: schedule.blocks,
            nap1Time: schedule.nap1Start,
            nap2Time: schedule.nap2Start
        };
        await db_ops.saveDayPlan(tomorrow, planData);
        
        // Update bath date if scheduled
        if (this.data.includeBath) {
            const updatedSettings = state.settings || await db_ops.getSettings();
            updatedSettings.lastBathDate = tomorrow;
            await db_ops.saveSettings(updatedSettings);
        }
        
        // Mark today's tasks as complete/incomplete
        for (const [taskId, completed] of Object.entries(this.data.todayTasksCompleted)) {
            if (completed) {
                await db_ops.updateTask(taskId, {
                    status: 'done',
                    completedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        
        // Add brain dump tasks FIRST (before assigning selected tasks)
        if (this.data.brainDump && this.data.brainDump.trim()) {
            const tasks = this.data.brainDump.split('\n').filter(t => t.trim());
            for (const task of tasks) {
                const newTask = await db_ops.addTask(task.trim());
                // If this task was selected in step 7, it needs to be assigned
                // Since we just created it, we need to track it
                if (newTask && newTask.id) {
                    // Check if task title was selected (this is a workaround)
                    // We'll need to reload tasks after brain dump
                }
            }
        }
        
        // Wait a moment for tasks to be created
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Reload tasks to get the new brain dump tasks
        state.tasks = await db_ops.getTasks();
        
        // Assign selected tasks to tomorrow
        for (const taskId of this.data.selectedTasks) {
            await db_ops.updateTask(taskId, { assignedDate: tomorrow });
        }
        
        utils.showToast('Tomorrow planned! 🎉', 'success');
        this.close();
        
        await loadData();
    }
};

// Event Handlers Setup
function setupEventHandlers() {
    // Sign out
    document.getElementById('signOutBtn').addEventListener('click', async () => {
        try {
            await auth.signOut();
        } catch (error) {
            console.error('Sign out error:', error);
        }
    });
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            document.getElementById(`${tab}Tab`).classList.add('active');
            
            if (tab === 'history') {
                ui.renderHistory();
            }
        });
    });
    
    // Wizard
    document.getElementById('openWizardBtn').addEventListener('click', () => wizard.open());
    document.getElementById('closeWizard').addEventListener('click', () => wizard.close());
    
    document.getElementById('clearPlanBtn').addEventListener('click', async () => {
        if (confirm('Clear tomorrow\'s plan? This cannot be undone.')) {
            const tomorrow = utils.getTomorrowString();
            try {
                await db.collection('families').doc(FAMILY_ID)
                    .collection('day_plans').doc(tomorrow).delete();
                utils.showToast('Plan cleared', 'success');
                await loadData();
            } catch (error) {
                console.error('Error clearing plan:', error);
                utils.showToast('Failed to clear plan', 'error');
            }
        }
    });
    
    document.querySelectorAll('.wizard-next').forEach(btn => {
        btn.addEventListener('click', () => wizard.next());
    });
    
    document.querySelectorAll('.wizard-back').forEach(btn => {
        btn.addEventListener('click', () => wizard.back());
    });
    
    document.getElementById('saveWizard').addEventListener('click', () => wizard.save());
    document.getElementById('addAppointment').addEventListener('click', () => wizard.addAppointment());
    
    // Time block add buttons (event delegation)
    document.addEventListener('click', (e) => {
        if (e.target.dataset.person && e.target.textContent.includes('Add Time Block')) {
            const person = e.target.dataset.person;
            const isHelper = ['nanny', 'kayden'].includes(person);
            wizard.addTimeBlock(person, isHelper);
        }
    });
    
    // Wizard input delegation for time blocks and appointments
    document.addEventListener('input', (e) => {
        // Time blocks
        if (e.target.dataset.person && e.target.dataset.idx !== undefined) {
            const person = e.target.dataset.person;
            const idx = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            const isHelper = e.target.dataset.helper === 'true';
            
            if (isHelper) {
                wizard.data.helpersAvailable[person][idx][field] = e.target.value;
            } else {
                wizard.data.parentUnavailable[person][idx][field] = e.target.value;
            }
        }
        
        // Appointments
        if (e.target.classList.contains('appointment-input')) {
            const idx = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            if (wizard.data.appointments[idx]) {
                wizard.data.appointments[idx][field] = e.target.value;
            }
        }
    });
    
    document.getElementById('actualWakeTime').addEventListener('change', async (e) => {
        const date = utils.getTodayString();
        const log = await db_ops.getDayLog(date) || {};
        log.actualWake = e.target.value;
        log.date = date; // Ensure date is set
        await db_ops.saveDayLog(date, log);
        await renderTodaySchedule();
        utils.showToast('Wake time updated - schedule adjusted', 'success');
    });
    
    // Nap toggles
    document.getElementById('nap1Enabled').addEventListener('change', (e) => {
        document.getElementById('nap1Controls').style.display = e.target.checked ? 'flex' : 'none';
        renderTodaySchedule();
    });
    
    document.getElementById('nap2Enabled').addEventListener('change', (e) => {
        document.getElementById('nap2Controls').style.display = e.target.checked ? 'flex' : 'none';
        renderTodaySchedule();
    });
    
    // Nap buttons
    document.querySelectorAll('.nap-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const napNum = btn.dataset.nap;
            const isStart = btn.classList.contains('start');
            const date = utils.getTodayString();
            
            const log = await db_ops.getDayLog(date) || {};
            if (!log.naps) log.naps = {};
            if (!log.naps[`nap${napNum}`]) log.naps[`nap${napNum}`] = {};
            
            if (isStart) {
                log.naps[`nap${napNum}`].start = utils.getCurrentTime();
                btn.disabled = true;
                btn.nextElementSibling.disabled = false;
            } else {
                log.naps[`nap${napNum}`].end = utils.getCurrentTime();
                btn.disabled = true;
            }
            
            await db_ops.saveDayLog(date, log);
            updateNapDisplay(napNum, log.naps[`nap${napNum}`]);
            await renderTodaySchedule();
        });
    });
    
    // Tasks
    document.getElementById('addTaskBtn').addEventListener('click', async () => {
        const input = document.getElementById('newTaskInput');
        const title = input.value.trim();
        
        if (title) {
            await db_ops.addTask(title);
            input.value = '';
        }
    });
    
    document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('addTaskBtn').click();
        }
    });
    
    // Task interactions (event delegation)
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('task-checkbox')) {
            const id = e.target.dataset.id;
            const checked = e.target.checked;
            
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
    
    // Google Calendar
    document.getElementById('connectCalendarBtn').addEventListener('click', () => {
        googleCalendar.requestAccess();
    });
    
    document.getElementById('disconnectCalendarBtn').addEventListener('click', () => {
        googleCalendar.disconnect();
    });
    
    document.getElementById('exportTodayBtn').addEventListener('click', async () => {
        const date = utils.getTodayString();
        const log = await db_ops.getDayLog(date);
        
        if (!state.todayPlan) {
            utils.showToast('No schedule to export', 'warning');
            return;
        }
        
        const blocks = scheduler.generateSchedule(
            state.todayPlan,
            log?.actualWake,
            {
                enabled: document.getElementById('nap1Enabled').checked,
                start: log?.naps?.nap1?.start,
                end: log?.naps?.nap1?.end
            },
            {
                enabled: document.getElementById('nap2Enabled').checked,
                start: log?.naps?.nap2?.start,
                end: log?.naps?.nap2?.end
            }
        );
        
        await googleCalendar.exportDay(date, blocks);
    });
    
    // Clear data
    document.getElementById('clearDataBtn').addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            try {
                const batch = db.batch();
                
                // Delete all tasks
                const tasksSnapshot = await db.collection('families').doc(FAMILY_ID)
                    .collection('tasks').get();
                tasksSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                
                // Delete all day plans
                const plansSnapshot = await db.collection('families').doc(FAMILY_ID)
                    .collection('day_plans').get();
                plansSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                
                // Delete all day logs
                const logsSnapshot = await db.collection('families').doc(FAMILY_ID)
                    .collection('day_logs').get();
                logsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                
                await batch.commit();
                
                utils.showToast('All data cleared', 'success');
                await loadData();
            } catch (error) {
                console.error('Error clearing data:', error);
                utils.showToast('Failed to clear data', 'error');
            }
        }
    });
    
    // Wizard input delegation
    document.addEventListener('input', (e) => {
        if (e.target.dataset.idx !== undefined && e.target.dataset.field) {
            const idx = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            
            if (wizard.data.appointments[idx]) {
                wizard.data.appointments[idx][field] = e.target.value;
            }
        }
        
        if (e.target.dataset.nap) {
            const nap = e.target.dataset.nap;
            const value = e.target.value;
            
            if (e.target.checked) {
                if (!wizard.data.caregiverAvailability[nap].includes(value)) {
                    wizard.data.caregiverAvailability[nap].push(value);
                }
            } else {
                wizard.data.caregiverAvailability[nap] = 
                    wizard.data.caregiverAvailability[nap].filter(v => v !== value);
            }
        }
    });
}

// Data Loading
async function loadData() {
    try {
        state.settings = await db_ops.getSettings();
        state.todayPlan = await db_ops.getDayPlan(utils.getTodayString());
        state.tomorrowPlan = await db_ops.getDayPlan(utils.getTomorrowString());
        
        document.getElementById('todayDate').textContent = utils.formatDate(utils.getTodayString());
        document.getElementById('tomorrowDate').textContent = utils.formatDate(utils.getTomorrowString());
        
        renderSettings();
        await renderTodaySchedule();
        renderTomorrowPreview();
    } catch (error) {
        console.error('Error loading data:', error);
        utils.showToast('Failed to load data', 'error');
    }
}

async function renderTodaySchedule() {
    const date = utils.getTodayString();
    const log = await db_ops.getDayLog(date);
    
    if (!state.todayPlan || !state.todayPlan.calculatedSchedule) {
        ui.renderSchedule([]);
        return;
    }
    
    // Use the pre-calculated schedule from wizard
    let blocks = [...state.todayPlan.calculatedSchedule];
    
    // Apply dynamic adjustments based on actual tracking
    if (log?.actualWake) {
        // Recalculate based on actual wake time
        blocks = scheduler.adjustScheduleForActualWake(
            state.todayPlan,
            log.actualWake,
            log.naps
        );
    }
    
    ui.renderSchedule(blocks);
}

function renderTomorrowPreview() {
    const container = document.getElementById('tomorrowPreview');
    
    if (!state.tomorrowPlan) {
        container.innerHTML = '';
        return;
    }
    
    const schedule = state.tomorrowPlan.calculatedSchedule || [];
    const naps = schedule.filter(b => b.type === 'nap');
    const appointments = state.tomorrowPlan.appointments || [];
    
    container.innerHTML = `
        <div class="control-card">
            <h4>Tomorrow's Plan</h4>
            <p><strong>Wake:</strong> ${utils.formatTime(state.tomorrowPlan.wakeTarget)}</p>
            <p><strong>Naps:</strong> ${naps.length} scheduled</p>
            <p><strong>Appointments:</strong> ${appointments.filter(a => a.title).length}</p>
        </div>
    `;
}

function updateNapDisplay(napNum, napData) {
    const timeEl = document.getElementById(`nap${napNum}Time`);
    if (napData.start && napData.end) {
        timeEl.textContent = `${utils.formatTime(napData.start)} - ${utils.formatTime(napData.end)}`;
    } else if (napData.start) {
        timeEl.textContent = `Started ${utils.formatTime(napData.start)}`;
    }
}

// Initialize App
async function init() {
    try {
        // Check Firebase config
        if (firebaseConfig.apiKey === 'YOUR_FIREBASE_API_KEY') {
            utils.showToast('Please configure Firebase in app.js', 'error');
            return;
        }
        
        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        functions = firebase.functions();
        
        // Auth state observer
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                state.user = user;
                
                // Show app, hide sign-in
                document.getElementById('signInScreen').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                
                // Display user
                const userBadge = document.getElementById('userBadge');
                userBadge.textContent = user.displayName || user.email;
                
                // Load data
                await loadData();
                
                // Setup real-time listeners
                const tasksUnsubscribe = db_ops.listenToTasks((tasks) => {
                    state.tasks = tasks;
                    ui.renderTasks(tasks);
                });
                state.unsubscribers.push(tasksUnsubscribe);
                
                // Setup event handlers (only once)
                if (!window.handlersSetup) {
                    setupEventHandlers();
                    window.handlersSetup = true;
                }
            } else {
                // Show sign-in, hide app
                document.getElementById('signInScreen').style.display = 'flex';
                document.getElementById('app').style.display = 'none';
                
                // Cleanup listeners
                state.unsubscribers.forEach(unsub => unsub());
                state.unsubscribers = [];
            }
        });
        
        // Sign in button
        document.getElementById('signInBtn').addEventListener('click', async () => {
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                await auth.signInWithPopup(provider);
            } catch (error) {
                console.error('Sign in error:', error);
                utils.showToast('Failed to sign in', 'error');
            }
        });
        
        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./service-worker.js')
                .then(() => console.log('Service Worker registered'))
                .catch(err => console.error('Service Worker registration failed:', err));
        }
        
    } catch (error) {
        console.error('Initialization error:', error);
        utils.showToast('Failed to initialize app', 'error');
    }
}

// Start app
init();

