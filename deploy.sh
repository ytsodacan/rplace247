#!/bin/bash

set -e
# fails if secrets aren't in env
if [ -z "$PROD_PALETTE_KV_ID" ]; then
  echo "Error: Environment variable PROD_PALETTE_KV_ID is not set." >&2
  exit 1
fi
if [ -z "$PROD_PALETTE_KV_PREVIEW_ID" ]; then
  echo "Error: Environment variable PROD_PALETTE_KV_PREVIEW_ID is not set." >&2
  exit 1
fi
if [ -z "$DEV_PALETTE_KV_ID" ]; then
  echo "Error: Environment variable DEV_PALETTE_KV_ID is not set." >&2
  exit 1
fi
# --- End Checks ---

# defaults to prod since that seems dumb enough for me to do
ENVIRONMENT="prod"
if [ -n "$1" ]; then
  ENVIRONMENT=$1
fi

echo "--- Preparing to deploy to the '$ENVIRONMENT' environment ---"

# Generate the wrangler.toml from the template version
sed \
  -e "s|__PALETTE_KV_ID__|${PROD_PALETTE_KV_ID}|g" \
  -e "s|__PALETTE_KV_PREVIEW_ID__|${PROD_PALETTE_KV_PREVIEW_ID}|g" \
  -e "s|__DEV_PALETTE_KV_ID__|${DEV_PALETTE_KV_ID}|g" \
  wrangler.toml.template > wrangler.toml

echo "Generated wrangler.toml from template."

if [ "$ENVIRONMENT" == "prod" ]; then
  echo "Deploying production worker..."
  npx wrangler deploy --env=""
elif [ "$ENVIRONMENT" == "dev" ]; then
  echo "Deploying dev worker..."
  npx wrangler deploy --env="dev"
else
  echo "Error: Unknown environment '$ENVIRONMENT'. Use 'prod' or 'dev'."
  rm wrangler.toml
  exit 1
fi

# deleetus the secret containing wrangler.toml
echo "Cleaning up generated files..."
rm wrangler.toml

echo "--- Deployment to '$ENVIRONMENT' complete! ---"
