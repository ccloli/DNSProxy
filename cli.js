#!/usr/bin/env node
console.log(`DNSProxy v${process.env.npm_package_version || require('./package.json').version}\n`);
require('./index');