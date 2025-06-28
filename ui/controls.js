const CLICK_THRESHOLD = 5;

export class UIControls {
	constructor(canvas, network) {
		this.canvas = canvas;
		this.network = network;

		this.colorPicker = document.getElementById("colorPicker");
		this.placePixelBtn = document.getElementById("placePixelBtn");
		this.selectedCoordsDisplay = document.getElementById("selectedCoords");
		this.zoomInBtn = document.getElementById("zoomInBtn");
		this.zoomOutBtn = document.getElementById("zoomOutBtn");
		this.pixelChatLog = document.getElementById("pixelChatLog");
		this.themeToggleBtn = document.getElementById("themeToggleBtn");

		this.currentColor = this.colorPicker.value;
		this.isDragging = false;
		this.lastMouseX = 0;
		this.lastMouseY = 0;
		this.lastClickX = 0;
		this.lastClickY = 0;

		// touch handlers
		this.initialPinchDistance = null;
		this.lastTouchX = 0;
		this.lastTouchY = 0;
		this.touchStartX = 0;
		this.touchStartY = 0;

		this.setupEventListeners();
		this.setupNetworkCallbacks();
		this.updateSelectedCoordsDisplay();
	}

	setupEventListeners() {
		this.canvas.canvas.addEventListener("mousedown", (e) =>
			this.handleMouseDown(e),
		);
		this.canvas.canvas.addEventListener("mousemove", (e) =>
			this.handleMouseMove(e),
		);
		this.canvas.canvas.addEventListener("mouseup", (e) =>
			this.handleMouseUp(e),
		);
		this.canvas.canvas.addEventListener("wheel", (e) =>
			this.handleMouseWheel(e),
		);

		this.canvas.canvas.addEventListener("touchstart", (e) =>
			this.handleTouchStart(e),
		);
		this.canvas.canvas.addEventListener("touchmove", (e) =>
			this.handleTouchMove(e),
		);
		this.canvas.canvas.addEventListener("touchend", (e) =>
			this.handleTouchEnd(e),
		);

		this.colorPicker.addEventListener("change", () => this.handleColorChange());
		this.placePixelBtn.addEventListener("click", () =>
			this.handlePlacePixelClick(),
		);
		this.zoomInBtn.addEventListener("click", () => this.handleZoomIn());
		this.zoomOutBtn.addEventListener("click", () => this.handleZoomOut());
		this.themeToggleBtn.addEventListener("click", () => this.toggleDark());

		window.addEventListener("resize", () => this.handleResize());
	}

	setupNetworkCallbacks() {
		this.network.onConnected = () => {
			this.addSystemLogEntry("Connected to backend", "#00ff00");
			this.removeReconnectButton();
		};

		this.network.onDisconnected = () => {
			this.addSystemLogEntry(
				"Disconnected from backend. Attempting to reconnect...",
				"#ff9900",
			);
		};

		this.network.onConnectionError = (error) => {
			this.addSystemLogEntry(
				`Connection Error: ${error.message || "Unknown error"}`,
				"#ff6666",
			);
			this.createReconnectButton();
		};

		this.network.onPixelPlacementError = (x, y, color, errorMessage) => {
			this.addPixelErrorLogEntry(x, y, color, errorMessage);
		};

		this.network.onReconnecting = () => {
			this.addSystemLogEntry("Reconnecting...", "#ffff00");
		};

		this.network.onReconnectFailed = () => {
			this.addSystemLogEntry(
				"Could not reconnect to the backend. Please try again manually.",
				"#ff6666",
			);
			this.createReconnectButton();
		};
	}

	handleMouseDown(event) {
		this.isDragging = true;
		this.lastMouseX = event.clientX;
		this.lastMouseY = event.clientY;
		this.lastClickX = event.clientX;
		this.lastClickY = event.clientY;
	}

	handleMouseMove(event) {
		if (this.isDragging) {
			const deltaX = event.clientX - this.lastMouseX;
			const deltaY = event.clientY - this.lastMouseY;
			this.canvas.offsetX += deltaX;
			this.canvas.offsetY += deltaY;
			this.lastMouseX = event.clientX;
			this.lastMouseY = event.clientY;
			this.canvas.markDirty(true, true, false);
		}
	}

	handleMouseUp(event) {
		if (this.isDragging) {
			this.isDragging = false;

			const deltaX = Math.abs(event.clientX - this.lastClickX);
			const deltaY = Math.abs(event.clientY - this.lastClickY);

			// distinguish clicks from drags
			if (deltaX <= CLICK_THRESHOLD && deltaY <= CLICK_THRESHOLD) {
				this.handleUserInteractionClick(event);
			}
		}
	}

