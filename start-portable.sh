#!/usr/bin/env sh
set -e

echo "Starting Synod Portable App..."

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker Desktop is not running. Please start Docker Desktop and try again."
  exit 1
fi

# Copy .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created default .env file."
fi

# Ensure storage directories exist locally
mkdir -p ./data/anythingllm_storage

# Launch services
docker compose up -d

echo "Services started successfully!"
echo "Synod Dashboard is running at: http://localhost:3000"
echo "AnythingLLM API is running at: http://localhost:3001"

# Automatically seed the 4 role workspaces in AnythingLLM
echo "Configuring default AnythingLLM workspaces..."
node scripts/setup-anythingllm-workspaces.js || true

# Open in browser
(open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true)

