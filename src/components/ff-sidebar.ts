import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ExpertSource } from '../lib/api'
import { AUDIENCE_LABELS, TYPE_LABELS } from '../lib/api'
import type { ContentEntry } from '../lib/store'
import {
  versionConfig,
  languagesForRegion,
  regionFlag,
  regionShortCode,
  languageShortCode,
} from '../lib/versionConfig'
import './ff-similar-content'

@customElement('ff-sidebar')
export class FFSidebar extends LitElement {
  override createRenderRoot() { return this }

  @property() apiKey = ''
  @property({ type: Boolean }) keyIsEnvConfigured = false
  @property() mode: 'manual' | 'ai' = 'ai'
  @property() contentType = 'article'
  @property() audience = 'all'
  @property() topic = ''
  @property() notes = ''
  @property() region = 'us'
  @property() language = 'en'
  @property({ type: Array }) expertSources: ExpertSource[] = [{ insight: '', name: '', image: '' }]
  @property({ type: Boolean }) isGenerating = false
  @property({ type: Boolean }) hasContent = false
  @property({ type: Number }) streamElapsedMs = 0
  @property({ type: Array }) libraryEntries: ContentEntry[] = []
  @property() editingId: string | null = null

  @state() private _regionMenuOpen = false

  override connectedCallback() {
    super.connectedCallback()
    document.addEventListener('click', this._handleOutsideClick)
  }

  override disconnectedCallback() {
    document.removeEventListener('click', this._handleOutsideClick)
    super.disconnectedCallback()
  }

  private _handleOutsideClick = (e: MouseEvent) => {
    if (!this._regionMenuOpen) return
    const target = e.target as HTMLElement
    if (!target.closest('[data-region-chip]') && !target.closest('[data-region-popover]')) {
      this._regionMenuOpen = false
    }
  }

  private _toggleRegionMenu(e: Event) {
    e.stopPropagation()
    this._regionMenuOpen = !this._regionMenuOpen
  }

  private _regionChipTemplate() {
    const flag = regionFlag(this.region)
    const short = regionShortCode(this.region)
    const lang = languageShortCode(this.language)
    const langs = languagesForRegion(this.region)

    return html`
      <div class="relative">
        <button
          data-region-chip
          @click=${this._toggleRegionMenu}
          ?disabled=${this.isGenerating}
          class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 transition-colors px-2.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Writing for ${short} · ${lang}. Click to change."
        >
          <span class="text-[13px] leading-none">${flag}</span>
          <span class="text-[11px] font-semibold tracking-wide text-[#1a1a1a]">${short} · ${lang}</span>
          <svg class="h-3 w-3 text-gray-400 transition-transform ${this._regionMenuOpen ? 'rotate-180' : ''}" viewBox="0 0 12 12" fill="none">
            <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        ${this._regionMenuOpen ? html`
          <div
            data-region-popover
            class="absolute z-20 left-0 top-[calc(100%+6px)] w-[260px] bg-white rounded-xl border border-gray-200 shadow-lg p-3.5"
          >
            <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2.5">Writing for</p>

            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <label class="text-[10px] font-semibold tracking-wide uppercase text-gray-500">Region</label>
                <div class="relative">
                  <select
                    @change=${(e: Event) => this._emit('region-change', (e.target as HTMLSelectElement).value)}
                    class="w-full appearance-none rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:border-gray-400 pr-7 cursor-pointer"
                  >
                    ${versionConfig.options.map(o => html`
                      <option value=${o.region} ?selected=${o.region === this.region}>${o.label}</option>
                    `)}
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                    <svg class="h-3 w-3 text-gray-400" viewBox="0 0 12 12" fill="none">
                      <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-[10px] font-semibold tracking-wide uppercase text-gray-500">Language</label>
                <div class="relative">
                  <select
                    @change=${(e: Event) => this._emit('language-change', (e.target as HTMLSelectElement).value)}
                    ?disabled=${langs.length <= 1}
                    class="w-full appearance-none rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:border-gray-400 pr-7 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    ${langs.map(l => html`
                      <option value=${l.value} ?selected=${l.value === this.language}>${l.label}</option>
                    `)}
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                    <svg class="h-3 w-3 text-gray-400" viewBox="0 0 12 12" fill="none">
                      <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                </div>
                ${langs.length <= 1
                  ? html`<p class="text-[10px] text-gray-400 leading-snug mt-0.5">Only ${langs[0]?.label ?? 'one'} available for this region.</p>`
                  : ''}
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `
  }

  private _updateExpert(index: number, field: keyof ExpertSource, value: string) {
    const updated = this.expertSources.map((s, i) => i === index ? { ...s, [field]: value } : s)
    this._emit('expert-sources-change', updated)
  }

