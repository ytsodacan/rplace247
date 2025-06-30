import fs from 'fs/promises';

// config
const RESTORE_SECRET = process.env.RESTORE_SECRET;   // don’t hard-code it
const BACKEND_URL = "https://neurosama.place";
const BACKUP_FILE = './grid_data_backup.json'; // Your provided backup file
const PALETTE_FILE = './palette.json';
const BATCH_SIZE = 1000; // number of pixels per batch request
const DEFAULT_COLOR = "#FFFFFF";

// helper functions
function hexToRgb(hex) {
    if (!hex) return { r: 255, g: 255, b: 255 }; // Default to white
    const result = /^\#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;
    return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    };
}

function colorDistanceSquared(rgb1, rgb2) {
    const dR = rgb1.r - rgb2.r;
    const dG = rgb1.g - rgb2.g;
    const dB = rgb1.b - rgb2.b;
    return dR * dR + dG * dG + dB * dB;
}


async function restoreGrid() {
    console.log('--- Starting Grid Restore Process ---');

    // 1. load palette and backup data
    let palette, backupGrid;
    try {
        const paletteJson = await fs.readFile(PALETTE_FILE, 'utf8');
        palette = JSON.parse(paletteJson);

        const backupJson = await fs.readFile(BACKUP_FILE, 'utf8');
        backupGrid = JSON.parse(backupJson);

    } catch (error) {
        console.error(`❌ Failed to read input files: ${error.message}`);
        return;
    }
    console.log('✅ Palette and backup data loaded.');

    const validColors = new Set(palette.map(c => c.toLowerCase()));
    const paletteRgb = palette.map(hexToRgb);
    const closestColorCache = new Map();
    const pixelsToUpdate = [];
    let correctedCount = 0;

    // 2. find all non-default pixels and clean them
    console.log('🎨 Cleaning and preparing pixel data...');
    for (let y = 0; y < backupGrid.length; y++) {
        for (let x = 0; x < backupGrid[y].length; x++) {
            let originalColor = backupGrid[y][x];

            // skip if the color is the default background color
            if (originalColor === DEFAULT_COLOR || originalColor === null) {
                continue;
            }

            let finalColor = originalColor.toLowerCase();

            // if the color isn't in the palette, find the closest match
            if (!validColors.has(finalColor)) {
                correctedCount++;
                const invalidRgb = hexToRgb(originalColor);
                if (!invalidRgb) {
                    console.warn(`⚠️ Malformed hex '${originalColor}' at (${x},${y}). Replacing with default.`);
                    finalColor = DEFAULT_COLOR;
                } else if (closestColorCache.has(originalColor)) {
                    finalColor = closestColorCache.get(originalColor);
                } else {
                    let minDistance = Infinity;
                    let closestPaletteColor = palette[0];
                    for (let i = 0; i < palette.length; i++) {
                        const distance = colorDistanceSquared(invalidRgb, paletteRgb[i]);
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestPaletteColor = palette[i];
                        }
                    }
                    finalColor = closestPaletteColor;
                    closestColorCache.set(originalColor, finalColor);
                }
            }

            pixelsToUpdate.push({ x, y, color: finalColor });
        }
    }
    console.log(`✨ Found ${pixelsToUpdate.length} pixels to restore. Corrected ${correctedCount} colors.`);

    // 3. send the pixels in batches
    console.log(`\n🚀 Sending data in batches of ${BATCH_SIZE}...`);
    for (let i = 0; i < pixelsToUpdate.length; i += BATCH_SIZE) {
        const batch = pixelsToUpdate.slice(i, i + BATCH_SIZE);
        const batchNum = (i / BATCH_SIZE) + 1;
        console.log(`📦 Sending batch ${batchNum} / ${Math.ceil(pixelsToUpdate.length / BATCH_SIZE)}...`);

        try {
            const res = await fetch(`${BACKEND_URL}/batch-update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Secret': RESTORE_SECRET
                },
                body: JSON.stringify(batch)
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Server responded with ${res.status}: ${errorText}`);
            }

            const result = await res.json();
            if (result.success) {
                console.log(`✅ Batch ${batchNum} successful. ${result.count} pixels updated.`);
            } else {
                throw new Error(`Batch update failed: ${result.message}`);
            }

        } catch (error) {
            console.error(`❌ Grid push failed for batch ${batchNum}:`, error.message);
            break; // Stop on first error
        }
    }

    console.log('\n🎉 Restore process complete!');
}

restoreGrid();
