#!/usr/bin/env bash
set -euo pipefail

actionlint_version="${1:?Usage: bash scripts/setup-actionlint.sh VERSION}"
if [[ ! "$actionlint_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Expected an actionlint version such as 1.7.12" >&2
    exit 1
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
install_dir="$repo_root/.tools/actionlint/$actionlint_version"
if [[ -x "$install_dir/actionlint" ]]; then
    exit 0
fi

mkdir -p "$install_dir"
download_script="$(mktemp)"
trap 'rm -f "$download_script"' EXIT
curl --fail --silent --show-error --location --retry 3 \
    --connect-timeout 10 --max-time 60 \
    "https://raw.githubusercontent.com/rhysd/actionlint/v$actionlint_version/scripts/download-actionlint.bash" \
    --output "$download_script"
bash "$download_script" "$actionlint_version" "$install_dir"
