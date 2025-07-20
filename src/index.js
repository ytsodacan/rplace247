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
	"/admin/deployment/webhook",
	"/announcement",
	"/api/updates",
	"/api/active-users",
	"/admin/auth-check",
	"/admin/grid-snapshot",
	"/admin/connections-count",
	"/admin/pixel-log",
	"/admin/disconnect-session",
	"/admin/toast",
	"/admin/status-update",
	"/admin/pause-updates",
	"/admin/pause-status",
	"/admin/grid-manipulate",
	"/admin/grid-clear",
	"/api/status-message",
].forEach((p) =>
	app.all(p, (c) => {
		const stub = c.env.GRID_STATE.get(c.env.GRID_STATE.idFromName("global"));
		return stub.fetch(c.req.raw);
	}),
);

app.get("/dash.html", async (c) => {
	const token = extractBearerToken(c.req) || c.req.query("token");

	if (!token) {
		return c.redirect("/filtered.html", 302);
	}

	const user = await validateDiscordToken(token, c.env);
	if (!user) {
		return c.redirect("/filtered.html", 302);
	}

	const adminUserIds = await c.env.PALETTE_KV.get("admin_user_ids");
	const adminIds = adminUserIds ? JSON.parse(adminUserIds) : [];

	if (!adminIds.includes(user.id)) {
		return c.redirect("/filtered.html", 302);
	}

	return c.env.ASSETS.fetch(c.req.raw);
});

app.get("/static/js/dash.js", async (c) => {
	const token = extractBearerToken(c.req) || c.req.query("token");

	if (!token) {
		return c.text("Unauthorized", 401);
	}

	const user = await validateDiscordToken(token, c.env);
	if (!user) {
		return c.text("Unauthorized", 401);
	}

	const adminUserIds = await c.env.PALETTE_KV.get("admin_user_ids");
	const adminIds = adminUserIds ? JSON.parse(adminUserIds) : [];

	if (!adminIds.includes(user.id)) {
		return c.text("Forbidden", 403);
	}

	return c.env.ASSETS.fetch(c.req.raw);
});

