# Project rules

- This site is deployed from the `main` branch via GitHub Pages at https://thebrimay-wq.github.io/ff-content-writer/

## Git structure — IMPORTANT
- The git repository root is `/Users/brimay` (the home directory), NOT this project folder.
- All project files are tracked under `Desktop/GitHub FF/FF-Content-Writer/` inside that repo.
- The GitHub remote is named `ff-content-writer`, not `origin`. There is no `origin` remote.
- Always push with: `git push ff-content-writer main` (run from anywhere inside the repo).
- The GitHub Actions workflow lives at `/Users/brimay/.github/workflows/deploy.yml` (repo root level) because GitHub Actions requires workflows at `.github/workflows/` in the repo root — not inside the project subfolder.
- Never force-push without first checking that `/Users/brimay/.github/workflows/deploy.yml` will still be present in the history being pushed, or the deploy will break.

## Workflow before finishing any task
1. `git status`
2. Show changed files
3. Stage the intended files by explicit path (never `git add -A` from the git root — it will sweep up your entire home directory)
4. Commit with a clear message
5. `git push ff-content-writer main`
6. Confirm the GitHub Actions run succeeds with `gh run watch`

## Other rules
- Always work in the current repo checkout unless explicitly told otherwise.
- Never create a git worktree unless explicitly asked.
- If anything prevents push/deploy, stop and explain exactly what is blocking it.
- Always confirm which branch you are on before making edits.