  private _addExpert() {
    this._emit('expert-sources-change', [...this.expertSources, { insight: '', name: '', image: '' }])
  }

  private _removeExpert(index: number) {
    this._emit('expert-sources-change', this.expertSources.filter((_, i) => i !== index))
  }

  private get _canGenerate() {
    return this.topic.trim().length > 0 && !this.isGenerating
  }

  private _emit<T>(name: string, detail: T) {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true }))
  }

  private _selectTemplate(
    value: string,
    options: Record<string, string>,
    eventName: string,
  ) {
    return html`
      <div class="relative">
        <select
          .value=${value}
          @change=${(e: Event) => this._emit(eventName, (e.target as HTMLSelectElement).value)}
          ?disabled=${this.isGenerating}
          class="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 outline-none transition focus:border-gray-400 pr-9 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ${Object.entries(options).map(([k, v]) => html`
            <option value=${k} ?selected=${k === value}>${v}</option>
          `)}
        </select>
        <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <svg class="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    `
  }

  override render() {
    const isManual = this.mode === 'manual'

    return html`
      <div class="flex flex-col h-full" style="padding:28px">

        <!-- Fields -->
        <div class="flex flex-col gap-6 flex-1">

          <!-- Region / language chip (always visible — small, unobtrusive) -->
          <div class="flex items-center justify-between gap-2 flex-wrap">
            ${this._regionChipTemplate()}
            ${!this.keyIsEnvConfigured && !isManual ? html`
              <button
                @click=${() => this._emit('api-key-click', null)}
                class="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                  this.apiKey
                    ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                    : 'text-gray-400 bg-gray-100 hover:bg-gray-200'
                }"
              >${this.apiKey ? 'Key set' : 'API key'}</button>
            ` : ''}
          </div>

          <!-- Mode toggle: Blank ↔ With AI. Flippable mid-flow; never wipes
               content. AI-only fields (Topic, Prompt notes, Generate button)
               hide when Blank is active. -->
          <div
            role="tablist"
            class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-gray-100 self-start"
          >
            <button
              role="tab"
              aria-selected=${isManual ? 'true' : 'false'}
              ?disabled=${this.isGenerating}
              @click=${() => this._emit('mode-flip', 'manual')}
              class="px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                isManual ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-gray-500 hover:text-gray-700'
              } disabled:opacity-50 disabled:cursor-not-allowed"
            >✏️ Blank</button>
            <button
              role="tab"
              aria-selected=${!isManual ? 'true' : 'false'}
              ?disabled=${this.isGenerating}
              @click=${() => this._emit('mode-flip', 'ai')}
              class="px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                !isManual ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-gray-500 hover:text-gray-700'
              } disabled:opacity-50 disabled:cursor-not-allowed"
            >✨ With AI</button>
          </div>

          <!-- Content type: editable dropdown while empty, locked chip once
               content exists. The "Convert to…" action is the ONLY way to
               change type after generation — it opens a picker that
               regenerates the same topic as a different type. -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Content type</label>
            ${this.hasContent
              ? html`
                <div class="flex items-center gap-2">
                  <div class="flex-1 flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5">
                    <span class="text-[14px] text-gray-900">${TYPE_LABELS[this.contentType] ?? this.contentType}</span>
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" class="text-gray-400">
                      <path d="M10.5 6V4a2 2 0 00-2-2H4a2 2 0 00-2 2v4.5a2 2 0 002 2h2M6 10.5v2a2 2 0 002 2h4.5a2 2 0 002-2v-4.5a2 2 0 00-2-2h-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    </svg>
                  </div>
                  <button
                    @click=${() => this._emit('convert-open', null)}
                    ?disabled=${this.isGenerating}
                    class="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#063853] hover:text-[#063853] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    title="Re-generate this content as a different type"
                  >Convert to…</button>
                </div>
              `
              : this._selectTemplate(this.contentType, TYPE_LABELS, 'content-type-change')}
          </div>

          ${isManual ? '' : html`
          <!-- Audience -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Who is this for?</label>
            ${this._selectTemplate(this.audience, AUDIENCE_LABELS, 'audience-change')}
            <p class="text-[11px] text-[#383838] leading-snug">We'll adjust tone and depth automatically.</p>
          </div>

          <!-- Topic -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Topic</label>
            <input
              type="text"
              .value=${this.topic}
              @input=${(e: Event) => this._emit('topic-change', (e.target as HTMLInputElement).value)}
              ?disabled=${this.isGenerating}
              placeholder="What do you want to create?"
              class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <ff-similar-content
              .topic=${this.topic}
              .entries=${this.libraryEntries}
              .currentEntryId=${this.editingId}
            ></ff-similar-content>
          </div>

          <!-- Prompt notes -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Prompt notes (optional)</label>
            <textarea
              .value=${this.notes}
              @input=${(e: Event) => this._emit('prompt-notes-change', (e.target as HTMLTextAreaElement).value)}
              ?disabled=${this.isGenerating}
              rows="6"
              placeholder="Add stats, rough ideas, or paste existing content..."
              class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 resize-none leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
            ></textarea>
            <p class="text-[11px] text-gray-400 leading-snug">Instructions to the model. For document notes, use the Meta tab.</p>
          </div>
          `}

          <!-- Expert Insights fields (conditional — AI mode only) -->
          ${!isManual && this.contentType === 'expert_insight' ? html`
            <div class="flex flex-col gap-3">
              ${this.expertSources.map((src, i) => html`
                <div class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
                  <div class="flex items-center justify-between">
                    <p class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">
                      ${this.expertSources.length > 1 ? `Expert Source ${i + 1}` : 'Expert Insight Source'}
                    </p>
                    ${this.expertSources.length > 1 ? html`
                      <button
                        @click=${() => this._removeExpert(i)}
                        ?disabled=${this.isGenerating}
                        class="text-[11px] text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >Remove</button>
                    ` : ''}
                  </div>

                  <!-- Raw insight -->
                  <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] font-semibold tracking-wide uppercase text-gray-400">Raw insight</label>
                    <textarea
                      .value=${src.insight}
                      @input=${(e: Event) => this._updateExpert(i, 'insight', (e.target as HTMLTextAreaElement).value)}
                      ?disabled=${this.isGenerating}
                      rows="5"
                      placeholder="Paste the expert's raw words here — we'll rewrite and polish them…"
                      class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 resize-none leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                    ></textarea>
                  </div>

                  <!-- Expert name -->
                  <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] font-semibold tracking-wide uppercase text-gray-400">Expert name</label>
                    <input
                      type="text"
                      .value=${src.name}
                      @input=${(e: Event) => this._updateExpert(i, 'name', (e.target as HTMLInputElement).value)}
                      ?disabled=${this.isGenerating}
                      placeholder="e.g. Kelley Long"
                      class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>

                  <!-- Expert image URL -->
                  <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] font-semibold tracking-wide uppercase text-gray-400">Image URL <span class="normal-case font-normal">(optional)</span></label>
                    <div class="flex gap-2 items-center">
                      <input
                        type="url"
                        .value=${src.image}
                        @input=${(e: Event) => this._updateExpert(i, 'image', (e.target as HTMLInputElement).value)}
                        ?disabled=${this.isGenerating}
                        placeholder="https://…"
                        class="flex-1 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      ${src.image ? html`
                        <img
                          src=${src.image}
                          alt="Expert"
                          class="h-9 w-9 rounded-full object-cover border border-gray-200 shrink-0"
                          @error=${(e: Event) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ` : ''}
                    </div>
                  </div>
                </div>
              `)}

              <!-- Add another expert -->
              <button
                @click=${this._addExpert}
                ?disabled=${this.isGenerating}
                class="flex items-center gap-1.5 text-[12px] font-semibold text-[#063853] hover:text-[#04293D] transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-start"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                Add another expert
              </button>
            </div>
          ` : ''}

          <!-- Generate / Clear buttons (AI mode only) -->
          ${!isManual ? html`
          <div class="flex flex-col gap-2 mt-auto pt-2 shrink-0">
            <div class="flex gap-2">
              <button
                @click=${() => this._emit('generate', null)}
                ?disabled=${!this._canGenerate}
                class="flex-1 h-11 rounded-lg font-bold text-[14px] text-white flex items-center justify-center gap-2 transition-colors ${
                  this._canGenerate
                    ? 'bg-[#063853] hover:bg-[#04293D] cursor-pointer active:scale-[0.98]'
                    : 'bg-[#063853]/40 cursor-not-allowed'
                }"
              >
                ${this.isGenerating ? html`
                  <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span>Writing… ${this.streamElapsedMs > 1000 ? `${(this.streamElapsedMs / 1000).toFixed(0)}s` : ''}</span>
                ` : 'Generate content'}
              </button>
              <button
                @click=${() => this._emit('clear-inputs', null)}
                ?disabled=${this.isGenerating}
                class="h-11 px-4 rounded-lg text-[13px] font-semibold text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Clear topic, notes, and expert sources"
              >Clear</button>
            </div>
            ${!this.apiKey ? html`
              <p class="text-[11px] text-[#383838] text-center">Set your API key above to get started</p>
            ` : ''}
          </div>
          ` : ''}

        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-sidebar': FFSidebar }
}
