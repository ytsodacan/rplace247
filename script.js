const BACKEND_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';
const WEBSOCKET_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';

const PIXEL_SIZE = 10; 

// gate the log calls behind debug flag
const DEBUG = false;
if (!DEBUG) {
    console.log = () => {};
    console.trace = () => {};
}

// for the minimap
const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2; 
const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; 
const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; 

const CLICK_THRESHOLD = 5; 


// main canvas DOM refs
const canvas = document.getElementById('neuroCanvas');
const ctx = canvas.getContext('2d');

// highlight canvas (absolute overlay) never intercepts pointer events
const highlightCanvas = document.getElementById('neuroHighlightCanvas');
const highlightCtx = highlightCanvas.getContext('2d');

highlightCanvas.style.pointerEvents = 'none';


// live view DOM refs
const liveViewCanvas = document.getElementById('liveViewCanvas');
const liveViewCtx = liveViewCanvas.getContext('2d');
console.log('--- Debug: Live View Canvas Context ---');
console.log('Live View Canvas element:', liveViewCanvas);
console.log('Live View Canvas 2D context:', liveViewCtx);

// pixel chat log DOM ref
const pixelChatLog = document.getElementById('pixelChatLog');

const colorPicker = document.getElementById('colorPicker');
const placePixelBtn = document.getElementById('placePixelBtn');
const selectedCoordsDisplay = document.getElementById('selectedCoords');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');

// global state
let currentColor = colorPicker.value;
let gridData = [];
let selectedPixel = { x: null, y: null }; 

let socket = null; 

let dirty = true; 
let highlightDirty = true; 

const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;

// off-screen canvas & color handling for fast blit
const offCanvas = document.createElement('canvas');
offCanvas.width = GRID_WIDTH; 
offCanvas.height = GRID_HEIGHT;
const offCtx = offCanvas.getContext('2d');
offCtx.imageSmoothingEnabled = false;

const offImageData = new ImageData(GRID_WIDTH, GRID_HEIGHT);
const offBuf32     = new Uint32Array(offImageData.data.buffer); // was recreating every time oof

// hex to 0xAARRGGBB
const colorCache = new Map();
function parseColor(hex) {
    if (!hex) return 0; // transparent if everything breaks

    const cached = colorCache.get(hex);
    if (cached !== undefined) return cached;

    let h = hex.startsWith('#') ? hex.slice(1) : hex;

    // expand smol hex to big hex
    if (h.length === 3 || h.length === 4) {
        h = [...h].map(ch => ch + ch).join('');
    }

    let r = 0, g = 0, b = 0, a = 0xFF;

    if (h.length === 6) {
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
    } else if (h.length === 8) {
        const headAlpha = parseInt(h.slice(0, 2), 16);
        const tailAlpha = parseInt(h.slice(6), 16);

        if (headAlpha < 0x20) { 
            a = headAlpha;
            r = parseInt(h.slice(2, 4), 16);
            g = parseInt(h.slice(4, 6), 16);
            b = tailAlpha;
        } else {
            a = tailAlpha;
            r = parseInt(h.slice(0, 2), 16);
            g = parseInt(h.slice(2, 4), 16);
            b = parseInt(h.slice(4, 6), 16);
        }
    } else {
        console.warn('parseColor: unexpected hex length', hex);
    }

    // pack into BGRA (little-endian uint32 type)
    const argb = (a << 24) | (b << 16) | (g << 8) | r;
    colorCache.set(hex, argb);
    return argb;
}

// rebuild off-screen buffer
function rebuildOffCanvas(grid, yStart = 0, yEnd = GRID_HEIGHT) {
    const w = GRID_WIDTH;
    for (let y = yStart; y < yEnd; y++) {
        const row = grid[y];
        if (!row) continue;
        const rowOffset = y * w;
        for (let x = 0; x < w; x++) {
            const col = row[x];
            if (!col) continue;
            offBuf32[rowOffset + x] = parseColor(col);
        }
    }
    offCtx.putImageData(offImageData, 0, 0);
}

// pan/zoom state for main canvas
let scale = 1.0;
let offsetX = 0;
let offsetY = 0;

