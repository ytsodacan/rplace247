/* mergeGrids.js
   Usage:  node mergeGrids.js fileA.json fileB.json fileC.json -o merged.json
   Earlier files override later ones, but *only* where their cells are not
   "" or "#FFFFFF".
*/

const fs = require("fs");
const path = require("path");

// --- CLI ------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("Syntax: mergeGrids.js <file1> <file2> [...fileN] [-o output]");
    process.exit(1);
}

let outName = "merged-grid.json";
const fileNames = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o") {
        outName = args[i + 1] || outName;
        i++; // skip output arg
    } else {
        fileNames.push(args[i]);
    }
}
if (fileNames.length < 2) {
    console.error("Please supply at least two grid files to merge.");
    process.exit(1);
}

// --- Helpers --------------------------------------------------------------
const isDefault = (v) => v === "" || v === "#FFFFFF";

/**
 * Loads a grid-JSON file and returns {meta, data}.
 * Throws if width/height or data shape don’t line up.
 */
function loadGrid(file) {
    const obj = JSON.parse(fs.readFileSync(file, "utf-8"));
    const { gridWidth, gridHeight, data } = obj;
    if (data.length !== gridHeight || data.some((row) => row.length !== gridWidth)) {
        throw new Error(`Malformed grid dimensions in ${file}`);
    }
    return { meta: obj, data };
}

/**
 * Deep-copies a 2-D array of strings.
 */
const cloneGrid = (grid) => grid.map((row) => row.slice());

// --- Merge ----------------------------------------------------------------
const { data: baseGrid, meta: baseMeta } = loadGrid(fileNames[fileNames.length - 1]);
let merged = cloneGrid(baseGrid);

// Walk the *earlier* files from next-to-last up to first (highest priority)
for (let i = fileNames.length - 2; i >= 0; i--) {
    const { data: g } = loadGrid(fileNames[i]);
    for (let y = 0; y < g.length; y++) {
        for (let x = 0; x < g[y].length; x++) {
            if (!isDefault(g[y][x])) merged[y][x] = g[y][x];
        }
    }
}

// --- Write result ---------------------------------------------------------
const output = {
    ...baseMeta,                       // keep width/height/version fields
    timestamp: new Date().toISOString(),
    data: merged,
};

fs.writeFileSync(outName, JSON.stringify(output));
console.log(`Merged ${fileNames.length} grids → ${outName}`);
