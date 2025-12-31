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
        return new Date().toISOString().split('T')[0];
    },
    
    getTomorrowString() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
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
                { name: 'Nap 1 Duration', value: '90 min' },
                { name: 'Nap 2 Duration', value: '90 min' },
                { name: 'Wake Window Before Nap 1', value: '2.5 hrs' },
                { name: 'Wake Window Between Naps', value: '3 hrs' },
                { name: 'Bedtime Target', value: '7:00 PM' }
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

// Evening Wizard
const wizard = {
    currentStep: 1,
    data: {},
    
    open() {
        document.getElementById('wizardModal').classList.add('active');
        this.currentStep = 1;
        this.data = {
            wakeTarget: '07:00',
            appointments: [],
            caregiverAvailability: { nap1: [], nap2: [] },
            constraints: state.settings?.constraints || scheduler.getDefaultConstraints()
        };
        this.renderStep();
    },
    
    close() {
        document.getElementById('wizardModal').classList.remove('active');
    },
    
    renderStep() {
        // Hide all steps
        for (let i = 1; i <= 5; i++) {
            document.getElementById(`step${i}`).style.display = 'none';
        }
        
        // Show current step
        document.getElementById(`step${this.currentStep}`).style.display = 'block';
        
        // Update progress
        const progressFill = document.getElementById('wizardProgress');
        const progressText = document.getElementById('wizardProgressText');
        progressFill.style.width = `${(this.currentStep / 5) * 100}%`;
        progressText.textContent = `Step ${this.currentStep} of 5`;
        
        // Render step content
        if (this.currentStep === 1) {
            document.getElementById('wizardDate').textContent = utils.formatDate(utils.getTomorrowString());
            document.getElementById('wakeTarget').value = this.data.wakeTarget;
        } else if (this.currentStep === 2) {
            this.renderAppointments();
        } else if (this.currentStep === 3) {
            this.renderCaregivers();
        } else if (this.currentStep === 4) {
            this.renderConstraints();
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
                       data-idx="${idx}" data-field="title">
                <input type="time" value="${apt.start || ''}" 
                       data-idx="${idx}" data-field="start">
                <input type="time" placeholder="End (optional)" value="${apt.end || ''}" 
                       data-idx="${idx}" data-field="end">
                <button class="secondary-btn full-width" onclick="wizard.removeAppointment(${idx})">Remove</button>
            </div>
        `).join('');
    },
    
    renderCaregivers() {
        const container = document.getElementById('caregiverAvailability');
        const availableUsers = USERS.filter(u => u !== 'Kayden');
        
        container.innerHTML = `
            <div class="caregiver-section">
                <h4>Nap 1</h4>
                ${availableUsers.map(user => `
                    <div class="caregiver-option">
                        <input type="checkbox" value="${user}" id="nap1-${user}"
                               ${this.data.caregiverAvailability.nap1.includes(user) ? 'checked' : ''}
                               data-nap="nap1">
                        <label for="nap1-${user}">${user}</label>
                    </div>
                `).join('')}
            </div>
            <div class="caregiver-section">
                <h4>Nap 2</h4>
                ${availableUsers.map(user => `
                    <div class="caregiver-option">
                        <input type="checkbox" value="${user}" id="nap2-${user}"
                               ${this.data.caregiverAvailability.nap2.includes(user) ? 'checked' : ''}
                               data-nap="nap2">
                        <label for="nap2-${user}">${user}</label>
                    </div>
                `).join('')}
            </div>
        `;
    },
    
    renderConstraints() {
        const container = document.getElementById('constraintsList');
        container.innerHTML = this.data.constraints.map((c, idx) => `
            <div class="constraint-item">
                <span class="constraint-name">${c.name}</span>
                <input type="text" class="time-input" value="${c.value}" data-idx="${idx}">
            </div>
        `).join('');
    },
    
    next() {
        this.saveCurrentStep();
        if (this.currentStep < 5) {
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
        }
    },
    
    addAppointment() {
        this.data.appointments.push({ title: '', start: '', end: '' });
        this.renderAppointments();
    },
    
    removeAppointment(idx) {
        this.data.appointments.splice(idx, 1);
        this.renderAppointments();
    },
    
    async save() {
        const brainDump = document.getElementById('brainDumpText').value;
        
        const tomorrow = utils.getTomorrowString();
        await db_ops.saveDayPlan(tomorrow, this.data);
        
        if (brainDump.trim()) {
            const tasks = brainDump.split('\n').filter(t => t.trim());
            for (const task of tasks) {
                await db_ops.addTask(task.trim(), tomorrow);
            }
        }
        
        utils.showToast('Tomorrow planned!', 'success');
        this.close();
        
        await loadData();
        renderTomorrowPreview();
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
    
    document.querySelectorAll('.wizard-next').forEach(btn => {
        btn.addEventListener('click', () => wizard.next());
    });
    
    document.querySelectorAll('.wizard-back').forEach(btn => {
        btn.addEventListener('click', () => wizard.back());
    });
    
    document.getElementById('saveWizard').addEventListener('click', () => wizard.save());
    document.getElementById('addAppointment').addEventListener('click', () => wizard.addAppointment());
    
    // Today tab - wake time
    document.getElementById('actualWakeTime').addEventListener('change', async (e) => {
        const date = utils.getTodayString();
        const log = await db_ops.getDayLog(date) || {};
        log.actualWake = e.target.value;
        await db_ops.saveDayLog(date, log);
        await renderTodaySchedule();
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
    
    if (!state.todayPlan) {
        ui.renderSchedule([]);
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
    
    ui.renderSchedule(blocks);
}

function renderTomorrowPreview() {
    const container = document.getElementById('tomorrowPreview');
    
    if (!state.tomorrowPlan) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = `
        <div class="control-card">
            <h4>Tomorrow's Details</h4>
            <p>Wake target: ${utils.formatTime(state.tomorrowPlan.wakeTarget)}</p>
            <p>Appointments: ${state.tomorrowPlan.appointments?.length || 0}</p>
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