// mouse state
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let lastClickX = 0; // for click vs drag
let lastClickY = 0;

// touch state
let initialPinchDistance = null; // pinch-to-zoom
let lastTouchX = 0; // single-finger drag
let lastTouchY = 0;
let touchStartX = 0; // for tap vs drag
let touchStartY = 0;


// canvas sizing, tries to fit parent or fallback if main-content is missing (shouldn't happen glueless)
function setCanvasSize() {
    // try to fit #main-content if it exists
    const mainContentDiv = document.getElementById('main-content');
    if (mainContentDiv) {
        canvas.width = mainContentDiv.clientWidth;
        canvas.height = mainContentDiv.clientHeight;
        console.log('--- Debug: Main Canvas Context ---');
        console.log('neuroCanvas element:', canvas);
        console.log('neuroCanvas 2D context:', ctx);
    } else {
        
        const leftPanel = document.getElementById('left-panel');
        const leftPanelWidth = leftPanel ? leftPanel.offsetWidth : 0;
        canvas.width = window.innerWidth - leftPanelWidth;
        const bottomBar = document.querySelector('.bottom-bar');
        const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 0;
        canvas.height = window.innerHeight - bottomBarHeight;
        console.log('--- Debug: Fallback Canvas Size Calculation ---');
        console.log('Calculated Canvas Width:', canvas.width, 'Calculated Canvas Height:', canvas.height);
    }

    if (liveViewCanvas) {
        liveViewCanvas.width = LIVE_VIEW_CANVAS_WIDTH;
        liveViewCanvas.height = LIVE_VIEW_CANVAS_HEIGHT;
    }

    if (highlightCanvas) {
        highlightCanvas.width = canvas.width;
        highlightCanvas.height = canvas.height;
    }

    highlightDirty = true; 

    if (gridData && gridData.length > 0) {
        console.log('setCanvasSize: Marking dirty due to resize with existing data.');
        dirty = true; 
    } else {
        console.log('setCanvasSize: Grid data not yet available for redraw.');
    }
}

// gets from backend
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
        // fallback: just fill it with dark gray (this ruined my life thinking i did something wrong before this)
        return Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill('#1a1a1a'));
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

// drawing to the canvas

function drawPixel(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}

function drawGrid(grid) {
    // ctx.clearRect wipes the canvas, so we start fresh (this is the only way to clear the canvas)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // viewport culling: screen -> world -> grid indices (add +- 1 cell buffer on each bound)
    const worldMinX = (0 - offsetX) / scale;
    const worldMinY = (0 - offsetY) / scale;
    const worldMaxX = (canvas.width - offsetX) / scale;
    const worldMaxY = (canvas.height - offsetY) / scale;

    let startCol = Math.floor(worldMinX / PIXEL_SIZE) - 1;
    let endCol   = Math.ceil(worldMaxX / PIXEL_SIZE) + 1;
    let startRow = Math.floor(worldMinY / PIXEL_SIZE) - 1;
    let endRow   = Math.ceil(worldMaxY / PIXEL_SIZE) + 1;

    // clamp to grid bounds so we don't read undefined rows/cols
    startCol = Math.max(0, startCol);
    startRow = Math.max(0, startRow);
    endCol   = Math.min(GRID_WIDTH  - 1, endCol);
    endRow   = Math.min(GRID_HEIGHT - 1, endRow);

    let pixelsDrawnCount = 0;

    for (let y = startRow; y <= endRow; y++) {
        const row = grid[y];
        if (!row) continue;
        for (let x = startCol; x <= endCol; x++) {
            const color = row[x];
            if (color !== undefined) {
                drawPixel(x, y, color);
                pixelsDrawnCount++;
            }
        }
    }

    if (DEBUG) {
        console.log(`drawGrid: drawn ${pixelsDrawnCount} pixels (rows ${startRow}-${endRow}, cols ${startCol}-${endCol})`);
    }

    if (
        selectedPixel.x !== null &&
        selectedPixel.y !== null &&
        selectedPixel.x >= startCol && selectedPixel.x <= endCol &&
        selectedPixel.y >= startRow && selectedPixel.y <= endRow
    ) {
        highlightDirty = true; 
    }

    ctx.restore();
}

