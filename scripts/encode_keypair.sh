#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/encode_keypair.sh /path/to/id.json" >&2
  exit 1
fi

base64 -w 0 "$1"
