// --- Configuration ---

const BACKEND_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';
const WEBSOCKET_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';

const PIXEL_SIZE = 10; // Base size of each pixel in main grid coordinates

// --- Live View Configuration ---
const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2; // For a 500x500 grid, live view will be 250x250 pixels.
const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; // Should be 250
const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; // Should be 250


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

// --- NEW: DOM Element for Pixel Chat Log ---
const pixelChatLog = document.getElementById('pixelChatLog');


const colorPicker = document.getElementById('colorPicker');
const placePixelBtn = document.getElementById('placePixelBtn');
const selectedCoordsDisplay = document.getElementById('selectedCoords');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');

// --- Global State ---
let currentColor = colorPicker.value;
let gridData = [];
let selectedPixel = { x: null, y: null };

// --- Canvas Dimensions (Must match backend grid dimensions) ---
const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;

// --- Viewport Transform State (for Main Canvas Pan & Zoom) ---
let scale = 1.0;
let offsetX = 0;
let offsetY = 0;

let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let lastClickX = 0; // To differentiate click from drag
let lastClickY = 0; // To differentiate click from drag


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
        selectedPixel = { x: null, y: null };
        updateSelectedCoordsDisplay();
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
    console.log('--- Debug: drawGrid Call (Main Canvas) ---');
    console.log('Clearing canvas from (0,0) to (' + canvas.width + ',' + canvas.height + ')');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    console.log('Applying transforms: scale=', scale, 'offsetX=', offsetX, 'offsetY=', offsetY);
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
    console.log('Total pixels iterated and drawn (if valid):', pixelsDrawnCount);

    if (selectedPixel.x !== null && selectedPixel.y !== null) {
        console.log('Drawing highlight for selected pixel:', selectedPixel.x, selectedPixel.y);
        drawHighlight(selectedPixel.x, selectedPixel.y);
    }

    ctx.restore();
    console.log('drawGrid completed.');
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
                // Draw pixels for live view. Each grid cell becomes 1 pixel on the live view canvas.
                // We use the LIVE_VIEW_PIXEL_SIZE_FACTOR to map original grid coords to live view coords.
                liveViewCtx.fillRect(
                    x / LIVE_VIEW_PIXEL_SIZE_FACTOR,
                    y / LIVE_VIEW_PIXEL_SIZE_FACTOR,
                    1, // Always draw a 1x1 pixel in live view's coordinate system
                    1
                );
            }
        }
    }
    console.log('Live View Grid drawn.');
}

// --- NEW: Pixel Log Function ---
function addPixelLogEntry(x, y, color) {
    if (!pixelChatLog) {
        console.error("Pixel chat log element not found.");
        return;
    }

    const logEntry = document.createElement('p');
    // Format the message: (X, Y) set to #COLOR
    logEntry.innerHTML = `(<span style="color: lightblue;">${x}</span>, <span style="color: lightblue;">${y}</span>) set to <span style="color: ${color}; font-weight: bold;">${color}</span>`;
    pixelChatLog.appendChild(logEntry);

    // Auto-scroll to the bottom of the log
    pixelChatLog.scrollTop = pixelChatLog.scrollHeight;
}


// --- Event Handlers ---

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

function handleCanvasClick(event) {
    // Check if it was a drag or a click
    if (Math.abs(event.clientX - lastClickX) > 5 || Math.abs(event.clientY - lastClickY) > 5) {
        console.log('DEBUG: Mouse click suppressed (was likely a drag).');
        return; // It was a drag, not a click, so don't select pixel
    }

    const coords = getGridCoordsFromScreen(event.clientX, event.clientY);

    if (coords) {
        selectedPixel = { x: coords.x, y: coords.y };
        updateSelectedCoordsDisplay();
        drawGrid(gridData);
        console.log('DEBUG: Pixel selected via click:', coords.x, coords.y);
    } else {
        selectedPixel = { x: null, y: null };
        updateSelectedCoordsDisplay();
        drawGrid(gridData);
        console.log('DEBUG: Clicked outside grid bounds, selected pixel cleared.');
    }
}

