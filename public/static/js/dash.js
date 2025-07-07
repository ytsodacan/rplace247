const IS_DEV_MODE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const WEBSOCKET_URL = IS_DEV_MODE ?
    `ws://${window.location.host}/ws` :
    `wss://${window.location.host}/ws`;

let adminSocket = null;
let adminData = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let sanityCheckInterval = null;
let pixelLogEntries = [];
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 1000;
const SANITY_CHECK_INTERVAL = 5 * 60 * 1000;
const MAX_PIXEL_LOG_ENTRIES = 50;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM Content Loaded - starting dashboard initialization');
        init();
    });
} else {
    console.log('DOM already ready - starting dashboard initialization immediately');
    init();
}

async function init() {
    try {
        console.log('Initializing admin dashboard...');

        await setAdminUserData();
        console.log('Admin user data set:', adminData);

        showDashboard();
        console.log('Dashboard shown');

        setupEventListeners();
        console.log('Event listeners set up');

        connectWebSocket();
        console.log('WebSocket connection initiated');

        startSanityCheck();
        console.log('Sanity check started');

        fetchGridUpdateStatus();
        console.log('Grid update status fetched');

        renderPixelLog(pixelLogEntries);
        console.log('Pixel log rendered');

        console.log('Dashboard initialization completed successfully');
    } catch (error) {
        console.error('Dashboard initialization failed:', error);

        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.innerHTML = `
                <div class="loading-content">
                    <p style="color: red;">Failed to initialize dashboard: ${error.message}</p>
                    <button onclick="location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Retry</button>
                    <button onclick="window.location.href='/'" style="margin-top: 10px; margin-left: 10px; padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Go Back</button>
                </div>
            `;
        }

        setTimeout(() => {
            redirectToLogin();
        }, 5000);
    }
}

async function setAdminUserData() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get('token');

    if (tokenParam) {
        localStorage.setItem('discord_token', tokenParam);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const userData = localStorage.getItem('user_data');

    if (userData) {
        try {
            const user = JSON.parse(userData);
            adminData = {
                isAdmin: true,
                username: user.username || 'Admin'
            };
        } catch (e) {
            adminData = {
                isAdmin: true,
                username: 'Admin'
            };
        }
    } else {
        adminData = {
            isAdmin: true,
            username: 'Admin'
        };
    }
}

function redirectToLogin() {
    localStorage.removeItem('discord_token');
    localStorage.removeItem('user_data');

    const loadingScreen = document.getElementById('authLoadingScreen');
    if (loadingScreen) {
        loadingScreen.innerHTML = `
            <div class="text-center">
                <div class="text-white text-lg mb-4">Authentication failed. Redirecting to login...</div>
                <div class="loading"></div>
            </div>
        `;
    }

    setTimeout(() => {
        window.location.href = '/index.html';
    }, 1000);
}

function showDashboard() {
    const dashboardContainer = document.getElementById('dashboardContainer');

    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }

    loadAdminContent();

    if (adminData?.username) {
        const usernameElement = document.getElementById('adminUsername');
        if (usernameElement) {
            usernameElement.textContent = adminData.username;
        }
    }

    initTheme();

    if (dashboardContainer) {
        dashboardContainer.classList.add('loaded');
        dashboardContainer.style.visibility = 'visible';
    }
}

