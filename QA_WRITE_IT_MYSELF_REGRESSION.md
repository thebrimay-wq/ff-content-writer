# QA Regression — Write it myself mode (post-fix)

Date: 2026-04-29
Branch: main
Tester: hands-on browser QA via Vite dev server (port 3003), localStorage cleared before the regression pass.

## What was retested

Each P1/P2 bug from `QA_WRITE_IT_MYSELF_REPORT.md` was rerun against the patched build, plus a full happy-path publish for a representative content type, plus a reopen round-trip.

| ID | What was retested | Result |
| --- | --- | --- |
| BUG-1 | Inline H1 title commit auto-derives slug — every content type. | **PASS** for article, money_tip, checklist, quiz, expert_insight, video, calculator, infographic, user_story (after a follow-on fix wiring `_updateStoryField` through `_maybeAutoSlug`). |
| BUG-2 | Right-rail tabs + Publish Readiness checklist visible in fresh empty-output article in Write-it-myself. | **PASS** — Basics/Categories/SEO/AI/Advanced render immediately; readiness shows the 5 missing items; empty-state copy reads "Start writing to enable publishing." |
| BUG-3 | Save a manual draft → reopen from Library → `creationMode` is preserved. | **PASS** — saved entry has `creationMode: 'manual'`; on reopen `app.creationMode === 'manual'`, sidebar still shows "Blank" mode without AI inputs. |
| BUG-4 | Calling `_publish()` on a draft with missing readiness items is a no-op. | **PASS** — status stays `draft` until every required field is filled, then publishes successfully. |
| Round-trip | Save → publish → reopen → all fields hydrated. | **PASS** — title, slug, excerpt, meta description, categories, featured image, status, content type, and `creationMode` all restore. |

## What now passes (additional sanity checks)

- Live readiness checklist updates as fields are filled (excerpt, meta description, category, featured image).
- Click-to-fix on a checklist item still switches tabs, scrolls the field into view, focuses it, and pulses for 1.7s.
- Tab badges (Basics 2 / Categories 1 / SEO 3) update in real time.
- `Publish this` button toggles from disabled to active exactly when `_canPublish` flips true.
- Mobile drawer toggles open/close; rail content renders.
- No console errors throughout the regression flow (only the expected Lit dev-mode warnings).
- TypeScript build is clean (`npx tsc --noEmit` exits 0).

## Diffs that landed

- [src/main.ts:2207](src/main.ts:2207) — `_setSimpleField` now calls `_maybeAutoSlug` when the field is `'title'` (covers video, calculator, user_story thumbnail-adjacent paths).
- [src/main.ts:2212](src/main.ts:2212) — new `_maybeAutoSlug(title)` helper centralises the "if `_slugAutoFromTitle`, derive slug" rule.
- [src/main.ts:2960](src/main.ts:2960) — `_setArticleTitle` calls `_maybeAutoSlug`.
- Inline-H1 onCommit handlers for money_tip, checklist, quiz, expert_insight, infographic, user_story now call `_maybeAutoSlug` after their type-specific updater.
- [src/main.ts:1010](src/main.ts:1010) — right-rail body shows readiness + tabs whenever `hasOutput || creationMode === 'manual'`. Empty-state copy switches per mode.
- [src/main.ts:273](src/main.ts:273) — `_openEntry` rehydrates `creationMode` from the entry (default `'ai'` for legacy data).
- [src/main.ts:646](src/main.ts:646) — `_save` payload now carries `creationMode`.
- [src/main.ts:683](src/main.ts:683) — `_publish` early-returns when `_canPublish` is false.
- [src/lib/store.ts](src/lib/store.ts) — `ContentEntry.creationMode` field, defaulted in `ENTRY_DEFAULTS` and `migrate`, plumbed through `SaveInput` / `createEntry` / `updateEntry`.
- [src/lib/articles.ts:422](src/lib/articles.ts:422) — CMS-imported entries default `creationMode: 'ai'`.

## Remaining known issues / future improvements

These were observed during the audit but were out of scope (already noted in CLAUDE.md as deferred work, or one-off polish):

- **Quiz** — no UI for per-answer `isCorrect` / `pointValue` toggles or `correctAnswerIds`. Knowledge/tiered scoring still has to be filled by hand in JSON. Already deferred.
- **Checklist** — no UI for per-section `image` or `subItems`. Already deferred.
- **Featured image** — pasting a non-image URL is accepted silently; no client-side validation that the URL points at an image. Minor.
- **Video** — `reference_link` does not validate the URL shape (vimeo/youtube/raw URL). Acceptable for v1.
- **Article** — pure-empty canvas could use a one-line nudge ("Press / for blocks, or just start writing…" is shown; consider adding "or fill the right-rail title to get started" for first-time users). Polish only.
- **CMS entries** — get `creationMode: 'ai'` by default. Real CMS imports were never written by the new flow, so this is correct; just noting it for future imports.

None of these block manual mode. The acceptance criteria from the QA brief are all met:

- Every content type can be created manually. ✓
- Every required field can be filled. ✓
- Every visible button works or is intentionally disabled with a clear reason. ✓
- Save as draft works for incomplete content. ✓
- Publish is blocked until required fields are complete. ✓
- Publish works once required fields are complete. ✓
- Data persists after saving and reopening. ✓
- Library displays the saved content correctly. ✓
- No console errors occur during the tested flows. ✓
