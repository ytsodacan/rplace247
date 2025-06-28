const tests = [];
let successes = 0;
let failures = 0;

function test(name, fn) {
	tests.push({ name, fn });
}

function run() {
	console.log("Running tests...");
	for (const t of tests) {
		try {
			t.fn();
			console.log(`✅ ${t.name}`);
			successes++;
		} catch (e) {
			console.error(`❌ ${t.name}`);
			console.error(e);
			failures++;
		}
	}
	console.log("------------------");
	console.log(`Tests finished. ${successes} passed, ${failures} failed.`);
	if (failures > 0) {
		console.error("Some tests failed.");
	} else {
		console.log("All tests passed!");
	}
}

import { Canvas } from "./canvas.js";

const canvas = new Canvas();

test("parseColor should handle 6-digit hex codes", () => {
	const color = "#ff00ff";
	const expected = 0xffff00ff;
	const result = canvas.parseColor(color);
	if (result !== expected) {
		throw new Error(`Expected ${expected}, but got ${result}`);
	}
});

test("parseColor should handle 3-digit hex codes", () => {
	const color = "#f0f";
	const expected = 0xffff00ff;
	const result = canvas.parseColor(color);
	if (result !== expected) {
		throw new Error(`Expected ${expected}, but got ${result}`);
	}
});

test("getGridCoordsFromScreen should correctly convert screen to grid coordinates", () => {
	canvas.scale = 2.0;
	canvas.offsetX = 50;
	canvas.offsetY = 50;
	canvas.canvas.getBoundingClientRect = () => ({
		left: 10,
		top: 10,
	});

	const screenX = 180;
	const screenY = 180;
	const { x, y } = canvas.getGridCoordsFromScreen(screenX, screenY);

	if (x !== 6 || y !== 6) {
		throw new Error(`Expected (6, 6), but got (${x}, ${y})`);
	}
});

run();
