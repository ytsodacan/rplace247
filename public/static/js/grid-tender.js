/**
 * GridTender - Enhanced grid management with Discord authentication and whitelist system
 * Integrates with the existing neuro.place pixel canvas
 */

class GridTender {
	constructor(options = {}) {
		this.backendUrl = options.backendUrl || window.location.origin;
		this.adminUserIds = options.adminUserIds || []; // Discord user IDs who can manage whitelist
		this.whitelistEnabled = options.whitelistEnabled !== false; // Enable whitelist by default
		this.debugMode = options.debugMode !== false;

		// Authentication state
		this.userToken = null;
		this.userData = null;
		this.isAuthenticated = false;
		this.isWhitelisted = false;
		this.isAdmin = false;

		// UI elements
		this.statusElement = null;
		this.adminPanelElement = null;
		this.adminToggleBtn = null;
		this.isAdminPanelCollapsed = true; // Start collapsed
		this.adminPanelPosition = { x: 0, y: 0 }; // Will be centered on first show
		this.isDragging = false;
		this.dragOffset = { x: 0, y: 0 };

		this.init();
	}

	/**
	 * Initialize GridTender
	 */
	async init() {
		this.log("Initializing GridTender...");

		// Load authentication state
		await this.loadAuthState();

		this.log(
			"After loadAuthState - isAuthenticated:",
			this.isAuthenticated,
			"userData:",
			this.userData,
		);

		// Store initial state for comparison
		this.previousAuthState = this.isAuthenticated;
		this.previousWhitelistState = this.isWhitelisted;

		// Create UI elements
		this.createUI();

		// Check whitelist status if authenticated
		if (this.isAuthenticated) {
			this.log("User is authenticated, checking whitelist status...");
			await this.checkWhitelistStatus();
		} else {
			this.log("User is NOT authenticated, skipping whitelist check");
		}

		// Set up event listeners
		this.setupEventListeners();

		// Load current announcement
		await this.loadCurrentAnnouncement();

		this.log("GridTender initialized successfully");
	}

	/**
	 * Load authentication state from localStorage
	 */
	async loadAuthState() {
		// Store previous state for comparison
		const previousAuth = this.isAuthenticated;

		this.userToken = localStorage.getItem("discord_token");
		const userDataStr = localStorage.getItem("user_data");

		this.log(
			"Loading auth state - token:",
			!!this.userToken,
			"userData:",
			!!userDataStr,
		);

		if (this.userToken && userDataStr) {
			try {
				this.userData = JSON.parse(userDataStr);
				this.isAuthenticated = true;
				// Admin status will be determined by the backend via checkWhitelistStatus
				this.log("Authentication state loaded", this.userData);
			} catch (error) {
				this.log("Error parsing user data", error);
				this.clearAuthState();
			}
		} else {
			this.log("No authentication data found in localStorage");
			this.isAuthenticated = false;
			this.userData = null;
			this.isWhitelisted = false;
			this.isAdmin = false;
		}

		// Check for authentication status changes
		if (
			this.previousAuthState !== undefined &&
			previousAuth !== this.isAuthenticated
		) {
			if (this.isAuthenticated) {
				this.showToast(`Welcome, ${this.userData.username}!`, "success");
			} else {
				this.showToast("Logged out", "info");
			}
		}

		// Update the previous state for next time
		this.previousAuthState = this.isAuthenticated;

		// If we just became authenticated, check whitelist status
		if (this.isAuthenticated && !previousAuth) {
			await this.checkWhitelistStatus();
		} else if (!this.isAuthenticated) {
			// Update UI immediately if logged out
			this.updateUI();
		}
	}

	/**
	 * Clear authentication state
	 */
	
	clearAuthState() {
		this.userToken = null;
		this.userData = null;
		this.isAuthenticated = false;
		this.isWhitelisted = false;
		this.isAdmin = false;
		localStorage.removeItem("discord_token");
		localStorage.removeItem("user_data");
	}

	/**
	 * Check if current user is whitelisted
	 */
	async checkWhitelistStatus() {
		if (!this.isAuthenticated) {
			this.isWhitelisted = false;
			this.isAdmin = false;
			return false;
		}

		// Store previous whitelist state for comparison
		const previousWhitelist = this.isWhitelisted;
		const previousAdmin = this.isAdmin;

		try {
			console.log(
				"[GridTender] Checking whitelist status for user:",
				this.userData,
			);
			const response = await fetch(`${this.backendUrl}/whitelist/status`, {
				headers: {
					Authorization: `Bearer ${this.userToken}`,
					"Content-Type": "application/json",
				},
			});

			console.log("[GridTender] Whitelist status response:", response.status);

			if (response.ok) {
				const data = await response.json();
				console.log("[GridTender] Whitelist status data:", data);

				this.isWhitelisted = data.whitelisted;
				this.isAdmin = data.isAdmin || false; // Get admin status from backend
				this.whitelistEnabled = data.whitelistEnabled;

				this.log(
					"Whitelist status:",
					this.isWhitelisted,
					"Admin:",
					this.isAdmin,
				);

				// Create admin panel if user is admin and it doesn't exist yet
				if (this.isAdmin && !this.adminPanelElement) {
					this.createAdminPanel();
					this.addStyles(); // Re-add styles to include admin panel
				}

				// Check for whitelist status changes and show appropriate toasts
				if (this.previousWhitelistState !== undefined) {
					if (this.isAdmin && !previousAdmin) {
						this.showToast("Admin access granted", "success");
					} else if (
						this.isWhitelisted &&
						!previousWhitelist &&
						!this.isAdmin
					) {
						this.showToast("Whitelist access granted", "success");
					} else if (
						!this.isWhitelisted &&
						previousWhitelist &&
						this.whitelistEnabled
					) {
						this.showToast("Access denied - not whitelisted", "error");
					}
				}

				// Update previous state
				this.previousWhitelistState = this.isWhitelisted;
			} else {
				const errorText = await response.text();
				console.error(
					"[GridTender] Failed to check whitelist status:",
					response.status,
					errorText,
				);
				this.log("Failed to check whitelist status:", response.status);
				this.isWhitelisted = false;
				this.isAdmin = false;
			}
		} catch (error) {
			console.error("[GridTender] Error checking whitelist status:", error);
			this.log("Error checking whitelist status:", error);
			this.isWhitelisted = false;
			this.isAdmin = false;
		}

		this.updateUI();
		return this.isWhitelisted;
	}