function loadAdminContent() {
    const dashboardContainer = document.getElementById('dashboardContainer');

    if (!dashboardContainer) {
        console.error('Dashboard container not found!');
        return;
    }

    const adminHTML = `
        <!-- Header -->
        <header class="dashboard-header">
            <div class="header-content">
                <h1 class="dashboard-title">Neuro.Place Admin Dashboard</h1>
                <div class="admin-info">
                    <span class="admin-username" id="adminUsername">Loading...</span>
                    <!-- Theme Toggle Button -->
                    <button id="themeToggleBtn" class="btn-icon" title="Toggle Dark Mode">
                        <span class="material-icons-round">dark_mode</span>
                    </button>
                    <button class="btn btn-primary" onclick="window.location.href='/'">
                        <span class="material-icons-round">arrow_back</span>
                        Back to Main Site
                    </button>
                    <button class="btn btn-logout" onclick="logout()">Logout</button>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="grid-container">
            <!-- Grid Preview Section -->
            <section class="panel">
                <h2>Grid Preview</h2>
                <div class="grid-preview">
                    <canvas id="adminGridCanvas" width="400" height="400"></canvas>
                    <button class="btn btn-primary" onclick="fetchAndDrawGridPreview()">Update Preview</button>
                </div>
            </section>

            <!-- Live Stats Section -->
            <section class="panel">
                <h2>Live Statistics</h2>
                <div class="stats-container">
                    <div class="stat-box">
                        <div class="stat-value" id="activeConnections">0</div>
                        <div class="stat-label">Active Connections</div>
                    </div>
                </div>
            </section>

            <!-- Pixel Placement Log Section -->
            <section class="panel">
                <h2>Pixel Placement Log</h2>
                <div class="pixel-log" id="pixelLog">
                    <div class="text-center">Loading pixel log...</div>
                </div>
            </section>

            <!-- Admin Actions Section -->
            <section class="panel">
                <h2>Admin Actions</h2>

                <!-- Force Disconnect Session -->
                <div class="action-section">
                    <h4>Force Disconnect Session</h4>
                    <div class="action-controls">
                        <input type="text" class="input-field" id="sessionIdInput" placeholder="Session ID">
                        <button class="btn btn-danger" onclick="handleForceDisconnect()">Disconnect</button>
                    </div>
                </div>

                <!-- Push Toast Message -->
                <div class="action-section">
                    <h4>Push Toast Message</h4>
                    <div class="action-controls">
                        <input type="text" class="input-field" id="toastMessageInput" placeholder="Message">
                        <select class="select-field" id="toastTypeSelect">
                            <option value="info">Info</option>
                            <option value="success">Success</option>
                            <option value="warning">Warning</option>
                            <option value="error">Error</option>
                        </select>
                        <button class="btn btn-info" onclick="handlePushToast()">Send Toast</button>
                    </div>
                </div>

                <!-- Push Announcement -->
                <div class="action-section">
                    <h4>Push Announcement</h4>
                    <div class="action-controls">
                        <input type="text" class="input-field" id="announcementInput"
                            placeholder="Announcement message">
                        <button class="btn btn-warning" onclick="handlePushAnnouncement()">Send Announcement</button>
                    </div>
                </div>

                <!-- Update Status Page Message -->
                <div class="action-section">
                    <h4>Update Status Page Message</h4>
                    <div class="action-controls">
                        <textarea class="textarea-field" id="statusMessageInput"
                            placeholder="Status message (leave empty to clear)"></textarea>
                        <button class="btn btn-primary" onclick="handleUpdateStatusMessage()">Update Status</button>
                    </div>
                </div>

                <!-- Grid Updates Control -->
                <div class="action-section">
                    <h4>Grid Updates Control</h4>
                    <div class="action-controls">
                        <span class="status-indicator" id="gridUpdateStatus">Loading...</span>
                        <button class="btn btn-danger" id="pauseUpdatesBtn" onclick="toggleGridUpdates(true)">Pause
                            Updates</button>
                        <button class="btn btn-success" id="resumeUpdatesBtn" onclick="toggleGridUpdates(false)">Resume
                            Updates</button>
                    </div>
                </div>

                <!-- Grid Manipulation -->
                <div class="action-section">
                    <h4>Grid Manipulation</h4>
                    <div class="action-controls">
                        <input type="number" class="input-field" id="gridXInput" placeholder="X" min="0" max="999">
                        <input type="number" class="input-field" id="gridYInput" placeholder="Y" min="0" max="999">
                        <input type="color" class="input-field" id="gridColorInput" value="#ffffff">
                        <button class="btn btn-primary" onclick="handleSetPixel()">Set Pixel</button>
                        <button class="btn btn-warning" onclick="handleClearPixel()">Clear Pixel</button>
                        <button class="btn btn-danger" onclick="handleClearFullGrid()">Clear Entire Grid</button>
                    </div>
                </div>

                <!-- Countdown Timer Control -->
                <div class="action-section">
                    <h4>Countdown Timer</h4>
                    <div class="action-controls">
                        <span class="status-indicator" id="timerStatus">Inactive</span>
                        <input type="number" class="input-field" id="timerMinutesInput" placeholder="Minutes" min="1" max="1440" value="1">
                        <button class="btn btn-success" id="startTimerBtn" onclick="handleStartTimer()">Start Timer</button>
                        <button class="btn btn-danger" id="stopTimerBtn" onclick="handleStopTimer()">Stop Timer</button>
                    </div>
                </div>
            </section>
        </main>
    `;

    try {
        dashboardContainer.innerHTML = adminHTML;
        console.log('Admin content loaded successfully');
    } catch (error) {
        console.error('Failed to load admin content:', error);
        dashboardContainer.innerHTML = '<div class="text-center">Failed to load admin dashboard. Please refresh the page.</div>';
    }
}