function handleMouseDown(event) {
    isDragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    lastClickX = event.clientX; // Store click position on mouse down
    lastClickY = event.clientY; // Store click position on mouse down
    canvas.classList.add('grabbing');
    console.log('DEBUG: Mouse Down - isDragging:', isDragging, 'ClientX:', event.clientX, 'ClientY:', event.clientY);
}

function handleMouseMove(event) {
    if (!isDragging) return;

    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;

    offsetX += dx;
    offsetY += dy;

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    drawGrid(gridData);
    console.log('DEBUG: Mouse Move - offsetX:', offsetX, 'offsetY:', offsetY, 'dx:', dx, 'dy:', dy);
}

function handleMouseUp() {
    isDragging = false;
    canvas.classList.remove('grabbing');
    console.log('DEBUG: Mouse Up - isDragging:', isDragging);
}

function handleMouseWheel(event) {
    if (event.preventDefault) {
        event.preventDefault();
    }

    const zoomFactor = 0.1;
    const oldScale = scale;

    if (event.deltaY < 0) {
        scale *= (1 + zoomFactor);
    } else {
        scale /= (1 + zoomFactor);
    }

    scale = Math.max(0.1, Math.min(scale, 10.0));

    let mouseCanvasX, mouseCanvasY;
    if (event.clientX !== undefined && event.clientY !== undefined) {
        const rect = canvas.getBoundingClientRect();
        mouseCanvasX = event.clientX - rect.left;
        mouseCanvasY = event.clientY - rect.top;
    } else {
        mouseCanvasX = canvas.width / 2;
        mouseCanvasY = canvas.height / 2;
    }

    const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
    const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

    offsetX = mouseCanvasX - mouseWorldX * scale;
    offsetY = mouseCanvasY - mouseWorldY * scale;

    drawGrid(gridData);
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
    } else {
        selectedCoordsDisplay.textContent = 'None';
    }
}

// --- WebSocket Setup ---

function setupWebSocket() {
    const socket = io(WEBSOCKET_URL);

    socket.on('connect', () => {
        console.log('Connected to WebSocket server!');
        addPixelLogEntry('System', 'Connected', '#00ff00'); // Log connection
    });

    socket.on('pixelUpdate', (data) => {
        const { x, y, color } = data;
        console.log(`Received real-time update: Pixel at (${x}, ${y}) changed to ${color}`);

        if (gridData[y] && gridData[y][x] !== undefined) {
            gridData[y][x] = color;
        }

        drawGrid(gridData);
        drawLiveViewGrid(gridData);
        addPixelLogEntry(x, y, color); // <--- IMPORTANT: Add to pixel log
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from WebSocket server. Attempting to reconnect...');
        addPixelLogEntry('System', 'Disconnected', '#ff0000'); // Log disconnection
    });

    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        addPixelLogEntry('System', `Connection Error: ${error.message}`, '#ff9900'); // Log errors
    });
}


// --- Initialization ---

async function init() {
    setCanvasSize(); // This will setup main and live view canvas dimensions

    gridData = await getGrid();

    const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
    const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

    // Initial scale calculation to fit the grid somewhat
    let fitScaleX = canvas.width / gridPixelWidth;
    let fitScaleY = canvas.height / gridPixelHeight;
    scale = Math.min(fitScaleX, fitScaleY) * 0.9; // Fit and zoom out slightly
    scale = Math.max(scale, 0.1);

    // Center the grid initially
    offsetX = (canvas.width - (gridPixelWidth * scale)) / 2;
    offsetY = (canvas.height - (gridPixelHeight * scale)) / 2;


    drawGrid(gridData);
    drawLiveViewGrid(gridData); // Draw live view initially

    window.addEventListener('resize', setCanvasSize);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseout', handleMouseUp); // Crucial for when mouse leaves canvas while dragging
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('wheel', handleMouseWheel, { passive: false });

    colorPicker.addEventListener('input', handleColorChange);
    placePixelBtn.addEventListener('click', handlePlacePixelClick);
    zoomInBtn.addEventListener('click', () => handleMouseWheel({ deltaY: -1, preventDefault: () => {} }));
    zoomOutBtn.addEventListener('click', () => handleMouseWheel({ deltaY: 1, preventDefault: () => {} }));

    updateSelectedCoordsDisplay();
    setupWebSocket();

    console.log('Frontend initialized!');
}

document.addEventListener('DOMContentLoaded', init);