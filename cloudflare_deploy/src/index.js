import { Hono } from "hono";
import defaultPalette from "../palette.json";

// Hono app setup
const app = new Hono();

// CORS headers are now centralized in the Durable Object for relevant responses
const cors = (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  return next();
};

app.use("*", cors);

// The palette is no longer hardcoded. It's fetched from a KV namespace.
// This endpoint allows the frontend to retrieve the color palette.
app.get("/palette", async (c) => {
  try {
    // PALETTE_KV is a binding to a Cloudflare KV Namespace.
    // 'colors' is the key where the palette array is stored as a JSON string.
    const paletteJson = await c.env.PALETTE_KV.get("colors");
    if (!paletteJson) {
      return c.json({ message: "Palette not configured in PALETTE_KV" }, 500);
    }
    const palette = JSON.parse(paletteJson);
    return c.json({ palette });
  } catch (error) {
    console.error("Failed to fetch palette:", error);
    return c.json({ message: "Could not retrieve palette." }, 500);
  }
});

// Route: POST /auth/discord - Discord OAuth token exchange (unchanged)
app.post("/auth/discord", async (c) => {
  try {
    const { code, redirect_uri } = await c.req.json();
    if (!code || !c.env.DISCORD_CLIENT_SECRET) {
      return c.json({ message: "Invalid request or configuration" }, 400);
    }
    const tokenParams = new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID || "1388712213002457118",
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri,
    });
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
    });
    if (!tokenResponse.ok) return c.json({ message: "Token exchange failed" }, 502);
    const tokenData = await tokenResponse.json();
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) return c.json({ message: "User fetch failed" }, 502);
    const userData = await userResponse.json();
    return c.json({
      access_token: tokenData.access_token,
      user: {
        id: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        avatar: userData.avatar,
      },
    });
  } catch (error) {
    console.error("Discord OAuth error:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// Normalizing routes for grid-related paths
app.all(/grid.*/, (c) => c.redirect("/grid", 301));
app.all(/pixel.*/, (c) => c.redirect("/pixel", 301));
app.all(/ws.*/, (c) => c.redirect("/ws", 301));

// Forward all grid-related, real-time, and asset requests to the Durable Object or Assets binding
["/grid", "/pixel", "/ws", "/batch-update"].forEach((p) =>
  app.all(p, (c) => {
    const stub = c.env.GRID_STATE.get(c.env.GRID_STATE.idFromName("global"));
    return stub.fetch(c.req.raw);
  }),
);

app.get("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  GridDurableObject: GridDurableObject,
};

// --- Durable Object for Grid State ---
export class GridDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.grid = null; // Lazily loaded
    this.palette = null; // Lazily loaded
    this.colorIndex = null; // Lazily computed
  }

  async initialize() {
    if (this.grid && this.palette) return;

    // Load grid from durable storage
    const gridPromise = this.state.storage
      .list({ prefix: "pixel:" })
      .then(async (pixels) => {
        const gridData = Array(500).fill(0).map(() => Array(500).fill(null)); // Use null for uncolored
        for (const [key, color] of pixels) {
          const [, y, x] = key.split(":");
          if (gridData[y] && gridData[y][x] !== undefined) {
            gridData[y][x] = color;
          }
        }
        return gridData;
      });

    // Load palette from KV binding, fall back to bundled defaultPalette when absent
    const paletteFromKV = await this.env.PALETTE_KV.get("colors", "json");

    // Await both operations (gridPromise already running)
    const grid = await gridPromise;

    // Use palette from KV if available, otherwise fallback to the bundled default
    const palette = paletteFromKV || defaultPalette;

    // Persist the default palette to KV for future requests if it was missing
    if (!paletteFromKV) {
      try {
        await this.env.PALETTE_KV.put("colors", JSON.stringify(defaultPalette));
      } catch (err) {
        // Non-fatal: log but continue; future requests will still have the in-memory fallback
        console.warn("Failed to persist default palette to KV:", err);
      }
    }

    this.palette = palette;
    // Replace nulls with the default background color from the palette
    this.grid = grid.map(row => row.map(cell => cell === null ? this.palette[0] : cell));
    // Create a reverse map for quick color-to-index translation for RLE
    this.colorIndex = Object.fromEntries(this.palette.map((c, i) => [c, i]));
  }

  async fetch(request) {
    // Ensure grid and palette are loaded before proceeding
    if (!this.grid) {
      await this.initialize();
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    };

    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const [client, server] = Object.values(new WebSocketPair());
      await this.handleWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/grid" && request.method === "GET") {
      // IMPROVEMENT: Use Run-Length Encoding (RLE) for efficient grid transfer.
      // This is much smaller than sending a giant JSON array.
      const flat = new Uint8Array(500 * 500);
      let k = 0;
      for (let y = 0; y < 500; y++)
        for (let x = 0; x < 500; x++)
          flat[k++] = this.colorIndex[this.grid[y][x]];

      const rle = [];
      if (flat.length === 0) {
        return new Response(new Uint8Array(), {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }

      let runColour = flat[0];
      let runLen = 1;
      for (let i = 1; i < flat.length; i++) {
        const c = flat[i];
        if (c === runColour && runLen < 255) {
          runLen++;
        } else {
          rle.push(runLen, runColour);
          runColour = c;
          runLen = 1;
        }
      }
      rle.push(runLen, runColour);
      return new Response(Uint8Array.from(rle), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    if (url.pathname === "/pixel" && request.method === "POST") {
      try {
        const token = extractBearerToken(request);
        if (!token) {
          return new Response(JSON.stringify({ message: "Authentication required" }), { status: 401, headers: corsHeaders });
        }
        const user = await validateDiscordToken(token, this.env);
        if (!user) {
          return new Response(JSON.stringify({ message: "Invalid or expired token" }), { status: 401, headers: corsHeaders });
        }
        const { x, y, color } = await request.json();

        // Validate input
        if (x == null || y == null || !color || x < 0 || x >= 500 || y < 0 || y >= 500 || !this.colorIndex.hasOwnProperty(color)) {
          return new Response(JSON.stringify({ message: "Invalid pixel data" }), { status: 400, headers: corsHeaders });
        }

        this.grid[y][x] = color;
        // Persist only the changed pixel
        await this.state.storage.put(`pixel:${y}:${x}`, color);

        this.broadcast({ type: "pixelUpdate", x, y, color, user: { id: user.id, username: user.username } });
        await this.sendDiscordWebhook(x, y, color, user);

        return new Response(JSON.stringify({ message: "Pixel updated" }), { status: 200, headers: corsHeaders });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), { status: 400, headers: corsHeaders });
      }
    }

    // Batch update endpoint for the restore script
    if (url.pathname === "/batch-update" && request.method === "POST") {
      const secret = request.headers.get('X-Admin-Secret');
      if (secret !== this.env.RESTORE_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      try {
        const pixels = await request.json();
        if (!Array.isArray(pixels)) {
          return new Response(JSON.stringify({ success: false, message: "Invalid payload, expected an array of pixels." }), { status: 400, headers: corsHeaders });
        }

        let updateCount = 0;
        const pixelUpdates = new Map();

        for (const { x, y, color } of pixels) {
          if (x >= 0 && x < 500 && y >= 0 && y < 500 && this.colorIndex.hasOwnProperty(color)) {
            this.grid[y][x] = color;
            pixelUpdates.set(`pixel:${y}:${x}`, color);
            updateCount++;
          }
        }

        // Batch persist all changed pixels
        if (pixelUpdates.size > 0) {
          await this.state.storage.put(pixelUpdates);
        }

        console.log(`Batch update: ${updateCount} pixels updated.`);

        // Broadcasting might be too much for large batches, so just send a generic update signal
        this.broadcast({ type: "grid-refreshed" });

        return new Response(JSON.stringify({ success: true, count: updateCount }), { headers: corsHeaders });

      } catch (e) {
        console.error("Batch update error:", e);
        return new Response(JSON.stringify({ success: false, message: "Error processing batch." }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  async handleWebSocket(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);
    webSocket.addEventListener("close", () => { this.sessions.delete(webSocket) });
    webSocket.addEventListener("error", () => { this.sessions.delete(webSocket) });
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(messageStr);
      } catch {
        this.sessions.delete(session);
      }
    }
  }

  async sendDiscordWebhook(x, y, color, user = null) {
    if (!this.env.DISCORD_WEBHOOK_URL) return;
    const fields = [
      { name: "Position", value: `(${x}, ${y})`, inline: true },
      { name: "Color", value: color.toUpperCase(), inline: true },
    ];
    if (user) {
      fields.push({ name: "User", value: `${user.username}`, inline: true });
    }
    const webhookPayload = {
      embeds: [{
        title: "🎨 New Pixel Placed!",
        color: Number.parseInt(color.replace("#", ""), 16),
        fields,
        thumbnail: { url: `https://singlecolorimage.com/get/${color.replace("#", "")}/100x100` },
      }],
    };
    await fetch(this.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
  }
}

// --- Helper Functions ---
function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.substring(7);
}

async function validateDiscordToken(token, _env) {
  try {
    const response = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
