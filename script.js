// --- Configuration ---
const BACKEND_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';
const WEBSOCKET_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';

const PIXEL_SIZE = 10; // Base size of each pixel in main grid coordinates

// --- Live View Configuration ---
const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2; // For a 500x500 grid, live view will be 250x250 pixels.
const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; // Should be 250
const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; // Should be 250

const CLICK_THRESHOLD = 5; // Maximum pixel movement to still be considered a click/tap


// --- DOM Elements (Main Canvas) ---
const canvas = document.getElementById('rplaceCanvas');
const ctx = canvas.getContext('2d');
console.log('--- Debug: Main Canvas Context ---');
console.log('Canvas element:', canvas);
console.log('Canvas 2D context:', ctx);

// --- DOM Elements (Live View Canvas) ---
const liveViewCanvas = document.getElementById('liveViewCanvas');
const liveViewCtx = liveViewCanvas.getContext('2d');
console.log('--- Debug: Live View Canvas Context ---');
console.log('Live View Canvas element:', liveViewCanvas);
console.log('Live View Canvas 2D context:', liveViewCtx);

// --- DOM Element for Pixel Chat Log ---
const pixelChatLog = document.getElementById('pixelChatLog');


const colorPicker = document.getElementById('colorPicker');
const placePixelBtn = document.getElementById('placePixelBtn');
const selectedCoordsDisplay = document.getElementById('selectedCoords');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');

// --- Global State ---
let currentColor = colorPicker.value;
let gridData = [];
let selectedPixel = { x: null, y: null }; // Initialize to null explicitly for clarity

// ADD BELOW: WebSocket instance reference so it can be reused by the reconnect button
let socket = null; // Holds the Socket.IO client instance

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
let lastClickX = 0; // Store mouse down X for click detection
let lastClickY = 0; // Store mouse down Y for click detection

// --- Touch Interaction State ---
let initialPinchDistance = null; // For pinch-to-zoom
let lastTouchX = 0; // For single-touch drag
let lastTouchY = 0; // For single-touch drag
let touchStartX = 0; // Store touch start X for tap detection
let touchStartY = 0; // Store touch start Y for tap detection


// --- Canvas Setup and Resizing ---
function setCanvasSize() {
    // Get dimensions of the parent container for rplaceCanvas, which is #main-content
    const mainContentDiv = document.getElementById('main-content');
    if (mainContentDiv) {
        canvas.width = mainContentDiv.clientWidth;
        canvas.height = mainContentDiv.clientHeight;
        console.log('--- Debug: rplaceCanvas Size ---');
        console.log('Calculated rplaceCanvas Width:', canvas.width, 'Calculated rplaceCanvas Height:', canvas.height);
    } else {
        // Fallback for initial load if main-content isn't fully rendered or found (less likely with DOMContentLoaded)
        const leftPanel = document.getElementById('left-panel');
        const leftPanelWidth = leftPanel ? leftPanel.offsetWidth : 0;
        canvas.width = window.innerWidth - leftPanelWidth;

        const bottomBar = document.querySelector('.bottom-bar');
        const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 0;
        canvas.height = window.innerHeight - bottomBarHeight;
        console.log('--- Debug: Fallback Canvas Size Calculation ---');
        console.log('Calculated Canvas Width:', canvas.width, 'Calculated Canvas Height:', canvas.height);
    }

    // Set fixed dimensions for live view canvas attributes, for crisp rendering
    if (liveViewCanvas) {
        liveViewCanvas.width = LIVE_VIEW_CANVAS_WIDTH;
        liveViewCanvas.height = LIVE_VIEW_CANVAS_HEIGHT;
    }


    if (gridData && gridData.length > 0) {
        console.log('setCanvasSize: Redrawing grids due to resize and existing data.');
        drawGrid(gridData);
        drawLiveViewGrid(gridData); // Also redraw live view on resize
    } else {
        console.log('setCanvasSize: Grid data not yet available for redraw.');
    }
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
        console.log('Returning fallback default grid (this will be overridden if backend serves a valid grid).');
        return Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill('#1a1a1a')); // Fallback to dark gray
    }
}

