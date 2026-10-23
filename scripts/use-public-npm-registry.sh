#!/usr/bin/env bash
# Lovable writes bun.lock with about a hundred packages fetched from its own npm cache, which
# answers GitHub's shared runner IPs with HTTP 429 (Too Many Requests). That cache mirrors the
# public registry: every one of those packages is on registry.npmjs.org at the same path, with the
# same sha512 that bun.lock pins, and bun refuses any tarball whose hash differs. So CI fetches them
# from the public registry instead. Only the runner's working copy changes; the committed lockfile
# stays as Lovable writes it.
#
#   bash scripts/use-public-npm-registry.sh   # before bun install, in CI only
set -euo pipefail

sed -i 's#https://europe-west1-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock
