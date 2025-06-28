import { config } from "./config.js";

const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;

export class Network {
	constructor() {
		this.socket = null;
		this.pixelUpdateQueue = [];

		this.onConnected = null;
		this.onDisconnected = null;
		this.onConnectionError = null;
		this.onPixelUpdate = null;
		this.onPixelPlacementError = null;
		this.onReconnecting = null;
		this.onReconnectFailed = null;
	}

	async getGrid() {
		try {
			const response = await fetch(`${config.backendUrl}/grid`);
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const data = await response.json();
			console.log("Initial grid fetched successfully.");
			return data;
		} catch (error) {
			console.error("Error fetching grid:", error);
			alert(
				"Could not connect to backend to get initial grid. Is your backend running?",
			);
			console.log(
				"Returning fallback default grid (this will be overridden if backend serves a valid grid).",
			);
			return Array(GRID_HEIGHT)
				.fill(0)
				.map(() => Array(GRID_WIDTH).fill("#1a1a1a"));
		}
	}

	async placePixel(x, y, color) {
		try {
			const response = await fetch(`${config.backendUrl}/pixel`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ x, y, color }),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(
					`Failed to place pixel: ${errorData.message || response.statusText}`,
				);
			}

			console.log(
				`Pixel placement request sent for (${x}, ${y}) with color ${color}`,
			);
		} catch (error) {
			console.error("Error sending pixel update:", error);
			if (this.onPixelPlacementError) {
				this.onPixelPlacementError(x, y, color, "Connection failure");
			}
		}
	}

	setupWebSocket() {
		this.socket = io(config.websocketUrl, {
			transports: ["websocket"],
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelayMax: 2000,
		});

		this.socket.on("connect", () => {
			console.log("Connected to backend");
			if (this.onConnected) {
				this.onConnected();
			}
		});

		this.socket.on("pixelUpdate", (data) => {
			this.pixelUpdateQueue.push(data);
		});

		this.socket.on("disconnect", () => {
			console.log("Disconnected from backend. Pausing refresh.");
			if (this.onDisconnected) {
				this.onDisconnected();
			}
		});

		this.socket.on("connect_error", (error) => {
			console.error("Backend connection error:", error);
			if (this.onConnectionError) {
				this.onConnectionError(error);
			}
		});

		this.socket.io.on("reconnect_attempt", () => {
			console.log("Attempting to reconnect...");
			if (this.onReconnecting) {
				this.onReconnecting();
			}
		});

		this.socket.on("reconnect_failed", () => {
			console.error("Failed to reconnect after multiple attempts.");
			if (this.onReconnectFailed) {
				this.onReconnectFailed();
			}
		});
	}

	reconnect() {
		if (!this.socket) return;
		this.socket.connect();
	}

	flushPixelUpdates() {
		if (this.pixelUpdateQueue.length === 0) return [];

		const updates = [...this.pixelUpdateQueue];
		this.pixelUpdateQueue.length = 0;
		return updates;
	}

	isConnected() {
		return this.socket?.connected;
	}

	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
		}
	}
}
