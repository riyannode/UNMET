#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "--inside" ]]; then
  bun_bin="$(command -v bun)"
  script="$(realpath "$0")"
  if [[ "${1:-}" == "--ci" ]]; then
    exec sudo -n bash -c 'exec 9< /proc/self/ns/net; exec unshare --net -- bash "$1" --inside "$2"' _ "$script" "$bun_bin"
  fi
  exec 9< /proc/self/ns/net
  exec unshare --user --map-root-user --net -- bash "$script" --inside "$bun_bin"
fi
[[ -e /proc/self/fd/9 ]] || { echo "missing parent namespace descriptor" >&2; exit 1; }
parent_namespace="$(readlink /proc/self/fd/9)"
[[ "$parent_namespace" == net:\[*\] && "$(readlink /proc/self/ns/net)" != "$parent_namespace" ]] || {
  echo "network namespace did not change" >&2
  exit 1
}
ip link set lo up
ip addr add 93.184.215.14/32 dev lo
ip -6 addr add 2606:4700::1111/128 dev lo nodad
[[ -z "$(ip route show)" ]] || { echo "unexpected external route" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=fixture.test \
  -addext subjectAltName=DNS:fixture.test -keyout "$tmp/key.pem" -out "$tmp/cert.pem" >/dev/null 2>&1
export VALIDATION_TEST_CA="$tmp/cert.pem" VALIDATION_TEST_CERT="$tmp/cert.pem" VALIDATION_TEST_KEY="$tmp/key.pem"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/backend"
"$2" test validation-transport.test.ts
