#!/usr/bin/env node

/**
 * Post-deployment script that sends a webhook notification to Discord
 * when the place-worker is successfully deployed.
 */

const environment = process.argv[2] || "production";
const workerName = environment === "dev" ? "place-worker-dev" : "place-worker";
const baseUrl =
  environment === "dev"
    ? "https://dev.neurosama.place"
    : "https://neurosama.place";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_DEPLOYMENT_WEBHOOK_URL =
  process.env.DISCORD_DEPLOYMENT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
const DEPLOYMENT_VERSION = process.env.DEPLOYMENT_VERSION || "funyun?";
const DEPLOYED_BY = process.env.DEPLOYED_BY || "CLI";

async function sendDeploymentWebhook() {
  console.log(
    `Sending deployment webhook for ${workerName} (${environment})...`,
  );

  try {
    if (DISCORD_TOKEN) {
      const response = await fetch(`${baseUrl}/admin/deployment/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DISCORD_TOKEN}`,
        },
        body: JSON.stringify({
          environment,
          workerName,
          version: DEPLOYMENT_VERSION,
          deployedBy: DEPLOYED_BY,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log("✅ Deployment webhook sent successfully:", result.message);
      } else {
        const error = await response.json();
        console.error("❌ Failed to send deployment webhook:", error.message);
      }
    } else if (DISCORD_DEPLOYMENT_WEBHOOK_URL) {
      const webhookUrl = DISCORD_DEPLOYMENT_WEBHOOK_URL;

      const webhookPayload = {
        embeds: [
          {
            title: "neuroHYPERS - Place Worker Deployed Successfully!",
            description: "A new build has been deployed.",
            color: 0x00ff00,
            fields: [
              { name: "Environment", value: environment, inline: true },
              {
                name: "Deployed At",
                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                inline: true,
              },
              { name: "Worker Name", value: workerName, inline: true },
              { name: "Version", value: DEPLOYMENT_VERSION, inline: true },
              { name: "Deployed By", value: DEPLOYED_BY, inline: true },
            ],
            timestamp: new Date().toISOString(),
            footer: {
              text: "Neurosama.place Deployments",
            },
          },
        ],
      };

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      });

      if (response.ok) {
        console.log(
          "✅ Deployment webhook sent successfully via direct Discord API",
        );
      } else {
        console.error(
          "❌ Failed to send deployment webhook via Discord API:",
          response.status,
        );
      }
    } else {
      console.log(
        "⚠️  No Discord deployment webhook configured. Set DISCORD_TOKEN or DISCORD_DEPLOYMENT_WEBHOOK_URL environment variable.",
      );
    }
  } catch (error) {
    console.error("❌ Error sending deployment webhook:", error.message);
  }
}

setTimeout(sendDeploymentWebhook, 2000);
