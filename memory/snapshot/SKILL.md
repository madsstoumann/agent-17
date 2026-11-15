---
name: snapshot
description: Keeps a memory store's history on a private, orphan git branch (one commit per snapshot, pushed so the whole team can read it), lists the snapshots, shows what changed between two of them and puts one file back. Use before and after a memory clean-up or a dream applies anything, when someone asks what a memory said before or wants a memory change undone, or to set up memory versions for a team store (step E7 of enable-memory-management).
argument-hint: "[--memory DIR] [--label TEXT] [--push] | --list | --diff [A [B]] | --show FILE [--from REV] | --restore FILE [--from REV] [--yes]"
allowed-tools: Bash(node:*), Bash(git:*), Read
metadata:
  version: "1.0.0"
---

# Snapshot a memory store to git

A memory store changes in place: a session rewrites a file, a dream merges three, a host forces a
rewrite of the index. Without history, the old text is gone. This skill keeps every version of the
store as a commit on an orphan branch (`memory-log` by default) of the project's own repo. The
branch shares no history with the main line, only moves forward, and is never merged.

`enable-memory-management`'s `snapshot.mjs` does the same into a local folder. Use it when there is
no repo, or nobody else needs to read the history.

## Commands

All of them print JSON. Run them from the project's checkout, or pass `--repo DIR`.

| Task | Command |
|---|---|
| Snapshot (commits only when something changed) | `node ${CLAUDE_SKILL_DIR}/scripts/memory-log.mjs --memory DIR --label "Before <what>" --push` |
| The snapshots, newest first | `… --list [--max N]` |
| What changed since the newest snapshot | `… --diff --memory DIR` |
| Since snapshot A, or from A to B | `… --diff A --memory DIR` · `… --diff A B` |
| A file as it was | `… --show FILE --from memory-log~1` |
| Put one file back | `… --restore FILE --from REV --memory DIR`, read the diff it prints, then again with `--yes` |

`--memory` defaults to `$MEMORY_DIR`, then to Claude Code's auto memory folder for the repo.
`--branch NAME` and `--remote NAME` change the branch (`memory-log`) and the remote (`origin`). A REV
is a commit from `--list` or `memory-log~N`.

## When

| Moment | Label |
|---|---|
| Before a clean-up, a dream or a restore writes anything | `Before <what> (<date>)` |
| After it, so the accepted change is one readable diff | `After <what>: #<numbers> accepted` |
| After a host rewrote the index on its own | `After <host> rewrote MEMORY.md` |
| A person asks "what did it say before?" | none: `--list`, then `--show` |

`--restore` takes a snapshot of the current state first, so a restore can be undone too.

## Rules

- **Ask before the first push.** Everyone who can read the repo can read the branch. On a public repo,
  do not push: keep the branch local, or pass `--remote` for a private repo that only holds memory.
- A store that holds a secret (the audit's M7) is not pushed: remove the secret first and tell the
  person to rotate it, because a commit keeps it.
- Never rewrite the branch: no force-push, no amend, no rebase. A wrong snapshot is fixed by the next one.
- Never merge it into the main line, and never check it out in the main worktree; the script uses a
  temporary worktree.
- Files and folders whose name starts with a dot are a sync's own state: they are left out, and a
  restore never writes one.
- Restore one file at a time, after showing the person the diff. A whole-store rollback is several
  restores, or `snapshot.mjs --restore` from a local snapshot.

## Set it up for a project

1. Ask whether the repo is private and whether the team should read the history (the push).
2. Take the first snapshot with `--push`. It creates the orphan branch.
3. Name the command in the project's memory rules (the `templates/rules/` block of
   enable-memory-management, line "history") and in its `memory-dream` skill, so every session and
   every dream snapshots before writing.
