#!/usr/bin/env bash
# Read-only report on the Node toolchain: nvm, Node, global npm packages, brew-managed JS tools, stray system Node.
# Changes nothing. Upgrades are the skill's job, after the user approves.

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || { echo "nvm not found at $NVM_DIR"; exit 1; }
nvm use default >/dev/null 2>&1

section() { printf '\n== %s ==\n' "$1"; }

section "nvm"
nvm_current="v$(nvm --version)"
nvm_latest="$(git ls-remote --tags --refs https://github.com/nvm-sh/nvm.git 2>/dev/null \
  | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
echo "installed: $nvm_current"
echo "latest:    ${nvm_latest:-unknown (offline?)}"
if git -C "$NVM_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "install method: git checkout in $NVM_DIR"
else
  echo "install method: not a git checkout (Homebrew or script copy)"
fi

section "node"
remote="$(nvm ls-remote --no-colors 2>/dev/null)"
node_latest="$(echo "$remote" | grep -Eo 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -1)"
lts_latest="$(echo "$remote" | grep -i 'Latest LTS' | grep -Eo 'v[0-9]+\.[0-9]+\.[0-9]+' | tail -1)"
echo "default:     $(nvm version default)"
echo "latest:      ${node_latest:-unknown}"
echo "latest LTS:  ${lts_latest:-unknown}"
echo "installed:   $(nvm ls --no-colors --no-alias 2>/dev/null | grep -v system | grep -Eo 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tr '\n' ' ')"

section "global npm packages (default node)"
linked="$(find "$(npm root -g)" -maxdepth 2 -type l 2>/dev/null | sed "s#$(npm root -g)/##")"
outdated="$(npm outdated -g --parseable --long 2>/dev/null)"
if [ -z "$outdated" ]; then
  echo "all up to date"
else
  printf '%-22s %-10s %-10s %s\n' PACKAGE CURRENT LATEST NOTE
  echo "$outdated" | while IFS=: read -r _path wanted current latest _dep _type; do
    name="${wanted%@*}"
    cur="${current##*@}"; lat="${latest##*@}"
    note=""
    [ "${cur%%.*}" != "${lat%%.*}" ] && note="MAJOR"
    if echo "$linked" | grep -qx "$name"; then
      note="LINKED (npm link) - registry name may be a different package, do not update"
    fi
    printf '%-22s %-10s %-10s %s\n' "$name" "$cur" "$lat" "$note"
  done
fi

section "brew-managed JS tools"
if command -v brew >/dev/null 2>&1; then
  out="$(brew outdated --verbose 2>/dev/null | grep -Ei '^(node|node@[0-9]+|nvm|pnpm|yarn|bun|deno|corepack)\b')"
  echo "${out:-none outdated}"
else
  echo "brew not installed"
fi

section "node outside nvm"
for p in /usr/local/bin/node /opt/homebrew/bin/node; do
  [ -x "$p" ] && echo "$p -> $("$p" -v 2>/dev/null) (owner: $(stat -f %Su "$p"))"
done
echo "(nvm's 'system' alias points at the first of these on PATH)"
