// Family Day Planner - Firebase Version
// Modern, sleek implementation with Google authentication

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyA2YSjOktRbinbKMjIy1pbd_Bkbwp3ruRY",
    authDomain: "vega-payne-command-center.firebaseapp.com",
    projectId: "vega-payne-command-center",
    storageBucket: "vega-payne-command-center.firebasestorage.app",
    messagingSenderId: "325061344708",
    appId: "1:325061344708:web:397bff2f1776308a997891",
    measurementId: "G-JHR2MYTHM1"
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
    meals: [],
    lists: [],
    pendingEvents: [],
    wizardStep: 1,
    wizardData: {},
    unsubscribers: []
};

// Utility Functions
const utils = {
    formatDate(date) {
        // If it's a YYYY-MM-DD string, parse it correctly to avoid timezone issues
        if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [year, month, day] = date.split('-').map(Number);
            const d = new Date(year, month - 1, day); // month is 0-indexed
            return d.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
            });
        }
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
    
    // ICS file generation
    generateICS(events) {
        const formatICSDate = (date, time, allDay = false) => {
            const d = new Date(date + (time ? 'T' + time : ''));
            if (allDay) {
                // All-day events use YYYYMMDD format
                return d.toISOString().split('T')[0].replace(/-/g, '');
            }
            // Timed events use local time with YYYYMMDDTHHMMSS format
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            return `${year}${month}${day}T${hours}${mins}00`;
        };
        
        const generateUID = () => {
            return 'vega-payne-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        };
        
        let ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Vega-Payne Command Center//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH'
        ];
        
        events.forEach(event => {
            ics.push('BEGIN:VEVENT');
            ics.push(`UID:${generateUID()}`);
            ics.push(`DTSTAMP:${formatICSDate(new Date().toISOString().split('T')[0], new Date().toTimeString().slice(0,5))}`);
            
            if (event.allDay) {
                ics.push(`DTSTART;VALUE=DATE:${formatICSDate(event.date, null, true)}`);
                // All-day events end on the next day
                const endDate = new Date(event.date);
                endDate.setDate(endDate.getDate() + 1);
                const endDateStr = endDate.toISOString().split('T')[0];
                ics.push(`DTEND;VALUE=DATE:${formatICSDate(endDateStr, null, true)}`);
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
        const icsContent = this.generateICS(events);
        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
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
                { name: 'Wake Window 1', value: '3 hrs' },
                { name: 'Nap 1 Duration', value: '1 hr' },
                { name: 'Wake Window 2', value: '3.5 hrs' },
                { name: 'Nap 2 Duration', value: '1 hr' },
                { name: 'Wake Window 3', value: '4 hrs' }
            ],
            routineBlocks: {
                wakeUp: { duration: 10, title: 'Wake Up Time' },
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
                bedtimeRoutine: { duration: 15, title: 'Bedtime Routine' },
                buffer: { duration: 5, title: 'Buffer' }
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
    
    async clearDayLog(date) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('day_logs').doc(date).delete();
            return true;
        } catch (error) {
            console.error('Error clearing day log:', error);
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
            return docRef.id;
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
    
    // Meals
    async getMeals() {
        try {
            const snapshot = await db.collection('families').doc(FAMILY_ID)
                .collection('meals')
                .orderBy('createdAt', 'desc')
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error getting meals:', error);
            return [];
        }
    },
    
    async addMeal(content) {
        try {
            const docRef = await db.collection('families').doc(FAMILY_ID)
                .collection('meals').add({
                    content,
                    createdBy: currentUser.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            return docRef.id;
        } catch (error) {
            console.error('Error adding meal:', error);
            utils.showToast('Failed to add meal', 'error');
            return null;
        }
    },
    
    async updateMeal(id, content) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('meals').doc(id).update({
                    content,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            return true;
        } catch (error) {
            console.error('Error updating meal:', error);
            return false;
        }
    },
    
    async deleteMeal(id) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('meals').doc(id).delete();
            return true;
        } catch (error) {
            console.error('Error deleting meal:', error);
            return false;
        }
    },
    
    listenToMeals(callback) {
        const unsubscribe = db.collection('families').doc(FAMILY_ID)
            .collection('meals')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snapshot => {
                const meals = snapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data() 
                }));
                callback(meals);
            }, error => {
                console.error('Error listening to meals:', error);
            });
        return unsubscribe;
    },
    
    // Lists
    async getListItems(category) {
        try {
            const snapshot = await db.collection('families').doc(FAMILY_ID)
                .collection('lists')
                .where('category', '==', category)
                .orderBy('createdAt', 'desc')
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error getting list items:', error);
            return [];
        }
    },
    
    async addListItem(category, content) {
        try {
            const docRef = await db.collection('families').doc(FAMILY_ID)
                .collection('lists').add({
                    category,
                    content,
                    createdBy: currentUser.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            return docRef.id;
        } catch (error) {
            console.error('Error adding list item:', error);
            utils.showToast('Failed to add item', 'error');
            return null;
        }
    },
    
    async updateListItem(id, content) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('lists').doc(id).update({
                    content,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            return true;
        } catch (error) {
            console.error('Error updating list item:', error);
            return false;
        }
    },
    
    async deleteListItem(id) {
        try {
            await db.collection('families').doc(FAMILY_ID)
                .collection('lists').doc(id).delete();
            return true;
        } catch (error) {
            console.error('Error deleting list item:', error);
            return false;
        }
    },
    
    listenToLists(callback) {
        const unsubscribe = db.collection('families').doc(FAMILY_ID)
            .collection('lists')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snapshot => {
                const items = snapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data() 
                }));
                callback(items);
            }, error => {
                console.error('Error listening to lists:', error);
            });
        return unsubscribe;
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
        // Use the same detailed routine logic as wizard, but with actual data
        const blocks = [];
        let currentTime = actualWake;
        
        const addMinutes = (time, minutes) => {
            const [h, m] = time.split(':').map(Number);
            const date = new Date();
            date.setHours(h, m + minutes);
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        };
        
        const minutesBetween = (start, end) => {
            const [h1, m1] = start.split(':').map(Number);
            const [h2, m2] = end.split(':').map(Number);
            return (h2 * 60 + m2) - (h1 * 60 + m1);
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
        
        const addBuffer = () => {
            currentTime = addMinutes(currentTime, 5); // 5 minute buffer between tasks
        };
        
        // Fixed durations (in minutes) - updated wake windows
        const WAKE_WINDOW_1 = 3 * 60;    // 180 min (3 hours max)
        const WAKE_WINDOW_2 = 3.5 * 60;  // 210 min (3.5 hours max)
        const WAKE_WINDOW_3 = 4 * 60;    // 240 min (4 hours max)
        
        // Get actual nap durations if logged, otherwise use 1 hour
        const nap1Duration = napData?.nap1?.start && napData?.nap1?.end ? 
            minutesBetween(napData.nap1.start, napData.nap1.end) : 60;
        const nap2Duration = napData?.nap2?.start && napData?.nap2?.end ?
            minutesBetween(napData.nap2.start, napData.nap2.end) : 60;
        
        // Find original caregivers from plan
        const originalNap1 = plan.calculatedSchedule?.find(b => b.title === 'Nap 1');
        const nap1Caregiver = originalNap1?.caregiver || 'Available';
        const originalNap2 = plan.calculatedSchedule?.find(b => b.title === 'Nap 2');
        const nap2Caregiver = originalNap2?.caregiver || 'Available';
        
        // ========== WAKE WINDOW 1 (3 hours) ==========
        const ww1Start = currentTime;
        const ww1End = addMinutes(ww1Start, WAKE_WINDOW_1);
        
        // Fixed morning routine with buffers
        addRoutineBlock('Wake Up Time', 10);
        addBuffer();
        addRoutineBlock('Family Cuddle', 10);
        addBuffer();
        addRoutineBlock('Get Dressed', 10);
        addBuffer();
        addRoutineBlock('Breakfast Prep', 10);
        addBuffer();
        addRoutineBlock('Breakfast', 20, 'meal');
        addBuffer();
        addRoutineBlock('Brush Teeth', 5);
        addBuffer();
        
        // Nap routine starts 10min before WW1 ends (or at actual logged time)
        const napRoutine1Start = napData?.nap1?.start ? 
            addMinutes(napData.nap1.start, -10) : 
            addMinutes(ww1End, -10);
        
        // Fill with open time until nap routine
        const openTime1Duration = minutesBetween(currentTime, napRoutine1Start);
        if (openTime1Duration > 0) {
            blocks.push({
                start: currentTime,
                end: napRoutine1Start,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = napRoutine1Start;
        }
        
        // Nap Time Routine (right before nap)
        addRoutineBlock('Nap Time Routine', 10);
        
        // Nap 1 - use actual times if logged
        const nap1Start = napData?.nap1?.start || currentTime;
        const nap1End = napData?.nap1?.end || addMinutes(nap1Start, 60);
        blocks.push({
            start: nap1Start,
            end: nap1End,
            title: 'Nap 1',
            type: 'nap',
            caregiver: nap1Caregiver
        });
        currentTime = nap1End;
        
        // ========== WAKE WINDOW 2 (3.5 hours) ==========
        const ww2Start = currentTime;
        const ww2End = addMinutes(ww2Start, WAKE_WINDOW_2);
        
        addRoutineBlock('Wake Up Time', 10);
        addBuffer();
        
        // Snack needs to start 20min before WW2 ends (or before actual nap 2)
        const snack2Start = napData?.nap2?.start ?
            addMinutes(napData.nap2.start, -20) :
            addMinutes(ww2End, -20);
        
        // Lunch starts 45 min after nap 1 ends (which is ww2Start)
        // Lunch Prep is 10 min before lunch, so Lunch Prep starts at 45 - 10 = 35 min after nap end
        const lunchStart = addMinutes(ww2Start, 45);
        const lunchPrepStart = addMinutes(ww2Start, 35);
        
        // Open time before lunch prep (after Wake Up Time + buffer)
        const openTime2aDuration = minutesBetween(currentTime, lunchPrepStart);
        if (openTime2aDuration > 0) {
            blocks.push({
                start: currentTime,
                end: lunchPrepStart,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = lunchPrepStart;
        }
        
        addRoutineBlock('Lunch Prep', 10);
        addBuffer();
        addRoutineBlock('Lunch', 20, 'meal');
        addBuffer();
        
        // Open time after lunch until snack
        const openTime2bDuration = minutesBetween(currentTime, snack2Start);
        if (openTime2bDuration > 0) {
            blocks.push({
                start: currentTime,
                end: snack2Start,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = snack2Start;
        }
        
        // Snack + Milk (right before nap routine)
        addRoutineBlock('Snack + Milk', 10, 'meal');
        addBuffer();
        
        // Nap Time Routine (right before nap)
        addRoutineBlock('Nap Time Routine', 10);
        addBuffer();
        
        // Nap 2 - use actual times if logged
        const nap2Start = napData?.nap2?.start || currentTime;
        const nap2End = napData?.nap2?.end || addMinutes(nap2Start, 60);
        blocks.push({
            start: nap2Start,
            end: nap2End,
            title: 'Nap 2',
            type: 'nap',
            caregiver: nap2Caregiver
        });
        currentTime = nap2End;
        
        // ========== WAKE WINDOW 3 (4 hours) ==========
        const ww3Start = currentTime;
        const ww3End = addMinutes(ww3Start, WAKE_WINDOW_3);
        const bedtime = ww3End; // Calculated bedtime
        
        addRoutineBlock('Wake Up Time', 10);
        addBuffer();
        addRoutineBlock('Snack + Milk', 10, 'meal');
        addBuffer();
        
        // Fixed 40min open time
        addRoutineBlock('Open Time', 40, 'open');
        addBuffer();
        
        addRoutineBlock('Dinner Prep', 10);
        addBuffer();
        addRoutineBlock('Dinner', 20, 'meal');
        addBuffer();
        
        // Get bath info from plan
        const includeBath = plan.includeBath || false;
        
        // Calculate when bedtime routine needs to start
        const bedtimeRoutineStart = includeBath ? 
            addMinutes(bedtime, -40) : 
            addMinutes(bedtime, -20);
        
        // Flexible open time fills remaining space
        const openTime3Duration = minutesBetween(currentTime, bedtimeRoutineStart);
        if (openTime3Duration > 0) {
            blocks.push({
                start: currentTime,
                end: bedtimeRoutineStart,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = bedtimeRoutineStart;
        }
        
        // Bath (if scheduled in plan)
        if (includeBath) {
            const originalBath = plan.calculatedSchedule?.find(b => b.type === 'bath');
            blocks.push({
                start: currentTime,
                end: addMinutes(currentTime, 20),
                title: 'Bath Time',
                type: 'bath',
                caregiver: originalBath?.caregiver || 'Both Parents'
            });
            currentTime = addMinutes(currentTime, 20);
            addBuffer();
        }
        
        // Brush Teeth (right before bedtime routine)
        addRoutineBlock('Brush Teeth', 5);
        addBuffer();
        
        // Bedtime Routine (right before bedtime)
        addRoutineBlock('Bedtime Routine', 15);
        
        // ========== INSERT APPOINTMENTS ==========
        const appointments = plan.appointments || [];
        const sortedAppointments = appointments
            .filter(apt => apt.start && apt.title)
            .sort((a, b) => a.start.localeCompare(b.start));
        
        for (const apt of sortedAppointments) {
            const aptStart = apt.start;
            const aptEnd = apt.end || addMinutes(aptStart, 60);
            
            // Find which open time block contains this appointment
            let insertIndex = blocks.findIndex(b => 
                b.type === 'open' && 
                aptStart >= b.start && 
                aptStart < b.end
            );
            
            if (insertIndex !== -1) {
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
                
                // Open time after appointment
                if (aptEnd < openBlock.end) {
                    newBlocks.push({
                        start: aptEnd,
                        end: openBlock.end,
                        title: 'Open Time',
                        type: 'open',
                        caregiver: 'Anyone'
                    });
                }
                
                blocks.splice(insertIndex, 1, ...newBlocks);
            }
        }
        
        // Sort all blocks by start time
        blocks.sort((a, b) => a.start.localeCompare(b.start));
        
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
        
        // Also fetch plans for each date to show full schedule
        const logsWithPlans = await Promise.all(logs.map(async (log) => {
            const plan = await db_ops.getDayPlan(log.date);
            return { ...log, plan };
        }));
        
        container.innerHTML = logsWithPlans.map(log => {
            const hasNaps = log.naps && (log.naps.nap1 || log.naps.nap2);
            const hasSchedule = log.plan?.calculatedSchedule?.length > 0;
            
            let detailsHtml = '<div class="history-details">';
            
            // Wake time
            if (log.actualWake) {
                detailsHtml += `<div class="history-detail-row"><strong>Wake Time:</strong> ${utils.formatTime(log.actualWake)}</div>`;
            }
            
            // Naps
            if (hasNaps) {
                if (log.naps.nap1?.start) {
                    detailsHtml += `<div class="history-detail-row"><strong>Nap 1:</strong> ${utils.formatTime(log.naps.nap1.start)}${log.naps.nap1.end ? ' - ' + utils.formatTime(log.naps.nap1.end) : ' (in progress)'}</div>`;
                }
                if (log.naps.nap2?.start) {
                    detailsHtml += `<div class="history-detail-row"><strong>Nap 2:</strong> ${utils.formatTime(log.naps.nap2.start)}${log.naps.nap2.end ? ' - ' + utils.formatTime(log.naps.nap2.end) : ' (in progress)'}</div>`;
                }
            }
            
            // Full schedule
            if (hasSchedule) {
                detailsHtml += `<div class="history-schedule-title">Schedule</div>`;
                detailsHtml += `<div class="history-schedule">`;
                log.plan.calculatedSchedule
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .forEach(block => {
                        detailsHtml += `
                            <div class="history-block history-block-${block.type}">
                                <span class="history-block-time">${utils.formatTime(block.start)}</span>
                                <span class="history-block-title">${block.title}</span>
                            </div>
                        `;
                    });
                detailsHtml += `</div>`;
            }
            
            if (!log.actualWake && !hasNaps && !hasSchedule) {
                detailsHtml += `<div class="history-detail-row">No details recorded</div>`;
            }
            
            detailsHtml += '</div>';
            
            return `
                <div class="history-item" data-date="${log.date}">
                    <div class="history-header">
                        <div class="history-date">${utils.formatDate(log.date)}</div>
                        <div class="history-summary">
                            ${log.actualWake ? `Wake: ${utils.formatTime(log.actualWake)}` : 'No data'}
                        </div>
                        <svg class="history-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </div>
                    ${detailsHtml}
                </div>
            `;
        }).join('');
    },
    
    renderLists(items) {
        const categories = ['groceries', 'shopping', 'notes', 'links'];
        
        categories.forEach(category => {
            const container = document.getElementById(`${category}List`);
            const categoryItems = items.filter(item => item.category === category);
            
            if (categoryItems.length === 0) {
                container.innerHTML = `<div class="empty-state-text">No items yet</div>`;
                return;
            }
            
            container.innerHTML = categoryItems.map(item => `
                <div class="list-item-card" data-id="${item.id}">
                    <div class="list-item-content" id="list-content-${item.id}">${this.linkifyText(item.content)}</div>
                    <div class="list-item-actions">
                        <button class="list-edit-btn" data-id="${item.id}" data-category="${category}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="list-delete-btn" data-id="${item.id}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                    <div class="list-edit-form" id="list-edit-${item.id}" style="display: none;">
                        <textarea class="list-textarea" rows="2">${item.content}</textarea>
                        <div class="list-input-actions">
                            <button class="secondary-btn list-cancel-edit-btn" data-id="${item.id}">Cancel</button>
                            <button class="primary-btn list-save-edit-btn" data-id="${item.id}">Save</button>
                        </div>
                    </div>
                </div>
            `).join('');
        });
    },
    
    linkifyText(text) {
        // Convert URLs to clickable links
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return escaped.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    },
    
    renderMeals(meals) {
        const container = document.getElementById('mealsList');
        
        if (meals.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🍽️</div>
                    <div class="empty-state-text">No meals planned yet</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = meals.map(meal => `
            <div class="meal-card" data-id="${meal.id}">
                <div class="meal-content" id="meal-content-${meal.id}">${meal.content}</div>
                <div class="meal-actions">
                    <button class="meal-edit-btn" data-id="${meal.id}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="meal-delete-btn" data-id="${meal.id}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
                <div class="meal-edit-form" id="meal-edit-${meal.id}" style="display: none;">
                    <textarea class="meal-textarea" rows="3">${meal.content}</textarea>
                    <div class="meal-edit-actions">
                        <button class="secondary-btn meal-cancel-btn" data-id="${meal.id}">Cancel</button>
                        <button class="primary-btn meal-save-btn" data-id="${meal.id}">Save</button>
                    </div>
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

// Evening Wizard - Comprehensive 9-step planning
const wizard = {
    currentStep: 1,
    totalSteps: 9,
    data: {},
    
    open() {
        document.getElementById('wizardModal').classList.add('active');
        this.currentStep = 1;
        this.data = {
            eveningChecklist: {
                skylightCalendar: false,
                juneGoals: false,
                householdChores: false
            },
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
                // Evening Checklist - new first step
                this.renderEveningChecklist();
                break;
            case 2:
                document.getElementById('wizardDate').textContent = utils.formatDate(utils.getTomorrowString());
                document.getElementById('wakeTarget').value = this.data.wakeTarget;
                break;
            case 3:
                this.renderAvailability();
                break;
            case 4:
                this.renderHelperAvailability();
                break;
            case 5:
                this.renderAppointments();
                await this.checkBathReminder();
                break;
            case 6:
                await this.renderTodayTaskReview();
                break;
            case 7:
                document.getElementById('brainDumpText').value = this.data.brainDump || '';
                break;
            case 8:
                await this.renderTaskSelection();
                break;
            case 9:
                this.renderSchedulePreview();
                break;
        }
    },
    
    renderEveningChecklist() {
        const container = document.getElementById('eveningChecklistItems');
        const checklist = this.data.eveningChecklist;
        
        container.innerHTML = `
            <div class="checklist-item">
                <label class="checklist-label">
                    <input type="checkbox" id="checkSkylight" ${checklist.skylightCalendar ? 'checked' : ''}>
                    <span>Is everything up to date on the Skylight calendar?</span>
                </label>
            </div>
            <div class="checklist-item">
                <label class="checklist-label">
                    <input type="checkbox" id="checkJuneGoals" ${checklist.juneGoals ? 'checked' : ''}>
                    <span>What is the status on our goals for June?</span>
                </label>
            </div>
            <div class="checklist-item">
                <label class="checklist-label">
                    <input type="checkbox" id="checkHousehold" ${checklist.householdChores ? 'checked' : ''}>
                    <span>What are the outstanding household chores?</span>
                </label>
            </div>
        `;
        
        // Add event listeners
        document.getElementById('checkSkylight').addEventListener('change', (e) => {
            this.data.eveningChecklist.skylightCalendar = e.target.checked;
        });
        document.getElementById('checkJuneGoals').addEventListener('change', (e) => {
            this.data.eveningChecklist.juneGoals = e.target.checked;
        });
        document.getElementById('checkHousehold').addEventListener('change', (e) => {
            this.data.eveningChecklist.householdChores = e.target.checked;
        });
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
        
        // Render tomorrow's tasks
        const tasksContainer = document.getElementById('tomorrowTasksPreview');
        const tomorrowTasks = state.tasks.filter(t => 
            this.data.selectedTasks.includes(t.id)
        );
        
        if (tomorrowTasks.length > 0) {
            tasksContainer.innerHTML = `
                <h4>Tomorrow's Tasks (${tomorrowTasks.length})</h4>
                <div class="task-list">
                    ${tomorrowTasks.map(task => `
                        <div class="task-preview-item">✓ ${task.title}</div>
                    `).join('')}
                </div>
            `;
            tasksContainer.style.display = 'block';
        } else {
            tasksContainer.style.display = 'none';
        }
        
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
        
        const minutesBetween = (start, end) => {
            const [h1, m1] = start.split(':').map(Number);
            const [h2, m2] = end.split(':').map(Number);
            return (h2 * 60 + m2) - (h1 * 60 + m1);
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
        
        const addBuffer = () => {
            currentTime = addMinutes(currentTime, 5); // 5 minute buffer between tasks
        };
        
        // Fixed durations (in minutes) - updated wake windows
        const WAKE_WINDOW_1 = 3 * 60;    // 180 min (3 hours max)
        const WAKE_WINDOW_2 = 3.5 * 60;  // 210 min (3.5 hours max)
        const WAKE_WINDOW_3 = 4 * 60;    // 240 min (4 hours max)
        const NAP_DURATION = 60;         // 1 hour OUTSIDE wake window
        const NAP_ROUTINE = 10;          // 10 min - INSIDE wake window (last thing before nap)
        
        // ========== WAKE WINDOW 1 (3 hours) ==========
        const ww1Start = currentTime;
        
        // Fixed morning routine with buffers
        addRoutineBlock('Wake Up Time', 10);
        addBuffer();
        addRoutineBlock('Family Cuddle', 10);
        addBuffer();
        addRoutineBlock('Get Dressed', 10);
        addBuffer();
        addRoutineBlock('Breakfast Prep', 10);
        addBuffer();
        addRoutineBlock('Breakfast', 20, 'meal');
        addBuffer();
        addRoutineBlock('Brush Teeth', 5);
        addBuffer();
        
        // Calculate when nap routine should start - last 10min of wake window
        const napRoutine1Start = addMinutes(ww1Start, WAKE_WINDOW_1 - NAP_ROUTINE);
        
        // Fill with open time until nap routine
        const openTime1Duration = minutesBetween(currentTime, napRoutine1Start);
        if (openTime1Duration > 0) {
            blocks.push({
                start: currentTime,
                end: napRoutine1Start,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = napRoutine1Start;
        }
        
        // Nap Time Routine (last thing in WW1)
        addRoutineBlock('Nap Time Routine', NAP_ROUTINE);
        
        // Now we're at the END of WW1, NAP is OUTSIDE the wake window
        const nap1Start = currentTime;
        const nap1End = addMinutes(nap1Start, NAP_DURATION);
        const nap1Caregiver = getAvailableCaregiver(nap1Start, true);
        blocks.push({
            start: nap1Start,
            end: nap1End,
            title: 'Nap 1',
            type: 'nap',
            caregiver: nap1Caregiver
        });
        currentTime = nap1End;
        
        // ========== WAKE WINDOW 2 (3.5 hours) ==========
        const ww2Start = currentTime;
        
        addRoutineBlock('Wake Up Time', 10);
        addBuffer();
        
        // Nap routine is last 10min of WW2, then nap is OUTSIDE
        const napRoutine2Start = addMinutes(ww2Start, WAKE_WINDOW_2 - NAP_ROUTINE);
        
        // Snack is 10min before nap routine
        const snack2Start = addMinutes(napRoutine2Start, -10);
        
        // Lunch starts 45 min after nap 1 ends (which is ww2Start)
        // Lunch Prep is 10 min before lunch, so Lunch Prep starts at 45 - 10 = 35 min after nap end
        const lunchStart = addMinutes(ww2Start, 45);
        const lunchPrepStart = addMinutes(ww2Start, 35);
        
        // Open time before lunch prep (after Wake Up Time + buffer)
        const openTime2aDuration = minutesBetween(currentTime, lunchPrepStart);
        if (openTime2aDuration > 0) {
            blocks.push({
                start: currentTime,
                end: lunchPrepStart,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = lunchPrepStart;
        }
        
        addRoutineBlock('Lunch Prep', 10);
        addBuffer();
        addRoutineBlock('Lunch', 20, 'meal');
        addBuffer();
        
        // Open time after lunch until snack
        const openTime2bDuration = minutesBetween(currentTime, snack2Start);
        if (openTime2bDuration > 0) {
            blocks.push({
                start: currentTime,
                end: snack2Start,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = snack2Start;
        }
        
        // Snack + Milk (right before nap routine)
        addRoutineBlock('Snack + Milk', 10, 'meal');
        addBuffer();
        
        // Nap Time Routine (last thing in WW2)
        addRoutineBlock('Nap Time Routine', NAP_ROUTINE);
        addBuffer();
        
        // Nap 2 is OUTSIDE wake window
        const nap2Start = currentTime;
        const nap2End = addMinutes(nap2Start, NAP_DURATION);
        const nap2Caregiver = getAvailableCaregiver(nap2Start, true);
        blocks.push({
            start: nap2Start,
            end: nap2End,
            title: 'Nap 2',
            type: 'nap',
            caregiver: nap2Caregiver
        });
        currentTime = nap2End;
        
        // ========== WAKE WINDOW 3 (4 hours) ==========
        const ww3Start = currentTime;
        const ww3End = addMinutes(ww3Start, WAKE_WINDOW_3);
        const bedtime = ww3End; // Bedtime is calculated!
        
        addRoutineBlock('Wake Up Time', 10);
        addBuffer();
        addRoutineBlock('Snack + Milk', 10, 'meal');
        addBuffer();
        
        // Fixed 40min open time
        addRoutineBlock('Open Time', 40, 'open');
        addBuffer();
        
        addRoutineBlock('Dinner Prep', 10);
        addBuffer();
        addRoutineBlock('Dinner', 20, 'meal');
        addBuffer();
        
        // Calculate when bedtime routine needs to start
        // Brush Teeth (5min) + Bedtime Routine (15min) = 20min before bedtime
        // If bath scheduled, add 20min more = 40min before bedtime
        const bedtimeRoutineStart = this.data.includeBath ? 
            addMinutes(bedtime, -40) : 
            addMinutes(bedtime, -20);
        
        // Flexible open time fills remaining space
        const openTime3Duration = minutesBetween(currentTime, bedtimeRoutineStart);
        if (openTime3Duration > 0) {
            blocks.push({
                start: currentTime,
                end: bedtimeRoutineStart,
                title: 'Open Time',
                type: 'open',
                caregiver: 'Anyone'
            });
            currentTime = bedtimeRoutineStart;
        }
        
        // Bath (if scheduled) - right before brush teeth
        if (this.data.includeBath) {
            const bathCaregiver = areBothParentsAvailable(currentTime) ? 
                'Both Parents' : 
                'Both Parents (UNAVAILABLE!)';
            blocks.push({
                start: currentTime,
                end: addMinutes(currentTime, 20),
                title: 'Bath Time',
                type: 'bath',
                caregiver: bathCaregiver
            });
            currentTime = addMinutes(currentTime, 20);
            addBuffer();
        }
        
        // Brush Teeth (right before bedtime routine)
        addRoutineBlock('Brush Teeth', 5);
        addBuffer();
        
        // Bedtime Routine (right before bedtime)
        addRoutineBlock('Bedtime Routine', 15);
        
        // ========== INSERT APPOINTMENTS ==========
        // Now intelligently insert appointments into open time blocks
        const sortedAppointments = [...this.data.appointments]
            .filter(apt => apt.start && apt.title)
            .sort((a, b) => a.start.localeCompare(b.start));
        
        for (const apt of sortedAppointments) {
            const aptStart = apt.start;
            const aptEnd = apt.end || addMinutes(aptStart, 60);
            
            // Find which open time block contains this appointment
            let insertIndex = blocks.findIndex(b => 
                b.type === 'open' && 
                aptStart >= b.start && 
                aptStart < b.end
            );
            
            if (insertIndex !== -1) {
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
                
                // Open time after appointment (if any remains)
                if (aptEnd < openBlock.end) {
                    newBlocks.push({
                        start: aptEnd,
                        end: openBlock.end,
                        title: 'Open Time',
                        type: 'open',
                        caregiver: 'Anyone'
                    });
                }
                
                // Replace the open block with split blocks
                blocks.splice(insertIndex, 1, ...newBlocks);
            }
        }
        
        // Sort all blocks by start time
        blocks.sort((a, b) => a.start.localeCompare(b.start));
        
        return { 
            blocks, 
            nap1Start, 
            nap2Start,
            bedtime  // Return calculated bedtime
        };
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
    
    async next() {
        await this.saveCurrentStep();
        
        // If moving from brain dump (step 7) to task selection (step 8), process brain dump first
        if (this.currentStep === 7 && this.currentStep < this.totalSteps) {
            await this.processBrainDump();
        }
        
        if (this.currentStep < this.totalSteps) {
            this.currentStep++;
            await this.renderStep();
        }
    },
    
    async processBrainDump() {
        // Create tasks from brain dump immediately so they show in step 7
        if (this.data.brainDump && this.data.brainDump.trim()) {
            const tasks = this.data.brainDump.split('\n').filter(t => t.trim());
            for (const task of tasks) {
                await db_ops.addTask(task.trim());
            }
            
            // Wait a moment for tasks to be created
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Reload tasks so they appear in step 7
            state.tasks = await db_ops.getTasks();
        }
    },
    
    back() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.renderStep();
        }
    },
    
    saveCurrentStep() {
        if (this.currentStep === 2) {
            // Wake time is now step 2
            this.data.wakeTarget = document.getElementById('wakeTarget').value;
        } else if (this.currentStep === 5) {
            // Bath decision is now step 5 (Appointments)
            const bathCheckbox = document.getElementById('scheduleBath');
            this.data.includeBath = bathCheckbox ? bathCheckbox.checked : false;
        } else if (this.currentStep === 7) {
            // Brain dump is now step 7
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
        
        // Brain dump tasks were already created in step 6->7 transition
        // Just assign selected tasks to tomorrow
        for (const taskId of this.data.selectedTasks) {
            await db_ops.updateTask(taskId, { assignedDate: tomorrow });
        }
        
        utils.showToast('Tomorrow planned! 🎉', 'success');
        this.close();
        
        await loadData();
    }
};

// Edit Today's Plan
const editToday = {
    data: {},
    
    open() {
        if (!state.todayPlan) {
            utils.showToast('No plan to edit - use Evening wizard first', 'warning');
            return;
        }
        
        // Load current plan data
        this.data = {
            parentUnavailable: {
                kristyn: [...(state.todayPlan.parentUnavailable?.kristyn || [])],
                julio: [...(state.todayPlan.parentUnavailable?.julio || [])]
            },
            helpersAvailable: {
                nanny: [...(state.todayPlan.helpersAvailable?.nanny || [])],
            },
            appointments: [...(state.todayPlan.appointments || [])]
        };
        
        document.getElementById('editTodayModal').classList.add('active');
        this.render();
    },
    
    close() {
        document.getElementById('editTodayModal').classList.remove('active');
    },
    
    render() {
        this.renderTimeBlocks('kristyn', 'editKristynList');
        this.renderTimeBlocks('julio', 'editJulioList');
        this.renderTimeBlocks('nanny', 'editNannyList', true);
        this.renderAppointments();
    },
    
    renderTimeBlocks(person, containerId, isHelper = false) {
        const container = document.getElementById(containerId);
        const blocks = isHelper ? 
            this.data.helpersAvailable[person] : 
            this.data.parentUnavailable[person];
        
        if (blocks.length === 0) {
            container.innerHTML = '<p class="empty-state-text">No time blocks</p>';
            return;
        }
        
        container.innerHTML = blocks.map((block, idx) => `
            <div class="time-block-item">
                <input type="time" value="${block.start}" class="edit-time-input" data-person="${person}" data-idx="${idx}" data-field="start" data-helper="${isHelper}">
                <input type="time" value="${block.end}" class="edit-time-input" data-person="${person}" data-idx="${idx}" data-field="end" data-helper="${isHelper}">
                <button onclick="editToday.removeTimeBlock('${person}', ${idx}, ${isHelper})">×</button>
            </div>
        `).join('');
    },
    
    renderAppointments() {
        const container = document.getElementById('editAppointmentsList');
        
        if (this.data.appointments.length === 0) {
            container.innerHTML = '<p class="empty-state-text">No appointments</p>';
            return;
        }
        
        container.innerHTML = this.data.appointments.map((apt, idx) => `
            <div class="appointment-item">
                <input type="text" placeholder="Title" value="${apt.title || ''}" 
                       class="edit-apt-input" data-idx="${idx}" data-field="title">
                <input type="time" value="${apt.start || ''}" 
                       class="edit-apt-input" data-idx="${idx}" data-field="start">
                <input type="time" value="${apt.end || ''}" 
                       class="edit-apt-input" data-idx="${idx}" data-field="end">
                <button class="secondary-btn full-width" onclick="editToday.removeAppointment(${idx})">Remove</button>
            </div>
        `).join('');
    },
    
    addTimeBlock(person, isHelper = false) {
        const block = { start: '09:00', end: '12:00' };
        if (isHelper) {
            this.data.helpersAvailable[person].push(block);
        } else {
            this.data.parentUnavailable[person].push(block);
        }
        this.render();
    },
    
    removeTimeBlock(person, idx, isHelper = false) {
        if (isHelper) {
            this.data.helpersAvailable[person].splice(idx, 1);
        } else {
            this.data.parentUnavailable[person].splice(idx, 1);
        }
        this.render();
    },
    
    addAppointment() {
        this.data.appointments.push({ title: '', start: '', end: '' });
        this.render();
    },
    
    removeAppointment(idx) {
        this.data.appointments.splice(idx, 1);
        this.render();
    },
    
    async save() {
        const today = utils.getTodayString();
        
        // Update today's plan with new data
        const updatedPlan = {
            ...state.todayPlan,
            parentUnavailable: this.data.parentUnavailable,
            helpersAvailable: this.data.helpersAvailable,
            appointments: this.data.appointments
        };
        
        // Recalculate schedule with new constraints
        const schedule = wizard.calculateSchedule.call({ data: updatedPlan });
        updatedPlan.calculatedSchedule = schedule.blocks;
        
        // Save to database
        await db_ops.saveDayPlan(today, updatedPlan);
        
        // Update state and UI
        state.todayPlan = updatedPlan;
        await renderTodaySchedule();
        
        utils.showToast('Plan updated!', 'success');
        this.close();
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
        btn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent any default behavior
            e.stopPropagation(); // Stop event bubbling
            
            const tab = btn.dataset.tab;
            console.log('Switching to tab:', tab);
            
            // Remove active class from all navigation buttons
            document.querySelectorAll('.nav-item').forEach(b => {
                b.classList.remove('active');
            });
            
            // Add active class to clicked button
            btn.classList.add('active');
            
            // Hide ALL tab panes first
            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            
            // Show the selected tab pane
            const tabPaneId = `${tab}Tab`;
            const tabPane = document.getElementById(tabPaneId);
            
            if (tabPane) {
                tabPane.classList.add('active');
                console.log('Showing tab pane:', tabPaneId);
                
                // Trigger specific rendering based on tab
                if (tab === 'history') {
                    console.log('Rendering history');
                    ui.renderHistory();
                } else if (tab === 'tasks') {
                    console.log('Rendering tasks');
                    ui.renderTasks(state.tasks);
                } else if (tab === 'settings') {
                    console.log('Settings tab activated');
                    // Settings are static in HTML, no need to render
                }
            } else {
                console.error('Tab pane not found:', tabPaneId);
            }
        });
    });
    
    // Wizard
    document.getElementById('openWizardBtn').addEventListener('click', () => wizard.open());
    document.getElementById('closeWizard').addEventListener('click', () => wizard.close());
    
    // Edit Today
    document.getElementById('editTodayPlanBtn')?.addEventListener('click', () => editToday.open());
    document.getElementById('closeEditToday').addEventListener('click', () => editToday.close());
    document.getElementById('cancelEditToday').addEventListener('click', () => editToday.close());
    document.getElementById('saveEditToday').addEventListener('click', () => editToday.save());
    
    document.getElementById('editAddKristyn').addEventListener('click', () => editToday.addTimeBlock('kristyn'));
    document.getElementById('editAddJulio').addEventListener('click', () => editToday.addTimeBlock('julio'));
    document.getElementById('editAddNanny').addEventListener('click', () => editToday.addTimeBlock('nanny', true));
    document.getElementById('editAddAppointment').addEventListener('click', () => editToday.addAppointment());
    
    // Edit inputs (event delegation)
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('edit-time-input')) {
            const person = e.target.dataset.person;
            const idx = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            const isHelper = e.target.dataset.helper === 'true';
            
            if (isHelper) {
                editToday.data.helpersAvailable[person][idx][field] = e.target.value;
            } else {
                editToday.data.parentUnavailable[person][idx][field] = e.target.value;
            }
        }
        
        if (e.target.classList.contains('edit-apt-input')) {
            const idx = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            editToday.data.appointments[idx][field] = e.target.value;
        }
    });
    
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
    
    // Refresh schedule button
    document.getElementById('refreshScheduleBtn').addEventListener('click', async () => {
        const btn = document.getElementById('refreshScheduleBtn');
        btn.classList.add('spinning');
        
        try {
            await loadNapTimes();
            await renderTodaySchedule();
            renderTodayTasks();
            utils.showToast('Schedule refreshed', 'success');
        } catch (error) {
            console.error('Error refreshing:', error);
            utils.showToast('Failed to refresh', 'error');
        }
        
        setTimeout(() => btn.classList.remove('spinning'), 500);
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
                // Update input field
                document.getElementById(`nap${napNum}StartTime`).value = log.naps[`nap${napNum}`].start;
            } else if (btn.classList.contains('stop')) {
                log.naps[`nap${napNum}`].end = utils.getCurrentTime();
                // Update input field
                document.getElementById(`nap${napNum}EndTime`).value = log.naps[`nap${napNum}`].end;
            }
            
            await db_ops.saveDayLog(date, log);
            updateNapDisplay(napNum, log.naps[`nap${napNum}`]);
            await renderTodaySchedule();
            utils.showToast(`Nap ${napNum} ${isStart ? 'started' : 'stopped'}`, 'success');
        });
    });
    
    // Manual nap time update buttons
    document.getElementById('updateNap1').addEventListener('click', async () => {
        await updateManualNapTime(1);
    });
    
    document.getElementById('updateNap2').addEventListener('click', async () => {
        await updateManualNapTime(2);
    });
    
    // Manual nap time inputs trigger update on change
    ['nap1StartTime', 'nap1EndTime', 'nap2StartTime', 'nap2EndTime'].forEach(id => {
        document.getElementById(id).addEventListener('change', async (e) => {
            const napNum = id.includes('nap1') ? 1 : 2;
            await updateManualNapTime(napNum);
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
    
    // Quick Add Focus Task for Today
    document.getElementById('quickAddTaskBtn').addEventListener('click', async () => {
        const input = document.getElementById('quickAddTaskInput');
        const title = input.value.trim();
        
        if (title) {
            const todayStr = utils.getTodayString();
            // Add task and assign to today
            const taskId = await db_ops.addTask(title, todayStr);
            input.value = '';
            
            // Also update today's plan to include this task
            if (state.todayPlan) {
                if (!state.todayPlan.selectedTasks) {
                    state.todayPlan.selectedTasks = [];
                }
                if (taskId && !state.todayPlan.selectedTasks.includes(taskId)) {
                    state.todayPlan.selectedTasks.push(taskId);
                    await db_ops.saveDayPlan(todayStr, state.todayPlan);
                }
            }
            
            utils.showToast('Focus task added for today', 'success');
            renderTodayTasks();
        }
    });
    
    document.getElementById('quickAddTaskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('quickAddTaskBtn').click();
        }
    });
    
    document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('addTaskBtn').click();
        }
    });
    
    // Meals
    document.getElementById('addMealBtn').addEventListener('click', async () => {
        const input = document.getElementById('newMealInput');
        const content = input.value.trim();
        
        if (content) {
            await db_ops.addMeal(content);
            input.value = '';
            utils.showToast('Meal added', 'success');
        }
    });
    
    // Meal interactions (event delegation)
    document.addEventListener('click', async (e) => {
        // Edit button
        if (e.target.closest('.meal-edit-btn')) {
            const btn = e.target.closest('.meal-edit-btn');
            const id = btn.dataset.id;
            const contentEl = document.getElementById(`meal-content-${id}`);
            const editForm = document.getElementById(`meal-edit-${id}`);
            
            contentEl.style.display = 'none';
            btn.parentElement.style.display = 'none';
            editForm.style.display = 'block';
        }
        
        // Cancel edit button
        if (e.target.closest('.meal-cancel-btn')) {
            const btn = e.target.closest('.meal-cancel-btn');
            const id = btn.dataset.id;
            const contentEl = document.getElementById(`meal-content-${id}`);
            const editForm = document.getElementById(`meal-edit-${id}`);
            const actionsEl = contentEl.parentElement.querySelector('.meal-actions');
            
            contentEl.style.display = 'block';
            actionsEl.style.display = 'flex';
            editForm.style.display = 'none';
        }
        
        // Save edit button
        if (e.target.closest('.meal-save-btn')) {
            const btn = e.target.closest('.meal-save-btn');
            const id = btn.dataset.id;
            const editForm = document.getElementById(`meal-edit-${id}`);
            const textarea = editForm.querySelector('textarea');
            const newContent = textarea.value.trim();
            
            if (newContent) {
                await db_ops.updateMeal(id, newContent);
                utils.showToast('Meal updated', 'success');
            }
        }
        
        // Delete button
        if (e.target.closest('.meal-delete-btn')) {
            const btn = e.target.closest('.meal-delete-btn');
            const id = btn.dataset.id;
            
            if (confirm('Delete this meal?')) {
                await db_ops.deleteMeal(id);
                utils.showToast('Meal deleted', 'success');
            }
        }
    });
    
    // Lists interactions
    document.querySelectorAll('.add-list-item-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            document.getElementById(`${category}Input`).style.display = 'block';
            btn.style.display = 'none';
        });
    });
    
    document.querySelectorAll('.cancel-list-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            const inputContainer = document.getElementById(`${category}Input`);
            inputContainer.style.display = 'none';
            inputContainer.querySelector('textarea').value = '';
            document.querySelector(`.add-list-item-btn[data-category="${category}"]`).style.display = 'block';
        });
    });
    
    document.querySelectorAll('.save-list-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const category = btn.dataset.category;
            const inputContainer = document.getElementById(`${category}Input`);
            const textarea = inputContainer.querySelector('textarea');
            const content = textarea.value.trim();
            
            if (content) {
                await db_ops.addListItem(category, content);
                textarea.value = '';
                inputContainer.style.display = 'none';
                document.querySelector(`.add-list-item-btn[data-category="${category}"]`).style.display = 'block';
                utils.showToast('Item added', 'success');
            }
        });
    });
    
    // List item interactions (event delegation)
    document.addEventListener('click', async (e) => {
        // Edit button
        if (e.target.closest('.list-edit-btn')) {
            const btn = e.target.closest('.list-edit-btn');
            const id = btn.dataset.id;
            const contentEl = document.getElementById(`list-content-${id}`);
            const editForm = document.getElementById(`list-edit-${id}`);
            
            contentEl.style.display = 'none';
            btn.parentElement.style.display = 'none';
            editForm.style.display = 'block';
        }
        
        // Cancel edit
        if (e.target.closest('.list-cancel-edit-btn')) {
            const btn = e.target.closest('.list-cancel-edit-btn');
            const id = btn.dataset.id;
            const contentEl = document.getElementById(`list-content-${id}`);
            const editForm = document.getElementById(`list-edit-${id}`);
            const actionsEl = contentEl.parentElement.querySelector('.list-item-actions');
            
            contentEl.style.display = 'block';
            actionsEl.style.display = 'flex';
            editForm.style.display = 'none';
        }
        
        // Save edit
        if (e.target.closest('.list-save-edit-btn')) {
            const btn = e.target.closest('.list-save-edit-btn');
            const id = btn.dataset.id;
            const editForm = document.getElementById(`list-edit-${id}`);
            const textarea = editForm.querySelector('textarea');
            const newContent = textarea.value.trim();
            
            if (newContent) {
                await db_ops.updateListItem(id, newContent);
                utils.showToast('Item updated', 'success');
            }
        }
        
        // Delete button
        if (e.target.closest('.list-delete-btn')) {
            const btn = e.target.closest('.list-delete-btn');
            const id = btn.dataset.id;
            
            if (confirm('Delete this item?')) {
                await db_ops.deleteListItem(id);
                utils.showToast('Item deleted', 'success');
            }
        }
    });
    
    // Calendar Events functionality
    const renderPendingEvents = () => {
        const container = document.getElementById('pendingEventsList');
        const downloadBtn = document.getElementById('downloadEventsBtn');
        
        if (state.pendingEvents.length === 0) {
            container.innerHTML = '<div class="empty-state-text">No events queued</div>';
            downloadBtn.style.display = 'none';
            return;
        }
        
        downloadBtn.style.display = 'flex';
        container.innerHTML = state.pendingEvents.map((event, index) => `
            <div class="pending-event-card" data-index="${index}">
                <div class="pending-event-info">
                    <div class="pending-event-title">${event.title}</div>
                    <div class="pending-event-datetime">
                        ${utils.formatDate(event.date)}${event.allDay ? ' (All day)' : ` • ${utils.formatTime(event.startTime)}${event.endTime ? ' - ' + utils.formatTime(event.endTime) : ''}`}
                    </div>
                </div>
                <button class="pending-event-remove" data-index="${index}">×</button>
            </div>
        `).join('');
    };
    
    document.getElementById('showEventFormBtn').addEventListener('click', () => {
        document.getElementById('eventForm').style.display = 'block';
        document.getElementById('showEventFormBtn').style.display = 'none';
        // Set default date to today
        document.getElementById('eventDate').value = utils.getTodayString();
    });
    
    document.getElementById('cancelEventBtn').addEventListener('click', () => {
        document.getElementById('eventForm').style.display = 'none';
        document.getElementById('showEventFormBtn').style.display = 'block';
        // Clear form
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventDate').value = '';
        document.getElementById('eventStartTime').value = '';
        document.getElementById('eventEndTime').value = '';
        document.getElementById('eventAllDay').checked = false;
    });
    
    document.getElementById('eventAllDay').addEventListener('change', (e) => {
        const timeInputs = document.querySelectorAll('#eventStartTime, #eventEndTime');
        timeInputs.forEach(input => {
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
        
        if (!title) {
            utils.showToast('Please enter an event title', 'error');
            return;
        }
        if (!date) {
            utils.showToast('Please select a date', 'error');
            return;
        }
        if (!allDay && !startTime) {
            utils.showToast('Please enter a start time or mark as all day', 'error');
            return;
        }
        
        state.pendingEvents.push({ title, date, startTime, endTime, allDay });
        renderPendingEvents();
        
        // Clear form but keep it open for adding more
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventStartTime').value = '';
        document.getElementById('eventEndTime').value = '';
        document.getElementById('eventAllDay').checked = false;
        document.querySelectorAll('#eventStartTime, #eventEndTime').forEach(input => input.disabled = false);
        
        utils.showToast('Event added to list', 'success');
    });
    
    document.getElementById('pendingEventsList').addEventListener('click', (e) => {
        if (e.target.classList.contains('pending-event-remove')) {
            const index = parseInt(e.target.dataset.index);
            state.pendingEvents.splice(index, 1);
            renderPendingEvents();
            utils.showToast('Event removed', 'success');
        }
    });
    
    document.getElementById('downloadEventsBtn').addEventListener('click', () => {
        if (state.pendingEvents.length === 0) {
            utils.showToast('No events to download', 'error');
            return;
        }
        
        const filename = state.pendingEvents.length === 1 
            ? `${state.pendingEvents[0].title.replace(/[^a-z0-9]/gi, '_')}.ics`
            : `events_${utils.getTodayString()}.ics`;
        
        utils.downloadICS(state.pendingEvents, filename);
        utils.showToast('Calendar file downloaded', 'success');
        
        // Clear events after download
        state.pendingEvents = [];
        renderPendingEvents();
        
        // Hide the form
        document.getElementById('eventForm').style.display = 'none';
        document.getElementById('showEventFormBtn').style.display = 'block';
    });
    
    // Initialize pending events display
    renderPendingEvents();
    
    // History accordion
    document.getElementById('historyList').addEventListener('click', (e) => {
        const historyItem = e.target.closest('.history-item');
        if (historyItem && e.target.closest('.history-header')) {
            historyItem.classList.toggle('expanded');
        }
    });
    
    // Settings link from History page
    document.getElementById('openSettingsBtn').addEventListener('click', () => {
        // Show settings tab
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        document.getElementById('settingsTab').classList.add('active');
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    });
    
    // Task interactions (event delegation)
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('task-checkbox') || e.target.classList.contains('task-checkbox-today')) {
            const id = e.target.dataset.id;
            const checked = e.target.checked;
            
            await db_ops.updateTask(id, {
                status: checked ? 'done' : 'open',
                completedAt: checked ? firebase.firestore.FieldValue.serverTimestamp() : null
            });
            
            // Update UI
            if (e.target.classList.contains('task-checkbox-today')) {
                renderTodayTasks();
            }
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
                enabled: !!(log?.naps?.nap1?.start || log?.naps?.nap1?.end),
                start: log?.naps?.nap1?.start,
                end: log?.naps?.nap1?.end
            },
            {
                enabled: !!(log?.naps?.nap2?.start || log?.naps?.nap2?.end),
                start: log?.naps?.nap2?.start,
                end: log?.naps?.nap2?.end
            }
        );
        
        await googleCalendar.exportDay(date, blocks);
    });
    
    // Clear today's log
    document.getElementById('clearTodayLogBtn').addEventListener('click', async () => {
        if (confirm('Clear today\'s wake time and nap data? Your plan will stay intact.')) {
            const today = utils.getTodayString();
            const success = await db_ops.clearDayLog(today);
            
            if (success) {
                // Clear the input fields
                document.getElementById('actualWakeTime').value = '';
                document.getElementById('nap1StartTime').value = '';
                document.getElementById('nap1EndTime').value = '';
                document.getElementById('nap2StartTime').value = '';
                document.getElementById('nap2EndTime').value = '';
                
                // Re-render schedule (will show plan without adjustments)
                await renderTodaySchedule();
                
                utils.showToast('Today\'s log cleared', 'success');
            } else {
                utils.showToast('Failed to clear log', 'error');
            }
        }
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

// Helper Functions
async function updateManualNapTime(napNum) {
    const date = utils.getTodayString();
    const startInput = document.getElementById(`nap${napNum}StartTime`);
    const endInput = document.getElementById(`nap${napNum}EndTime`);
    
    const log = await db_ops.getDayLog(date) || {};
    if (!log.naps) log.naps = {};
    if (!log.naps[`nap${napNum}`]) log.naps[`nap${napNum}`] = {};
    
    if (startInput.value) {
        log.naps[`nap${napNum}`].start = startInput.value;
    }
    if (endInput.value) {
        log.naps[`nap${napNum}`].end = endInput.value;
    }
    
    await db_ops.saveDayLog(date, log);
    updateNapDisplay(napNum, log.naps[`nap${napNum}`]);
    await renderTodaySchedule();
    utils.showToast(`Nap ${napNum} time updated`, 'success');
}

async function loadNapTimes() {
    const date = utils.getTodayString();
    
    // Always clear all fields first to prevent stale data
    document.getElementById('actualWakeTime').value = '';
    document.getElementById('nap1StartTime').value = '';
    document.getElementById('nap1EndTime').value = '';
    document.getElementById('nap2StartTime').value = '';
    document.getElementById('nap2EndTime').value = '';
    
    // Get today's log (document ID is the date, so this is date-specific)
    const log = await db_ops.getDayLog(date);
    
    if (!log) return; // No log for today yet
    
    // Load actual wake time if it exists
    if (log.actualWake) {
        document.getElementById('actualWakeTime').value = log.actualWake;
    }
    
    // Load nap 1 times if they exist
    if (log.naps?.nap1?.start) {
        document.getElementById('nap1StartTime').value = log.naps.nap1.start;
    }
    if (log.naps?.nap1?.end) {
        document.getElementById('nap1EndTime').value = log.naps.nap1.end;
    }
    
    // Load nap 2 times if they exist
    if (log.naps?.nap2?.start) {
        document.getElementById('nap2StartTime').value = log.naps.nap2.start;
    }
    if (log.naps?.nap2?.end) {
        document.getElementById('nap2EndTime').value = log.naps.nap2.end;
    }
}

// Data Loading
async function loadData() {
    try {
        state.settings = await db_ops.getSettings();
        state.todayPlan = await db_ops.getDayPlan(utils.getTodayString());
        state.tomorrowPlan = await db_ops.getDayPlan(utils.getTomorrowString());
        
        document.getElementById('todayDate').textContent = utils.formatDate(utils.getTodayString());
        document.getElementById('tomorrowDate').textContent = utils.formatDate(utils.getTomorrowString());
        
        // Show/hide edit button based on whether plan exists
        const planActions = document.getElementById('planActions');
        if (planActions) {
            planActions.style.display = state.todayPlan ? 'block' : 'none';
        }
        
        renderSettings();
        await renderTodaySchedule();
        renderTomorrowPreview();
        renderTodayTasks();
        await loadNapTimes();
    } catch (error) {
        console.error('Error loading data:', error);
        utils.showToast('Failed to load data', 'error');
    }
}

function renderTodayTasks() {
    const todayStr = utils.getTodayString();
    const todayTasks = state.tasks.filter(t => t.assignedDate === todayStr);
    const container = document.getElementById('todayTasksList');
    
    if (todayTasks.length === 0) {
        container.innerHTML = '<div class="empty-state-text">No focus tasks for today yet</div>';
        return;
    }
    
    container.innerHTML = todayTasks.map(task => `
        <div class="task-item ${task.status === 'done' ? 'completed' : ''}">
            <input type="checkbox" 
                   class="task-checkbox-today"
                   data-id="${task.id}"
                   ${task.status === 'done' ? 'checked' : ''}>
            <label>${task.title}</label>
            <button class="task-delete" data-id="${task.id}">×</button>
        </div>
    `).join('');
}

async function renderTodaySchedule() {
    const date = utils.getTodayString();
    const log = await db_ops.getDayLog(date);
    
    // Render availability summary if plan exists
    renderAvailabilitySummary();
    
    // Only use nap data if it has valid start times (not just any truthy value)
    let validNapData = null;
    if (log?.naps) {
        validNapData = {};
        // Only include nap1 if it has a properly formatted start time (HH:MM)
        if (log.naps.nap1?.start && /^\d{2}:\d{2}$/.test(log.naps.nap1.start)) {
            validNapData.nap1 = log.naps.nap1;
        }
        // Only include nap2 if it has a properly formatted start time
        if (log.naps.nap2?.start && /^\d{2}:\d{2}$/.test(log.naps.nap2.start)) {
            validNapData.nap2 = log.naps.nap2;
        }
        // If no valid naps, set to null
        if (!validNapData.nap1 && !validNapData.nap2) {
            validNapData = null;
        }
    }
    
    // If we have a plan with calculated schedule, use it
    if (state.todayPlan && state.todayPlan.calculatedSchedule) {
        let blocks = [...state.todayPlan.calculatedSchedule];
        
        // Apply dynamic adjustments based on actual tracking
        if (log?.actualWake) {
            blocks = scheduler.adjustScheduleForActualWake(
                state.todayPlan,
                log.actualWake,
                validNapData
            );
        }
        
        ui.renderSchedule(blocks);
        return;
    }
    
    // If no plan exists but wake time is set, generate a basic schedule for testing
    if (log?.actualWake) {
        // Create a minimal plan structure for testing
        const testPlan = {
            wakeTarget: log.actualWake,
            constraints: state.settings?.constraints || scheduler.getDefaultConstraints(),
            calculatedSchedule: null, // Will be generated
            parentUnavailable: { kristyn: [], julio: [] },
            helpersAvailable: { nanny: [], kayden: [] },
            appointments: [],
            includeBath: false
        };
        
        const blocks = scheduler.adjustScheduleForActualWake(
            testPlan,
            log.actualWake,
            validNapData
        );
        
        ui.renderSchedule(blocks);
        return;
    }
    
    // No plan and no wake time - show empty
    ui.renderSchedule([]);
}

function renderAvailabilitySummary() {
    const container = document.getElementById('availabilitySummary');
    
    if (!state.todayPlan) {
        container.style.display = 'none';
        return;
    }
    
    const plan = state.todayPlan;
    const parentUnavailable = plan.parentUnavailable || { kristyn: [], julio: [] };
    const helpersAvailable = plan.helpersAvailable || { nanny: [], kayden: [] };
    
    // Check if there's any availability info to show
    const hasAvailability = 
        parentUnavailable.kristyn?.length > 0 ||
        parentUnavailable.julio?.length > 0 ||
        helpersAvailable.nanny?.length > 0 ||
        helpersAvailable.kayden?.length > 0;
    
    if (!hasAvailability) {
        container.style.display = 'none';
        return;
    }
    
    const formatTimeRange = (block) => `${utils.formatTime(block.start)}-${utils.formatTime(block.end)}`;
    
    let html = '<h4>Today\'s Availability</h4><div class="availability-grid">';
    
    // Kristyn Unavailable
    if (parentUnavailable.kristyn?.length > 0) {
        html += `
            <div class="availability-person">
                <div class="availability-icon unavailable">👩</div>
                <div class="availability-details">
                    <div class="availability-name">Kristyn Unavailable</div>
                    <div class="availability-times">
                        ${parentUnavailable.kristyn.map(block => 
                            `<span class="availability-badge unavailable">${formatTimeRange(block)}</span>`
                        ).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    
    // Julio Unavailable
    if (parentUnavailable.julio?.length > 0) {
        html += `
            <div class="availability-person">
                <div class="availability-icon unavailable">👨</div>
                <div class="availability-details">
                    <div class="availability-name">Julio Unavailable</div>
                    <div class="availability-times">
                        ${parentUnavailable.julio.map(block => 
                            `<span class="availability-badge unavailable">${formatTimeRange(block)}</span>`
                        ).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    
    // Nanny Available
    if (helpersAvailable.nanny?.length > 0) {
        html += `
            <div class="availability-person">
                <div class="availability-icon available">👶</div>
                <div class="availability-details">
                    <div class="availability-name">Nanny Available</div>
                    <div class="availability-times">
                        ${helpersAvailable.nanny.map(block => 
                            `<span class="availability-badge available">${formatTimeRange(block)}</span>`
                        ).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    
    // Kayden Available
    if (helpersAvailable.kayden?.length > 0) {
        html += `
            <div class="availability-person">
                <div class="availability-icon available">👧</div>
                <div class="availability-details">
                    <div class="availability-name">Kayden Available</div>
                    <div class="availability-times">
                        ${helpersAvailable.kayden.map(block => 
                            `<span class="availability-badge available">${formatTimeRange(block)}</span>`
                        ).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
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
                    renderTodayTasks(); // Also update Today tab
                });
                state.unsubscribers.push(tasksUnsubscribe);
                
                const mealsUnsubscribe = db_ops.listenToMeals((meals) => {
                    state.meals = meals;
                    ui.renderMeals(meals);
                });
                state.unsubscribers.push(mealsUnsubscribe);
                
                const listsUnsubscribe = db_ops.listenToLists((items) => {
                    state.lists = items;
                    ui.renderLists(items);
                });
                state.unsubscribers.push(listsUnsubscribe);
                
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

