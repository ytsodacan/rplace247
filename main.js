import { Canvas } from './core/canvas.js';
import { Network } from './core/network.js';
import { UIControls } from './ui/controls.js';

// debug flag
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
        console.log('Initializing neuro.place app...');

        try {
            // create core modules
            this.canvas = new Canvas();
            this.network = new Network();
            
            // create UI controls (needs canvas and network references)
            this.ui = new UIControls(this.canvas, this.network);

            // initialize theme
            this.ui.initTheme();
            
            // set up theme toggle button
            this.setupThemeToggle();

            // fetch initial grid data
            console.log('Fetching initial grid...');
            const gridData = await this.network.getGrid();
            this.canvas.updateGridData(gridData);
            
            // initialize canvas view (fit grid to screen)
            this.canvas.initializeView();

            // start WebSocket connection
            console.log('Setting up WebSocket...');
            this.network.setupWebSocket();

            // start main game loop
            this.startGameLoop();

            console.log('App initialization complete!');

        } catch (error) {
            console.error('Failed to initialize app:', error);
            alert('Failed to initialize the application. Please refresh the page.');
        }
    },

    setupThemeToggle() {
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', () => {
                this.ui.toggleDark();
            });
        }
    },

    // main game loop - processes network updates and renders
    startGameLoop() {
        const gameLoop = () => {
            // process any queued pixel updates from WebSocket
            const pixelUpdates = this.network.flushPixelUpdates();
            if (pixelUpdates.length > 0) {
                pixelUpdates.forEach(update => {
                    this.canvas.updatePixel(update.x, update.y, update.color);
                });
            }

            // canvas handles its own rendering loop via RAF
            // so we just need to process network updates regularly
            setTimeout(gameLoop, 16); // ~60fps for network updates
        };

        gameLoop();
    }
};

// auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
} 
