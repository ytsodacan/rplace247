const BACKEND_URL = `${window.location.origin}`;
const OAUTH_REDIRECT_URI = `${window.location.origin}/callback`;

(async () => {
	const params = new URLSearchParams(window.location.search);
	const code = params.get("code");
	if (!code) {
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
			console.error("Code:", code);
			console.error("Redirect URI:", OAUTH_REDIRECT_URI);
			throw new Error(`Discord auth failed: ${resp.status}`);
		}

		const { access_token, user } = await resp.json();
		localStorage.setItem("discord_token", access_token);
		localStorage.setItem("user_data", JSON.stringify(user));
	} catch (err) {
		console.error(err);
		alert("Discord authentication failed – please try again.");
	}

	window.location.replace("/");
})();