function drawHighlightLayer() {
    if (!highlightCtx) return;

    // clear previous highlight
    highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

    if (selectedPixel.x === null || selectedPixel.y === null) {
        return; // nothing selected → nothing to draw
    }

    highlightCtx.save();
    // mirror the same pan/zoom transforms as the main canvas
    highlightCtx.translate(offsetX, offsetY);
    highlightCtx.scale(scale, scale);

    highlightCtx.strokeStyle = 'var(--gd-highlight-color)';
    highlightCtx.lineWidth = 3 / scale;
    highlightCtx.strokeRect(
        selectedPixel.x * PIXEL_SIZE,
        selectedPixel.y * PIXEL_SIZE,
        PIXEL_SIZE,
        PIXEL_SIZE
    );

    highlightCtx.restore();
}

// minimap drawing
function drawLiveViewGrid(grid) {
    if (!liveViewCtx) {
        console.error("Live View Canvas Context not available.");
        return;
    }

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
}

// rAF loop, only draws if dirty aka it has a change to draw
function tick() {
    if (dirty && gridData && gridData.length) {
        drawGridBlit();
        drawLiveViewGrid(gridData);
        dirty = false;
    }

    if (highlightDirty) {
        drawHighlightLayer();
        highlightDirty = false;
    }

    requestAnimationFrame(tick);
}

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

function handleUserInteractionClick(event) {
    const currentX = event.clientX;
    const currentY = event.clientY;

    const coords = getGridCoordsFromScreen(currentX, currentY);

    if (coords) {
        if (selectedPixel.x !== coords.x || selectedPixel.y !== coords.y) {
            console.log('DEBUG: SELECTED PIXEL CHANGING!', {old: selectedPixel, new: coords});
            console.trace('Call stack for selectedPixel change');
        }
        selectedPixel = { x: coords.x, y: coords.y };
        updateSelectedCoordsDisplay();
        dirty = true; 
        highlightDirty = true;
    } else {
        if (selectedPixel.x !== null) {
            console.log('DEBUG: SELECTED PIXEL CLEARED!', {old: selectedPixel, new: null});
            console.trace('Call stack for selectedPixel clear');
        }
        selectedPixel = { x: null, y: null };
        updateSelectedCoordsDisplay();
        dirty = true; 
        highlightDirty = true;
    }
}

function handleMouseDown(event) {
    isDragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    lastClickX = event.clientX; 
    lastClickY = event.clientY;
    canvas.classList.add('grabbing');
    console.log('DEBUG: Mouse Down - Starting interaction. Stored start coords:', lastClickX, lastClickY);
}

function handleMouseMove(event) {
    if (!isDragging) return;

    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;

    offsetX += dx;
    offsetY += dy;

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    dirty = true; 
    highlightDirty = true;
}

function handleMouseUp(event) {
    isDragging = false;
    canvas.classList.remove('grabbing');
    console.log('DEBUG: Mouse Up - Ending interaction.');

    const dx = event.clientX - lastClickX;
    const dy = event.clientY - lastClickY;

    if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
        console.log('DEBUG: Mouse Up - Detected as a click. Calling handleUserInteractionClick with start coords.');
        handleUserInteractionClick({ clientX: lastClickX, clientY: lastClickY });
    } else {
        console.log('DEBUG: Mouse Up - Detected as a drag. No selection change.');
    }
}

