#!/usr/bin/env bash
# Seeds or replaces the `data` branch from the local embedded store, so the
# scheduled pipeline continues from your local snapshots instead of starting
# empty. Usage: scripts/publish-data-branch.sh [remote]
set -euo pipefail
remote_url=$(git remote get-url "${1:-origin}")
out=$(mktemp -d)
npx tsx scripts/datastore.ts pack "$out/store.tar.gz"
npx tsx scripts/run.ts export "$out/snapshot.json" >/dev/null
cd "$out"
git init -q -b data
git add store.tar.gz snapshot.json
git commit -q -m "data: pipeline state $(date -u +%Y-%m-%dT%H:%MZ)"
git push --force "$remote_url" data