	/**
	 * Check if user can place pixels
	 */
	canPlacePixel() {
		if (!this.isAuthenticated) {
			return { allowed: false, reason: "Not authenticated" };
		}

		if (this.whitelistEnabled && !this.isWhitelisted && !this.isAdmin) {
			return { allowed: false, reason: "Not whitelisted" };
		}

		return { allowed: true, reason: "Authorized" };
	}

	/**
	 * Enhanced pixel placement with whitelist checking
	 */
	async placePixel(x, y, color) {
		const canPlace = this.canPlacePixel();

		if (!canPlace.allowed) {
			this.showMessage(`Cannot place pixel: ${canPlace.reason}`, "error");
			return { success: false, message: canPlace.reason };
		}

		try {
			const response = await fetch(`${this.backendUrl}/pixel`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ x, y, color }),
			});

			const result = await response.json();

			if (response.ok) {
				this.showMessage("Pixel placed successfully!", "success");
				return { success: true, message: result.message };
			} else {
				this.showMessage(`Failed to place pixel: ${result.message}`, "error");
				return { success: false, message: result.message };
			}
		} catch (error) {
			this.log("Error placing pixel:", error);
			this.showMessage("Network error occurred", "error");
			return { success: false, message: "Network error" };
		}
	}

	/**
	 * Get whitelist (admin only)
	 */
	async getWhitelist() {
		if (!this.isAdmin) {
			throw new Error("Admin access required");
		}

		try {
			const response = await fetch(`${this.backendUrl}/admin/whitelist`, {
				headers: {
					Authorization: `Bearer ${this.userToken}`,
					"Content-Type": "application/json",
				},
			});

			if (response.ok) {
				return await response.json();
			} else {
				throw new Error(`Failed to get whitelist: ${response.status}`);
			}
		} catch (error) {
			this.log("Error getting whitelist:", error);
			throw error;
		}
	}

	/**
	 * Add user to whitelist (admin only)
	 */
	async addToWhitelist(userId, username = null) {
		if (!this.isAdmin) {
			throw new Error("Admin access required");
		}

		try {
			const response = await fetch(`${this.backendUrl}/admin/whitelist/add`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ userId, username }),
			});

			const result = await response.json();

			if (response.ok) {
				this.showMessage(
					`User ${username || userId} added to whitelist`,
					"success",
				);
				await this.updateWhitelistUI();
				return result;
			} else {
				throw new Error(result.message || "Failed to add user to whitelist");
			}
		} catch (error) {
			this.log("Error adding to whitelist:", error);
			this.showMessage(`Error: ${error.message}`, "error");
			throw error;
		}
	}

	/**
	 * Remove user from whitelist (admin only)
	 */
	async removeFromWhitelist(userId) {
		if (!this.isAdmin) {
			throw new Error("Admin access required");
		}

		try {
			const response = await fetch(
				`${this.backendUrl}/admin/whitelist/remove`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.userToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ userId }),
				},
			);

			const result = await response.json();

			if (response.ok) {
				this.showMessage(`User removed from whitelist`, "success");
				await this.updateWhitelistUI();
				return result;
			} else {
				throw new Error(
					result.message || "Failed to remove user from whitelist",
				);
			}
		} catch (error) {
			this.log("Error removing from whitelist:", error);
			this.showMessage(`Error: ${error.message}`, "error");
			throw error;
		}
	}

	/**
	 * Toggle whitelist system (admin only)
	 */
	async toggleWhitelist() {
		if (!this.isAdmin) {
			throw new Error("Admin access required");
		}

		try {
			const response = await fetch(
				`${this.backendUrl}/admin/whitelist/toggle`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.userToken}`,
						"Content-Type": "application/json",
					},
				},
			);

			const result = await response.json();

			if (response.ok) {
				this.whitelistEnabled = result.enabled;
				this.showMessage(
					`Whitelist ${result.enabled ? "enabled" : "disabled"}`,
					"success",
				);
				this.updateUI();
				return result;
			} else {
				throw new Error(result.message || "Failed to toggle whitelist");
			}
		} catch (error) {
			this.log("Error toggling whitelist:", error);
			this.showMessage(`Error: ${error.message}`, "error");
			throw error;
		}
	}

	/**
	 * Create UI elements
	 */
	createUI() {
		// Use existing status element in the HTML instead of creating new one
		this.statusElement = document.getElementById("gridTenderStatus");

		// Get the admin toggle button from the header
		this.adminToggleBtn = document.getElementById("adminToggleBtn");

		// Admin panel will be created later when admin status is confirmed from backend

		// Add styles and update UI
		this.addStyles();
		this.updateUI();
	}

	/**
	 * Create admin panel
	 */
	createAdminPanel() {
		this.adminPanelElement = document.createElement("div");
		this.adminPanelElement.id = "gridAdmin";
		this.adminPanelElement.className = "grid-admin floating-panel hidden";
		this.adminPanelElement.innerHTML = `
            <div class="admin-header draggable-handle">
                <h3>Grid Admin</h3>
                <div class="admin-header-controls">
                    <button id="minimizeAdminPanel" class="btn-icon" title="Minimize">
                        <span class="material-icons-round">minimize</span>
                    </button>
                    <button id="closeAdminPanel" class="btn-icon" title="Close">
                        <span class="material-icons-round">close</span>
                    </button>
                </div>
            </div>
            <div class="admin-content" id="adminContent">
                <div class="admin-section">
                    <h4>Whitelist Management</h4>
                    <div class="whitelist-controls">
                        <button id="toggleWhitelistBtn" class="btn btn-secondary">
                            ${this.whitelistEnabled ? "Disable" : "Enable"} Whitelist
                        </button>
                        <button id="refreshWhitelistBtn" class="btn btn-secondary">Refresh List</button>
                    </div>
                    <div class="add-user-form">
                        <h5>Add User to Whitelist</h5>
                        <input type="text" id="userIdInput" placeholder="Discord User ID" class="form-input">
                        <input type="text" id="usernameInput" placeholder="Username (optional)" class="form-input">
                        <button id="addUserBtn" class="btn btn-primary">Add User</button>
                    </div>
                    <div class="whitelist-list">
                        <h5>Current Whitelist</h5>
                        <div id="whitelistContainer" class="whitelist-container">
                            Loading...
                        </div>
                    </div>
                </div>
                <div class="admin-section">
                    <h4>Broadcast & Announcements</h4>
                    <div class="broadcast-controls">
                        <h5>Send Broadcast Message</h5>
                        <textarea id="broadcastMessageInput" placeholder="Enter message to broadcast to all users..." class="form-textarea" rows="3"></textarea>
                        <div class="broadcast-options">
                            <select id="broadcastTypeSelect" class="form-select">
                                <option value="info">Info</option>
                                <option value="success">Success</option>
                                <option value="warning">Warning</option>
                                <option value="error">Error</option>
                            </select>
                            <button id="sendBroadcastBtn" class="btn btn-primary">Send Broadcast</button>
                        </div>
                    </div>
                    <div class="announcement-controls">
                        <h5>Site Announcement</h5>
                        <input type="text" id="announcementInput" placeholder="Enter site announcement..." class="form-input" maxlength="100">
                        <div class="announcement-actions">
                            <button id="updateAnnouncementBtn" class="btn btn-primary">Update Announcement</button>
                            <button id="clearAnnouncementBtn" class="btn btn-secondary">Clear</button>
                        </div>
                    </div>
                </div>
                <div class="admin-section">
                    <h4>Grid Backup and Restore</h4>
                    <div class="backup-controls">
                        <button id="createBackupBtn" class="btn btn-primary">Create Backup</button>
                        <button id="downloadBackupBtn" class="btn btn-secondary">Download Backup</button>
                        <button id="uploadBackupBtn" class="btn btn-secondary">Restore from Backup</button>
                        <button id="clearGridBtn" class="btn btn-danger">Clear Grid</button>
                    </div>
                </div>
                <div class="admin-section">
                    <h4>Server Console</h4>
                    <div class="console-controls">
                        <button id="openConsoleWindowBtn" class="btn btn-secondary">Open Console Window</button>
                        <span class="console-status" id="consoleStatus">Disconnected</span>
                    </div>
                </div>
            </div>        `;

		// Setup dragging functionality
		this.setupDragging();
	}

	/**
	 * Insert UI elements into the page
	 */
	/**
	 * Add CSS styles for GridTender UI
	 */
	addStyles() {
		// Insert admin panel if it exists
		if (this.adminPanelElement) {
			document.body.appendChild(this.adminPanelElement);
		}

		const style = document.createElement("style");
		style.textContent = `
            .grid-tender-status-inline {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .status-label-small {
                font-size: 11px;
                font-weight: 500;
                color: var(--text-muted, #9ca3af);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .grid-tender-status-inline .status-value {
                font-size: 13px;
                font-weight: 500;
                color: var(--text-secondary, #6b7280);
            }

            .grid-tender-status-inline .status-value.success {
                color: var(--success, #10b981);
            }

            .grid-tender-status-inline .status-value.error {
                color: var(--error, #ef4444);
            }

            .grid-tender-status-inline .status-value.warning {
                color: var(--warning, #f59e0b);
            }

            .grid-tender-toast {
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--bg-secondary, #ffffff);
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                border-radius: 8px;
                padding: 16px 20px;
                box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1));
                z-index: 10000;
                min-width: 300px;
                max-width: 400px;
                opacity: 0;
                transform: translateX(100%);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .grid-tender-toast.show {
                opacity: 1;
                transform: translateX(0);
            }

            .grid-tender-toast.success {
                border-left: 4px solid var(--success, #10b981);
            }

            .grid-tender-toast.error {
                border-left: 4px solid var(--error, #ef4444);
            }

            .grid-tender-toast.warning {
                border-left: 4px solid var(--warning, #f59e0b);
            }

            .grid-tender-toast.info {
                border-left: 4px solid var(--accent, #6366f1);
            }

            .toast-content {
                display: flex;
                align-items: flex-start;
                gap: 12px;
            }

            .toast-icon {
                width: 20px;
                height: 20px;
                flex-shrink: 0;
                margin-top: 2px;
            }

            .toast-message {
                flex: 1;
                color: var(--text-primary, #1f2937);
                font-weight: 500;
                line-height: 1.4;
            }

            .toast-close {
                background: none;
                border: none;
                color: var(--text-muted, #9ca3af);
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
                padding: 0;
                margin-left: 8px;
            }

            .toast-close:hover {
                color: var(--text-secondary, #6b7280);
            }

            .grid-admin {
                position: fixed;
                background: var(--glass-bg, rgba(255, 255, 255, 0.95));
                backdrop-filter: blur(10px);
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                border-radius: 12px;
                box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1));
                z-index: 1000;
                width: 420px;
                max-width: 90vw;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
            }

            .grid-admin.floating-panel {
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                transition: opacity 0.3s ease, transform 0.3s ease;
            }

            .grid-admin.hidden {
                opacity: 0;
                pointer-events: none;
                transform: translate(-50%, -50%) scale(0.95);
            }

            @media (min-width: 1024px) {
                .grid-admin {
                    width: 500px;
                    max-height: 70vh;
                }
            }

            @media (max-width: 640px) {
                .grid-admin {
                    width: 95vw;
                    max-height: 85vh;
                }
            }

            .admin-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                cursor: grab;
                user-select: none;
            }

            .admin-header:active {
                cursor: grabbing;
            }

            .admin-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: var(--text-primary, #1f2937);
                pointer-events: none;
            }

            .admin-header-controls {
                display: flex;
                gap: 4px;
            }

            .btn-icon {
                background: none;
                border: none;
                border-radius: 6px;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: var(--text-secondary, #6b7280);
                transition: all 0.2s;
            }

            .btn-icon:hover {
                background: var(--bg-tertiary, #f5f5f5);
                color: var(--text-primary, #1f2937);
            }

            .btn-icon .material-icons-round {
                font-size: 18px;
            }

            .admin-content {
                padding: 16px;
                overflow-y: auto;
                flex: 1;
            }

            .admin-section h4 {
                margin: 0 0 12px 0;
                font-size: 14px;
                font-weight: 600;
                color: var(--text-primary, #1f2937);
            }

            .admin-section h5 {
                margin: 16px 0 8px 0;
                font-size: 13px;
                font-weight: 500;
                color: var(--text-secondary, #6b7280);
            }

            .whitelist-controls, .backup-controls {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
                flex-wrap: wrap;
            }

            .broadcast-controls, .announcement-controls {
                margin-bottom: 16px;
            }

            .broadcast-options, .announcement-actions {
                display: flex;
                gap: 8px;
                margin-top: 8px;
                align-items: center;
                flex-wrap: wrap;
            }

            .broadcast-options .form-select {
                margin: 0;
                min-width: 100px;
            }

            .add-user-form {
                margin-bottom: 16px;
            }

            .form-input {
                width: 100%;
                padding: 8px 12px;
                margin: 4px 0;
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                border-radius: 6px;
                font-size: 14px;
                background: var(--bg-secondary, #ffffff);
                color: var(--text-primary, #1f2937);
            }

            .form-textarea {
                width: 100%;
                padding: 8px 12px;
                margin: 4px 0;
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                border-radius: 6px;
                font-size: 14px;
                background: var(--bg-secondary, #ffffff);
                color: var(--text-primary, #1f2937);
                resize: vertical;
                min-height: 60px;
                font-family: inherit;
            }

            .form-select {
                padding: 8px 12px;
                margin: 4px 0;
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                border-radius: 6px;
                font-size: 14px;
                background: var(--bg-secondary, #ffffff);
                color: var(--text-primary, #1f2937);
                cursor: pointer;
            }

            .form-input:focus,
            .form-textarea:focus,
            .form-select:focus {
                outline: none;
                border-color: var(--accent, #6366f1);
                box-shadow: 0 0 0 2px var(--accent, #6366f1)20;
            }

            .btn {
                padding: 8px 16px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }

            .btn-primary {
                background: var(--accent, #6366f1);
                color: white;
            }

            .btn-primary:hover {
                background: var(--accent-hover, #5855eb);
            }

            .btn-secondary {
                background: var(--bg-tertiary, #f5f5f5);
                color: var(--text-primary, #1f2937);
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
            }

            .btn-secondary:hover {
                background: var(--border-hover, rgba(0, 0, 0, 0.05));
            }

            .btn-danger {
                background: var(--error, #ef4444);
                color: white;
            }

            .btn-danger:hover {
                background: #dc2626;
            }

            .whitelist-container {
                max-height: 200px;
                overflow-y: auto;
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                border-radius: 6px;
                background: var(--bg-secondary, #ffffff);
            }

            .whitelist-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.05));
            }

            .whitelist-item:last-child {
                border-bottom: none;
            }

            .user-info {
                flex: 1;
                min-width: 0;
            }

            .user-name {
                font-weight: 500;
                color: var(--text-primary, #1f2937);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .user-id {
                font-size: 12px;
                color: var(--text-muted, #9ca3af);
                font-family: monospace;
            }

            /* Improved logout button styling */
            #logoutBtn {
                background: var(--error, #ef4444);
                color: white;
                padding: 8px 16px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                margin-left: 8px;
            }

            #logoutBtn:hover {
                background: #dc2626;
                transform: translateY(-1px);
            }

            /* Site announcement banner */
            .site-announcement {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: var(--glass-bg, rgba(255, 255, 255, 0.9));
                backdrop-filter: blur(10px);
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
                border-radius: 20px;
                padding: 8px 16px;
                font-size: 14px;
                font-weight: 500;
                color: var(--text-primary, #1f2937);
                max-width: 300px;
                text-align: center;
                opacity: 0;
                transition: all 0.3s ease;
                pointer-events: none;
                z-index: 45;
            }

            .site-announcement.show {
                opacity: 1;
                pointer-events: auto;
            }

            .site-announcement.animate {
                animation: announcementPulse 2s ease-in-out;
            }

            @keyframes announcementPulse {
                0%, 100% { transform: translate(-50%, -50%) scale(1); }
                50% { transform: translate(-50%, -50%) scale(1.05); }
            }
        `;
		document.head.appendChild(style);
	}

	/**
	 * Set up event listeners
	 */
	setupEventListeners() {
		// Admin toggle button in header
		if (this.adminToggleBtn) {
			this.adminToggleBtn.addEventListener("click", () => {
				this.toggleAdminPanel();
			});
		}

		// Admin panel controls
		const minimizeBtn = document.getElementById("minimizeAdminPanel");
		if (minimizeBtn) {
			minimizeBtn.addEventListener("click", () => {
				this.toggleAdminPanel();
			});
		}

		const closeBtn = document.getElementById("closeAdminPanel");
		if (closeBtn) {
			closeBtn.addEventListener("click", () => {
				this.isAdminPanelCollapsed = true;
				this.adminPanelElement.classList.add("hidden");
			});
		}

		// Whitelist controls
		const toggleWhitelistBtn = document.getElementById("toggleWhitelistBtn");
		if (toggleWhitelistBtn) {
			toggleWhitelistBtn.addEventListener("click", () => {
				this.toggleWhitelist();
			});
		}

		const refreshWhitelistBtn = document.getElementById("refreshWhitelistBtn");
		if (refreshWhitelistBtn) {
			refreshWhitelistBtn.addEventListener("click", () => {
				this.updateWhitelistUI();
			});
		}

		// Add user form
		const addUserBtn = document.getElementById("addUserBtn");
		if (addUserBtn) {
			addUserBtn.addEventListener("click", () => {
				const userIdInput = document.getElementById("userIdInput");
				const usernameInput = document.getElementById("usernameInput");

				const userId = userIdInput.value.trim();
				const username = usernameInput.value.trim();

				if (userId) {
					this.addToWhitelist(userId, username || null);
					userIdInput.value = "";
					usernameInput.value = "";
				}
			});
		}

		// Backup and restore controls
		const createBackupBtn = document.getElementById("createBackupBtn");
		if (createBackupBtn) {
			createBackupBtn.addEventListener("click", async () => {
				try {
					await this.createGridBackup().createBackup();
					this.showMessage("Backup created successfully!", "success");
				} catch (error) {
					this.showMessage(
						`Failed to create backup: ${error.message}`,
						"error",
					);
				}
			});
		}

		const downloadBackupBtn = document.getElementById("downloadBackupBtn");
		if (downloadBackupBtn) {
			downloadBackupBtn.addEventListener("click", () => {
				this.createGridBackup().downloadBackup();
			});
		}

		const uploadBackupBtn = document.getElementById("uploadBackupBtn");
		if (uploadBackupBtn) {
			uploadBackupBtn.addEventListener("click", () => {
				this.createGridBackup().uploadAndRestore();
			});
		}

		const clearGridBtn = document.getElementById("clearGridBtn");
		if (clearGridBtn) {
			clearGridBtn.addEventListener("click", () => {
				this.createGridBackup().clearGrid();
			});
		}

		// Broadcast controls
		const sendBroadcastBtn = document.getElementById("sendBroadcastBtn");
		if (sendBroadcastBtn) {
			sendBroadcastBtn.addEventListener("click", () => {
				this.sendBroadcastMessage();
			});
		}

		// Announcement controls
		const updateAnnouncementBtn = document.getElementById(
			"updateAnnouncementBtn",
		);
		if (updateAnnouncementBtn) {
			updateAnnouncementBtn.addEventListener("click", () => {
				this.updateAnnouncement();
			});
		}

		const clearAnnouncementBtn = document.getElementById(
			"clearAnnouncementBtn",
		);
		if (clearAnnouncementBtn) {
			clearAnnouncementBtn.addEventListener("click", () => {
				this.clearAnnouncement();
			});
		}

		// Listen for authentication changes
		window.addEventListener("storage", (e) => {
			if (e.key === "discord_token" || e.key === "user_data") {
				this.loadAuthState();
				this.updateUI();
				if (this.isAuthenticated) {
					this.checkWhitelistStatus();
				}
			}
		});
	}

	/**
	 * Update UI based on current state
	 */
	updateUI() {
		this.log(
			"updateUI called - isAuthenticated:",
			this.isAuthenticated,
			"userData:",
			this.userData,
		);

		const authStatusText = document.getElementById("authStatusText");

		if (authStatusText) {
			if (this.isAuthenticated) {
				if (this.isAdmin) {
					authStatusText.textContent = `✓ ${this.userData.username} (Admin)`;
					authStatusText.className = "status-value success";
				} else if (this.whitelistEnabled && this.isWhitelisted) {
					authStatusText.textContent = `✓ ${this.userData.username} (Whitelisted)`;
					authStatusText.className = "status-value success";
				} else if (this.whitelistEnabled && !this.isWhitelisted) {
					authStatusText.textContent = `✓ ${this.userData.username} (No Access)`;
					authStatusText.className = "status-value warning";
				} else {
					authStatusText.textContent = `✓ ${this.userData.username}`;
					authStatusText.className = "status-value success";
				}
			} else {
				authStatusText.textContent = "✗ Not authenticated";
				authStatusText.className = "status-value error";
			}
			this.log("Updated authStatusText to:", authStatusText.textContent);
		} else {
			this.log("authStatusText element not found!");
		}

		// Show/hide admin toggle button
		if (this.adminToggleBtn) {
			if (this.isAdmin) {
				this.adminToggleBtn.classList.remove("hidden");
			} else {
				this.adminToggleBtn.classList.add("hidden");
				// Also hide admin panel if user is no longer admin
				if (this.adminPanelElement) {
					this.adminPanelElement.classList.add("hidden");
					this.isAdminPanelCollapsed = true;
				}
			}
		}

		// Update admin panel if it exists
		if (this.isAdmin) {
			this.updateWhitelistUI();
		}
	}

	/**
	 * Update whitelist UI (admin only)
	 */
	async updateWhitelistUI() {
		if (!this.isAdmin) return;

		const toggleBtn = document.getElementById("toggleWhitelistBtn");
		if (toggleBtn) {
			toggleBtn.textContent = this.whitelistEnabled
				? "Disable Whitelist"
				: "Enable Whitelist";
		}

		try {
			const whitelist = await this.getWhitelist();
			this.renderWhitelistItems(whitelist.users || []);
		} catch (error) {
			this.log("Error updating whitelist UI:", error);
		}
	}

	/**
	 * Render whitelist items
	 */
	renderWhitelistItems(users) {
		const container = document.getElementById("whitelistContainer");
		if (!container) return;

		if (users.length === 0) {
			container.innerHTML =
				'<div style="padding: 16px; text-align: center; color: var(--text-muted);">No users whitelisted</div>';
			return;
		}

		container.innerHTML = users
			.map(
				(user) => `
            <div class="whitelist-item">
                <div class="user-info">
                    <div class="user-name">${user.username || "Unknown"}</div>
                    <div class="user-id">${user.id}</div>
                </div>
                <button class="btn btn-danger" onclick="gridTender.removeFromWhitelist('${user.id}')">
                    Remove
                </button>
            </div>
        `,
			)
			.join("");
	}

	/**
	 * Show toast notification
	 */
	showToast(message, type = "info", duration = 4000) {
		this.log("showToast called:", message, type);
		const toast = document.createElement("div");
		toast.className = `grid-tender-toast ${type}`;

		// Create toast content with icon
		const icons = {
			success: "✓",
			error: "✗",
			warning: "⚠",
			info: "ℹ",
		};

		toast.innerHTML = `
            <div class="toast-content">
                <span class="toast-icon">${icons[type] || icons.info}</span>
                <div class="toast-message">${message}</div>
                <button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

		document.body.appendChild(toast);

		// Trigger animation
		setTimeout(() => {
			toast.classList.add("show");
		}, 10);

		// Auto remove
		setTimeout(() => {
			toast.classList.remove("show");
			setTimeout(() => {
				if (toast.parentNode) {
					toast.parentNode.removeChild(toast);
				}
			}, 300);
		}, duration);
	}

	/**
	 * Show message popup (kept for backward compatibility)
	 */
	showMessage(message, type = "info") {
		this.showToast(message, type);
	}

	/**
	 * Log debug messages
	 */
	log(...args) {
		if (this.debugMode) {
			console.log("[GridTender]", ...args);
		}
	}

	/**
	 * Get current instance
	 */
	static getInstance() {
		return window.gridTender;
	}

	/**
	 * Send broadcast message to all users (admin only)
	 */
	async sendBroadcastMessage() {
		if (!this.isAdmin) {
			throw new Error("Admin access required");
		}

		const messageInput = document.getElementById("broadcastMessageInput");
		const typeSelect = document.getElementById("broadcastTypeSelect");

		if (!messageInput || !typeSelect) return;

		const message = messageInput.value.trim();
		const type = typeSelect.value;

		if (!message) {
			this.showMessage("Please enter a message to broadcast", "warning");
			return;
		}

		try {
			const response = await fetch(`${this.backendUrl}/admin/broadcast`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ message, type }),
			});

			const result = await response.json();

			if (response.ok) {
				this.showMessage("Broadcast sent successfully!", "success");
				messageInput.value = ""; // Clear the input
			} else {
				throw new Error(result.message || "Failed to send broadcast");
			}
		} catch (error) {
			this.log("Error sending broadcast:", error);
			this.showMessage(`Error: ${error.message}`, "error");
		}
	}

	/**
	 * Update site announcement (admin only)
	 */
	async updateAnnouncement() {
		if (!this.isAdmin) {
			throw new Error("Admin access required");
		}

		const announcementInput = document.getElementById("announcementInput");
		if (!announcementInput) return;

		const announcement = announcementInput.value.trim();

		try {
			const response = await fetch(`${this.backendUrl}/admin/announcement`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ announcement }),
			});

			const result = await response.json();

			if (response.ok) {
				this.showMessage("Announcement updated successfully!", "success");
				this.updateAnnouncementDisplay(announcement);
			} else {
				throw new Error(result.message || "Failed to update announcement");
			}
		} catch (error) {
			this.log("Error updating announcement:", error);
			this.showMessage(`Error: ${error.message}`, "error");
		}
	}

	/**
	 * Clear site announcement (admin only)
	 */
	async clearAnnouncement() {
		if (!this.isAdmin) {
			throw new Error("Admin access required");
		}

		try {
			const response = await fetch(`${this.backendUrl}/admin/announcement`, {
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${this.userToken}`,
					"Content-Type": "application/json",
				},
			});

			const result = await response.json();

			if (response.ok) {
				this.showMessage("Announcement cleared successfully!", "success");
				this.updateAnnouncementDisplay("");
				const announcementInput = document.getElementById("announcementInput");
				if (announcementInput) announcementInput.value = "";
			} else {
				throw new Error(result.message || "Failed to clear announcement");
			}
		} catch (error) {
			this.log("Error clearing announcement:", error);
			this.showMessage(`Error: ${error.message}`, "error");
		}
	}

	/**
	 * Update the announcement display
	 */
	updateAnnouncementDisplay(announcement) {
		let announcementEl = document.getElementById("siteAnnouncement");

		if (!announcementEl) {
			// Create announcement element if it doesn't exist
			announcementEl = document.createElement("div");
			announcementEl.id = "siteAnnouncement";
			announcementEl.className = "site-announcement";

			// Add it to the header
			const header = document.querySelector(".header .container");
			if (header) {
				header.appendChild(announcementEl);
			}
		}

		if (announcement?.trim()) {
			announcementEl.textContent = announcement;
			announcementEl.classList.add("show", "animate");

			// Remove animation class after animation completes
			setTimeout(() => {
				announcementEl.classList.remove("animate");
			}, 2000);
		} else {
			announcementEl.classList.remove("show", "animate");
			setTimeout(() => {
				announcementEl.textContent = "";
			}, 300);
		}
	}

	/**
	 * Handle incoming broadcast messages
	 */
	handleBroadcastMessage(data) {
		this.showToast(data.message, data.type || "info", data.duration || 5000);
	}

	/**
	 * Load current announcement on initialization
	 */
	async loadCurrentAnnouncement() {
		try {
			const response = await fetch(`${this.backendUrl}/announcement`);
			if (response.ok) {
				const result = await response.json();
				if (result.announcement) {
					this.updateAnnouncementDisplay(result.announcement);

					// Update the input field if user is admin
					if (this.isAdmin) {
						const announcementInput =
							document.getElementById("announcementInput");
						if (announcementInput) {
							announcementInput.value = result.announcement;
						}
					}
				}
			}
		} catch (error) {
			this.log("Error loading current announcement:", error);
		}
	}

	/**
	 * Create a GridBackup instance for the current GridTender
	 */
	createGridBackup() {
		return new GridBackup(this);
	}

	/**
	 * Setup dragging functionality for the admin panel
	 */
	setupDragging() {
		if (!this.adminPanelElement) return;

		const handle = this.adminPanelElement.querySelector(".draggable-handle");
		if (!handle) return;

		handle.addEventListener("mousedown", (e) => {
			this.isDragging = true;
			const rect = this.adminPanelElement.getBoundingClientRect();
			this.dragOffset.x = e.clientX - rect.left;
			this.dragOffset.y = e.clientY - rect.top;

			handle.style.cursor = "grabbing";

			// Use arrow functions to maintain 'this' context
			const handleDrag = (e) => this.handleDrag(e);
			const handleDragEnd = () => this.handleDragEnd(handleDrag, handleDragEnd);

			document.addEventListener("mousemove", handleDrag);
			document.addEventListener("mouseup", handleDragEnd);
			e.preventDefault();
		});
	}

	/**
	 * Handle dragging movement
	 */
	handleDrag(e) {
		if (!this.isDragging || !this.adminPanelElement) return;

		const x = e.clientX - this.dragOffset.x;
		const y = e.clientY - this.dragOffset.y;

		// Constrain to viewport
		const rect = this.adminPanelElement.getBoundingClientRect();
		const maxX = window.innerWidth - rect.width;
		const maxY = window.innerHeight - rect.height;

		const constrainedX = Math.max(0, Math.min(x, maxX));
		const constrainedY = Math.max(0, Math.min(y, maxY));

		this.adminPanelPosition.x = constrainedX;
		this.adminPanelPosition.y = constrainedY;

		// Remove the CSS transform and use absolute positioning
		this.adminPanelElement.style.transform = "none";
		this.adminPanelElement.style.left = `${constrainedX}px`;
		this.adminPanelElement.style.top = `${constrainedY}px`;
	}

	/**
	 * Handle drag end
	 */
	handleDragEnd(handleDrag, handleDragEnd) {
		this.isDragging = false;
		const handle = this.adminPanelElement?.querySelector(".draggable-handle");
		if (handle) {
			handle.style.cursor = "grab";
		}
		document.removeEventListener("mousemove", handleDrag);
		document.removeEventListener("mouseup", handleDragEnd);
	}

	/**
	 * Center the admin panel on screen
	 */
	centerAdminPanel() {
		if (!this.adminPanelElement) return;

		const rect = this.adminPanelElement.getBoundingClientRect();
		const x = (window.innerWidth - rect.width) / 2;
		const y = (window.innerHeight - rect.height) / 2;

		this.adminPanelPosition.x = x;
		this.adminPanelPosition.y = y;

		// Use absolute positioning instead of transform
		this.adminPanelElement.style.transform = "none";
		this.adminPanelElement.style.left = `${x}px`;
		this.adminPanelElement.style.top = `${y}px`;
	}

	/**
	 * Toggle admin panel visibility
	 */
	toggleAdminPanel() {
		if (!this.adminPanelElement) return;

		this.isAdminPanelCollapsed = !this.isAdminPanelCollapsed;

		if (this.isAdminPanelCollapsed) {
			this.adminPanelElement.classList.add("hidden");
		} else {
			this.adminPanelElement.classList.remove("hidden");
			// Center on first show if not positioned yet
			if (this.adminPanelPosition.x === 0 && this.adminPanelPosition.y === 0) {
				setTimeout(() => this.centerAdminPanel(), 10);
			}
		}
	}
}

/**
 * Grid backup and restore functionality for GridTender
 */

class GridBackup {
	constructor(gridTender) {
		this.gridTender = gridTender;
		this.backendUrl = gridTender.backendUrl;
	}

	/**
	 * Create a backup of the current grid
	 */
	async createBackup() {
		if (!this.gridTender.isAdmin) {
			throw new Error("Admin access required");
		}

		try {
			// Get grid data
			const response = await fetch(`${this.backendUrl}/grid`);
			if (!response.ok) {
				throw new Error("Failed to fetch grid data");
			}

			const metadata = await response.json();
			const grid = Array(500)
				.fill(0)
				.map(() => Array(500).fill("#FFFFFF"));

			// Load all chunks
			for (
				let chunkIndex = 0;
				chunkIndex < metadata.totalChunks;
				chunkIndex++
			) {
				const chunkResponse = await fetch(
					`${this.backendUrl}/grid?chunk=${chunkIndex}`,
				);
				if (!chunkResponse.ok) {
					throw new Error(`Failed to load chunk ${chunkIndex}`);
				}
				const chunkData = await chunkResponse.json();

				// Copy chunk data into the grid
				for (let localRow = 0; localRow < chunkData.data.length; localRow++) {
					const globalRow = chunkData.startRow + localRow;
					if (globalRow < 500) {
						grid[globalRow] = chunkData.data[localRow];
					}
				}
			}

			// Create backup object
			const backup = {
				timestamp: new Date().toISOString(),
				version: "1.0",
				gridWidth: 500,
				gridHeight: 500,
				data: grid,
				metadata: {
					totalPixels: grid.flat().filter((color) => color !== "#FFFFFF")
						.length,
					createdBy: this.gridTender.userData?.username || "unknown",
					createdById: this.gridTender.userData?.id || "unknown",
				},
			};

			return backup;
		} catch (error) {
			console.error("Error creating backup:", error);
			throw error;
		}
	}

	/**
	 * Download backup as JSON file
	 */
	async downloadBackup() {
		try {
			const backup = await this.createBackup();
			const dataStr = JSON.stringify(backup, null, 2);
			const dataBlob = new Blob([dataStr], { type: "application/json" });

			const url = URL.createObjectURL(dataBlob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `grid-backup-${new Date().toISOString().split("T")[0]}.json`;
			link.click();

			URL.revokeObjectURL(url);
			this.gridTender.showMessage(
				"Grid backup downloaded successfully!",
				"success",
			);
		} catch (error) {
			this.gridTender.showMessage(
				`Failed to download backup: ${error.message}`,
				"error",
			);
			throw error;
		}
	}

	/**
	 * Restore grid from backup data
	 */
	async restoreFromBackup(backupData) {
		if (!this.gridTender.isAdmin) {
			throw new Error("Admin access required");
		}

		try {
			// Validate backup data
			if (!backupData.data || !Array.isArray(backupData.data)) {
				throw new Error("Invalid backup data format");
			}

			// Send the entire backup data to the backend
			const response = await fetch(`${this.backendUrl}/admin/grid/restore`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.gridTender.userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(backupData),
			});

			const result = await response.json();

			if (response.ok) {
				this.gridTender.showMessage(
					"Grid restored successfully from backup!",
					"success",
				);
				return result;
			} else {
				throw new Error(result.message || "Failed to restore grid from backup");
			}
		} catch (error) {
			this.gridTender.showMessage(
				`Failed to restore backup: ${error.message}`,
				"error",
			);
			throw error;
		}
	}

	/**
	 * Upload and restore backup from file
	 */
	uploadAndRestore() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = async (e) => {
			const file = e.target.files[0];
			if (!file) return;

			if (
				!confirm(
					"Are you sure you want to restore the grid from this backup? This will overwrite the current grid.",
				)
			) {
				return;
			}

			try {
				const text = await file.text();
				const backupData = JSON.parse(text);
				await this.restoreFromBackup(backupData);
			} catch (error) {
				this.gridTender.showMessage(
					`Error processing backup file: ${error.message}`,
					"error",
				);
			}
		};
		input.click();
	}

	/**
	 * Clear the entire grid (admin only)
	 */
	async clearGrid() {
		if (!this.gridTender.isAdmin) {
			throw new Error("Admin access required");
		}

		if (
			!confirm(
				"Are you sure you want to clear the entire grid? This action cannot be undone.",
			)
		) {
			return;
		}

		try {
			const response = await fetch(`${this.backendUrl}/admin/grid/clear`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.gridTender.userToken}`,
					"Content-Type": "application/json",
				},
			});

			const result = await response.json();

			if (response.ok) {
				this.gridTender.showMessage("Grid cleared successfully!", "success");
				return result;
			} else {
				throw new Error(result.message || "Failed to clear grid");
			}
		} catch (error) {
			this.gridTender.showMessage(
				`Failed to clear grid: ${error.message}`,
				"error",
			);
			throw error;
		}
	}
}

// Create and expose GridTender instance
window.GridTender = GridTender;
