const PIXEL_SIZE = 10;
const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;
const LIVE_VIEW_PIXEL_SIZE_FACTOR = 2;
const LIVE_VIEW_CANVAS_WIDTH = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR;
const LIVE_VIEW_CANVAS_HEIGHT = 500 / LIVE_VIEW_PIXEL_SIZE_FACTOR;

const DEBUG_RAF = false;
const log = (...args) => DEBUG_RAF && console.log("[canvas-raf]", ...args);

export class Canvas {
	constructor() {
		this.canvas = document.getElementById("neuroCanvas");
		this.ctx = this.canvas.getContext("2d");

		this.highlightCanvas = document.getElementById("neuroHighlightCanvas");
		this.highlightCtx = this.highlightCanvas.getContext("2d");

		this.liveViewCanvas = document.getElementById("liveViewCanvas");
		this.liveViewCtx = this.liveViewCanvas.getContext("2d");

		if (this.liveViewCtx) {
			this.liveViewCtx.imageSmoothingEnabled = false;
			this.initLiveViewImageData();
		}

		this.scale = 1.0;
		this.offsetX = 0;
		this.offsetY = 0;

		this.dirtyGrid = true;
		this.dirtyHighlight = true;
		this.dirtyLiveView = false;

		this.gridData = [];
		this.selectedPixel = { x: null, y: null };

		this.offCanvas = document.createElement("canvas");
		this.offCanvas.width = GRID_WIDTH;
		this.offCanvas.height = GRID_HEIGHT;
		this.offCtx = this.offCanvas.getContext("2d");
		this.offCtx.imageSmoothingEnabled = false;

		this.offImageData = new ImageData(GRID_WIDTH, GRID_HEIGHT);
		this.offBuf32 = new Uint32Array(this.offImageData.data.buffer);

		this.colorCache = new Map();

		// web worker for grid processing
		this.worker = new Worker("rebuilder.js", { type: "module" });
		this.worker.onmessage = ({ data }) => {
			this.offCtx.putImageData(data.img, 0, 0);
			this.markDirty(true, false, false);
		};

		this.rafId = 0;

		this.setCanvasSize();
	}

	initLiveViewImageData() {
		if (!this.liveViewCtx) return;

		this.liveViewImageData = this.liveViewCtx.createImageData(
			LIVE_VIEW_CANVAS_WIDTH,
			LIVE_VIEW_CANVAS_HEIGHT,
		);
		this.liveViewPixelData = this.liveViewImageData.data;
	}

	fromHex(hex) {
		if (!hex) return [0, 0, 0, 0];

		const cached = this.colorCache.get(hex);
		if (cached !== undefined) return cached;

		let h = hex.startsWith("#")
			? hex.slice(1).toLowerCase()
			: hex.toLowerCase();

		if (h.length === 3 || h.length === 4) {
			h = [...h].map((ch) => ch + ch).join("");
		}

		let r = 0,
			g = 0,
			b = 0,
			a = 255;

		if (h.length === 6) {
			r = parseInt(h.slice(0, 2), 16);
			g = parseInt(h.slice(2, 4), 16);
			b = parseInt(h.slice(4, 6), 16);
		} else if (h.length === 8) {
			r = parseInt(h.slice(0, 2), 16);
			g = parseInt(h.slice(2, 4), 16);
			b = parseInt(h.slice(4, 6), 16);
			a = parseInt(h.slice(6, 8), 16);
		} else {
			console.warn("fromHex: unexpected hex length", hex);
		}

		const rgba = [r, g, b, a];
		this.colorCache.set(hex, rgba);

		const MAX_CACHE = 4096;
		if (this.colorCache.size > MAX_CACHE) {
			const first = this.colorCache.keys().next().value;
			this.colorCache.delete(first);
		}

		return rgba;
	}

	parseColor(hex) {
		const [r, g, b, a] = this.fromHex(hex);
		return (a << 24) | (b << 16) | (g << 8) | r;
	}

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

