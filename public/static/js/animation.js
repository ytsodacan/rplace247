// ===== UTILITY FUNCTIONS =====
function getRandom(min, max) {
	return Math.random() * (max - min) + min;
}

function getRandomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateMoveDistance() {
	const viewportHypotenuse = Math.sqrt(
		window.innerWidth ** 2 + window.innerHeight ** 2,
	);
	return viewportHypotenuse * 2.0;
}

// ===== CSS-BASED STAR FIX =====
// Fix for CSS-based .star elements to use absolute move distance
function initializeCSSStars() {
	const moveDistance = calculateMoveDistance();

	// Find all CSS-based stars and set their move distance
	const cssStars = document.querySelectorAll(".star");
	cssStars.forEach((star) => {
		star.style.setProperty("--move-distance", `${moveDistance}px`);
	});
}

function updateCSSStarsOnResize() {
	let resizeTimeout;
	window.addEventListener("resize", () => {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => {
			const newMoveDistance = calculateMoveDistance();

			const cssStars = document.querySelectorAll(".star");
			cssStars.forEach((star) => {
				star.style.setProperty("--move-distance", `${newMoveDistance}px`);
			});
		}, 100);
	});
}

// ===== JAVASCRIPT-GENERATED STARS =====
document.addEventListener("DOMContentLoaded", () => {
	// Initialize CSS-based star fixes
	initializeCSSStars();
	updateCSSStarsOnResize();

	// Initialize JavaScript-generated stars
	const background = document.querySelector(".background");
	if (!background) return; // Exit if no background element found

	const numberOfStars = 150;

	const spawnStartLeftMin = -150;
	const spawnStartLeftMax = 100;

	const startTopMin = -150;
	const startTopMax = 0;

	const minStarSize = 40;
	const maxStarSize = 50;
	const minTrailLength = 70;
	const maxTrailLength = 180;
	const minTrailThickness = 8;
	const maxTrailThickness = 10;
	const minAnimDuration = 6;
	const maxAnimDuration = 12;
	const minAnimDelay = 0;
	const maxAnimDelay = 8;

	const starColors = ["#FFFFFF", "#fe76d2", "#fdbbe8", "#ffa1df", "#e999b5"];

	function createStar() {
		const starContainer = document.createElement("div");
		starContainer.classList.add("star-container");

		const starIcon = document.createElement("span");
		starIcon.classList.add("material-symbols-outlined", "star-icon");
		starIcon.textContent = "star";
		starContainer.appendChild(starIcon);

		const starSize = getRandom(minStarSize, maxStarSize);
		const trailLength = getRandom(minTrailLength, maxTrailLength);
		const trailThickness = getRandom(minTrailThickness, maxTrailThickness);
		const animDuration = getRandom(minAnimDuration, maxAnimDuration);
		const animDelay = getRandom(minAnimDelay, maxAnimDelay);

		const colorIndex = getRandomInt(0, starColors.length - 1);
		const starColor = starColors[colorIndex];
		const trailColorStartRGB = `${parseInt(starColor.slice(1, 3), 16)}, ${parseInt(starColor.slice(3, 5), 16)}, ${parseInt(starColor.slice(5, 7), 16)}`;
		const trailGradient = `linear-gradient(to left, rgba(${trailColorStartRGB}, 0.8), rgba(${trailColorStartRGB}, 0))`;

		const moveDistance = calculateMoveDistance();

		starContainer.style.setProperty("--star-size", `${starSize}px`);
		starContainer.style.setProperty("--star-size-half", `${starSize / 2}px`);
		starContainer.style.setProperty("--trail-length", `${trailLength}px`);
		starContainer.style.setProperty("--trail-thickness", `${trailThickness}px`);
		starContainer.style.setProperty("--animation-duration", `${animDuration}s`);
		starContainer.style.setProperty("--animation-delay", `${animDelay}s`);
		starContainer.style.setProperty("--move-distance", `${moveDistance}px`);

		starIcon.style.setProperty("--star-color", starColor);
		starContainer.style.setProperty("--trail-gradient", trailGradient);

		return starContainer;
	}

	for (let i = 0; i < numberOfStars; i++) {
		const starContainer = createStar();

		const startTop = getRandom(startTopMin, startTopMax);
		const startLeft = getRandom(spawnStartLeftMin, spawnStartLeftMax);

		starContainer.style.setProperty("--start-top", `${startTop}vh`);
		starContainer.style.setProperty("--start-left", `${startLeft}vw`);

		background.appendChild(starContainer);
	}
});
