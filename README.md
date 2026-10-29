# agent-17

Agent skills, in [`skills/`](skills/). See [skills/README.md](skills/README.md) for how they are versioned.

## Install the skills

The repository is a plugin marketplace. It has one plugin, `mads-skills`, which holds every skill in `skills/`. Install it once and you get new skills and fixes as they land here.

### Claude Code

```text
/plugin marketplace add madsstoumann/agent-17
/plugin install mads-skills@agent-17
```

Or from your shell: `claude plugin install mads-skills --marketplace madsstoumann/agent-17`.

The skills show up as `/mads-skills:launch-audit`, `/mads-skills:validate-schema` and so on, and Claude also picks them up on its own when a task matches. To get updates automatically, open `/plugin`, go to **Marketplaces**, select `agent-17` and choose **Enable auto-update**. Otherwise run `claude plugin update mads-skills@agent-17` now and then.

### claude.ai and the Claude desktop app

1. Open [Customize > Plugins](https://claude.ai/customize/plugins).
2. Choose **Add > Add marketplace** and enter `madsstoumann/agent-17`.
3. Add **mads-skills**. Turn on **Sync automatically** for the marketplace to get updates.

A plugin added on claude.ai is saved to your account, so it also loads in Cowork and in Claude Code when you are signed in with the same account. If you already uploaded some of these skills one by one under Customize > Skills, remove those copies so they don't trigger twice.

### One skill only

Copy its folder into `~/.claude/skills/` (Claude Code), or zip the folder and upload it under Customize > Skills (claude.ai).

## Adding a skill

Put it in its own folder under `skills/` with a `SKILL.md` and a `CHANGELOG.md`. The plugin picks it up with no other change. Refer to bundled scripts as `${CLAUDE_SKILL_DIR}/...`, not a fixed `~/.claude/skills/...` path, because a plugin installs the skill somewhere else.