async function placePixel(x, y, color) {
    try {
        const response = await fetch(`${BACKEND_URL}/pixel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ x, y, color })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to place pixel: ${errorData.message || response.statusText}`);
        }

        console.log(`Pixel placement request sent for (${x}, ${y}) with color ${color}`);
    } catch (error) {
        console.error('Error sending pixel update:', error);
        alert(`Failed to place pixel: ${error.message}`);
    }
}

// --- Canvas Drawing Functions (Main View) ---

function drawPixel(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}

function drawGrid(grid) {
    // console.log('--- Debug: drawGrid Call (Main Canvas) ---'); // Commented for less noise
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    let pixelsDrawnCount = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (grid[y] && grid[y][x] !== undefined) {
                drawPixel(x, y, grid[y][x]);
                pixelsDrawnCount++;
            }
        }
    }
    // console.log('Total pixels iterated and drawn (if valid):', pixelsDrawnCount); // Commented for less noise

    if (selectedPixel.x !== null && selectedPixel.y !== null) {
        console.log('Drawing highlight for selected pixel:', selectedPixel.x, selectedPixel.y);
        drawHighlight(selectedPixel.x, selectedPixel.y);
    }

    ctx.restore();
    // console.log('drawGrid completed.'); // Commented for less noise
}

function drawHighlight(x, y) {
    ctx.strokeStyle = 'var(--gd-highlight-color)';
    ctx.lineWidth = 3 / scale;
    ctx.strokeRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}

// --- Canvas Drawing Functions (Live View) ---
function drawLiveViewGrid(grid) {
    if (!liveViewCtx) {
        console.error("Live View Canvas Context not available.");
        return;
    }

    // Clear the live view canvas
    liveViewCtx.clearRect(0, 0, liveViewCanvas.width, liveViewCanvas.height);

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (grid[y] && grid[y][x] !== undefined) {
                liveViewCtx.fillStyle = grid[y][x];
                liveViewCtx.fillRect(
                    x / LIVE_VIEW_PIXEL_SIZE_FACTOR,
                    y / LIVE_VIEW_PIXEL_SIZE_FACTOR,
                    1,
                    1
                );
            }
        }
    }
    // console.log('Live View Grid drawn.'); // Commented for less noise
}

// --- Pixel Log Function ---
function addPixelLogEntry(x, y, color) {
    if (!pixelChatLog) {
        console.error("Pixel chat log element not found.");
        return;
    }

    const logEntry = document.createElement('p');
    logEntry.innerHTML = `(<span style="color: lightblue;">${x}</span>, <span style="color: lightblue;">${y}</span>) set to <span style="color: ${color}; font-weight: bold;">${color}</span>`;
    pixelChatLog.appendChild(logEntry);

    pixelChatLog.scrollTop = pixelChatLog.scrollHeight;
}


// --- Event Handlers (Mouse & Touch) ---

function getGridCoordsFromScreen(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;

    const worldX = (canvasX - offsetX) / scale;
    const worldY = (canvasY - offsetY) / scale;

    const gridX = Math.floor(worldX / PIXEL_SIZE);
    const gridY = Math.floor(worldY / PIXEL_SIZE);

    if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
        return { x: gridX, y: gridY };
    }
    return null;
}