function redirectToFiltered() {
    const loadingScreen = document.getElementById('authLoadingScreen');
    if (loadingScreen) {
        loadingScreen.innerHTML = `
            <div class="text-center">
                <div class="text-white text-lg mb-4">Access denied. Redirecting...</div>
                <div class="loading"></div>
            </div>
        `;
    }

    setTimeout(() => {
        window.location.href = '/filtered.html';
    }, 1000);
}

function logout() {
    localStorage.removeItem('discord_token');
    localStorage.removeItem('user_data');
    if (adminSocket) {
        adminSocket.close();
    }
    redirectToLogin();
}

function connectWebSocket() {
    const token = localStorage.getItem('discord_token');
    if (!token) {
        redirectToLogin();
        return;
    }

    try {
        adminSocket = new WebSocket(WEBSOCKET_URL);

        adminSocket.onopen = () => {
            console.log('Admin dashboard WebSocket connected');
            reconnectAttempts = 0;

            adminSocket.send(JSON.stringify({
                type: 'admin_dashboard_subscribe',
                token: token
            }));
        };

        adminSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };

        adminSocket.onclose = (event) => {
            console.log('Admin dashboard WebSocket disconnected:', event.code, event.reason);
            attemptReconnect();
        };

        adminSocket.onerror = (error) => {
            console.error('Admin dashboard WebSocket error:', error);
        };

    } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        attemptReconnect();
    }
}

function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('Max reconnection attempts reached. Falling back to periodic checks.');
        return;
    }

    reconnectAttempts++;
    const delay = RECONNECT_DELAY * 2 ** (reconnectAttempts - 1);

    console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimeout = setTimeout(() => {
        connectWebSocket();
    }, delay);
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'pong':
            break;

        case 'admin_stats_update':
            updateDashboardStats(data.stats);
            break;

        case 'admin_pixel_log_update':
            updatePixelLog(data.logEntries);
            break;

        case 'admin_connections_update':
            updateConnectionCount(data.count);
            break;

        case 'admin_grid_status_update':
            updateGridStatus(data.isPaused);
            break;

        case 'broadcast':
            console.log('Received broadcast:', data);
            break;

        case 'announcement': {
            const announcement = data.announcement || data.message || '';
            if (announcement) {
                alert(`📢 Announcement: ${announcement}`);
                console.log('Received announcement:', announcement);
            }
            break;
        }

        case 'pixelUpdate':
            if (data.x !== undefined && data.y !== undefined && data.color !== undefined) {
                addPixelLogEntry(data.x, data.y, data.color, data.sessionId);
            }
            break;

        case 'grid_pause_status':
            if (data.isPaused !== undefined) {
                updateGridStatus(data.isPaused);
            }
            break;

        case 'activeUsers':
            if (data.activeUsers !== undefined) {
                updateConnectionCount(data.activeUsers.length || data.count || 0);
            }
            break;

        case 'timer_status_update':
            if (data.isActive !== undefined) {
                updateTimerStatusDisplay(data.isActive);
            }
            break;

        default:
            console.log('Unhandled WebSocket message type:', data.type);
    }
}

function updateDashboardStats(stats) {
    if (stats.activeConnections !== undefined) {
        document.getElementById('activeConnections').textContent = stats.activeConnections;
    }

    if (stats.pixelLog) {
        renderPixelLog(stats.pixelLog);
    }

    if (stats.gridUpdatesPaused !== undefined) {
        updateGridUpdateStatusDisplay(stats.gridUpdatesPaused);
    }
}

