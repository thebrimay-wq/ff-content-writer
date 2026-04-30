# QA Audit — Write it yourself mode (focused re-audit)

Date: 2026-04-30
Branch: main
Tester: hands-on browser QA via Vite dev server (port 3003), localStorage cleared before each pass. Inspection extends and supersedes the prior `QA_WRITE_IT_MYSELF_REPORT.md` / `QA_WRITE_IT_MYSELF_REGRESSION.md` audit. The earlier P1/P2 fixes from that pass are confirmed still in place; this report only documents the new bugs surfaced by the user's brief (Add block, switch to AI) plus a couple of supporting issues found while retesting every content type.

## Scope

- `New Content → Write it myself` flow only.
- All 9 content types: `article`, `money_tip`, `checklist`, `quiz`, `expert_insight`, `user_story`, `video`, `calculator`, `infographic`.
- Add block button at the bottom of an article in manual mode.
- Switching mid-flow from `Write it myself` → `Draft with AI`.
- Save as draft / reopen / publish gating.

Out of scope (not retouched): Library beyond reopening drafts, AI generation prompts themselves, and unrelated UI surfaces.

## Bugs found

### BUG-A — Article "Add block" button targets the title H1 instead of the body editor (P1, blocking)

**Where:** [src/main.ts:2235-2248](src/main.ts:2235) — `_focusEndAndOpenSlash()`.

```ts
const editor = this.querySelector('[data-rewrite="true"]') as HTMLElement | null
```

**Symptom:** clicking `Add block` at the end of an article in Write-it-myself mode does not add a body block. Instead:

1. Focus moves to the article title H1 (the first `[data-rewrite="true"]` in the DOM).
2. `document.execCommand('insertText', false, '/')` appends a `/` to the title text.
3. The slash menu opens anchored to the title, not the body.
4. Picking a block from the menu inserts the block **into the title**, corrupting the article title.
5. Closing the slash menu via Escape leaves a stray `<br>` in the title (execCommand artifact).

Verified live in the dev server:

```
output: ""
slashOpen: true
titleHTML: "/<!--?lit$…-->"
titleText: "/"
activeIsTitle: true
activeIsBody: false
```

**Root cause:** the article H1 (rendered by `_renderTitleHeader` at [src/main.ts:3396-3404](src/main.ts:3396)) carries `data-rewrite="true"` because the rewrite-toolbar needs the title to be a rewrite target. The body editor at [src/main.ts:2363-2370](src/main.ts:2363) carries the same attribute. The H1 appears first in document order, so `querySelector('[data-rewrite="true"]')` always returns the title.

**Repro:**

1. New content → Write it myself → Article.
2. Scroll to the bottom, click `Add block — or press /`.
3. Open devtools and inspect: the H1 now contains `/`, the body div is still empty, slash menu is anchored to the title.

**Expected:**

- Click moves the caret to the end of the body editor.
- A new editable block is added to the body (via the slash menu picker).
- The title is untouched.
- The new block saves and reloads after reopening from Library.

### BUG-B — Switching to "Draft with AI" mid-flow silently destroys manual work (P1, blocking)

**Where:** [src/main.ts:393-400](src/main.ts:393) — `_flipMode(next)` and [src/main.ts:402-451](src/main.ts:402) — `_generate()`.

**Symptoms (combined):**

- The Blank ↔ With AI tab in the left sidebar flips `creationMode` without warning, even when the writer has already typed a substantial manual draft.
- After flipping to AI, the sidebar populates AI inputs (audience / topic / notes / expert sources). The center pane still shows the manual draft because `output` is preserved at flip time — the user reasonably assumes the AI is going to *use* what they've written.
- The AI sidebar's primary CTA flips to **Regenerate** (because `this.output` is non-empty). Clicking it calls `_generate()`, which immediately sets `this.output = ''` ([src/main.ts:424](src/main.ts:424)) and replaces the manual draft with the AI stream.
- The manual draft is **never** passed to the AI prompt as context. `buildUserMessage` / `buildJsonUserMessage` only see `topic`, `notes`, `expertSources`, and `seoArticle` — none of which the user has filled.
- Net effect: a user who clicks `With AI`, types a topic, and clicks Regenerate sees their entire manual draft replaced by an AI draft that has no knowledge of what they had written. No confirmation, no recovery (undo stack is wiped on Generate).

Verified live in the dev server:

```
// after clicking With AI tab with non-empty output:
creationMode: "ai"
output: "# My great manual article\n\nThis is the first paragraph I wrote myself.\n\nAnother paragraph with insights."

// rendered button is "Regenerate" (because output non-empty)
// _generate() unconditionally sets this.output = ''
```

**Root cause:** `_flipMode` was authored as a lossless visual toggle. It does not consult the writer about what to do with their manual draft, and it does not promote the manual draft into the AI context channel (`_seoArticle`). `_generate()` is also unaware of the prior output.

**Repro:**

