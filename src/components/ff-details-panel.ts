import { LitElement, html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  buildSeoArticleMessage,
  buildSeoRefinementMessage,
  buildSourcesMessage,
  streamMessage,
  TYPE_LABELS,
} from '../lib/api'
import { SYSTEM_PROMPT } from '../lib/systemPrompt'
import type { ContentEntry, ContentSource, ContentStatus } from '../lib/store'
import { getCurrentUser, knownAssignees, setCurrentUser } from '../lib/store'
import { CATEGORIES, CURATED_CATEGORIES } from '../lib/taxonomy'
import './ff-quality-check'

const STATUS_OPTIONS: Array<{ value: ContentStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'trash', label: 'Trash' },
]

const STATUS_BG: Record<ContentStatus, string> = {
  draft:     'bg-gray-100 text-gray-600',
  in_review: 'bg-amber-100 text-amber-800',
  approved:  'bg-blue-100 text-blue-800',
  published: 'bg-emerald-100 text-emerald-800',
  trash:     'bg-red-100 text-red-800',
}

@customElement('ff-details-panel')
export class FFDetailsPanel extends LitElement {
  override createRenderRoot() { return this }

  @property({ type: Object }) entry: ContentEntry | null = null
  @property() contentType = 'article'
  @property() audience = 'all'
  @property() topic = ''
  @property() output = ''   // the short draft, used as base for SEO generation
  @property() apiKey = ''
  @property({ type: Boolean }) isDirty = false
  @property({ type: Boolean }) isGenerating = false

  @state() private _tab: 'publish' | 'meta' | 'categories' | 'context' | 'sources' | 'image' = 'publish'
  @state() private _collapsed = false

  // Featured image upload state (v2 + v3)
  @state() private _savedImageUrlV2: string | null = null
  @state() private _savedImageUrlV3: string | null = null
  @state() private _previewUrlV2: string | null = null
  @state() private _previewUrlV3: string | null = null
  @state() private _selectedFileV2: File | null = null
  @state() private _selectedFileV3: File | null = null
  @state() private _saveFlashV2 = false
  @state() private _saveFlashV3 = false
  @state() private _isDragOverV2 = false
  @state() private _isDragOverV3 = false
  private _fileInputV2: HTMLInputElement | null = null
  private _fileInputV3: HTMLInputElement | null = null
  private _saveTimerV2: ReturnType<typeof setTimeout> | null = null
  private _saveTimerV3: ReturnType<typeof setTimeout> | null = null

  // Context article streaming
  @state() private _seoGenerating = false
  @state() private _seoStreamText = ''
  @state() private _seoError = ''
  @state() private _seoRefineInput = ''
  @state() private _showSeoRefine = false
  @state() private _seoRefining = false
  private _seoAbort: AbortController | null = null

  // Sources AI state
  @state() private _sourcesAiLoading = false
  @state() private _sourcesAiError = ''
  private _sourcesAbort: AbortController | null = null

  // Exclude clients chip input
  @state() private _clientInput = ''

  // Category filter
  @state() private _catFilter = ''

  // AI metadata autofill state
  @state() private _metaAiLoading = false
  @state() private _metaAiError = ''
  @state() private _catSuggestions: string[] = []
  private _metaAbort: AbortController | null = null

  // Transient toast for AI-fill side effects (e.g. suggested categories).
  @state() private _toast: { msg: string; action?: string; target?: 'categories' } | null = null
  private _toastTimer: number | null = null

  override connectedCallback() {
    super.connectedCallback()
    const v2 = localStorage.getItem('ff_featured_image_v2')
    const v3 = localStorage.getItem('ff_featured_image_v3')
    if (v2) this._savedImageUrlV2 = v2
    if (v3) this._savedImageUrlV3 = v3
  }

  override disconnectedCallback() {
    if (this._toastTimer) window.clearTimeout(this._toastTimer)
    super.disconnectedCallback()
  }

  private _showToast(msg: string, action?: string, target?: 'categories') {
    this._toast = { msg, action, target }
    if (this._toastTimer) window.clearTimeout(this._toastTimer)
    this._toastTimer = window.setTimeout(() => { this._toast = null }, 5000)
  }

  private _toastAction() {
    if (this._toast?.target) this._tab = this._toast.target
    this._toast = null
  }

  private _renderToast() {
    if (!this._toast) return ''
    return html`
      <div class="absolute top-3 right-3 z-20 flex items-center gap-3 px-3 py-2 rounded-lg bg-[#1a1a1a] text-white text-[12px] shadow-lg">
        <span>${this._toast.msg}</span>
        ${this._toast.action ? html`
          <button @click=${this._toastAction} class="text-[12px] font-semibold text-emerald-300 hover:text-emerald-200">${this._toast.action}</button>
        ` : ''}
        <button @click=${() => { this._toast = null }} class="text-gray-400 hover:text-white text-[14px] leading-none">×</button>
      </div>
    `
  }

  private get _isArticle() {
    return this.contentType === 'article'
  }

  override willUpdate(changed: PropertyValues) {
    if (changed.has('entry')) {
      // Reset local streaming state when a new entry is opened
      const prev = changed.get('entry') as ContentEntry | null
      if (!prev || prev.id !== this.entry?.id) {
        this._seoStreamText = ''
        this._seoError = ''
        this._showSeoRefine = false
        this._seoRefineInput = ''
        this._clientInput = ''
        this._catFilter = ''
        this._catSuggestions = []
        this._metaAiError = ''
        this._sourcesAiError = ''
      }
    }
    // If content type changes away from article, leave the context tab
    if (changed.has('contentType') && !this._isArticle && this._tab === 'context') {
      this._tab = 'publish'
    }
    // Auto-generate Context when the short-form generation finishes (article only)
    if (changed.has('isGenerating')) {
      const wasGenerating = changed.get('isGenerating') as boolean | undefined
      if (wasGenerating && !this.isGenerating && this._shouldAutoContext()) {
        // Defer to next tick so the output property has settled
        queueMicrotask(() => this._generateSeo())
      }
    }
  }

  private _shouldAutoContext(): boolean {
    if (!this._isArticle) return false
    if (!this.apiKey) return false
    if (!this.output.trim()) return false
    if (this._seoGenerating || this._seoRefining) return false
    // Only auto-gen if context is missing or stale for this output
    const existing = this.entry?.seoArticle ?? ''
    if (existing && this.entry?.seoSourceOutput === this.output) return false
    return true
  }

  private get _isContextStale(): boolean {
    if (!this.entry) return false
    if (!this.entry.seoArticle) return false
    return this.entry.seoSourceOutput !== this.output
  }

  private _patch(patch: Partial<ContentEntry>) {
    if (!this.entry) return
    this.dispatchEvent(new CustomEvent('patch-entry', { detail: patch, bubbles: true }))
  }

  // ── Featured image helpers ────────────────────────────────────────────────────

  private _openImagePicker(key: 'v2' | 'v3') {
    if (key === 'v2') {
      if (!this._fileInputV2) {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this._handleImageFile('v2', f) }
        this._fileInputV2 = input
      }
      this._fileInputV2.value = ''
      this._fileInputV2.click()
    } else {
      if (!this._fileInputV3) {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this._handleImageFile('v3', f) }
        this._fileInputV3 = input
      }
      this._fileInputV3.value = ''
      this._fileInputV3.click()
    }
  }

  private _handleImageFile(key: 'v2' | 'v3', file: File) {
    if (file.size > 5 * 1024 * 1024) return
    if (key === 'v2') this._selectedFileV2 = file
    else this._selectedFileV3 = file
    const reader = new FileReader()
    reader.onload = (e) => {
      const url = e.target?.result as string
      if (key === 'v2') this._previewUrlV2 = url
      else this._previewUrlV3 = url
    }
    reader.readAsDataURL(file)
  }

  private _saveImageForKey(key: 'v2' | 'v3') {
    const url = key === 'v2' ? this._previewUrlV2 : this._previewUrlV3
    if (!url) return
    try { localStorage.setItem(`ff_featured_image_${key}`, url) } catch { /* QuotaExceeded */ }
    if (key === 'v2') {
      this._savedImageUrlV2 = url
      this._saveFlashV2 = true
      if (this._saveTimerV2) clearTimeout(this._saveTimerV2)
      this._saveTimerV2 = setTimeout(() => { this._saveFlashV2 = false }, 2000)
    } else {
      this._savedImageUrlV3 = url
      this._saveFlashV3 = true
      if (this._saveTimerV3) clearTimeout(this._saveTimerV3)
      this._saveTimerV3 = setTimeout(() => { this._saveFlashV3 = false }, 2000)
    }
  }

  private _removeImageForKey(key: 'v2' | 'v3') {
    localStorage.removeItem(`ff_featured_image_${key}`)
    if (key === 'v2') {
      this._selectedFileV2 = null; this._previewUrlV2 = null; this._savedImageUrlV2 = null; this._saveFlashV2 = false
    } else {
      this._selectedFileV3 = null; this._previewUrlV3 = null; this._savedImageUrlV3 = null; this._saveFlashV3 = false
    }
  }

  private _renderUploadBox(key: 'v2' | 'v3', label: string) {
    const previewUrl = key === 'v2' ? this._previewUrlV2 : this._previewUrlV3
    const savedUrl = key === 'v2' ? this._savedImageUrlV2 : this._savedImageUrlV3
    const selectedFile = key === 'v2' ? this._selectedFileV2 : this._selectedFileV3
    const saveFlash = key === 'v2' ? this._saveFlashV2 : this._saveFlashV3
    const isDragOver = key === 'v2' ? this._isDragOverV2 : this._isDragOverV3
    const displayUrl = previewUrl ?? savedUrl
    const isUnsaved = !!previewUrl && previewUrl !== savedUrl

    const onDragOver = (e: DragEvent) => { e.preventDefault(); if (key === 'v2') this._isDragOverV2 = true; else this._isDragOverV3 = true }
    const onDragLeave = () => { if (key === 'v2') this._isDragOverV2 = false; else this._isDragOverV3 = false }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      if (key === 'v2') this._isDragOverV2 = false; else this._isDragOverV3 = false
      const file = e.dataTransfer?.files?.[0]
      if (file?.type.startsWith('image/')) this._handleImageFile(key, file)
    }

    return html`
      <div class="space-y-2">
        <p class="text-[11px] font-bold uppercase tracking-wider text-[#383838]">${label}</p>
        ${!displayUrl ? html`
          <div
            class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-dashed transition-colors cursor-pointer group ${
              isDragOver ? 'border-[#063853] bg-[#063853]/[0.04]' : 'border-gray-200 hover:border-gray-300'
            }"
            @click=${() => this._openImagePicker(key)}
            @dragover=${onDragOver}
            @dragleave=${onDragLeave}
            @drop=${onDrop}
          >
            <div class="flex items-center gap-2 text-gray-400">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <rect x="1" y="2.5" width="13" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                <circle cx="5" cy="6" r="1.1" fill="currentColor"/>
                <path d="M1.5 11L5 7.5 7.5 10l2-2L13 11.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="text-[12px] text-gray-400 select-none">No image selected</span>
            </div>
            <span class="text-[12px] text-[#063853] group-hover:underline select-none">
              ${isDragOver ? 'Drop to attach' : 'Upload'}
            </span>
          </div>
        ` : html`
          <div class="rounded-lg border border-gray-200 overflow-hidden">
            <img src=${displayUrl} alt="${label} featured image" class="w-full h-32 object-cover"/>
            <div class="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50">
              <div class="min-w-0">
                <p class="text-[11px] text-[#383838] truncate leading-snug">${selectedFile?.name ?? 'Featured image'}</p>
                <p class="text-[10px] leading-snug ${isUnsaved ? 'text-amber-500' : 'text-emerald-500'}">
                  ${isUnsaved ? 'Unsaved' : 'Saved'}
                </p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                ${isUnsaved ? html`
                  <button @click=${() => this._saveImageForKey(key)}
                    class="text-[11px] font-medium text-white bg-[#063853] hover:bg-[#04293D] px-2 py-0.5 rounded transition-colors">
                    Save
                  </button>
                ` : saveFlash ? html`
                  <span class="text-[11px] text-emerald-500">Saved ✓</span>
                ` : html`
                  <button @click=${() => this._openImagePicker(key)} class="text-[11px] text-[#063853] hover:underline">Replace</button>
                `}
                <button @click=${() => this._removeImageForKey(key)} class="text-[11px] text-gray-400 hover:text-gray-500">Remove</button>
              </div>
            </div>
          </div>
        `}
      </div>
    `
  }

  private _renderFeaturedImage() {
    return html`
      <section class="p-4 space-y-5">
        ${this._renderUploadBox('v2', 'Hub v2')}
        ${this._renderUploadBox('v3', 'Hub v3')}
      </section>
    `
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private _formatDateTime(ms: number | null): string {
    if (!ms) return ''
    return new Date(ms).toISOString().slice(0, 16)
  }

  private get _seoWordCount(): number {
    const text = this._activeSeoText
    if (!text.trim()) return 0
    return text.trim().split(/\s+/).filter(Boolean).length
  }

  private get _activeSeoText(): string {
    if (this._seoGenerating || this._seoRefining) return this._seoStreamText
    return this.entry?.seoArticle ?? ''
  }

  // ── SEO generation ────────────────────────────────────────────────────────────

  private async _generateSeo() {
    if (!this.apiKey || !this.output.trim()) return
    this._seoAbort?.abort()
    const ctrl = new AbortController()
    this._seoAbort = ctrl
    this._seoGenerating = true
    this._seoStreamText = ''
    this._seoError = ''
    const ctx = { contentType: this.contentType, audience: this.audience, topic: this.topic, notes: '' }
    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: buildSeoArticleMessage(ctx, this.output) }],
        SYSTEM_PROMPT,
        (chunk) => { this._seoStreamText += chunk },
        ctrl.signal,
      )
      this._patch({ seoArticle: this._seoStreamText, seoSourceOutput: this.output })
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this._seoError = err instanceof Error ? err.message : 'Something went wrong.'
      }
    } finally {
      this._seoGenerating = false
    }
  }

  private async _refineSeo() {
    const instruction = this._seoRefineInput.trim()
    const base = this.entry?.seoArticle ?? ''
    if (!instruction || !base || !this.apiKey) return
    this._seoAbort?.abort()
    const ctrl = new AbortController()
    this._seoAbort = ctrl
    this._seoRefining = true
    this._seoStreamText = ''
    this._seoError = ''
    const ctx = { contentType: this.contentType, audience: this.audience, topic: this.topic, notes: '' }
    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: buildSeoRefinementMessage(base, instruction, ctx) }],
        SYSTEM_PROMPT,
        (chunk) => { this._seoStreamText += chunk },
        ctrl.signal,
      )
      this._patch({ seoArticle: this._seoStreamText, seoSourceOutput: this.output })
      this._seoRefineInput = ''
      this._showSeoRefine = false
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this._seoError = err instanceof Error ? err.message : 'Something went wrong.'
      }
    } finally {
      this._seoRefining = false
    }
  }

  // ── AI metadata autofill ──────────────────────────────────────────────────────

  private async _runMetaAutofill() {
    if (!this.apiKey || !this.entry) return
    this._metaAbort?.abort()
    const ctrl = new AbortController()
    this._metaAbort = ctrl
    this._metaAiLoading = true
    this._metaAiError = ''
    this._catSuggestions = []

    const title = this.entry.title || this.topic || ''
    const typeLabel = TYPE_LABELS[this.contentType] ?? this.contentType
    const contentPreview = this.output.slice(0, 1200)
    const catPaths = CATEGORIES
      .flatMap(c => c.children.length ? c.children.map(ch => `${c.label}/${ch}`) : [c.label])
      .slice(0, 30).join(', ')

    const prompt = `You are a metadata assistant for a financial wellness content platform.

Content Type: ${typeLabel}
Topic: ${title}
Content preview:
${contentPreview}

Generate metadata. Return ONLY valid JSON, no other text:
{
  "slug": "url-friendly-slug-from-topic-max-60-chars",
  "excerpt": "1–2 sentence description for library cards, max 210 chars",
  "categories": ["Parent/Child path 1", "Parent/Child path 2"]
}

Available categories (use exact format "Parent/Child"): ${catPaths}
Rules: slug = lowercase, hyphens only, max 60 chars. categories = 1–3 most relevant paths only.`

    let accumulated = ''
    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: prompt }],
        'Return only valid JSON. No explanation, no markdown code fences.',
        (chunk) => { accumulated += chunk },
        ctrl.signal,
      )
      const jsonMatch = accumulated.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      const data = JSON.parse(jsonMatch[0]) as { slug?: string; excerpt?: string; categories?: string[] }
      const patch: Partial<ContentEntry> = {}
      if (typeof data.slug === 'string' && data.slug.trim()) patch.slug = data.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 80)
      if (typeof data.excerpt === 'string' && data.excerpt.trim()) patch.excerpt = data.excerpt.trim().slice(0, 220)
      if (Object.keys(patch).length > 0) this._patch(patch)
      if (Array.isArray(data.categories) && data.categories.length) {
        const current = this.entry?.categories ?? []
        const newSugs = data.categories
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .filter(c => !current.includes(c))
        if (newSugs.length) {
          this._catSuggestions = newSugs
          // Surface a toast instead of silently switching tabs. The old behavior
          // felt like the app took the wheel; the toast makes the side effect
          // visible and gives the user an explicit "Review →" action.
          const filledExcerpt = typeof data.excerpt === 'string' && data.excerpt.trim()
          this._showToast(
            filledExcerpt
              ? `Filled excerpt · suggested ${newSugs.length} categor${newSugs.length === 1 ? 'y' : 'ies'}`
              : `Suggested ${newSugs.length} categor${newSugs.length === 1 ? 'y' : 'ies'}`,
            'Review →',
            'categories',
          )
        } else if (typeof data.excerpt === 'string' && data.excerpt.trim()) {
          this._showToast('Filled excerpt')
        }
      } else if (typeof data.excerpt === 'string' && data.excerpt.trim()) {
        this._showToast('Filled excerpt')
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this._metaAiError = err instanceof Error ? err.message : 'Something went wrong.'
      }
    } finally {
      this._metaAiLoading = false
    }
  }

  // ── Publish readiness banner ───────────────────────────────────────────────────

  private _renderReadinessBanner() {
    const e = this.entry
    if (!e || e.status === 'published' || e.status === 'trash') return ''
    const missing: string[] = []
    if (!e.author?.trim()) missing.push('Author')
    if (!e.slug?.trim()) missing.push('Slug')
    if (!e.excerpt?.trim()) missing.push('Excerpt')
    if (!e.categories?.length) missing.push('Categories')
    if (missing.length === 0) {
      return html`
        <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="#059669" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="text-[11px] font-semibold text-emerald-700">Ready to publish</span>
        </div>
      `
    }
    // Each missing-field pill scrolls to + pulses the target field on click.
    // The field's tab (Publish/Meta/Categories) may differ from the current
    // tab, so we switch tabs first.
    const fieldToTab: Record<string, typeof this._tab> = {
      Author: 'publish',
      Slug: 'meta',
      Excerpt: 'meta',
      Categories: 'categories',
    }
    const fieldToAnchor: Record<string, string> = {
      Author: 'field-author',
      Slug: 'field-slug',
      Excerpt: 'field-excerpt',
      Categories: 'field-categories',
    }
    const jumpToField = (field: string) => {
      const targetTab = fieldToTab[field]
      const anchor = fieldToAnchor[field]
      if (targetTab) this._tab = targetTab
      // Wait a frame for the tab switch to render the target field, then
      // scroll + pulse.
      requestAnimationFrame(() => {
        const el = this.renderRoot.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`)
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ff-field-pulse')
        window.setTimeout(() => el.classList.remove('ff-field-pulse'), 1400)
      })
    }
    return html`
      <div class="p-3 rounded-lg bg-amber-50 border border-amber-100 space-y-2">
        <p class="text-[11px] font-bold text-amber-800 uppercase tracking-wide">Complete before publishing</p>
        <div class="flex flex-wrap gap-1.5">
          ${missing.map(f => html`
            <button
              @click=${() => jumpToField(f)}
              class="text-[11px] px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-700 font-semibold hover:bg-amber-100 hover:border-amber-300 transition-colors cursor-pointer"
              title="Go to ${f}"
            >${f}</button>
          `)}
        </div>
      </div>
    `
  }

  // ── Category suggestions banner ────────────────────────────────────────────────

  private _renderCatSuggestions() {
    if (!this._catSuggestions.length) return ''
    return html`
      <div class="p-3 rounded-lg bg-violet-50 border border-violet-100 space-y-2">
        <p class="text-[11px] font-bold text-violet-800 uppercase tracking-wide">AI suggested categories</p>
        <div class="flex flex-wrap gap-2">
          ${this._catSuggestions.map(cat => html`
            <span class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white border border-violet-200 text-violet-700 font-semibold">
              ${cat.includes('/') ? cat.replace('/', ' › ') : cat}
              <button
                @click=${() => {
                  this._toggleCat(cat)
                  this._catSuggestions = this._catSuggestions.filter(c => c !== cat)
                }}
                class="ml-0.5 text-[10px] text-white bg-violet-500 hover:bg-violet-600 rounded px-1 py-0 leading-tight"
              >+ Add</button>
              <button
                @click=${() => { this._catSuggestions = this._catSuggestions.filter(c => c !== cat) }}
                class="text-violet-300 hover:text-violet-500 leading-none"
              >×</button>
            </span>
          `)}
        </div>
        <button
          @click=${() => { this._catSuggestions = [] }}
          class="text-[10px] text-violet-400 hover:text-violet-600"
        >Dismiss all</button>
      </div>
    `
  }

  // ── Category helpers ─────────────────────────────────────────────────────────

  private _isCatSelected(path: string): boolean {
    return (this.entry?.categories ?? []).includes(path)
  }

  private _isParentAllSelected(parentLabel: string, children: string[]): boolean {
    if (!children.length) return this._isCatSelected(parentLabel)
    return children.every(child => this._isCatSelected(`${parentLabel}/${child}`))
  }

  private _isParentPartialSelected(parentLabel: string, children: string[]): boolean {
    if (!children.length) return false
    const selected = children.filter(child => this._isCatSelected(`${parentLabel}/${child}`))
    return selected.length > 0 && selected.length < children.length
  }

  private _toggleCat(path: string) {
    const cats = this.entry?.categories ?? []
    const newCats = cats.includes(path) ? cats.filter(c => c !== path) : [...cats, path]
    this._patch({ categories: newCats })
  }

  private _toggleParent(parentLabel: string, children: string[]) {
    if (!children.length) { this._toggleCat(parentLabel); return }
    const cats = this.entry?.categories ?? []
    const childPaths = children.map(c => `${parentLabel}/${c}`)
    const allSelected = childPaths.every(p => cats.includes(p))
    if (allSelected) {
      this._patch({ categories: cats.filter(c => !childPaths.includes(c)) })
    } else {
      this._patch({ categories: [...new Set([...cats, ...childPaths])] })
    }
  }

  private _removeCat(path: string) {
    this._patch({ categories: (this.entry?.categories ?? []).filter(c => c !== path) })
  }

  private _isCuratedSelected(label: string): boolean {
    return (this.entry?.curatedCategories ?? []).includes(label)
  }

  private _toggleCurated(label: string) {
    const cur = this.entry?.curatedCategories ?? []
    const next = cur.includes(label) ? cur.filter(c => c !== label) : [...cur, label]
    this._patch({ curatedCategories: next })
  }

  private _removeCurated(label: string) {
    this._patch({ curatedCategories: (this.entry?.curatedCategories ?? []).filter(c => c !== label) })
  }

  private _addExcludeClient(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ',') return
    e.preventDefault()
    const val = this._clientInput.trim()
    if (!val) return
    const existing = this.entry?.excludeClients ?? []
    if (!existing.includes(val)) {
      this._patch({ excludeClients: [...existing, val] })
    }
    this._clientInput = ''
  }

  private _removeExcludeClient(val: string) {
    this._patch({ excludeClients: (this.entry?.excludeClients ?? []).filter(c => c !== val) })
  }

  // ── Card shell ────────────────────────────────────────────────────────────────

  private _card(title: string, content: unknown, openByDefault = true) {
    return html`
      <details ?open=${openByDefault} class="rounded-lg border border-gray-200 overflow-hidden">
        <summary class="flex items-center justify-between px-4 h-10 bg-[#063853] text-white text-[12px] font-bold cursor-pointer select-none">
          ${title}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="transition-transform details-chevron">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </summary>
        <div class="p-4 space-y-3 text-[13px]">${content}</div>
      </details>
    `
  }

  private _row(label: string, control: unknown, anchor?: string) {
    return html`
      <div class="grid grid-cols-[90px_1fr] items-start gap-2" data-anchor=${anchor ?? ''}>
        <label class="font-semibold pt-2 text-[12px]">${label}</label>
        <div>${control}</div>
      </div>
    `
  }

  private _input(value: string, onBlur: (v: string) => void, opts: { type?: string; placeholder?: string; mono?: boolean } = {}) {
    return html`
      <input
        type=${opts.type ?? 'text'}
        .value=${value}
        @blur=${(e: Event) => onBlur((e.target as HTMLInputElement).value)}
        placeholder=${opts.placeholder ?? ''}
        class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400 ${opts.mono ? 'font-mono text-[12px]' : ''}"
      />
    `
  }

  private _select(value: string, options: Array<{ value: string; label: string }>, onChange: (v: string) => void) {
    return html`
      <select
        @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
        class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400 bg-white"
      >
        ${options.map(o => html`<option value=${o.value} ?selected=${value === o.value}>${o.label}</option>`)}
      </select>
    `
  }

  // ── Publish tab ───────────────────────────────────────────────────────────────

  private _renderPublish() {
    const e = this.entry
    const status = e?.status ?? 'draft'

    const statusCard = html`
      ${this._row('Status', this._select(
        status,
        STATUS_OPTIONS,
        v => {
          const newStatus = v as ContentStatus
          const patch: Partial<ContentEntry> = { status: newStatus }
          if (newStatus === 'published' && status !== 'published') patch.publishedAt = Date.now()
          this._patch(patch)
        },
      ))}
      ${this._row('Created', html`<input type="datetime-local" .value=${this._formatDateTime(e?.createdAt ?? null)} readonly class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-400 bg-gray-50" />`)}
      ${this._row('Published', html`<input type="datetime-local" .value=${this._formatDateTime(e?.publishedAt ?? null)} readonly class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-400 bg-gray-50" />`)}
      ${this._row('Author', this._input(e?.author ?? '', v => this._patch({ author: v }), { placeholder: 'e.g. Kelley Long' }), 'field-author')}
      <div class="flex items-center justify-between pt-2 border-t border-gray-100">
        <button
          @click=${() => this._patch({ status: 'trash' })}
          class="text-[12px] font-bold text-red-500 hover:text-red-600 tracking-wider uppercase"
        >Move to Trash</button>
      </div>
      ${status !== 'draft' && !(status === 'published' && this.isDirty) ? html`
        <div class="mt-1 p-3 rounded-md text-[11px] leading-snug ${STATUS_BG[status]}">
          ${status === 'in_review' ? 'In review — edits still allowed.' : ''}
          ${status === 'approved' ? 'Approved — content is locked. Change status to edit.' : ''}
          ${status === 'published' ? 'Published — content and metadata are locked.' : ''}
          ${status === 'trash' ? 'In trash — restore by changing status.' : ''}
        </div>
      ` : ''}
    `

    const versionCard = html`
      <!-- AI Autofill row -->
      <div class="flex items-center justify-between py-1 mb-1 border-b border-gray-100">
        <span class="text-[11px] text-gray-400">Fills slug, excerpt &amp; suggests categories</span>
        <button
          @click=${this._runMetaAutofill}
          ?disabled=${this._metaAiLoading || !this.apiKey || !this.output.trim()}
          class="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all ${
            !this._metaAiLoading && this.apiKey && this.output.trim()
              ? 'bg-gradient-to-r from-violet-500 to-indigo-600 text-white hover:from-violet-600 hover:to-indigo-700'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }"
        >
          ${this._metaAiLoading ? html`
            <svg class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span>Filling…</span>
          ` : html`
            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 1L7.12 4.88L11 6L7.12 7.12L6 11L4.88 7.12L1 6L4.88 4.88L6 1Z"/>
            </svg>
            <span>✨ AI Autofill</span>
          `}
        </button>
      </div>
      ${this._metaAiError ? html`<p class="text-[11px] text-red-500 -mt-1">${this._metaAiError}</p>` : ''}
      ${this._row('Slug', this._input(e?.slug ?? '', v => this._patch({ slug: v }), { mono: true }), 'field-slug')}
      ${this._row('Client', this._input(e?.client ?? '', v => this._patch({ client: v })))}
      ${this._row('Region', this._select(
        e?.region ?? 'United States',
        [
          { value: 'United States', label: 'United States' },
          { value: 'Canada', label: 'Canada' },
          { value: 'United Kingdom', label: 'United Kingdom' },
        ],
        v => this._patch({ region: v }),
      ))}
      ${this._row('Language', this._select(
        e?.language ?? 'English',
        [
          { value: 'English', label: 'English' },
          { value: 'Spanish', label: 'Spanish' },
          { value: 'French', label: 'French' },
        ],
        v => this._patch({ language: v }),
      ))}
    `

    const versionsStub = html`
      <p class="text-[12px] text-gray-500">Versioning ships in v2. No other versions found.</p>
    `

    return html`
      <section class="p-4 space-y-4">
        ${this._renderReadinessBanner()}
        ${this._card('Status', statusCard)}
        ${this._card('Workflow', this._renderWorkflowCard())}
        ${this._card('Version Identity', versionCard)}
        <details class="rounded-lg border border-gray-200 overflow-hidden">
          <summary class="flex items-center justify-between px-4 h-10 bg-gray-100 text-gray-500 text-[12px] font-bold cursor-pointer select-none">
            Versions
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-200">v2</span>
          </summary>
          <div class="p-4">${versionsStub}</div>
        </details>
      </section>
    `
  }

  // ── Workflow: assignee + review notes + Send for review ────────────────────

  @state() private _assigneeDraft = ''
  @state() private _reviewDraft = ''
  @state() private _meDraft = ''

  private _renderWorkflowCard() {
    const e = this.entry
    if (!e) return html``
    const me = getCurrentUser()
    const assignees = knownAssignees()
    const isMe = !!e.assignee && e.assignee === me
    return html`
      <!-- "Who am I" — tiny picker so 'My queue' works without auth -->
      <div class="flex items-center justify-between py-1 -mt-1 mb-1 border-b border-gray-100 gap-2">
        <span class="text-[11px] text-gray-400 shrink-0">Signed in as</span>
        <input
          type="text"
          list="ff-known-users"
          .value=${this._meDraft || me}
          @input=${(ev: Event) => { this._meDraft = (ev.target as HTMLInputElement).value }}
          @blur=${(ev: Event) => {
            const v = (ev.target as HTMLInputElement).value.trim()
            if (v && v !== me) { setCurrentUser(v); this._meDraft = '' }
            this.requestUpdate()
          }}
          placeholder="Your name"
          class="flex-1 min-w-0 rounded-md border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-gray-400"
        />
        <datalist id="ff-known-users">
          ${assignees.map(n => html`<option value=${n}></option>`)}
        </datalist>
      </div>

      ${this._row('Assignee', html`
        <div class="flex gap-2 items-center">
          <input
            type="text"
            list="ff-known-users"
            .value=${this._assigneeDraft !== '' ? this._assigneeDraft : (e.assignee ?? '')}
            @input=${(ev: Event) => { this._assigneeDraft = (ev.target as HTMLInputElement).value }}
            @blur=${(ev: Event) => {
              const v = (ev.target as HTMLInputElement).value
              if (v !== e.assignee) this._patch({ assignee: v })
              this._assigneeDraft = ''
            }}
            placeholder="Who owns this next?"
            class="flex-1 rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
          />
          ${e.assignee && !isMe ? html`
            <button
              @click=${() => { if (me) this._patch({ assignee: me }) }}
              class="text-[11px] font-semibold text-[#063853] hover:underline shrink-0"
              title="Assign to yourself"
            >Take</button>
          ` : ''}
        </div>
      `)}

      <div class="space-y-1">
        <label class="block text-[11px] font-bold uppercase tracking-wider">Review notes</label>
        <p class="text-[11px] text-gray-400 -mt-0.5">Shown to the writer as a banner while in review.</p>
        <textarea
          rows="3"
          .value=${this._reviewDraft !== '' ? this._reviewDraft : (e.reviewNotes ?? '')}
          @input=${(ev: Event) => { this._reviewDraft = (ev.target as HTMLTextAreaElement).value }}
          @blur=${(ev: Event) => {
            const v = (ev.target as HTMLTextAreaElement).value
            if (v !== e.reviewNotes) this._patch({ reviewNotes: v })
            this._reviewDraft = ''
          }}
          placeholder="Tighten the intro, verify the stat in section 2…"
          class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] resize-none outline-none focus:border-gray-400"
        ></textarea>
      </div>

      <div class="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
        ${e.status !== 'in_review' ? html`
          <button
            @click=${() => {
              const patch: Partial<ContentEntry> = { status: 'in_review' }
              if (!e.assignee && me) patch.assignee = me
              this._patch(patch)
            }}
            class="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
          >Send for review</button>
        ` : html`
          <button
            @click=${() => this._patch({ status: 'approved' })}
            class="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >Approve</button>
          <button
            @click=${() => this._patch({ status: 'draft' })}
            class="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >Back to draft</button>
        `}
      </div>
    `
  }

  // ── Meta tab ──────────────────────────────────────────────────────────────────

  private _renderMeta() {
    const e = this.entry
    const typeLabel = TYPE_LABELS[this.contentType] ?? this.contentType
    const excl = e?.excludeClients ?? []

    const metaCard = html`
      <div class="space-y-1" data-anchor="field-excerpt">
        <div class="flex items-center justify-between">
          <label class="block text-[11px] font-bold uppercase tracking-wider">Excerpt</label>
          ${this.apiKey && this.output.trim() ? html`
            <button
              @click=${this._runMetaAutofill}
              ?disabled=${this._metaAiLoading}
              class="text-[10px] font-semibold text-violet-600 hover:text-violet-800 disabled:opacity-40 transition-colors"
            >${this._metaAiLoading ? 'Filling…' : '✨ AI fill'}</button>
          ` : ''}
        </div>
        <p class="text-[11px] text-gray-400 -mt-0.5">Shown in library index cards.</p>
        <textarea
          rows="3"
          .value=${e?.excerpt ?? ''}
          @blur=${(ev: Event) => this._patch({ excerpt: (ev.target as HTMLTextAreaElement).value })}
          class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] resize-none outline-none focus:border-gray-400"
        ></textarea>
        <div class="flex justify-between text-[10px] text-gray-400">
          <span>Shows in library cards</span>
          <span>${(e?.excerpt ?? '').length} / 220</span>
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[11px] font-bold uppercase tracking-wider">Content Type</label>
        <p class="text-[11px] text-gray-400 -mt-0.5">Set on the left sidebar (drives generation).</p>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#063853]/[0.08] text-[#063853]">${typeLabel}</span>
          <button
            @click=${() => {
              const el = document.querySelector('ff-sidebar')
                ?.querySelector('select') as HTMLSelectElement | null
              el?.focus()
            }}
            class="text-[11px] text-[#063853] font-semibold hover:underline"
          >Edit on sidebar →</button>
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[11px] font-bold uppercase tracking-wider">Document Notes</label>
        <p class="text-[11px] text-gray-400 -mt-0.5">Separate from prompt notes; not sent to the model.</p>
        <textarea
          rows="3"
          .value=${e?.documentNotes ?? ''}
          @blur=${(ev: Event) => this._patch({ documentNotes: (ev.target as HTMLTextAreaElement).value })}
          class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] resize-none outline-none focus:border-gray-400"
          placeholder="Internal notes about this document…"
        ></textarea>
      </div>

      <div class="space-y-1">
        <label class="block text-[11px] font-bold uppercase tracking-wider">Reference Link</label>
        <p class="text-[11px] text-gray-400 -mt-0.5">For content types other than Articles.</p>
        <input
          type="url"
          .value=${e?.referenceLink ?? ''}
          @blur=${(ev: Event) => this._patch({ referenceLink: (ev.target as HTMLInputElement).value })}
          placeholder="https://…"
          class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-[11px] font-bold uppercase tracking-wider">Mime Type</label>
          ${this._select(
            e?.mimeType ?? 'HTML',
            [
              { value: 'HTML', label: 'HTML' },
              { value: 'Markdown', label: 'Markdown' },
              { value: 'Plain Text', label: 'Plain Text' },
            ],
            v => this._patch({ mimeType: v as ContentEntry['mimeType'] }),
          )}
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] font-bold uppercase tracking-wider">Priority</label>
          <input
            type="number"
            min="0"
            max="100"
            .value=${String(e?.priority ?? 0)}
            @blur=${(ev: Event) => this._patch({ priority: Number((ev.target as HTMLInputElement).value) || 0 })}
            class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
          />
          <p class="text-[10px] text-gray-400">0 lowest · 100 highest</p>
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[11px] font-bold uppercase tracking-wider">Exclude Clients</label>
        <p class="text-[11px] text-gray-400 -mt-0.5">Clients prevented from viewing this article.</p>
        <div class="flex flex-wrap gap-1.5 p-2 rounded-md border border-gray-200 bg-gray-50 min-h-[40px]"
          @click=${(ev: Event) => { if (ev.target === ev.currentTarget) (ev.currentTarget as HTMLElement).querySelector('input')?.focus() }}
        >
          ${excl.map(c => html`
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E6EEF3] text-[#063853]">
              ${c}
              <button @click=${() => this._removeExcludeClient(c)} class="opacity-60 hover:opacity-100 text-[11px] leading-none">×</button>
            </span>
          `)}
          <input
            type="text"
            .value=${this._clientInput}
            @input=${(ev: Event) => { this._clientInput = (ev.target as HTMLInputElement).value }}
            @keydown=${this._addExcludeClient}
            @blur=${() => {
              const val = this._clientInput.trim()
              if (!val) return
              const existing = this.entry?.excludeClients ?? []
              if (!existing.includes(val)) this._patch({ excludeClients: [...existing, val] })
              this._clientInput = ''
            }}
            placeholder="Add client…"
            class="flex-1 bg-transparent text-[13px] outline-none min-w-[80px]"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-[11px] font-bold uppercase tracking-wider">Show in Library</label>
          ${this._select(
            String(e?.showInLibrary !== false),
            [{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }],
            v => this._patch({ showInLibrary: v === 'true' }),
          )}
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] font-bold uppercase tracking-wider">Paid Content</label>
          ${this._select(
            String(e?.paidContent ?? false),
            [{ value: 'false', label: 'False' }, { value: 'true', label: 'True' }],
            v => this._patch({ paidContent: v === 'true' }),
          )}
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[11px] font-bold uppercase tracking-wider">Redirect</label>
        <p class="text-[11px] text-gray-400 -mt-0.5">If set, content redirects to this internal article.</p>
        <input
          type="text"
          .value=${e?.redirect ?? ''}
          @blur=${(ev: Event) => this._patch({ redirect: (ev.target as HTMLInputElement).value })}
          class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
        />
      </div>

      <div class="space-y-1">
        <label class="block text-[11px] font-bold uppercase tracking-wider">Source</label>
        ${this._select(
          e?.source ?? 'Financial Finesse',
          [
            { value: 'Financial Finesse', label: 'Financial Finesse' },
            { value: 'Partner', label: 'Partner' },
            { value: 'Syndicated', label: 'Syndicated' },
          ],
          v => this._patch({ source: v }),
        )}
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-[11px] font-bold uppercase tracking-wider">Legacy ID</label>
          <input
            type="text"
            .value=${e?.legacyId ?? ''}
            @blur=${(ev: Event) => this._patch({ legacyId: (ev.target as HTMLInputElement).value })}
            placeholder="0"
            class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
          />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] font-bold uppercase tracking-wider">Excl. SmartBenefits</label>
          ${this._select(
            String(e?.excludeSmartBenefits ?? false),
            [{ value: 'false', label: 'False' }, { value: 'true', label: 'True' }],
            v => this._patch({ excludeSmartBenefits: v === 'true' }),
          )}
        </div>
      </div>
    `

    return html`
      <section class="p-4 space-y-4">
        ${this._card('Meta', metaCard)}
      </section>
    `
  }

  // ── Categories tab ────────────────────────────────────────────────────────────

  private _renderCategories() {
    const selectedCats = this.entry?.categories ?? []
    const f = this._catFilter.toLowerCase()
    const filteredCats = f
      ? CATEGORIES.filter(c =>
          c.label.toLowerCase().includes(f) ||
          c.children.some(ch => ch.toLowerCase().includes(f)),
        )
      : CATEGORIES

    const catTree = html`
      <div class="flex items-center gap-2 mb-2">
        <input
          type="text"
          .value=${this._catFilter}
          @input=${(ev: Event) => { this._catFilter = (ev.target as HTMLInputElement).value }}
          placeholder="Filter categories…"
          class="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] outline-none focus:border-gray-400"
        />
      </div>
      <div class="rounded-md border border-gray-200 p-3 max-h-72 overflow-y-auto space-y-1.5">
        ${filteredCats.map(cat => {
          if (cat.children.length === 0) {
            return html`
              <label class="flex items-center gap-2 text-[13px] font-semibold">
                <input type="checkbox"
                  ?checked=${this._isCatSelected(cat.label)}
                  @change=${() => this._toggleCat(cat.label)}
                  class="rounded border-gray-300"
                />
                ${cat.label}
              </label>
            `
          }
          const allSel = this._isParentAllSelected(cat.label, cat.children)
          const partSel = this._isParentPartialSelected(cat.label, cat.children)
          return html`
            <details open>
              <summary class="flex items-center gap-2 text-[13px] font-semibold cursor-pointer list-none">
                <input type="checkbox"
                  ?checked=${allSel}
                  .indeterminate=${partSel}
                  @change=${() => this._toggleParent(cat.label, cat.children)}
                  @click=${(ev: Event) => ev.stopPropagation()}
                  class="rounded border-gray-300"
                />
                ${cat.label}
                <span class="text-[10px] text-gray-400 ml-auto">${cat.children.length}</span>
              </summary>
              <div class="pl-6 mt-1 space-y-1">
                ${cat.children.map(child => html`
                  <label class="flex items-center gap-2 text-[13px]">
                    <input type="checkbox"
                      ?checked=${this._isCatSelected(`${cat.label}/${child}`)}
                      @change=${() => this._toggleCat(`${cat.label}/${child}`)}
                      class="rounded border-gray-300"
                    />
                    ${child}
                  </label>
                `)}
              </div>
            </details>
          `
        })}
      </div>
      ${selectedCats.length > 0 ? html`
        <div class="mt-2 flex items-center gap-1.5 flex-wrap">
          <span class="text-[10px] text-gray-400">Selected:</span>
          ${selectedCats.map(path => html`
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E6EEF3] text-[#063853]">
              ${path.replace('/', ' › ')}
              <button @click=${() => this._removeCat(path)} class="opacity-60 hover:opacity-100">×</button>
            </span>
          `)}
        </div>
      ` : ''}
    `

    const selectedCurated = this.entry?.curatedCategories ?? []
    const curatedCard = html`
      <div class="rounded-md border border-gray-200 p-3 max-h-56 overflow-y-auto space-y-1.5">
        ${CURATED_CATEGORIES.map(label => html`
          <label class="flex items-center gap-2 text-[13px]">
            <input type="checkbox"
              ?checked=${this._isCuratedSelected(label)}
              @change=${() => this._toggleCurated(label)}
              class="rounded border-gray-300"
            />
            ${label}
          </label>
        `)}
      </div>
      ${selectedCurated.length > 0 ? html`
        <div class="mt-2 flex items-center gap-1.5 flex-wrap">
          <span class="text-[10px] text-gray-400">Selected:</span>
          ${selectedCurated.map(label => html`
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E6EEF3] text-[#063853]">
              ${label}
              <button @click=${() => this._removeCurated(label)} class="opacity-60 hover:opacity-100">×</button>
            </span>
          `)}
        </div>
      ` : ''}
      <p class="text-[11px] text-gray-400">Curated lists are editorial groupings — a piece can live in multiple categories.</p>
    `

    return html`
      <section class="p-4 space-y-4">
        ${this._renderCatSuggestions()}
        ${this._card('Categories', catTree)}
        ${this._card('Curated Categories', curatedCard)}
      </section>
    `
  }

  // ── Context tab ───────────────────────────────────────────────────────────────

  private _renderContext() {
    const seoText = this._activeSeoText
    const wc = this._seoWordCount
    const streaming = this._seoGenerating || this._seoRefining

    const seoCard = html`
      <p class="text-[12px] text-gray-500 leading-snug">
        Long-form context for this piece — the AI uses it as background so future drafts stay on
        brand and grounded. It auto-generates when you create a short draft and can be refreshed
        whenever the short version changes.
      </p>

      ${this._isContextStale && !streaming ? html`
        <div class="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="mt-px shrink-0"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div class="flex-1">
            <p class="font-semibold">Context is stale</p>
            <p class="text-[11px] leading-snug">The short draft has changed since this context was generated. Regenerate to keep them in sync.</p>
          </div>
          <button
            @click=${this._generateSeo}
            class="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors"
          >Update</button>
        </div>
      ` : ''}

      <div class="flex items-center gap-2 flex-wrap">
        <button
          @click=${this._generateSeo}
          ?disabled=${streaming || !this.output.trim() || !this.apiKey}
          class="h-9 px-3 rounded-md text-[12px] font-bold text-white transition-colors ${
            !streaming && this.output.trim() && this.apiKey
              ? 'bg-[#063853] hover:bg-[#04293D]'
              : 'bg-[#063853]/40 cursor-not-allowed'
          }"
        >
          ${this._seoGenerating ? html`
            <span class="flex items-center gap-1.5">
              <svg class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Generating…
            </span>
          ` : seoText.trim() ? '✨ Regenerate from current draft' : '✨ Generate from current draft'}
        </button>
        ${seoText.trim() ? html`
          <button
            @click=${() => { this._showSeoRefine = !this._showSeoRefine }}
            ?disabled=${streaming}
            class="h-9 px-3 rounded-md text-[12px] font-semibold text-gray-600 border border-gray-200 hover:border-gray-300 transition-colors disabled:opacity-40"
          >Refine…</button>
        ` : ''}
        <span class="ml-auto text-[11px] text-gray-400">~1,500–2,000 words target</span>
      </div>

      ${this._showSeoRefine ? html`
        <div class="flex gap-2">
          <input
            type="text"
            .value=${this._seoRefineInput}
            @input=${(ev: Event) => { this._seoRefineInput = (ev.target as HTMLInputElement).value }}
            @keydown=${(ev: KeyboardEvent) => { if (ev.key === 'Enter') this._refineSeo() }}
            placeholder="Make it shorter, add a conclusion, etc."
            class="flex-1 rounded-md border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
          />
          <button
            @click=${this._refineSeo}
            ?disabled=${!this._seoRefineInput.trim() || streaming}
            class="h-9 px-3 rounded-md text-[12px] font-bold text-white bg-[#063853] hover:bg-[#04293D] disabled:opacity-40 disabled:cursor-not-allowed"
          >${this._seoRefining ? '…' : '→'}</button>
        </div>
      ` : ''}

      ${this._seoError ? html`
        <p class="text-[12px] text-red-500">${this._seoError}</p>
      ` : ''}

      <textarea
        rows="18"
        .value=${seoText}
        @blur=${(ev: Event) => {
          if (!streaming) this._patch({ seoArticle: (ev.target as HTMLTextAreaElement).value })
        }}
        ?readonly=${streaming}
        placeholder="Paste or generate the long-form context article here…"
        class="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] leading-relaxed resize-none outline-none focus:border-gray-400 ${streaming ? 'bg-gray-50' : ''}"
      ></textarea>

      <div class="flex items-center justify-between text-[11px] text-gray-400">
        <span>${wc > 0 ? `${wc.toLocaleString()} words` : 'No content yet'}</span>
        <span>Saved independently of the short draft</span>
      </div>

      ${wc > 0 ? html`
        <details class="rounded-md bg-slate-50 border border-slate-200">
          <summary class="flex items-center justify-between px-3 py-2 text-[12px] font-semibold cursor-pointer select-none list-none">
            Context check
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </summary>
          <div class="p-3 text-[12px] space-y-1.5">
            <div class="flex justify-between"><span>Word count</span><span class="font-mono">${wc.toLocaleString()}</span></div>
            <div class="flex justify-between"><span>Target range</span><span class="font-mono ${wc >= 1500 && wc <= 2000 ? 'text-emerald-600' : 'text-amber-600'}">${wc < 1500 ? 'Under target' : wc > 2000 ? 'Over target' : 'On target'}</span></div>
          </div>
        </details>
      ` : ''}
    `

    return html`
      <section class="p-4 space-y-4">
        ${this._card('Context for AI', seoCard)}
      </section>
    `
  }

  // ── Sources tab ───────────────────────────────────────────────────────────────

  private _patchSources(sources: ContentSource[]) {
    this._patch({ sources })
  }

  private _addSource() {
    const next: ContentSource[] = [...(this.entry?.sources ?? []), { title: '', url: '', note: '' }]
    this._patchSources(next)
  }

  private _updateSource(i: number, patch: Partial<ContentSource>) {
    const current = this.entry?.sources ?? []
    const next = current.map((s, j) => (j === i ? { ...s, ...patch } : s))
    this._patchSources(next)
  }

  private _removeSource(i: number) {
    const next = (this.entry?.sources ?? []).filter((_, j) => j !== i)
    this._patchSources(next)
  }

  private _seedSourcesFromInputs() {
    const existing = this.entry?.sources ?? []
    const seeds: ContentSource[] = []
    for (const s of this.entry?.expertSources ?? []) {
      if (s.name.trim() || s.insight.trim()) {
        seeds.push({ title: s.name.trim() || 'Expert insight', url: '', note: s.insight.trim() })
      }
    }
    if (this.entry?.referenceLink.trim()) {
      seeds.push({ title: 'Reference link', url: this.entry.referenceLink.trim(), note: '' })
    }
    if (!seeds.length) return
    // Dedupe against existing by title+url
    const key = (s: ContentSource) => `${s.title}::${s.url}`
    const have = new Set(existing.map(key))
    const merged = [...existing, ...seeds.filter(s => !have.has(key(s)))]
    this._patchSources(merged)
  }

  private async _generateSources() {
    if (!this.apiKey || !this.output.trim()) return
    this._sourcesAbort?.abort()
    const ctrl = new AbortController()
    this._sourcesAbort = ctrl
    this._sourcesAiLoading = true
    this._sourcesAiError = ''
    let text = ''
    const ctx = { contentType: this.contentType, audience: this.audience, topic: this.topic, notes: '', expertSources: [] }
    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: buildSourcesMessage(ctx, this.output) }],
        SYSTEM_PROMPT,
        (chunk) => { text += chunk },
        ctrl.signal,
        2048,
      )
      // Strip possible code fences, then parse
      const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
      const parsed = JSON.parse(cleaned) as Array<Partial<ContentSource>>
      if (!Array.isArray(parsed)) throw new Error('AI response was not a JSON array')
      const additions: ContentSource[] = parsed
        .map(s => ({ title: (s.title ?? '').trim(), url: (s.url ?? '').trim(), note: (s.note ?? '').trim() }))
        .filter(s => s.title || s.url)
      const existing = this.entry?.sources ?? []
      const key = (s: ContentSource) => `${s.title}::${s.url}`
      const have = new Set(existing.map(key))
      const merged = [...existing, ...additions.filter(s => !have.has(key(s)))]
      this._patchSources(merged)
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this._sourcesAiError = err instanceof Error ? err.message : 'Could not parse AI response.'
      }
    } finally {
      this._sourcesAiLoading = false
    }
  }

  private _renderSources() {
    const sources = this.entry?.sources ?? []
    const loading = this._sourcesAiLoading

    const list = html`
      <p class="text-[12px] text-gray-500 leading-snug">
        Track every reference used for this piece — expert interviews, regulator publications, studies,
        or CMS articles. These sources travel with the content so reviewers and future edits have a trail.
      </p>

      <div class="flex items-center gap-2 flex-wrap">
        <button
          @click=${this._generateSources}
          ?disabled=${loading || !this.output.trim() || !this.apiKey}
          class="h-9 px-3 rounded-md text-[12px] font-bold text-white transition-colors ${
            !loading && this.output.trim() && this.apiKey
              ? 'bg-[#063853] hover:bg-[#04293D]'
              : 'bg-[#063853]/40 cursor-not-allowed'
          }"
        >
          ${loading ? html`
            <span class="flex items-center gap-1.5">
              <svg class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Finding sources…
            </span>
          ` : '✨ Suggest sources from content'}
        </button>
        <button
          @click=${this._seedSourcesFromInputs}
          ?disabled=${loading}
          class="h-9 px-3 rounded-md text-[12px] font-semibold text-gray-600 border border-gray-200 hover:border-gray-300 disabled:opacity-40"
        >From inputs</button>
        <button
          @click=${this._addSource}
          ?disabled=${loading}
          class="h-9 px-3 rounded-md text-[12px] font-semibold text-gray-600 border border-gray-200 hover:border-gray-300 disabled:opacity-40"
        >+ Add manually</button>
      </div>

      ${this._sourcesAiError ? html`
        <p class="text-[12px] text-red-500">${this._sourcesAiError}</p>
      ` : ''}

      ${sources.length === 0 ? html`
        <div class="p-4 rounded-md bg-gray-50 border border-gray-100 text-center">
          <p class="text-[12px] text-gray-500">No sources yet. Generate from the content or add them manually.</p>
        </div>
      ` : html`
        <div class="flex flex-col gap-3">
          ${sources.map((s, i) => html`
            <div class="rounded-md border border-gray-200 p-3 flex flex-col gap-2 bg-white">
              <div class="flex items-start gap-2">
                <div class="flex-1 flex flex-col gap-1.5">
                  <input
                    type="text"
                    .value=${s.title}
                    @input=${(ev: Event) => this._updateSource(i, { title: (ev.target as HTMLInputElement).value })}
                    placeholder="Source title"
                    class="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[13px] font-semibold text-gray-900 outline-none focus:border-gray-400"
                  />
                  <input
                    type="url"
                    .value=${s.url}
                    @input=${(ev: Event) => this._updateSource(i, { url: (ev.target as HTMLInputElement).value })}
                    placeholder="https://…"
                    class="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[12px] text-[#063853] outline-none focus:border-gray-400"
                  />
                  <textarea
                    rows="2"
                    .value=${s.note}
                    @input=${(ev: Event) => this._updateSource(i, { note: (ev.target as HTMLTextAreaElement).value })}
                    placeholder="What this source supports (optional)"
                    class="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-700 outline-none focus:border-gray-400 resize-none"
                  ></textarea>
                </div>
                <button
                  @click=${() => this._removeSource(i)}
                  title="Remove source"
                  class="shrink-0 text-gray-400 hover:text-red-500 p-1"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
              ${s.url ? html`
                <a href=${s.url} target="_blank" rel="noopener" class="text-[11px] text-[#063853] underline break-all">${s.url}</a>
              ` : ''}
            </div>
          `)}
        </div>
      `}
    `

    return html`
      <section class="p-4 space-y-4">
        ${this._card('Sources', list)}
      </section>
    `
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────────

  private _tabBtn(id: typeof this._tab, label: string, badge?: string) {
    const active = this._tab === id
    return html`
      <button
        @click=${() => { this._tab = id }}
        class="relative px-3 h-10 text-[12px] font-semibold transition-colors ${
          active ? 'text-[#063853]' : 'text-gray-400 hover:text-gray-600'
        }"
      >
        ${label}
        ${badge ? html`<span class="ml-1 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">${badge}</span>` : ''}
        ${active ? html`<span class="absolute inset-x-3 -bottom-px h-[2px] bg-[#063853] rounded-full"></span>` : ''}
      </button>
    `
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  override render() {
    if (this._collapsed) {
      return html`
        <aside class="w-10 min-w-[40px] bg-white border-l border-gray-100 flex flex-col items-center py-4 shrink-0 overflow-hidden transition-all duration-200">
          <button
            @click=${() => { this._collapsed = false }}
            class="text-gray-400 hover:text-gray-600 transition-colors"
            title="Expand details panel"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="mt-4 text-[9px] font-bold tracking-widest uppercase text-gray-300 writing-vertical select-none"
            style="writing-mode:vertical-lr;transform:rotate(180deg)">Details</span>
        </aside>
      `
    }

    return html`
      <aside class="w-[380px] min-w-[380px] h-full bg-white border-l border-gray-100 flex flex-col overflow-hidden shrink-0 transition-all duration-200 relative">
        ${this._renderToast()}

        <!-- Panel header -->
        <div class="flex items-center justify-between px-4 h-12 border-b border-gray-100 shrink-0">
          <span class="text-[12px] font-bold tracking-widest uppercase text-[#383838]">Details</span>
          <button
            @click=${() => { this._collapsed = true }}
            class="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >Collapse →</button>
        </div>

        <!-- Sub-tabs: horizontally scrollable so the last tab (Image) never
             clips off the right edge at narrow panel widths. Scrollbar is
             hidden; hover reveals native scroll. -->
        <div class="flex items-end px-1 border-b border-gray-100 shrink-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          ${this._tabBtn('publish', 'Publish')}
          ${this._tabBtn('meta', 'Meta')}
          ${this._tabBtn('categories', 'Categories', this._catSuggestions.length > 0 ? String(this._catSuggestions.length) : undefined)}
          ${this._isArticle ? this._tabBtn('context', 'Context', this._isContextStale ? '!' : undefined) : ''}
          ${this._tabBtn('sources', 'Sources', (this.entry?.sources.length ?? 0) > 0 ? String(this.entry!.sources.length) : undefined)}
          ${this._tabBtn('image', 'Image')}
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto min-h-0">
          ${!this.entry ? html`
            <section class="p-4 space-y-4">
              <!-- Ambient quality checklist works even before first save -->
              <ff-quality-check
                .entry=${null}
                .output=${this.output}
                .contentType=${this.contentType}
                .topic=${this.topic}
                @quality-jump-tab=${(ev: CustomEvent<string>) => { this._tab = ev.detail as typeof this._tab }}
              ></ff-quality-check>
              <div class="p-5 rounded-lg bg-gray-50 border border-gray-100 text-center">
                <p class="text-[13px] font-medium text-gray-600 mb-1">Save to unlock details</p>
                <p class="text-[12px] text-gray-400 leading-snug">
                  Metadata, categories, context, sources, and workflow will appear here once this draft has a home in the Library.
                </p>
              </div>
              <!-- Tabs are disabled until entry exists, shown as preview -->
              <div class="space-y-1.5 opacity-50 pointer-events-none">
                ${['Publish', 'Meta', 'Categories', 'Context', 'Sources', 'Image'].map(t => html`
                  <div class="flex items-center justify-between px-3 py-2 rounded-md border border-gray-100">
                    <span class="text-[12px] font-semibold text-gray-400">${t}</span>
                    <span class="text-[10px] text-gray-300">Locked</span>
                  </div>
                `)}
              </div>
            </section>
          ` : html`
            <!-- Quality check sits above every tab so it's always visible -->
            <section class="p-4 pb-0">
              <ff-quality-check
                .entry=${this.entry}
                .output=${this.output}
                .contentType=${this.contentType}
                .topic=${this.topic}
                @quality-jump-tab=${(ev: CustomEvent<string>) => { this._tab = ev.detail as typeof this._tab }}
              ></ff-quality-check>
            </section>
            ${this._tab === 'publish' ? this._renderPublish() : ''}
            ${this._tab === 'meta' ? this._renderMeta() : ''}
            ${this._tab === 'categories' ? html`<div data-anchor="field-categories">${this._renderCategories()}</div>` : ''}
            ${this._tab === 'context' && this._isArticle ? this._renderContext() : ''}
            ${this._tab === 'sources' ? this._renderSources() : ''}
            ${this._tab === 'image' ? this._renderFeaturedImage() : ''}
          `}
        </div>

      </aside>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-details-panel': FFDetailsPanel }
}