// Unified click/tap handler - Now only triggered on mouseup/touchend if it's a click
function handleUserInteractionClick(event) {
    const currentX = event.clientX;
    const currentY = event.clientY;

    const coords = getGridCoordsFromScreen(currentX, currentY);

    if (coords) {
        if (selectedPixel.x !== coords.x || selectedPixel.y !== coords.y) {
            console.log('DEBUG: SELECTED PIXEL CHANGING!', {old: selectedPixel, new: coords});
            console.trace('Call stack for selectedPixel change');
        } else {
            // console.log('DEBUG: Selected pixel is already', coords, '(no change).'); // Commented for less noise
        }
        selectedPixel = { x: coords.x, y: coords.y };
        updateSelectedCoordsDisplay();
        drawGrid(gridData);
    } else {
        if (selectedPixel.x !== null) { // Only log if it was previously selected
            console.log('DEBUG: SELECTED PIXEL CLEARED!', {old: selectedPixel, new: null});
            console.trace('Call stack for selectedPixel clear');
        } else {
            // console.log('DEBUG: Selected pixel already null (no change).'); // Commented for less noise
        }
        selectedPixel = { x: null, y: null };
        updateSelectedCoordsDisplay();
        drawGrid(gridData);
    }
}

// Mouse Handlers
function handleMouseDown(event) {
    isDragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    lastClickX = event.clientX; // Store for click/drag differentiation
    lastClickY = event.clientY; // Store for click/drag differentiation
    canvas.classList.add('grabbing');
    console.log('DEBUG: Mouse Down - Starting interaction. Stored start coords:', lastClickX, lastClickY);
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

    drawGrid(gridData);
    // console.log(`DEBUG: Mouse Move - Panning. dx:${dx}, dy:${dy}, offsetX:${offsetX}, offsetY:${offsetY}`); // Commented for less noise
}

function handleMouseUp(event) {
    isDragging = false;
    canvas.classList.remove('grabbing');
    console.log('DEBUG: Mouse Up - Ending interaction.');

    // Check if it was a click (movement within threshold)
    const dx = event.clientX - lastClickX;
    const dy = event.clientY - lastClickY;

    if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
        console.log('DEBUG: Mouse Up - Detected as a click. Calling handleUserInteractionClick with start coords.');
        // Pass the original mousedown coordinates for selection
        handleUserInteractionClick({ clientX: lastClickX, clientY: lastClickY });
    } else {
        console.log('DEBUG: Mouse Up - Detected as a drag. No selection change.');
    }
}

// Touch Handlers
function handleTouchStart(event) {
    event.preventDefault(); // Prevent default browser actions like scrolling/zooming

    if (event.touches.length === 1) { // Single touch for dragging/tapping
        isDragging = true;
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
        touchStartX = event.touches[0].clientX; // Store for click/tap differentiation
        touchStartY = event.touches[0].clientY; // Store for click/tap differentiation
        canvas.classList.add('grabbing');
        initialPinchDistance = null; // Ensure pinch state is reset for single touch
        console.log('DEBUG: Touch Start - Single touch (potential drag/tap). Stored start coords:', touchStartX, touchStartY);
    } else if (event.touches.length === 2) { // Two touches for pinch-to-zoom
        isDragging = false; // Disable single-touch drag during pinch
        initialPinchDistance = getPinchDistance(event);
        console.log('DEBUG: Touch Start - Two touches (potential pinch-to-zoom). initialPinchDistance:', initialPinchDistance);
    } else {
        console.log('DEBUG: Touch Start - More than 2 touches. Ignoring.');
    }
}

