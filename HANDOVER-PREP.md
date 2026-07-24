# HANDOVER PREP — final-pass checklist (do at Phase 11, before demo/handover)

Decided 2026-07-24. This file is itself a meta-doc — **it gets removed from the
repo in step 2 below** (kept locally only).

None of this changes the running system. The code Vercel deploys stays byte-for-
byte identical; only history metadata and which files are tracked change.

## 1. De-trace the git history
- Back up first: `git branch backup/pre-detrace` (so the rewrite is reversible locally).
- Rewrite ALL commits to strip the `Co-Authored-By: Claude Opus 4.8` trailer,
  keeping every commit message and all file contents identical.
  (`git filter-repo --message-callback` or filter-branch.)
- Force-push to replace GitHub history.
- Verify: `git log --format='%an %cn %b' | grep -i claude` returns nothing.
- Why safe: history is metadata; the files are unchanged, so the site, tests,
  and Vercel are unaffected.

## 2. Remove meta-docs from the repo (KEEP them locally in VS Code)
- `git rm --cached` (NOT plain rm — keeps the file on disk) then add to .gitignore:
  - STATE.md, IMPLEMENTATION-PLAN.md, CLAUDE.md, AGENTS.md, DEMO_NOTES.md,
    HANDOVER-PREP.md (this file), GATE-TESTS.md, and any workflow build-sheets
    that read as internal.
- REVIEW before cutting — some may be worth keeping as generic dev docs with
  Claude references stripped (COSTS.md, HOW_IT_WORKS.md, README.md, GHL setup
  sheets are client-useful).
- NOTE: I keep reading local CLAUDE.md / AGENTS.md as guardrails while building.
  AGENTS.md's Next.js 16 warnings must not be lost even after they leave the repo.

## 3. Code cleanup (test-guarded, NOTHING behavioral)
- Remove dead code, unused imports/exports, duplicated logic.
- After EVERY change: `npm run build` + `npm test` (57) green, small commits.
- If a test goes red, stop and revert — cleanup never breaks working code.

## 4. Security hardening (additive only)
- Rate limiting on public routes (/api/quote, /api/checkout, /api/xendit-webhook).
- Security headers (next.config: CSP-ish, X-Frame-Options, etc.).
- Input-size caps at every boundary; confirm the 400-char slice everywhere.
- `npm audit` review; tighten any error message that could leak internals.
- Run /security-review on the final branch.
- Rotate the Google server key (pasted in chat pre-restriction) — see below.

## 5. Also outstanding (from earlier)
- Rotate GOOGLE_MAPS_SERVER_KEY (regenerate in Google Cloud → update .env.local +
  Vercel). Low risk (restricted) but the clean move.
- Confirm no secret is in tracked files (already true; re-verify after rewrite).
- Visual review of the wizard by a human (never seen by any reviewer).

## Ordering
Do 3 (cleanup) → 4 (hardening) → 1 (de-trace, LAST, since cleanup/hardening add
commits that would also carry the Claude trailer) → 2 (remove meta-docs, part of
the same final commit set). De-trace must be the final git operation.
