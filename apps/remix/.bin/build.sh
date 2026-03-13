#!/usr/bin/env bash

# Exit on error.
set -e

SCRIPT_DIR="$(readlink -f "$(dirname "$0")")"
WEB_APP_DIR="$SCRIPT_DIR/.."

# Store the original directory
ORIGINAL_DIR=$(pwd)

# Set up trap to ensure we return to original directory
trap 'cd "$ORIGINAL_DIR"' EXIT

cd "$WEB_APP_DIR"

start_time=$(date +%s)

echo "[Build]: Extracting and compiling translations"
npm run translate --prefix ../../

echo "[Build]: Building app"
# Typecheck is skipped inside Docker (DOCKER_OUTPUT=1) because:
# - react-router typegen can fail in the pruned monorepo context
# - type errors are caught earlier in the CI pipeline before docker build runs
# - skipping saves ~60-90 seconds per Docker build
if [ -n "$DOCKER_OUTPUT" ]; then
  cross-env NODE_ENV=production react-router build
else
  npm run build:app
fi

echo "[Build]: Building server"
npm run build:server

# Copy over the entry point for the server.
cp server/main.js build/server/main.js

# Copy over all web.js translations (for rollup hono bundle)
cp -r ../../packages/lib/translations build/server/hono/packages/lib/translations

# Copy over all web.js translations (for Vite/RR7 server bundle at build/server/assets/)
cp -r ../../packages/lib/translations build/server/translations

# Time taken
end_time=$(date +%s)

echo "[Build]: Done in $((end_time - start_time)) seconds"