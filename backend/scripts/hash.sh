#!/bin/sh
# Generate a bcrypt password hash for IndexMon
# Usage: ./hash.sh <password>
# Output: ADMIN_PASSWORD_HASH=$2b$...  (copy this into .env)

if [ $# -ne 1 ]; then
  echo "Usage: $0 <password>"
  exit 1
fi

HASH=$(node -e "const bcrypt = require('bcrypt'); bcrypt.hash('$1', 10).then(h => console.log(h))")
echo "ADMIN_PASSWORD_HASH=${HASH}"
