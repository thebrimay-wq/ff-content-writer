# AI Content Writer

The writing tool for Financial Finesse content. Marketing name candidate: **Margin** ("Make room for what matters."). Currently labeled **AI Content Writer** in-product until naming is finalized.

Live at https://thebrimay-wq.github.io/ff-content-writer/

## How to work in this repo

- **Read `memory/` first** — that's where the deep context lives without re-burning tokens. Especially `memory/architecture.md` and `memory/git-deploy.md`.
- **For repeated operations, see `skills/`** — recipe-style how-tos for shipping, adding content types, extending the help modal, etc.
- **Bri's preferences:** minimal tokens, design-forward, plain prose (not bullet-heavy), no emoji unless asked. Treat her as a colleague, not a customer. Full notes in `memory/user-preferences.md`.

## Stack

Lit 3 + Vite + TypeScript + Tailwind. Custom element `<ff-app>` (light DOM, no shadow). Storage: browser localStorage. Markdown via `marked`. AI: Anthropic API direct from browser, model `claude-sonnet-4-6`.

## File map (post v2 migration)

- `src/main.ts` — the entire app, single Lit component `<ff-app>`. ~5,800 lines.
- `src/index.css` — Tailwind directives + ff-prose typography + easter-egg animations.
- `src/components/ff-library.ts` — the redesigned grouped-row library table. Imported by `main.ts`.
- `src/lib/` — production-grade shared code: `api.ts` (streamMessage + message builders), `systemPrompt.ts` / `jsonSystemPrompt.ts` (FF voice), `contentTypeSchemas.ts` (the 9 type shapes + parse helpers), `store.ts` (localStorage CRUD), `articles.ts` (CMS articles), `validation.ts`, `versionConfig.ts`, `taxonomy.ts`.
- `public/coaches/` — 29 planner headshots (slug-named PNGs) used by the Expert Insight cards and the easter-egg coach cameo.
- `index.html` — root entry, loads `/src/main.ts`. Lato font from Google.
- `.github/workflows/deploy.yml` — GH Actions builds + deploys on push to main.

## Canonical brand button

Every primary CTA in this app uses `<ff-brand-button>` from [src/components/ff-brand-button.ts](src/components/ff-brand-button.ts). It is the **single source of truth** for the brand button across the FF AI Workspace ecosystem (this repo + AI Meeting Studio + AI Assessment Studio). Sibling apps implement the equivalent React primitive — they must stay visually identical.

```html
<ff-brand-button @click=${...}>New content</ff-brand-button>

<ff-brand-button size="sm" ?disabled=${!ready} @click=${...}>
  Submit for review
  <svg slot="trailing" ...></svg>
</ff-brand-button>

<ff-brand-button variant="ai" size="lg" shortcut="⌘ R">
  <svg slot="icon" ...></svg>
  Summarize
</ff-brand-button>
```

**Variants** — `primary` (default, navy pill) · `ai` (violet pill, AI-only) · `ghost` (flat charcoal, secondary actions).
**Sizes** — `sm` (28px) · `md` (32px, default) · `lg` (40px, hero placements).
**Slots** — default (label) · `icon` (leading) · `trailing` (trailing icon).
**Props** — `disabled`, `type`, `shortcut`.

**Rules**
- Never roll your own navy pill or `bg-[#063853] hover:bg-[#04293D]` button. Always use `<ff-brand-button>`.
- The canonical button is a *pill* (`rounded-full`). Do not introduce square or `rounded-md` CTAs that compete with it.
- If you change padding, radius, color, or shadow on the Lit primitive, port the same change to `ff-meeting-studio/src/components/BrandButton.tsx` (and any future sibling app's equivalent) in the same PR cycle. The workspace must stay visually unified.
- The `ai` variant is reserved for AI / generative actions only (summarize, rewrite, suggest). Never for non-AI actions.

Existing decorative `bg-[#063853]` uses (tabs, badges, dots, avatars, segmented controls) are **not** buttons and intentionally not refactored.

## Project rules (do not deviate)

- Git root IS this folder. Remote is named `origin` → https://github.com/thebrimay-wq/ff-content-writer.git.
- **Always stage scoped paths.** Never `git add -A` and never `git add .` — see `memory/git-deploy.md` for the exact recipe.
- The GitHub Actions workflow runs `npm run build` and deploys `dist/`. We never commit `dist/`.
- Never create a git worktree unless explicitly asked.
- Local-only files in the project root (don't commit): `.env*`, `node_modules/`, `*.docx`, `documents/`, `ff-content-explanations/`, `real-ff-content/`, `images/`. The `.gitignore` covers most of these.

## What's built today

Intent gate (Draft with AI / Write it myself + region/language). Sidebar with mode flip, content type, audience, topic, notes, generate. Notion-style center pane: locked title + read-time + divider + body. Slash command (`/`) block menu, side-anchored selection toolbar with B/I/U/strike/link/internal-link + AI rewrites, Before/After diff with Accept/Reject. Inline structural editing for every content type (cards, items, questions, sections, coach voices). Table editing toolbar, Word-paste sanitizer, internal-article link modal, undo/redo with shortcuts, scaffolding-strip on AI output (Intro/Body/CTA/Meta), HTML/source admin viewer, Library tab with grouped-variant rows. Easter eggs: corner sparkle trail, gate-greeting on bottom-left, coach cameo on bottom-right (real photos), confetti on first publish. Help modal: `?` icon in header + first-visit auto-open with localStorage dismissal.

## What's pending

Product naming decision. The `.pre-restructure` backup folder at `~/Desktop/GitHub FF/FF-Content-Writer.pre-restructure/` is safe to delete once we're confident. `actions/upload-artifact@v4` Node 20 deprecation lands Sept 2026. The orphaned `~/.git` and `~/.github` from the pre-migration repo layout are harmless but cleanup-worthy.

## When you're stuck

If something in the editor surfaces feels off, reach for `memory/architecture.md` first — there are several non-obvious conventions (articles split title from body via a markdown roundtrip; the slash menu's "/" is the literal character in the DOM that gets replaced on insert; selection AI snapshots a Range so Accept can splice into the same place). Reading code without that context will burn tokens.