function updateConnectionCount(count) {
    document.getElementById('activeConnections').textContent = count;
}

function updatePixelLog(logEntries) {
    renderPixelLog(logEntries);
}

function updateGridStatus(isPaused) {
    updateGridUpdateStatusDisplay(isPaused);
}

function startSanityCheck() {
    sanityCheckInterval = setInterval(() => {
        performSanityCheck();
    }, SANITY_CHECK_INTERVAL);

    setTimeout(performSanityCheck, 10000);
}

async function performSanityCheck() {
    console.log('Performing client-side sanity check...');

    const token = localStorage.getItem('discord_token');
    const userData = localStorage.getItem('user_data');

    if (!token || !userData) {
        console.log('Sanity check: No auth data found, redirecting to login');
        redirectToLogin();
        return;
    }

    if (!adminSocket || adminSocket.readyState !== WebSocket.OPEN) {
        console.log('Sanity check: WebSocket disconnected, attempting reconnect');
        connectWebSocket();
    }

    if (adminSocket && adminSocket.readyState === WebSocket.OPEN) {
        try {
            adminSocket.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
            console.error('Sanity check: Failed to send ping:', error);
        }
    }
}

async function fetchAndDrawGridPreview() {
    try {
        const token = localStorage.getItem('discord_token');
        const response = await fetch('/admin/grid-snapshot', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch grid: ${response.status}`);
        }

        const data = await response.json();
        let gridData;

        if (data.chunks) {
            gridData = assembleChunks(data.chunks, data.gridSize || 1000);
        } else {
            gridData = data.grid || data;
        }

        drawGridPreview(gridData);
    } catch (error) {
        console.error('Failed to fetch grid preview:', error);
        alert(`Failed to fetch grid preview: ${error.message}`);
    }
}

function assembleChunks(chunks, gridSize) {
    const grid = new Array(gridSize * gridSize).fill(0xFFFFFF);

    for (const chunk of chunks) {
        const startIdx = chunk.startIdx;
        const pixels = chunk.pixels;

        for (let i = 0; i < pixels.length; i++) {
            if (startIdx + i < grid.length) {
                grid[startIdx + i] = pixels[i];
            }
        }
    }

    return grid;
}

function drawGridPreview(gridData) {
    const canvas = document.getElementById('adminGridCanvas');
    const ctx = canvas.getContext('2d');
    const gridSize = Math.sqrt(gridData.length);
    const pixelSize = canvas.width / gridSize;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < gridData.length; i++) {
        const x = i % gridSize;
        const y = Math.floor(i / gridSize);
        const color = gridData[i];

        const r = (color >> 16) & 0xFF;
        const g = (color >> 8) & 0xFF;
        const b = color & 0xFF;

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
    }
}

function renderPixelLog(logEntries) {
    const logContainer = document.getElementById('pixelLog');

    if (!logEntries || logEntries.length === 0) {
        logContainer.innerHTML = '<div class="text-center">No pixel placements yet</div>';
        return;
    }

    const logHTML = logEntries.map(entry => {
        const timestamp = new Date(entry.timestamp).toLocaleString();
        const colorHex = `#${entry.color.toString(16).padStart(6, '0')}`;

        return `
            <div class="pixel-log-entry">
                <div class="flex items-center">
                    <div class="pixel-color" style="background-color: ${colorHex}"></div>
                    <span class="pixel-coords">(${entry.x}, ${entry.y})</span>
                    <span class="ml-2">${entry.sessionId || 'Unknown'}</span>
                    <span class="ml-2 text-sm">${entry.inputMethod || 'click'}</span>
                </div>
                <div class="pixel-timestamp">${timestamp}</div>
            </div>
        `;
    }).join('');

    logContainer.innerHTML = logHTML;
}

function addPixelLogEntry(x, y, color, sessionId) {
    const logEntry = {
        x: x,
        y: y,
        color: color,
        sessionId: sessionId || 'Unknown',
        timestamp: new Date().toISOString()
    };

    pixelLogEntries.unshift(logEntry);

    if (pixelLogEntries.length > MAX_PIXEL_LOG_ENTRIES) {
        pixelLogEntries = pixelLogEntries.slice(0, MAX_PIXEL_LOG_ENTRIES);
    }

    renderPixelLog(pixelLogEntries);
}

