// clean_backup.js
import fs from 'fs';

// --- Configuration ---
const PALETTE_FILE = './palette.json';
const BACKUP_FILE_IN = './grid_data_backup.json';
const BACKUP_FILE_OUT = './grid_data_cleaned.json';

// --- Helper Functions ---

/**
 * Converts a hex color string to an RGB object.
 * @param {string} hex - e.g., "#RRGGBB"
 * @returns {{r: number, g: number, b: number} | null}
 */
function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : null;
}

/**
 * Calculates the squared Euclidean distance between two RGB colors.
 * @param {{r: number, g: number, b: number}} rgb1
 * @param {{r: number, g: number, b: number}} rgb2
 * @returns {number}
 */
function colorDistanceSquared(rgb1, rgb2) {
	const dR = rgb1.r - rgb2.r;
	const dG = rgb1.g - rgb2.g;
	const dB = rgb1.b - rgb2.b;
	return dR * dR + dG * dG + dB * dB;
}

// --- Main Logic ---

async function cleanData() {
	console.log('--- Starting Grid Data Cleanup ---');

	// 1. Load the official palette and backup data
	let palette, backupData;
	try {
		const paletteJson = fs.readFileSync(PALETTE_FILE, 'utf8');
		palette = JSON.parse(paletteJson);

		const backupJson = fs.readFileSync(BACKUP_FILE_IN, 'utf8');
		backupData = JSON.parse(backupJson);
	} catch (error) {
		console.error(`❌ Failed to read input files: ${error.message}`);
		return;
	}

	console.log(`🎨 Official palette loaded with ${palette.length} colors.`);
	console.log(`💾 Backup data loaded with ${backupData.length} pixels.`);

	const validColors = new Set(palette);
	const paletteRgb = palette.map(hexToRgb);
	const closestColorCache = new Map();

	let pixelsChanged = 0;
	let pixelsMalformed = 0;

	// 2. Iterate and clean the data
	const cleanedData = backupData.map((pixel, index) => {
		// --- NEW: Handle pixels with missing or non-string color properties ---
		if (typeof pixel.color !== 'string' || !pixel.color) {
			pixelsChanged++;
			pixelsMalformed++;
			return { ...pixel, color: '#FFFFFF' };
		}

		if (validColors.has(pixel.color)) {
			return pixel;
		}

		pixelsChanged++;

		if (closestColorCache.has(pixel.color)) {
			return { ...pixel, color: closestColorCache.get(pixel.color) };
		}

		const invalidRgb = hexToRgb(pixel.color);
		// --- UPDATED: Handle malformed hex codes like "#GGGGGG" ---
		if (!invalidRgb) {
			pixelsMalformed++;
			console.warn(`⚠️ Found malformed hex code: '${pixel.color}'. Replacing with #FFFFFF.`);
			closestColorCache.set(pixel.color, '#FFFFFF');
			return { ...pixel, color: '#FFFFFF' };
		}

		let minDistance = Infinity;
		let closestColor = palette[0];

		for (let i = 0; i < paletteRgb.length; i++) {
			const distance = colorDistanceSquared(invalidRgb, paletteRgb[i]);
			if (distance < minDistance) {
				minDistance = distance;
				closestColor = palette[i];
			}
		}

		closestColorCache.set(pixel.color, closestColor);

		return { ...pixel, color: closestColor };
	});

	// 3. Write the cleaned data to a new file
	try {
		fs.writeFileSync(BACKUP_FILE_OUT, JSON.stringify(cleanedData, null, 2));
	} catch (error) {
		console.error(`❌ Failed to write cleaned data file: ${error.message}`);
		return;
	}

	console.log('\n--- Cleanup Complete ---');
	console.log(`✅ Processed ${cleanedData.length} pixels.`);
	console.log(`🔧 Corrected ${pixelsChanged} pixels.`);
	if (pixelsMalformed > 0) {
		console.log(`(Found and fixed ${pixelsMalformed} pixels with missing or malformed color data)`);
	}
	console.log(`✨ Clean data written to: ${BACKUP_FILE_OUT}`);
}

cleanData();