	handleUserInteractionClick(event) {
		const coords = this.canvas.getGridCoordsFromScreen(
			event.clientX,
			event.clientY,
		);
		if (coords) {
			this.canvas.setSelectedPixel(coords.x, coords.y);
			this.updateSelectedCoordsDisplay();
		}
	}

	handleTouchStart(event) {
		event.preventDefault();

		if (event.touches.length === 1) {
			const touch = event.touches[0];
			this.lastTouchX = touch.clientX;
			this.lastTouchY = touch.clientY;
			this.touchStartX = touch.clientX;
			this.touchStartY = touch.clientY;
		} else if (event.touches.length === 2) {
			this.initialPinchDistance = this.getPinchDistance(event);
		}
	}

	handleTouchMove(event) {
		event.preventDefault();

		if (event.touches.length === 1 && this.initialPinchDistance === null) {
			const touch = event.touches[0];
			const deltaX = touch.clientX - this.lastTouchX;
			const deltaY = touch.clientY - this.lastTouchY;
			this.canvas.offsetX += deltaX;
			this.canvas.offsetY += deltaY;
			this.lastTouchX = touch.clientX;
			this.lastTouchY = touch.clientY;
			this.canvas.markDirty(true, true, false);
		} else if (event.touches.length === 2) {
			const currentDistance = this.getPinchDistance(event);
			if (this.initialPinchDistance !== null) {
				const scaleChange = currentDistance / this.initialPinchDistance;
				const newScale = this.canvas.scale * scaleChange;
				if (newScale >= 0.1 && newScale <= 10) {
					const centerX =
						(event.touches[0].clientX + event.touches[1].clientX) / 2;
					const centerY =
						(event.touches[0].clientY + event.touches[1].clientY) / 2;

					const rect = this.canvas.canvas.getBoundingClientRect();
					const canvasCenterX = centerX - rect.left;
					const canvasCenterY = centerY - rect.top;

					this.canvas.offsetX =
						canvasCenterX - (canvasCenterX - this.canvas.offsetX) * scaleChange;
					this.canvas.offsetY =
						canvasCenterY - (canvasCenterY - this.canvas.offsetY) * scaleChange;

					this.canvas.scale = newScale;
					this.canvas.markDirty(true, true, false);
				}
			}
			this.initialPinchDistance = currentDistance;
		}
	}

	handleTouchEnd(event) {
		event.preventDefault();

		if (event.touches.length === 0) {
			if (this.initialPinchDistance === null) {
				const deltaX = Math.abs(
					event.changedTouches[0].clientX - this.touchStartX,
				);
				const deltaY = Math.abs(
					event.changedTouches[0].clientY - this.touchStartY,
				);

				// same click vs drag logic for touch
				if (deltaX <= CLICK_THRESHOLD && deltaY <= CLICK_THRESHOLD) {
					this.handleUserInteractionTap(event.changedTouches[0]);
				}
			}
			this.initialPinchDistance = null;
		} else if (event.touches.length === 1) {
			this.initialPinchDistance = null;
			const touch = event.touches[0];
			this.lastTouchX = touch.clientX;
			this.lastTouchY = touch.clientY;
		}
	}

	handleUserInteractionTap(touch) {
		const coords = this.canvas.getGridCoordsFromScreen(
			touch.clientX,
			touch.clientY,
		);
		if (coords) {
			this.canvas.setSelectedPixel(coords.x, coords.y);
			this.updateSelectedCoordsDisplay();
		}
	}

