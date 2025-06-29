// load config from external json file
let configData;
try {
    const response = await fetch('./config.json');
    configData = await response.json();
} catch (error) {
    console.error('Failed to load config.json, falling back to embedded config:', error);
    // fallback to embedded config if json file fails
    const configElement = document.getElementById("config");
    configData = configElement ? JSON.parse(configElement.textContent) : {
        // If no config is embedded, fall back to same-origin endpoints so that the
        // frontend keeps working when it is served by the backend itself
        // (Cloudflare tunnel, ngrok, etc.) and no CORS is needed. Developers can
        // still override these values through config.json or an inline <script>
        // tag with id="config" if they need to talk to a remote service.
        backendUrl: window?.location?.origin ?? "",
        websocketUrl: window?.location?.origin ?? ""
    };
}

export const config = {
    backendUrl: configData.backendUrl,
    websocketUrl: configData.websocketUrl,
};