app.get("/static/css/dash.css", async (c) => {
	const token = extractBearerToken(c.req) || c.req.query("token");

	if (!token) {
		return c.text("Unauthorized", 401);
	}

	const user = await validateDiscordToken(token, c.env);
	if (!user) {
		return c.text("Unauthorized", 401);
	}

	const adminUserIds = await c.env.PALETTE_KV.get("admin_user_ids");
	const adminIds = adminUserIds ? JSON.parse(adminUserIds) : [];

	if (!adminIds.includes(user.id)) {
		return c.text("Forbidden", 403);
	}

	return c.env.ASSETS.fetch(c.req.raw);
});

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
		this.lastPixelUpdateTime = 0;
		this.initialized = false;
		this.chunkCache = new Map();
		this.lastActiveUsersBroadcast = 0;
		this.pendingChunkSaves = new Set();
		this.saveTimeout = null;
		this.lastPlacementByUser = new Map();
		this.pixelPlacementLog = [];
		this.MAX_PIXEL_LOG_ENTRIES = 100;
		this.gridUpdatesPaused = false;
		this.statusPageMessage = "";

		for (const ws of state.getWebSockets()) {
			this.sessions.add(ws);
			try {
				const info = ws.deserializeAttachment?.();
				if (info?.isAdmin) {
					this.adminSessions.add(ws);
				}
			} catch {}
		}
	}

	async initialize() {
		if (this.initialized) return;

		await this.loadAdminUsers();
		await this.loadCurrentAnnouncement();
		await this.loadPixelLog();
		await this.loadGridUpdateStatus();
		await this.loadStatusPageMessage();

		this.initialized = true;
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

	async loadPixelLog() {
		try {
			this.pixelPlacementLog =
				(await this.state.storage.get("pixel_placement_log")) || [];
			console.log(
				"Loaded pixel placement log:",
				this.pixelPlacementLog.length,
				"entries",
			);
		} catch (error) {
			console.error("Error loading pixel placement log:", error);
			this.pixelPlacementLog = [];
		}
	}

	async loadGridUpdateStatus() {
		try {
			this.gridUpdatesPaused =
				(await this.state.storage.get("grid_updates_paused")) || false;
			console.log(
				"Loaded grid update status:",
				this.gridUpdatesPaused ? "paused" : "active",
			);
		} catch (error) {
			console.error("Error loading grid update status:", error);
			this.gridUpdatesPaused = false;
		}
	}

	async loadStatusPageMessage() {
		try {
			this.statusPageMessage =
				(await this.state.storage.get("status_page_message")) || "";
			console.log(
				"Loaded status page message:",
				this.statusPageMessage ? "present" : "none",
			);
		} catch (error) {
			console.error("Error loading status page message:", error);
			this.statusPageMessage = "";
		}
	}

	async savePixelLog() {
		try {
			await this.state.storage.put(
				"pixel_placement_log",
				this.pixelPlacementLog,
			);
		} catch (error) {
			console.error("Error saving pixel placement log:", error);
		}
	}

	async saveGridUpdateStatus() {
		try {
			await this.state.storage.put(
				"grid_updates_paused",
				this.gridUpdatesPaused,
			);
		} catch (error) {
			console.error("Error saving grid update status:", error);
		}
	}

	async saveStatusPageMessage() {
		try {
			await this.state.storage.put(
				"status_page_message",
				this.statusPageMessage,
			);
		} catch (error) {
			console.error("Error saving status page message:", error);
		}
	}

	addPixelLogEntry(entry) {
		this.pixelPlacementLog.unshift(entry);
		if (this.pixelPlacementLog.length > this.MAX_PIXEL_LOG_ENTRIES) {
			this.pixelPlacementLog = this.pixelPlacementLog.slice(
				0,
				this.MAX_PIXEL_LOG_ENTRIES,
			);
		}
		this.savePixelLog();
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
			this.logToConsole(
				"info",
				`User added to whitelist: ${username} (${userId})`,
			);
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
		this.logToConsole(
			"info",
			`Whitelist ${this.whitelistEnabled ? "enabled" : "disabled"}`,
		);
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
		if (!user) return true;

		await this.initializeWhitelist();

		if (this.isAdmin(user.id)) {
			return true;
		}

		if (!this.whitelistEnabled) {
			return true;
		}

		const isBlacklisted = await this.isWhitelisted(user.id);
		return !isBlacklisted;
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

		this.broadcastActiveUsers();
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

		this.broadcastActiveUsers();
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
		if (!this.initialized) {
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

			const blacklisted = await this.isWhitelisted(user.id);
			const isAdmin = this.isAdmin(user.id);

			return new Response(
				JSON.stringify({
					blacklisted,
					isAdmin,
					blacklistEnabled: this.whitelistEnabled,
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

				this.logToConsole(
					"info",
					`Admin broadcast sent by ${user.username}: ${message.trim()}`,
				);

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

				const chunkKey = `chunk:${chunkIndex}`;
				let chunkData = this.chunkCache.get(chunkKey);
				if (!chunkData) {
					const chunkStr = await this.env.PALETTE_KV.get(chunkKey);
					if (chunkStr) {
						try {
							const parsed = JSON.parse(chunkStr);
							if (Array.isArray(parsed) && parsed.length === chunkSize) {
								chunkData = parsed;
							}
						} catch {}
					}
					if (!chunkData) {
						chunkData = Array(chunkSize)
							.fill(0)
							.map(() => Array(500).fill("#FFFFFF"));
					}
					this.chunkCache.set(chunkKey, chunkData);
				}

				return new Response(
					JSON.stringify({
						chunk: chunkIndex,
						totalChunks,
						startRow: chunkIndex * chunkSize,
						endRow: Math.min((chunkIndex + 1) * chunkSize, 500),
						data: chunkData,
					}),
					{
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
							"Cache-Control":
								"no-store, no-cache, must-revalidate, proxy-revalidate",
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
				if (this.gridUpdatesPaused) {
					return new Response(
						JSON.stringify({
							message: "Grid updates are currently paused by administrators",
						}),
						{ status: 503, headers: corsHeaders },
					);
				}

				const token = extractBearerToken(request);
				let user = null;

				if (token) {
					user = await validateDiscordToken(token, this.env);
					if (!user) {
						return new Response(
							JSON.stringify({ message: "Invalid or expired token" }),
							{ status: 401, headers: corsHeaders },
						);
					}
				}

				const canPlace = await this.canPlacePixel(user);
				if (!canPlace) {
					await this.initializeWhitelist();
					const reason = this.whitelistEnabled
						? "You are blacklisted from placing pixels"
						: "Access denied";
					return new Response(JSON.stringify({ message: reason }), {
						status: 403,
						headers: corsHeaders,
					});
				}

				const requestText = await request.text();
				console.log("Raw request body:", requestText);
				console.log("Request body length:", requestText.length);

				const requestData = JSON.parse(requestText);
				console.log("Parsed request data:", requestData);
				const { x, y, color } = requestData;

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

				const requesterKey = user
					? user.id
					: request.headers.get("x-session-id") ||
						request.headers.get("cf-connecting-ip") ||
						"anonymous";
				const nowTs = Date.now();
				if (!this.isAdmin(requesterKey)) {
					const lastTs = this.lastPlacementByUser.get(requesterKey) || 0;
					if (nowTs - lastTs < 2000) {
						return new Response(
							JSON.stringify({
								message:
									"Rate limit exceeded: please wait 2 seconds between placements.",
							}),
							{ status: 429, headers: corsHeaders },
						);
					}
				}
				this.lastPlacementByUser.set(requesterKey, nowTs);

				const chunkIndex = Math.floor(y / 50);
				const rowInChunk = y % 50;
				const chunkKey = `chunk:${chunkIndex}`;

				let chunkArr = this.chunkCache.get(chunkKey);
				if (!chunkArr) {
					const existingChunkStr = await this.env.PALETTE_KV.get(chunkKey);
					if (existingChunkStr) {
						try {
							const parsed = JSON.parse(existingChunkStr);
							if (Array.isArray(parsed) && parsed.length === 50) {
								chunkArr = parsed;
							}
						} catch {}
					}
					if (!chunkArr) {
						chunkArr = Array(50)
							.fill(0)
							.map(() => Array(500).fill("#FFFFFF"));
					}
				}

				chunkArr[rowInChunk][x] = color;
				this.chunkCache.set(chunkKey, chunkArr);
				this.scheduleChunkSave(chunkKey);

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
					user: user ? { id: user.id, username: user.username } : null,
				});

				this.addPixelLogEntry({
					x,
					y,
					color: parseInt(color.replace("#", ""), 16),
					timestamp: Date.now(),
					sessionId: user
						? user.id
						: requestData.sessionId ||
							request.headers.get("x-session-id") ||
							"anonymous",
					inputMethod:
						requestData.inputMethod ||
						request.headers.get("x-input-method") ||
						"click",
					username: user ? user.username : "anonymous",
				});

				this.logToConsole(
					"info",
					`Pixel placed at (${x}, ${y}) by ${user ? user.username : "anonymous"}`,
					{
						x,
						y,
						color,
						user: user ? user.username : "anonymous",
					},
				);

				try {
					await this.sendDiscordWebhook(x, y, color, user);
				} catch (webhookError) {
					console.error("Discord webhook failed:", webhookError);
				}

				if (user) {
					this.observeUserActivity(
						user.id,
						user.username,
						detectDevice(request.headers.get("user-agent")),
					);
					this.observePixels(user.id, user.username);
				}

				observePixels(this.env, {
					event_type: "pixel_placement",
					device_type: detectDevice(request.headers.get("user-agent")),
					input_method: request.headers.get("x-input-method") || "unknown",
					auth_status: user ? "authenticated" : "anonymous",
					user_type: user
						? this.isAdmin(user.id)
							? "admin"
							: (await this.isWhitelisted(user.id))
								? "whitelisted"
								: "public"
						: "anonymous",
					session_id: request.headers.get("x-session-id") || "unknown",
					x_coordinate: x,
					y_coordinate: y,
					time_to_first_placement:
						Date.now() - parseInt(request.headers.get("x-timestamp"), 10),
					session_duration:
						parseInt(request.headers.get("x-session-duration"), 10) || 0,
					placement_count:
						parseInt(request.headers.get("x-placement-count"), 10) || 1,
					user_id: user ? user.id : "anonymous",
				});

				return new Response(JSON.stringify({ message: "Pixel updated" }), {
					status: 200,
					headers: corsHeaders,
				});
			} catch (error) {
				console.error("Error processing pixel request:", error);
				return new Response(
					JSON.stringify({ message: "Invalid JSON", error: error.message }),
					{
						status: 400,
						headers: corsHeaders,
					},
				);
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

				const gridData = backupData.data;
				let updateCount = 0;

				for (let chunkIndex = 0; chunkIndex < 10; chunkIndex++) {
					const start = chunkIndex * 50;
					const chunkRows = gridData.slice(start, start + 50);
					const chunkKey = `chunk:${chunkIndex}`;
					this.chunkCache.set(chunkKey, chunkRows);
					await this.env.PALETTE_KV.put(chunkKey, JSON.stringify(chunkRows));
					updateCount += chunkRows.flat().filter((c) => c !== "#FFFFFF").length;
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
				const blankChunk = Array(50)
					.fill(0)
					.map(() => Array(500).fill("#FFFFFF"));
				const blankChunkStr = JSON.stringify(blankChunk);
				for (let chunkIndex = 0; chunkIndex < 10; chunkIndex++) {
					const chunkKey = `chunk:${chunkIndex}`;
					this.chunkCache.set(chunkKey, blankChunk);
					await this.env.PALETTE_KV.put(chunkKey, blankChunkStr);
				}

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

		if (
			url.pathname === "/admin/deployment/webhook" &&
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
				const deploymentInfo = await request.json();

				const webhookData = {
					environment: deploymentInfo.environment || "production",
					workerName: deploymentInfo.workerName || "place-worker",
					version: deploymentInfo.version,
					deployedBy: user.username,
					...deploymentInfo,
				};

				await this.sendDeploymentWebhook(webhookData);

				console.log(`Deployment webhook sent by ${user.username}`);
				this.logToConsole(
					"info",
					`Deployment webhook sent by ${user.username}`,
					webhookData,
				);

				return new Response(
					JSON.stringify({
						success: true,
						message: "Deployment webhook sent successfully",
						deploymentInfo: webhookData,
						timestamp: new Date().toISOString(),
					}),
					{ headers: corsHeaders },
				);
			} catch (error) {
				console.error("Deployment webhook error:", error);
				return new Response(
					JSON.stringify({
						success: false,
						message: "Error sending deployment webhook.",
					}),
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		if (url.pathname === "/admin/auth-check" && request.method === "GET") {
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

			const isAdmin = this.isAdmin(user.id);
			if (!isAdmin) {
				return new Response(
					JSON.stringify({ message: "Admin access required" }),
					{ status: 403, headers: corsHeaders },
				);
			}

			return new Response(JSON.stringify({ isAdmin: true }), {
				headers: corsHeaders,
			});
		}

		if (url.pathname === "/admin/grid-snapshot" && request.method === "GET") {
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
						{ status: 400, headers: corsHeaders },
					);
				}

				const chunkKey = `chunk:${chunkIndex}`;
				let chunkData = this.chunkCache.get(chunkKey);
				if (!chunkData) {
					const chunkStr = await this.env.PALETTE_KV.get(chunkKey);
					if (chunkStr) {
						try {
							const parsed = JSON.parse(chunkStr);
							if (Array.isArray(parsed) && parsed.length === chunkSize) {
								chunkData = parsed;
							}
						} catch {}
					}
					if (!chunkData) {
						chunkData = Array(chunkSize)
							.fill(0)
							.map(() => Array(500).fill("#FFFFFF"));
					}
					this.chunkCache.set(chunkKey, chunkData);
				}

				return new Response(
					JSON.stringify({
						chunk: chunkIndex,
						totalChunks,
						startRow: chunkIndex * chunkSize,
						endRow: Math.min((chunkIndex + 1) * chunkSize, 500),
						data: chunkData,
					}),
					{ headers: corsHeaders },
				);
			} else {
				const chunks = [];
				for (let i = 0; i < totalChunks; i++) {
					const chunkKey = `chunk:${i}`;
					let chunkData = this.chunkCache.get(chunkKey);
					if (!chunkData) {
						const chunkStr = await this.env.PALETTE_KV.get(chunkKey);
						if (chunkStr) {
							try {
								const parsed = JSON.parse(chunkStr);
								if (Array.isArray(parsed) && parsed.length === chunkSize) {
									chunkData = parsed;
								}
							} catch {}
						}
						if (!chunkData) {
							chunkData = Array(chunkSize)
								.fill(0)
								.map(() => Array(500).fill("#FFFFFF"));
						}
						this.chunkCache.set(chunkKey, chunkData);
					}

					const flatPixels = [];
					for (const row of chunkData) {
						for (const color of row) {
							const colorInt =
								typeof color === "string"
									? parseInt(color.replace("#", ""), 16)
									: color;
							flatPixels.push(colorInt);
						}
					}

					chunks.push({
						startIdx: i * chunkSize * 500,
						pixels: flatPixels,
					});
				}

				return new Response(
					JSON.stringify({
						chunks: chunks,
						gridSize: 500,
					}),
					{ headers: corsHeaders },
				);
			}
		}

		if (
			url.pathname === "/admin/connections-count" &&
			request.method === "GET"
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

			return new Response(JSON.stringify({ count: this.sessions.size }), {
				headers: corsHeaders,
			});
		}

		if (url.pathname === "/admin/pixel-log" && request.method === "GET") {
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

			const limit = Math.min(
				parseInt(url.searchParams.get("limit")) || 50,
				100,
			);
			const logSlice = this.pixelPlacementLog.slice(0, limit);

			return new Response(JSON.stringify({ log: logSlice }), {
				headers: corsHeaders,
			});
		}

		if (
			url.pathname === "/admin/disconnect-session" &&
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
				const { sessionId } = await request.json();
				if (!sessionId) {
					return new Response(
						JSON.stringify({ message: "Session ID is required" }),
						{ status: 400, headers: corsHeaders },
					);
				}

				console.log(
					`Admin ${user.username} requested disconnect of session: ${sessionId}`,
				);
				this.logToConsole(
					"info",
					`Session disconnect requested by ${user.username}: ${sessionId}`,
				);

				return new Response(
					JSON.stringify({
						success: true,
						message: "Session disconnect requested",
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

		if (url.pathname === "/admin/toast" && request.method === "POST") {
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

				this.logToConsole(
					"info",
					`Toast message sent by ${user.username}: ${message.trim()}`,
				);

				return new Response(
					JSON.stringify({ success: true, message: "Toast sent successfully" }),
					{ headers: corsHeaders },
				);
			} catch {
				return new Response(JSON.stringify({ message: "Invalid JSON" }), {
					status: 400,
					headers: corsHeaders,
				});
			}
		}

		if (url.pathname === "/admin/status-update" && request.method === "POST") {
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
				const { message } = await request.json();
				this.statusPageMessage = message ? message.trim() : "";
				await this.saveStatusPageMessage();

				this.logToConsole(
					"info",
					`Status page message updated by ${user.username}`,
				);

				return new Response(
					JSON.stringify({ success: true, message: "Status message updated" }),
					{ headers: corsHeaders },
				);
			} catch {
				return new Response(JSON.stringify({ message: "Invalid JSON" }), {
					status: 400,
					headers: corsHeaders,
				});
			}
		}

		if (url.pathname === "/admin/pause-updates" && request.method === "POST") {
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
				const { pause } = await request.json();
				this.gridUpdatesPaused = Boolean(pause);
				await this.saveGridUpdateStatus();

				this.broadcast({
					type: "grid_pause_status",
					paused: this.gridUpdatesPaused,
					timestamp: Date.now(),
				});

				this.logToConsole(
					"info",
					`Grid updates ${this.gridUpdatesPaused ? "paused" : "resumed"} by ${user.username}`,
				);

				return new Response(
					JSON.stringify({ success: true, paused: this.gridUpdatesPaused }),
					{ headers: corsHeaders },
				);
			} catch {
				return new Response(JSON.stringify({ message: "Invalid JSON" }), {
					status: 400,
					headers: corsHeaders,
				});
			}
		}

		if (url.pathname === "/admin/pause-status" && request.method === "GET") {
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
				JSON.stringify({ updatesPaused: this.gridUpdatesPaused }),
				{ headers: corsHeaders },
			);
		}

		if (
			url.pathname === "/admin/grid-manipulate" &&
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
				const { action, x, y, color } = await request.json();

				if (action === "set_pixel") {
					if (
						x == null ||
						y == null ||
						color == null ||
						x < 0 ||
						x >= 500 ||
						y < 0 ||
						y >= 500
					) {
						return new Response(
							JSON.stringify({ message: "Invalid coordinates or color" }),
							{ status: 400, headers: corsHeaders },
						);
					}

					const chunkIndex = Math.floor(y / 50);
					const rowInChunk = y % 50;
					const chunkKey = `chunk:${chunkIndex}`;
					const colorHex =
						typeof color === "number"
							? `#${color.toString(16).padStart(6, "0").toUpperCase()}`
							: color;

					let chunkArr = this.chunkCache.get(chunkKey);
					if (!chunkArr) {
						const existingChunkStr = await this.env.PALETTE_KV.get(chunkKey);
						if (existingChunkStr) {
							try {
								const parsed = JSON.parse(existingChunkStr);
								if (Array.isArray(parsed) && parsed.length === 50) {
									chunkArr = parsed;
								}
							} catch {}
						}
						if (!chunkArr) {
							chunkArr = Array(50)
								.fill(0)
								.map(() => Array(500).fill("#FFFFFF"));
						}
					}

					chunkArr[rowInChunk][x] = colorHex;
					this.chunkCache.set(chunkKey, chunkArr);
					this.scheduleChunkSave(chunkKey);

					this.broadcast({
						type: "pixelUpdate",
						x,
						y,
						color: colorHex,
						user: { id: user.id, username: user.username },
					});

					this.addPixelLogEntry({
						x,
						y,
						color:
							typeof color === "number"
								? color
								: parseInt(colorHex.replace("#", ""), 16),
						timestamp: Date.now(),
						sessionId: `admin:${user.id}`,
						inputMethod: "admin_action",
						username: user.username,
					});

					this.logToConsole(
						"info",
						`Admin pixel manipulation by ${user.username}: (${x}, ${y}) = ${colorHex}`,
					);

					return new Response(
						JSON.stringify({
							success: true,
							message: "Pixel set successfully",
						}),
						{ headers: corsHeaders },
					);
				}

				return new Response(JSON.stringify({ message: "Unknown action" }), {
					status: 400,
					headers: corsHeaders,
				});
			} catch {
				return new Response(JSON.stringify({ message: "Invalid JSON" }), {
					status: 400,
					headers: corsHeaders,
				});
			}
		}

		if (url.pathname === "/api/status-message" && request.method === "GET") {
			return new Response(JSON.stringify({ message: this.statusPageMessage }), {
				headers: corsHeaders,
			});
		}

		return new Response("Not Found", { status: 404 });
	}

	async handleWebSocket(webSocket) {
		this.state.acceptWebSocket(webSocket);

		this.sessions.add(webSocket);
	}

	async webSocketMessage(ws, message) {
		this.sessions.add(ws);

		try {
			const data = JSON.parse(
				typeof message === "string"
					? message
					: new TextDecoder().decode(message),
			);

			if (data.type === "ping") {
				ws.send(JSON.stringify({ type: "pong" }));
				return;
			}

			if (data.type === "admin_console_subscribe") {
				const user = data.token
					? await validateDiscordToken(data.token, this.env)
					: null;
				if (user && this.isAdmin(user.id)) {
					this.adminSessions.add(ws);
					try {
						ws.serializeAttachment?.({ isAdmin: true, user: user.username });
					} catch {}
					this.logToConsole(
						"info",
						`Admin console connected: ${user.username}`,
					);
					this.broadcastActiveUsers(true);
				}
				return;
			}

			if (data.type === "admin_console_unsubscribe") {
				this.adminSessions.delete(ws);
			}
		} catch {}
	}

	async webSocketClose(ws) {
		this.sessions.delete(ws);
		this.adminSessions.delete(ws);
	}

	async webSocketError(ws) {
		this.sessions.delete(ws);
		this.adminSessions.delete(ws);
	}

	broadcast(message) {
		const messageStr = JSON.stringify(message);
		for (const ws of this.state.getWebSockets()) {
			try {
				ws.send(messageStr);
			} catch {}
		}
	}

	/**
	 * Broadcast a real-time snapshot of active users over WebSocket.
	 * This is sent primarily to admin sessions so that the dashboard can
	 * update without polling. To avoid unnecessary wake-ups, we throttle
	 * the broadcast to at most once every 5 seconds unless `force` is true.
	 */
	broadcastActiveUsers(force = false) {
		const now = Date.now();
		if (!force && now - this.lastActiveUsersBroadcast < 5000) {
			return;
		}

		this.lastActiveUsersBroadcast = now;

		const payload = {
			type: "activeUsers",
			activeUsers: this.getActiveUsers(),
			timestamp: now,
		};

		const messageStr = JSON.stringify(payload);

		const targets =
			this.adminSessions.size > 0
				? this.adminSessions
				: this.state.getWebSockets();

		for (const ws of targets) {
			try {
				ws.send(messageStr);
			} catch {}
		}
	}

	logToConsole(level, message, data = null) {
		const logMessage = {
			type: "console_log",
			level: level,
			message: message,
			data: data,
			timestamp: Date.now(),
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
		if (!this.env.DISCORD_WEBHOOK_URL) {
			console.log("No Discord webhook URL configured, skipping webhook");
			return;
		}

		try {
			new URL(this.env.DISCORD_WEBHOOK_URL);
		} catch (urlError) {
			console.error(
				"Invalid DISCORD_WEBHOOK_URL:",
				this.env.DISCORD_WEBHOOK_URL,
			);
			console.error("URL validation error:", urlError);
			return;
		}

		try {
			console.log("Discord webhook URL:", this.env.DISCORD_WEBHOOK_URL);
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

			console.log("Discord webhook sent successfully");
		} catch (error) {
			console.error("Error in sendDiscordWebhook:", error);
			throw error;
		}
	}

	async sendDeploymentWebhook(deploymentInfo) {
		const webhookUrl =
			this.env.DISCORD_DEPLOYMENT_WEBHOOK_URL || this.env.DISCORD_WEBHOOK_URL;
		if (!webhookUrl) {
			console.error("No deployment webhook URL configured");
			return;
		}

		try {
			new URL(webhookUrl);
		} catch (urlError) {
			console.error("Invalid deployment webhook URL:", webhookUrl);
			console.error("URL validation error:", urlError);
			return;
		}

		const fields = [
			{
				name: "Environment",
				value: deploymentInfo.environment || "production",
				inline: true,
			},
			{
				name: "Deployed At",
				value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
				inline: true,
			},
			{
				name: "Worker Name",
				value: deploymentInfo.workerName || "place-worker",
				inline: true,
			},
		];

		if (deploymentInfo.version) {
			fields.push({
				name: "Version",
				value: deploymentInfo.version,
				inline: true,
			});
		}

		if (deploymentInfo.deployedBy) {
			fields.push({
				name: "Deployed By",
				value: deploymentInfo.deployedBy,
				inline: true,
			});
		}

		const webhookPayload = {
			embeds: [
				{
					title: "🚀 Worker Deployed Successfully!",
					description:
						"A new build has been deployed to the place-worker instance.",
					color: 0x00ff00,
					fields,
					timestamp: new Date().toISOString(),
					footer: {
						text: "Neuro.Place Deployment System",
					},
				},
			],
		};

		try {
			await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(webhookPayload),
			});
		} catch (error) {
			console.error("Failed to send deployment webhook:", error);
		}
	}

	scheduleChunkSave(chunkKey) {
		this.pendingChunkSaves.add(chunkKey);
		if (this.saveTimeout) return;
		this.saveTimeout = setTimeout(async () => {
			const chunks = Array.from(this.pendingChunkSaves);
			this.pendingChunkSaves.clear();
			this.saveTimeout = null;
			for (const key of chunks) {
				const data = this.chunkCache.get(key);
				if (!data) continue;
				try {
					await this.env.PALETTE_KV.put(key, JSON.stringify(data));
				} catch (err) {
					console.error("Batched KV PUT failed:", key, err);
				}
			}
		}, 2000);
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
