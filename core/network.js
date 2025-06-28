const BACKEND_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';
const WEBSOCKET_URL = 'https://joan-coming-protein-uniform.trycloudflare.com';
const GRID_WIDTH = 500;
const GRID_HEIGHT = 500;

export class Network {
    constructor() {
        this.socket = null;
        this.pixelUpdateQueue = [];
        
        // callbacks that can be set by other modules
        this.onConnected = null;
        this.onDisconnected = null;
        this.onConnectionError = null;
        this.onPixelUpdate = null;
        this.onPixelPlacementError = null;
        this.onReconnecting = null;
    }

    // gets grid data from backend
    async getGrid() {
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
            // fallback: just fill it with dark gray
            return Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill('#1a1a1a'));
        }
    }

    // place pixel via REST API
    async placePixel(x, y, color) {
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
            // notify UI layer about the error
            if (this.onPixelPlacementError) {
                this.onPixelPlacementError(x, y, color, 'Connection failure');
            }
        }
    }

    // setup WebSocket connection
    setupWebSocket() {
        this.socket = io(WEBSOCKET_URL, { reconnection: false });

        this.socket.on('connect', () => {
            console.log('Connected to backend');
            if (this.onConnected) {
                this.onConnected();
            }
        });

        this.socket.on('pixelUpdate', (data) => {
            // queue updates instead of applying them immediately; they'll be flushed once per frame
            this.pixelUpdateQueue.push(data);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from backend. Pausing refresh.');
            alert('Backend unavailable. Press the reconnect button to retry.');
            if (this.onDisconnected) {
                this.onDisconnected();
            }
        });

        this.socket.on('connect_error', (error) => {
            console.error('Backend connection error:', error);
            alert('Backend unavailable. Press the reconnect button to retry.');
            if (this.onConnectionError) {
                this.onConnectionError(error);
            }
        });
    }

    // reconnect to WebSocket
    reconnect() {
        if (!this.socket) return;
        if (this.onReconnecting) {
            this.onReconnecting();
        }
        this.socket.connect();
    }

    // get queued pixel updates and clear the queue
    flushPixelUpdates() {
        if (this.pixelUpdateQueue.length === 0) return [];
        
        const updates = [...this.pixelUpdateQueue];
        this.pixelUpdateQueue.length = 0;
        return updates;
    }

    // check if connected
    isConnected() {
        return this.socket && this.socket.connected;
    }

    // disconnect
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
} 