	getPinchDistance(event) {
		const touch1 = event.touches[0];
		const touch2 = event.touches[1];
		const dx = touch1.clientX - touch2.clientX;
		const dy = touch1.clientY - touch2.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	handleMouseWheel(event) {
		event.preventDefault();

		const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
		const newScale = this.canvas.scale * zoomFactor;

		if (newScale >= 0.1 && newScale <= 10) {
			const rect = this.canvas.canvas.getBoundingClientRect();
			const mouseX = event.clientX - rect.left;
			const mouseY = event.clientY - rect.top;

			this.canvas.offsetX =
				mouseX - (mouseX - this.canvas.offsetX) * zoomFactor;
			this.canvas.offsetY =
				mouseY - (mouseY - this.canvas.offsetY) * zoomFactor;
			this.canvas.scale = newScale;
			this.canvas.markDirty(true, true, false);
		}
	}

	handleColorChange() {
		this.currentColor = this.colorPicker.value;
	}

	handlePlacePixelClick() {
		if (
			this.canvas.selectedPixel.x !== null &&
			this.canvas.selectedPixel.y !== null
		) {
			this.network.placePixel(
				this.canvas.selectedPixel.x,
				this.canvas.selectedPixel.y,
				this.currentColor,
			);
			this.addPixelLogEntry(
				this.canvas.selectedPixel.x,
				this.canvas.selectedPixel.y,
				this.currentColor,
			);
		} else {
			this.addSystemLogEntry("No pixel selected to place.", "#ff9900");
		}
	}

	handleZoomIn() {
		const newScale = this.canvas.scale * 1.2;
		if (newScale <= 10) {
			this.canvas.scale = newScale;
			this.canvas.markDirty(true, true, false);
		}
	}

	handleZoomOut() {
		const newScale = this.canvas.scale * 0.8;
		if (newScale >= 0.1) {
			this.canvas.scale = newScale;
			this.canvas.markDirty(true, true, false);
		}
	}

	handleResize() {
		this.canvas.setCanvasSize();
		this.canvas.markDirty(true, true, false);
	}

	addLogEntry(element) {
		const atBottom =
			this.pixelChatLog.scrollHeight - this.pixelChatLog.scrollTop <=
			this.pixelChatLog.clientHeight + 1;

		this.pixelChatLog.appendChild(element);

		while (this.pixelChatLog.children.length > 250) {
			this.pixelChatLog.removeChild(this.pixelChatLog.firstChild);
		}

		if (atBottom) {
			this.pixelChatLog.scrollTop = this.pixelChatLog.scrollHeight;
		}
	}

	addPixelLogEntry(x, y, color) {
		const logEntry = document.createElement("div");
		logEntry.className = "log-entry";
		logEntry.innerHTML = `Pixel placed at <b>(${x}, ${y})</b> with color <span style="color:${color};">&#9632;</span>`;
		this.addLogEntry(logEntry);
	}

	addSystemLogEntry(message, color = "var(--text-secondary)") {
		const logEntry = document.createElement("div");
		logEntry.className = "log-entry";
		logEntry.textContent = message;
		logEntry.style.color = color;
		this.addLogEntry(logEntry);
	}

	addPixelErrorLogEntry(x, y, _color, errorMessage) {
		const logEntry = document.createElement("div");
		logEntry.className = "log-entry";
		logEntry.style.color = "var(--error)";
		logEntry.innerHTML = `Failed to place pixel at <b>(${x}, ${y})</b>: <span class="font-mono text-xs">${errorMessage}</span>`;
		this.addLogEntry(logEntry);
	}

	updateSelectedCoordsDisplay() {
		if (
			this.canvas.selectedPixel.x !== null &&
			this.canvas.selectedPixel.y !== null
		) {
			this.selectedCoordsDisplay.textContent = `(${this.canvas.selectedPixel.x}, ${this.canvas.selectedPixel.y})`;
		} else {
			this.selectedCoordsDisplay.textContent = "No pixel selected";
		}
	}

	createReconnectButton() {
		if (document.getElementById("reconnectBtn")) return;

		const button = document.createElement("button");
		button.id = "reconnectBtn";
		button.textContent = "Reconnect";
		button.className = "btn btn-primary w-full mt-4";
		button.onclick = () => {
			this.network.reconnect();
			button.textContent = "Retrying...";
			button.disabled = true; // no reconnect spam
		};

		const container = document.querySelector(".left-panel");
		if (container) {
			container.appendChild(button);
		}
	}

	removeReconnectButton() {
		const button = document.getElementById("reconnectBtn");
		if (button) {
			button.remove();
		}
	}

	toggleDark() {
		console.log("toggleDark called");
		document.documentElement.classList.toggle("dark");
		const isDark = document.documentElement.classList.contains("dark");
		localStorage.setItem("theme", isDark ? "dark" : "light");
		console.log("Theme toggled to:", isDark ? "dark" : "light");

		// this ruined my life thinking i did something wrong before this
		const themeIcon = this.themeToggleBtn.querySelector(
			".material-icons-round",
		);
		if (themeIcon) {
			themeIcon.textContent = isDark ? "light_mode" : "dark_mode";
		}
	}

	initTheme() {
		console.log("initTheme called");
		const savedTheme = localStorage.getItem("theme");
		console.log("Saved theme from localStorage:", savedTheme);

		if (savedTheme === "dark") {
			document.documentElement.classList.add("dark");
			console.log("Applied dark theme on init");

			const themeIcon = this.themeToggleBtn.querySelector(
				".material-icons-round",
			);
			if (themeIcon) {
				themeIcon.textContent = "light_mode";
			}
		} else if (savedTheme === "light") {
			document.documentElement.classList.remove("dark");
			console.log("Applied light theme on init");

			const themeIcon = this.themeToggleBtn.querySelector(
				".material-icons-round",
			);
			if (themeIcon) {
				themeIcon.textContent = "dark_mode";
			}
		} else {
			console.log("No saved theme, using default (light)");
		}
	}
}
