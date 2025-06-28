// color parsing for web worker
function parseColor(hex) {
    if (!hex) return 0;

    let h = hex.startsWith("#") ? hex.slice(1).toLowerCase() : hex.toLowerCase();

    if (h.length === 3 || h.length === 4) {
        h = [...h].map((ch) => ch + ch).join("");
    }

    let r = 0,
        g = 0,
        b = 0,
        a = 255;

    if (h.length === 6) {
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
    } else if (h.length === 8) {
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
        a = parseInt(h.slice(6, 8), 16);
    }

    return (a << 24) | (b << 16) | (g << 8) | r;
}

self.onmessage = ({ data }) => {
    const { grid, w, h } = data;
    const img = new ImageData(w, h);
    const buf = new Uint32Array(img.data.buffer);

    for (let y = 0, off = 0; y < h; y++) {
        const row = grid[y] || [];
        for (let x = 0; x < w; x++, off++) {
            if (row[x]) {
                buf[off] = parseColor(row[x]);
            }
        }
    }

    postMessage({ img });
};
