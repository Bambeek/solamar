#!/usr/bin/env bash
# Puts the landing page on the WSBusinesslab dedi at /var/www/solamar.app (served by nginx-solamar.app.conf):
# only the files the page serves, not the screenshot scripts or this folder's README. Usage: bash site/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
tar -czf - index.html styles.css main.js brand.js icon.svg assets |
  ssh WSBusinesslab 'set -e; t=$(mktemp -d); tar -xzf - -C "$t"; chmod 755 "$t"; rsync -a --delete --exclude .well-known "$t"/ /var/www/solamar.app/; rm -rf "$t"'
echo "Deployed to https://solamar.app"
