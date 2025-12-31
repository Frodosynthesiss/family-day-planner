// Family Day Planner - Main Application
// Configuration
const CONFIG = {
    PASSWORD: 'JuneR0cks!',
    SPACE_ID: 'default',
    USERS: ['Kristyn', 'Julio', 'Nanny', 'Kayden'],
    SUPABASE_URL: 'YOUR_SUPABASE_URL', // Replace with actual Supabase URL
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY', // Replace with actual Supabase anon key
    SERVERLESS_ENDPOINT: 'YOUR_SERVERLESS_ENDPOINT' // Replace with serverless function URL
};

// Supabase client initialization
let supabase = null;

// Initialize Supabase
function initSupabase() {
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase client not loaded');
        return false;
    }
    try {
        supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        return true;
    } catch (error) {
        console.error('Error initializing Supabase:', error);
        return false;
    }
}

// State management
const state = {
    isUnlocked: false,
    currentTab: 'evening',
    settings: null,
    todayPlan: null,
    tomorrowPlan: null,
    tasks: [],
    dayLogs: {},
    wizardStep: 1,
    wizardData: {}
};

// Utility functions
const utils = {
    formatDate(date) {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    }
};

// Database operations
const db = {
    async getSettings() {
        try {
            const { data, error } = await supabase
                .from('settings')
                .select('*')
                .eq('space_id', CONFIG.SPACE_ID)
                .single();
            
            if (error && error.code !== 'PGRST116') throw error;
            
            return data || {
                space_id: CONFIG.SPACE_ID,
                data: {
                    constraints: [
                        { name: 'Nap 1 Duration', value: '90 min' },
                        { name: 'Nap 2 Duration', value: '90 min' },
                        { name: 'Wake Window Before Nap 1', value: '2.5 hrs' },
                        { name: 'Wake Window Between Naps', value: '3 hrs' },
                        { name: 'Bedtime Target', value: '7:00 PM' }
                    ],
                    googleCalendar: null
                }
            };
        } catch (error) {
            console.error('Error getting settings:', error);
            return null;
        }
    },
    
    async saveSettings(data) {
        try {
            const { error } = await supabase
                .from('settings')
                .upsert({
                    space_id: CONFIG.SPACE_ID,
                    data,
                    updated_at: new Date().toISOString()
                });
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error saving settings:', error);
            utils.showToast('Failed to save settings', 'error');
            return false;
        }
    },
    
    async getDayPlan(date) {
        try {
            const { data, error } = await supabase
                .from('day_plans')
                .select('*')
                .eq('space_id', CONFIG.SPACE_ID)
                .eq('date', date)
                .single();
            
            if (error && error.code !== 'PGRST116') throw error;
            return data;
        } catch (error) {
            console.error('Error getting day plan:', error);
            return null;
        }
    },
    
    async saveDayPlan(date, planData) {
        try {
            const { error } = await supabase
                .from('day_plans')
                .upsert({
                    space_id: CONFIG.SPACE_ID,
                    date,
                    data: planData
                });
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error saving day plan:', error);
            utils.showToast('Failed to save plan', 'error');
            return false;
        }
    },
    
    async getDayLog(date) {
        try {
            const { data, error } = await supabase
                .from('day_logs')
                .select('*')
                .eq('space_id', CONFIG.SPACE_ID)
                .eq('date', date)
                .single();
            
            if (error && error.code !== 'PGRST116') throw error;
            return data;
        } catch (error) {
            console.error('Error getting day log:', error);
            return null;
        }
    },
    
    async saveDayLog(date, logData) {
        try {
            const { error } = await supabase
                .from('day_logs')
                .upsert({
                    space_id: CONFIG.SPACE_ID,
                    date,
                    data: logData
                });
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error saving day log:', error);
            utils.showToast('Failed to save log', 'error');
            return false;
        }
    },
    
    async getTasks() {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('space_id', CONFIG.SPACE_ID)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting tasks:', error);
            return [];
        }
    },
    
    async addTask(title, assignedDate = null) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .insert({
                    space_id: CONFIG.SPACE_ID,
                    title,
                    status: 'open',
                    assigned_date: assignedDate,
                    meta: {}
                })
                .select()
                .single();
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error adding task:', error);
            utils.showToast('Failed to add task', 'error');
            return null;
        }
    },
    
    async updateTask(id, updates) {
        try {
            const { error } = await supabase
                .from('tasks')
                .update(updates)
                .eq('id', id);
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error updating task:', error);
            utils.showToast('Failed to update task', 'error');
            return false;
        }
    },
    
    async deleteTask(id) {
        try {
            const { error } = await supabase
                .from('tasks')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error deleting task:', error);
            utils.showToast('Failed to delete task', 'error');
            return false;
        }
    },
    
    async getRecentLogs(limit = 10) {
        try {
            const { data, error } = await supabase
                .from('day_logs')
                .select('*')
                .eq('space_id', CONFIG.SPACE_ID)
                .order('date', { ascending: false })
                .limit(limit);
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting recent logs:', error);
            return [];
        }
    }
};

