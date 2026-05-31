#!/bin/sh
set -e

if [ "$1" = "hash-password" ]; then
  shift
  exec node /app/scripts/hash-password.js "$@"
fi

# Normal startup
exec sh -c "node ./scripts/init-db.cjs && nginx && node dist/server.js"
