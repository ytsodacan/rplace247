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

	const BACKEND_URL = window.location.origin;
	const WEBSOCKET_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
	const OAUTH_CLIENT_ID = "1388712213002457118";

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

	console.log("Theme toggle button found:", themeToggleBtn);

	let currentColor = colorPicker.value;
	let grid = [];
	const selectedPixel = { x: null, y: null };

	let CONNECTION_TIMEOUT_MS = 15000;
	let socket = null;
	let reconnectAttempts = 0;
	const MAX_RECONNECT_ATTEMPTS = 5;
	const RECONNECT_DELAY = 1000;
	const sessionId = generateSessionId();
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
	let lastPixelTime = Number.parseInt(
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
		const bigint = Number.parseInt(hex.slice(1), 16);
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

	async function getGrid() {
		return new Promise(async (resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error("Connection timeout - server may be unavailable"));
			}, CONNECTION_TIMEOUT_MS);

			try {
				const response = await fetch(`${BACKEND_URL}/grid`);

				clearTimeout(timeoutId);

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data = await response.json();
				console.log("Initial grid fetched successfully.");
				resolve(data);
			} catch (error) {
				clearTimeout(timeoutId);

				console.error("Error fetching grid:", error);
				reject(error);
			}
		});
	}

	async function placePixel(x, y, color) {
		try {
			const headers = { "Content-Type": "application/json" };
			if (userToken) {
				headers.Authorization = `Bearer ${userToken}`;
			}

			const response = await fetch(`${BACKEND_URL}/pixel`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					x,
					y,
					color,
					sessionId,
					user: userData,
				}),
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

		const intOffsetX = Math.round(offsetX);
		const intOffsetY = Math.round(offsetY);

		ctx.translate(intOffsetX, intOffsetY);
		ctx.scale(scale, scale);

		ctx.drawImage(offscreenCanvas, 0, 0);

		ctx.restore();

		drawHighlight();
	}

	function drawHighlight() {
		highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

		if (selectedPixel.x !== null && selectedPixel.y !== null) {
			highlightCtx.save();

			const intOffsetX = Math.round(offsetX);
			const intOffsetY = Math.round(offsetY);

			highlightCtx.translate(intOffsetX, intOffsetY);
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
		const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${OAUTH_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&scope=${scopes}`;
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

	function addPixelLogEntry(x, y, color) {
		if (!pixelChatLog) {
			console.error("Pixel chat log element not found.");
			return;
		}

		const logEntry = document.createElement("div");
		logEntry.className = "log-entry";
		let finalContentHTML = "";

		if (typeof y === "number" && typeof x === "number") {
			finalContentHTML = `<span style="color: #00ff00">${x}</span><span style="color: #00ff00">,</span> <span style="color: #00ff00">${y}</span> updated`;
		} else if (
			y === "Connected" ||
			y === "Disconnected" ||
			y === "Reconnecting..." ||
			y.startsWith("Connection Error")
		) {
			finalContentHTML = `<span style="color: #00ff00">${x}</span><span style="color: #00ff00">,</span> <span style="color: #00ff00">${y}</span> updated`;
		} else {
			finalContentHTML = `<span style="color: #00ff00">${x}</span><span style="color: #00ff00">,</span> <span style="color: #00ff00">${y}</span> updated`;
		}

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

			typingTargetElement.innerHTML = `${text}<span class='blinker'>&#32;</span>`;

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

		const canvasX = clientX - rect.left;
		const canvasY = clientY - rect.top;

		const intOffsetX = Math.round(offsetX);
		const intOffsetY = Math.round(offsetY);

		const worldX = (canvasX - intOffsetX) / scale;
		const worldY = (canvasY - intOffsetY) / scale;

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

			offsetX = Math.round(offsetX);
			offsetY = Math.round(offsetY);

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

			offsetX = Math.round(offsetX);
			offsetY = Math.round(offsetY);

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

		offsetX = Math.round(offsetX);
		offsetY = Math.round(offsetY);

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
				handlePlacePixelClick();
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
			addPixelLogEntry("System", "Reconnecting...", "#ffff00");
			btn.disabled = true;
			connectWebSocket();
		});

		if (placePixelBtn?.parentElement) {
			placePixelBtn.parentElement.appendChild(btn);
		} else {
			document.body.appendChild(btn);
		}
		return btn;
	}

	function connectWebSocket() {
		if (socket && socket.readyState === WebSocket.OPEN) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			isConnecting = true;

			connectionTimeoutId = setTimeout(() => {
				if (isConnecting) {
					isConnecting = false;
					console.error("WebSocket connection timeout");
					addPixelLogEntry("System", "Connection Timeout", "#ff9900");
					reject(new Error("WebSocket connection timeout"));
				}
			}, CONNECTION_TIMEOUT_MS);

			try {
				socket = new WebSocket(WEBSOCKET_URL);

				socket.onopen = () => {
					if (connectionTimeoutId) {
						clearTimeout(connectionTimeoutId);
						connectionTimeoutId = null;
					}
					isConnecting = false;

					console.log("Connected to backend WebSocket");
					addPixelLogEntry("System", "Connected", "#00ff00");
					reconnectButton.style.display = "none";
					reconnectButton.disabled = false;
					reconnectAttempts = 0;
					resolve();
				};

				socket.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);

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
						}
					} catch (error) {
						console.error("Error parsing WebSocket message:", error);
					}
				};

				socket.onclose = (event) => {
					if (connectionTimeoutId) {
						clearTimeout(connectionTimeoutId);
						connectionTimeoutId = null;
					}
					isConnecting = false;

					console.log("WebSocket connection closed:", event.code, event.reason);
					addPixelLogEntry("System", "Disconnected", "#ff0000");

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
						reconnectButton.style.display = "inline-block";
						if (reconnectAttempts > 0) {
							alert("Connection lost. Please click reconnect to retry.");
						}
					}
				};

				socket.onerror = (error) => {
					if (connectionTimeoutId) {
						clearTimeout(connectionTimeoutId);
						connectionTimeoutId = null;
					}
					isConnecting = false;

					console.error("WebSocket error:", error);
					addPixelLogEntry("System", "Connection Error", "#ff9900");
					reject(error);
				};
			} catch (error) {
				if (connectionTimeoutId) {
					clearTimeout(connectionTimeoutId);
					connectionTimeoutId = null;
				}
				isConnecting = false;

				console.error("Failed to create WebSocket connection:", error);
				addPixelLogEntry(
					"System",
					`Connection Error: ${error.message}`,
					"#ff9900",
				);
				reconnectButton.style.display = "inline-block";
				reject(error);
			}
		});
	}

	async function connectAndLoadGrid() {
		try {
			console.log("Attempting to load grid data...");
			grid = await getGrid();
			console.log("Grid data loaded successfully");

			console.log("Attempting to establish WebSocket connection...");
			await connectWebSocket();
			console.log("WebSocket connection established successfully");

			return true;
		} catch (error) {
			console.error("Connection failed:", error);

			function showToast(message) {
				let toast = document.getElementById("connection-toast");
				if (!toast) {
					toast = document.createElement("dialog");
					toast.id = "connection-toast";
					toast.style.position = "fixed";
					toast.style.bottom = "2rem";
					toast.style.left = "50%";
					toast.style.transform = "translateX(-50%)";
					toast.style.background = "#222";
					toast.style.color = "#fff";
					toast.style.border = "none";
					toast.style.borderRadius = "8px";
					toast.style.padding = "1rem 2rem";
					toast.style.boxShadow = "0 2px 12px rgba(0,0,0,0.2)";
					toast.style.zIndex = "9999";
					toast.style.fontSize = "1rem";
					toast.setAttribute("open", "");
					document.body.appendChild(toast);
				}
				toast.textContent = message;
				if (!toast.open) toast.show();
				clearTimeout(toast._timeoutId);
				toast._timeoutId = setTimeout(() => {
					toast.close();
				}, 4000);
			}

			if (error.message.includes("timeout")) {
				showToast("Connection issue: Failed to connect to server – please check your network connection and ensure the server is running.");
			} else if (error.message.includes("HTTP error")) {
				showToast("Connection issue: Server responded with an error. Please try refreshing the page.");
			} else {
				showToast("Connection issue: Failed to connect to server. Please check that the backend is running and try again.");
			}

			if (!grid || grid.length === 0) {
				console.log("Using fallback grid due to connection failure");
				grid = Array(GRID_HEIGHT)
					.fill(0)
					.map(() => Array(GRID_WIDTH).fill("#1a1a1a"));
			}

			if (window.reconnectButton) {
				window.reconnectButton.style.display = "inline-block";
			}

			return false;
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

		const connectionSuccess = await connectAndLoadGrid();

		drawFullOffscreenGrid(grid);

		const gridPixelWidth = GRID_WIDTH * PIXEL_SIZE;
		const gridPixelHeight = GRID_HEIGHT * PIXEL_SIZE;

		const fitScaleX = canvas.width / gridPixelWidth;
		const fitScaleY = canvas.height / gridPixelHeight;
		scale = Math.min(fitScaleX, fitScaleY) * 0.9;
		scale = Math.max(scale, 0.1);

		offsetX = (canvas.width - gridPixelWidth * scale) / 2;
		offsetY = (canvas.height - gridPixelHeight * scale) / 2;

		offsetX = Math.round(offsetX);
		offsetY = Math.round(offsetY);

		ctx.imageSmoothingEnabled = false;

		drawGrid();
		drawLiveViewGrid();

		if (connectionSuccess) {
			console.log("Application initialized with server connection");
		} else {
			console.log("Application initialized in offline mode with fallback grid");
		}

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

		window.reconnectButton = createReconnectButton();

		updateSelectedCoordsDisplay();

		document.addEventListener("keydown", handleKeyDown);

		await handleOAuthCallback();
		updateUserInterface();
		initTheme();

		console.log("Frontend initialized!");
	}

	init();
});
