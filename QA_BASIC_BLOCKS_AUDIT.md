# QA — Slash-command basic blocks audit

## Summary

The article body editor was duplicating any slash-inserted block (e.g. selecting "Heading" from the menu produced two `<h2>` elements in the DOM). Root cause: `${unsafeHTML(bodyHtml)}` was rendered between Lit comment markers _inside_ the `contenteditable` editor surface. The browser parked user-typed content (and the HTML inserted by `execCommand`) outside those markers, then the post-insert `this.output = …` re-render produced a second copy between the markers — leaving both visible.

The fix removes the `unsafeHTML` child expression from the article body and instead syncs the editor's `innerHTML` imperatively in `updated()` — the same pattern the codebase already uses for `data-ce-text` inline editors. A new force-sync flag (`_articleBodyForceSync`) lets the slash-insert path canonicalize the DOM even while the editor has focus.

## Reproduction (before fix)

1. Open the app, click **New content** → **Write it myself**.
2. Click into the body editor.
3. Type `/`.
4. Pick **Heading** from the menu.
5. Inspect the body DOM — two `<h2>Heading</h2>` elements present.

Confirmed in browser preview before the fix:
```
<h2>Heading</h2><!--?lit$852604004$--><h2>Heading</h2>
```

## Root cause

`src/main.ts` line 2599 (pre-fix) rendered the contenteditable surface as:
```ts
<div data-article-body="true" contenteditable="true" ...>${unsafeHTML(bodyHtml)}</div>
```

`unsafeHTML` produces a Lit `ChildPart` bounded by two comment markers (`<!--?lit$…-->`). Inside a contenteditable element:

- When the editor was empty, the markers sat adjacent at the start of the div.
- The user clicked, the cursor landed at offset 0 (before both markers), and any typed character was inserted as a text node **outside** the part Lit manages.
- `_insertSlashBlock` ran `document.execCommand('insertHTML', …, '<h2>…</h2>')` which replaced the typed `/` with `<h2>` — also outside the markers.
- `_insertSlashBlock` then called `this.output = htmlToMarkdown(editor.innerHTML)`. Lit re-rendered: the directive set the content **between** the markers to the new `<h2>`. The original execCommand-inserted `<h2>` was untouched outside the markers — duplicate result.

The codebase already documents this exact pitfall around the `data-ce-text` helper (`src/main.ts:3978-3995`); it just wasn't applied to the article body.

## Files / components involved

- [src/main.ts:2578](src/main.ts) — article-body render path (removed `unsafeHTML`).
- [src/main.ts:3978](src/main.ts) — `updated()` lifecycle (extended to sync the article body).
- [src/main.ts:4783](src/main.ts) — `_insertSlashBlock` (sets force-sync flag, restores caret to last block).
- [src/main.ts:4854](src/main.ts) — new `_placeCaretAtEditorEnd` helper.

## Fix implemented

1. **Removed** the Lit child expression `${unsafeHTML(bodyHtml)}` from the article body editor; the div is rendered with no Lit-managed children, so no comment markers land inside the contenteditable.
2. **Added imperative sync** in `updated()`: when `contentType === 'article'`, set `editor.innerHTML` to `marked.parse(_articleBody())` (or `<p><br></p>` when the body is empty so the user always types into a paragraph). The sync is skipped when the editor has focus, _unless_ the new `_articleBodyForceSync` flag is set.
3. **Slash insert** now sets `_articleBodyForceSync = true` after computing the new markdown, then restores the caret at the end of the last block once Lit's update completes — so the user can keep typing in the block they just inserted.
4. **Empty-state seed** of `<p><br></p>` ensures the cursor lands inside a real block element on first focus, eliminating the orphan-text-node failure mode.

## Basic blocks tested (post-fix, Write it myself mode)

| Block | Slash output | Markdown saved | DOM after re-render | Result |
| --- | --- | --- | --- | --- |
| Text (`<p><br></p>`) | `<p><br></p>` | `""` | single empty paragraph | ✅ Insert OK (no-op for empty) |
| Heading (`<h2>`) | `<h2>Heading</h2>` | `## Heading` | `<h2>Heading</h2>` | ✅ Single block, output canonical |
| Subheading (`<h3>`) | `<h3>Subheading</h3>` | `### Subheading` | `<h3>Subheading</h3>` | ✅ Single block |
| Bulleted list (`<ul>`) | `<ul><li>Item</li></ul>` | `- Item` | `<ul><li>Item</li></ul>` | ✅ Single block |
| Numbered list (`<ol>`) | `<ol><li>Item</li></ol>` | `1. Item` | `<ol><li>Item</li></ol>` | ✅ Single block |
| Quote (`<blockquote>`) | `<blockquote><p>Quote</p></blockquote>` | `> Quote` | `<blockquote>…</blockquote>` | ✅ Single block |
| Divider (`<hr>`) | `<hr>` | `---` | `<hr>` | ✅ Single block |
| Table (`<table>`) | `<p>Column 1Column 2CellCellCellCell</p>` | (flattened text) | n/a | ⚠️ See "Known issues" |

