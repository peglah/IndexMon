#!/usr/bin/env node
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: hash-password <password>');
  process.exit(1);
}

bcrypt.hash(password, 10).then(hash => {
  console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
});
