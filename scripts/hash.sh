#!/bin/sh
# Generate a bcrypt password hash for IndexMon
# Usage: ./hash.sh <password>
# Output: ADMIN_PASSWORD_HASH=$2a$...  (copy this into .env)

if [ $# -ne 1 ]; then
  echo "Usage: $0 <password>"
  exit 1
fi

docker run --rm ghcr.io/peglah/indexmon hash-password "$1"
