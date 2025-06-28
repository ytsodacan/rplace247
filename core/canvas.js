const PIXEL_SIZE = 10;
const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;
const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2; 
const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR; 
const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR;

// debug logging for performance monitoring
const DEBUG_RAF = false;
const log = (...args) => DEBUG_RAF && console.log('[canvas-raf]', ...args); 

export class Canvas {
    constructor() {
        // main canvas DOM refs
        this.canvas = document.getElementById('neuroCanvas');
        this.ctx = this.canvas.getContext('2d');

        // highlight canvas (absolute overlay) never intercepts pointer events
        this.highlightCanvas = document.getElementById('neuroHighlightCanvas');
        this.highlightCtx = this.highlightCanvas.getContext('2d');

        // live view DOM refs
        this.liveViewCanvas = document.getElementById('liveViewCanvas');
        this.liveViewCtx = this.liveViewCanvas.getContext('2d');

        // pan/zoom state
        this.scale = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;

        // dirty flags for efficient rendering
        this.dirtyGrid = true;
        this.dirtyHighlight = true;
        this.dirtyLiveView = false;

        // grid data
        this.gridData = [];
        this.selectedPixel = { x: null, y: null };

        // off-screen canvas & color handling for fast blit
        this.offCanvas = document.createElement('canvas');
        this.offCanvas.width = GRID_WIDTH; 
        this.offCanvas.height = GRID_HEIGHT;
        this.offCtx = this.offCanvas.getContext('2d');
        this.offCtx.imageSmoothingEnabled = false;

        this.offImageData = new ImageData(GRID_WIDTH, GRID_HEIGHT);
        this.offBuf32 = new Uint32Array(this.offImageData.data.buffer);

        // color cache for performance
        this.colorCache = new Map();

        // RAF management
        this.rafId = 0;
        this.isRendering = false;

        this.setCanvasSize();
    }

    // hex to 0xAARRGGBB color conversion
    parseColor(hex) {
        if (!hex) return 0; // transparent if everything breaks

        const cached = this.colorCache.get(hex);
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
        this.colorCache.set(hex, argb);
        return argb;
    }

