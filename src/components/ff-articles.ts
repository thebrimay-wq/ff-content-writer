import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { TYPE_LABELS } from '../lib/api'
import type { ContentEntry } from '../lib/store'

/**
 * Article browser — shows real CMS articles loaded from sampleArticles.json.
 * Emits:
 *   - 'open-article'  detail: ContentEntry  → load article into the editor
 */

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  article:        { bg: '#F5EDCC', text: '#7A6200' },
  money_tip:      { bg: '#EAECEF', text: '#4B5563' },
  calculator:     { bg: '#DFF0E0', text: '#2D6A35' },
  checklist:      { bg: '#EAECEF', text: '#4B5563' },
  expert_insight: { bg: '#DFF0E0', text: '#2D6A35' },
}

@customElement('ff-articles')
export class FFArticles extends LitElement {
  override createRenderRoot() { return this }

  @property({ type: Array }) articles: ContentEntry[] = []
  @property({ type: Array }) categories: string[] = []

  @state() private _search = ''
  @state() private _typeFilter = 'all'
  @state() private _catFilter = 'all'

  private _emit(entry: ContentEntry) {
    this.dispatchEvent(new CustomEvent('open-article', { detail: entry, bubbles: true }))
  }

  private get _types(): string[] {
    return [...new Set(this.articles.map(a => a.contentType))].sort()
  }

  private get _filtered(): ContentEntry[] {
    const q = this._search.trim().toLowerCase()
    return this.articles.filter(a => {
      if (this._typeFilter !== 'all' && a.contentType !== this._typeFilter) return false
      if (this._catFilter !== 'all' && !a.categories.includes(this._catFilter)) return false
      if (!q) return true
      return a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q)
    })
  }

  override render() {
    const filtered = this._filtered
    const total = this.articles.length

    return html`
      <div class="flex flex-col h-full">

        <!-- Toolbar -->
        <div class="px-8 py-3 border-b border-gray-100 flex items-center gap-3 shrink-0 flex-wrap">
          <!-- Search -->
          <div class="relative flex-1 min-w-[180px] max-w-md">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <input
              type="text"
              .value=${this._search}
              @input=${(e: Event) => { this._search = (e.target as HTMLInputElement).value }}
              placeholder="Search articles"
              class="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-gray-200 bg-white outline-none focus:border-gray-400"
            />
          </div>

          <!-- Type filter -->
          <select
            .value=${this._typeFilter}
            @change=${(e: Event) => { this._typeFilter = (e.target as HTMLSelectElement).value }}
            class="text-[13px] rounded-lg border border-gray-200 bg-white px-3 py-2 outline-none focus:border-gray-400 cursor-pointer"
          >
            <option value="all">All types</option>
            ${this._types.map(t => html`<option value=${t}>${TYPE_LABELS[t] ?? t}</option>`)}
          </select>

          <!-- Category filter -->
          <select
            .value=${this._catFilter}
            @change=${(e: Event) => { this._catFilter = (e.target as HTMLSelectElement).value }}
            class="text-[13px] rounded-lg border border-gray-200 bg-white px-3 py-2 outline-none focus:border-gray-400 cursor-pointer max-w-[220px]"
          >
            <option value="all">All categories</option>
            ${this.categories.map(c => html`<option value=${c}>${c}</option>`)}
          </select>

          <span class="ml-auto shrink-0 text-[12px] text-gray-400">
            ${filtered.length} of ${total}
          </span>
        </div>

        <!-- List -->
        <div class="flex-1 overflow-y-auto scrollbar-thin">
          ${total === 0 ? html`
            <div class="flex flex-col items-center justify-center py-20 text-center">
              <p class="text-[17px] text-[#383838] font-light">No articles loaded.</p>
            </div>
          ` : ''}

          ${total > 0 && filtered.length === 0 ? html`
            <div class="text-center py-16 text-[13px] text-gray-400">
              No articles match your filters.
            </div>
          ` : ''}

          ${filtered.length > 0 ? html`
            <ul class="divide-y divide-gray-100">
              ${filtered.map(article => {
                const typeColor = TYPE_COLORS[article.contentType] ?? { bg: '#EAECEF', text: '#4B5563' }
                const typeLabel = TYPE_LABELS[article.contentType] ?? article.contentType
                const cats = article.categories.slice(0, 2)
                return html`
                  <li class="group flex items-center gap-4 px-8 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                    @click=${() => this._emit(article)}>

                    <!-- Title + excerpt -->
                    <div class="flex-1 min-w-0">
                      <p class="text-[14px] text-gray-900 truncate leading-snug">${article.title}</p>
                      ${article.excerpt ? html`
                        <p class="text-[12px] text-gray-400 truncate mt-0.5 leading-snug">${article.excerpt}</p>
                      ` : ''}
                      ${cats.length ? html`
                        <div class="flex items-center gap-1 mt-1 flex-wrap">
                          ${cats.map(c => html`
                            <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 truncate max-w-[140px]">${c}</span>
                          `)}
                        </div>
                      ` : ''}
                    </div>

                    <!-- Type chip -->
                    <span
                      class="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style="background:${typeColor.bg};color:${typeColor.text}"
                    >${typeLabel}</span>

                    <!-- Open arrow (shown on hover) -->
                    <svg class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400"
                      width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5"
                        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </li>
                `
              })}
            </ul>
          ` : ''}
        </div>

      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-articles': FFArticles }
}