async function handleAdminAction(endpoint, body, successMessage, method = 'POST') {
    try {
        const token = localStorage.getItem('discord_token');
        const response = await fetch(endpoint, {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: method !== 'GET' ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const responseData = await response.json();
        alert(successMessage || 'Action completed successfully');

        return responseData;
    } catch (error) {
        console.error('Admin action failed:', error);
        alert(`Action failed: ${error.message}`);
        throw error;
    }
}

async function handleForceDisconnect() {
    const sessionId = document.getElementById('sessionIdInput').value.trim();
    if (!sessionId) {
        alert('Please enter a session ID');
        return;
    }

    await handleAdminAction('/admin/disconnect-session', { sessionId }, 'Session disconnected');
    document.getElementById('sessionIdInput').value = '';
}

async function handlePushToast() {
    const message = document.getElementById('toastMessageInput').value.trim();
    const type = document.getElementById('toastTypeSelect').value;

    if (!message) {
        alert('Please enter a message');
        return;
    }

    await handleAdminAction('/admin/toast', { message, type }, 'Toast message sent');
    document.getElementById('toastMessageInput').value = '';
}

async function handlePushAnnouncement() {
    const message = document.getElementById('announcementInput').value.trim();
    if (!message) {
        alert('Please enter an announcement message');
        return;
    }

    await handleAdminAction('/admin/announcement', { announcement: message }, 'Announcement sent');
    document.getElementById('announcementInput').value = '';
}

async function handleUpdateStatusMessage() {
    const message = document.getElementById('statusMessageInput').value.trim();

    await handleAdminAction('/admin/status-update', { message }, 'Status message updated');
    document.getElementById('statusMessageInput').value = '';
}

async function toggleGridUpdates(pause) {
    await handleAdminAction('/admin/pause-updates', { pause }, pause ? 'Grid updates paused' : 'Grid updates resumed');
}

async function fetchGridUpdateStatus() {
    try {
        const token = localStorage.getItem('discord_token');
        const response = await fetch('/admin/pause-status', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            updateGridUpdateStatusDisplay(data.updatesPaused);
        }
    } catch (error) {
        console.error('Failed to fetch grid update status:', error);
    }
}

function updateGridUpdateStatusDisplay(isPaused) {
    const statusElement = document.getElementById('gridUpdateStatus');
    const pauseBtn = document.getElementById('pauseUpdatesBtn');
    const resumeBtn = document.getElementById('resumeUpdatesBtn');

    if (isPaused) {
        statusElement.textContent = 'PAUSED';
        statusElement.className = 'status-indicator status-paused';
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'inline-block';
    } else {
        statusElement.textContent = 'ACTIVE';
        statusElement.className = 'status-indicator status-active';
        if (pauseBtn) pauseBtn.style.display = 'inline-block';
        if (resumeBtn) resumeBtn.style.display = 'none';
    }
}

async function handleSetPixel() {
    const x = parseInt(document.getElementById('gridXInput').value);
    const y = parseInt(document.getElementById('gridYInput').value);
    const colorHex = document.getElementById('gridColorInput').value;

    if (Number.isNaN(x) || Number.isNaN(y) || x < 0 || y < 0 || x >= 1000 || y >= 1000) {
        alert('Please enter valid coordinates (0-999)');
        return;
    }

    const color = parseInt(colorHex.slice(1), 16);

    await handleAdminAction('/admin/grid-manipulate', {
        action: 'set_pixel',
        x: x,
        y: y,
        color: color
    }, `Pixel set at (${x}, ${y})`);

    document.getElementById('gridXInput').value = '';
    document.getElementById('gridYInput').value = '';
}

async function handleClearPixel() {
    const x = parseInt(document.getElementById('gridXInput').value);
    const y = parseInt(document.getElementById('gridYInput').value);

    if (Number.isNaN(x) || Number.isNaN(y) || x < 0 || y < 0 || x >= 1000 || y >= 1000) {
        alert('Please enter valid coordinates (0-999)');
        return;
    }

    await handleAdminAction('/admin/grid-manipulate', {
        action: 'set_pixel',
        x: x,
        y: y,
        color: 0xFFFFFF
    }, `Pixel cleared at (${x}, ${y})`);

    document.getElementById('gridXInput').value = '';
    document.getElementById('gridYInput').value = '';
}

async function handleClearFullGrid() {
    if (!confirm('Are you sure you want to clear the entire grid? This action cannot be undone.')) {
        return;
    }

    await handleAdminAction('/admin/grid-clear', {}, 'Entire grid cleared');
}

async function handleStartTimer() {
    const minutes = parseInt(document.getElementById('timerMinutesInput').value);
    if (Number.isNaN(minutes) || minutes < 1 || minutes > 1440) {
        alert('Please enter a valid number of minutes (1-1440)');
        return;
    }

    try {
        await handleAdminAction('/admin/timer-start', { minutes }, `Timer started for ${minutes} minutes`);
        updateTimerStatusDisplay(true);
        document.getElementById('timerMinutesInput').value = '';
    } catch (error) {
        console.error('Failed to start timer:', error);
    }
}

async function handleStopTimer() {
    try {
        await handleAdminAction('/admin/timer-stop', {}, 'Timer stopped');
        updateTimerStatusDisplay(false);
    } catch (error) {
        console.error('Failed to stop timer:', error);
    }
}

function updateTimerStatusDisplay(isActive) {
    const statusElement = document.getElementById('timerStatus');
    const startBtn = document.getElementById('startTimerBtn');
    const stopBtn = document.getElementById('stopTimerBtn');

    if (isActive) {
        statusElement.textContent = 'ACTIVE';
        statusElement.className = 'status-indicator status-active';
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-block';
    } else {
        statusElement.textContent = 'INACTIVE';
        statusElement.className = 'status-indicator status-paused';
        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';
    }
}

function toggleDark() {
    console.log("Toggle dark mode called");
    document.documentElement.classList.toggle("dark");
    const isDark = document.documentElement.classList.contains("dark");
    console.log("Dark mode is now:", isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeIcon = themeToggleBtn?.querySelector(".material-icons-round");
    if (themeIcon) {
        themeIcon.textContent = isDark ? "light_mode" : "dark_mode";
        console.log("Theme icon updated to:", themeIcon.textContent);
    } else {
        console.log("Theme icon element not found");
    }
}

function initTheme() {
    console.log("initTheme called");
    const savedTheme = localStorage.getItem("theme");
    console.log("Saved theme from localStorage:", savedTheme);

    const themeToggleBtn = document.getElementById('themeToggleBtn');

    if (savedTheme === "dark") {
        console.log("Applying dark theme");
        document.documentElement.classList.add("dark");
        const themeIcon = themeToggleBtn?.querySelector(".material-icons-round");
        if (themeIcon) {
            themeIcon.textContent = "light_mode";
            console.log("Theme icon set to light_mode");
        } else {
            console.log("Theme icon element not found in initTheme");
        }
    } else if (savedTheme === "light") {
        console.log("Applying light theme");
        document.documentElement.classList.remove("dark");
        const themeIcon = themeToggleBtn?.querySelector(".material-icons-round");
        if (themeIcon) {
            themeIcon.textContent = "dark_mode";
            console.log("Theme icon set to dark_mode");
        } else {
            console.log("Theme icon element not found in initTheme");
        }
    } else {
        console.log("No saved theme, using default");
    }
}

function setupEventListeners() {
    window.logout = logout;
    window.fetchAndDrawGridPreview = fetchAndDrawGridPreview;
    window.handleForceDisconnect = handleForceDisconnect;
    window.handlePushToast = handlePushToast;
    window.handlePushAnnouncement = handlePushAnnouncement;
    window.handleUpdateStatusMessage = handleUpdateStatusMessage;
    window.toggleGridUpdates = toggleGridUpdates;
    window.handleSetPixel = handleSetPixel;
    window.handleClearPixel = handleClearPixel;
    window.handleClearFullGrid = handleClearFullGrid;
    window.handleStartTimer = handleStartTimer;
    window.handleStopTimer = handleStopTimer;

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", toggleDark);
    }
}

window.addEventListener('beforeunload', () => {
    if (sanityCheckInterval) {
        clearInterval(sanityCheckInterval);
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    if (adminSocket) {
        adminSocket.close();
    }
});
