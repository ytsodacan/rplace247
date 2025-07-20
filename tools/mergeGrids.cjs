const fs = require("node:fs");
const path = require("node:path");

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
		i++;
	} else {
		fileNames.push(args[i]);
	}
}
if (fileNames.length < 2) {
	console.error("Please supply at least two grid files to merge.");
	process.exit(1);
}

const isDefault = (v) => v === "" || v === "#FFFFFF";

/**
 * Loads a grid-JSON file and returns {meta, data}.
 * Throws if width/height or data shape don’t line up.
 */
function loadGrid(file) {
	const obj = JSON.parse(fs.readFileSync(file, "utf-8"));
	const { gridWidth, gridHeight, data } = obj;
	if (
		data.length !== gridHeight ||
		data.some((row) => row.length !== gridWidth)
	) {
		throw new Error(`Malformed grid dimensions in ${file}`);
	}
	return { meta: obj, data };
}

/**
 * Deep-copies a 2-D array of strings.
 */
const cloneGrid = (grid) => grid.map((row) => row.slice());

const { data: baseGrid, meta: baseMeta } = loadGrid(
	fileNames[fileNames.length - 1],
);
const merged = cloneGrid(baseGrid);

for (let i = fileNames.length - 2; i >= 0; i--) {
	const { data: g } = loadGrid(fileNames[i]);
	for (let y = 0; y < g.length; y++) {
		for (let x = 0; x < g[y].length; x++) {
			if (!isDefault(g[y][x])) merged[y][x] = g[y][x];
		}
	}
}

const output = {
	...baseMeta,
	timestamp: new Date().toISOString(),
	data: merged,
};

fs.writeFileSync(outName, JSON.stringify(output));
console.log(`Merged ${fileNames.length} grids → ${outName}`);