In every case after the fix:
- Slash menu closes after selection.
- `_slashOpen` is `false` after click.
- Caret moves into the inserted block; further typing extends it (verified — typing "my heading" after Heading insert produced `<h2>Heading my heading</h2>`).
- No duplicate empty paragraph is left behind.
- No console errors.

## Modes tested

### Write it myself
- Fresh empty article → slash insert each block: ✅ (table excepted, see below).
- Type intro paragraph → `/` → Heading: produces `<p>Intro paragraph.</p><h2>Heading</h2>`, no duplicates.
- Sequential inserts (Heading, then Enter, then Bulleted list): produces clean `<p>…</p><h2>…</h2><ul><li>…</li></ul>` with no orphan blocks.
- Save as draft → entry saved (verified `localStorage.ff_content_library_v1` populated, `_currentStatus === 'draft'`).

### Draft with AI
- Simulated AI-prefilled body (`output = "# Title\n\nThis is body paragraph one.\n\nThis is body paragraph two."`) → place caret at end → press Enter → `/` → Heading.
- Result: `<p>This is body paragraph one.</p><p>This is body paragraph two.</p><h2>Heading</h2>` — manual block appended cleanly, AI body intact.
- The "Add block" button (`_focusEndAndOpenSlash`) was also exercised against a pre-filled body and produced a clean append for Divider.

## Content-type coverage

The slash menu is gated on `this.contentType === 'article'` at [src/main.ts:4716](src/main.ts:4716). The "Add block" button only renders inside the article template ([src/main.ts:2601](src/main.ts:2601)). Pressing `/` in any other content type's editor surface is a no-op. Verified live for `money_tip` and `checklist`; the gate is unconditional in code so the remaining JSON-backed types behave the same.

| Content type | Body model | Slash menu? | Verified | Notes |
| --- | --- | --- | --- | --- |
| `article` | markdown | yes | ✅ | All eight blocks audited above |
| `money_tip` | JSON | no | ✅ live | `/` is a literal character, no menu opens |
| `checklist` | JSON | no | ✅ live | same |
| `quiz` | JSON | no | code-verified | gate excludes it |
| `expert_insight` | JSON | no | code-verified | gate excludes it |
| `user_story` | JSON | no | code-verified | gate excludes it |
| `video` | JSON | no | code-verified | gate excludes it |
| `calculator` | JSON | no | code-verified | gate excludes it |
| `infographic` | JSON | no | code-verified | gate excludes it |

The non-article types each have their own structured renderers; their inline editable surfaces (`v?.copy`, `c?.body`, etc.) are independent of the article body and were not touched by this fix.

## Known remaining issues (out of scope for this fix)

- **Table block does not roundtrip through markdown.** The slash menu inserts a `<table>` element, but `domToMarkdown` (`src/main.ts:4905`) has no case for `table`/`thead`/`tbody`/`tr`/`td`/`th` — they fall through `default` which concatenates their text content. As a result, saving a table flattens it to a single paragraph. This is a pre-existing limitation of the markdown converter; the slash menu itself inserts and renders one block (no duplication), so the duplication bug is fully resolved. Tracking table-roundtrip support would require either keeping an HTML side-channel for tables or replacing the markdown storage layer for tables specifically.
- **Bare top-level text + heading sequence.** When a bare text node (no wrapping `<p>`) immediately precedes a block element, `domToMarkdown` produces `Hello world## Heading` (no separator) which `marked` then renders as a single `<p>`. The `<p><br></p>` empty-state seed avoids this in the normal flow because the cursor always lands inside a paragraph; only manual DOM manipulation can produce the bare-text edge case post-fix.

## Regression test (post-fix)

- Header 1 (and every other basic block) inserts exactly once. ✅
- Slash menu closes after insertion (`_slashOpen === false`). ✅
- Caret lands inside the new block; subsequent typing extends it. ✅
- Blocks can be deleted via the normal contenteditable path. ✅ (no change there).
- Save-as-draft persists; markdown stored in `localStorage` is canonical. ✅
- HTML/Markdown source viewer (`</>`) reflects the saved markdown. ✅ (no change there).
- Write-it-myself and Draft-with-AI modes both work. ✅
- No console errors during any test. ✅
