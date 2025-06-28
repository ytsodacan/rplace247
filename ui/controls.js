const CLICK_THRESHOLD = 5;

export class UIControls {
    constructor(canvas, network) {
        this.canvas = canvas;
        this.network = network;

        // DOM references
        this.colorPicker = document.getElementById('colorPicker');
        this.placePixelBtn = document.getElementById('placePixelBtn');
        this.selectedCoordsDisplay = document.getElementById('selectedCoords');
        this.zoomInBtn = document.getElementById('zoomInBtn');
        this.zoomOutBtn = document.getElementById('zoomOutBtn');
        this.pixelChatLog = document.getElementById('pixelChatLog');

        // UI state
        this.currentColor = this.colorPicker.value;
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.lastClickX = 0;
        this.lastClickY = 0;

        // touch state  
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
        // canvas events
        this.canvas.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.canvas.addEventListener('wheel', (e) => this.handleMouseWheel(e));

        // touch events
        this.canvas.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.canvas.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));

        // control events
        this.colorPicker.addEventListener('change', () => this.handleColorChange());
        this.placePixelBtn.addEventListener('click', () => this.handlePlacePixelClick());
        this.zoomInBtn.addEventListener('click', () => this.handleZoomIn());
        this.zoomOutBtn.addEventListener('click', () => this.handleZoomOut());

        // window events
        window.addEventListener('resize', () => this.handleResize());
    }

    setupNetworkCallbacks() {
        this.network.onConnected = () => {
            this.addSystemLogEntry('Connected to backend', '#00ff00');
            this.removeReconnectButton();
        };

        this.network.onDisconnected = () => {
            this.addSystemLogEntry('Disconnected from backend', '#ff0000');
            this.createReconnectButton();
        };

        this.network.onConnectionError = (error) => {
            this.addSystemLogEntry(`Connection Error: ${error.message || 'Unknown error'}`, '#ff6666');
            this.createReconnectButton();
        };

        this.network.onPixelPlacementError = (x, y, color, errorMessage) => {
            this.addPixelErrorLogEntry(x, y, color, errorMessage);
        };

        this.network.onReconnecting = () => {
            this.addSystemLogEntry('Reconnecting...', '#ffff00');
        };
    }

    // mouse handlers
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

            if (deltaX <= CLICK_THRESHOLD && deltaY <= CLICK_THRESHOLD) {
                this.handleUserInteractionClick(event);
            }
        }
    }

    handleUserInteractionClick(event) {
        const coords = this.canvas.getGridCoordsFromScreen(event.clientX, event.clientY);
        if (coords) {
            this.canvas.setSelectedPixel(coords.x, coords.y);
            this.updateSelectedCoordsDisplay();
        }
    }

    // touch handlers
    handleTouchStart(event) {
        event.preventDefault();

        if (event.touches.length === 1) {
            // single finger: potential tap/drag  
            const touch = event.touches[0];
            this.lastTouchX = touch.clientX;
            this.lastTouchY = touch.clientY;
            this.touchStartX = touch.clientX;
            this.touchStartY = touch.clientY;
        } else if (event.touches.length === 2) {
            // two fingers: pinch to zoom
            this.initialPinchDistance = this.getPinchDistance(event);
        }
    }

    handleTouchMove(event) {
        event.preventDefault();

        if (event.touches.length === 1 && this.initialPinchDistance === null) {
            // single finger: pan
            const touch = event.touches[0];
            const deltaX = touch.clientX - this.lastTouchX;
            const deltaY = touch.clientY - this.lastTouchY;
            this.canvas.offsetX += deltaX;
            this.canvas.offsetY += deltaY;
            this.lastTouchX = touch.clientX;
            this.lastTouchY = touch.clientY;
            this.canvas.markDirty(true, true, false);
        } else if (event.touches.length === 2) {
            // two fingers: pinch to zoom
            const currentDistance = this.getPinchDistance(event);
            if (this.initialPinchDistance !== null) {
                const scaleChange = currentDistance / this.initialPinchDistance;
                const newScale = this.canvas.scale * scaleChange;
                if (newScale >= 0.1 && newScale <= 10) {
                    // zoom toward the center of the two touches
                    const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                    const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
                    
                    const rect = this.canvas.canvas.getBoundingClientRect();
                    const canvasCenterX = centerX - rect.left;
                    const canvasCenterY = centerY - rect.top;
                    
                    // adjust offset to zoom toward touch center
                    this.canvas.offsetX = canvasCenterX - (canvasCenterX - this.canvas.offsetX) * scaleChange;
                    this.canvas.offsetY = canvasCenterY - (canvasCenterY - this.canvas.offsetY) * scaleChange;
                    
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
            // all fingers lifted
            if (this.initialPinchDistance === null) {
                // was single finger: check if it's a tap
                const deltaX = Math.abs(event.changedTouches[0].clientX - this.touchStartX);
                const deltaY = Math.abs(event.changedTouches[0].clientY - this.touchStartY);

                if (deltaX <= CLICK_THRESHOLD && deltaY <= CLICK_THRESHOLD) {
                    this.handleUserInteractionTap(event.changedTouches[0]);
                }
            }
            this.initialPinchDistance = null;
        } else if (event.touches.length === 1) {
            // one finger remains: reset single-finger tracking
            this.initialPinchDistance = null;
            const touch = event.touches[0];
            this.lastTouchX = touch.clientX;
            this.lastTouchY = touch.clientY;
        }
    }

    handleUserInteractionTap(touch) {
        const coords = this.canvas.getGridCoordsFromScreen(touch.clientX, touch.clientY);
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

    // mouse wheel handler
    handleMouseWheel(event) {
        event.preventDefault();

        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        const newScale = this.canvas.scale * zoomFactor;

        if (newScale >= 0.1 && newScale <= 10) {
            const rect = this.canvas.canvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;

            // zoom toward mouse position
            this.canvas.offsetX = mouseX - (mouseX - this.canvas.offsetX) * zoomFactor;
            this.canvas.offsetY = mouseY - (mouseY - this.canvas.offsetY) * zoomFactor;
            this.canvas.scale = newScale;
            this.canvas.markDirty(true, true, false);
        }
    }

    // control handlers
    handleColorChange() {
        this.currentColor = this.colorPicker.value;
    }

    handlePlacePixelClick() {
        if (this.canvas.selectedPixel.x !== null && this.canvas.selectedPixel.y !== null) {
            this.network.placePixel(this.canvas.selectedPixel.x, this.canvas.selectedPixel.y, this.currentColor);
            this.addPixelLogEntry(this.canvas.selectedPixel.x, this.canvas.selectedPixel.y, this.currentColor);
        } else {
            alert('Please select a pixel first by clicking on the grid.');
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
    }

    // logging functions
    addPixelLogEntry(x, y, color) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<span style="color: ${color};">■</span> Placed pixel at (${x}, ${y})`;
        
        this.pixelChatLog.appendChild(logEntry);
        this.pixelChatLog.scrollTop = this.pixelChatLog.scrollHeight;
    }

    addSystemLogEntry(message, color = '#ffff00') {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry log-system';
        logEntry.innerHTML = `<span style="color: ${color};">●</span> ${message}`;
        
        this.pixelChatLog.appendChild(logEntry);
        this.pixelChatLog.scrollTop = this.pixelChatLog.scrollHeight;
    }

    addPixelErrorLogEntry(x, y, color, errorMessage) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry log-error';
        logEntry.innerHTML = `<span style="color: #ff6666;">✗</span> ${errorMessage}, failed to place ${color} at (${x}, ${y})`;
        
        this.pixelChatLog.appendChild(logEntry);
        this.pixelChatLog.scrollTop = this.pixelChatLog.scrollHeight;
    }

    // coords display
    updateSelectedCoordsDisplay() {
        if (this.canvas.selectedPixel.x !== null && this.canvas.selectedPixel.y !== null) {
            this.selectedCoordsDisplay.textContent = `Selected: (${this.canvas.selectedPixel.x}, ${this.canvas.selectedPixel.y})`;
        } else {
            this.selectedCoordsDisplay.textContent = 'No pixel selected';
        }
    }

    // reconnect button management
    createReconnectButton() {
        if (document.getElementById('reconnectBtn')) return; // already exists

        const reconnectBtn = document.createElement('button');
        reconnectBtn.id = 'reconnectBtn';
        reconnectBtn.className = 'reconnect-button';
        reconnectBtn.textContent = 'Reconnect';
        reconnectBtn.addEventListener('click', () => {
            this.network.reconnect();
        });

        const leftPanel = document.getElementById('left-panel');
        if (leftPanel) {
            leftPanel.appendChild(reconnectBtn);
        }
    }

    removeReconnectButton() {
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.remove();
        }
    }

    // theme toggle
    toggleDark() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        console.log('Theme toggled to:', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme');
        console.log('Saved theme from localStorage:', savedTheme);
        
        if (savedTheme === 'dark') {
            document.documentElement.classList.add('dark');
            console.log('Applied dark theme on init');
        } else if (savedTheme === 'light') {
            document.documentElement.classList.remove('dark');
            console.log('Applied light theme on init');
        } else {
            console.log('No saved theme, using default (light)');
        }
    }
} 
