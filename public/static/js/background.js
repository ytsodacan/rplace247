/**
 * Background Effects Library
 * Reusable ways to add animated cogs and falling stars
 */

const DEFAULT_BACKGROUND_CONFIG = {
    cogs: {
        count: 12,
        sizes: { min: 80, max: 250 },
        edgePreference: 0.75,
        edgeMargin: 20,
        animationDelay: { min: 0, max: 20 },
        opacity: { min: 0.3, max: 0.7 }
    },
    stars: {
        count: 25,
        spawnQuadrant: { x: 25, y: 25 },
        animationDuration: { min: 6, max: 10 },
        size: { width: 4, height: 4 }
    }
};

/**
 * random cogs
 * @param {HTMLElement} container - what are you attaching to
 * @param {Object} config -- controls what controls this cog
 */
function generateRandomCogs(container, config = {}) {
    const cogConfig = { ...DEFAULT_BACKGROUND_CONFIG.cogs, ...config };

    const existingCogs = container.querySelectorAll('.cog-container');
    existingCogs.forEach(cog => cog.remove());

    for (let i = 0; i < cogConfig.count; i++) {
        const cog = document.createElement('div');
        cog.className = 'cog-container';

        const size = Math.random() * (cogConfig.sizes.max - cogConfig.sizes.min) + cogConfig.sizes.min;

        let top, left;

        if (Math.random() < cogConfig.edgePreference) {
            const edge = Math.random();
            if (edge < 0.25) {
                top = Math.random() * cogConfig.edgeMargin;
                left = Math.random() * 100;
            } else if (edge < 0.5) {
                top = Math.random() * 100;
                left = (100 - cogConfig.edgeMargin) + Math.random() * cogConfig.edgeMargin;
            } else if (edge < 0.75) {
                top = (100 - cogConfig.edgeMargin) + Math.random() * cogConfig.edgeMargin;
                left = Math.random() * 100;
            } else {
                top = Math.random() * 100;
                left = Math.random() * cogConfig.edgeMargin;
            }
        } else {
            top = Math.random() * 100;
            left = Math.random() * 100;
        }

        const delay = Math.random() * (cogConfig.animationDelay.max - cogConfig.animationDelay.min) + cogConfig.animationDelay.min;

        cog.style.cssText = `
            top: ${top}%;
            left: ${left}%;
            animation-delay: ${delay}s;
        `;

        const cogIcon = document.createElement('span');
        cogIcon.className = 'cog-object material-symbols-outlined';
        const opacity = cogConfig.opacity.min + Math.random() * (cogConfig.opacity.max - cogConfig.opacity.min);
        cogIcon.style.cssText = `
            font-size: ${size}px;
            color: rgba(255, 255, 255, ${opacity});
        `;
        cogIcon.textContent = 'settings';

        cog.appendChild(cogIcon);
        container.appendChild(cog);
    }
}

/**
 * random falling stars
 * @param {HTMLElement} container - which container to attach to
 * @param {Object} config - controls the falling stars
 */
function generateFallingStars(container, config = {}) {
    const starConfig = { ...DEFAULT_BACKGROUND_CONFIG.stars, ...config };

    const existingStars = container.querySelectorAll('.star');
    existingStars.forEach(star => star.remove());

    for (let i = 0; i < starConfig.count; i++) {
        const star = document.createElement('div');
        star.className = 'star';

        const startX = Math.random() * starConfig.spawnQuadrant.x;
        const startY = Math.random() * starConfig.spawnQuadrant.y;

        const duration = Math.random() * (starConfig.animationDuration.max - starConfig.animationDuration.min) + starConfig.animationDuration.min;

        const delay = Math.random() * duration;

        star.style.cssText = `
            left: ${startX}%;
            top: ${startY}%;
            width: ${starConfig.size.width}px;
            height: ${starConfig.size.height}px;
            animation-duration: ${duration}s;
            animation-delay: ${delay}s;
        `;

        container.appendChild(star);
    }
}

/**
 * Initialize background effects for timer pages
 * @param {Object} options - Configuration options
 * @param {string} options.containerId - ID of the background container
 * @param {Object} options.cogConfig - Cog configuration
 * @param {Object} options.starConfig - Star configuration
 */
function initializeTimerBackground(options = {}) {
    const {
        containerId = 'background',
        cogConfig = {},
        starConfig = {}
    } = options;

    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Background container with ID '${containerId}' not found`);
        return;
    }

    generateRandomCogs(container, cogConfig);
    generateFallingStars(container, starConfig);
}

/**
 * Update background effects with new configuration
 * @param {string} containerId - ID of the background container
 * @param {Object} cogConfig - New cog configuration
 * @param {Object} starConfig - New star configuration
 */
function updateBackgroundEffects(containerId, cogConfig = {}, starConfig = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Background container with ID '${containerId}' not found`);
        return;
    }

    generateRandomCogs(container, cogConfig);
    generateFallingStars(container, starConfig);
}

if (typeof window !== 'undefined') {
    window.BackgroundEffects = {
        generateRandomCogs,
        generateFallingStars,
        initializeTimerBackground,
        updateBackgroundEffects,
        DEFAULT_CONFIG: DEFAULT_BACKGROUND_CONFIG
    };
}