    // rebuild off-screen buffer
    rebuildOffCanvas(grid, yStart = 0, yEnd = GRID_HEIGHT) {
        const w = GRID_WIDTH;
        for (let y = yStart; y < yEnd; y++) {
            const row = grid[y];
            if (!row) continue;
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                const col = row[x];
                if (!col) continue;
                this.offBuf32[rowOffset + x] = this.parseColor(col);
            }
        }
        this.offCtx.putImageData(this.offImageData, 0, 0);
    }

    // canvas sizing
    setCanvasSize() {
        const mainContentDiv = document.getElementById('main-content');
        if (mainContentDiv) {
            this.canvas.width = mainContentDiv.clientWidth;
            this.canvas.height = mainContentDiv.clientHeight;
        } else {
            const leftPanel = document.getElementById('left-panel');
            const leftPanelWidth = leftPanel ? leftPanel.offsetWidth : 0;
            this.canvas.width = window.innerWidth - leftPanelWidth;
            const bottomBar = document.querySelector('.bottom-bar');
            const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 0;
            this.canvas.height = window.innerHeight - bottomBarHeight;
        }

        if (this.liveViewCanvas) {
            this.liveViewCanvas.width = LIVE_VIEW_CANVAS_WIDTH;
            this.liveViewCanvas.height = LIVE_VIEW_CANVAS_HEIGHT;
        }

        if (this.highlightCanvas) {
            this.highlightCanvas.width = this.canvas.width;
            this.highlightCanvas.height = this.canvas.height;
        }

        this.dirtyHighlight = true;

        if (this.gridData && this.gridData.length > 0) {
            this.dirtyGrid = true;
            this.dirtyLiveView = true;
        }
    }

    // drawing functions
    drawPixel(x, y, color) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
    }

    drawGrid(grid) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        // viewport culling: screen -> world -> grid indices (add +- 1 cell buffer on each bound)
        const worldMinX = (0 - this.offsetX) / this.scale;
        const worldMinY = (0 - this.offsetY) / this.scale;
        const worldMaxX = (this.canvas.width - this.offsetX) / this.scale;
        const worldMaxY = (this.canvas.height - this.offsetY) / this.scale;

        let startCol = Math.floor(worldMinX / PIXEL_SIZE) - 1;
        let endCol   = Math.ceil(worldMaxX / PIXEL_SIZE) + 1;
        let startRow = Math.floor(worldMinY / PIXEL_SIZE) - 1;
        let endRow   = Math.ceil(worldMaxY / PIXEL_SIZE) + 1;

        // clamp to grid bounds so we don't read undefined rows/cols
        startCol = Math.max(0, startCol);
        startRow = Math.max(0, startRow);
        endCol   = Math.min(GRID_WIDTH  - 1, endCol);
        endRow   = Math.min(GRID_HEIGHT - 1, endRow);

        // draw grid lines for empty areas
        this.ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)';
        this.ctx.lineWidth = 0.5 / this.scale;
        
        // vertical lines
        for (let x = startCol; x <= endCol + 1; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * PIXEL_SIZE, startRow * PIXEL_SIZE);
            this.ctx.lineTo(x * PIXEL_SIZE, (endRow + 1) * PIXEL_SIZE);
            this.ctx.stroke();
        }
        
        // horizontal lines  
        for (let y = startRow; y <= endRow + 1; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(startCol * PIXEL_SIZE, y * PIXEL_SIZE);
            this.ctx.lineTo((endCol + 1) * PIXEL_SIZE, y * PIXEL_SIZE);
            this.ctx.stroke();
        }

        // draw actual pixels on top of grid
        for (let y = startRow; y <= endRow; y++) {
            const row = grid[y];
            if (!row) continue;
            for (let x = startCol; x <= endCol; x++) {
                const color = row[x];
                if (color !== undefined) {
                    this.drawPixel(x, y, color);
                }
            }
        }

        if (
            this.selectedPixel.x !== null &&
            this.selectedPixel.y !== null &&
            this.selectedPixel.x >= startCol && this.selectedPixel.x <= endCol &&
            this.selectedPixel.y >= startRow && this.selectedPixel.y <= endRow
        ) {
            this.dirtyHighlight = true; 
        }

        this.ctx.restore();
    }

    drawHighlightLayer() {
        if (!this.highlightCtx) return;

        // clear previous highlight
        this.highlightCtx.clearRect(0, 0, this.highlightCanvas.width, this.highlightCanvas.height);

        if (this.selectedPixel.x === null || this.selectedPixel.y === null) {
            return; // nothing selected → nothing to draw
        }

        this.highlightCtx.save();
        // mirror the same pan/zoom transforms as the main canvas
        this.highlightCtx.translate(this.offsetX, this.offsetY);
        this.highlightCtx.scale(this.scale, this.scale);

        this.highlightCtx.strokeStyle = 'var(--gd-highlight-color)';
        this.highlightCtx.lineWidth = 3 / this.scale;
        this.highlightCtx.strokeRect(
            this.selectedPixel.x * PIXEL_SIZE,
            this.selectedPixel.y * PIXEL_SIZE,
            PIXEL_SIZE,
            PIXEL_SIZE
        );

        this.highlightCtx.restore();
    }

    drawLiveViewGrid(grid) {
        if (!this.liveViewCtx) {
            console.error("Live View Canvas Context not available.");
            return;
        }

        this.liveViewCtx.clearRect(0, 0, this.liveViewCanvas.width, this.liveViewCanvas.height);

        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (grid[y] && grid[y][x] !== undefined) {
                    this.liveViewCtx.fillStyle = grid[y][x];
                    this.liveViewCtx.fillRect(
                        x / LIVE_VIEW_PIXEL_SIZE_FACTOR,
                        y / LIVE_VIEW_PIXEL_SIZE_FACTOR,
                        1,
                        1
                    );
                }
            }
        }
    }

    drawGridBlit() {
        // clear the visible canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        this.ctx.imageSmoothingEnabled = false;

        this.ctx.drawImage(
            this.offCanvas,
            0, 0, this.offCanvas.width, this.offCanvas.height, 
            0, 0, this.offCanvas.width * PIXEL_SIZE, this.offCanvas.height * PIXEL_SIZE 
        );

        this.ctx.restore();

        // mark highlight layer as dirty so it re-renders
        this.dirtyHighlight = true;
    }

    // coordinate conversion
    getGridCoordsFromScreen(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;

        const worldX = (canvasX - this.offsetX) / this.scale;
        const worldY = (canvasY - this.offsetY) / this.scale;

        const gridX = Math.floor(worldX / PIXEL_SIZE);
        const gridY = Math.floor(worldY / PIXEL_SIZE);

        if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
            return { x: gridX, y: gridY };
        }
        return null;
    }

    // mark canvas as dirty and start render loop if needed
    markDirty(grid = false, highlight = false, liveView = false) {
        if (grid) this.dirtyGrid = true;
        if (highlight) this.dirtyHighlight = true;
        if (liveView) this.dirtyLiveView = true;
        
        log('markDirty called', { grid, highlight, liveView, rafId: this.rafId });
        
        // only start RAF loop if not already running
        if (!this.rafId && !this.isRendering) {
            this.rafId = requestAnimationFrame(() => this.render());
            log('RAF started, id:', this.rafId);
        }
    }

    // main render loop - only draws what's dirty
    render() {
        this.isRendering = true;
        let hasChanges = false;

        log('render cycle', { 
            dirtyGrid: this.dirtyGrid, 
            dirtyHighlight: this.dirtyHighlight,
            dirtyLiveView: this.dirtyLiveView 
        });

        // draw main grid if dirty
        if (this.dirtyGrid && this.gridData && this.gridData.length) {
            this.drawGridBlit();
            this.dirtyGrid = false;
            hasChanges = true;
            log('drew main grid');
        }

        // draw highlight layer if dirty
        if (this.dirtyHighlight) {
            this.drawHighlightLayer();
            this.dirtyHighlight = false;
            hasChanges = true;
            log('drew highlight layer');
        }

        // draw live view if dirty
        if (this.dirtyLiveView && this.gridData && this.gridData.length) {
            this.drawLiveViewGrid(this.gridData);
            this.dirtyLiveView = false;
            hasChanges = true;
            log('drew live view');
        }

        // continue RAF loop if anything is still dirty, otherwise stop
        if (this.dirtyGrid || this.dirtyHighlight || this.dirtyLiveView) {
            this.rafId = requestAnimationFrame(() => this.render());
            log('RAF continues, still dirty');
        } else {
            // clean up RAF state
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
            }
            this.rafId = 0;
            this.isRendering = false;
            log('RAF stopped, all clean');
        }
    }

    // update selected pixel
    setSelectedPixel(x, y) {
        const wasSelected = this.selectedPixel.x !== null && this.selectedPixel.y !== null;
        const newSelected = x !== null && y !== null;
        
        this.selectedPixel = { x, y };
        
        if (wasSelected || newSelected) {
            this.markDirty(false, true, false);
        }
    }

    // update grid data
    updateGridData(newGridData) {
        this.gridData = newGridData;
        this.rebuildOffCanvas(newGridData);
        this.markDirty(true, false, true);
    }

    // apply pixel update to grid
    updatePixel(x, y, color) {
        if (this.gridData[y] && this.gridData[y][x] !== undefined) {
            this.gridData[y][x] = color;
        }
        // poke the off-screen canvas so the next blit is up to date
        this.offCtx.fillStyle = color;
        this.offCtx.fillRect(x, y, 1, 1);
        this.markDirty(true, false, true);
    }

    // initialize fitting and scale
    initializeView() {
        const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
        const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

        let fitScaleX = this.canvas.width / gridPixelWidth;
        let fitScaleY = this.canvas.height / gridPixelHeight;
        this.scale = Math.min(fitScaleX, fitScaleY) * 0.9;
        this.scale = Math.max(this.scale, 0.1);

        this.offsetX = (this.canvas.width - (gridPixelWidth * this.scale)) / 2;
        this.offsetY = (this.canvas.height - (gridPixelHeight * this.scale)) / 2;

        this.markDirty(true, true, true);
    }
} 
