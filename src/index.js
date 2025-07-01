import { Hono } from "hono";

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

// Route: POST /auth/discord - Discord OAuth token exchange (unchanged)
app.post("/auth/discord", async (c) => {
  try {
    const { code, redirect_uri } = await c.req.json();
    console.log("DEBUG ENV:", Object.keys(c.env));
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
  }

  async initialize() {
    if (this.grid) return;

    // Load grid from durable storage
    const pixels = await this.state.storage.list({ prefix: "pixel:" });
    const gridData = Array(500).fill(0).map(() => Array(500).fill("#FFFFFF")); // Default white background

    for (const [key, color] of pixels) {
      const [, y, x] = key.split(":");
      const yInt = parseInt(y, 10);
      const xInt = parseInt(x, 10);
      if (yInt >= 0 && yInt < 500 && xInt >= 0 && xInt < 500) {
        gridData[yInt][xInt] = color;
      }
    }

    this.grid = gridData;
    console.log('Grid loaded with', pixels.size, 'custom pixels');
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
      // Handle chunked grid loading due to Cloudflare size limits
      const chunkParam = url.searchParams.get('chunk');
      const chunkSize = 50; // rows per chunk (500x50 = 25,000 pixels per chunk)
      const totalChunks = Math.ceil(500 / chunkSize);

      if (chunkParam !== null) {
        const chunkIndex = parseInt(chunkParam, 10);
        if (Number.isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
          return new Response(JSON.stringify({ error: "Invalid chunk index" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        const startRow = chunkIndex * chunkSize;
        const endRow = Math.min(startRow + chunkSize, 500);
        const chunkData = this.grid.slice(startRow, endRow);

        return new Response(JSON.stringify({
          chunk: chunkIndex,
          totalChunks,
          startRow,
          endRow,
          data: chunkData
        }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } else {
        // Return metadata about chunks
        return new Response(JSON.stringify({
          totalChunks,
          chunkSize,
          gridWidth: 500,
          gridHeight: 500,
          message: "Use ?chunk=N parameter to get chunk data"
        }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
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

        // Validate input - accept any valid hex color
        if (x == null || y == null || !color || x < 0 || x >= 500 || y < 0 || y >= 500 || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
          return new Response(JSON.stringify({ message: "Invalid pixel data - color must be valid hex format #RRGGBB" }), { status: 400, headers: corsHeaders });
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
          if (x >= 0 && x < 500 && y >= 0 && y < 500 && /^#[0-9A-Fa-f]{6}$/.test(color)) {
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
