import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ContentEntry } from '../lib/store'
import { TYPE_LABELS } from '../lib/api'

/**
 * Ambient "similar content exists" nudge.
 * Lives under the Topic field in the sidebar. As the user types, matches
 * the current topic against every entry in the library and surfaces the
 * top three matches. Goal: stop staff from rewriting content that
 * already exists on the site.
 *
 * Pure-local scoring — no API calls — so it's instant and free.
 *
 * Emits:
 *   - 'open-similar' detail: ContentEntry  → parent loads it into the editor
 */

interface Scored {
  entry: ContentEntry
  score: number
}

@customElement('ff-similar-content')
export class FFSimilarContent extends LitElement {
  override createRenderRoot() { return this }

  @property() topic = ''
  @property({ type: Array }) entries: ContentEntry[] = []
  @property() currentEntryId: string | null = null

  @state() private _expanded = false
  @state() private _dismissedFor = ''   // remembers the query the user dismissed, so re-typing it doesn't reopen

  private _emit<T>(name: string, detail: T) {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true }))
  }

  /** Tokenize into useful lowercase words (>= 3 chars, no common stopwords). */
  private _tokenize(s: string): string[] {
    const STOP = new Set([
      'the','a','an','and','or','but','for','with','of','to','in','on','at','by',
      'is','are','was','were','be','been','being','it','its','this','that','these',
      'those','from','as','into','about','when','how','what','why','who','which',
      'your','you','our','my','me','i','us','we','they','them','their',
    ])
    return (s.match(/[a-z0-9]+/gi) ?? [])
      .map(w => w.toLowerCase())
      .filter(w => w.length >= 3 && !STOP.has(w))
  }

  /** Score each entry against the current topic. Higher = more similar. */
  private _score(topic: string): Scored[] {
    const qTokens = new Set(this._tokenize(topic))
    if (qTokens.size === 0) return []
    const results: Scored[] = []
    for (const e of this.entries) {
      if (e.id === this.currentEntryId) continue
      if (e.status === 'trash') continue
      // Weighted source text: title matters most, then topic/excerpt, then body.
      const titleT = this._tokenize(e.title)
      const topicT = this._tokenize(e.topic)
      const excerptT = this._tokenize(e.excerpt ?? '')
      const bodyT = this._tokenize(e.output).slice(0, 400)
      let score = 0
      for (const q of qTokens) {
        if (titleT.includes(q))   score += 5
        if (topicT.includes(q))   score += 3
        if (excerptT.includes(q)) score += 2
        if (bodyT.includes(q))    score += 1
      }
      if (score >= 3) results.push({ entry: e, score })
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 3)
  }

  override render() {
    const q = this.topic.trim()
    if (q.length < 4) return html``
    if (q === this._dismissedFor) return html``
    const matches = this._score(q)
    if (matches.length === 0) return html``

    return html`
      <div class="rounded-lg border border-amber-200 bg-amber-50/60 overflow-hidden">
        <button
          @click=${() => { this._expanded = !this._expanded }}
          class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-100/50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-amber-700 shrink-0">
            <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/>
            <path d="M7 4v3.5M7 9.5v0.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="flex-1 text-[12px] font-semibold text-amber-800">
            ${matches.length} similar piece${matches.length !== 1 ? 's' : ''} already in the library
          </span>
          <span class="text-[11px] text-amber-700 font-medium">${this._expanded ? 'Hide' : 'Show'}</span>
        </button>
        ${this._expanded ? html`
          <ul class="border-t border-amber-200 divide-y divide-amber-100 bg-white">
            ${matches.map(m => {
              const label = TYPE_LABELS[m.entry.contentType] ?? m.entry.contentType
              return html`
                <li class="px-3 py-2">
                  <button
                    @click=${() => this._emit('open-similar', m.entry)}
                    class="block w-full text-left group"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <span class="text-[12px] font-medium text-[#1a1a1a] leading-snug group-hover:text-[#063853] truncate">
                        ${m.entry.title}
                      </span>
                      <span class="text-[10px] text-gray-400 font-semibold shrink-0">${label}</span>
                    </div>
                    ${m.entry.excerpt ? html`
                      <p class="text-[11px] text-gray-500 leading-snug mt-0.5 line-clamp-2">${m.entry.excerpt}</p>
                    ` : ''}
                    <span class="text-[10px] text-[#063853] font-semibold mt-1 inline-block group-hover:underline">Open →</span>
                  </button>
                </li>
              `
            })}
          </ul>
          <button
            @click=${() => { this._dismissedFor = q; this._expanded = false }}
            class="w-full text-[11px] text-amber-700 hover:bg-amber-100 py-1.5 border-t border-amber-100 transition-colors"
          >Dismiss — I want to write a new one</button>
        ` : ''}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-similar-content': FFSimilarContent }
}