	async rebuildOffCanvasAsync(grid) {
		const CHUNK_SIZE = Math.ceil(GRID_HEIGHT / 8);
		const totalChunks = Math.ceil(GRID_HEIGHT / CHUNK_SIZE);

		for (let chunk = 0; chunk < totalChunks; chunk++) {
			const yStart = chunk * CHUNK_SIZE;
			const yEnd = Math.min(yStart + CHUNK_SIZE, GRID_HEIGHT);

			this.rebuildOffCanvas(grid, yStart, yEnd);

			this.markDirty(true, false, false);

			await new Promise((r) => requestIdleCallback(r, { timeout: 50 }));
		}

		this.markDirty(true, true, true);
	}

	setCanvasSize() {
		const dpr = window.devicePixelRatio || 1;

		let cssWidth, cssHeight;
		const mainContentDiv = document.getElementById("main-content");
		if (mainContentDiv) {
			cssWidth = mainContentDiv.clientWidth;
			cssHeight = mainContentDiv.clientHeight;
		} else {
			const leftPanel = document.getElementById("left-panel");
			const leftPanelWidth = leftPanel ? leftPanel.offsetWidth : 0;
			cssWidth = window.innerWidth - leftPanelWidth;
			const bottomBar = document.querySelector(".bottom-bar");
			const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 0;
			cssHeight = window.innerHeight - bottomBarHeight;
		}

		this.canvas.style.width = `${cssWidth}px`;
		this.canvas.style.height = `${cssHeight}px`;

		this.canvas.width = cssWidth * dpr;
		this.canvas.height = cssHeight * dpr;

		this.ctx.scale(dpr, dpr);

		if (this.liveViewCanvas) {
			this.liveViewCanvas.width = LIVE_VIEW_CANVAS_WIDTH;
			this.liveViewCanvas.height = LIVE_VIEW_CANVAS_HEIGHT;
			this.liveViewImageData = null;
			this.initLiveViewImageData();
		}

		if (this.highlightCanvas) {
			this.highlightCanvas.style.width = `${cssWidth}px`;
			this.highlightCanvas.style.height = `${cssHeight}px`;
			this.highlightCanvas.width = cssWidth * dpr;
			this.highlightCanvas.height = cssHeight * dpr;
			this.highlightCtx.scale(dpr, dpr);
		}

		this.dirtyHighlight = true;

		if (this.gridData && this.gridData.length > 0) {
			this.dirtyGrid = true;
			this.dirtyLiveView = true;
		}
	}

	drawPixel(x, y, color) {
		this.ctx.fillStyle = color;
		this.ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
	}

	drawGrid(grid) {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		this.ctx.save();
		this.ctx.translate(this.offsetX, this.offsetY);
		this.ctx.scale(this.scale, this.scale);

		const worldMinX = (0 - this.offsetX) / this.scale;
		const worldMinY = (0 - this.offsetY) / this.scale;
		const worldMaxX = (this.canvas.width - this.offsetX) / this.scale;
		const worldMaxY = (this.canvas.height - this.offsetY) / this.scale;

		let startCol = Math.floor(worldMinX / PIXEL_SIZE) - 1;
		let endCol = Math.ceil(worldMaxX / PIXEL_SIZE) + 1;
		let startRow = Math.floor(worldMinY / PIXEL_SIZE) - 1;
		let endRow = Math.ceil(worldMaxY / PIXEL_SIZE) + 1;

		startCol = Math.max(0, startCol);
		startRow = Math.max(0, startRow);
		endCol = Math.min(GRID_WIDTH - 1, endCol);
		endRow = Math.min(GRID_HEIGHT - 1, endRow);

		this.ctx.strokeStyle = "rgba(128, 128, 128, 0.2)";
		this.ctx.lineWidth = 0.5 / this.scale;

		for (let x = startCol; x <= endCol + 1; x++) {
			this.ctx.beginPath();
			this.ctx.moveTo(x * PIXEL_SIZE, startRow * PIXEL_SIZE);
			this.ctx.lineTo(x * PIXEL_SIZE, (endRow + 1) * PIXEL_SIZE);
			this.ctx.stroke();
		}

		for (let y = startRow; y <= endRow + 1; y++) {
			this.ctx.beginPath();
			this.ctx.moveTo(startCol * PIXEL_SIZE, y * PIXEL_SIZE);
			this.ctx.lineTo((endCol + 1) * PIXEL_SIZE, y * PIXEL_SIZE);
			this.ctx.stroke();
		}

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
			this.selectedPixel.x >= startCol &&
			this.selectedPixel.x <= endCol &&
			this.selectedPixel.y >= startRow &&
			this.selectedPixel.y <= endRow
		) {
			this.dirtyHighlight = true;
		}