// touch handlers
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
        console.log('DEBUG: Touch Start - Single touch (potential drag/tap). Stored start coords:', touchStartX, touchStartY);
    } else if (event.touches.length === 2) { 
        isDragging = false; // no drag while pinching
        initialPinchDistance = getPinchDistance(event);
        console.log('DEBUG: Touch Start - Two touches (potential pinch-to-zoom). initialPinchDistance:', initialPinchDistance);
    } else {
        console.log('DEBUG: Touch Start - More than 2 touches. Ignoring.');
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

        dirty = true; 
        highlightDirty = true;
    } else if (event.touches.length === 2 && initialPinchDistance !== null) {
        const currentPinchDistance = getPinchDistance(event);
        const scaleChange = currentPinchDistance / initialPinchDistance;

        const oldScale = scale;
        scale *= scaleChange;
        scale = Math.max(0.1, Math.min(scale, 10.0)); // clamps scale

        const touchCenterX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const touchCenterY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

        const rect = canvas.getBoundingClientRect();
        const canvasX = touchCenterX - rect.left;
        const canvasY = touchCenterY - rect.top;

        const mouseWorldX = (canvasX - offsetX) / oldScale;
        const mouseWorldY = (canvasY - offsetY) / oldScale;

        offsetX = canvasX - mouseWorldX * scale;
        offsetY = canvasY - mouseWorldY * scale;

        initialPinchDistance = currentPinchDistance;
        dirty = true; 
        highlightDirty = true;
        console.log(`DEBUG: Touch Move - Pinch-to-zoom. scale:${scale}, currentPinchDistance:${currentPinchDistance}`);
    }
}

function handleTouchEnd(event) {
    canvas.classList.remove('grabbing');
    isDragging = false;
    initialPinchDistance = null; 
    console.log('DEBUG: Touch End - Ending interaction.');

    // only care if it was a single touch that ended
    if (event.changedTouches.length === 1) {
        const finalX = event.changedTouches[0].clientX;
        const finalY = event.changedTouches[0].clientY;

        const dx = finalX - touchStartX;
        const dy = finalY - touchStartY;

        if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
            console.log('DEBUG: Touch End - Detected as a tap. Calling handleUserInteractionClick with start coords.');
            handleUserInteractionClick({ clientX: touchStartX, clientY: touchStartY });
        } else {
            console.log('DEBUG: Touch End - Detected as a drag/swipe. No selection change.');
        }
    }
}

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
        event.preventDefault(); 
    }

    const zoomFactor = 0.1;
    const oldScale = scale;

    if (event.deltaY < 0) { 
        scale *= (1 + zoomFactor);
    } else { 
        scale /= (1 + zoomFactor);
    }

    scale = Math.max(0.1, Math.min(scale, 10.0)); // clamps scale

    // zoom around mouse
    const rect = canvas.getBoundingClientRect();
    const mouseCanvasX = event.clientX - rect.left;
    const mouseCanvasY = event.clientY - rect.top;

    const mouseWorldX = (mouseCanvasX - offsetX) / oldScale;
    const mouseWorldY = (mouseCanvasY - offsetY) / oldScale;

    offsetX = mouseCanvasX - mouseWorldX * scale;
    offsetY = mouseCanvasY - mouseWorldY * scale;

    dirty = true; 
    highlightDirty = true;
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

// websocket handling

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
        btn.disabled = true; // no reconnect spam
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
        // poke the off-screen canvas so the next blit is up to date
        offCtx.fillStyle = color;
        offCtx.fillRect(x, y, 1, 1);
        dirty = true; 
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


// startup init
async function init() {
    setCanvasSize();

    gridData = await getGrid();
    rebuildOffCanvas(gridData);

    const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
    const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

    let fitScaleX = canvas.width / gridPixelWidth;
    let fitScaleY = canvas.height / gridPixelHeight;
    scale = Math.min(fitScaleX, fitScaleY) * 0.9;
    scale = Math.max(scale, 0.1);

    offsetX = (canvas.width - (gridPixelWidth * scale)) / 2;
    offsetY = (canvas.height - (gridPixelHeight * scale)) / 2;

    dirty = true; // sets this for first draw

    window.addEventListener('resize', setCanvasSize);

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseout', handleMouseUp); 
    canvas.addEventListener('wheel', handleMouseWheel, { passive: false });

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

    requestAnimationFrame(tick);
}

document.addEventListener('DOMContentLoaded', init);

function drawGridBlit() {
    // clear the visible canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(
        offCanvas,
        0, 0, offCanvas.width, offCanvas.height, 
        0, 0, offCanvas.width * PIXEL_SIZE, offCanvas.height * PIXEL_SIZE 
    );

    ctx.restore();

    // mark highlight layer as dirty so it re-renders
    highlightDirty = true;
}
