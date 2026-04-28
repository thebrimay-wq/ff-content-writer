import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ContentEntry } from '../lib/store'
import { isJsonContent, parseJsonContent } from '../lib/contentTypeSchemas'
import type { AnyContent } from '../lib/contentTypeSchemas'
import { validate } from '../lib/validation'

/**
 * Ambient quality checklist.
 * Passively inspects the current draft + metadata and surfaces a live list of
 * signals: has CTA, has meta description, has related resources, has categories,
 * reading level, brand-voice flags.
 *
 * Each item is clickable — when clicked it emits a `quality-fix` event with a
 * payload the parent (ff-app) can route to the appropriate AI handler.
 *
 * Emits:
 *   - 'quality-fix' detail: { kind: string; instruction: string }
 *       Parent decides whether to run a refinement, jump to a field, etc.
 *   - 'quality-jump-tab' detail: string (tab id for details panel)
 */

type Status = 'ok' | 'missing' | 'warn'

interface Signal {
  key: string
  label: string
  status: Status
  /** Called when user clicks the row — may emit events, jump tabs, etc. */
  onClick?: () => void
  hint?: string
}

@customElement('ff-quality-check')
export class FFQualityCheck extends LitElement {
  override createRenderRoot() { return this }

  @property({ type: Object }) entry: ContentEntry | null = null
  @property() output = ''
  @property() contentType = 'article'
  /** The current sidebar topic. Counts as "has title" even before the first save. */
  @property() topic = ''

  @state() private _collapsed = false

