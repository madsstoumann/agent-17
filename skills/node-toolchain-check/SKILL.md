---
name: node-toolchain-check
description: Use when the user asks to check, audit or update their Node toolchain — nvm, Node versions, global npm packages, brew-installed pnpm/yarn/bun/deno, or a stray system Node — or asks "is anything outdated" about their local JS tooling.
metadata:
  version: "1.0.0"
---

# Node toolchain check

Report what is outdated, then upgrade only what the user approves.

## 1. Report

Run the read-only check script:

```bash
bash ~/.claude/skills/node-toolchain-check/check.sh
```

Summarise it as one short list: item, current, latest, and a recommendation. Flag:

- **MAJOR** bumps. Say what could break (for example npm major on an older Node, a CLI with changed flags).
- **LINKED** packages. These come from `npm link` to a local repo. The registry package with the same name is often unrelated. Never update them.
- **Node outside nvm** (`/usr/local/bin/node` owned by root comes from the nodejs.org `.pkg` installer). It shows up as nvm's `system` alias and shadows nvm in shells that put `/usr/local/bin` first. Removing it needs `sudo`, so only suggest it.
- **Old Node versions** under nvm that nothing uses. Suggest `nvm uninstall <version>`. Do not remove them unasked.

Then ask which items to upgrade. Do not upgrade anything before the user answers.

## 2. Upgrade (only the approved items)

Load nvm in every Bash call: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use default >/dev/null`.

| Item | Command |
|---|---|
| nvm (git checkout) | `cd ~/.nvm && git fetch --tags origin && git checkout <latest-tag>` |
| Node, keeping globals | `nvm install node --reinstall-packages-from=<old>` then `nvm alias default node` |
| Node LTS instead | `nvm install --lts --reinstall-packages-from=<old>` then `nvm alias default 'lts/*'` |
| A global package | `npm install -g <pkg>@latest` |
| npm itself | `npm install -g npm@latest` |
| brew tools | `brew upgrade <formula>` |

After upgrading, open a fresh shell to verify (`node -v`, `npm -v`, `nvm --version`). The current shell can keep the old Node first on its PATH, so its `node -v` can show the old version.

## Install-script warnings

npm skips `preinstall`/`install`/`postinstall` scripts unless allowlisted (`npm warn install-scripts …`). Check each skipped package still works before allowlisting it. Allow one package for good with `npm config set allow-scripts=<pkg> --location=user`.
