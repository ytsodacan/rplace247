document.addEventListener("DOMContentLoaded", () => {
    const earlyThemeToggleBtn = document.getElementById("themeToggleBtn");
    if (earlyThemeToggleBtn) {
        console.log("Found theme toggle button early");
        const savedTheme = localStorage.getItem("theme");
        if (savedTheme === "dark") {
            document.documentElement.classList.add("dark");
            const icon = earlyThemeToggleBtn.querySelector(".material-icons-round");
            if (icon) icon.textContent = "light_mode";
        }
    } else {
        console.log("Theme toggle button not found early");
    }

    const BACKEND_URL = `${window.location.origin}`;
    const IS_DEV_MODE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const WEBSOCKET_URL = IS_DEV_MODE ?
        `ws://${window.location.host}/ws` :
        `wss://${window.location.host}/ws`;
    const OAUTH_CLIENT_ID = "1388712213002457118";

    console.log(`GridTender: Dev mode detected: ${IS_DEV_MODE}`);
    console.log(`GridTender: WebSocket URL: ${WEBSOCKET_URL}`);

    const OAUTH_REDIRECT_URI = `${window.location.origin}/callback`;

    const PIXEL_SIZE = 10;

    const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2;
    const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR;
    const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR;

    const CLICK_THRESHOLD = 5;

    const canvas = document.getElementById("neuroCanvas");
    const ctx = canvas.getContext("2d");

    const liveViewCanvas = document.getElementById("liveViewCanvas");
    const liveViewCtx = liveViewCanvas.getContext("2d");

    const highlightCanvas = document.getElementById("neuroHighlightCanvas");
    const highlightCtx = highlightCanvas.getContext("2d");

    const pixelChatLog = document.getElementById("pixelChatLog");

    const colorPicker = document.getElementById("colorPicker");
    const customColorSwatch = document.getElementById("customColorSwatch");
    const placePixelBtn = document.getElementById("placePixelBtn");
    const selectedCoordsDisplay = document.getElementById("selectedCoords");
    const zoomInBtn = document.getElementById("zoomInBtn");
    const zoomOutBtn = document.getElementById("zoomOutBtn");
    const themeToggleBtn = document.getElementById("themeToggleBtn");
    const bottomControls = document.getElementById("themeToggle");

    console.log("Theme toggle button found:", themeToggleBtn);

    let currentColor = colorPicker.value;
    let grid = [];
    const selectedPixel = { x: null, y: null };

    let socket = null;
    let reconnectAttempts = 0;
    let fallbackMode = false;
    let fallbackPollingInterval = null;
    let lastUpdateTime = 0;
    const FALLBACK_POLL_INTERVAL = 2000;
    const MAX_RECONNECT_ATTEMPTS = 3;
    const RECONNECT_DELAY = 1000;
    const sessionId = generateSessionId();
    let pingInterval = null;
    const PING_INTERVAL = 30000;
    let userToken = localStorage.getItem("discord_token");
    let userData = JSON.parse(localStorage.getItem("user_data") || "null");

    window.initiateDiscordOAuth = () => initiateDiscordOAuth();
    window.logout = () => logout();
    window.handleOAuthCallback = () => handleOAuthCallback();

    const GRID_WIDTH = 500;
    const GRID_HEIGHT = 500;

    let scale = 1.0;
    let offsetX = 0;
    let offsetY = 0;

    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let lastClickX = 0;
    let lastClickY = 0;

    let initialPinchDistance = null;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let touchStartX = 0;
    let touchStartY = 0;

    let offscreenCanvas;
    let offscreenCtx;

    let liveViewImageData;
    let liveViewPixelData;

    const COOLDOWN_DURATION_MS = 60 * 1000;
    let lastPixelTime = parseInt(
        localStorage.getItem("lastPixelTime") || "0",
        10,
    );
    let cooldownIntervalId = null;
    let enforceCooldown = true;
    let cooldownTimerDiv;

    function setCanvasSize() {
        const canvasContainer = document.querySelector(".canvas-container");
        if (canvasContainer) {
            canvas.width = canvasContainer.clientWidth;
            canvas.height = canvasContainer.clientHeight;
            highlightCanvas.width = canvasContainer.clientWidth;
            highlightCanvas.height = canvasContainer.clientHeight;
        }

        if (liveViewCanvas) {
            liveViewCanvas.width = LIVE_VIEW_CANVAS_WIDTH;
            liveViewCanvas.height = LIVE_VIEW_CANVAS_HEIGHT;
        }

        if (grid && grid.length > 0) {
            console.log(
                "setCanvasSize: Redrawing grids due to resize and existing data.",
            );
            drawGrid();
            drawLiveViewGrid();
        } else {
            console.log("setCanvasSize: Grid data not yet available for redraw.");
        }
    }

    function hexToRgba(hex) {
        const bigint = parseInt(hex.slice(1), 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return [r, g, b, 255];
    }

    function rgbToHex(rgb) {
        if (typeof rgb === "string" && rgb.startsWith("#")) {
            return rgb;
        }

        if (Array.isArray(rgb)) {
            const [r, g, b] = rgb;
            return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        }

        if (
            typeof rgb === "string" &&
            (rgb.startsWith("rgb(") || rgb.startsWith("rgba("))
        ) {
            const values = rgb.match(/\d+/g).map(Number);
            const [r, g, b] = values;
            return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        }

        return "#000000";
    }

    async function checkBackendHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${BACKEND_URL}/grid`, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Backend responded with status: ${response.status}`);
            }

            return true;
        } catch (error) {
            console.error("Backend health check failed:", error);
            return false;
        }
    }

    function redirectToStatusPage() {
        console.log("Redirecting to status page due to backend unavailability");
        window.location.href = '/status.html';
    }

    async function getGrid() {
        try {
            const metaResponse = await fetch(`${BACKEND_URL}/grid`);
            if (!metaResponse.ok) {
                throw new Error(`HTTP error! status: ${metaResponse.status}`);
            }
            const metadata = await metaResponse.json();

            if (metadata.error) {
                throw new Error(metadata.error);
            }

            console.log(`Loading grid in ${metadata.totalChunks} chunks...`);

            const grid = Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill("#FFFFFF"));

            for (let chunkIndex = 0; chunkIndex < metadata.totalChunks; chunkIndex++) {
                const chunkResponse = await fetch(`${BACKEND_URL}/grid?chunk=${chunkIndex}`);
                if (!chunkResponse.ok) {
                    throw new Error(`HTTP error loading chunk ${chunkIndex}! status: ${chunkResponse.status}`);
                }
                const chunkData = await chunkResponse.json();

                for (let localRow = 0; localRow < chunkData.data.length; localRow++) {
                    const globalRow = chunkData.startRow + localRow;
                    if (globalRow < GRID_HEIGHT) {
                        grid[globalRow] = chunkData.data[localRow];
                    }
                }

                console.log(`Loaded chunk ${chunkIndex + 1}/${metadata.totalChunks}`);
            }

            console.log("Initial grid fetched successfully via chunked loading.");
            return grid;
        } catch (error) {
            console.error("Error fetching grid:", error);

            const isBackendUp = await checkBackendHealth();
            if (!isBackendUp) {
                console.log("Backend appears to be down, showing connection options");
                showBackendDownModal();
                return null;
            }

            alert(
                "Could not load the grid data. The backend may be experiencing temporary issues.",
            );
            return Array(GRID_HEIGHT)
                .fill(0)
                .map(() => Array(GRID_WIDTH).fill("#FFFFFF"));
        }
    }

    const sessionStartTime = Date.now();
    let firstPlacementTime = null;
    let placementCount = 0;

    function detectDevice() {
        const userAgent = navigator.userAgent;
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) {
            if (/iPad|tablet/i.test(userAgent)) return 'tablet';
            return 'mobile';
        }
        return 'desktop';
    }

    async function placePixel(x, y, color, inputMethod = 'unknown') {
        try {
            placementCount++;
            const currentTime = Date.now();
            if (!firstPlacementTime) {
                firstPlacementTime = currentTime;
            }

            const timeToFirstPlacement = firstPlacementTime - sessionStartTime;
            const sessionDuration = currentTime - sessionStartTime;

            if (window.gridTender) {
                const result = await window.gridTender.placePixel(x, y, color);
                if (result.success) {
                    console.log(`Pixel placement request sent for (${x}, ${y}) with color ${color}`);
                } else {
                    throw new Error(result.message);
                }
                return;
            }

            const headers = {
                "Content-Type": "application/json",
                "X-Input-Method": inputMethod,
                "X-Session-Id": sessionId,
                "X-Timestamp": sessionStartTime.toString(),
                "X-Session-Duration": sessionDuration.toString(),
                "X-Placement-Count": placementCount.toString(),
                "X-Time-To-First": timeToFirstPlacement.toString(),
                "X-Device-Type": detectDevice()
            };

            if (userToken) {
                headers.Authorization = `Bearer ${userToken}`;
            }

            const requestBody = {
                x,
                y,
                color,
                sessionId,
                inputMethod,
                timeToFirstPlacement,
                sessionDuration,
                placementCount,
                user: userData,
            };
            const jsonBody = JSON.stringify(requestBody);
            console.log("Sending pixel request:", requestBody);
            console.log("JSON body length:", jsonBody.length);
            console.log("JSON body:", jsonBody);

            const response = await fetch(`${BACKEND_URL}/pixel`, {
                method: "POST",
                headers,
                body: jsonBody,
            });

            if (!response.ok) {
                let errorMessage = response.statusText;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.message || response.statusText;
                } catch {
                    errorMessage = `Server error: ${response.statusText}`;
                }
                throw new Error(`Failed to place pixel: ${errorMessage}`);
            }
            console.log(
                `Pixel placement request sent for (${x}, ${y}) with color ${color}`,
            );
        } catch (error) {
            console.error("Error sending pixel update:", error);
            alert(`Failed to place pixel: ${error.message}`);
        }
    }

    function drawPixelToOffscreen(x, y, color) {
        if (!offscreenCtx) {
            console.error("Offscreen canvas context not available for drawPixel.");
            return;
        }

        const pixelX = x * PIXEL_SIZE;
        const pixelY = y * PIXEL_SIZE;

        offscreenCtx.fillStyle = color;
        offscreenCtx.fillRect(pixelX, pixelY, PIXEL_SIZE, PIXEL_SIZE);
    }

    function drawFullOffscreenGrid(grid) {
        if (!offscreenCtx || !offscreenCanvas) return;
        offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (grid[y] && grid[y][x] !== undefined) {
                    drawPixelToOffscreen(x, y, grid[y][x]);
                }
            }
        }
        console.log("Full grid drawn to offscreen canvas.");
    }

    function drawGrid() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!offscreenCanvas) return;

        ctx.save();

        // Use exact offsets for precise pixel alignment
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        ctx.drawImage(offscreenCanvas, 0, 0);

        ctx.restore();

        drawHighlight();
    }

    function drawHighlight() {
        highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

        if (selectedPixel.x !== null && selectedPixel.y !== null) {
            highlightCtx.save();

            // Use exact offsets to match the main canvas transformation
            highlightCtx.translate(offsetX, offsetY);
            highlightCtx.scale(scale, scale);
            highlightCtx.strokeStyle = "var(--accent, orange)";
            highlightCtx.lineWidth = 3 / scale;
            highlightCtx.strokeRect(
                selectedPixel.x * PIXEL_SIZE,
                selectedPixel.y * PIXEL_SIZE,
                PIXEL_SIZE,
                PIXEL_SIZE,
            );
            highlightCtx.restore();
        }
    }

    function initLiveViewImageData() {
        liveViewImageData = liveViewCtx.createImageData(
            LIVE_VIEW_CANVAS_WIDTH,
            LIVE_VIEW_CANVAS_HEIGHT,
        );
        liveViewPixelData = liveViewImageData.data;
    }

    function drawLiveViewGrid() {
        if (!liveViewCtx || !liveViewPixelData) {
            console.error("Live View Canvas Context or ImageData not available.");
            return;
        }

        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                const color =
                    grid[y] && grid[y][x] !== undefined ? grid[y][x] : "#000000";
                const [r, g, b, a] = hexToRgba(color);

                const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);

                const imageDataIndex = (targetY * LIVE_VIEW_CANVAS_WIDTH + targetX) * 4;

                if (
                    imageDataIndex >= 0 &&
                    imageDataIndex + 3 < liveViewPixelData.length
                ) {
                    liveViewPixelData[imageDataIndex] = r;
                    liveViewPixelData[imageDataIndex + 1] = g;
                    liveViewPixelData[imageDataIndex + 2] = b;
                    liveViewPixelData[imageDataIndex + 3] = a;
                }
            }
        }
        liveViewCtx.putImageData(liveViewImageData, 0, 0);
    }

    function generateSessionId() {
        return `session_${Math.random().toString(36).substring(2, 11)}${Date.now().toString(36)}`;
    }

    function initiateDiscordOAuth() {
        const scopes = "identify+email";
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&response_type=code&scope=${scopes}`;
        window.location.href = oauthUrl;
    }

    async function handleOAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get("code");

        if (code) {
            try {
                const response = await fetch(`${BACKEND_URL}/auth/discord`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code, redirect_uri: OAUTH_REDIRECT_URI }),
                });

                if (response.ok) {
                    const data = await response.json();
                    userToken = data.access_token;
                    userData = data.user;
                    localStorage.setItem("discord_token", userToken);
                    localStorage.setItem("user_data", JSON.stringify(userData));
                    updateUserInterface();
                    window.history.replaceState(
                        {},
                        document.title,
                        window.location.pathname,
                    );
                }
            } catch (error) {
                console.error("OAuth callback error:", error);
            }
        }
    }

    function logout() {
        userToken = null;
        userData = null;
        localStorage.removeItem("discord_token");
        localStorage.removeItem("user_data");
        updateUserInterface();
    }

    function updateUserInterface() {
        const loginBtn = document.getElementById("discordLoginBtn");
        const logoutBtn = document.getElementById("logoutBtn");
        const userInfo = document.getElementById("userInfo");

        if (userData && userToken) {
            if (loginBtn) loginBtn.style.display = "none";
            if (logoutBtn) logoutBtn.style.display = "inline-block";
            if (userInfo) {
                userInfo.style.display = "flex";

                const avatarEl = document.getElementById("userAvatar");
                const nameEl = document.getElementById("userName");
                if (avatarEl) {
                    avatarEl.src = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`;
                }
                if (nameEl) {
                    nameEl.textContent = `${userData.username}#${userData.discriminator}`;
                }

                if (!document.getElementById("cooldownToggleContainer")) {
                    const adminIds = ["146797401720487936", "405184938045079552", "858231473761157170"];
                    const isAdmin = adminIds.includes(userData.id);
                    if (isAdmin) {
                        enforceCooldown = false;
                    }

                    const label = document.createElement("label");
                    label.id = "cooldownToggleContainer";
                    label.style.marginLeft = "8px";
                    label.style.cursor = "pointer";

                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.id = "cooldownToggle";
                    checkbox.checked = enforceCooldown;
                    checkbox.style.marginRight = "4px";

                    label.appendChild(checkbox);
                    label.appendChild(document.createTextNode("Enable Cooldown"));
                    userInfo.appendChild(label);

                    checkbox.addEventListener("change", (e) => {
                        enforceCooldown = e.target.checked;
                        if (!enforceCooldown) {
                            updateCooldownTimerDisplay();
                        } else {
                            if (isCooldownActive()) {
                                updateCooldownTimerDisplay();
                                if (!cooldownIntervalId) {
                                    cooldownIntervalId = setInterval(
                                        updateCooldownTimerDisplay,
                                        1000,
                                    );
                                }
                            }
                        }
                    });
                }
            }
        } else {
            if (loginBtn) loginBtn.style.display = "inline-block";
            if (logoutBtn) logoutBtn.style.display = "none";
            if (userInfo) userInfo.style.display = "none";

            const toggleContainer = document.getElementById(
                "cooldownToggleContainer",
            );
            if (toggleContainer) toggleContainer.remove();

            enforceCooldown = true;
            updateCooldownTimerDisplay();
        }

    }

    let activeUsersInterval = null;
    const activeUsersList = document.getElementById("activeUsersList");

    function getDeviceIcon(deviceType) {
        switch (deviceType) {
            case 'mobile':
                return '<i class="fa-solid fa-mobile-screen-button active-user-device"></i>';
            case 'tablet':
                return '<i class="fa-solid fa-tablet-screen-button active-user-device"></i>';
            default:
                return '<i class="fa-solid fa-desktop active-user-device"></i>';
        }
    }

    async function updateActiveUsers() {
        try {
            const response = await fetch(`${BACKEND_URL}/api/active-users?window=30000`);
            if (!response.ok) {
                throw new Error('Failed to fetch active users');
            }

            const data = await response.json();
            displayActiveUsers(data.activeUsers, data.count);
        } catch (error) {
            console.error('Error fetching active users:', error);
            displayActiveUsers([], 0);
        }
    }

    function displayActiveUsers(users, count) {
        if (!activeUsersList) return;

        const activeUsersCount = document.getElementById("activeUsersCount");
        if (activeUsersCount) {
            activeUsersCount.textContent = `(${count})`;
        }

        if (users.length === 0) {
            activeUsersList.innerHTML = '<div class="active-users-empty">No users active in the last 30 seconds</div>';
            return;
        }

        const usersHTML = users.map(user => {
            const deviceIcon = getDeviceIcon(user.deviceType);
            const isPlacing = user.isPlacingPixels;
            const statusClass = isPlacing ? 'placing' : '';
            const placementText = user.recentPlacements > 0 ? `${user.recentPlacements}` : '';

            return `
                <div class="active-user-item">
                    <div class="active-user-info">
                        ${deviceIcon}
                        <span class="active-user-name">${user.username}</span>
                    </div>
                    <div class="active-user-status">
                        ${placementText ? `<span class="placement-count">${placementText}</span>` : ''}
                        <div class="status-dot ${statusClass}" title="${isPlacing ? 'Currently placing pixels' : 'Online'}"></div>
                    </div>
                </div>
            `;
        }).join('');

        activeUsersList.innerHTML = usersHTML;
    }

    function startActiveUsersPolling() {
        if (activeUsersInterval) {
            clearInterval(activeUsersInterval);
        }

        updateActiveUsers();

        activeUsersInterval = setInterval(updateActiveUsers, 5000);
    }

    function addPixelLogEntry(x, y, color) {
        if (!pixelChatLog) {
            console.error("Pixel chat log element not found.");
            return;
        }

        if (typeof x !== "number" || typeof y !== "number") {
            return;
        }

        const logEntry = document.createElement("div");
        logEntry.className = "log-entry";
        const finalContentHTML = `<span style="color: #00ff00">${x}</span><span style="color: #00ff00">,</span> <span style="color: #00ff00">${y}</span> updated`;

        logEntry.innerHTML = `
        <i class="fa-solid fa-circle" style="font-size:10px; margin-right: 10px; margin-left: 6px; color: ${color}; font-weight: bold;"></i>
        <span class="typing-target"></span>
    `;

        pixelChatLog.appendChild(logEntry);
        pixelChatLog.scrollTop = pixelChatLog.scrollHeight;

        const typingTargetElement = logEntry.querySelector(".typing-target");
        if (!typingTargetElement) {
            console.error("Typing target element not found.");
            return;
        }

        let i = 0;
        let isTag = false;
        const typingSpeed = 60;
        const originalText = finalContentHTML;

        function type() {
            const text = originalText.slice(0, ++i);

            if (text === originalText) {
                typingTargetElement.innerHTML = text;
                pixelChatLog.scrollTop = pixelChatLog.scrollHeight;
                return;
            }

            const char = text.slice(-1);
            if (char === "<") isTag = true;
            if (char === ">") isTag = false;

            typingTargetElement.innerHTML =
                `${text}<span class='blinker'>&#32;</span>`;

            if (isTag) {
                type();
            } else {
                setTimeout(type, typingSpeed);
            }

        }

        type();
    }

    function getGridCoordsFromScreen(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();

        // Use exact canvas coordinates without rounding
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;

        // Use exact offsets to match the drawing transformation
        const worldX = (canvasX - offsetX) / scale;
        const worldY = (canvasY - offsetY) / scale;

        // Convert to grid coordinates with proper rounding for pixel center alignment
        const gridX = Math.floor(worldX / PIXEL_SIZE);
        const gridY = Math.floor(worldY / PIXEL_SIZE);

        if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
            return { x: gridX, y: gridY };
        }
        return null;
    }

    function handleUserInteractionClick(event) {
        const gridCoords = getGridCoordsFromScreen(event.clientX, event.clientY);

        if (gridCoords) {
            console.log(
                `Click resolved to grid coordinates: (${gridCoords.x}, ${gridCoords.y})`,
            );

            if (
                selectedPixel.x !== gridCoords.x ||
                selectedPixel.y !== gridCoords.y
            ) {
            }

            selectedPixel.x = gridCoords.x;
            selectedPixel.y = gridCoords.y;

            const index = gridCoords.y * GRID_WIDTH + gridCoords.x;
            const currentColor = grid[index];

            if (currentColor) {
                const hexColor = rgbToHex(currentColor);
                document.getElementById("colorPicker").value = hexColor;
                document.getElementById("colorPickerText").textContent = hexColor;
            }

            updateSelectedCoordsDisplay();

            drawHighlight();
        } else {
            if (selectedPixel.x !== null) {
            }

            selectedPixel.x = null;
            selectedPixel.y = null;

            updateSelectedCoordsDisplay();

            drawHighlight();
        }
    }

    function handleMouseDown(event) {
        isDragging = true;

        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
        lastClickX = event.clientX;
        lastClickY = event.clientY;

        canvas.classList.add("grabbing");
    }

    function handleMouseMove(event) {
        if (!isDragging) {
            return;
        }

        const dx = event.clientX - lastMouseX;
        const dy = event.clientY - lastMouseY;

        offsetX += dx;
        offsetY += dy;

        lastMouseX = event.clientX;
        lastMouseY = event.clientY;

        drawGrid();
    }

    function handleMouseUp(event) {
        isDragging = false;
        canvas.classList.remove("grabbing");

        const dx = event.clientX - lastClickX;
        const dy = event.clientY - lastClickY;

        if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
            handleUserInteractionClick({
                clientX: event.clientX,
                clientY: event.clientY,
            });
        }
    }

    function handleTouchStart(event) {
        event.preventDefault();

        if (event.touches.length === 1) {
            isDragging = true;
            lastTouchX = event.touches[0].clientX;
            lastTouchY = event.touches[0].clientY;
            touchStartX = event.touches[0].clientX;
            touchStartY = event.touches[0].clientY;
            canvas.classList.add("grabbing");
            initialPinchDistance = null;
        } else if (event.touches.length === 2) {
            isDragging = false;
            initialPinchDistance = getPinchDistance(event);
        } else {
        }
    }

    function handleTouchMove(event) {
        event.preventDefault();

        if (event.touches.length === 1 && isDragging) {
            const dx = event.touches[0].clientX - lastTouchX;
            const dy = event.touches[0].clientY - lastTouchY;

            offsetX += dx;
            offsetY += dy;

            lastTouchX = event.touches[0].clientX;
            lastTouchY = event.touches[0].clientY;

            drawGrid();
        } else if (event.touches.length === 2 && initialPinchDistance !== null) {
            const currentPinchDistance = getPinchDistance(event);
            const scaleChange = currentPinchDistance / initialPinchDistance;

            const oldScale = scale;
            scale *= scaleChange;
            scale = Math.max(0.1, Math.min(scale, 10.0));

            const touchCenterX =
                (event.touches[0].clientX + event.touches[1].clientX) / 2;
            const touchCenterY =
                (event.touches[0].clientY + event.touches[1].clientY) / 2;

            const rect = canvas.getBoundingClientRect();
            const mouseCanvasX = touchCenterX - rect.left;
            const mouseCanvasY = touchCenterY - rect.top;

            const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
            const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

            offsetX = mouseCanvasX - mouseWorldX * scale;
            offsetY = mouseCanvasY - mouseWorldY * scale;

            initialPinchDistance = currentPinchDistance;
            drawGrid();
        }
    }

    function handleTouchEnd(event) {
        canvas.classList.remove("grabbing");
        isDragging = false;
        initialPinchDistance = null;

        if (event.changedTouches.length === 1) {
            const finalX = event.changedTouches[0].clientX;
            const finalY = event.changedTouches[0].clientY;

            const dx = finalX - touchStartX;
            const dy = finalY - touchStartY;

            if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
                handleUserInteractionClick({
                    clientX: touchStartX,
                    clientY: touchStartY,
                });
            } else {
            }
        }
    }

    function getPinchDistance(event) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        return Math.sqrt(
            (touch2.clientX - touch1.clientX) ** 2 +
            (touch2.clientY - touch1.clientY) ** 2,
        );
    }

    function handleMouseWheel(event) {
        if (event.preventDefault) {
            event.preventDefault();
        }

        const zoomFactor = 0.1;
        const oldScale = scale;

        if (event.deltaY < 0) {
            scale *= 1 + zoomFactor;
        } else {
            scale /= 1 + zoomFactor;
        }

        scale = Math.max(0.1, Math.min(scale, 10.0));

        const rect = canvas.getBoundingClientRect();
        const mouseCanvasX = event.clientX - rect.left;
        const mouseCanvasY = event.clientY - rect.top;

        const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
        const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

        offsetX = mouseCanvasX - mouseWorldX * scale;
        offsetY = mouseCanvasY - mouseWorldY * scale;

        drawGrid();
    }

    function handlePlacePixelClick() {
        if (selectedPixel.x === null || selectedPixel.y === null) {
            alert("Please select a pixel on the canvas first!");
            return;
        }

        if (isCooldownActive()) {
            const remaining = Math.ceil(
                (COOLDOWN_DURATION_MS - (Date.now() - lastPixelTime)) / 1000,
            );
            alert(`Please wait ${remaining}s before placing another pixel.`);
            return;
        }

        placePixel(selectedPixel.x, selectedPixel.y, currentColor, 'button');

        if (enforceCooldown) {
            startCooldownTimer();
        }
    }

    function handleColorChange() {
        currentColor = colorPicker.value;
        if (customColorSwatch) {
            customColorSwatch.style.backgroundColor = currentColor;
        }
    }

    function updateSelectedCoordsDisplay() {
        if (selectedPixel.x !== null && selectedPixel.y !== null) {
            selectedCoordsDisplay.textContent = `(${selectedPixel.x}, ${selectedPixel.y})`;
        } else {
            selectedCoordsDisplay.textContent = "None";
        }
    }

    function handleKeyDown(event) {
        if (event.defaultPrevented) return;
        switch (event.key) {
            case "ArrowUp":
                if (selectedPixel.y > 0) selectedPixel.y--;
                break;
            case "ArrowDown":
                if (selectedPixel.y < GRID_HEIGHT - 1) selectedPixel.y++;
                break;
            case "ArrowLeft":
                if (selectedPixel.x > 0) selectedPixel.x--;
                break;
            case "ArrowRight":
                if (selectedPixel.x < GRID_WIDTH - 1) selectedPixel.x++;
                break;
            case " ":
            case "Spacebar":
            case "Space":
                event.preventDefault();
                if (selectedPixel.x !== null && selectedPixel.y !== null) {
                    if (isCooldownActive()) {
                        const remaining = Math.ceil(
                            (COOLDOWN_DURATION_MS - (Date.now() - lastPixelTime)) / 1000,
                        );
                        alert(`Please wait ${remaining}s before placing another pixel.`);
                        return;
                    }
                    placePixel(selectedPixel.x, selectedPixel.y, currentColor, 'spacebar');
                    if (enforceCooldown) {
                        startCooldownTimer();
                    }
                } else {
                    alert("Please select a pixel on the canvas first!");
                }
                return;
            default:
                return;
        }
        event.preventDefault();
        if (selectedPixel.x === null || selectedPixel.y === null) {
            selectedPixel.x = 0;
            selectedPixel.y = 0;
        }
        updateSelectedCoordsDisplay();
        drawHighlight();
    }

    function disableFallbackMode() {
        if (fallbackPollingInterval) {
            clearInterval(fallbackPollingInterval);
            fallbackPollingInterval = null;
        }
        if (activeUsersInterval) {
            clearInterval(activeUsersInterval);
            activeUsersInterval = null;
        }
        fallbackMode = false;
        console.log("Disabled fallback polling mode");
    }

    function createReconnectButton() {
        const btn = document.createElement("button");
        btn.id = "reconnectButton";
        btn.textContent = "Reconnect";
        btn.className = "btn btn-primary";
        btn.style.display = "none";
        btn.style.marginTop = "1rem";
        btn.style.width = "100%";

        btn.addEventListener("click", () => {
            if (!socket) return;
            btn.disabled = true;

            if (fallbackMode) {
                disableFallbackMode();
            }

            reconnectAttempts = 0;
            connectWebSocket();
            getGrid();
        });

        if (bottomControls?.parentElement) {
            bottomControls.parentElement.appendChild(btn);
        } else {
            document.body.appendChild(btn);
        }
        return btn;
    }

    function connectWebSocket() {
        if (socket && socket.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            socket = new WebSocket(WEBSOCKET_URL);

            socket.onopen = () => {
                console.log("Connected to backend WebSocket");
                reconnectButton.style.display = "none";
                reconnectButton.disabled = false;
                reconnectAttempts = 0;
                fallbackMode = false;

                if (fallbackPollingInterval) {
                    clearInterval(fallbackPollingInterval);
                    fallbackPollingInterval = null;
                }

                if (activeUsersInterval) {
                    clearInterval(activeUsersInterval);
                    activeUsersInterval = null;
                }

                startPing();
                updateConnectionStatus(true);

                if (window.adminConsole) {
                    window.adminConsole.onReconnect();
                }
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === "pong") {
                        updateConnectionStatus(true);
                        return;
                    }

                    if (data.type === "pixelUpdate") {
                        const { x, y, color } = data;

                        if (grid[y]?.[x] !== undefined) {
                            grid[y][x] = color;
                        }

                        drawPixelToOffscreen(x, y, color);

                        if (liveViewPixelData) {
                            const [r, g, b, a] = hexToRgba(color);
                            const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                            const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                            const imageDataIndex =
                                (targetY * LIVE_VIEW_CANVAS_WIDTH + targetX) * 4;

                            if (
                                imageDataIndex >= 0 &&
                                imageDataIndex + 3 < liveViewPixelData.length
                            ) {
                                liveViewPixelData[imageDataIndex] = r;
                                liveViewPixelData[imageDataIndex + 1] = g;
                                liveViewPixelData[imageDataIndex + 2] = b;
                                liveViewPixelData[imageDataIndex + 3] = a;
                            }
                            liveViewCtx.putImageData(liveViewImageData, 0, 0);
                        }

                        drawGrid();
                        addPixelLogEntry(x, y, color);
                    } else if (data.type === "broadcast") {
                        if (window.gridTender) {
                            window.gridTender.handleBroadcastMessage(data);
                        }
                    } else if (data.type === "announcement") {
                        if (window.gridTender) {
                            window.gridTender.updateAnnouncementDisplay(data.announcement || '');
                        }
                    } else if (data.type === "activeUsers") {
                        if (Array.isArray(data.activeUsers)) {
                            displayActiveUsers(data.activeUsers, data.activeUsers.length);
                        }
                    } else if (data.type === "console_log") {
                        if (window.adminConsole) {
                            window.adminConsole.addLogEntry(data);
                        }
                    }
                } catch (error) {
                    console.error("Error parsing WebSocket message:", error);
                }
            };

            socket.onclose = (event) => {
                console.log("WebSocket connection closed:", event.code, event.reason);
                stopPing();
                updateConnectionStatus(false);

                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(
                        `Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
                    );

                    setTimeout(
                        () => connectWebSocket(),
                        RECONNECT_DELAY * reconnectAttempts,
                    );
                } else {
                    if (IS_DEV_MODE) {
                        console.log("WebSocket reconnection failed in dev mode, enabling fallback");
                        enableFallbackMode();
                    } else {
                        console.log("WebSocket reconnection failed, enabling fallback mode");
                        enableFallbackMode();
                    }
                }
            };

            socket.onerror = (error) => {
                console.error("WebSocket error:", error);
                stopPing();
                updateConnectionStatus(false);

                if (IS_DEV_MODE && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log("WebSocket failed in dev mode, enabling fallback");
                    enableFallbackMode();
                } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log("WebSocket failed after max attempts, enabling fallback");
                    enableFallbackMode();
                }
            };
        } catch (error) {
            console.error("Failed to create WebSocket connection:", error);

            if (IS_DEV_MODE) {
                console.log("WebSocket creation failed in dev mode, enabling fallback");
                enableFallbackMode();
            } else {
                console.log("WebSocket creation failed, enabling fallback");
                enableFallbackMode();
            }
        }
    }

    function setupWebSocket() {
        connectWebSocket();
    }

    function startPing() {
        if (pingInterval) {
            clearInterval(pingInterval);
        }

        pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "ping" }));
            }
        }, PING_INTERVAL);
    }

    function stopPing() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    }

    function updateConnectionStatus(connected) {
        const statusIndicator = document.getElementById("connectionStatus");
        if (statusIndicator) {
            statusIndicator.textContent = connected ? "✓" : "!";
            statusIndicator.className = connected ? "connection-status connected" : "connection-status disconnected";
            statusIndicator.title = connected ? "Connected" : "Disconnected";
        }

        if (!connected && !fallbackMode) {
            showReconnectModal();
        } else if (connected) {
            hideReconnectModal();
        }
    }

    function showReconnectModal() {
        let modal = document.getElementById("reconnectModal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "reconnectModal";
            modal.className = "modal-overlay";
            modal.style.zIndex = "10001";
            modal.innerHTML = `
                <div class="settings-window" style="max-width: 400px; text-align: center;">
                    <h2 class="mb-4 text-xl font-bold">Connection Lost</h2>
                    <p class="mb-6 text-gray-600">Your connection to the server has been lost. Please reconnect to continue.</p>
                    <button id="modalReconnectBtn" class="btn btn-primary w-full">
                        <span class="material-icons-round" style="font-size: 1rem;">refresh</span>
                        Reconnect
                    </button>
                </div>
            `;
            document.body.appendChild(modal);

            const reconnectBtn = modal.querySelector("#modalReconnectBtn");
            reconnectBtn.addEventListener("click", () => {
                hideReconnectModal();
                if (socket) {
                    socket.close();
                }
                reconnectAttempts = 0;
                connectWebSocket();
            });
        }
        modal.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function hideReconnectModal() {
        const modal = document.getElementById("reconnectModal");
        if (modal) {
            modal.classList.remove("active");
            document.body.style.overflow = "";
        }
    }

    function showBackendDownModal() {
        let modal = document.getElementById("backendDownModal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "backendDownModal";
            modal.className = "modal-overlay";
            modal.style.zIndex = "10002";
            modal.innerHTML = `
                <div class="settings-window" style="max-width: 450px; text-align: center;">
                    <h2 class="mb-4 text-xl font-bold">Backend Connection Lost</h2>
                    <p class="mb-6 text-gray-600">The backend server appears to be unavailable. You can try reconnecting or visit the status page for more information.</p>
                    <div class="flex gap-3 justify-center">
                        <button id="modalTryReconnectBtn" class="btn btn-primary">
                            <span class="material-icons-round" style="font-size: 1rem;">refresh</span>
                            Try Reconnect
                        </button>
                        <button id="modalStatusPageBtn" class="btn btn-secondary">
                            <span class="material-icons-round" style="font-size: 1rem;">info</span>
                            Status Page
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const reconnectBtn = modal.querySelector("#modalTryReconnectBtn");
            const statusPageBtn = modal.querySelector("#modalStatusPageBtn");

            reconnectBtn.addEventListener("click", () => {
                hideBackendDownModal();
                if (socket) {
                    socket.close();
                }
                reconnectAttempts = 0;
                fallbackMode = false;
                if (fallbackPollingInterval) {
                    clearInterval(fallbackPollingInterval);
                    fallbackPollingInterval = null;
                }
                connectWebSocket();
                getGrid();
            });

            statusPageBtn.addEventListener("click", () => {
                redirectToStatusPage();
            });
        }
        modal.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function hideBackendDownModal() {
        const modal = document.getElementById("backendDownModal");
        if (modal) {
            modal.classList.remove("active");
            document.body.style.overflow = "";
        }
    }

    function isCooldownActive() {
        if (!enforceCooldown) return false;
        return Date.now() - lastPixelTime < COOLDOWN_DURATION_MS;
    }

    function startCooldownTimer() {
        if (!enforceCooldown) return;
        lastPixelTime = Date.now();
        localStorage.setItem("lastPixelTime", lastPixelTime.toString());
        updateCooldownTimerDisplay();
        if (cooldownIntervalId) clearInterval(cooldownIntervalId);
        cooldownIntervalId = setInterval(updateCooldownTimerDisplay, 1000);
    }

    function updateCooldownTimerDisplay() {
        if (!cooldownTimerDiv) return;

        if (!enforceCooldown) {
            cooldownTimerDiv.style.display = "none";
            if (cooldownIntervalId) {
                clearInterval(cooldownIntervalId);
                cooldownIntervalId = null;
            }
            return;
        }

        const remaining = COOLDOWN_DURATION_MS - (Date.now() - lastPixelTime);
        if (remaining <= 0) {
            cooldownTimerDiv.style.display = "none";
            if (cooldownIntervalId) {
                clearInterval(cooldownIntervalId);
                cooldownIntervalId = null;
            }
            return;
        }

        cooldownTimerDiv.textContent = `Cooldown: ${Math.ceil(remaining / 1000)}s`;
        cooldownTimerDiv.style.display = "block";
    }

    function toggleDark() {
        console.log("Toggle dark mode called");
        document.documentElement.classList.toggle("dark");
        const isDark = document.documentElement.classList.contains("dark");
        console.log("Dark mode is now:", isDark);
        localStorage.setItem("theme", isDark ? "dark" : "light");

        const themeIcon = themeToggleBtn.querySelector(".material-icons-round");
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

        if (savedTheme === "dark") {
            console.log("Applying dark theme");
            document.documentElement.classList.add("dark");
            const themeIcon = themeToggleBtn.querySelector(".material-icons-round");
            if (themeIcon) {
                themeIcon.textContent = "light_mode";
                console.log("Theme icon set to light_mode");
            } else {
                console.log("Theme icon element not found in initTheme");
            }
        } else if (savedTheme === "light") {
            console.log("Applying light theme");
            document.documentElement.classList.remove("dark");
            const themeIcon = themeToggleBtn.querySelector(".material-icons-round");
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

    async function init() {
        if (customColorSwatch && colorPicker) {
            customColorSwatch.style.backgroundColor = colorPicker.value;
        }

        cooldownTimerDiv = document.createElement("div");
        cooldownTimerDiv.id = "cooldownTimer";
        cooldownTimerDiv.style.position = "fixed";
        cooldownTimerDiv.style.top = "10px";
        cooldownTimerDiv.style.left = "50%";
        cooldownTimerDiv.style.transform = "translateX(-50%)";
        cooldownTimerDiv.style.padding = "6px 12px";
        cooldownTimerDiv.style.backgroundColor = "rgba(0,0,0,0.75)";
        cooldownTimerDiv.style.color = "#fff";
        cooldownTimerDiv.style.fontWeight = "bold";
        cooldownTimerDiv.style.borderRadius = "4px";
        cooldownTimerDiv.style.zIndex = "10000";
        cooldownTimerDiv.style.display = "none";
        document.body.appendChild(cooldownTimerDiv);

        const loginBtn = document.getElementById("discordLoginBtn");
        if (loginBtn) loginBtn.addEventListener("click", initiateDiscordOAuth);
        const logoutBtnElement = document.getElementById("logoutBtn");
        if (logoutBtnElement) logoutBtnElement.addEventListener("click", logout);

        if (isCooldownActive()) {
            updateCooldownTimerDisplay();
            cooldownIntervalId = setInterval(updateCooldownTimerDisplay, 1000);
        }

        setCanvasSize();

        offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = GRID_WIDTH * PIXEL_SIZE;
        offscreenCanvas.height = GRID_HEIGHT * PIXEL_SIZE;
        offscreenCtx = offscreenCanvas.getContext("2d");
        offscreenCtx.imageSmoothingEnabled = false;
        console.log("Offscreen Canvas created.");

        if (liveViewCanvas) {
            initLiveViewImageData();
        }
        liveViewCtx.imageSmoothingEnabled = false;

        grid = await getGrid();

        if (grid === null) {
            return;
        }

        drawFullOffscreenGrid(grid);

        const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
        const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

        const fitScaleX = canvas.width / gridPixelWidth;
        const fitScaleY = canvas.height / gridPixelHeight;
        scale = Math.min(fitScaleX, fitScaleY) * 0.9;
        scale = Math.max(scale, 0.1);

        offsetX = (canvas.width - gridPixelWidth * scale) / 2;
        offsetY = (canvas.height - gridPixelHeight * scale) / 2;

        ctx.imageSmoothingEnabled = false;

        drawGrid();
        drawLiveViewGrid();

        window.addEventListener("resize", setCanvasSize);
        canvas.addEventListener("mousedown", handleMouseDown);
        canvas.addEventListener("mousemove", handleMouseMove);
        canvas.addEventListener("mouseup", handleMouseUp);
        canvas.addEventListener("mouseout", handleMouseUp);
        canvas.addEventListener("wheel", handleMouseWheel, { passive: false });
        canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
        canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
        canvas.addEventListener("touchend", handleTouchEnd);
        canvas.addEventListener("touchcancel", handleTouchEnd);

        colorPicker.addEventListener("input", handleColorChange);
        if (customColorSwatch) {
            customColorSwatch.addEventListener("click", () => {
                colorPicker.click();
            });
        }
        placePixelBtn.addEventListener("click", handlePlacePixelClick);

        if (zoomInBtn) {
            zoomInBtn.addEventListener("click", () => {
                const rect = canvas.getBoundingClientRect();
                handleMouseWheel({
                    deltaY: -1,
                    clientX: rect.left + canvas.clientWidth / 2,
                    clientY: rect.top + canvas.clientHeight / 2,
                    preventDefault: () => { },
                });
            });
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener("click", () => {
                const rect = canvas.getBoundingClientRect();
                handleMouseWheel({
                    deltaY: 1,
                    clientX: rect.left + canvas.clientWidth / 2,
                    clientY: rect.top + canvas.clientHeight / 2,
                    preventDefault: () => { },
                });
            });
        }

        if (themeToggleBtn) {
            themeToggleBtn.addEventListener("click", toggleDark);
        }

        function clearChatLog() {
            const chatItems = pixelChatLog.querySelectorAll('.log-entry');
            chatItems.forEach(item => {
                item.remove();
            });

            console.log('pixelChatLog cleared at:', new Date().toLocaleTimeString());
        }
        const MAX_CHAT_LOG_ENTRIES = 30;
        if (pixelChatLog.children.length > MAX_CHAT_LOG_ENTRIES) {
            const clearChatInterval = setInterval(clearChatLog, 200000);

            window.addEventListener('beforeunload', () => {
                clearInterval(clearChatInterval);
            });
        }

        window.reconnectButton = createReconnectButton();

        updateSelectedCoordsDisplay();

        lastUpdateTime = Date.now();

        setupWebSocket();

        document.addEventListener("keydown", handleKeyDown);

        await handleOAuthCallback();
        updateUserInterface();
        initTheme();
        initCollapsiblePanels();

        console.log("Frontend initialized!");
    }

    async function enableFallbackMode() {
        fallbackMode = true;
        console.log("Enabled fallback polling mode.");

        const isBackendUp = await checkBackendHealth();
        if (!isBackendUp) {
            console.log("Backend appears to be completely down, showing connection options");
            setTimeout(() => {
                showBackendDownModal();
            }, 10000);
            return;
        }

        if (!fallbackPollingInterval) {
            fallbackPollingInterval = setInterval(pollForUpdates, FALLBACK_POLL_INTERVAL);
        }

        startActiveUsersPolling();

        reconnectButton.style.display = "none";
    }

    window.testFallbackMode = () => {
        console.log("Testing fallback mode...");
        if (socket) {
            socket.close();
        }
        reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
        enableFallbackMode();
    };

    window.testUpdatesEndpoint = async () => {
        try {
            console.log("Testing /api/updates endpoint...");
            const response = await fetch(`${BACKEND_URL}/api/updates?since=${Date.now() - 5000}`);
            if (response.ok) {
                const data = await response.json();
                console.log("Updates endpoint response:", data);
            } else {
                console.error("Updates endpoint failed:", response.status);
            }
        } catch (error) {
            console.error("Error testing updates endpoint:", error);
        }
    };

    async function pollForUpdates() {
        try {
            const response = await fetch(`${BACKEND_URL}/api/updates?since=${lastUpdateTime}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();

                if (data.updates && data.updates.length > 0) {
                    console.log(`Received ${data.updates.length} updates via polling`);

                    data.updates.forEach(update => {
                        if (update.type === "pixelUpdate") {
                            const { x, y, color, timestamp } = update;

                            if (grid[y]?.[x] !== undefined) {
                                grid[y][x] = color;
                            }

                            drawPixelToOffscreen(x, y, color);

                            if (liveViewPixelData) {
                                const [r, g, b, a] = hexToRgba(color);
                                const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                                const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                                const imageDataIndex =
                                    (targetY * LIVE_VIEW_CANVAS_WIDTH + targetX) * 4;

                                if (
                                    imageDataIndex >= 0 &&
                                    imageDataIndex + 3 < liveViewPixelData.length
                                ) {
                                    liveViewPixelData[imageDataIndex] = r;
                                    liveViewPixelData[imageDataIndex + 1] = g;
                                    liveViewPixelData[imageDataIndex + 2] = b;
                                    liveViewPixelData[imageDataIndex + 3] = a;
                                }
                                liveViewCtx.putImageData(liveViewImageData, 0, 0);
                            }

                            drawGrid();
                            addPixelLogEntry(x, y, color);

                            if (timestamp && timestamp > lastUpdateTime) {
                                lastUpdateTime = timestamp;
                            }
                        }
                    });
                }

                if (data.currentTime) {
                    lastUpdateTime = data.currentTime;
                }
            }
        } catch (error) {
            console.error("Error polling for updates:", error);

            const isBackendUp = await checkBackendHealth();
            if (!isBackendUp) {
                console.log("Backend appears to be down during polling, showing connection options");
                showBackendDownModal();
            }
        }
    }

    class AdminConsole {
        constructor() {
            this.consoleWindow = null;
            this.consoleLog = null;
            this.clearConsoleBtn = null;
            this.isVisible = false;
            this.isSubscribed = false;
            this.maxEntries = 100;
            this.isDragging = false;
            this.dragOffset = { x: 0, y: 0 };

            this.initEventListeners();
        }

        initEventListeners() {
            document.addEventListener('click', (e) => {
                if (e.target.id === 'openConsoleWindowBtn') {
                    this.openConsoleWindow();
                }
            });
        }

        showIfAdmin() {
        }

        createConsoleWindow() {
            this.consoleWindow = document.createElement('div');
            this.consoleWindow.className = 'admin-console-window floating-panel';
            this.consoleWindow.innerHTML = `
                <div class="console-header draggable-handle">
                    <h3>
                        <span class="material-icons-round" style="font-size: 1rem;">terminal</span>
                        Server Console
                    </h3>
                    <div class="console-header-controls">
                        <button id="clearConsoleBtn" class="btn-icon" title="Clear Console">
                            <span class="material-icons-round">clear</span>
                        </button>
                        <button id="closeConsoleBtn" class="btn-icon" title="Close">
                            <span class="material-icons-round">close</span>
                        </button>
                    </div>
                </div>
                <div class="console-content">
                    <div id="adminConsoleLog" class="admin-console-log"></div>
                </div>
            `;

            document.body.appendChild(this.consoleWindow);

            this.consoleLog = this.consoleWindow.querySelector('#adminConsoleLog');
            this.clearConsoleBtn = this.consoleWindow.querySelector('#clearConsoleBtn');
            const closeBtn = this.consoleWindow.querySelector('#closeConsoleBtn');

            this.clearConsoleBtn.addEventListener('click', () => this.clear());
            closeBtn.addEventListener('click', () => this.closeConsoleWindow());

            this.setupDragging();

            this.centerWindow();
        }

        isUserAdmin(userId) {
            const adminIds = ["146797401720487936", "405184938045079552", "858231473761157170"];
            return adminIds.includes(userId);
        }

        openConsoleWindow() {
            if (!userData || !this.isUserAdmin(userData.id)) {
                return;
            }

            if (!this.consoleWindow) {
                this.createConsoleWindow();
            }

            this.isVisible = true;
            this.consoleWindow.classList.remove('hidden');
            this.subscribe();
            this.addLogEntry({
                level: 'info',
                message: 'Admin console opened',
                timestamp: Date.now()
            });

            const statusEl = document.getElementById('consoleStatus');
            if (statusEl) {
                statusEl.textContent = 'Connected';
                statusEl.style.color = '#10b981';
            }
        }

        closeConsoleWindow() {
            if (this.consoleWindow) {
                this.consoleWindow.classList.add('hidden');
                this.isVisible = false;
                this.unsubscribe();

                const statusEl = document.getElementById('consoleStatus');
                if (statusEl) {
                    statusEl.textContent = 'Disconnected';
                    statusEl.style.color = '#ef4444';
                }
            }
        }

        setupDragging() {
            const handle = this.consoleWindow.querySelector('.draggable-handle');
            if (!handle) return;

            handle.style.cursor = 'grab';

            const handleMouseDown = (e) => {
                this.isDragging = true;
                handle.style.cursor = 'grabbing';
                document.body.style.cursor = 'grabbing';
                document.body.style.userSelect = 'none';

                const rect = this.consoleWindow.getBoundingClientRect();
                this.dragOffset.x = e.clientX - rect.left;
                this.dragOffset.y = e.clientY - rect.top;

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', _handleMouseUp);
                e.preventDefault();
            };

            const handleMouseMove = (e) => {
                if (!this.isDragging) return;

                const x = e.clientX - this.dragOffset.x;
                const y = e.clientY - this.dragOffset.y;

                this.consoleWindow.style.left = `${x}px`;
                this.consoleWindow.style.top = `${y}px`;
            };

            const _handleMouseUp = () => {
                this.isDragging = false;
                handle.style.cursor = 'grab';
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', _handleMouseUp);
            };

            handle.addEventListener('mousedown', handleMouseDown);
        }

        centerWindow() {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const windowWidth = 600;
            const windowHeight = 400;

            const x = (viewportWidth - windowWidth) / 2;
            const y = (viewportHeight - windowHeight) / 2;

            this.consoleWindow.style.left = `${x}px`;
            this.consoleWindow.style.top = `${y}px`;
        }

        subscribe() {
            if (socket && socket.readyState === WebSocket.OPEN && userToken && !this.isSubscribed) {
                socket.send(JSON.stringify({
                    type: 'admin_console_subscribe',
                    token: userToken
                }));
                this.isSubscribed = true;
            }
        }

        unsubscribe() {
            if (socket && socket.readyState === WebSocket.OPEN && this.isSubscribed) {
                socket.send(JSON.stringify({
                    type: 'admin_console_unsubscribe'
                }));
                this.isSubscribed = false;
            }
        }

        addLogEntry(logData) {
            if (!this.consoleLog) return;

            const entry = document.createElement('div');
            entry.className = 'console-entry';

            const timestamp = new Date(logData.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            entry.innerHTML = `
                <span class="console-timestamp">${timestamp}</span>
                <span class="console-level ${logData.level}">${logData.level}</span>
                <span class="console-message">${this.escapeHtml(logData.message)}</span>
                ${logData.data ? `<span class="console-data">${this.escapeHtml(JSON.stringify(logData.data))}</span>` : ''}
            `;

            this.consoleLog.appendChild(entry);

            while (this.consoleLog.children.length > this.maxEntries) {
                this.consoleLog.removeChild(this.consoleLog.firstChild);
            }

            this.consoleLog.scrollTop = this.consoleLog.scrollHeight;
        }

        clear() {
            if (this.consoleLog) {
                this.consoleLog.innerHTML = '';
                this.addLogEntry({
                    level: 'info',
                    message: 'Console cleared',
                    timestamp: Date.now()
                });
            }
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        onReconnect() {
            if (this.isVisible && this.isSubscribed) {
                this.isSubscribed = false;
                this.subscribe();
            }
        }
    }

    window.adminConsole = new AdminConsole();

    function initCollapsiblePanels() {
        const collapsiblePanels = document.querySelectorAll('.collapsible-panel');

        collapsiblePanels.forEach(panel => {
            const header = panel.querySelector('.collapsible-header');
            const toggle = panel.querySelector('.panel-toggle');

            if (header && toggle) {
                const togglePanel = () => {
                    panel.classList.toggle('collapsed');

                    const panelId = panel.dataset.panel;
                    const isCollapsed = panel.classList.contains('collapsed');
                    localStorage.setItem(`panel_${panelId}_collapsed`, isCollapsed.toString());
                };

                header.addEventListener('click', togglePanel);
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePanel();
                });
            }
        });

        collapsiblePanels.forEach(panel => {
            const panelId = panel.dataset.panel;
            const savedState = localStorage.getItem(`panel_${panelId}_collapsed`);

            if (savedState === 'true') {
                panel.classList.add('collapsed');
            } else {
                panel.classList.remove('collapsed');
            }
        });
    }

    window.gridTender = new GridTender({
        backendUrl: BACKEND_URL,
        debugMode: true
    });

    init();
});
