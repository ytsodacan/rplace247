document.addEventListener('DOMContentLoaded', () => {
    const background = document.querySelector('.background');
    const numberOfStars = 150; // Increased significantly for full screen density

    // Stars fall from top-left to bottom-right.
    // To cover the entire screen (including bottom-left), stars must start further left and higher up.
    // These ranges ensure stars start significantly off-screen to allow them to traverse the whole diagonal.
    const spawnStartLeftMin = -150; // Start very far off-screen to the left (e.g., -150vw)
    const spawnStartLeftMax = 100; // Extend across the entire top width, allowing some to start from right edge too

    const startTopMin = -150; // Start very far off-screen at the top (e.g., -150vh)
    const startTopMax = 0;   // Up to the very top edge of the viewport

    // USER SETTINGS
    const minStarSize = 40;
    const maxStarSize = 50;
    const minTrailLength = 70;
    const maxTrailLength = 180;
    const minTrailThickness = 8; // Applied user setting
    const maxTrailThickness = 10; // Applied user setting
    const minAnimDuration = 6;
    const maxAnimDuration = 12;
    const minAnimDelay = 0;
    const maxAnimDelay = 8;
    // END USER SETTINGS

    const starColors = ['#FFFFFF', '#fe76d2', '#fdbbe8', '#ffa1df', '#e999b5'];

    // Function to get a random number within a range
    function getRandom(min, max) {
        return Math.random() * (max - min) + min;
    }

    // Function to get a random integer within a range
    function getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Function to create a single star-trail unit
    function createStar() {
        const starContainer = document.createElement('div');
        starContainer.classList.add('star-container');

        const starIcon = document.createElement('span');
        starIcon.classList.add('material-symbols-outlined', 'star-icon');
        starIcon.textContent = 'star';
        starContainer.appendChild(starIcon);

        // Randomize star properties
        const starSize = getRandom(minStarSize, maxStarSize);
        const trailLength = getRandom(minTrailLength, maxTrailLength);
        const trailThickness = getRandom(minTrailThickness, maxTrailThickness); // Use user setting
        const animDuration = getRandom(minAnimDuration, maxAnimDuration);
        const animDelay = getRandom(minAnimDelay, maxAnimDelay);

        // Randomize color for star and trail
        const colorIndex = getRandomInt(0, starColors.length - 1);
        const starColor = starColors[colorIndex];
        const trailColorStartRGB = `${parseInt(starColor.slice(1, 3), 16)}, ${parseInt(starColor.slice(3, 5), 16)}, ${parseInt(starColor.slice(5, 7), 16)}`;
        // Gradient should go 'to top left' for a trail behind a star moving top-left to bottom-right.
        // This ensures the color is brightest at the star (bottom-right of the pseudo-element) and fades away.
        const trailGradient = `linear-gradient(to left, rgba(${trailColorStartRGB}, 0.8), rgba(${trailColorStartRGB}, 0))`;

        // Calculate a large enough distance for the 45-degree movement to go off-screen
        // Use the hypotenuse of the full screen, then double it to ensure it travels from far off-screen to far off-screen.
        const viewportHypotenuse = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
        const moveDistance = viewportHypotenuse * 2.0; // Increased multiplier for robust off-screen travel

        // Set CSS custom properties
        starContainer.style.setProperty('--star-size', `${starSize}px`);
        starContainer.style.setProperty('--star-size-half', `${starSize / 2}px`);
        starContainer.style.setProperty('--trail-length', `${trailLength}px`);
        starContainer.style.setProperty('--trail-thickness', `${trailThickness}px`);
        starContainer.style.setProperty('--animation-duration', `${animDuration}s`);
        starContainer.style.setProperty('--animation-delay', `${animDelay}s`);
        starContainer.style.setProperty('--move-distance', `${moveDistance}px`);

        starIcon.style.setProperty('--star-color', starColor);
        starContainer.style.setProperty('--trail-gradient', trailGradient); // Applied to ::before via container

        return starContainer;
    }

    // Generate individual stars for a constant stream
    for (let i = 0; i < numberOfStars; i++) {
        const starContainer = createStar();

        // Random start positions for top-left to bottom-right movement
        const startTop = getRandom(startTopMin, startTopMax); // vh units
        const startLeft = getRandom(spawnStartLeftMin, spawnStartLeftMax); // vw units

        starContainer.style.setProperty('--start-top', `${startTop}vh`);
        starContainer.style.setProperty('--start-left', `${startLeft}vw`);

        background.appendChild(starContainer);
    }
});
