const configElement = document.getElementById("config");
const configData = JSON.parse(configElement.textContent);

export const config = {
	backendUrl: configData.backendUrl,
	websocketUrl: configData.websocketUrl,
};
