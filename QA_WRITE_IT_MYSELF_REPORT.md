# QA Audit — Write it myself mode

Date: 2026-04-29
Branch: main
Tester: hands-on browser QA via Vite dev server (port 3003), localStorage cleared before each pass.

## Scope

Manual creation flow only — no AI generation. Every content type, every visible field/control on the canvas and right rail, save → reopen → publish.

## Content types tested

article, money_tip, checklist, quiz, expert_insight, user_story, video, calculator, infographic.

## Summary

The plumbing is mostly there: each content type has a type-specific manual canvas, the right-rail readiness checklist drives the publish gate, and Save / Save-as-draft / Library round-trip work. Three blocking bugs and one defense-in-depth gap break the manual flow today, plus several smaller UX gaps.

## Bugs found (P1 — block the manual flow)

### BUG-1 — Inline H1 title edits don't auto-derive the URL slug

**Where:** every content type. Article via `_setArticleTitle` ([src/main.ts:2953](src/main.ts:2953)); JSON types via `_updateJson` / `_setSimpleField` / `_extras.title` onCommit handlers ([src/main.ts:2151](src/main.ts:2151), [src/main.ts:2266](src/main.ts:2266), [src/main.ts:2360](src/main.ts:2360), [src/main.ts:2426](src/main.ts:2426)).

**Symptom:** typing the title in the canvas H1 sets the title in `output` but leaves `_slug = ''`. Readiness check at [src/main.ts:885](src/main.ts:885) fails on slug, publish stays disabled. The right-rail title input *does* derive the slug (`_setTitle` at [src/main.ts:873](src/main.ts:873)), so the bug only hits users who edit the title where it visually lives.

**Root cause:** `_setTitle` is the only path that calls `deriveSlug`. The inline H1 commits go straight to the body-specific setter, never round-tripping through `_setTitle`.

**Repro:**
1. New content → Write it myself → Article.
2. Click the H1, type "My Manual Test Article", blur.
3. Open the right-rail SEO tab: slug field is empty, Publish disabled.

### BUG-2 — Article in Write-it-myself hides the entire right-rail tabs and readiness checklist

**Where:** [src/main.ts:1010-1034](src/main.ts:1010), `_renderRightRailBody` gates everything below the sticky action area on `hasOutput = !!this.output.trim()`.

**Symptom:** for a fresh manual article, `output` is empty (`''`) until the user types body content (article output is markdown with no skeleton — [src/main.ts:388](src/main.ts:388)). All five tabs (Basics / Categories / SEO / AI Context / Advanced) and the Publish Readiness checklist are hidden. The empty-state message reads "Generate or write a draft first" — wrong wording for manual mode where there is no AI generation.

**Root cause:** the gate was authored for AI mode (you have nothing useful to set until the model has produced *something*). In Write-it-myself, the writer expects to fill metadata immediately, often before drafting body copy.

**Side effect:** users have no entry point to set excerpt, slug, or featured image before writing the body. They also can't preview the readiness checklist to see what publishing will require.

**Repro:**
1. New content → Write it myself → Article.
2. Right rail shows only Save / Publish (both disabled) and the misleading message.

### BUG-3 — Reopening any saved entry forces creationMode = 'ai'

**Where:** [src/main.ts:273](src/main.ts:273), `_openEntry` unconditionally sets `this.creationMode = 'ai'`.

**Symptom:** a user saves a Write-it-myself draft, navigates to Library, clicks Edit. The editor reopens in AI mode — left sidebar now shows topic / audience / notes / expert sources inputs that didn't exist when they were drafting. This contradicts the "manual mode" mental model and clutters the sidebar with fields the writer never wanted.

**Root cause:** `creationMode` is not persisted on `ContentEntry`. `_openEntry` defaults to `'ai'` because the original code path was AI-first.

**Repro:**
1. Write it myself → Money Tip → fill title → Save as draft.
2. Library → Edit the draft.
3. Sidebar shows AI mode with topic / audience / notes / expert sources fields.

## Bugs found (P2 — defense in depth)

### BUG-4 — `_publish()` doesn't check readiness

**Where:** [src/main.ts:680-688](src/main.ts:680).

**Symptom:** the only guard is `!this.output.trim() || this.isGenerating`. The publish button's `disabled` attribute is the sole protection against publishing with missing required fields. Any code path that reaches `_publish()` outside the button (programmatic call, race, future shortcut) can publish a half-formed entry.

**Repro (synthetic):** with checklist's JSON skeleton already in `output`, calling `app._publish()` from devtools succeeds without title/excerpt/category/slug/metaDescription/featuredImage — verified in this audit.

**Fix:** add `if (!this._canPublish) return` at the top of `_publish`.

## UX issues found

- **Misleading right-rail empty-state copy** in Write-it-myself: "Generate or write a draft first" should drop the "Generate or" half when the user is in manual mode. (Tied to BUG-2's fix.)
- **Article empty state on canvas** is just a placeholder; no nudge toward setting a title or pressing `/`. Minor — works but feels barren.
- **Infographic** has no body editor — confirmed intentional per schema comment ("Simplified per Bri's spec: thumbnail + infographic image + related. No title, no copy.") at [src/lib/contentTypeSchemas.ts:292](src/lib/contentTypeSchemas.ts:292). Title is stored under `_extras.title` so the readiness "title" check still works. Not a bug.
- **Quiz** does not expose the per-answer `isCorrect` / `pointValue` toggles or the `correctAnswerIds` editor — already noted as deferred work in CLAUDE.md. Out of scope for this audit.
- **Featured image URL** doesn't validate (e.g. paste a non-image URL → silently saved). Minor.

## What works correctly

- All 9 content types render type-specific manual canvases.
- Add / Remove section, Add / Remove item, Add / Remove answer, Add / Remove result work and update `output`.
- `Save as draft` writes a `ContentEntry` with the right `contentType` and persists across reload.
- Library reflects manually-created drafts with the right type label and status.
- Publish Readiness checklist is accurate: title / excerpt / category / slug / metaDescription / featuredImage (only for infographic, money_tip, expert_insight, user_story, video).
- Click-to-fix on a missing item switches to the right tab, scrolls the field into view, focuses, and pulses (1.7s).
- Tab badges show missing-count per tab.
- Content-type switching from a clean state and JSON↔JSON preserves title; article↔JSON correctly prompts and resets metadata.
- Long-form source / Sources do **not** block publish in manual mode (verified — they're not in `_readinessChecks`).
- No console errors during the entire flow.

## Fix plan

1. **BUG-1 (slug):** add a `_maybeAutoSlug(title)` helper and call it from every title-commit path — `_setArticleTitle`, the four JSON `onCommit` handlers, and any future title setter. Consolidates the rule "if `_slugAutoFromTitle`, derive slug" in one place.
2. **BUG-2 (right rail in Write it myself):** remove the `hasOutput` gate around the readiness/tabs section, OR loosen it to `hasOutput || creationMode === 'manual'`. Update the empty-state copy below the Publish button to match mode (manual vs AI).
3. **BUG-3 (creationMode on reopen):** add `creationMode?: 'ai' | 'manual'` to `ContentEntry`, persist it on every save (`createEntry` / `updateEntry` / `_metaPatch`), and rehydrate in `_openEntry` (default to `'ai'` for legacy entries that don't have the field).
4. **BUG-4 (publish guard):** add `if (!this._canPublish) return` to the top of `_publish()`.

After fixes, run the full QA flow again and document in `QA_WRITE_IT_MYSELF_REGRESSION.md`.