1. New content → Write it myself → Article.
2. Type a title and a couple of paragraphs.
3. Click the `With AI` tab in the left sidebar.
4. Type a topic, click Regenerate.
5. Manual draft is wiped, replaced by AI output that does not know about the manual content.

**Expected (per user brief):**

- A `Use what you've written?` modal is shown when flipping manual → AI with non-empty manual content. Three options:
  - **Use as AI context** — preserves the manual draft, copies it into `_seoArticle`, switches to AI mode. Next Regenerate uses the manual draft as factual basis.
  - **Start fresh with AI** — clears `output`, switches to AI mode. Confirms before clearing.
  - **Cancel** — does not switch.
- Title, content type, and categories are preserved across the switch.

## Smaller findings (not blocking, but in scope)

### UX-A — Closing the slash menu after Add block leaves a stray `<br>` in the title

Caused by the same wrong-element bug above. Once Add block targets the body, the slash menu insertion / cancellation paths only mutate the body, so this artifact disappears as a side effect.

### UX-B — Article empty state on the canvas has no nudge toward Add block

Minor — the placeholder reads `Press / for blocks, or just start writing…`, which is fine. The Add block button is rendered below the body and is discoverable. Not changing.

## Content type sweep — what works

For each of the 9 types, I confirmed the manual canvas has the correct shape and primary controls work:

| Type | Title | Body / structure | Add controls | Save → reopen |
| --- | --- | --- | --- | --- |
| article | inline H1 | markdown body, `/`-menu blocks | `Add block` (broken — see BUG-A) | ✓ |
| money_tip | inline H1 (highlight target) | per-card preheading / heading / body | `Add slide` ✓, `Remove` ✓ | ✓ |
| checklist | inline H1 | per-section title / description / image / items / sub-items / tip | `Add section` / `Add item` / `Add sub-item` / `Add tip` ✓ | ✓ |
| quiz | inline H1 | quiz-type tabs, per-question text / answers / tip / explanation, rubric criteria | `Add question` / `Add answer` / `Add result` ✓ | ✓ |
| expert_insight | inline H1 | per-section coach select + body | `Add section` ✓, `Remove section` ✓ | ✓ |
| user_story | inline H1 | subtitle, thumbnail, copy, related | thumbnail upload ✓, related picker ✓ | ✓ |
| video | inline H1 | URL, thumbnail, copy, related | thumbnail upload ✓, related picker ✓ | ✓ |
| calculator | inline H1 | embed, thumbnail, copy, related | thumbnail upload ✓, related picker ✓ | ✓ |
| infographic | inline H1 (`_extras.title`) | thumbnail + infographic image + related | image upload ✓, related picker ✓ | ✓ |

Other confirmed-working behavior:

- `Save as draft` writes a `ContentEntry` with `creationMode: 'manual'` and persists across reload.
- Library shows manual drafts with the right type label and status.
- Reopen from Library rehydrates `creationMode`, content type, slug, excerpt, meta description, categories, featured image, and body.
- Inline H1 title commit derives the URL slug for every content type (BUG-1 fix from the prior pass).
- Right-rail Publish Readiness checklist + tab badges are visible and accurate immediately in manual mode (BUG-2 fix from the prior pass).
- Publish is blocked while readiness items are missing; defense-in-depth `_publish()` early-returns when `!_canPublish` (BUG-4 fix from the prior pass).
- Long-form Source / Sources are not required to publish in manual mode.

No console errors during the entire content-type sweep.

## Fix plan

1. **BUG-A — Add block targets the body.** Tag the article body editor with `data-article-body="true"` (or equivalent unique selector) and switch `_focusEndAndOpenSlash` to query that. Cleaner than `:not(h1)` because future renderers might reuse the H1 marker.

2. **BUG-B — Switch-to-AI confirmation flow.** Add a new modal state `_aiFlipPromptOpen`. When `_flipMode('ai')` is called from `manual` with non-empty manual content (`_hasMeaningfulManualContent()`), open the modal instead of flipping. The modal offers:
   - **Use as AI context** — copy the current manual draft (markdown for article, JSON-as-text for the others) into `_seoArticle`, set `creationMode = 'ai'`, leave `output` intact, mark dirty.
   - **Start fresh with AI** — clear `output` (article: `''`; JSON types: empty shell), set `creationMode = 'ai'`, reset undo stack so the previous draft can't be Ctrl-Z'd back into a half-state.
   - **Cancel** — close, do not flip.
   When `_seoArticle` is populated this way, the existing prompt builders ([src/lib/api.ts:106-117](src/lib/api.ts:106) and [src/lib/api.ts:281-305](src/lib/api.ts:281)) already pass it as primary factual basis to the AI on Generate. No prompt changes needed.

3. Plumb a "AI context preloaded from your manual draft" indicator next to the SEO tab badge when this happens, so the writer can see where their content went.

After fixes, retest the full Write-it-yourself flow and capture in `QA_WRITE_IT_YOURSELF_REGRESSION.md`.
