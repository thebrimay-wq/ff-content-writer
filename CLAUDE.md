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
- `src/main.ts` (~3,750 lines) — the entire app: one Lit component (`<ff-app>`) with sidebar inputs, unified inline editor, right rail, library, per-content-type renderers, drawer state, modal focus management, beforeunload guard
- `src/lib/store.ts` — localStorage CRUD for `ContentEntry`, title/slug derivation, hidden-id management
- `src/lib/contentTypeSchemas.ts` — TypeScript types + zod-style runtime schemas for all 9 content types
- `src/lib/api.ts` — Anthropic API streaming wrapper
- `src/lib/systemPrompt.ts` / `jsonSystemPrompt.ts` — model prompts for article (markdown) and structured (JSON) types
- `src/lib/articles.ts` — article-specific helpers (read time, headings, etc.)
- `src/lib/validation.ts` — JSON repair / partial-stream parsing
- `src/lib/versionConfig.ts`, `taxonomy.ts` — config

## Architecture notes (important — easy to misread the code)
- The custom element tag is `<ff-app>` (not `<ff-content-writer>`). The component opts out of shadow DOM via `createRenderRoot() { return this }`, so light-DOM queries work.
- The center pane is a **single unified surface that is both Preview AND Editor**. There are no separate Preview / Edit tabs. Click any field → edit it inline.
- The toolbar's `</>` button toggles a read-only HTML/Markdown/JSON source view (admin-only intent).
- The right rail is a **tabbed publishing panel**:
  - **Sticky action area** at the top — Status pill, "Save changes" / "Save as draft", and "Publish this" (disabled via `_canPublish` until every readiness check passes).
  - **Publish Readiness card** below the actions — green "Ready to publish" when `_canPublish`, otherwise an amber checklist of missing items. Each missing item is a button that calls `_gotoField(tab, key)` to switch tabs, scroll to `[data-field=key]`, and pulse it via the `ff-field-pulse` class.
  - **5 tabs** rendered by `_renderRightTabs` — Basics / Categories / SEO / AI Context / Advanced. The first three carry amber missing-count badges driven by `_readinessChecks()`.
  - **Basics**: title (bidirectionally synced with the canvas H1 / JSON `title` via `_getTitle` / `_setTitle`), slug, excerpt, status, region, language.
  - **Categories**: real CMS taxonomy + curated categories.
  - **SEO**: `metaDescription` (160-char limit), `featuredImage` (file upload + URL paste fallback), public `tags`.
  - **AI Context**: `seoArticle` (long-form source — fed to `buildUserMessage` / `buildJsonUserMessage` and refinement builders as primary factual basis) and `sources` (auto-extracted post-generate via `buildSourcesMessage`; only overwrites when the writer hasn't filled any rows). `_sourcesLoading` flags the in-flight extraction.
  - **Advanced**: author, client, internal tags, redirect, priority, exclude clients, mime type, paid content, legacy id, exclude smart benefits.
- New schema fields on `ContentEntry`: `metaDescription`, `featuredImage`, `tags`, `internalTags`. Defaults + raw-load migration live in `src/lib/store.ts`.
- 9 content types: `article`, `money_tip`, `checklist`, `quiz`, `expert_insight`, `user_story`, `video`, `calculator`, `infographic`. `article` uses markdown; the other 8 are JSON-backed.
- Switching content type mid-draft prompts before destroying incompatible output. **JSON ↔ JSON** switches preserve the title. **Article ↔ JSON** is destructive: it also resets `editingId`, `_currentStatus`, `_slug`, `_excerpt`, `_categories`, etc. via `_resetMeta()` so a Save/Publish doesn't push empty content under the previous entry's slug.

## Layout & responsive behavior
- Desktop (≥1024px / Tailwind `lg`): three-column flex — left sidebar (`w-[300px]`), center `<main>`, right rail (`w-[300px]`).
- Below `lg`: both rails collapse to **off-canvas drawers**. The header shows a hamburger (left) + panel-icon (right) toggle. State lives in `_sidebarDrawerOpen` / `_railDrawerOpen`. A `<lg:hidden>` backdrop dims the editor when either drawer is open. `_onResize` auto-closes drawers when the viewport widens back to desktop. `_switchTab` also closes them.
- Inner article padding: `px-4 sm:px-8 lg:px-12 py-6 lg:py-10` on the prose container so the body stays readable on narrow viewports.

## Data-loss safeguards
- `_hasUnsavedWork()` returns `isDirty && !!output.trim()` — the canonical "would we lose work?" check.
- `_newContent(force = false)` prompts via `confirm()` when there's unsaved work. Pass `force = true` from contexts where the user already committed to the destructive action (e.g. after deleting the entry currently being edited).
- `_onBeforeUnload` registered in `connectedCallback` triggers the browser's "leave site?" prompt when the local draft is dirty.

## Modals (API key prompt, internal link picker)
- Both render with `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at their title.
- Each modal's first input is marked with a `data-modal-autofocus="key" | "link"` attribute. The `updated()` lifecycle detects the rising edge of `showKeyPrompt` / `_linkModalOpen`, focuses the matching input on open, and restores focus to the previously focused element (`_modalReturnFocus`) on close. **Don't use the bare `autofocus` HTML attribute** — Lit's re-render races kill it.
- Escape on the modal closes via the dedicated handlers `_closeKeyPrompt()` / `_closeLinkModal()`.

## Conventions
- Inline-editable fields use `contenteditable` + `@blur` to commit; placeholders are CSS `data-placeholder`, never literal italic text in the DOM (that gets saved as content).
- AI rewrite toolbar fires on `[data-rewrite="true"]` containers with ≥4 chars selected. Both the article body **and the title** carry this attribute.
- Slash menu (`/`) is **article-only** — guarded by `this.contentType === 'article'` in `_onEditorKeydown`. Escape removes the typed `/` via `_closeSlash({ removeTrigger: true }) → _removeSlashTrigger()`.
- Selection toolbar position: prefer **above** the selection (Notion/Docs pattern), fall back to below, then right/left, then pinned to viewport top.
- Generate/refine errors surface in a dismissible `role="alert"` banner inside `<main>` (driven by `this.error`). `AbortError` is silenced.
- Status values: `draft | in_review | approved | published | trash`. The right-rail pill reflects `_currentStatus`.

## Known deferred work
- `related_resources` editor for User Story / Video / Calculator / Infographic
- Checklist `subItems` editor and per-section `image` upload
- Quiz `correctAnswerIds` editor (knowledge-type scoring) and per-answer `pointValue` / `isCorrect` toggles
- Drag-and-drop image upload (UI hint exists but only file picker works)
- Audience dropdown copy ("We'll tune tone and depth") doesn't match the FF-specific value set (Crisis / Struggling / Planning / Optimizing)