// Schedule generation
const scheduler = {
    generateSchedule(plan, actualWake, nap1Data, nap2Data) {
        const blocks = [];
        let currentTime = actualWake || plan.wakeTarget || '07:00';
        
        // Helper to add minutes to time
        const addMinutes = (time, minutes) => {
            const [h, m] = time.split(':').map(Number);
            const date = new Date();
            date.setHours(h, m + minutes);
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        };
        
        // Helper to parse duration
        const parseDuration = (duration) => {
            const match = duration.match(/(\d+\.?\d*)\s*(hr|min)/);
            if (!match) return 0;
            const value = parseFloat(match[1]);
            return match[2] === 'hr' ? value * 60 : value;
        };
        
        // Add wake block
        blocks.push({
            start: currentTime,
            end: addMinutes(currentTime, 30),
            title: 'Wake & Morning Routine',
            type: 'routine',
            caregiver: 'Available'
        });
        
        currentTime = addMinutes(currentTime, 30);
        
        // Get constraints
        const constraints = state.settings?.data?.constraints || [];
        const wakeWindow1 = parseDuration(constraints.find(c => c.name === 'Wake Window Before Nap 1')?.value || '2.5 hrs');
        const napDuration1 = parseDuration(constraints.find(c => c.name === 'Nap 1 Duration')?.value || '90 min');
        const wakeWindow2 = parseDuration(constraints.find(c => c.name === 'Wake Window Between Naps')?.value || '3 hrs');
        const napDuration2 = parseDuration(constraints.find(c => c.name === 'Nap 2 Duration')?.value || '90 min');
        
        // Handle Nap 1
        if (nap1Data.enabled) {
            const nap1Start = nap1Data.start || addMinutes(currentTime, wakeWindow1 - 30);
            const nap1End = nap1Data.end || addMinutes(nap1Start, napDuration1);
            
            // Open time before nap
            if (currentTime < nap1Start) {
                blocks.push({
                    start: currentTime,
                    end: nap1Start,
                    title: 'Open Time',
                    type: 'open',
                    caregiver: 'Anyone'
                });
            }
            
            // Nap 1
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
                    
                    // Open time before appointment
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
            
            // Open time before nap
            if (currentTime < nap2Start) {
                blocks.push({
                    start: currentTime,
                    end: nap2Start,
                    title: 'Open Time',
                    type: 'open',
                    caregiver: 'Anyone'
                });
            }
            
            // Nap 2
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
        
        // Sort blocks by start time
        blocks.sort((a, b) => a.start.localeCompare(b.start));
        
        return blocks;
    }
};

// Google Calendar integration
const googleCalendar = {
    async connect() {
        try {
            const response = await fetch(`${CONFIG.SERVERLESS_ENDPOINT}/auth/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spaceId: CONFIG.SPACE_ID })
            });
            
            if (!response.ok) throw new Error('Failed to start OAuth flow');
            
            const { authUrl } = await response.json();
            window.location.href = authUrl;
        } catch (error) {
            console.error('Error connecting Google Calendar:', error);
            utils.showToast('Failed to connect Google Calendar', 'error');
        }
    },
    
    async disconnect() {
        try {
            await fetch(`${CONFIG.SERVERLESS_ENDPOINT}/auth/disconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spaceId: CONFIG.SPACE_ID })
            });
            
            state.settings.data.googleCalendar = null;
            await db.saveSettings(state.settings.data);
            
            renderSettings();
            utils.showToast('Google Calendar disconnected', 'success');
        } catch (error) {
            console.error('Error disconnecting:', error);
            utils.showToast('Failed to disconnect', 'error');
        }
    },
    
    async exportDay(date, blocks) {
        try {
            if (!state.settings?.data?.googleCalendar?.connected) {
                utils.showToast('Please connect Google Calendar first', 'warning');
                return;
            }
            
            // Filter out open blocks
            const exportBlocks = blocks.filter(b => b.type !== 'open');
            
            const events = exportBlocks.map(block => ({
                summary: `Family Planner — ${block.title}`,
                description: block.caregiver ? `Caregiver: ${block.caregiver}` : '',
                start: { dateTime: `${date}T${block.start}:00` },
                end: { dateTime: `${date}T${block.end}:00` }
            }));
            
            const response = await fetch(`${CONFIG.SERVERLESS_ENDPOINT}/calendar/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    spaceId: CONFIG.SPACE_ID,
                    date,
                    events
                })
            });
            
            if (!response.ok) throw new Error('Export failed');
            
            const result = await response.json();
            
            // Store event IDs for future updates
            const log = await db.getDayLog(date);
            const logData = log?.data || {};
            logData.exportedEvents = result.eventIds;
            await db.saveDayLog(date, logData);
            
            utils.showToast('Exported to Google Calendar', 'success');
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
                    <div class="empty-state-text">No schedule for today. Set actual wake time to generate.</div>
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
    
    renderTasks() {
        const todayStr = utils.getTodayString();
        const todayTasks = state.tasks.filter(t => t.status === 'open' && t.assigned_date === todayStr);
        const brainDumpTasks = state.tasks.filter(t => t.status === 'open' && !t.assigned_date);
        const completedTasks = state.tasks.filter(t => t.status === 'done');
        
        const renderTaskList = (tasks, containerId) => {
            const container = document.getElementById(containerId);
            
            if (tasks.length === 0) {
                container.innerHTML = `<div class="empty-state-text">No tasks</div>`;
                return;
            }
            
            container.innerHTML = tasks.map(task => `
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
        const logs = await db.getRecentLogs(30);
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
                    ${log.data.actualWake ? `Wake: ${utils.formatTime(log.data.actualWake)}` : 'No data'}
                </div>
            </div>
        `).join('');
    }
};

function renderSettings() {
    const constraintsContainer = document.getElementById('defaultConstraints');
    const constraints = state.settings?.data?.constraints || [];
    
    constraintsContainer.innerHTML = constraints.map(c => `
        <div class="constraint-item">
            <span class="constraint-name">${c.name}</span>
            <span class="constraint-value">${c.value}</span>
        </div>
    `).join('');
    
    // Calendar status
    const statusDiv = document.getElementById('calendarStatus');
    const connectBtn = document.getElementById('connectCalendarBtn');
    const disconnectBtn = document.getElementById('disconnectCalendarBtn');
    
    if (state.settings?.data?.googleCalendar?.connected) {
        statusDiv.innerHTML = '<p>✓ Connected</p>';
        statusDiv.className = 'calendar-status connected';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'block';
    } else {
        statusDiv.innerHTML = '<p>Not connected</p>';
        statusDiv.className = 'calendar-status';
        connectBtn.style.display = 'block';
        disconnectBtn.style.display = 'none';
    }
}

// Evening wizard
const wizard = {
    currentStep: 1,
    data: {},
    
    open() {
        const modal = document.getElementById('wizardModal');
        modal.classList.add('active');
        
        this.currentStep = 1;
        this.data = {
            wakeTarget: '07:00',
            appointments: [],
            caregiverAvailability: { nap1: [], nap2: [] },
            constraints: state.settings?.data?.constraints || []
        };
        
        this.renderStep();
    },
    
    close() {
        const modal = document.getElementById('wizardModal');
        modal.classList.remove('active');
    },
    
    renderStep() {
        // Hide all steps
        for (let i = 1; i <= 5; i++) {
            document.getElementById(`step${i}`).style.display = 'none';
        }
        
        // Show current step
        document.getElementById(`step${this.currentStep}`).style.display = 'block';
        
        // Update step-specific content
        if (this.currentStep === 1) {
            document.getElementById('wizardDate').textContent = utils.formatDate(utils.getTomorrowString());
            document.getElementById('wakeTarget').value = this.data.wakeTarget || '07:00';
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
            container.innerHTML = '<p style="color: var(--text-muted); margin-bottom: 1rem;">No appointments added</p>';
            return;
        }
        
        container.innerHTML = this.data.appointments.map((apt, idx) => `
            <div class="appointment-item">
                <input type="text" placeholder="Title" value="${apt.title || ''}" data-idx="${idx}" data-field="title">
                <input type="time" value="${apt.start || ''}" data-idx="${idx}" data-field="start">
                <input type="time" placeholder="End (optional)" value="${apt.end || ''}" data-idx="${idx}" data-field="end">
                <button class="secondary-btn" onclick="wizard.removeAppointment(${idx})">Remove</button>
            </div>
        `).join('');
    },
    
    renderCaregivers() {
        const container = document.getElementById('caregiverAvailability');
        const availableUsers = CONFIG.USERS.filter(u => u !== 'Kayden');
        
        container.innerHTML = `
            <div style="margin-bottom: 1rem;">
                <strong>Nap 1 Available:</strong>
                ${availableUsers.map(user => `
                    <label class="caregiver-checkbox">
                        <input type="checkbox" value="${user}" 
                               ${this.data.caregiverAvailability.nap1.includes(user) ? 'checked' : ''}
                               data-nap="nap1">
                        <span>${user}</span>
                    </label>
                `).join('')}
            </div>
            <div>
                <strong>Nap 2 Available:</strong>
                ${availableUsers.map(user => `
                    <label class="caregiver-checkbox">
                        <input type="checkbox" value="${user}"
                               ${this.data.caregiverAvailability.nap2.includes(user) ? 'checked' : ''}
                               data-nap="nap2">
                        <span>${user}</span>
                    </label>
                `).join('')}
            </div>
        `;
    },
    
    renderConstraints() {
        const container = document.getElementById('constraintsList');
        container.innerHTML = this.data.constraints.map((c, idx) => `
            <div class="constraint-item">
                <span class="constraint-name">${c.name}</span>
                <input type="text" value="${c.value}" data-idx="${idx}" 
                       style="padding: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm);">
            </div>
        `).join('');
    },
    
    next() {
        // Save current step data
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
        // Get brain dump
        const brainDump = document.getElementById('brainDumpText').value;
        
        // Save plan for tomorrow
        const tomorrow = utils.getTomorrowString();
        await db.saveDayPlan(tomorrow, this.data);
        
        // Add brain dump tasks
        if (brainDump.trim()) {
            const tasks = brainDump.split('\n').filter(t => t.trim());
            for (const task of tasks) {
                await db.addTask(task.trim(), tomorrow);
            }
        }
        
        utils.showToast('Tomorrow planned!', 'success');
        this.close();
        
        // Refresh tasks and preview
        await loadData();
        renderTomorrowPreview();
    }
};

// Event handlers
function setupEventHandlers() {
    // Password form
    document.getElementById('passwordForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('passwordInput');
        const error = document.getElementById('passwordError');
        
        if (input.value === CONFIG.PASSWORD) {
            state.isUnlocked = true;
            document.getElementById('passwordGate').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            loadData();
        } else {
            error.textContent = 'Incorrect password';
            input.value = '';
        }
    });
    
    // Lock button
    document.getElementById('lockBtn').addEventListener('click', () => {
        state.isUnlocked = false;
        document.getElementById('app').style.display = 'none';
        document.getElementById('passwordGate').style.display = 'flex';
        document.getElementById('passwordInput').value = '';
    });
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // Update active states
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            document.getElementById(`${tab}Tab`).classList.add('active');
            
            state.currentTab = tab;
            
            // Load tab-specific data
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
    
    // Today tab - tracking
    document.getElementById('actualWakeTime').addEventListener('change', async (e) => {
        const date = utils.getTodayString();
        const log = await db.getDayLog(date) || { data: {} };
        log.data.actualWake = e.target.value;
        await db.saveDayLog(date, log.data);
        await renderTodaySchedule();
    });
    
    // Nap toggles
    document.getElementById('nap1Enabled').addEventListener('change', (e) => {
        document.getElementById('nap1Buttons').style.display = e.target.checked ? 'flex' : 'none';
        renderTodaySchedule();
    });
    
    document.getElementById('nap2Enabled').addEventListener('change', (e) => {
        document.getElementById('nap2Buttons').style.display = e.target.checked ? 'flex' : 'none';
        renderTodaySchedule();
    });
    
    // Nap buttons
    document.querySelectorAll('.nap-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const napNum = btn.dataset.nap;
            const isStart = btn.classList.contains('start');
            const date = utils.getTodayString();
            
            const log = await db.getDayLog(date) || { data: {} };
            if (!log.data.naps) log.data.naps = {};
            if (!log.data.naps[`nap${napNum}`]) log.data.naps[`nap${napNum}`] = {};
            
            if (isStart) {
                log.data.naps[`nap${napNum}`].start = utils.getCurrentTime();
                btn.disabled = true;
                btn.nextElementSibling.disabled = false;
            } else {
                log.data.naps[`nap${napNum}`].end = utils.getCurrentTime();
                btn.disabled = true;
            }
            
            await db.saveDayLog(date, log.data);
            updateNapDisplay(napNum, log.data.naps[`nap${napNum}`]);
            await renderTodaySchedule();
        });
    });
    
    // Tasks
    document.getElementById('addTaskBtn').addEventListener('click', async () => {
        const input = document.getElementById('newTaskInput');
        const title = input.value.trim();
        
        if (title) {
            await db.addTask(title);
            input.value = '';
            await loadTasks();
            ui.renderTasks();
        }
    });
    
    document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('addTaskBtn').click();
        }
    });
    
    // Task checkboxes and delete (event delegation)
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('task-checkbox')) {
            const id = e.target.dataset.id;
            const checked = e.target.checked;
            
            await db.updateTask(id, {
                status: checked ? 'done' : 'open',
                completed_at: checked ? new Date().toISOString() : null
            });
            
            await loadTasks();
            ui.renderTasks();
        }
        
        if (e.target.classList.contains('task-delete')) {
            const id = e.target.dataset.id;
            await db.deleteTask(id);
            await loadTasks();
            ui.renderTasks();
        }
    });
    
    // Google Calendar
    document.getElementById('connectCalendarBtn').addEventListener('click', () => {
        googleCalendar.connect();
    });
    
    document.getElementById('disconnectCalendarBtn').addEventListener('click', () => {
        googleCalendar.disconnect();
    });
    
    document.getElementById('exportTodayBtn').addEventListener('click', async () => {
        const date = utils.getTodayString();
        const log = await db.getDayLog(date);
        
        if (!state.todayPlan) {
            utils.showToast('No schedule to export', 'warning');
            return;
        }
        
        const blocks = scheduler.generateSchedule(
            state.todayPlan,
            log?.data?.actualWake,
            {
                enabled: document.getElementById('nap1Enabled').checked,
                start: log?.data?.naps?.nap1?.start,
                end: log?.data?.naps?.nap1?.end
            },
            {
                enabled: document.getElementById('nap2Enabled').checked,
                start: log?.data?.naps?.nap2?.start,
                end: log?.data?.naps?.nap2?.end
            }
        );
        
        await googleCalendar.exportDay(date, blocks);
    });
    
    // Clear data
    document.getElementById('clearDataBtn').addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            try {
                await supabase.from('tasks').delete().eq('space_id', CONFIG.SPACE_ID);
                await supabase.from('day_plans').delete().eq('space_id', CONFIG.SPACE_ID);
                await supabase.from('day_logs').delete().eq('space_id', CONFIG.SPACE_ID);
                
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
        if (e.target.dataset.idx !== undefined) {
            const idx = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            
            if (field && wizard.data.appointments[idx]) {
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

// Data loading
async function loadData() {
    try {
        state.settings = await db.getSettings();
        state.todayPlan = await db.getDayPlan(utils.getTodayString());
        state.tomorrowPlan = await db.getDayPlan(utils.getTomorrowString());
        await loadTasks();
        
        // Update UI
        document.getElementById('todayDate').textContent = utils.formatDate(utils.getTodayString());
        document.getElementById('tomorrowDate').textContent = utils.formatDate(utils.getTomorrowString());
        
        renderSettings();
        ui.renderTasks();
        await renderTodaySchedule();
        renderTomorrowPreview();
    } catch (error) {
        console.error('Error loading data:', error);
        utils.showToast('Failed to load data', 'error');
    }
}

async function loadTasks() {
    state.tasks = await db.getTasks();
}

async function renderTodaySchedule() {
    const date = utils.getTodayString();
    const log = await db.getDayLog(date);
    
    if (!state.todayPlan) {
        ui.renderSchedule([]);
        return;
    }
    
    const blocks = scheduler.generateSchedule(
        state.todayPlan,
        log?.data?.actualWake,
        {
            enabled: document.getElementById('nap1Enabled').checked,
            start: log?.data?.naps?.nap1?.start,
            end: log?.data?.naps?.nap1?.end
        },
        {
            enabled: document.getElementById('nap2Enabled').checked,
            start: log?.data?.naps?.nap2?.start,
            end: log?.data?.naps?.nap2?.end
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
        <div class="planning-card">
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
        timeEl.textContent = `Started at ${utils.formatTime(napData.start)}`;
    }
}

// Initialize app
async function init() {
    // Load Supabase from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = () => {
        if (initSupabase()) {
            setupEventHandlers();
        } else {
            utils.showToast('Failed to initialize database', 'error');
        }
    };
    document.head.appendChild(script);
    
    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(() => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
}

// Start app
init();