  private _emit<T>(name: string, detail: T) {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true }))
  }

  private _fix(kind: string, instruction: string) {
    this._emit('quality-fix', { kind, instruction })
  }

  private _jumpTab(tab: string) {
    this._emit('quality-jump-tab', tab)
  }

  // ── Signal detection ─────────────────────────────────────────────────────────

  private _parsedJson(): AnyContent | null {
    if (!isJsonContent(this.contentType)) return null
    if (!this.output.trim()) return null
    try { return parseJsonContent(this.output) } catch { return null }
  }

  private _wordCount(text: string): number {
    const t = text.replace(/[#*_`>\[\]\(\)-]/g, ' ').trim()
    if (!t) return 0
    return t.split(/\s+/).filter(Boolean).length
  }

  /** Cheap Flesch-Kincaid-ish grade level. Good enough for a nudge. */
  private _readingGrade(text: string): number | null {
    const clean = text.replace(/[#*_`>\[\]\(\)-]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!clean) return null
    const sentences = clean.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1
    const words = clean.split(/\s+/).filter(Boolean)
    if (words.length < 10) return null
    // Very rough syllable count: vowel groups per word.
    let syllables = 0
    for (const w of words) {
      const m = w.toLowerCase().match(/[aeiouy]+/g)
      syllables += Math.max(1, m?.length ?? 1)
    }
    const asl = words.length / sentences
    const asw = syllables / words.length
    // Flesch-Kincaid Grade Level
    return Math.round((0.39 * asl + 11.8 * asw - 15.59) * 10) / 10
  }

  /** Rough hits for jargon / passive phrasing that violates FF's warm-voice guidance. */
  private _brandVoiceFlags(text: string): string[] {
    const lower = ` ${text.toLowerCase()} `
    const jargon = [
      'leverage', 'synergy', 'utilize', 'stakeholders', 'best-in-class',
      'ecosystem', 'empower', 'robust', 'paradigm', 'bandwidth',
    ]
    const found: string[] = []
    for (const j of jargon) {
      if (lower.includes(` ${j} `) || lower.includes(` ${j},`) || lower.includes(` ${j}.`)) found.push(j)
    }
    return found
  }

  private _hasMarkdownCta(md: string): boolean {
    return /(^|\n)##\s*cta\b/i.test(md) || /\bcall to action\b/i.test(md)
  }

  private _hasMarkdownMeta(md: string): boolean {
    return /(^|\n)##\s*metadata\b/i.test(md) || /meta[- ]?description/i.test(md)
  }

  private _signals(): Signal[] {
    const e = this.entry
    const out = this.output ?? ''
    const signals: Signal[] = []
    const json = this._parsedJson()

    // Title — mirrors deriveTitle() in store.ts so we treat as "present"
    // anything that will end up as the saved title. Includes the sidebar topic
    // (relevant for unsaved drafts) and the first-line fallback.
    const firstLineTitle = (() => {
      const firstLine = out.split('\n').map(l => l.trim()).find(Boolean) ?? ''
      const cleaned = firstLine.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()
      return cleaned.length >= 3 ? cleaned : ''
    })()
    const jsonTitle = json ? ((json as { title?: string }).title ?? '').trim() : ''
    const hasTitle =
      !!this.topic.trim() ||
      !!(e?.title?.trim() && e.title !== 'Untitled draft') ||
      !!jsonTitle ||
      !!firstLineTitle
    signals.push({
      key: 'title',
      label: 'Title',
      status: hasTitle ? 'ok' : 'missing',
      onClick: hasTitle ? undefined : () => this._fix('title', 'Write a short, specific title for this piece (max 80 chars). Return only the title, no quotes.'),
    })

    // Content body exists
    const wc = this._wordCount(out)
    const hasBody = wc > 25
    signals.push({
      key: 'body',
      label: `Body (${wc.toLocaleString()} words)`,
      status: hasBody ? 'ok' : wc > 0 ? 'warn' : 'missing',
      hint: hasBody ? undefined : 'At least 25 words recommended',
    })

    // CTA — article only
    if (this.contentType === 'article') {
      const hasCta = this._hasMarkdownCta(out)
      signals.push({
        key: 'cta',
        label: 'CTA',
        status: hasCta ? 'ok' : 'missing',
        onClick: hasCta ? undefined : () => this._fix('cta', 'Add a short, action-oriented CTA section under a "## CTA" heading. One or two sentences, direct and warm.'),
      })

      const hasMeta = this._hasMarkdownMeta(out)
      signals.push({
        key: 'meta',
        label: 'Meta description',
        status: hasMeta ? 'ok' : 'missing',
        onClick: hasMeta ? undefined : () => this._fix('meta', 'Add a "## Metadata" section with a compelling SEO meta description (150–160 characters). Keep the rest of the document unchanged.'),
      })
    }

    // Excerpt (all types)
    if (e) {
      const hasExcerpt = !!e.excerpt?.trim()
      signals.push({
        key: 'excerpt',
        label: 'Excerpt',
        status: hasExcerpt ? 'ok' : 'missing',
        onClick: hasExcerpt ? undefined : () => this._fix('excerpt', 'Write a 1–2 sentence library excerpt for this piece (max 210 characters). Return only the excerpt.'),
      })

      const hasCategories = (e.categories?.length ?? 0) > 0
      signals.push({
        key: 'categories',
        label: 'Categories',
        status: hasCategories ? 'ok' : 'missing',
        onClick: hasCategories ? undefined : () => this._jumpTab('categories'),
      })

      const hasSlug = !!e.slug?.trim()
      signals.push({
        key: 'slug',
        label: 'Slug',
        status: hasSlug ? 'ok' : 'missing',
        onClick: hasSlug ? undefined : () => this._jumpTab('publish'),
      })

      const hasAuthor = !!e.author?.trim()
      signals.push({
        key: 'author',
        label: 'Author',
        status: hasAuthor ? 'ok' : 'warn',
        onClick: hasAuthor ? undefined : () => this._jumpTab('publish'),
      })
    }

    // Structured (JSON) types: run validator, surface worst blocker as a signal
    if (json) {
      const v = validate(json)
      if (!v.valid) {
        signals.push({
          key: 'structure',
          label: `Structure (${v.blockingCount} issue${v.blockingCount !== 1 ? 's' : ''})`,
          status: 'missing',
          hint: v.errors.find(e => e.severity === 'blocking')?.message,
        })
      } else {
        signals.push({ key: 'structure', label: 'Structure valid', status: 'ok' })
      }
    }

    // Reading level (only for long enough prose)
    if (this.contentType === 'article' && wc > 80) {
      const grade = this._readingGrade(out)
      if (grade !== null) {
        const onTarget = grade >= 7 && grade <= 10
        signals.push({
          key: 'reading',
          label: `Reading level ~grade ${grade}`,
          status: onTarget ? 'ok' : 'warn',
          hint: onTarget ? undefined : grade > 10 ? 'Aim for grade 7–10 for general audience' : 'A touch too simple — may feel thin',
          onClick: onTarget ? undefined : () => this._fix('reading',
            grade > 10
              ? 'Simplify the language to around a grade 8 reading level. Shorter sentences, fewer subordinate clauses, plainer words. Keep all meaning and structure.'
              : 'Tighten the prose — add a touch more specificity and richer examples. Keep it readable, but avoid feeling under-explained.',
          ),
        })
      }
    }

    // Brand voice — only flag if at least one hit
    if (wc > 40) {
      const flags = this._brandVoiceFlags(out)
      if (flags.length > 0) {
        signals.push({
          key: 'voice',
          label: `Brand voice: ${flags.length} flag${flags.length !== 1 ? 's' : ''}`,
          status: 'warn',
          hint: `Jargon: ${flags.join(', ')}`,
          onClick: () => this._fix('voice', `Rewrite to remove corporate jargon (flagged: ${flags.join(', ')}). Keep FF's warm, plain-spoken tone. Preserve meaning and structure.`),
        })
      } else {
        signals.push({ key: 'voice', label: 'Brand voice clean', status: 'ok' })
      }
    }

    return signals
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  private _statusIcon(status: Status) {
    if (status === 'ok') {
      return html`
        <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 shrink-0">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="#059669" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      `
    }
    if (status === 'warn') {
      return html`
        <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 shrink-0">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M4 1.5V5" stroke="#B45309" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="4" cy="6.5" r="0.7" fill="#B45309"/>
          </svg>
        </span>
      `
    }
    return html`
      <span class="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-200 shrink-0"></span>
    `
  }

  override render() {
    const signals = this._signals()
    const okCount = signals.filter(s => s.status === 'ok').length
    const total = signals.length
    const pct = total > 0 ? Math.round((okCount / total) * 100) : 0
    const allOk = okCount === total && total > 0

    return html`
      <section class="border border-gray-200 rounded-lg overflow-hidden">
        <button
          @click=${() => { this._collapsed = !this._collapsed }}
          class="w-full flex items-center justify-between px-4 h-10 bg-[#063853] text-white text-[12px] font-bold cursor-pointer select-none"
        >
          <span class="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1L7.12 4.88L11 6L7.12 7.12L6 11L4.88 7.12L1 6L4.88 4.88L6 1Z" fill="currentColor"/>
            </svg>
            Quality check
          </span>
          <span class="flex items-center gap-2">
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${allOk ? 'bg-emerald-400/30' : 'bg-white/20'}">
              ${okCount}/${total}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="transition-transform ${this._collapsed ? '' : 'rotate-180'}">
              <path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </button>
        ${this._collapsed ? '' : html`
          <div class="p-3 space-y-2">
            <!-- Progress bar -->
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all ${allOk ? 'bg-emerald-500' : 'bg-[#063853]'}"
                  style="width:${pct}%"
                ></div>
              </div>
              <span class="text-[10px] text-gray-400 font-semibold tabular-nums">${pct}%</span>
            </div>

            <ul class="space-y-1">
              ${signals.map(s => {
                const interactive = !!s.onClick
                return html`
                  <li
                    class="flex items-start gap-2 px-2 py-1.5 rounded-md text-[12px] ${
                      interactive ? 'hover:bg-gray-50 cursor-pointer' : ''
                    }"
                    @click=${() => s.onClick?.()}
                    title=${interactive ? 'Click to fix' : s.hint ?? ''}
                  >
                    ${this._statusIcon(s.status)}
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between gap-2">
                        <span class="${
                          s.status === 'ok' ? 'text-gray-500' :
                          s.status === 'warn' ? 'text-amber-800' :
                          'text-gray-700 font-medium'
                        }">${s.label}</span>
                        ${interactive ? html`
                          <span class="text-[10px] text-[#063853] font-semibold shrink-0">Fix →</span>
                        ` : ''}
                      </div>
                      ${s.hint ? html`<p class="text-[10px] text-gray-400 mt-0.5">${s.hint}</p>` : ''}
                    </div>
                  </li>
                `
              })}
            </ul>

            ${total === 0 ? html`
              <p class="text-[11px] text-gray-400 text-center py-2">Generate or save a draft to see quality checks.</p>
            ` : ''}
          </div>
        `}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-quality-check': FFQualityCheck }
}
