# AI-Assisted Development Workflow

Last reviewed: 2026-10-05

This repository is designed to work consistently with Codex, Claude Code and
human contributors without maintaining competing copies of project memory.

The codebase is currently proprietary property of Dikho Global Media LLP.
Agents must not infer permission to publish, open-source, package for public
distribution or select a license from roadmap language about a possible future
release. Those actions require an explicit owner decision.

## Canonical context

`AGENTS.md` is the short, durable instruction entry point. More specific
`AGENTS.md` files apply inside `src/api/`, `supabase/` and `migrations/`.
Product, architecture, security and operational facts live in the specialist
documents linked from the root file.

This structure is deliberate:

- instructions say **how to work**;
- product and architecture documents say **what is true and why**;
- ADRs preserve accepted decisions;
- roadmap items describe priorities, not deployed behavior;
- task briefs preserve temporary state for work spanning sessions;
- code, migrations and effective cloud policy remain the final evidence of
  implemented behavior.

Do not create a root `MEMORY.md` that copies these sources. Duplicated memory
becomes stale and causes agents to follow conflicting claims. If a tool needs a
tool-specific entry point, keep it as a small pointer to the canonical files.

## Start of a task

1. Read the root `AGENTS.md` and any nested instructions for the files in
   scope.
2. Inspect the working tree before editing. Existing changes may belong to the
   user or another active task.
3. Read only the relevant specialist documents; do not load the whole handbook
   for a narrow change.
4. Verify statements that may have changed against code, package scripts and
   migrations.
5. For multi-session or risky work, copy `docs/tasks/_template.md` to a focused
   task brief and keep it factual.

## During the task

- Make the smallest complete change and preserve unrelated edits.
- Separate current behavior from target design in code comments and docs.
- Never place credentials, OTPs, signed URLs, provider payloads or production
  records in prompts, fixtures, screenshots or Markdown.
- Use synthetic data for examples and visual evidence.
- Record durable design choices in an ADR; do not hide them in chat history.
- Update documentation when an invariant, command, deployment boundary or
  operator workflow changes.
- Do not claim a route, role or policy is protected without exercising both
  allowed and denied cases at the enforcing layer.

## End of a task

Run verification proportional to the change and report exactly what ran. The
safe repository check is `npm run check`; its present tests cover only session
verification, Turnstile, webhook signatures and media tickets. Use
[Testing](TESTING.md) for additional requirements.

The handoff should state:

- files and behavior changed;
- important assumptions and decisions;
- checks that passed or failed;
- checks that were not available or not run;
- remaining risks or owner decisions;
- any required rollout order, without performing a deployment unless the user
  explicitly authorized it.

Move lasting decisions out of a completed task brief and into the relevant
specialist document or ADR. Archive/remove transient notes only when doing so
does not discard unfinished work.

## Tool-specific repository files

| Path | Current purpose | Policy |
| --- | --- | --- |
| `AGENTS.md` and nested variants | Shared repository instructions | Canonical; keep concise and reviewed |
| `.claude/launch.json` | Shared local launch shortcuts | Keep only commands that are safe and accurate |
| `.claude/settings.local.json` | Developer-specific Claude permissions | Ignored; never treat as team policy or commit it |
| `.claude/settings.json` | Possible shared Claude settings | Add only for a concrete, reviewed enforcement need |
| `.codex/config.toml` | Possible project-scoped Codex configuration | Add only for a required project setting or plugin |
| `CLAUDE.md` | Possible Claude-only instructions | Avoid while Claude can consume `AGENTS.md`; never duplicate it |
| `MEMORY.md` | Unstructured persistent notes | Do not use as a second source of truth |

The absence of `.claude/settings.json` and `.codex/config.toml` is intentional,
not missing setup. Agent behavior belongs in `AGENTS.md`; machine-local trust,
permissions, credentials and personal preferences stay outside version control.

Official Codex behavior can evolve, so validate a tool-specific configuration
against its current official documentation before adding it. Keep the
repository's security and product rules tool-neutral.