function handleTouchMove(event) {
    event.preventDefault(); // Prevent default browser scroll/zoom during touch move

    if (event.touches.length === 1 && isDragging) { // Single touch for dragging
        const dx = event.touches[0].clientX - lastTouchX;
        const dy = event.touches[0].clientY - lastTouchY;

        offsetX += dx;
        offsetY += dy;

        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;

        drawGrid(gridData);
        // console.log(`DEBUG: Touch Move - Panning. dx:${dx}, dy:${dy}, offsetX:${offsetX}, offsetY:${offsetY}`); // Commented for less noise
    } else if (event.touches.length === 2 && initialPinchDistance !== null) { // Two touches for pinch-to-zoom
        const currentPinchDistance = getPinchDistance(event);
        const scaleChange = currentPinchDistance / initialPinchDistance;

        const oldScale = scale;
        scale *= scaleChange; // Apply zoom factor
        scale = Math.max(0.1, Math.min(scale, 10.0)); // Clamp scale

        const touchCenterX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const touchCenterY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

        const rect = canvas.getBoundingClientRect();
        const canvasX = touchCenterX - rect.left;
        const canvasY = touchCenterY - rect.top;

        const mouseWorldX = (canvasX - offsetX) / oldScale;
        const mouseWorldY = (canvasY - offsetY) / oldScale;

        offsetX = canvasX - mouseWorldX * scale;
        offsetY = canvasY - mouseWorldY * scale;

        initialPinchDistance = currentPinchDistance; // Update initial for next move event
        drawGrid(gridData);
        console.log(`DEBUG: Touch Move - Pinch-to-zoom. scale:${scale}, currentPinchDistance:${currentPinchDistance}`);
    } else {
        // console.log(`DEBUG: Touch Move - No action. Touches:${event.touches.length}, isDragging:${isDragging}, initialPinchDistance:${initialPinchDistance}`); // Commented for less noise
    }
}

function handleTouchEnd(event) {
    canvas.classList.remove('grabbing');
    isDragging = false;
    initialPinchDistance = null; // Reset pinch state
    console.log('DEBUG: Touch End - Ending interaction.');

    // Only process for selection if it was a single touch that ended
    if (event.changedTouches.length === 1) {
        const finalX = event.changedTouches[0].clientX;
        const finalY = event.changedTouches[0].clientY;

        const dx = finalX - touchStartX;
        const dy = finalY - touchStartY;

        if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
            console.log('DEBUG: Touch End - Detected as a tap. Calling handleUserInteractionClick with start coords.');
            // Pass the original touchstart coordinates for selection
            handleUserInteractionClick({ clientX: touchStartX, clientY: touchStartY });
        } else {
            console.log('DEBUG: Touch End - Detected as a drag/swipe. No selection change.');
        }
    }
}

// Helper function for pinch distance calculation
function getPinchDistance(event) {
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];
    return Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
        Math.pow(touch2.clientY - touch1.clientY, 2)
    );
}


function handleMouseWheel(event) {
    if (event.preventDefault) {
        event.preventDefault(); // Stop default page scroll
    }

    const zoomFactor = 0.1;
    const oldScale = scale;

    if (event.deltaY < 0) { // Zoom in (scroll up)
        scale *= (1 + zoomFactor);
    } else { // Zoom out (scroll down)
        scale /= (1 + zoomFactor);
    }

    scale = Math.max(0.1, Math.min(scale, 10.0)); // Clamp scale

    // Get mouse position relative to canvas for zoom centering
    const rect = canvas.getBoundingClientRect();
    const mouseCanvasX = event.clientX - rect.left;
    const mouseCanvasY = event.clientY - rect.top;

    const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
    const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

    offsetX = mouseCanvasX - mouseWorldX * scale;
    offsetY = mouseCanvasY - mouseWorldY * scale;

    drawGrid(gridData);
    console.log(`DEBUG: Mouse Wheel - Zoom. deltaY:${event.deltaY}, new scale:${scale}`);
}

function handlePlacePixelClick() {
    if (selectedPixel.x !== null && selectedPixel.y !== null) {
        placePixel(selectedPixel.x, selectedPixel.y, currentColor);
    } else {
        alert('Please select a pixel on the canvas first!');
    }
}

function handleColorChange() {
    currentColor = colorPicker.value;
}

function updateSelectedCoordsDisplay() {
    if (selectedPixel.x !== null && selectedPixel.y !== null) {
        selectedCoordsDisplay.textContent = `(${selectedPixel.x}, ${selectedPixel.y})`;
        console.log('DEBUG: Display updated to show selected pixel:', selectedPixel.x, selectedPixel.y);
    } else {
        selectedCoordsDisplay.textContent = 'None';
        console.log('DEBUG: Display updated to show no selected pixel (None).');
    }
}

