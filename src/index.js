import { Hono } from "hono";

function detectDevice(userAgent) {
  if (!userAgent) return "unknown";

  const mobileRegex =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const tabletRegex = /iPad|Android(?=.*\bMobile\b)(?=.*\bSafari\b)|tablet/i;

  if (tabletRegex.test(userAgent)) return "tablet";
  if (mobileRegex.test(userAgent)) return "mobile";
  return "desktop";
}

function observePixels(env, eventData) {
  env.onEventStore.writeDataPoint({
    blobs: [
      eventData.event_type,
      eventData.device_type,
      eventData.input_method,
      eventData.auth_status,
      eventData.user_type,
      eventData.session_id || "unknown",
    ],
    doubles: [
      eventData.x_coordinate || 0,
      eventData.y_coordinate || 0,
      eventData.time_to_first_placement || 0,
      eventData.session_duration || 0,
      eventData.placement_count || 1,
    ],
    indexes: [eventData.user_id || "anonymous"],
  });
}

function observeSession(env, eventData) {
  env.onEventStore.writeDataPoint({
    blobs: [
      "user_session",
      eventData.session_event,
      eventData.device_type,
      eventData.auth_method || "none",
      eventData.user_type || "anonymous",
      eventData.session_id || "unknown",
    ],
    doubles: [
      eventData.auth_duration || 0,
      eventData.session_duration || 0,
      0,
      0,
      0,
    ],
    indexes: [eventData.user_id || "anonymous"],
  });
}

