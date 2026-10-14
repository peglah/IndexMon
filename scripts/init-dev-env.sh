#!/bin/sh
# Initialize backend/.env from root .env.example for local dev.
# Usage: ./scripts/init-dev-env.sh
# Copies .env.example to backend/.env if not present, then prompts for
# any missing required keys.

set -e

ENV_FILE="backend/.env"
ENV_EXAMPLE=".env.example"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$ENV_EXAMPLE" ]; then
    echo "Error: $ENV_EXAMPLE not found. Run this from the project root."
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created $ENV_FILE from $ENV_EXAMPLE"
fi

# Check for placeholder values and prompt
MISSING=""
for key in PROWLARR_API_KEY; do
  val=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
  case "$val" in
    ""|your_*)
      MISSING="$MISSING $key"
      ;;
  esac
done

if [ -n "$MISSING" ]; then
  echo "Missing required keys:$MISSING"
  for key in $MISSING; do
    printf "  %s: " "$key"
    read -r input
    if [ "$(uname)" = "Darwin" ]; then
      sed -i '' "s/^${key}=.*/${key}=${input}/" "$ENV_FILE"
    else
      sed -i "s/^${key}=.*/${key}=${input}/" "$ENV_FILE"
    fi
  done
  echo "Updated $ENV_FILE"
fi

echo "Done. backend/.env is ready for local dev."