		this.ctx.restore();
	}

	drawHighlightLayer() {
		if (!this.highlightCtx) return;

		this.highlightCtx.clearRect(
			0,
			0,
			this.highlightCanvas.width,
			this.highlightCanvas.height,
		);

		if (this.selectedPixel.x === null || this.selectedPixel.y === null) {
			return;
		}

		this.highlightCtx.save();
		this.highlightCtx.translate(this.offsetX, this.offsetY);
		this.highlightCtx.scale(this.scale, this.scale);

		this.highlightCtx.strokeStyle = "var(--gd-highlight-color)";
		this.highlightCtx.lineWidth = 3 / this.scale;
		this.highlightCtx.strokeRect(
			this.selectedPixel.x * PIXEL_SIZE,
			this.selectedPixel.y * PIXEL_SIZE,
			PIXEL_SIZE,
			PIXEL_SIZE,
		);

		this.highlightCtx.restore();
	}

	drawLiveViewGrid(grid) {
		if (!this.liveViewCtx) {
			console.error("Live View Canvas Context not available.");
			return;
		}

		if (!this.liveViewImageData) {
			this.initLiveViewImageData();
		}

		for (let y = 0; y < GRID_HEIGHT; y++) {
			for (let x = 0; x < GRID_WIDTH; x++) {
				if (grid[y] && grid[y][x] !== undefined) {
					const color = grid[y][x];
					const [r, g, b, a] = this.hexToRgba(color);

					const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
					const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);

					const imageDataIndex =
						(targetY * this.liveViewCanvas.width + targetX) * 4;

					if (
						imageDataIndex >= 0 &&
						imageDataIndex + 3 < this.liveViewPixelData.length
					) {
						this.liveViewPixelData[imageDataIndex] = r;
						this.liveViewPixelData[imageDataIndex + 1] = g;
						this.liveViewPixelData[imageDataIndex + 2] = b;
						this.liveViewPixelData[imageDataIndex + 3] = a;
					}
				}
			}
		}

		this.liveViewCtx.putImageData(this.liveViewImageData, 0, 0);
	}

	hexToRgba(hex) {
		return this.fromHex(hex).slice();
	}

	drawGridBlit() {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		this.ctx.save();
		this.ctx.translate(this.offsetX, this.offsetY);
		this.ctx.scale(this.scale, this.scale);

		this.ctx.imageSmoothingEnabled = false;

		this.ctx.drawImage(
			this.offCanvas,
			0,
			0,
			this.offCanvas.width,
			this.offCanvas.height,
			0,
			0,
			this.offCanvas.width * PIXEL_SIZE,
			this.offCanvas.height * PIXEL_SIZE,
		);

		this.ctx.restore();

		this.dirtyHighlight = true;
	}

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

	markDirty(grid = false, highlight = false, liveView = false) {
		if (grid) this.dirtyGrid = true;
		if (highlight) this.dirtyHighlight = true;
		if (liveView) this.dirtyLiveView = true;

		log("markDirty called", { grid, highlight, liveView, rafId: this.rafId });

		if (!this.rafId) {
			this.rafId = requestAnimationFrame(() => this.render());
			log("RAF started, id:", this.rafId);
		}
	}

	render() {
		let _hasChanges = false;

		log("render cycle", {
			dirtyGrid: this.dirtyGrid,
			dirtyHighlight: this.dirtyHighlight,
			dirtyLiveView: this.dirtyLiveView,
		});

		if (this.dirtyGrid && this.gridData && this.gridData.length) {
			this.drawGridBlit();
			this.dirtyGrid = false;
			_hasChanges = true;
			log("drew main grid");
		}

		if (this.dirtyHighlight) {
			this.drawHighlightLayer();
			this.dirtyHighlight = false;
			_hasChanges = true;
			log("drew highlight layer");
		}

		if (this.dirtyLiveView && this.gridData && this.gridData.length) {
			requestIdleCallback(
				() => {
					this.drawLiveViewGrid(this.gridData);
					this.dirtyLiveView = false;
				},
				{ timeout: 100 },
			);
			_hasChanges = true;
			log("scheduled live view for idle time");
		}

		if (this.dirtyGrid || this.dirtyHighlight || this.dirtyLiveView) {
			this.rafId = requestAnimationFrame(() => this.render());
			log("RAF continues, still dirty");
		} else {
			if (this.rafId) {
				cancelAnimationFrame(this.rafId);
			}
			this.rafId = 0;
			log("RAF stopped, all clean");
		}
	}

	setSelectedPixel(x, y) {
		const wasSelected =
			this.selectedPixel.x !== null && this.selectedPixel.y !== null;
		const newSelected = x !== null && y !== null;

		this.selectedPixel = { x, y };

		if (wasSelected || newSelected) {
			this.markDirty(false, true, false);
		}
	}

	updateGridData(newGridData) {
		this.gridData = newGridData;

		this.worker.postMessage({
			grid: newGridData,
			w: GRID_WIDTH,
			h: GRID_HEIGHT,
		});
	}

	updatePixel(x, y, color) {
		if (this.gridData[y] && this.gridData[y][x] !== undefined) {
			this.gridData[y][x] = color;
		}

		this.offCtx.fillStyle = color;
		this.offCtx.fillRect(x, y, 1, 1);

		if (this.liveViewPixelData) {
			const [r, g, b, a] = this.hexToRgba(color);
			const targetX = Math.floor(x / LIVE_VIEW_PIXEL_SIZE_FACTOR);
			const targetY = Math.floor(y / LIVE_VIEW_PIXEL_SIZE_FACTOR);
			const imageDataIndex =
				(targetY * this.liveViewCanvas.width + targetX) * 4;

			if (
				imageDataIndex >= 0 &&
				imageDataIndex + 3 < this.liveViewPixelData.length
			) {
				this.liveViewPixelData[imageDataIndex] = r;
				this.liveViewPixelData[imageDataIndex + 1] = g;
				this.liveViewPixelData[imageDataIndex + 2] = b;
				this.liveViewPixelData[imageDataIndex + 3] = a;

				this.liveViewCtx.putImageData(
					this.liveViewImageData,
					0,
					0,
					targetX,
					targetY,
					1,
					1,
				);
			}
		}

		this.markDirty(true, false, false);
	}

	initializeView() {
		const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
		const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

		const fitScaleX = this.canvas.width / gridPixelWidth;
		const fitScaleY = this.canvas.height / gridPixelHeight;
		this.scale = Math.min(fitScaleX, fitScaleY) * 0.9;
		this.scale = Math.max(this.scale, 0.1);

		this.offsetX = (this.canvas.width - gridPixelWidth * this.scale) / 2;
		this.offsetY = (this.canvas.height - gridPixelHeight * this.scale) / 2;

		this.markDirty(true, true, true);
	}
}
