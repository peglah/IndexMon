#!/bin/sh
set -e

if [ "$1" = "hash-password" ]; then
  shift
  exec node /app/scripts/hash-password.js "$@"
fi

# Normal startup
node ./scripts/init-db.cjs
nginx &
exec node dist/server.js
