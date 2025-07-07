// Timer configuration and state management
class CountdownTimer {
    constructor() {
        this.intervalId = null;
        this.targetDate = null;
        this.isActive = false;
        this.onComplete = null;
        this.onUpdate = null;
        
        // Time constants
        this.SECOND = 1000;
        this.MINUTE = this.SECOND * 60;
        this.HOUR = this.MINUTE * 60;
        this.DAY = this.HOUR * 24;
        
        // Default event data (fallback)
        this.defaultEventConfig = {
            month: 7,
            day: 8,
            year: 2025,
            hour: 9,
            minute: 0,
            second: 0,
            timezone: 10
        };
    }

    // Initialize timer with admin-provided duration or default event
    init(durationMinutes = null, eventName = 'event') {
        if (durationMinutes) {
            // Admin-triggered timer: count down from now + duration
            this.targetDate = new Date(Date.now() + (durationMinutes * this.MINUTE));
        } else {
            // Default event timer
            this.targetDate = this.calculateDefaultEventDate();
        }
        
        this.updateEventName(eventName);
        return this;
    }

    calculateDefaultEventDate() {
        const config = this.defaultEventConfig;
        const tempDate = new Date(Date.UTC(
            config.year,
            config.month - 1,
            config.day,
            config.hour - config.timezone,
            config.minute,
            config.second
        ));
        
        // If the date has passed this year, move to next year
        const now = Date.now();
        if (tempDate.getTime() < now) {
            tempDate.setUTCFullYear(tempDate.getUTCFullYear() + 1);
        }
        
        return tempDate;
    }

    updateEventName(eventName) {
        const headlineElement = document.getElementById("headline");
        const eventNameElement = document.getElementById("event-name");
        
        if (eventNameElement) {
            eventNameElement.textContent = eventName;
        }
        if (headlineElement && !headlineElement.textContent.includes("It's here!")) {
            headlineElement.innerHTML = `Countdown until <span id="event-name">${eventName}</span>`;
        }
    }

    start(updateInterval = 100) {
        if (this.isActive) {
            console.warn('Timer is already active');
            return this;
        }
        
        if (!this.targetDate) {
            console.error('Timer target date not set. Call init() first.');
            return this;
        }
        
        this.isActive = true;
        this.intervalId = setInterval(() => {
            this.updateDisplay();
        }, updateInterval);
        
        // Initial update
        this.updateDisplay();
        return this;
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isActive = false;
        return this;
    }

    updateDisplay() {
        if (!this.targetDate) return;
        
        const now = Date.now();
        const distance = this.targetDate.getTime() - now;

        if (distance <= 0) {
            this.handleCompletion();
            return;
        }

        // Calculate time components
        const days = Math.floor(distance / this.DAY);
        const hours = Math.floor((distance % this.DAY) / this.HOUR);
        const minutes = Math.floor((distance % this.HOUR) / this.MINUTE);
        const seconds = Math.floor((distance % this.MINUTE) / this.SECOND);

        // Update DOM elements safely
        this.safeUpdateElement("days", days);
        this.safeUpdateElement("hours", hours);
        this.safeUpdateElement("minutes", minutes);
        this.safeUpdateElement("seconds", seconds);

        // Call update callback if provided
        if (this.onUpdate) {
            this.onUpdate({ days, hours, minutes, seconds, distance });
        }
    }

    safeUpdateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value.toString().padStart(2, '0');
        }
    }

    handleCompletion() {
        this.stop();
        
        // Update display
        const headlineElement = document.getElementById("headline");
        const countdownElement = document.getElementById("countdown");
        const contentElement = document.getElementById("content");
        
        if (headlineElement) {
            headlineElement.textContent = "Time's up!";
        }
        if (countdownElement) {
            countdownElement.style.display = "none";
        }
        if (contentElement) {
            contentElement.style.display = "block";
        }
        
        // Call completion callback if provided
        if (this.onComplete) {
            this.onComplete();
        }
    }

    // Static method to create and start a timer
    static create(durationMinutes = null, eventName = 'event') {
        return new CountdownTimer().init(durationMinutes, eventName).start();
    }

    // Get remaining time in various formats
    getTimeRemaining() {
        if (!this.targetDate) return null;
        
        const now = Date.now();
        const distance = this.targetDate.getTime() - now;
        
        if (distance <= 0) return { expired: true };
        
        return {
            total: distance,
            days: Math.floor(distance / this.DAY),
            hours: Math.floor((distance % this.DAY) / this.HOUR),
            minutes: Math.floor((distance % this.HOUR) / this.MINUTE),
            seconds: Math.floor((distance % this.MINUTE) / this.SECOND),
            expired: false
        };
    }
}

// Global timer instance
let globalTimer = null;

// Initialize with default event countdown
function initDefaultTimer() {
    if (globalTimer) {
        globalTimer.stop();
    }
    globalTimer = CountdownTimer.create();
}

// Admin function to start custom timer
function startAdminTimer(durationMinutes, eventName = 'admin event') {
    if (globalTimer) {
        globalTimer.stop();
    }
    globalTimer = CountdownTimer.create(durationMinutes, eventName);
    return globalTimer;
}

// Admin function to stop timer
function stopAdminTimer() {
    if (globalTimer) {
        globalTimer.stop();
        globalTimer = null;
    }
}

// Expose functions globally for admin dashboard
window.startAdminTimer = startAdminTimer;
window.stopAdminTimer = stopAdminTimer;
window.CountdownTimer = CountdownTimer;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDefaultTimer);
} else {
    initDefaultTimer();
}