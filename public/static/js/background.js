/**
 * Background Effects Library
 * Reusable ways to add animated cogs and falling stars
 */

const DEFAULT_BACKGROUND_CONFIG = {
	cogs: {
		count: 12,
		sizes: { min: 80, max: 500 },
		edgePreference: 0.75,
		edgeMargin: 20,
		animationDelay: { min: 2, max: 10 },
		opacity: { min: 0.3, max: 0.7 },
	},
	stars: {
		count: 25,
		spawnQuadrant: { x: 25, y: 25 },
		animationDuration: { min: 2, max: 10 },
		size: { width: 25, height: 25 },
	},
};

/**
 * random cogs
 * @param {HTMLElement} container - what are you attaching to
 * @param {Object} config -- controls what controls this cog
 */
function generateRandomCogs(container, config = {}) {
	const cogConfig = { ...DEFAULT_BACKGROUND_CONFIG.cogs, ...config };

	const existingCogs = container.querySelectorAll(
		'.cog-container, [class*="cog"]',
	);
	existingCogs.forEach((cog) => cog.remove());

	for (let i = 0; i < cogConfig.count; i++) {
		const cog = document.createElement("div");
		cog.className = "cog-container";

		const size =
			Math.random() * (cogConfig.sizes.max - cogConfig.sizes.min) +
			cogConfig.sizes.min;

		let top, left;

		if (Math.random() < cogConfig.edgePreference) {
			const edge = Math.random();
			if (edge < 0.25) {
				top = Math.random() * cogConfig.edgeMargin;
				left = Math.random() * 100;
			} else if (edge < 0.5) {
				top = Math.random() * 100;
				left =
					100 - cogConfig.edgeMargin + Math.random() * cogConfig.edgeMargin;
			} else if (edge < 0.75) {
				top = 100 - cogConfig.edgeMargin + Math.random() * cogConfig.edgeMargin;
				left = Math.random() * 100;
			} else {
				top = Math.random() * 100;
				left = Math.random() * cogConfig.edgeMargin;
			}
		} else {
			top = Math.random() * 100;
			left = Math.random() * 100;
		}

		const delay =
			Math.random() *
				(cogConfig.animationDelay.max - cogConfig.animationDelay.min) +
			cogConfig.animationDelay.min;

		cog.style.cssText = `
            top: ${top}%;
            left: ${left}%;
            animation-delay: ${delay}s;
        `;

		const cogIcon = document.createElement("span");
		cogIcon.className = "cog-object material-symbols-outlined";
		const opacity =
			cogConfig.opacity.min +
			Math.random() * (cogConfig.opacity.max - cogConfig.opacity.min);
		cogIcon.style.cssText = `
            font-size: ${size}px;
            color: rgba(198, 99, 241, ${opacity});
        `;
		cogIcon.textContent = "settings";

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

	const existingStars = container.querySelectorAll(".star, .star-container");
	existingStars.forEach((star) => star.remove());

	for (let i = 0; i < starConfig.count; i++) {
		const star = document.createElement("div");
		star.className = "star";

		// Position stars using "second grid" concept - spawn in 3 quadrants around visible top-left
		let startX, startY;
		const quadrant = Math.floor(Math.random() * 3); // 0, 1, or 2 for the 3 off-screen quadrants

		if (quadrant === 0) {
			// Top-left quadrant (off-screen)
			startX = -25 + Math.random() * 25; // -25% to 0%
			startY = -25 + Math.random() * 25; // -25% to 0%
		} else if (quadrant === 1) {
			// Top-right quadrant (off-screen)
			startX = 0 + Math.random() * 25; // 0% to 25%
			startY = -25 + Math.random() * 25; // -25% to 0%
		} else {
			// Bottom-left quadrant (off-screen)
			startX = -25 + Math.random() * 25; // -25% to 0%
			startY = 0 + Math.random() * 25; // 0% to 25%
		}

		const duration =
			Math.random() *
				(starConfig.animationDuration.max - starConfig.animationDuration.min) +
			starConfig.animationDuration.min;
		const delay = Math.random() * duration;

		// Add trail properties similar to animation.js
		const trailLength = 70 + Math.random() * 110; // 70-180px range
		const trailThickness = 2 + Math.random() * 2; // 2-4px range
		const trailColorStartRGB = "255, 255, 255";
		const trailGradient = `linear-gradient(to top left, rgba(${trailColorStartRGB}, 0.8), rgba(${trailColorStartRGB}, 0))`;

		star.style.cssText = `
            left: ${startX}%;
            top: ${startY}%;
            width: ${starConfig.size.width}px;
            height: ${starConfig.size.height}px;
            animation-duration: ${duration}s;
            animation-delay: ${delay}s;
            --trail-length: ${trailLength}px;
            --trail-thickness: ${trailThickness}px;
            --trail-gradient: ${trailGradient};
        `;

		container.appendChild(star);
	}
}

/**
 * how to initialize the background effects
 * @param {Object} options - Configuration options
 * @param {string} options.containerId - ID of the background container
 * @param {Object} options.cogConfig - Cog configuration
 * @param {Object} options.starConfig - Star configuration
 */
function initializeTimerBackground(options = {}) {
	const {
		containerId = "background",
		cogConfig = {},
		starConfig = {},
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

if (typeof window !== "undefined") {
	window.BackgroundEffects = {
		generateRandomCogs,
		generateFallingStars,
		initializeTimerBackground,
		updateBackgroundEffects,
		DEFAULT_CONFIG: DEFAULT_BACKGROUND_CONFIG,
	};
}
