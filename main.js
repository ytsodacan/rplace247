import { Canvas } from "./core/canvas.js";
import { Network } from "./core/network.js";
import { UIControls } from "./ui/controls.js";

// debug mode toggle
const DEBUG = false;
if (!DEBUG) {
	console.log = () => {};
	console.trace = () => {};
}

export const App = {
	canvas: null,
	network: null,
	ui: null,

	async init() {
		console.log("Initializing neuro.place app...");

		try {
			this.canvas = new Canvas();
			this.network = new Network();

			this.ui = new UIControls(this.canvas, this.network);

			this.ui.initTheme();

			console.log("Fetching initial grid...");
			const gridData = await this.network.getGrid();
			this.canvas.updateGridData(gridData);

			this.canvas.initializeView();

			console.log("Setting up WebSocket...");
			this.network.setupWebSocket();

			this.startGameLoop();

			console.log("App initialization complete!");
		} catch (error) {
			console.error("Failed to initialize app:", error);
			alert("Failed to initialize the application. Please refresh the page.");
		}
	},

	startGameLoop() {
		const gameLoop = () => {
			// process incoming pixel updates
			const pixelUpdates = this.network.flushPixelUpdates();
			if (pixelUpdates.length > 0) {
				pixelUpdates.forEach((update) => {
					this.canvas.updatePixel(update.x, update.y, update.color);
				});
			}

			setTimeout(gameLoop, 16);
		};

		gameLoop();
	},
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => App.init());
} else {
	App.init();
}