function observeGridCorruption(env, eventData) {
  env.onEventStore.writeDataPoint({
    blobs: [
      "grid_corruption",
      eventData.corruption_type,
      eventData.detection_method,
      eventData.recovery_status,
      eventData.backup_timestamp || "none",
      eventData.corruption_reason || "unknown",
    ],
    doubles: [
      eventData.pixels_before_corruption || 0,
      eventData.pixels_after_recovery || 0,
      eventData.backup_age_minutes || 0,
      eventData.detection_time_ms || 0,
      eventData.recovery_time_ms || 0,
    ],
    indexes: ["system"],
  });
}

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
    const { code, redirect_uri, sessionId, authStartTime } = await c.req.json();
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

    const authDuration = authStartTime ? Date.now() - authStartTime : 0;
    observeSession(c.env, {
      session_event: "auth_complete",
      device_type: detectDevice(c.req.header("User-Agent")),
      auth_method: "discord",
      user_type: "authenticated",
      session_id: sessionId || "unknown",
      auth_duration: authDuration,
      session_duration: 0,
      user_id: userData.id,
    });

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
  "/admin/grid/restore",
  "/admin/grid/clear",
  "/announcement",
  "/api/updates",
  "/api/active-users",
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
    this.adminSessions = new Set();
    this.grid = null;
    this.whitelist = null;
    this.whitelistEnabled = null;
    this.adminUserIds = [];
    this.currentAnnouncement = null;
    this.activeUsers = new Map();
    this.recentPlacements = new Map();
    this.lastBackupTime = 0;
    this.backupInterval = null;
    this.pixelChangesSinceBackup = false;
    this.lastPixelUpdateTime = 0;
  }

  async initialize() {
    if (this.grid) return;

    await this.loadAdminUsers();
    await this.loadCurrentAnnouncement();

    try {
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

      // Check for grid corruption and attempt recovery
      const isCorrupted = await this.checkGridCorruption(gridData, pixels.size);
      if (isCorrupted) {
        console.warn(
          "Grid corruption detected, attempting to restore from backup",
        );
        const restored = await this.attemptGridRestore();
        if (restored) {
          this.grid = restored;
          // Count actual pixels in restored grid
          let restoredPixelCount = 0;
          for (let y = 0; y < 500; y++) {
            for (let x = 0; x < 500; x++) {
              if (this.grid[y][x] !== "#FFFFFF") {
                restoredPixelCount++;
              }
            }
          }
          console.log(
            `Grid restored from backup successfully with ${restoredPixelCount} custom pixels`,
          );

          // Log corruption recovery event
          await this.logCorruptionEvent({
            corruptionType: "empty_grid_with_backups",
            pixelsBefore: pixels.size,
            pixelsAfter: restoredPixelCount,
            recoveryStatus: "success",
            detectionTime: Date.now(),
          });
        } else {
          this.grid = gridData;
          console.error(
            "Grid restoration failed, using potentially corrupted data",
          );
          console.log("Grid loaded with", pixels.size, "custom pixels");

          // Log failed corruption recovery event
          await this.logCorruptionEvent({
            corruptionType: "empty_grid_with_backups",
            pixelsBefore: pixels.size,
            pixelsAfter: pixels.size,
            recoveryStatus: "failed",
            detectionTime: Date.now(),
          });
        }
      } else {
        this.grid = gridData;
        console.log("Grid loaded with", pixels.size, "custom pixels");
        this.logToConsole("info", `Grid loaded with ${pixels.size} custom pixels`);
      }

      // Start backup interval if there are active users
      this.startBackupInterval();
    } catch (error) {
      console.error("Grid initialization error:", error);
      // Attempt to restore from backup on initialization failure
      const restored = await this.attemptGridRestore();
      if (restored) {
        this.grid = restored;
        // Count restored pixels
        let restoredPixelCount = 0;
        for (let y = 0; y < 500; y++) {
          for (let x = 0; x < 500; x++) {
            if (this.grid[y][x] !== "#FFFFFF") {
              restoredPixelCount++;
            }
          }
        }
        console.log("Grid restored from backup after initialization failure");

        // Log initialization failure recovery event
        await this.logCorruptionEvent({
          corruptionType: "initialization_failure",
          pixelsBefore: 0,
          pixelsAfter: restoredPixelCount,
          recoveryStatus: "success",
          detectionTime: Date.now(),
          error: error.message,
        });
      } else {
        this.grid = Array(500)
          .fill(0)
          .map(() => Array(500).fill("#FFFFFF"));
        console.error("Grid initialization failed, using empty grid");

        // Log failed initialization recovery event
        await this.logCorruptionEvent({
          corruptionType: "initialization_failure",
          pixelsBefore: 0,
          pixelsAfter: 0,
          recoveryStatus: "failed",
          detectionTime: Date.now(),
          error: error.message,
        });
      }
    }
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
      this.currentAnnouncement =
        (await this.state.storage.get("current_announcement")) || "";
      console.log(
        "Loaded current announcement:",
        this.currentAnnouncement ? "present" : "none",
      );
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
      this.logToConsole("info", `User added to whitelist: ${username} (${userId})`);
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
      this.logToConsole("info", `User removed from whitelist: ${userId}`);
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
    this.logToConsole("info", `Whitelist ${this.whitelistEnabled ? "enabled" : "disabled"}`);
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

  observeUserActivity(userId, username, deviceType = "unknown") {
    const now = Date.now();
    this.activeUsers.set(userId, {
      username: username || `User${userId.slice(0, 8)}`,
      lastSeen: now,
      deviceType: deviceType,
    });

    for (const [id, data] of this.activeUsers.entries()) {
      if (now - data.lastSeen > 5 * 60 * 1000) {
        this.activeUsers.delete(id);
      }
    }
  }

  observePixels(userId, username) {
    const now = Date.now();
    const existing = this.recentPlacements.get(userId) || {
      count: 0,
      lastPlacement: 0,
    };

    this.recentPlacements.set(userId, {
      count: existing.count + 1,
      lastPlacement: now,
      username: username || `User${userId.slice(0, 8)}`,
    });

    for (const [id, data] of this.recentPlacements.entries()) {
      if (now - data.lastPlacement > 30 * 1000) {
        this.recentPlacements.delete(id);
      }
    }
  }

  getActiveUsers(timeWindowMs = 30 * 1000) {
    const now = Date.now();
    const activeInWindow = [];

    for (const [userId, data] of this.activeUsers.entries()) {
      if (now - data.lastSeen <= timeWindowMs) {
        const recentPlacement = this.recentPlacements.get(userId);
        activeInWindow.push({
          userId: `${userId.slice(0, 8)}...`,
          username: data.username,
          deviceType: data.deviceType,
          lastSeen: data.lastSeen,
          recentPlacements: recentPlacement?.count || 0,
          isPlacingPixels:
            recentPlacement &&
            now - recentPlacement.lastPlacement <= timeWindowMs,
        });
      }
    }

    return activeInWindow.sort((a, b) => b.lastSeen - a.lastSeen);
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

    if (url.pathname === "/admin/broadcast" && request.method === "POST") {
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
        const { message, type = "info" } = await request.json();
        if (!message || !message.trim()) {
          return new Response(
            JSON.stringify({ message: "Message is required" }),
            { status: 400, headers: corsHeaders },
          );
        }

        this.broadcast({
          type: "broadcast",
          message: message.trim(),
          messageType: type,
          sender: user.username,
          timestamp: Date.now(),
        });

        this.logToConsole("info", `Admin broadcast sent by ${user.username}: ${message.trim()}`);

        return new Response(
          JSON.stringify({
            success: true,
            message: "Broadcast sent successfully",
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

    if (url.pathname === "/admin/announcement" && request.method === "POST") {
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
        const { announcement } = await request.json();
        const cleanAnnouncement = announcement
          ? announcement.trim().substring(0, 100)
          : "";

        this.currentAnnouncement = cleanAnnouncement;
        await this.state.storage.put("current_announcement", cleanAnnouncement);

        this.broadcast({
          type: "announcement",
          announcement: cleanAnnouncement,
          timestamp: Date.now(),
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Announcement updated successfully",
            announcement: cleanAnnouncement,
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

    if (url.pathname === "/admin/announcement" && request.method === "DELETE") {
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

      this.currentAnnouncement = "";
      await this.state.storage.put("current_announcement", "");

      this.broadcast({
        type: "announcement",
        announcement: "",
        timestamp: Date.now(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "Announcement cleared successfully",
        }),
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/announcement" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          announcement: this.currentAnnouncement || "",
        }),
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/api/active-users" && request.method === "GET") {
      const timeWindow = parseInt(url.searchParams.get("window")) || 30000;
      const activeUsers = this.getActiveUsers(timeWindow);

      return new Response(
        JSON.stringify({
          activeUsers: activeUsers,
          count: activeUsers.length,
          timeWindow: timeWindow,
          timestamp: Date.now(),
        }),
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/api/updates" && request.method === "GET") {
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

        // Track pixel changes for backup
        this.pixelChangesSinceBackup = true;
        this.lastPixelUpdateTime = Date.now();
        await this.state.storage.put(
          "last_pixel_update_time",
          this.lastPixelUpdateTime,
        );

        this.broadcast({
          type: "pixelUpdate",
          x,
          y,
          color,
          user: { id: user.id, username: user.username },
        });

        this.logToConsole("info", `Pixel placed at (${x}, ${y}) by ${user.username}`, {
          x, y, color, user: user.username
        });

        await this.sendDiscordWebhook(x, y, color, user);

        this.observeUserActivity(
          user.id,
          user.username,
          detectDevice(request.headers.get("user-agent")),
        );
        this.observePixels(user.id, user.username);

        observePixels(this.env, {
          event_type: "pixel_placement",
          device_type: detectDevice(request.headers.get("user-agent")),
          input_method: request.headers.get("x-input-method") || "unknown",
          auth_status: user ? "authenticated" : "anonymous",
          user_type: this.isAdmin(user.id)
            ? "admin"
            : (await this.isWhitelisted(user.id))
              ? "whitelisted"
              : "public",
          session_id: request.headers.get("x-session-id") || "unknown",
          x_coordinate: x,
          y_coordinate: y,
          time_to_first_placement:
            Date.now() - parseInt(request.headers.get("x-timestamp"), 10),
          session_duration:
            parseInt(request.headers.get("x-session-duration"), 10) || 0,
          placement_count:
            parseInt(request.headers.get("x-placement-count"), 10) || 1,
          user_id: user.id,
        });

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

    if (url.pathname === "/admin/grid/restore" && request.method === "POST") {
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
        const backupData = await request.json();

        if (!backupData.data || !Array.isArray(backupData.data)) {
          return new Response(
            JSON.stringify({ message: "Invalid backup data format" }),
            { status: 400, headers: corsHeaders },
          );
        }

        if (
          backupData.data.length !== 500 ||
          !backupData.data.every(
            (row) => Array.isArray(row) && row.length === 500,
          )
        ) {
          return new Response(
            JSON.stringify({
              message: "Invalid grid dimensions. Expected 500x500 grid.",
            }),
            { status: 400, headers: corsHeaders },
          );
        }

        this.grid = backupData.data;

        const pixelUpdates = new Map();
        let updateCount = 0;

        for (let y = 0; y < 500; y++) {
          for (let x = 0; x < 500; x++) {
            const color = this.grid[y][x];
            if (color && /^#[0-9A-Fa-f]{6}$/i.test(color)) {
              pixelUpdates.set(`pixel:${y}:${x}`, color);
              updateCount++;
            }
          }
        }

        const existingPixels = await this.state.storage.list({
          prefix: "pixel:",
        });
        await this.state.storage.delete(Array.from(existingPixels.keys()));

        if (pixelUpdates.size > 0) {
          await this.state.storage.put(pixelUpdates);
        }

        console.log(
          `Grid restored from backup: ${updateCount} pixels updated.`,
        );

        this.broadcast({ type: "grid-refreshed" });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Grid restored successfully from backup",
            pixelsRestored: updateCount,
            backupInfo: {
              timestamp: backupData.timestamp,
              version: backupData.version,
              createdBy: backupData.metadata?.createdBy || "unknown",
            },
          }),
          { headers: corsHeaders },
        );
      } catch (error) {
        console.error("Grid restore error:", error);
        return new Response(
          JSON.stringify({
            success: false,
            message: "Error processing backup data.",
          }),
          { status: 500, headers: corsHeaders },
        );
      }
    }

    if (url.pathname === "/admin/grid/clear" && request.method === "POST") {
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
        this.grid = Array(500)
          .fill(0)
          .map(() => Array(500).fill("#FFFFFF"));

        const existingPixels = await this.state.storage.list({
          prefix: "pixel:",
        });
        await this.state.storage.delete(Array.from(existingPixels.keys()));

        console.log(
          `Grid cleared by admin user: ${user.username} (${user.id})`,
        );
        this.logToConsole("warn", `Grid cleared by admin: ${user.username}`);

        this.broadcast({ type: "grid-refreshed" });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Grid cleared successfully",
            clearedBy: user.username,
            timestamp: new Date().toISOString(),
          }),
          { headers: corsHeaders },
        );
      } catch (error) {
        console.error("Grid clear error:", error);
        return new Response(
          JSON.stringify({
            success: false,
            message: "Error clearing grid.",
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

    // Start backup interval when first user connects
    if (this.sessions.size === 1) {
      this.startBackupInterval();
    }

    webSocket.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "admin_console_subscribe") {
          const token = data.token;
          if (token) {
            const user = await validateDiscordToken(token, this.env);
            if (user && this.isAdmin(user.id)) {
              this.adminSessions.add(webSocket);
              this.logToConsole("info", `Admin console connected: ${user.username}`);
            }
          }
        } else if (data.type === "admin_console_unsubscribe") {
          this.adminSessions.delete(webSocket);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    webSocket.addEventListener("close", () => {
      this.sessions.delete(webSocket);
      this.adminSessions.delete(webSocket);
      // Stop backup interval when no users are connected
      if (this.sessions.size === 0) {
        this.stopBackupInterval();
      }
    });
    webSocket.addEventListener("error", () => {
      this.sessions.delete(webSocket);
      this.adminSessions.delete(webSocket);
      // Stop backup interval when no users are connected
      if (this.sessions.size === 0) {
        this.stopBackupInterval();
      }
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

  logToConsole(level, message, data = null) {
    const logMessage = {
      type: "console_log",
      level: level,
      message: message,
      data: data,
      timestamp: Date.now()
    };

    const messageStr = JSON.stringify(logMessage);
    for (const session of this.adminSessions) {
      try {
        session.send(messageStr);
      } catch {
        this.adminSessions.delete(session);
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

  // Generate SHA-256 hash of grid data
  async generateGridHash(gridData) {
    const gridString = JSON.stringify(gridData);
    const encoder = new TextEncoder();
    const data = encoder.encode(gridString);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Check if grid is corrupted (empty or matches empty grid hash)
  async checkGridCorruption(gridData, pixelCount) {
    // If no pixels are stored, check if this is expected
    if (pixelCount === 0) {
      // Get the hash of an empty grid
      const emptyGrid = Array(500)
        .fill(0)
        .map(() => Array(500).fill("#FFFFFF"));
      const emptyGridHash = await this.generateGridHash(emptyGrid);
      const currentGridHash = await this.generateGridHash(gridData);

      // If current grid matches empty grid but we have backups, it might be corrupted
      if (currentGridHash === emptyGridHash) {
        const lastBackup = await this.env.PALETTE_KV.get("grid_backup_latest", {
          type: "json",
        });
        if (lastBackup && lastBackup.metadata.pixelCount > 0) {
          console.warn(
            "Grid appears to be corrupted: empty grid with existing backups",
          );
          return true;
        }
      }
    }

    // Check if the loaded grid differs from the last backup hash
    const lastBackup = await this.env.PALETTE_KV.get("grid_backup_latest", {
      type: "json",
    });
    if (lastBackup) {
      const currentGridHash = await this.generateGridHash(gridData);
      const lastUpdateTime =
        (await this.state.storage.get("last_pixel_update_time")) || 0;

      // If hash differs and backup is newer, grid might be corrupted
      if (
        currentGridHash !== lastBackup.hash &&
        lastBackup.timestamp > lastUpdateTime
      ) {
        console.warn(
          "Grid hash mismatch with backup, potential corruption detected",
        );
        return true;
      }
    }

    return false;
  }

  // Attempt to restore grid from the latest backup
  async attemptGridRestore() {
    try {
      const lastBackup = await this.env.PALETTE_KV.get("grid_backup_latest", {
        type: "json",
      });
      if (!lastBackup) {
        console.log("No backup available for restoration");
        return null;
      }

      // Verify backup integrity
      const backupHash = await this.generateGridHash(lastBackup.data);
      if (backupHash !== lastBackup.hash) {
        console.error("Backup integrity check failed, backup is corrupted");
        return null;
      }

      console.log(
        `Restoring grid from backup: ${lastBackup.metadata.createdAt}`,
      );
      return lastBackup.data;
    } catch (error) {
      console.error("Grid restore attempt failed:", error);
      return null;
    }
  }

  // Create a backup of the current grid
  async createGridBackup() {
    if (!this.grid || !this.pixelChangesSinceBackup) {
      return;
    }

    try {
      const timestamp = Date.now();
      const gridHash = await this.generateGridHash(this.grid);

      // Count non-white pixels
      let pixelCount = 0;
      for (let y = 0; y < 500; y++) {
        for (let x = 0; x < 500; x++) {
          if (this.grid[y][x] !== "#FFFFFF") {
            pixelCount++;
          }
        }
      }

      const backup = {
        data: this.grid,
        hash: gridHash,
        timestamp: timestamp,
        metadata: {
          pixelCount: pixelCount,
          createdAt: new Date(timestamp).toISOString(),
          createdBy: "auto-backup",
        },
      };

      // Store the backup in KV (more resilient than Durable Object storage)
      await this.env.PALETTE_KV.put(
        "grid_backup_latest",
        JSON.stringify(backup),
      );

      // Also store timestamped backup (keep last 10)
      await this.env.PALETTE_KV.put(
        `grid_backup_${timestamp}`,
        JSON.stringify(backup),
      );

      // Update backup index for cleanup tracking
      await this.updateBackupIndex(timestamp);

      // Clean up old backups
      await this.cleanupOldBackups();

      this.lastBackupTime = timestamp;
      this.pixelChangesSinceBackup = false;

      console.log(
        `Grid backup created: ${pixelCount} pixels, hash: ${gridHash.substring(0, 16)}...`,
      );
    } catch (error) {
      console.error("Grid backup creation failed:", error);
    }
  }

  // Update backup index with new timestamp
  async updateBackupIndex(timestamp) {
    try {
      const backupIndex =
        (await this.env.PALETTE_KV.get("grid_backup_index", {
          type: "json",
        })) || [];

      // Add timestamp to index if not already there
      if (!backupIndex.includes(timestamp)) {
        backupIndex.push(timestamp);
        await this.env.PALETTE_KV.put(
          "grid_backup_index",
          JSON.stringify(backupIndex),
        );
      }
    } catch (error) {
      console.error("Backup index update failed:", error);
    }
  }

  // Clean up old backups (keep last 10)
  async cleanupOldBackups() {
    try {
      // KV doesn't have a list operation, so we'll track backup keys in a separate index
      const backupIndex =
        (await this.env.PALETTE_KV.get("grid_backup_index", {
          type: "json",
        })) || [];

      // Sort by timestamp descending and keep only the 10 most recent
      backupIndex.sort((a, b) => b - a);

      if (backupIndex.length > 10) {
        const toDelete = backupIndex.slice(10);

        // Delete old backups from KV
        const deletePromises = toDelete.map((timestamp) =>
          this.env.PALETTE_KV.delete(`grid_backup_${timestamp}`),
        );
        await Promise.all(deletePromises);

        // Update the index
        const updatedIndex = backupIndex.slice(0, 10);
        await this.env.PALETTE_KV.put(
          "grid_backup_index",
          JSON.stringify(updatedIndex),
        );

        console.log(`Cleaned up ${toDelete.length} old backups`);
      }
    } catch (error) {
      console.error("Backup cleanup failed:", error);
    }
  }

  // Start backup interval when users are active
  startBackupInterval() {
    if (this.backupInterval) {
      return;
    }

    this.backupInterval = setInterval(async () => {
      // Only backup if there are active users and changes were made
      if (this.sessions.size > 0 && this.pixelChangesSinceBackup) {
        await this.createGridBackup();
      }
    }, 60000); // Every minute

    console.log("Backup interval started");
  }

  // Stop backup interval
  stopBackupInterval() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      console.log("Backup interval stopped");
    }
  }

  // Log grid corruption events to analytics and Discord webhook
  async logCorruptionEvent(eventData) {
    try {
      const timestamp = eventData.detectionTime || Date.now();
      const backupInfo = await this.getLastBackupInfo();

      // Calculate backup age if available
      let backupAgeMinutes = 0;
      if (backupInfo?.timestamp) {
        backupAgeMinutes = Math.round(
          (timestamp - backupInfo.timestamp) / (1000 * 60),
        );
      }

      // Log to analytics database
      observeGridCorruption(this.env, {
        corruption_type: eventData.corruptionType,
        detection_method: "auto_detection",
        recovery_status: eventData.recoveryStatus,
        backup_timestamp: backupInfo?.metadata?.createdAt || "none",
        corruption_reason: eventData.error || "unknown",
        pixels_before_corruption: eventData.pixelsBefore || 0,
        pixels_after_recovery: eventData.pixelsAfter || 0,
        backup_age_minutes: backupAgeMinutes,
        detection_time_ms: timestamp,
        recovery_time_ms: Date.now() - timestamp,
      });

      // Send Discord webhook notification
      await this.sendCorruptionWebhook(eventData, backupInfo, backupAgeMinutes);
    } catch (error) {
      console.error("Failed to log corruption event:", error);
    }
  }

  // Get information about the last backup
  async getLastBackupInfo() {
    try {
      return await this.env.PALETTE_KV.get("grid_backup_latest", {
        type: "json",
      });
    } catch (error) {
      console.error("Failed to get last backup info:", error);
      return null;
    }
  }

  // Send Discord webhook for grid corruption events
  async sendCorruptionWebhook(eventData, backupInfo, backupAgeMinutes) {
    if (!this.env.DISCORD_WEBHOOK_URL) return;

    const isSuccess = eventData.recoveryStatus === "success";
    const embedColor = isSuccess ? 0x10b981 : 0xef4444; // Green for success, red for failure
    const statusEmoji = isSuccess ? "✅" : "❌";

    const fields = [
      {
        name: "Corruption Type",
        value: eventData.corruptionType.replace(/_/g, " ").toUpperCase(),
        inline: true,
      },
      {
        name: "Recovery Status",
        value: `${statusEmoji} ${eventData.recoveryStatus.toUpperCase()}`,
        inline: true,
      },
      {
        name: "Detection Time",
        value: `<t:${Math.floor((eventData.detectionTime || Date.now()) / 1000)}:F>`,
        inline: true,
      },
    ];

    if (eventData.pixelsBefore !== undefined) {
      fields.push({
        name: "Pixels Before",
        value: eventData.pixelsBefore.toString(),
        inline: true,
      });
    }

    if (eventData.pixelsAfter !== undefined) {
      fields.push({
        name: "Pixels After Recovery",
        value: eventData.pixelsAfter.toString(),
        inline: true,
      });
    }

    if (backupInfo) {
      fields.push({
        name: "Backup Used",
        value: `${backupAgeMinutes}min old (${backupInfo.metadata?.pixelCount || 0} pixels)`,
        inline: true,
      });
    }

    if (eventData.error) {
      fields.push({
        name: "Error Details",
        value: `\`\`\`${eventData.error.substring(0, 200)}\`\`\``,
        inline: false,
      });
    }

    const title = isSuccess
      ? "🛡️ Grid Corruption Detected & Recovered"
      : "⚠️ Grid Corruption Detected - Recovery Failed";

    const description = isSuccess
      ? "The grid corruption detection system automatically restored the grid from a recent backup."
      : "Grid corruption was detected but automatic recovery failed. Manual intervention may be required.";

    const webhookPayload = {
      embeds: [
        {
          title: title,
          description: description,
          color: embedColor,
          fields: fields,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Neuro.Place Grid Protection System",
          },
        },
      ],
    };

    try {
      await fetch(this.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      });
    } catch (error) {
      console.error("Failed to send corruption webhook:", error);
    }
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
