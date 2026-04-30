# QA Regression — Write it yourself mode (post-fix, Add block + Switch to AI)

Date: 2026-04-30
Branch: main
Tester: hands-on browser QA via Vite dev server (port 3003), localStorage cleared before each pass.

This regression covers the two P1 bugs documented in `QA_WRITE_IT_YOURSELF_REPORT.md` (Add block targeting the wrong editor; switching to AI silently destroying manual work) and re-validates the prior-pass items still hold.

## What was retested

| ID | What was retested | Result |
| --- | --- | --- |
| BUG-A | Article → Write it myself → click `Add block`. | **PASS** — focus lands on the body editor, not the title H1; `/` is inserted into the body; slash menu opens anchored to the body; title is untouched. Verified via live DOM inspection: `activeIsBody: true`, `bodyText: "/"`, `titleText: ""`. |
| BUG-A follow-on | Pick a block from the slash menu after clicking Add block. | **PASS** — block lands in the body editor (`<p>` element appended to `[data-article-body="true"]`). |
| BUG-B (modal trigger) | Manual draft non-empty → click `With AI` tab. | **PASS** — confirmation modal opens, mode is **not** flipped, output preserved, dialog has `role="dialog"`, `aria-modal="true"`, `aria-labelledby="ff-aiflip-title"`. |
| BUG-B (Use as context) | Pick "Use what I've written as AI context". | **PASS** — `creationMode = 'ai'`, `output` preserved, `_seoArticle` populated with the manual draft. The existing prompt builder ([src/lib/api.ts:106](src/lib/api.ts:106)) treats `_seoArticle` as primary factual basis on Generate, so the AI sees the manual content. |
| BUG-B (Start fresh) | Pick "Start fresh with AI". | **PASS** — `creationMode = 'ai'`, `output` cleared, `_seoArticle` untouched. The previous draft is pushed to undo before clearing. |
| BUG-B (Cancel) | Click Cancel (or Escape). | **PASS** — `creationMode` stays `manual`, `output` preserved, modal closes. |
| BUG-B (no manual content) | Flip Manual → AI with no manual content. | **PASS** — flips silently with no modal. The empty JSON shell that gets seeded for non-article types does not trigger the modal because `_hasMeaningfulManualContent()` checks title + dirty state. |
| Modal focus management | Open / close the new modal. | **PASS** — first option auto-focuses on open via `data-modal-autofocus="aiflip"`; previous focus restored on close; Escape closes. |

## Prior-pass items rechecked (still passing)

- `Save as draft` writes a `ContentEntry` with `creationMode: 'manual'` and survives reload.
- Reopen from Library rehydrates `creationMode`, content type, slug, excerpt, meta description, categories, featured image, and body.
- Inline H1 title commit auto-derives the URL slug for every content type.
- Right-rail Publish Readiness checklist + tab badges visible immediately in manual mode (no longer gated on `output.trim()`).
- Publish blocked while readiness items are missing; `_publish()` early-returns when `!_canPublish`.
- All 9 content types render their type-specific manual canvas. Add slide / Add section / Add question / Add answer / Add result / Add item / Add sub-item / Add tip / Add related resource — all functional.
- TypeScript build is clean (`npx tsc --noEmit` exits 0).
- No console errors during the retested flows.

## Diffs that landed

- [src/main.ts:2369](src/main.ts:2369) — article body div tagged with `data-article-body="true"` so it can be targeted unambiguously.
- [src/main.ts:2238](src/main.ts:2238) — `_focusEndAndOpenSlash` now queries `[data-article-body="true"]` instead of the generic `[data-rewrite="true"]`. Comment added explaining why.
- [src/main.ts:194](src/main.ts:194) — new `_aiFlipPromptOpen` state.
- [src/main.ts:399](src/main.ts:399) — `_flipMode` short-circuits to open the confirmation modal when going manual → ai with meaningful manual content. Empty drafts still flip silently.
- [src/main.ts:413](src/main.ts:413) — new `_hasMeaningfulManualContent()` helper.
- [src/main.ts:425](src/main.ts:425) — new `_flipToAiUseContext()`: copies the manual draft into `_seoArticle`, flips mode, preserves output.
- [src/main.ts:443](src/main.ts:443) — new `_flipToAiStartFresh()`: clears output (pushed to undo first), flips mode.
- [src/main.ts:459](src/main.ts:459) — new `_jsonAsContextText()` helper used by the Use-as-context path for non-article types.
- [src/main.ts:1909](src/main.ts:1909) — top-level render now mounts the new modal.
- [src/main.ts:1915](src/main.ts:1915) — new `_renderAiFlipPrompt()` modal: three options (Use as context / Start fresh / Cancel), proper `role="dialog"` + `aria-modal` + `aria-labelledby`.
- [src/main.ts:3796](src/main.ts:3796) — `_prevAiFlipPromptOpen` rising-edge tracker for focus management.
- [src/main.ts:3811](src/main.ts:3811) — `updated()` lifecycle hooks the new modal into the existing focus-on-open / restore-on-close machinery.

## Acceptance criteria — final check

- Every content type can be manually created. ✓
- Real sample content can be typed into every content type. ✓ (sweep done in the report)
- Add block works on articles. ✓
- Save as draft works. ✓
- Reopening saved drafts preserves data including `creationMode`. ✓
- Publish validation works. ✓
- Publish works when required fields are complete. ✓
- Switching from Write it yourself to AI is now safe — the writer is asked, the manual draft is preserved as AI context if they want it, and "Start fresh" is gated behind an explicit confirm. ✓
- No unrelated parts of the app were changed. ✓ (Library, AI assist generation, and the other rendered surfaces are untouched.)

## Remaining known issues / future improvements

These are unchanged from the prior pass and remain out of scope:

- **Featured image** — pasting a non-image URL is accepted silently.
- **Video** — `reference_link` does not validate vimeo / youtube / raw URL shapes.
- **Article empty-state polish** — first-time onboarding nudge could be stronger.
- **CMS-imported entries** default to `creationMode: 'ai'` — correct for legacy data.

None of these block manual mode.
