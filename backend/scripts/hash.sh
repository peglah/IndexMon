#!/bin/sh
# Generate a salted SHA-256 password hash for IndexMon
# Usage: ./hash.sh <password>
# Output: ADMIN_PASSWORD_HASH=salt$hash  (copy this into .env)

if [ $# -ne 1 ]; then
  echo "Usage: $0 <password>"
  exit 1
fi

SALT=$(openssl rand -hex 16)
HASH=$(printf '%s%s' "$SALT" "$1" | openssl dgst -sha256 | sed 's/^.* //')
echo "ADMIN_PASSWORD_HASH=${SALT}:${HASH}"