// --- WebSocket Setup ---

function createReconnectButton() {
    const btn = document.createElement('button');
    btn.id = 'reconnectButton';
    btn.textContent = 'Reconnect';
    btn.style.display = 'none'; 
    btn.style.padding = '8px 15px';
    btn.style.marginLeft = '8px';
    btn.style.borderRadius = '5px';
    btn.style.fontWeight = 'bold';
    btn.style.cursor = 'pointer';
    btn.style.backgroundColor = '#4caf50';
    btn.style.color = '#fff';

    btn.addEventListener('click', () => {
        if (!socket) return;
        addPixelLogEntry('System', 'Reconnecting…', '#ffff00');
        btn.disabled = true; //no more reconnect attempt spamming
        socket.connect(); 
    });

    if (placePixelBtn && placePixelBtn.parentElement) {
        placePixelBtn.parentElement.appendChild(btn);
    } else {
        document.body.appendChild(btn); 
    }

    return btn;
}

const reconnectButton = createReconnectButton();

function setupWebSocket() {
    socket = io(WEBSOCKET_URL, { reconnection: false });

    socket.on('connect', () => {
        console.log('Connected to backend');
        addPixelLogEntry('System', 'Connected', '#00ff00');
        reconnectButton.style.display = 'none';
        reconnectButton.disabled = false;
    });

    socket.on('pixelUpdate', (data) => {
        const { x, y, color } = data;
        console.log(`Received real-time update: Pixel at (${x}, ${y}) changed to ${color}`);
        if (gridData[y] && gridData[y][x] !== undefined) {
            gridData[y][x] = color;
        }
        drawGrid(gridData);
        drawLiveViewGrid(gridData);
        addPixelLogEntry(x, y, color);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from backend. Pausing refresh.');
        alert('Backend unavailable. Press the reconnect button to retry.');
        addPixelLogEntry('System', 'Disconnected', '#ff0000');
        reconnectButton.style.display = 'inline-block';
    });

    socket.on('connect_error', (error) => {
        console.error('Backend connection error:', error);
        alert('Backend unavailable. Press the reconnect button to retry.');
        addPixelLogEntry('System', `Connection Error: ${error.message}`, '#ff9900');
        reconnectButton.style.display = 'inline-block';
    });
}


// --- Initialization ---

async function init() {
    setCanvasSize();

    gridData = await getGrid();

    const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
    const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

    let fitScaleX = canvas.width / gridPixelWidth;
    let fitScaleY = canvas.height / gridPixelHeight;
    scale = Math.min(fitScaleX, fitScaleY) * 0.9;
    scale = Math.max(scale, 0.1);

    offsetX = (canvas.width - (gridPixelWidth * scale)) / 2;
    offsetY = (canvas.height - (gridPixelHeight * scale)) / 2;


    drawGrid(gridData);
    drawLiveViewGrid(gridData);

    window.addEventListener('resize', setCanvasSize);

    // Mouse Event Listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseout', handleMouseUp); // Treat mouse leaving as mouse up
    canvas.addEventListener('wheel', handleMouseWheel, { passive: false });

    // Touch Event Listeners
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    colorPicker.addEventListener('input', handleColorChange);
    placePixelBtn.addEventListener('click', handlePlacePixelClick);
    zoomInBtn.addEventListener('click', () => handleMouseWheel({ deltaY: -1, clientX: canvas.width / 2, clientY: canvas.height / 2, preventDefault: () => {} }));
    zoomOutBtn.addEventListener('click', () => handleMouseWheel({ deltaY: 1, clientX: canvas.width / 2, clientY: canvas.height / 2, preventDefault: () => {} }));


    updateSelectedCoordsDisplay();
    setupWebSocket();

    console.log('Frontend initialized!');
}

document.addEventListener('DOMContentLoaded', init);
