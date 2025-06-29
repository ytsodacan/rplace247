document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    const BACKEND_URL = 'https://place-worker.afunyun.workers.dev';
    const WEBSOCKET_URL = 'wss://place-worker.afunyun.workers.dev/ws';
    const OAUTH_CLIENT_ID = '1388712213002457118';

    // Discord requires **exact** redirect URIs.  During local development we
    // want to hit the one that is registered in the Discord developer portal
    // (http://localhost:5500/calllback).  In all other cases we fall back to
    // the production callback that lives at /auth/callback relative to the
    // current origin.
    const OAUTH_REDIRECT_URI = (window.location.hostname === 'localhost')
        ? 'http://localhost:5500/calllback' // ⚠️  must match the value set in the Discord app settings exactly
        : `${window.location.origin}/auth/callback`;

    const PIXEL_SIZE = 10; // Base size of each pixel in main grid coordinates

    // --- Live View Configuration ---
    const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2; // For a 500x500 grid, live view will be 250x250 pixels.
    const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; // Should be 250
    const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; // Should be 250

    const CLICK_THRESHOLD = 5; // Maximum pixel movement to still be considered a click/tap


    // --- DOM Elements (Main Canvas) ---
    const canvas = document.getElementById('rplaceCanvas');
    const ctx = canvas.getContext('2d');

    // --- DOM Elements (Live View Canvas) ---
    const liveViewCanvas = document.getElementById('liveViewCanvas');
    const liveViewCtx = liveViewCanvas.getContext('2d');

    // --- DOM Element for Pixel Chat Log ---
    const pixelChatLog = document.getElementById('pixelChatLog');

    // --- DOM Elements (Color Picker & Buttons) ---
    const colorPicker = document.getElementById('colorPicker');
    const customColorSwatch = document.getElementById('customColorSwatch'); // Assuming you have this, if not, it will be null
    const placePixelBtn = document.getElementById('placePixelBtn');
    const selectedCoordsDisplay = document.getElementById('selectedCoords');
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');


    // --- Global State ---
    let currentColor = colorPicker.value;
    let gridData = [];
    let selectedPixel = { x: null, y: null };

    // WebSocket instance reference
    let socket = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 1000;
    const sessionId = generateSessionId();
    let userToken = localStorage.getItem('discord_token');
    let userData = JSON.parse(localStorage.getItem('user_data') || 'null');

    // Make OAuth functions globally accessible
    window.initiateDiscordOAuth = () => initiateDiscordOAuth();
    window.logout = () => logout();
    window.handleOAuthCallback = () => handleOAuthCallback();

    // --- Canvas Dimensions (Must match backend grid dimensions) ---
    const GRID_WIDTH = 500;
    const GRID_HEIGHT = 500;

    // --- Viewport Transform State (for Main Canvas Pan & Zoom) ---
    let scale = 1.0;
    let offsetX = 0;
    let offsetY = 0;

    // --- Mouse Interaction State ---
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let lastClickX = 0;
    let lastClickY = 0;

    // --- Touch Interaction State ---
    let initialPinchDistance = null;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let touchStartX = 0;
    let touchStartY = 0;

    // --- New: Offscreen Canvas for Main Grid (for faster drawing) ---
    let offscreenCanvas;
    let offscreenCtx;

    // --- New: ImageData for Live View (for even faster drawing) ---
    let liveViewImageData;
    let liveViewPixelData; // This will hold the Uint8ClampedArray for ImageData manipulation

    // --- Cooldown Configuration ---
    const COOLDOWN_DURATION_MS = 60 * 1000; // 1 minute cooldown
    let lastPixelTime = parseInt(localStorage.getItem('lastPixelTime') || '0', 10);
    let cooldownIntervalId = null;
    let enforceCooldown = true; // authenticated users can disable this
    let cooldownTimerDiv;

    // --- Canvas Setup and Resizing ---
    function setCanvasSize() {
        const mainContentDiv = document.getElementById('main-content');
        if (mainContentDiv) {
            canvas.width = mainContentDiv.clientWidth;
            canvas.height = mainContentDiv.clientHeight;
        } else {
            // Fallback for cases where main-content might not be available or fully rendered yet
            const leftPanel = document.getElementById('left-panel');
            const leftPanelWidth = leftPanel ? leftPanel.offsetWidth : 0;
            canvas.width = window.innerWidth - leftPanelWidth;

            const footerElement = document.querySelector('footer');
            const footerHeight = footerElement ? footerElement.offsetHeight : 0;
            canvas.height = window.innerHeight - footerHeight;
        }

        if (liveViewCanvas) {
            liveViewCanvas.width = LIVE_VIEW_CANVAS_WIDTH;
            liveViewCanvas.height = LIVE_VIEW_CANVAS_HEIGHT;
        }

        if (gridData && gridData.length > 0) {
            console.log('setCanvasSize: Redrawing grids due to resize and existing data.');
            drawGrid(); // No longer passes gridData directly
            drawLiveViewGrid(); // No longer passes gridData directly
        } else {
            console.log('setCanvasSize: Grid data not yet available for redraw.');
        }
    }

    // --- Utility: Convert Hex color to RGBA Array ---
    function hexToRgba(hex) {
        const bigint = parseInt(hex.slice(1), 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return [r, g, b, 255]; // Always opaque (alpha = 255)
    }

    // --- Backend Communication Functions ---

    async function getGrid() {
        try {
            const response = await fetch(`${BACKEND_URL}/grid`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log('Initial grid fetched successfully.');
            return data;
        } catch (error) {
            console.error('Error fetching grid:', error);
            alert('Could not connect to backend to get initial grid. Is your backend running?');
            return Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill('#1a1a1a')); // Fallback to black grid
        }
    }

    async function placePixel(x, y, color) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (userToken) {
                headers.Authorization = `Bearer ${userToken}`;
            }

            const response = await fetch(`${BACKEND_URL}/pixel`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    x,
                    y,
                    color,
                    sessionId,
                    user: userData
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Failed to place pixel: ${errorData.message || response.statusText}`);
            }
            console.log(`Pixel placement request sent for (${x}, ${y}) with color ${color}`);

            // Send webhook notification via backend
            await sendWebhookNotification(x, y, color);
        } catch (error) {
            console.error('Error sending pixel update:', error);
            alert(`Failed to place pixel: ${error.message}`);
        }
    }

    // --- Canvas Drawing Functions (Main View - Optimized) ---

    // Draws a single pixel onto the OFFSCREEN canvas
    function drawPixelToOffscreen(x, y, color) {
        if (!offscreenCtx) {
            console.error("Offscreen canvas context not available for drawPixel.");
            return;
        }
        offscreenCtx.fillStyle = color;
        offscreenCtx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
    }

    // Draws the entire grid data onto the OFFSCREEN canvas initially
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
        console.log('Full grid drawn to offscreen canvas.');
    }

    // Draws the visible portion of the OFFSCREEN canvas onto the MAIN canvas
    function drawGrid() {
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear main canvas

        if (!offscreenCanvas) return;

        ctx.save();
        ctx.translate(offsetX, offsetY); // Apply pan
        ctx.scale(scale, scale);       // Apply zoom

        // Draw the offscreen canvas (entire grid) onto the main canvas.
        // The translate and scale applied above will handle which portion is visible and at what size.
        ctx.drawImage(offscreenCanvas, 0, 0);

        ctx.restore(); // Restore context to prevent transforms affecting other elements

        // Highlight drawing (this is correctly applying transforms after restore)
        if (selectedPixel.x !== null && selectedPixel.y !== null) {
            ctx.save();
            ctx.translate(offsetX, offsetY);
            ctx.scale(scale, scale);
            ctx.strokeStyle = 'var(--gd-highlight-color, orange)'; // Default to orange if CSS var not found
            // Line width needs to be adjusted by inverse scale to appear consistent regardless of zoom
            ctx.lineWidth = 3 / scale;
            ctx.strokeRect(selectedPixel.x * PIXEL_SIZE, selectedPixel.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
            ctx.restore();
        }
    }

    // --- Canvas Drawing Functions (Live View - Optimized) ---

    // Initializes ImageData for the live view canvas
    function initLiveViewImageData() {
        liveViewImageData = liveViewCtx.createImageData(LIVE_VIEW_CANVAS_WIDTH, LIVE_VIEW_CANVAS_HEIGHT);
        liveViewPixelData = liveViewImageData.data; // This is a Uint8ClampedArray
    }

    // Draws the entire grid data onto the LIVE VIEW canvas using ImageData
    function drawLiveViewGrid() { // No longer takes grid as argument, uses global gridData
        if (!liveViewCtx || !liveViewPixelData) {
            console.error("Live View Canvas Context or ImageData not available.");
            return;
        }

        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                const color = gridData[y] && gridData[y][x] !== undefined ? gridData[y][x] : '#000000'; // Default to black
                const [r, g, b, a] = hexToRgba(color);

                // Calculate target pixel on live view canvas (it's 1x1 here)
                const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);

                const imageDataIndex = (targetY * LIVE_VIEW_CANVAS_WIDTH + targetX) * 4;

                // Ensure the index is within bounds before writing
                if (imageDataIndex >= 0 && imageDataIndex + 3 < liveViewPixelData.length) {
                    liveViewPixelData[imageDataIndex] = r;
                    liveViewPixelData[imageDataIndex + 1] = g;
                    liveViewPixelData[imageDataIndex + 2] = b;
                    liveViewPixelData[imageDataIndex + 3] = a;
                }
            }
        }
        liveViewCtx.putImageData(liveViewImageData, 0, 0); // Re-draw the entire live view (fast for small canvas)
    }

    // --- Utility Functions ---
    function generateSessionId() {
        return `session_${Math.random().toString(36).substring(2, 11)}${Date.now().toString(36)}`;
    }

    // --- OAuth Authentication ---
    function initiateDiscordOAuth() {
        const scopes = 'identify email';
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}`;
        window.location.href = oauthUrl;
    }

    async function handleOAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        if (code) {
            try {
                const response = await fetch(`${BACKEND_URL}/auth/discord`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, redirect_uri: OAUTH_REDIRECT_URI })
                });

                if (response.ok) {
                    const data = await response.json();
                    userToken = data.access_token;
                    userData = data.user;
                    localStorage.setItem('discord_token', userToken);
                    localStorage.setItem('user_data', JSON.stringify(userData));
                    updateUserInterface();
                    // Clean up URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            } catch (error) {
                console.error('OAuth callback error:', error);
            }
        }
    }

    function logout() {
        userToken = null;
        userData = null;
        localStorage.removeItem('discord_token');
        localStorage.removeItem('user_data');
        updateUserInterface();
    }

    function updateUserInterface() {
        const loginBtn = document.getElementById('discordLoginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userInfo = document.getElementById('userInfo');

        if (userData && userToken) {
            if (loginBtn) loginBtn.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
            if (userInfo) {
                userInfo.style.display = 'flex';

                // Update avatar and username elements without recreating logout button
                const avatarEl = document.getElementById('userAvatar');
                const nameEl = document.getElementById('userName');
                if (avatarEl) {
                    avatarEl.src = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`;
                }
                if (nameEl) {
                    nameEl.textContent = `${userData.username}#${userData.discriminator}`;
                }

                // Add cooldown toggle if not already present
                if (!document.getElementById('cooldownToggleContainer')) {
                    const label = document.createElement('label');
                    label.id = 'cooldownToggleContainer';
                    label.style.marginLeft = '8px';
                    label.style.cursor = 'pointer';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = 'cooldownToggle';
                    checkbox.checked = enforceCooldown;
                    checkbox.style.marginRight = '4px';

                    label.appendChild(checkbox);
                    label.appendChild(document.createTextNode('Enable Cooldown'));
                    userInfo.appendChild(label);

                    checkbox.addEventListener('change', (e) => {
                        enforceCooldown = e.target.checked;
                        if (!enforceCooldown) {
                            updateCooldownTimerDisplay();
                        } else {
                            if (isCooldownActive()) {
                                updateCooldownTimerDisplay();
                                if (!cooldownIntervalId) {
                                    cooldownIntervalId = setInterval(updateCooldownTimerDisplay, 1000);
                                }
                            }
                        }
                    });
                }
            }
        } else {
            if (loginBtn) loginBtn.style.display = 'inline-block';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (userInfo) userInfo.style.display = 'none';

            const toggleContainer = document.getElementById('cooldownToggleContainer');
            if (toggleContainer) toggleContainer.remove();

            enforceCooldown = true; // enforce for unauthenticated users
            updateCooldownTimerDisplay();
        }
    }

    // --- Webhook Integration ---
    async function sendWebhookNotification(x, y, color) {
        try {
            const username = userData ? `${userData.username}#${userData.discriminator}` : 'Anonymous';
            const payload = {
                x,
                y,
                color,
                user: userData,
                username,
                timestamp: new Date().toISOString()
            };

            await fetch(`${BACKEND_URL}/api/webhook/discord`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(userToken && { 'Authorization': `Bearer ${userToken}` })
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.warn('Failed to send Discord webhook notification:', error);
        }
    }

    // --- Pixel Log Function ---
    function addPixelLogEntry(x, y, color) {
        if (!pixelChatLog) {
            console.error("Pixel chat log element not found.");
            return;
        }

        const logEntry = document.createElement('p');
        // Basic check for string x,y for "System" messages
        const displayX = typeof x === 'number' ? x : 'System';
        const displayY = typeof y === 'number' ? y : (y === 'Connected' || y === 'Disconnected' || y === 'Reconnecting…' || y.startsWith('Connection Error')) ? '' : y;

        logEntry.innerHTML = `(<span style="color: lightblue;">${displayX}</span>, <span style="color: lightblue;">${displayY}</span>) set to <span style="color: ${color}; font-weight: bold;">${color}</span>`;
        pixelChatLog.appendChild(logEntry);

        pixelChatLog.scrollTop = pixelChatLog.scrollHeight;
    }


    // --- Event Handlers (Mouse & Touch) ---

    // Corrected getGridCoordsFromScreen: relies solely on canvas.getBoundingClientRect()
    // and inverse transforms, assuming no direct border/padding on canvas itself.
    function getGridCoordsFromScreen(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();

        // These calculations should be correct if rect.left/top correctly represent the
        // top-left of the canvas's drawing area in screen coordinates.
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;

        // Apply inverse of current offset and scale
        const worldX = (canvasX - offsetX) / scale;
        const worldY = (canvasY - offsetY) / scale;

        // Convert world coordinates (scaled pixel values) to grid coordinates
        const gridX = Math.floor(worldX / PIXEL_SIZE);
        const gridY = Math.floor(worldY / PIXEL_SIZE);

        console.log('--- getGridCoordsFromScreen Debug ---');
        console.log(`Input Screen: (${clientX}, ${clientY})`);
        console.log(`Canvas Bounding Rect: left=${rect.left.toFixed(2)}, top=${rect.top.toFixed(2)}, width=${rect.width.toFixed(2)}, height=${rect.height.toFixed(2)}`); // Added width/height for more context
        console.log(`Canvas Local (relative to canvas top-left): (${canvasX.toFixed(2)}, ${canvasY.toFixed(2)})`);
        console.log(`Current Transform: offsetX=${offsetX.toFixed(2)}, offsetY=${offsetY.toFixed(2)}, scale=${scale.toFixed(2)}`);
        console.log(`World (after inverse transform): X=${worldX.toFixed(2)}, Y=${worldY.toFixed(2)}`);
        console.log(`Grid Coords (final result): (${gridX}, ${gridY})`);
        console.log('------------------------------------');

        if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
            return { x: gridX, y: gridY };
        }
        return null;
    }

    function handleUserInteractionClick(event) {
        const currentX = event.clientX;
        const currentY = event.clientY;

        const coords = getGridCoordsFromScreen(currentX, currentY);

        if (coords) {
            if (selectedPixel.x !== coords.x || selectedPixel.y !== coords.y) {
                // console.log('DEBUG: SELECTED PIXEL CHANGING!', {old: selectedPixel, new: coords});
            }
            selectedPixel = { x: coords.x, y: coords.y };
            updateSelectedCoordsDisplay();
            drawGrid(); // Redraw main canvas to show highlight
        } else {
            if (selectedPixel.x !== null) {
                // console.log('DEBUG: SELECTED PIXEL CLEARED!', {old: selectedPixel, new: null});
            }
            selectedPixel = { x: null, y: null };
            updateSelectedCoordsDisplay();
            drawGrid(); // Redraw main canvas to remove highlight
        }
    }

    // Mouse Handlers
    function handleMouseDown(event) {
        isDragging = true;
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
        lastClickX = event.clientX;
        lastClickY = event.clientY;
        canvas.classList.add('grabbing');
        // console.log('DEBUG: Mouse Down - Starting interaction. Stored start coords:', lastClickX, lastClickY);
    }

    function handleMouseMove(event) {
        if (!isDragging) {
            return;
        }

        const dx = event.clientX - lastMouseX;
        const dy = event.clientY - lastMouseY;

        offsetX += dx;
        offsetY += dy;

        // Round offsets to nearest integer pixel to help alignment
        offsetX = Math.round(offsetX);
        offsetY = Math.round(offsetY);

        lastMouseX = event.clientX;
        lastMouseY = event.clientY;

        drawGrid(); // Redraw main canvas
    }

    function handleMouseUp(event) {
        isDragging = false;
        canvas.classList.remove('grabbing');
        // console.log('DEBUG: Mouse Up - Ending interaction.');

        const dx = event.clientX - lastClickX;
        const dy = event.clientY - lastClickY;

        if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
            // console.log('DEBUG: Mouse Up - Detected as a click. Calling handleUserInteractionClick with start coords.');
            handleUserInteractionClick({ clientX: lastClickX, clientY: lastClickY });
        } else {
            // console.log('DEBUG: Mouse Up - Detected as a drag. No selection change.');
        }
    }

    // Touch Handlers
    function handleTouchStart(event) {
        event.preventDefault();

        if (event.touches.length === 1) {
            isDragging = true;
            lastTouchX = event.touches[0].clientX;
            lastTouchY = event.touches[0].clientY;
            touchStartX = event.touches[0].clientX;
            touchStartY = event.touches[0].clientY;
            canvas.classList.add('grabbing');
            initialPinchDistance = null;
            // console.log('DEBUG: Touch Start - Single touch (potential drag/tap). Stored start coords:', touchStartX, touchStartY);
        } else if (event.touches.length === 2) {
            isDragging = false;
            initialPinchDistance = getPinchDistance(event);
            // console.log('DEBUG: Touch Start - Two touches (potential pinch-to-zoom). initialPinchDistance:', initialPinchDistance);
        } else {
            // console.log('DEBUG: Touch Start - More than 2 touches. Ignoring.');
        }
    }

    function handleTouchMove(event) {
        event.preventDefault();

        if (event.touches.length === 1 && isDragging) {
            const dx = event.touches[0].clientX - lastTouchX;
            const dy = event.touches[0].clientY - lastTouchY;

            offsetX += dx;
            offsetY += dy;

            // Round offsets to nearest integer pixel
            offsetX = Math.round(offsetX);
            offsetY = Math.round(offsetY);

            lastTouchX = event.touches[0].clientX;
            lastTouchY = event.touches[0].clientY;

            drawGrid(); // Redraw main canvas
        } else if (event.touches.length === 2 && initialPinchDistance !== null) {
            const currentPinchDistance = getPinchDistance(event);
            const scaleChange = currentPinchDistance / initialPinchDistance;

            const oldScale = scale;
            scale *= scaleChange;
            scale = Math.max(0.1, Math.min(scale, 10.0));

            const touchCenterX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
            const touchCenterY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

            const rect = canvas.getBoundingClientRect();
            const mouseCanvasX = touchCenterX - rect.left;
            const mouseCanvasY = touchCenterY - rect.top;

            const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
            const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

            offsetX = mouseCanvasX - mouseWorldX * scale;
            offsetY = mouseCanvasY - mouseWorldY * scale;

            // Round offsets to nearest integer pixel
            offsetX = Math.round(offsetX);
            offsetY = Math.round(offsetY);

            initialPinchDistance = currentPinchDistance;
            drawGrid(); // Redraw main canvas
            // console.log(`DEBUG: Touch Move - Pinch-to-zoom. scale:${scale}, currentPinchDistance:${currentPinchDistance}`);
        }
    }

    function handleTouchEnd(event) {
        canvas.classList.remove('grabbing');
        isDragging = false;
        initialPinchDistance = null;
        // console.log('DEBUG: Touch End - Ending interaction.');

        if (event.changedTouches.length === 1) {
            const finalX = event.changedTouches[0].clientX;
            const finalY = event.changedTouches[0].clientY;

            const dx = finalX - touchStartX;
            const dy = finalY - touchStartY;

            if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
                // console.log('DEBUG: Touch End - Detected as a tap. Calling handleUserInteractionClick with start coords.');
                handleUserInteractionClick({ clientX: touchStartX, clientY: touchStartY });
            } else {
                // console.log('DEBUG: Touch End - Detected as a drag/swipe. No selection change.');
            }
        }
    }

    function getPinchDistance(event) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        return Math.sqrt(
            (touch2.clientX - touch1.clientX) ** 2 +
            (touch2.clientY - touch1.clientY) ** 2
        );
    }


    function handleMouseWheel(event) {
        if (event.preventDefault) {
            event.preventDefault();
        }

        const zoomFactor = 0.1;
        const oldScale = scale;

        if (event.deltaY < 0) { // Zoom in
            scale *= (1 + zoomFactor);
        } else { // Zoom out
            scale /= (1 + zoomFactor);
        }

        scale = Math.max(0.1, Math.min(scale, 10.0)); // Clamp scale

        const rect = canvas.getBoundingClientRect();
        const mouseCanvasX = event.clientX - rect.left;
        const mouseCanvasY = event.clientY - rect.top;

        // Calculate world coordinates of the mouse before zoom
        const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
        const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

        // Adjust offsetX and offsetY to keep the mouse point fixed after zoom
        offsetX = mouseCanvasX - mouseWorldX * scale;
        offsetY = mouseCanvasY - mouseWorldY * scale; // Corrected: was canvasY, now mouseCanvasY

        // Round offsets to nearest integer pixel
        offsetX = Math.round(offsetX);
        offsetY = Math.round(offsetY);

        drawGrid(); // Redraw main canvas
        // console.log(`DEBUG: Mouse Wheel - Zoom. deltaY:${event.deltaY}, new scale:${scale}, offsetX:${offsetX.toFixed(2)}, offsetY:${offsetY.toFixed(2)}`);
    }

    function handlePlacePixelClick() {
        if (selectedPixel.x === null || selectedPixel.y === null) {
            alert('Please select a pixel on the canvas first!');
            return;
        }

        if (isCooldownActive()) {
            const remaining = Math.ceil((COOLDOWN_DURATION_MS - (Date.now() - lastPixelTime)) / 1000);
            alert(`Please wait ${remaining}s before placing another pixel.`);
            return;
        }

        placePixel(selectedPixel.x, selectedPixel.y, currentColor);

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
            selectedCoordsDisplay.textContent = 'None';
        }
    }

    // Keyboard controls for desktop: arrow keys to move selection, spacebar to place pixel
    function handleKeyDown(event) {
        if (event.defaultPrevented) return; // Do nothing if event already handled
        switch (event.key) {
            case 'ArrowUp':
                if (selectedPixel.y > 0) selectedPixel.y--;
                break;
            case 'ArrowDown':
                if (selectedPixel.y < GRID_HEIGHT - 1) selectedPixel.y++;
                break;
            case 'ArrowLeft':
                if (selectedPixel.x > 0) selectedPixel.x--;
                break;
            case 'ArrowRight':
                if (selectedPixel.x < GRID_WIDTH - 1) selectedPixel.x++;
                break;
            case ' ':
            case 'Spacebar':
            case 'Space':
                event.preventDefault();
                handlePlacePixelClick();
                return;
            default:
                return; // Exit for other keys
        }
        event.preventDefault();
        // Initialize selection if none
        if (selectedPixel.x === null || selectedPixel.y === null) {
            selectedPixel.x = 0;
            selectedPixel.y = 0;
        }
        updateSelectedCoordsDisplay();
        drawGrid();
    }

    // --- WebSocket Setup ---

    function createReconnectButton() {
        const btn = document.createElement('button');
        btn.id = 'reconnectButton';
        btn.textContent = 'Reconnect';
        btn.style.display = 'none'; // Initially hidden
        btn.style.padding = '8px 15px';
        btn.style.marginLeft = '8px';
        btn.style.borderRadius = '5px';
        btn.style.fontWeight = 'bold';
        btn.style.cursor = 'pointer';
        btn.style.backgroundColor = '#4caf50';
        btn.style.color = '#fff';
        btn.style.border = 'none'; // Ensure no border from Tailwind is overriding

        btn.addEventListener('click', () => {
            if (!socket) return;
            addPixelLogEntry('System', 'Reconnecting…', '#ffff00');
            btn.disabled = true;
            connectWebSocket();
        });

        // Append to the same div as placePixelBtn for consistent layout
        if (placePixelBtn?.parentElement) {
            placePixelBtn.parentElement.appendChild(btn);
        } else {
            // Fallback if the footer structure is unexpected
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
                console.log('Connected to backend WebSocket');
                addPixelLogEntry('System', 'Connected', '#00ff00');
                reconnectButton.style.display = 'none';
                reconnectButton.disabled = false;
                reconnectAttempts = 0;
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'pixelUpdate') {
                        const { x, y, color } = data;

                        // 1. Update global gridData
                        if (gridData[y]?.[x] !== undefined) {
                            gridData[y][x] = color;
                        }

                        // 2. Update offscreen canvas (for main view) for the specific pixel
                        drawPixelToOffscreen(x, y, color);

                        // 3. Update live view pixel directly in ImageData
                        if (liveViewPixelData) {
                            const [r, g, b, a] = hexToRgba(color);
                            const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                            const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);
                            const imageDataIndex = (targetY * LIVE_VIEW_CANVAS_WIDTH + targetX) * 4;

                            if (imageDataIndex >= 0 && imageDataIndex + 3 < liveViewPixelData.length) {
                                liveViewPixelData[imageDataIndex] = r;
                                liveViewPixelData[imageDataIndex + 1] = g;
                                liveViewPixelData[imageDataIndex + 2] = b;
                                liveViewPixelData[imageDataIndex + 3] = a;
                            }
                            liveViewCtx.putImageData(liveViewImageData, 0, 0);
                        }

                        // 4. Redraw main grid
                        drawGrid();
                        addPixelLogEntry(x, y, color);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            socket.onclose = (event) => {
                console.log('WebSocket connection closed:', event.code, event.reason);
                addPixelLogEntry('System', 'Disconnected', '#ff0000');

                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(() => connectWebSocket(), RECONNECT_DELAY * reconnectAttempts);
                } else {
                    reconnectButton.style.display = 'inline-block';
                    alert('Connection lost. Please click reconnect to retry.');
                }
            };

            socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                addPixelLogEntry('System', 'Connection Error', '#ff9900');
            };

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            addPixelLogEntry('System', `Connection Error: ${error.message}`, '#ff9900');
            reconnectButton.style.display = 'inline-block';
        }
    }

    function setupWebSocket() {
        connectWebSocket();
    }

    // --- Cooldown Utility Functions ---
    function isCooldownActive() {
        if (!enforceCooldown) return false;
        return (Date.now() - lastPixelTime) < COOLDOWN_DURATION_MS;
    }

    function startCooldownTimer() {
        if (!enforceCooldown) return;
        lastPixelTime = Date.now();
        localStorage.setItem('lastPixelTime', lastPixelTime.toString());
        updateCooldownTimerDisplay();
        if (cooldownIntervalId) clearInterval(cooldownIntervalId);
        cooldownIntervalId = setInterval(updateCooldownTimerDisplay, 1000);
    }

    function updateCooldownTimerDisplay() {
        if (!cooldownTimerDiv) return;

        if (!enforceCooldown) {
            cooldownTimerDiv.style.display = 'none';
            if (cooldownIntervalId) {
                clearInterval(cooldownIntervalId);
                cooldownIntervalId = null;
            }
            return;
        }

        const remaining = COOLDOWN_DURATION_MS - (Date.now() - lastPixelTime);
        if (remaining <= 0) {
            cooldownTimerDiv.style.display = 'none';
            if (cooldownIntervalId) {
                clearInterval(cooldownIntervalId);
                cooldownIntervalId = null;
            }
            return;
        }

        cooldownTimerDiv.textContent = `Cooldown: ${Math.ceil(remaining / 1000)}s`;
        cooldownTimerDiv.style.display = 'block';
    }

    // --- Initialization ---

    async function init() {
        if (customColorSwatch && colorPicker) {
            customColorSwatch.style.backgroundColor = colorPicker.value;
        }

        // Create floating cooldown timer
        cooldownTimerDiv = document.createElement('div');
        cooldownTimerDiv.id = 'cooldownTimer';
        cooldownTimerDiv.style.position = 'fixed';
        cooldownTimerDiv.style.top = '10px';
        cooldownTimerDiv.style.left = '50%';
        cooldownTimerDiv.style.transform = 'translateX(-50%)';
        cooldownTimerDiv.style.padding = '6px 12px';
        cooldownTimerDiv.style.backgroundColor = 'rgba(0,0,0,0.75)';
        cooldownTimerDiv.style.color = '#fff';
        cooldownTimerDiv.style.fontWeight = 'bold';
        cooldownTimerDiv.style.borderRadius = '4px';
        cooldownTimerDiv.style.zIndex = '10000';
        cooldownTimerDiv.style.display = 'none';
        document.body.appendChild(cooldownTimerDiv);

        // Setup Discord OAuth button handlers
        const loginBtn = document.getElementById('discordLoginBtn');
        if (loginBtn) loginBtn.addEventListener('click', initiateDiscordOAuth);
        const logoutBtnElement = document.getElementById('logoutBtn');
        if (logoutBtnElement) logoutBtnElement.addEventListener('click', logout);

        // Show cooldown timer on load if necessary
        if (isCooldownActive()) {
            updateCooldownTimerDisplay();
            cooldownIntervalId = setInterval(updateCooldownTimerDisplay, 1000);
        }

        setCanvasSize();

        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = GRID_WIDTH * PIXEL_SIZE;
        offscreenCanvas.height = GRID_HEIGHT * PIXEL_SIZE;
        offscreenCtx = offscreenCanvas.getContext('2d');
        // Set image smoothing on the offscreen canvas context to false for crisp pixels
        offscreenCtx.imageSmoothingEnabled = false;
        console.log('Offscreen Canvas created.');

        if (liveViewCanvas) {
            initLiveViewImageData();
        }
        // Also set image smoothing for the live view canvas for crisp pixels
        liveViewCtx.imageSmoothingEnabled = false;

        gridData = await getGrid();

        drawFullOffscreenGrid(gridData);

        const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
        const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

        const fitScaleX = canvas.width / gridPixelWidth;
        const fitScaleY = canvas.height / gridPixelHeight;
        scale = Math.min(fitScaleX, fitScaleY) * 0.9; // Fit it with a small margin
        scale = Math.max(scale, 0.1); // Ensure it's not too small

        // Center the grid initially
        offsetX = (canvas.width - (gridPixelWidth * scale)) / 2;
        offsetY = (canvas.height - (gridPixelHeight * scale)) / 2;

        // Round initial offsets too
        offsetX = Math.round(offsetX);
        offsetY = Math.round(offsetY);

        // Set image smoothing on the main canvas context to false for crisp pixels when scaled
        ctx.imageSmoothingEnabled = false;

        drawGrid(); // Draws from offscreen
        drawLiveViewGrid(); // Draws using ImageData

        window.addEventListener('resize', setCanvasSize);
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseout', handleMouseUp); // Ensure mouseup is called if dragging off canvas
        canvas.addEventListener('wheel', handleMouseWheel, { passive: false });
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
        canvas.addEventListener('touchcancel', handleTouchEnd); // Handle touches ending unexpectedly

        colorPicker.addEventListener('input', handleColorChange);
        if (customColorSwatch) { // Check if element exists before adding listener
            customColorSwatch.addEventListener('click', () => { colorPicker.click(); });
        }
        placePixelBtn.addEventListener('click', handlePlacePixelClick);

        // When simulating wheel, use mouseCanvasX/Y as the center of zoom
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => handleMouseWheel({
                deltaY: -1,
                clientX: canvas.getBoundingClientRect().left + canvas.width / 2, // Center of canvas in screen coords
                clientY: canvas.getBoundingClientRect().top + canvas.height / 2, // Center of canvas in screen coords
                preventDefault: () => { }
            }));
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => handleMouseWheel({
                deltaY: 1,
                clientX: canvas.getBoundingClientRect().left + canvas.width / 2,
                clientY: canvas.getBoundingClientRect().top + canvas.height / 2,
                preventDefault: () => { }
            }));
        }

        window.reconnectButton = createReconnectButton();

        updateSelectedCoordsDisplay();
        setupWebSocket();

        // Add keyboard event listener for arrow keys and spacebar
        document.addEventListener('keydown', handleKeyDown);

        // Handle OAuth callback and update UI
        await handleOAuthCallback();
        updateUserInterface();

        console.log('Frontend initialized!');
    }

    init();

});
