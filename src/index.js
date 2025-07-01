import { Hono } from "hono";

const app = new Hono();

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
    if (!tokenResponse.ok)
      return c.json({ message: "Token exchange failed" }, 502);
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

app.all(/grid.*/, (c) => c.redirect("/grid", 301));
app.all(/pixel.*/, (c) => c.redirect("/pixel", 301));
app.all(/ws.*/, (c) => c.redirect("/ws", 301));

[
  "/grid",
  "/pixel",
  "/ws",
  "/batch-update",
  "/whitelist/status",
  "/admin/whitelist",
  "/admin/whitelist/add",
  "/admin/whitelist/remove",
  "/admin/whitelist/toggle",
  "/admin/users",
  "/admin/users/add",
  "/admin/users/remove",
  "/admin/broadcast",
  "/admin/announcement",
  "/announcement",
  "/api/updates",
].forEach((p) =>
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

export class GridDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.grid = null;
    this.whitelist = null;
    this.whitelistEnabled = null;
    this.adminUserIds = [];
    this.currentAnnouncement = null; // Will be loaded from storage
  }

  async initialize() {
    if (this.grid) return;

    await this.loadAdminUsers();
    await this.loadCurrentAnnouncement();

    const pixels = await this.state.storage.list({ prefix: "pixel:" });
    const gridData = Array(500)
      .fill(0)
      .map(() => Array(500).fill("#FFFFFF"));

    for (const [key, color] of pixels) {
      const [, y, x] = key.split(":");
      const yInt = parseInt(y, 10);
      const xInt = parseInt(x, 10);
      if (yInt >= 0 && yInt < 500 && xInt >= 0 && xInt < 500) {
        gridData[yInt][xInt] = color;
      }
    }

    this.grid = gridData;
    console.log("Grid loaded with", pixels.size, "custom pixels");
  }

  async loadAdminUsers() {
    try {
      const adminData = await this.env.PALETTE_KV.get("admin_users", {
        type: "json",
      });
      if (adminData && Array.isArray(adminData)) {
        this.adminUserIds = adminData;
        console.log(
          `Loaded ${this.adminUserIds.length} admin users from KV store`,
        );
      } else {
        this.adminUserIds = (this.env.ADMIN_USER_IDS || "")
          .split(",")
          .filter((id) => id.trim());
        console.log(
          `Fallback: Loaded ${this.adminUserIds.length} admin users from environment`,
        );

        if (this.adminUserIds.length > 0) {
          await this.env.PALETTE_KV.put(
            "admin_users",
            JSON.stringify(this.adminUserIds),
          );
          console.log("Stored admin users in KV store");
        }
      }
    } catch (error) {
      console.error("Error loading admin users from KV:", error);
      this.adminUserIds = (this.env.ADMIN_USER_IDS || "")
        .split(",")
        .filter((id) => id.trim());
    }
  }

  async loadCurrentAnnouncement() {
    try {
      this.currentAnnouncement = await this.state.storage.get("current_announcement") || "";
      console.log("Loaded current announcement:", this.currentAnnouncement ? "present" : "none");
    } catch (error) {
      console.error("Error loading current announcement:", error);
      this.currentAnnouncement = "";
    }
  }

  async initializeWhitelist() {
    if (this.whitelist !== null) return;

    const whitelistData = (await this.state.storage.get("whitelist")) || {
      users: [],
      enabled: false,
    };
    this.whitelist = new Set(whitelistData.users.map((user) => user.id));
    this.whitelistEnabled = whitelistData.enabled;

    console.log(
      "Whitelist loaded with",
      this.whitelist.size,
      "users, enabled:",
      this.whitelistEnabled,
    );
  }

  async saveWhitelist() {
    const whitelistUsers = (await this.state.storage.get("whitelist")) || {
      users: [],
      enabled: false,
    };
    whitelistUsers.enabled = this.whitelistEnabled;
    await this.state.storage.put("whitelist", whitelistUsers);
  }

  async addToWhitelist(userId, username = null) {
    await this.initializeWhitelist();

    const whitelistData = (await this.state.storage.get("whitelist")) || {
      users: [],
      enabled: false,
    };

    const existingUserIndex = whitelistData.users.findIndex(
      (user) => user.id === userId,
    );

    if (existingUserIndex === -1) {
      whitelistData.users.push({
        id: userId,
        username: username,
        addedAt: new Date().toISOString(),
      });

      this.whitelist.add(userId);
      await this.state.storage.put("whitelist", whitelistData);

      console.log(`Added user ${userId} (${username}) to whitelist`);
      return { success: true, message: "User added to whitelist" };
    } else {
      if (username) {
        whitelistData.users[existingUserIndex].username = username;
        await this.state.storage.put("whitelist", whitelistData);
      }
      return { success: false, message: "User already in whitelist" };
    }
  }

  async removeFromWhitelist(userId) {
    await this.initializeWhitelist();

    const whitelistData = (await this.state.storage.get("whitelist")) || {
      users: [],
      enabled: false,
    };

    const initialLength = whitelistData.users.length;
    whitelistData.users = whitelistData.users.filter(
      (user) => user.id !== userId,
    );

    if (whitelistData.users.length < initialLength) {
      this.whitelist.delete(userId);
      await this.state.storage.put("whitelist", whitelistData);

      console.log(`Removed user ${userId} from whitelist`);
      return { success: true, message: "User removed from whitelist" };
    } else {
      return { success: false, message: "User not found in whitelist" };
    }
  }

  async toggleWhitelist() {
    await this.initializeWhitelist();

    this.whitelistEnabled = !this.whitelistEnabled;
    await this.saveWhitelist();

    console.log(`Whitelist ${this.whitelistEnabled ? "enabled" : "disabled"}`);
    return { enabled: this.whitelistEnabled };
  }

  isAdmin(userId) {
    return this.adminUserIds.includes(userId);
  }

  async isWhitelisted(userId) {
    await this.initializeWhitelist();
    return this.whitelist.has(userId) || this.isAdmin(userId);
  }

  async canPlacePixel(user) {
    if (!user) return false;

    await this.initializeWhitelist();

    if (this.isAdmin(user.id)) {
      return true;
    }

    if (!this.whitelistEnabled) {
      return true;
    }

    return await this.isWhitelisted(user.id);
  }

  async fetch(request) {
    if (!this.grid) {
      await this.initialize();
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    };

    const url = new URL(request.url);

    if (url.pathname === "/whitelist/status" && request.method === "GET") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user) {
        return new Response(
          JSON.stringify({ message: "Invalid or expired token" }),
          { status: 401, headers: corsHeaders },
        );
      }

      await this.initializeWhitelist();

      const whitelisted = await this.isWhitelisted(user.id);
      const isAdmin = this.isAdmin(user.id);

      return new Response(
        JSON.stringify({
          whitelisted,
          isAdmin,
          whitelistEnabled: this.whitelistEnabled,
          user: { id: user.id, username: user.username },
        }),
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/admin/whitelist" && request.method === "GET") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(
          JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders },
        );
      }

      await this.initializeWhitelist();
      const whitelistData = (await this.state.storage.get("whitelist")) || {
        users: [],
        enabled: false,
      };

      return new Response(
        JSON.stringify({
          users: whitelistData.users,
          enabled: this.whitelistEnabled,
          totalUsers: whitelistData.users.length,
        }),
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/admin/whitelist/add" && request.method === "POST") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(
          JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders },
        );
      }

      try {
        const { userId, username } = await request.json();
        if (!userId) {
          return new Response(
            JSON.stringify({ message: "User ID is required" }),
            { status: 400, headers: corsHeaders },
          );
        }

        const result = await this.addToWhitelist(userId, username);
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: corsHeaders,
        });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), {
          status: 400,
          headers: corsHeaders,
        });
      }
    }

    if (
      url.pathname === "/admin/whitelist/remove" &&
      request.method === "POST"
    ) {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(
          JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders },
        );
      }

      try {
        const { userId } = await request.json();
        if (!userId) {
          return new Response(
            JSON.stringify({ message: "User ID is required" }),
            { status: 400, headers: corsHeaders },
          );
        }

        const result = await this.removeFromWhitelist(userId);
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: corsHeaders,
        });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), {
          status: 400,
          headers: corsHeaders,
        });
      }
    }

    if (
      url.pathname === "/admin/whitelist/toggle" &&
      request.method === "POST"
    ) {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(
          JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders },
        );
      }

      const result = await this.toggleWhitelist();
      return new Response(JSON.stringify(result), { headers: corsHeaders });
    }

    if (url.pathname === "/admin/users" && request.method === "GET") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(
          JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders },
        );
      }

      return new Response(
        JSON.stringify({
          adminUsers: this.adminUserIds,
          totalAdmins: this.adminUserIds.length,
        }),
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/admin/users/add" && request.method === "POST") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(
          JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders },
        );
      }

      try {
        const { userId } = await request.json();
        if (!userId) {
          return new Response(
            JSON.stringify({ message: "User ID is required" }),
            { status: 400, headers: corsHeaders },
          );
        }

        if (!this.adminUserIds.includes(userId)) {
          this.adminUserIds.push(userId);
          await this.env.PALETTE_KV.put(
            "admin_users",
            JSON.stringify(this.adminUserIds),
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "Admin user added successfully",
            adminUsers: this.adminUserIds,
          }),
          { headers: corsHeaders },
        );
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), {
          status: 400,
          headers: corsHeaders,
        });
      }
    }

    if (url.pathname === "/admin/users/remove" && request.method === "POST") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders },
        );
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(
          JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders },
        );
      }

      try {
        const { userId } = await request.json();
        if (!userId) {
          return new Response(
            JSON.stringify({ message: "User ID is required" }),
            { status: 400, headers: corsHeaders },
          );
        }

        this.adminUserIds = this.adminUserIds.filter((id) => id !== userId);
        await this.env.PALETTE_KV.put(
          "admin_users",
          JSON.stringify(this.adminUserIds),
        );

        return new Response(
          JSON.stringify({
            success: true,
            message: "Admin user removed successfully",
            adminUsers: this.adminUserIds,
          }),
          { headers: corsHeaders },
        );
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), {
          status: 400,
          headers: corsHeaders,
        });
      }
    }

    // Admin broadcast endpoint
    if (url.pathname === "/admin/broadcast" && request.method === "POST") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders });
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders });
      }

      try {
        const { message, type = "info" } = await request.json();
        if (!message || !message.trim()) {
          return new Response(JSON.stringify({ message: "Message is required" }),
            { status: 400, headers: corsHeaders });
        }

        // Broadcast the message to all connected users
        this.broadcast({
          type: "broadcast",
          message: message.trim(),
          messageType: type,
          sender: user.username,
          timestamp: Date.now()
        });

        return new Response(JSON.stringify({
          success: true,
          message: "Broadcast sent successfully"
        }), { headers: corsHeaders });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }),
          { status: 400, headers: corsHeaders });
      }
    }

    // Admin announcement management
    if (url.pathname === "/admin/announcement" && request.method === "POST") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders });
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders });
      }

      try {
        const { announcement } = await request.json();
        const cleanAnnouncement = announcement ? announcement.trim().substring(0, 100) : "";

        this.currentAnnouncement = cleanAnnouncement;
        await this.state.storage.put("current_announcement", cleanAnnouncement);

        // Broadcast announcement update to all users
        this.broadcast({
          type: "announcement",
          announcement: cleanAnnouncement,
          timestamp: Date.now()
        });

        return new Response(JSON.stringify({
          success: true,
          message: "Announcement updated successfully",
          announcement: cleanAnnouncement
        }), { headers: corsHeaders });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }),
          { status: 400, headers: corsHeaders });
      }
    }

    if (url.pathname === "/admin/announcement" && request.method === "DELETE") {
      const token = extractBearerToken(request);
      if (!token) {
        return new Response(JSON.stringify({ message: "Authentication required" }),
          { status: 401, headers: corsHeaders });
      }

      const user = await validateDiscordToken(token, this.env);
      if (!user || !this.isAdmin(user.id)) {
        return new Response(JSON.stringify({ message: "Admin access required" }),
          { status: 403, headers: corsHeaders });
      }

      this.currentAnnouncement = "";
      await this.state.storage.put("current_announcement", "");

      // Broadcast announcement clearing to all users
      this.broadcast({
        type: "announcement",
        announcement: "",
        timestamp: Date.now()
      });

      return new Response(JSON.stringify({
        success: true,
        message: "Announcement cleared successfully"
      }), { headers: corsHeaders });
    }

    // Public announcement endpoint (read-only)
    if (url.pathname === "/announcement" && request.method === "GET") {
      return new Response(JSON.stringify({
        announcement: this.currentAnnouncement || ""
      }), { headers: corsHeaders });
    }

    if (url.pathname === "/api/updates" && request.method === "GET") {
      // This endpoint is for polling fallback when WebSockets aren't available
      // Currently returns empty updates - could be enhanced to track recent changes
      return new Response(
        JSON.stringify({
          updates: [],
          currentTime: Date.now(),
        }),
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/ws") {
      const [client, server] = Object.values(new WebSocketPair());
      await this.handleWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/grid" && request.method === "GET") {
      const chunkParam = url.searchParams.get("chunk");
      const chunkSize = 50;
      const totalChunks = Math.ceil(500 / chunkSize);

      if (chunkParam !== null) {
        const chunkIndex = parseInt(chunkParam, 10);
        if (
          Number.isNaN(chunkIndex) ||
          chunkIndex < 0 ||
          chunkIndex >= totalChunks
        ) {
          return new Response(
            JSON.stringify({ error: "Invalid chunk index" }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }

        const startRow = chunkIndex * chunkSize;
        const endRow = Math.min(startRow + chunkSize, 500);
        const chunkData = this.grid.slice(startRow, endRow);

        return new Response(
          JSON.stringify({
            chunk: chunkIndex,
            totalChunks,
            startRow,
            endRow,
            data: chunkData,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      } else {
        return new Response(
          JSON.stringify({
            totalChunks,
            chunkSize,
            gridWidth: 500,
            gridHeight: 500,
            message: "Use ?chunk=N parameter to get chunk data",
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }
    }
    if (url.pathname === "/pixel" && request.method === "POST") {
      try {
        const token = extractBearerToken(request);
        if (!token) {
          return new Response(
            JSON.stringify({ message: "Authentication required" }),
            { status: 401, headers: corsHeaders },
          );
        }
        const user = await validateDiscordToken(token, this.env);
        if (!user) {
          return new Response(
            JSON.stringify({ message: "Invalid or expired token" }),
            { status: 401, headers: corsHeaders },
          );
        }

        const canPlace = await this.canPlacePixel(user);
        if (!canPlace) {
          await this.initializeWhitelist();
          const reason = this.whitelistEnabled
            ? "You are not whitelisted to place pixels"
            : "Access denied";
          return new Response(JSON.stringify({ message: reason }), {
            status: 403,
            headers: corsHeaders,
          });
        }

        const { x, y, color } = await request.json();

        if (
          x == null ||
          y == null ||
          !color ||
          x < 0 ||
          x >= 500 ||
          y < 0 ||
          y >= 500 ||
          !/^#[0-9A-Fa-f]{6}$/.test(color)
        ) {
          return new Response(
            JSON.stringify({
              message:
                "Invalid pixel data - color must be valid hex format #RRGGBB",
            }),
            { status: 400, headers: corsHeaders },
          );
        }

        this.grid[y][x] = color;
        await this.state.storage.put(`pixel:${y}:${x}`, color);

        this.broadcast({
          type: "pixelUpdate",
          x,
          y,
          color,
          user: { id: user.id, username: user.username },
        });
        await this.sendDiscordWebhook(x, y, color, user);

        return new Response(JSON.stringify({ message: "Pixel updated" }), {
          status: 200,
          headers: corsHeaders,
        });
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON" }), {
          status: 400,
          headers: corsHeaders,
        });
      }
    }

    if (url.pathname === "/batch-update" && request.method === "POST") {
      const secret = request.headers.get("X-Admin-Secret");
      if (secret !== this.env.RESTORE_SECRET) {
        return new Response("Unauthorized", {
          status: 401,
          headers: corsHeaders,
        });
      }

      try {
        const pixels = await request.json();
        if (!Array.isArray(pixels)) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Invalid payload, expected an array of pixels.",
            }),
            { status: 400, headers: corsHeaders },
          );
        }

        let updateCount = 0;
        const pixelUpdates = new Map();

        for (const { x, y, color } of pixels) {
          if (
            x >= 0 &&
            x < 500 &&
            y >= 0 &&
            y < 500 &&
            /^#[0-9A-Fa-f]{6}$/.test(color)
          ) {
            this.grid[y][x] = color;
            pixelUpdates.set(`pixel:${y}:${x}`, color);
            updateCount++;
          }
        }

        if (pixelUpdates.size > 0) {
          await this.state.storage.put(pixelUpdates);
        }

        console.log(`Batch update: ${updateCount} pixels updated.`);

        this.broadcast({ type: "grid-refreshed" });

        return new Response(
          JSON.stringify({ success: true, count: updateCount }),
          { headers: corsHeaders },
        );
      } catch (e) {
        console.error("Batch update error:", e);
        return new Response(
          JSON.stringify({
            success: false,
            message: "Error processing batch.",
          }),
          { status: 500, headers: corsHeaders },
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  async handleWebSocket(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);
    webSocket.addEventListener("close", () => {
      this.sessions.delete(webSocket);
    });
    webSocket.addEventListener("error", () => {
      this.sessions.delete(webSocket);
    });
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
      embeds: [
        {
          title: "🎨 New Pixel Placed!",
          color: Number.parseInt(color.replace("#", ""), 16),
          fields,
          thumbnail: {
            url: `https://singlecolorimage.com/get/${color.replace("#", "")}/100x100`,
          },
        },
      ],
    };
    await fetch(this.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
  }
}

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
