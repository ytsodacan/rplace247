// Minimal standalone handler for Discord OAuth redirect
// This script is loaded only on /callback and performs the token
// exchange, then bounces the user back to the root of the app.

const BACKEND_URL = "https://place-worker.afunyun.workers.dev"; // keep in sync with script.js
const OAUTH_REDIRECT_URI = `${window.location.origin}/callback`;

(async () => {
	const params = new URLSearchParams(window.location.search);
	const code = params.get("code");
	if (!code) {
		// Nothing to do; just send them home.
		window.location.replace("/");
		return;
	}

	try {
		const resp = await fetch(`${BACKEND_URL}/auth/discord`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, redirect_uri: OAUTH_REDIRECT_URI }),
		});

		if (!resp.ok) {
			throw new Error(`Discord auth failed: ${resp.status}`);
		}

		const { access_token, user } = await resp.json();
		localStorage.setItem("discord_token", access_token);
		localStorage.setItem("user_data", JSON.stringify(user));
	} catch (err) {
		console.error(err);
		alert("Discord authentication failed – please try again.");
	}

	// Always return to the main application
	window.location.replace("/");
})();
