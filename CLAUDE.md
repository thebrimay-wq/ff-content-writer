# Project rules

- This site is deployed from the `main` branch via GitHub Pages at https://thebrimay-wq.github.io/ff-content-writer/

## Git structure
- The git repository root is this project folder (`/Users/brimay/Desktop/GitHub FF/FF-Content-Writer`).
- The GitHub remote is named `origin` → https://github.com/thebrimay-wq/ff-content-writer.git
- Always push with: `git push origin main`.
- The GitHub Actions workflow lives at `.github/workflows/deploy.yml` inside this repo.

## Workflow before finishing any task
1. `git status`
2. Show changed files
3. Stage the intended files by explicit path (avoid `git add -A` so unrelated edits don't sneak in)
4. Commit with a clear message
5. `git push origin main`
6. Confirm the GitHub Actions run succeeds with `gh run watch`

## Other rules
- Always work in the current repo checkout unless explicitly told otherwise.
- Never create a git worktree unless explicitly asked.
- If anything prevents push/deploy, stop and explain exactly what is blocking it.
- Always confirm which branch you are on before making edits.

## Stack
- **Framework**: Lit 3 web component (`<ff-content-writer>`)
- **Build**: Vite + TypeScript (`npm run build` → `tsc && vite build`)
- **Dev**: `npm run dev` (port 3003)
- **Styling**: Tailwind CSS (utility classes inline)
- **Storage**: browser localStorage (no backend)
- **Markdown rendering**: `marked`

## File map
- `src/main.ts` (~3,100 lines) — the entire app: one Lit component with sidebar inputs, unified inline editor, right rail, library, and per-content-type renderers
- `src/lib/store.ts` — localStorage CRUD for `ContentEntry`, title/slug derivation, hidden-id management
- `src/lib/contentTypeSchemas.ts` — TypeScript types + zod-style runtime schemas for all 9 content types
- `src/lib/api.ts` — Anthropic API streaming wrapper
- `src/lib/systemPrompt.ts` / `jsonSystemPrompt.ts` — model prompts for article (markdown) and structured (JSON) types
- `src/lib/articles.ts` — article-specific helpers (read time, headings, etc.)
- `src/lib/validation.ts` — JSON repair / partial-stream parsing
- `src/lib/versionConfig.ts`, `taxonomy.ts` — config

## Architecture notes (important — easy to misread the code)
- The center pane is a **single unified surface that is both Preview AND Editor**. There are no separate Preview / Edit tabs. Click any field → edit it inline.
- The toolbar's `</>` button toggles a read-only HTML/Markdown/JSON source view (admin-only intent).
- The right rail holds: Status pill → Save → Publish → Export HTML/JSON → Insert blocks → Quick refine.
- 9 content types: `article`, `money_tip`, `checklist`, `quiz`, `expert_insight`, `user_story`, `video`, `calculator`, `infographic`. `article` uses markdown; the other 8 are JSON-backed.
- Switching content type mid-draft prompts before destroying incompatible output, and preserves title across JSON ↔ JSON switches.

## Conventions
- Inline-editable fields use `contenteditable` + `@blur` to commit; placeholders are CSS `data-placeholder`, never literal italic text in the DOM (that gets saved as content).
- AI rewrite toolbar fires on `[data-rewrite="true"]` containers with ≥4 chars selected.
- Slash menu (`/`) inserts markdown-style HTML — currently global; ideally article-only.
- Status values: `draft | in_review | approved | published | trash`. The right-rail pill reflects `_currentStatus`.

## Known deferred work
- `related_resources` editor for User Story / Video / Calculator / Infographic
- Checklist `subItems` editor and per-section `image` upload
- Quiz `correctAnswerIds` editor (knowledge-type scoring) and per-answer `pointValue` / `isCorrect` toggles
- Article title missing `data-rewrite="true"` so AI rewrite can't fire on it
- Slash menu should be scoped to article body only
- Escape-dismissing the slash menu can leave a stray `/` in the body
- Drag-and-drop image upload (UI hint exists but only file picker works)
