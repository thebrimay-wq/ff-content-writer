import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { ExpertSource, GenerateRequest, Message } from '../lib/api'
import { buildRefinementMessage, buildJsonUserMessage, buildJsonRefinementMessage, streamMessage, extractCustomTags, restoreCustomTags } from '../lib/api'
import { emptyContentForType } from '../lib/contentTypeSchemas'
import { loadArticles } from '../lib/articles'
import { SYSTEM_PROMPT } from '../lib/systemPrompt'
import { JSON_SYSTEM_PROMPT } from '../lib/jsonSystemPrompt'
import {
  createEntry,
  deleteEntry,
  emptyTrash,
  getCurrentUser,
  getHiddenIds,
  hideEntry,
  loadAll,
  patchEntry,
  purgeSeedEntries,
  restoreEntry,
  setCurrentUser,
  updateEntry,
  type ContentEntry,
  type ContentStatus,
} from '../lib/store'
import './ff-sidebar'
import './ff-output-panel'
import './ff-api-key-modal'
import './ff-library'
import './ff-details-panel'
import './ff-selection-toolbar'
import { DEFAULT_REGION, DEFAULT_LANGUAGE, languagesForRegion, versionConfig, regionFlag, regionLabel } from '../lib/versionConfig'
type Tab = 'new' | 'library'

const STATUS_CHIP: Record<ContentStatus, string> = {
  draft:     'bg-gray-100 text-gray-500',
  in_review: 'bg-amber-100 text-amber-800',
  approved:  'bg-blue-100 text-blue-800',
  published: 'bg-emerald-100 text-emerald-800',
  trash:     'bg-red-100 text-red-800',
}
const STATUS_LABELS: Record<ContentStatus, string> = {
  draft:     'Draft',
  in_review: 'In Review',
  approved:  'Approved',
  published: 'Published',
  trash:     'Trash',
}

@customElement('ff-app')
export class FFApp extends LitElement {
  override createRenderRoot() { return this }

  @state() private apiKey =
    (import.meta.env.VITE_ANTHROPIC_KEY as string | undefined) ??
    localStorage.getItem('ff_api_key') ??
    ''
  @state() private keyIsEnvConfigured = !!import.meta.env.VITE_ANTHROPIC_KEY
  @state() private showApiModal = false

  @state() private tab: Tab = 'new'
  // First-screen intent gate. 'choice' renders the combined picker (Blank
  // vs AI Assist + Region/Language); once the user picks a mode we land in
  // 'manual' or 'ai' and the editor takes over. The sidebar still has a
  // toggle pill for mid-flow switches.
  @state() private creationMode: 'choice' | 'region' | 'manual' | 'ai' = 'choice'
  @state() private region = DEFAULT_REGION
  @state() private language = DEFAULT_LANGUAGE
  @state() private entries: ContentEntry[] = []
  @state() private editingId: string | null = null
  @state() private isDirty = false
  @state() private _pendingNewContent = false

  // Sidebar / prompt fields
  @state() private contentType = 'article'
  @state() private audience = 'all'
  @state() private topic = ''
  @state() private promptNotes = ''
  @state() private expertSources: ExpertSource[] = [{ insight: '', name: '', image: '' }]

  @state() private output = ''
  @state() private isGenerating = false
  @state() private error = ''
  @state() private lastRequest: GenerateRequest | null = null
  @state() private _prevOutput: string | null = null

  // Streaming progress — surfaced to sidebar + output panel for a real indicator.
  @state() private _streamCharCount = 0
  @state() private _streamStartAt: number | null = null
  @state() private _streamElapsedMs = 0
  private _streamTicker: ReturnType<typeof setInterval> | null = null

  // Autosave state
  @state() private _lastSavedAt: number | null = null
  @state() private _autosaveNotice: 'idle' | 'saving' | 'saved' = 'idle'
  private _autosaveTimer: ReturnType<typeof setInterval> | null = null

  // Convert-to flow
  @state() private _showConvertPicker = false
  // Split-button menu for "+ New Content ▾" in the top-right.
  @state() private _showNewMenu = false
  // Which mode the next New Content action should start in. Defaults to AI.
  private _pendingNewMode: 'manual' | 'ai' = 'ai'

  // Name-your-draft prompt (fires on first save when no title could be derived)
  @state() private _showNamePrompt = false
  @state() private _nameDraft = ''

  // Pending AI passage rewrite — diff card shows Before/After, user Accepts
  // or Rejects. Nothing is written to `output` until Accept. See
  // _handleSelectionAI for how this is populated.
  @state() private _pendingRewrite: {
    before: string
    after: string
    instruction: string
    action: string
    streaming: boolean
  } | null = null

  private _abort: AbortController | null = null

  private get _currentEntry(): ContentEntry | null {
    if (!this.editingId) return null
    return this.entries.find(e => e.id === this.editingId) ?? null
  }

  override connectedCallback() {
    super.connectedCallback()
    purgeSeedEntries()
    window.addEventListener('keydown', this._onKeyDown)
    document.addEventListener('click', this._onDocClick)
    this._refreshEntries()
    // Autosave every 10 seconds: if we have an entry id and it's dirty, persist quietly.
    this._autosaveTimer = setInterval(() => this._maybeAutosave(), 10_000)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this._onKeyDown)
    document.removeEventListener('click', this._onDocClick)
    if (this._autosaveTimer) clearInterval(this._autosaveTimer)
    if (this._streamTicker) clearInterval(this._streamTicker)
  }

  // Close the New Content split-button menu on any outside click.
  private _onDocClick = () => {
    if (this._showNewMenu) this._showNewMenu = false
  }

  private _maybeAutosave() {
    if (!this.editingId) return
    if (!this.isDirty) return
    if (this.isGenerating) return
    if (!this.output.trim()) return
    this._autosaveNotice = 'saving'
    const payload = {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      promptNotes: this.promptNotes,
      expertSources: this.expertSources,
      output: this.output,
    }
    const updated = updateEntry(this.editingId, payload)
    if (updated) {
      this.editingId = updated.id
      this.isDirty = false
      this._lastSavedAt = Date.now()
      this._autosaveNotice = 'saved'
      this._refreshEntries()
      setTimeout(() => {
        if (this._autosaveNotice === 'saved') this._autosaveNotice = 'idle'
      }, 2500)
    } else {
      this._autosaveNotice = 'idle'
    }
  }

  private _onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!this.isGenerating && this.topic.trim()) this._generate()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      if (this.output.trim()) {
        e.preventDefault()
        this._save()
      }
    }
  }

  private _refreshEntries() {
    const stored = loadAll()
    const hidden = getHiddenIds()
    const storedIds = new Set(stored.map(e => e.id))
    // Merge real CMS articles into library; exclude any the user has dismissed or overridden.
    const cmsEntries = loadArticles().filter(a => !storedIds.has(a.id) && !hidden.has(a.id))
    this.entries = [...stored, ...cmsEntries]
  }

  private _markDirty() {
    if (!this.isDirty) this.isDirty = true
  }

  private async _runStream(
    messages: Message[],
    postProcess?: (output: string) => string,
    opts: { systemPrompt?: string; maxTokens?: number } = {},
  ) {
    this._abort?.abort()
    const controller = new AbortController()
    this._abort = controller
    this._prevOutput = this.output || null
    this.output = ''
    this.error = ''
    this.isGenerating = true
    // Progress tracking
    this._streamCharCount = 0
    this._streamStartAt = Date.now()
    this._streamElapsedMs = 0
    if (this._streamTicker) clearInterval(this._streamTicker)
    this._streamTicker = setInterval(() => {
      if (this._streamStartAt) this._streamElapsedMs = Date.now() - this._streamStartAt
    }, 200)
    try {
      await streamMessage(
        this.apiKey,
        messages,
        opts.systemPrompt ?? SYSTEM_PROMPT,
        (chunk) => {
          this.output += chunk
          this._streamCharCount += chunk.length
          this._markDirty()
        },
        controller.signal,
        opts.maxTokens ?? 2048,
      )
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this.error = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      }
    } finally {
      if (postProcess && this.output) this.output = postProcess(this.output)
      this.isGenerating = false
      if (this._streamTicker) { clearInterval(this._streamTicker); this._streamTicker = null }
      this._streamStartAt = null
    }
  }

  private _generate() {
    if (!this.apiKey) { this.showApiModal = true; return }
    const req: GenerateRequest = {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      notes: this.promptNotes,
      expertSources: this.expertSources,
    }
    this.lastRequest = req
    this.editingId = null
    this._runStream(
      [{ role: 'user', content: buildJsonUserMessage(req) }],
      undefined,
      { systemPrompt: JSON_SYSTEM_PROMPT, maxTokens: 8192 },
    )
  }

  private _regenerate() {
    if (!this.lastRequest) return
    this._runStream(
      [{ role: 'user', content: buildJsonUserMessage(this.lastRequest) }],
      undefined,
      { systemPrompt: JSON_SYSTEM_PROMPT, maxTokens: 8192 },
    )
  }

  private _refine(e: CustomEvent<string>) {
    if (!this.output) return
    const ctx: GenerateRequest = this.lastRequest ?? {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      notes: this.promptNotes,
      expertSources: this.expertSources,
    }
    // Extract custom tags before sending to AI; restore them once streaming ends
    const { sanitized, tags } = extractCustomTags(this.output)
    const msg = buildRefinementMessage(sanitized, e.detail, ctx)
    const postProcess = tags.length > 0 ? (out: string) => restoreCustomTags(out, tags) : undefined
    this._runStream([{ role: 'user', content: msg }], postProcess)
  }

  private _jsonRefine(e: CustomEvent<string>) {
    if (!this.output) return
    const ctx: GenerateRequest = this.lastRequest ?? {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      notes: this.promptNotes,
      expertSources: this.expertSources,
    }
    const msg = buildJsonRefinementMessage(this.output, e.detail, ctx)
    this._runStream(
      [{ role: 'user', content: msg }],
      undefined,
      { systemPrompt: JSON_SYSTEM_PROMPT, maxTokens: 8192 },
    )
  }

  private _outputChange(e: CustomEvent<string>) {
    if (this.output !== e.detail) {
      this.output = e.detail
      this._markDirty()
    }
  }

  /**
   * A user clicked a signal in the ambient quality checklist. Route the
   * instruction through whichever refine pipeline matches the current type.
   */
  private _handleQualityFix(e: CustomEvent<{ kind: string; instruction: string }>) {
    if (!this.apiKey) { this.showApiModal = true; return }
    if (this.isGenerating) return
    const { kind, instruction } = e.detail
    // For "title" and "excerpt" we still want to refine the existing draft
    // with the instruction — the model will merge the change in.
    const ctx: GenerateRequest = this.lastRequest ?? {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      notes: this.promptNotes,
      expertSources: this.expertSources,
    }
    if (!this.output.trim()) return
    if (this.contentType === 'article') {
      const { sanitized, tags } = extractCustomTags(this.output)
      const msg = buildRefinementMessage(sanitized, instruction, ctx)
      const postProcess = tags.length > 0 ? (out: string) => restoreCustomTags(out, tags) : undefined
      this._runStream([{ role: 'user', content: msg }], postProcess)
    } else {
      const msg = buildJsonRefinementMessage(this.output, instruction, ctx)
      this._runStream(
        [{ role: 'user', content: msg }],
        undefined,
        { systemPrompt: JSON_SYSTEM_PROMPT, maxTokens: 8192 },
      )
    }
    // Silence the "unused" parameter warning — kind may be used for analytics later.
    void kind
  }

  /**
   * Selection toolbar asked for an AI action on a specific passage.
   * We inject the highlighted text into the refine instruction so the model
   * knows exactly what to touch.
   */
  // Selection AI: user highlighted a passage and picked an action (Warmer /
  // Shorten / etc.). We send ONLY the passage to the model, stream the
  // rewritten version into a pending-rewrite diff card (Before/After), and
  // let the user Accept or Reject before any change touches `output`.
  private async _handleSelectionAI(e: CustomEvent<{ text: string; action: string; instruction: string }>) {
    if (!this.apiKey) { this.showApiModal = true; return }
    if (this.isGenerating) return
    if (!this.output.trim()) return
    const { text, action, instruction } = e.detail
    if (!text || !text.trim()) return
    await this._runPassageRewrite(text, action, instruction)
  }

  private _buildPassagePrompt(text: string, instruction: string) {
    return [
      'Rewrite the passage below per the instruction.',
      'Return ONLY the rewritten passage — no quotation marks, no labels, no markdown code fences, no commentary.',
      'Keep the length similar to the original. Preserve **bold**, *italic*, and links that appeared in the passage.',
      '',
      'Passage:',
      text,
      '',
      `Instruction: ${instruction}`,
    ].join('\n')
  }

  private async _runPassageRewrite(text: string, action: string, instruction: string) {
    const prompt = this._buildPassagePrompt(text, instruction)
    this._abort?.abort()
    const controller = new AbortController()
    this._abort = controller
    this._pendingRewrite = { before: text, after: '', instruction, action, streaming: true }
    this._streamCharCount = 0
    this._streamStartAt = Date.now()
    this._streamElapsedMs = 0
    if (this._streamTicker) clearInterval(this._streamTicker)
    this._streamTicker = setInterval(() => {
      if (this._streamStartAt) this._streamElapsedMs = Date.now() - this._streamStartAt
    }, 200)

    let accumulated = ''
    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: prompt }],
        'You are a careful copy editor. Return only the rewritten passage, nothing else.',
        (chunk) => {
          accumulated += chunk
          this._streamCharCount += chunk.length
          if (this._pendingRewrite && this._pendingRewrite.before === text) {
            this._pendingRewrite = { ...this._pendingRewrite, after: accumulated }
          }
        },
        controller.signal,
        1024,
      )
      let rewritten = accumulated.trim()
      rewritten = rewritten.replace(/^```[a-z]*\n?|\n?```$/gi, '').trim()
      rewritten = rewritten.replace(/^["'](.+)["']$/s, '$1').trim()
      if (!rewritten) { this._pendingRewrite = null; return }
      if (this._pendingRewrite && this._pendingRewrite.before === text) {
        this._pendingRewrite = { ...this._pendingRewrite, after: rewritten, streaming: false }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this.error = err instanceof Error ? err.message : 'Something went wrong.'
      }
      this._pendingRewrite = null
    } finally {
      if (this._streamTicker) { clearInterval(this._streamTicker); this._streamTicker = null }
      this._streamStartAt = null
    }
  }

  // Accept the pending rewrite: substitute `before` → `after` in output.
  private _acceptPendingRewrite = () => {
    const pr = this._pendingRewrite
    if (!pr || pr.streaming) return
    const idx = this.output.indexOf(pr.before)
    if (idx !== -1) {
      this._prevOutput = this.output
      this.output = this.output.slice(0, idx) + pr.after + this.output.slice(idx + pr.before.length)
      this._markDirty()
    }
    this._pendingRewrite = null
  }

  // Reject: toss the rewrite, keep the original untouched.
  private _rejectPendingRewrite = () => {
    this._abort?.abort()
    this._pendingRewrite = null
  }

  // Try again: re-run the same passage + instruction through the model.
  private _retryPendingRewrite = () => {
    const pr = this._pendingRewrite
    if (!pr) return
    this._runPassageRewrite(pr.before, pr.action, pr.instruction)
  }

  /**
   * Convert the current piece to a different content type by re-running
   * generation with the same topic / notes / audience / output as source.
   */
  private _convertTo(newType: string) {
    if (!this.apiKey) { this.showApiModal = true; return }
    if (newType === this.contentType) { this._showConvertPicker = false; return }
    this.contentType = newType
    this.editingId = null
    this._showConvertPicker = false
    const req: GenerateRequest = {
      contentType: newType,
      audience: this.audience,
      topic: this.topic,
      notes: this.promptNotes +
        (this.output.trim()
          ? `\n\nExisting draft to adapt into the new format (preserve the key facts, stats, and examples):\n---\n${this.output.slice(0, 4000)}\n---`
          : ''),
      expertSources: this.expertSources,
    }
    this.lastRequest = req
    this._runStream(
      [{ role: 'user', content: buildJsonUserMessage(req) }],
      undefined,
      { systemPrompt: JSON_SYSTEM_PROMPT, maxTokens: 8192 },
    )
  }

  private _onContentTypeResolved(e: CustomEvent<string>) {
    const resolved = e.detail
    if (resolved && resolved !== this.contentType) {
      this.contentType = resolved
    }
  }

  private _clear() {
    this._abort?.abort()
    this.output = ''
    this.error = ''
    this.lastRequest = null
    this.isGenerating = false
    this.editingId = null
    this.isDirty = false
  }

  private _saveApiKey(e: CustomEvent<string>) {
    localStorage.setItem('ff_api_key', e.detail)
    this.apiKey = e.detail
    this.showApiModal = false
  }

  /**
   * True if saving now would leave this entry as "Untitled draft" — no topic
   * set, and no leading heading in the output. We block the save in that case
   * so new drafts are always distinguishable in the library.
   */
  private _wouldBeUntitled(): boolean {
    if (this.topic.trim()) return false
    const firstLine = this.output.split('\n').map(l => l.trim()).find(Boolean) ?? ''
    const cleaned = firstLine.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()
    return !cleaned
  }

  private _save() {
    if (!this.output.trim()) return
    // Only nudge for first-time saves — editing an existing entry keeps
    // its current title even if we can't derive a new one.
    if (!this.editingId && this._wouldBeUntitled()) {
      this._nameDraft = ''
      this._showNamePrompt = true
      return
    }
    this._doSave()
  }

  private _doSave() {
    const payload = {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      promptNotes: this.promptNotes,
      expertSources: this.expertSources,
      output: this.output,
      region: this.region,
      language: this.language,
    }
    if (this.editingId) {
      const updated = updateEntry(this.editingId, payload)
      if (updated) this.editingId = updated.id
    } else {
      const created = createEntry(payload)
      this.editingId = created.id
    }
    this.isDirty = false
    this._refreshEntries()
  }

  private _confirmNameAndSave() {
    const name = this._nameDraft.trim()
    if (!name) return
    // Use the name as the topic so deriveTitle picks it up. Also mark dirty
    // so any in-flight autosave knows there's a change.
    this.topic = name
    this._markDirty()
    this._showNamePrompt = false
    this._nameDraft = ''
    this._doSave()
  }

  private _discardChanges() {
    const saved = this._currentEntry?.output ?? ''
    this._prevOutput = this.output || null
    this.output = saved
    this.isDirty = false
  }

  private _undoOutput() {
    if (this._prevOutput === null) return
    const current = this.output
    this.output = this._prevOutput
    this._prevOutput = current || null
    this._markDirty()
  }

  private _patchEntry(e: CustomEvent<Partial<ContentEntry>>) {
    if (!this.editingId) return
    let patch = e.detail
    // Stamp publishedAt on first transition to published
    if (patch.status === 'published') {
      const current = this._currentEntry
      if (current && current.status !== 'published') {
        patch = { ...patch, publishedAt: Date.now() }
      }
    }
    patchEntry(this.editingId, patch)
    this._refreshEntries()
  }

  private _handleStatusChange(e: CustomEvent<string>) {
    if (!this.editingId) return
    const newStatus = e.detail as ContentStatus
    let patch: Partial<ContentEntry> = { status: newStatus }
    if (newStatus === 'published') {
      const current = this._currentEntry
      if (current && current.status !== 'published') patch.publishedAt = Date.now()
    }
    patchEntry(this.editingId, patch)
    this._refreshEntries()
  }

  private _openEntry(e: CustomEvent<ContentEntry>) {
    const entry = e.detail
    this.contentType = entry.contentType
    this.audience = entry.audience
    this.topic = entry.topic
    this.promptNotes = entry.promptNotes
    this.expertSources = entry.expertSources.length
      ? entry.expertSources
      : [{ insight: '', name: '', image: '' }]
    this.output = entry.output
    this.lastRequest = {
      contentType: entry.contentType,
      audience: entry.audience,
      topic: entry.topic,
      notes: entry.promptNotes,
      expertSources: entry.expertSources,
    }
    this.editingId = entry.id
    this.isDirty = false
    this.error = ''
    this.tab = 'new'
    this.creationMode = 'ai'
  }

  private _deleteEntry(e: CustomEvent<string>) {
    const id = e.detail
    if (id.startsWith('cms_')) {
      hideEntry(id)
    } else {
      deleteEntry(id)
    }
    if (this.editingId === id) this._clear()
    this._refreshEntries()
  }

  private _newContent() {
    if (this.isDirty && this.output.trim()) {
      this._pendingNewContent = true
      return
    }
    this._doNewContent()
  }

  private _doNewContent() {
    this._clear()
    this.tab = 'new'
    // If the split button explicitly picked a mode, honor it. Otherwise show
    // the combined choice gate so the user makes an intentional decision.
    const mode = this._pendingNewMode
    this._pendingNewMode = 'ai' // reset for next time
    this.region = DEFAULT_REGION
    this.language = DEFAULT_LANGUAGE
    this._pendingNewContent = false
    if (this._explicitNewMode) {
      this._explicitNewMode = false
      if (mode === 'manual') this._startManualMode()
      else this._startAiMode()
    } else {
      this.creationMode = 'choice'
    }
  }
  // Set when the user clicks a specific menu item in the New Content split
  // button. When false, _doNewContent shows the choice gate.
  private _explicitNewMode = false

  // Split button handlers — top-right "+ New Content ▾"
  private _newContentWith(mode: 'manual' | 'ai') {
    this._pendingNewMode = mode
    this._explicitNewMode = true
    this._showNewMenu = false
    this._newContent()
  }

  // Flip between Blank and AI mid-flow. Preserves output, topic, and notes
  // so the user can switch freely without losing work.
  private _flipMode(mode: 'manual' | 'ai') {
    if (this.creationMode === mode) return
    this.creationMode = mode
  }

  private _confirmSaveAndNew() {
    this._save()
    this._doNewContent()
  }

  private _switchTab(tab: Tab) {
    if (this.tab === tab) return
    this.tab = tab
    if (tab === 'library') this._refreshEntries()
  }

  private _blankOutput(contentType: string): string {
    // Article is markdown — handled by the empty editor form in manualMode
    if (contentType === 'article') return ''
    return JSON.stringify(emptyContentForType(contentType), null, 2)
  }

  private _onRegionChange(e: CustomEvent<string>) {
    this._setRegion(e.detail)
    if (this.editingId) this._markDirty()
  }

  private _onLanguageChange(e: CustomEvent<string>) {
    this.language = e.detail
    if (this.editingId) this._markDirty()
  }

  private _setRegion(region: string) {
    this.region = region
    const langs = languagesForRegion(region)
    // Prefer English; otherwise the first available language.
    const preferred = langs.find(l => l.value === 'en') ?? langs[0]
    this.language = preferred?.value ?? ''
  }

  private _startManualMode() {
    this._abort?.abort()
    this.creationMode = 'manual'
    this.editingId = null
    this.output = this._blankOutput(this.contentType)
    this.isDirty = false
    this.error = ''
    this.lastRequest = null
    this.isGenerating = false
    this._pendingNewContent = false
    this.tab = 'new'
  }

  private _startAiMode() {
    this._abort?.abort()
    this.creationMode = 'ai'
    this.editingId = null
    this.output = ''
    this.isDirty = false
    this.error = ''
    this.lastRequest = null
    this.isGenerating = false
    this._pendingNewContent = false
    this.tab = 'new'
  }

  // Gate screens (creation-choice and region-choice) were removed in favor
  // of the inline left-nav toggle (Option A) and top-right split button
  // (Option C). Region/language lives as a chip in the sidebar.

  // ── Render ───────────────────────────────────────────────────────────────────

  private _renderNewContentConfirm() {
    if (!this._pendingNewContent) return ''
    return html`
      <div class="fixed inset-0 bg-black/25 flex items-center justify-center z-50"
        @click=${(e: Event) => { if (e.target === e.currentTarget) this._pendingNewContent = false }}>
        <div class="bg-white rounded-xl shadow-xl p-6 w-[360px] max-w-[calc(100vw-2rem)] mx-4">
          <h3 class="text-[15px] font-semibold text-[#1a1a1a] mb-1.5">Unsaved changes</h3>
          <p class="text-[13px] text-gray-500 mb-5">You have unsaved changes. What would you like to do?</p>
          <div class="flex flex-col gap-2">
            <button @click=${this._confirmSaveAndNew}
              class="w-full px-4 py-2.5 text-[13px] font-semibold text-white bg-[#063853] hover:bg-[#04293D] rounded-lg transition-colors">
              Save and start new
            </button>
            <button @click=${this._doNewContent}
              class="w-full px-4 py-2.5 text-[13px] font-medium text-[#383838] bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              Discard changes
            </button>
            <button @click=${() => { this._pendingNewContent = false }}
              class="w-full px-4 py-2.5 text-[13px] text-gray-400 hover:text-gray-600 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    `
  }

  // Combined intent gate: choose Blank vs AI Assist + confirm Region/Language.
  // Designed to be obvious: oversized cards, big icons, clear contrast on
  // hover, region/language already prefilled with the defaults so a writer
  // can skip straight past it.
  private _renderIntentGate() {
    const langs = languagesForRegion(this.region)
    return html`
      <div class="flex flex-col flex-1 items-center justify-center bg-gradient-to-b from-gray-50/40 to-white px-6 py-10 overflow-y-auto">
        <div class="w-full max-w-[760px]">

          <div class="text-center mb-8">
            <h2 class="text-[28px] font-bold text-[#1a1a1a] mb-2 leading-tight">How do you want to start?</h2>
            <p class="text-[15px] text-gray-500">Pick a starting point. You can switch anytime from the sidebar.</p>
          </div>

          <!-- Two big mode cards -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">

            <!-- Write my own -->
            <button
              @click=${() => this._newContentWith('manual')}
              class="group relative flex flex-col items-start gap-4 p-7 rounded-2xl bg-white border-2 border-gray-200 hover:border-[#063853] hover:shadow-lg transition-all cursor-pointer text-left"
            >
              <div class="w-14 h-14 rounded-xl bg-[#063853]/[0.06] group-hover:bg-[#063853]/[0.12] flex items-center justify-center transition-colors">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                  <path d="M18 4l4 4-12 12-5 1 1-5L18 4z" stroke="#063853" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div>
                <p class="text-[18px] font-bold text-[#1a1a1a] mb-1.5">Write it myself</p>
                <p class="text-[14px] text-gray-500 leading-relaxed">Start with a blank page and write directly. No AI involvement until you ask for it.</p>
              </div>
              <div class="mt-auto pt-2 text-[12px] font-semibold text-gray-400 group-hover:text-[#063853] transition-colors flex items-center gap-1">
                Start blank
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6h6m-2-3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </button>

            <!-- Use AI Assist -->
            <button
              @click=${() => this._newContentWith('ai')}
              class="group relative flex flex-col items-start gap-4 p-7 rounded-2xl bg-white border-2 border-gray-200 hover:border-[#5b4ad6] hover:shadow-lg transition-all cursor-pointer text-left"
            >
              <div class="w-14 h-14 rounded-xl bg-violet-50 group-hover:bg-violet-100 flex items-center justify-center transition-colors">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                  <path d="M13 3l2.5 7.5L23 13l-7.5 2.5L13 23l-2.5-7.5L3 13l7.5-2.5L13 3z" fill="#7c70e3"/>
                </svg>
              </div>
              <div>
                <p class="text-[18px] font-bold text-[#1a1a1a] mb-1.5">Draft with AI</p>
                <p class="text-[14px] text-gray-500 leading-relaxed">Describe what you want. AI writes a first draft you can edit, refine, and publish.</p>
              </div>
              <div class="mt-auto pt-2 text-[12px] font-semibold text-gray-400 group-hover:text-[#5b4ad6] transition-colors flex items-center gap-1">
                ✨ Generate a draft
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6h6m-2-3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </button>
          </div>

          <!-- Region + language confirmation row -->
          <div class="rounded-xl border border-gray-200 bg-white px-5 py-4">
            <div class="flex items-center justify-between gap-3 mb-3">
              <p class="text-[13px] font-semibold text-[#1a1a1a]">Writing for</p>
              <p class="text-[11px] text-gray-400">You can change this later, too.</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Region</label>
                <div class="relative">
                  <select
                    .value=${this.region}
                    @change=${(e: Event) => this._setRegion((e.target as HTMLSelectElement).value)}
                    class="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none focus:border-gray-400 pr-9 cursor-pointer"
                  >
                    ${versionConfig.options.map(o => html`
                      <option value=${o.region} ?selected=${o.region === this.region}>${regionFlag(o.region)} ${o.label}</option>
                    `)}
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg class="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="none">
                      <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Language</label>
                <div class="relative">
                  <select
                    .value=${this.language}
                    @change=${(e: Event) => { this.language = (e.target as HTMLSelectElement).value }}
                    ?disabled=${langs.length <= 1}
                    class="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none focus:border-gray-400 pr-9 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    ${langs.map(l => html`<option value=${l.value} ?selected=${l.value === this.language}>${l.label}</option>`)}
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg class="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="none">
                      <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
            <p class="text-[11px] text-gray-400 mt-2.5">Default: ${regionFlag(this.region)} ${regionLabel(this.region)} · ${langs.find(l => l.value === this.language)?.label ?? this.language}</p>
          </div>

        </div>
      </div>
    `
  }

  private _renderTabs() {
    const visibleCount = this.entries.filter(e => e.status !== 'trash').length
    const current = this._currentEntry

    const tab = (id: Tab, label: string, badge?: number) => html`
      <button
        @click=${() => id === 'new' ? this._newContent() : this._switchTab(id)}
        class="relative h-12 px-4 text-[13px] font-semibold transition-colors flex items-center gap-2 ${
          this.tab === id ? 'text-[#063853]' : 'text-gray-400 hover:text-gray-600'
        }"
      >
        ${label}
        ${badge !== undefined ? html`
          <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            this.tab === id ? 'bg-[#063853]/10 text-[#063853]' : 'bg-gray-100 text-gray-400'
          }">${badge}</span>
        ` : ''}
        ${this.tab === id ? html`
          <span class="absolute inset-x-2 bottom-0 h-[2px] bg-[#063853] rounded-full"></span>
        ` : ''}
      </button>
    `

    return html`
      <div class="flex items-center justify-between px-4 h-12 shrink-0 bg-white border-b border-gray-100">

        <!-- Left: tabs -->
        <div class="flex items-center">
          ${tab('new', 'New Content')}
          ${tab('library', 'Library', visibleCount)}
        </div>

        <!-- Right: unified status chip + Convert + New Content.
             Single chip combines workflow status (Draft/Published/etc.) with
             save state (saving / unsaved / saved). Replaces the old dual-pill
             layout that showed "Saved" and "Draft" side-by-side and confused
             users about what state they were actually in. -->
        <div class="flex items-center gap-3 shrink-0">
          ${current ? (() => {
              const isDraft = current.status === 'draft'
              const savingTail = this._autosaveNotice === 'saving' ? ' · saving…'
                : this.isDirty ? ' · unsaved'
                : this.editingId ? ' · saved' : ''
              const tailTone = this._autosaveNotice === 'saving' ? 'text-gray-400'
                : this.isDirty ? 'text-amber-600'
                : 'text-gray-400'
              return html`
                <span
                  class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[current.status]}"
                  title=${this._lastSavedAt
                    ? `Last saved ${new Date(this._lastSavedAt).toLocaleTimeString()}`
                    : 'Workflow status — change in Details panel'}
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-current opacity-80"></span>
                  ${STATUS_LABELS[current.status]}
                  ${this.editingId || isDraft ? html`<span class="${tailTone} font-normal">${savingTail}</span>` : ''}
                </span>
              `
            })() : ''}
          <!-- Convert-to moved to the sidebar, next to the locked Content Type chip -->

          <!-- Split button: main face = New Content (default AI mode),
               caret = pick Blank or Draft with AI explicitly. -->
          <div class="relative inline-flex items-stretch rounded-lg bg-[#063853] text-white overflow-hidden">
            <button
              @click=${() => this._newContentWith('ai')}
              class="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 hover:bg-[#04293D] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
              New Content
            </button>
            <div class="w-px bg-white/20"></div>
            <button
              @click=${(e: Event) => { e.stopPropagation(); this._showNewMenu = !this._showNewMenu }}
              class="px-2 hover:bg-[#04293D] transition-colors flex items-center"
              title="Choose how to start"
              aria-label="New Content options"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            ${this._showNewMenu ? html`
              <div
                @click=${(e: Event) => e.stopPropagation()}
                class="absolute right-0 top-[calc(100%+4px)] z-20 w-[200px] bg-white rounded-lg border border-gray-200 shadow-lg p-1"
              >
                <button
                  @click=${() => this._newContentWith('manual')}
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[12px] text-[#1a1a1a] hover:bg-gray-50 text-left"
                >
                  <span class="text-[13px]">✏️</span>
                  <div class="flex flex-col">
                    <span class="font-semibold">Blank</span>
                    <span class="text-[10px] text-gray-400">Start writing yourself.</span>
                  </div>
                </button>
                <button
                  @click=${() => this._newContentWith('ai')}
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[12px] text-[#1a1a1a] hover:bg-gray-50 text-left"
                >
                  <span class="text-[13px]">✨</span>
                  <div class="flex flex-col">
                    <span class="font-semibold">Draft with AI</span>
                    <span class="text-[10px] text-gray-400">Describe it, AI generates.</span>
                  </div>
                </button>
              </div>
            ` : ''}
          </div>
        </div>

      </div>
    `
  }

  override render() {
    const current = this._currentEntry

    return html`
      <div class="flex flex-col h-screen overflow-hidden bg-white">

        ${this._renderTabs()}

        ${this.tab === 'new' && this.creationMode === 'choice' && !this.editingId
          ? this._renderIntentGate()
          : ''}

        ${this.tab === 'new' && this.creationMode !== 'choice' ? html`
          <div class="flex flex-1 overflow-hidden">

            <!-- Left: sidebar -->
            <aside class="hidden md:flex w-[340px] min-w-[340px] flex-col bg-white border-r border-gray-100 overflow-y-auto">
              <ff-sidebar
                .apiKey=${this.apiKey}
                .keyIsEnvConfigured=${this.keyIsEnvConfigured}
                .mode=${this.creationMode === 'manual' ? 'manual' : 'ai'}
                .contentType=${this.contentType}
                .audience=${this.audience}
                .topic=${this.topic}
                .notes=${this.promptNotes}
                .region=${this.region}
                .language=${this.language}
                .expertSources=${this.expertSources}
                .hasContent=${!!this.output.trim() || !!this.editingId}
                .isGenerating=${this.isGenerating}
                .streamElapsedMs=${this._streamElapsedMs}
                .libraryEntries=${this.entries}
                .editingId=${this.editingId}
                @open-similar=${(e: CustomEvent<ContentEntry>) => this._openEntry(e)}
                @content-type-change=${(e: CustomEvent<string>) => {
                  if (this.creationMode === 'manual') {
                    this.contentType = e.detail
                    this.output = this._blankOutput(e.detail)
                  } else {
                    this.contentType = e.detail
                    this._markDirty()
                  }
                }}
                @audience-change=${(e: CustomEvent<string>) => { this.audience = e.detail; this._markDirty() }}
                @topic-change=${(e: CustomEvent<string>) => { this.topic = e.detail; this._markDirty() }}
                @prompt-notes-change=${(e: CustomEvent<string>) => { this.promptNotes = e.detail; this._markDirty() }}
                @expert-sources-change=${(e: CustomEvent<ExpertSource[]>) => { this.expertSources = e.detail; this._markDirty() }}
                @api-key-click=${() => { this.showApiModal = true }}
                @clear-inputs=${() => { this.topic = ''; this.promptNotes = ''; this.expertSources = [{ insight: '', name: '', image: '' }] }}
                @generate=${this._generate}
                @region-change=${this._onRegionChange}
                @language-change=${this._onLanguageChange}
                @mode-flip=${(e: CustomEvent<'manual' | 'ai'>) => this._flipMode(e.detail)}
                @convert-open=${() => { this._showConvertPicker = true }}
              ></ff-sidebar>
            </aside>

            <!-- Center: output panel -->
            <main class="flex-1 flex flex-col overflow-hidden min-w-0 bg-white" data-ai-selectable>
              <ff-output-panel
                .output=${this.output}
                .isGenerating=${this.isGenerating}
                .error=${this.error}
                .contentType=${this.contentType}
                .audience=${this.audience}
                .editingId=${this.editingId}
                .isDirty=${this.isDirty}
                .status=${current?.status ?? 'draft'}
                .reviewNotes=${current?.reviewNotes ?? ''}
                .apiKey=${this.apiKey}
                .topic=${this.topic}
                .promptNotes=${this.promptNotes}
                .canUndo=${this._prevOutput !== null}
                .manualMode=${this.creationMode === 'manual'}
                .streamCharCount=${this._streamCharCount}
                .streamElapsedMs=${this._streamElapsedMs}
                @regenerate=${this._regenerate}
                @refine=${this._refine}
                @clear=${this._clear}
                @save=${this._save}
                @undo=${this._undoOutput}
                @discard-changes=${this._discardChanges}
                @output-change=${this._outputChange}
                @content-type-resolved=${this._onContentTypeResolved}
                @status-change=${this._handleStatusChange}
                @generation-error=${(e: CustomEvent<string>) => { this.error = e.detail }}
                @json-refine=${this._jsonRefine}
              ></ff-output-panel>
            </main>

            <!-- Right: details panel -->
            <ff-details-panel
              .entry=${current}
              .contentType=${this.contentType}
              .audience=${this.audience}
              .topic=${this.topic}
              .output=${this.output}
              .apiKey=${this.apiKey}
              .isDirty=${this.isDirty}
              .isGenerating=${this.isGenerating}
              @patch-entry=${this._patchEntry}
              @quality-fix=${this._handleQualityFix}
            ></ff-details-panel>

          </div>
        ` : ''}

        ${this.tab === 'library' ? html`
          <ff-library
            class="flex-1 overflow-hidden flex flex-col"
            .entries=${this.entries}
            .currentUser=${getCurrentUser()}
            @open-entry=${this._openEntry}
            @delete-entry=${this._deleteEntry}
            @restore-entry=${(e: CustomEvent<string>) => { restoreEntry(e.detail); this._refreshEntries() }}
            @empty-trash=${() => { emptyTrash(); this._refreshEntries() }}
            @new-content=${this._newContent}
            @bulk-status=${this._handleBulkStatus}
            @set-current-user=${(e: CustomEvent<string>) => { setCurrentUser(e.detail); this.requestUpdate() }}
          ></ff-library>
        ` : ''}

        ${this.showApiModal && !this.keyIsEnvConfigured ? html`
          <ff-api-key-modal
            .initialKey=${this.apiKey}
            @save=${this._saveApiKey}
            @close=${() => { this.showApiModal = false }}
          ></ff-api-key-modal>
        ` : ''}

        ${this._renderNewContentConfirm()}
        ${this._renderConvertPicker()}
        ${this._renderNamePrompt()}

        <!-- Global: selection-based AI toolbar -->
        <ff-selection-toolbar @selection-ai=${this._handleSelectionAI}></ff-selection-toolbar>

        <!-- Pending AI rewrite: Before/After diff card pinned to the top of
             the editor area. Accept → writes change to output. Reject →
             discards. Try again → re-runs same instruction. -->
        ${this._renderPendingRewrite()}

      </div>
    `
  }

  private _handleBulkStatus(e: CustomEvent<{ ids: string[]; status: ContentStatus }>) {
    const { ids, status } = e.detail
    for (const id of ids) {
      const patch: Partial<ContentEntry> = { status }
      if (status === 'published') patch.publishedAt = Date.now()
      patchEntry(id, patch)
    }
    this._refreshEntries()
  }

  private _renderPendingRewrite() {
    const pr = this._pendingRewrite
    if (!pr) return ''
    const actionLabel = pr.action ? pr.action.charAt(0).toUpperCase() + pr.action.slice(1) : 'AI'
    return html`
      <div class="fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[min(720px,calc(100vw-2rem))]">
        <div class="rounded-xl overflow-hidden shadow-lg bg-white" style="border:1.5px solid #93c5fd;">
          <div class="flex items-center justify-between px-3 py-2" style="background:#eff6ff;border-bottom:0.5px solid #bfdbfe;">
            <div class="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" class="text-[#1e40af]">
                <path d="M7 1L8.5 5L12.5 7L8.5 8.5L7 13L5.5 8.5L1.5 7L5.5 5L7 1Z" fill="currentColor"/>
              </svg>
              <span class="text-[12px] font-semibold text-[#1e40af]">AI rewrite · ${actionLabel}</span>
              ${pr.streaming ? html`<span class="text-[11px] text-gray-400 ml-1">writing…</span>` : ''}
            </div>
            <div class="flex items-center gap-1.5">
              <button
                @click=${this._retryPendingRewrite}
                ?disabled=${pr.streaming}
                class="text-[11px] text-gray-600 bg-white border border-gray-200 hover:border-gray-300 rounded-md px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >Try again</button>
              <button
                @click=${this._rejectPendingRewrite}
                class="text-[11px] text-gray-600 bg-white border border-gray-200 hover:border-gray-300 rounded-md px-2 py-1"
              >Reject</button>
              <button
                @click=${this._acceptPendingRewrite}
                ?disabled=${pr.streaming || !pr.after.trim()}
                class="text-[11px] font-semibold text-white bg-[#1a1a1a] hover:bg-black rounded-md px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >Accept</button>
            </div>
          </div>

          <div class="px-4 py-2.5 text-[13px] leading-relaxed text-gray-500 border-b border-dashed border-gray-200" style="background:#fdf6f6;">
            <span class="inline-block text-[10px] font-semibold tracking-wider uppercase text-[#c03a2b] mr-2 align-middle">Before</span>
            <span class="align-middle">${pr.before}</span>
          </div>

          <div class="px-4 py-2.5 text-[13px] leading-relaxed text-[#1a1a1a]" style="background:#f0faf3;">
            <span class="inline-block text-[10px] font-semibold tracking-wider uppercase text-[#1f7a3d] mr-2 align-middle">After</span>
            <span class="align-middle">${pr.after || html`<span class="text-gray-400 italic">waiting for AI…</span>`}</span>
          </div>
        </div>
      </div>
    `
  }

  private _renderNamePrompt() {
    if (!this._showNamePrompt) return ''
    return html`
      <div class="fixed inset-0 bg-black/25 flex items-center justify-center z-50"
        @click=${(e: Event) => { if (e.target === e.currentTarget) this._showNamePrompt = false }}>
        <div class="bg-white rounded-xl shadow-xl p-5 w-[420px] max-w-[calc(100vw-2rem)] mx-4">
          <h3 class="text-[15px] font-semibold text-[#1a1a1a] mb-1">Name this draft</h3>
          <p class="text-[12px] text-gray-500 mb-4">Give it a short name so you can find it later. You can change this anytime.</p>
          <input
            type="text"
            autofocus
            .value=${this._nameDraft}
            @input=${(ev: Event) => { this._nameDraft = (ev.target as HTMLInputElement).value }}
            @keydown=${(ev: KeyboardEvent) => {
              if (ev.key === 'Enter' && this._nameDraft.trim()) this._confirmNameAndSave()
              if (ev.key === 'Escape') this._showNamePrompt = false
            }}
            placeholder="e.g. HSA basics for new hires"
            class="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[14px] outline-none focus:border-gray-400 mb-4"
          />
          <div class="flex items-center justify-end gap-2">
            <button @click=${() => { this._showNamePrompt = false }}
              class="text-[12px] text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
            <button @click=${this._confirmNameAndSave}
              ?disabled=${!this._nameDraft.trim()}
              class="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#063853] text-white hover:bg-[#04293D] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Save to library
            </button>
          </div>
        </div>
      </div>
    `
  }

  private _renderConvertPicker() {
    if (!this._showConvertPicker) return ''
    const types: Array<{ value: string; label: string; desc: string }> = [
      { value: 'article',        label: 'Article',        desc: 'Long-form markdown with sections' },
      { value: 'money_tip',      label: 'Money Tip',      desc: 'Multi-slide bite-sized lesson' },
      { value: 'checklist',      label: 'Checklist',      desc: 'Actionable list grouped by section' },
      { value: 'quiz',           label: 'Quiz',           desc: 'Questions with scored results' },
      { value: 'expert_insight', label: 'Expert Insight', desc: 'Coach-voiced sections' },
      { value: 'infographic',    label: 'Infographic',    desc: 'Image + metadata only' },
      { value: 'user_story',     label: 'User Story',     desc: 'Short narrative testimonial' },
      { value: 'video',          label: 'Video',          desc: 'Reference link + copy' },
      { value: 'calculator',     label: 'Calculator',     desc: 'Inputs + formula' },
    ]
    return html`
      <div class="fixed inset-0 bg-black/25 flex items-center justify-center z-50"
        @click=${(e: Event) => { if (e.target === e.currentTarget) this._showConvertPicker = false }}>
        <div class="bg-white rounded-xl shadow-xl p-5 w-[480px] max-w-[calc(100vw-2rem)] mx-4">
          <h3 class="text-[15px] font-semibold text-[#1a1a1a] mb-1">Convert to a different content type</h3>
          <p class="text-[12px] text-gray-500 mb-4">We'll re-generate using your current topic, notes, and draft as source material.</p>
          <div class="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
            ${types.map(t => html`
              <button
                @click=${() => this._convertTo(t.value)}
                ?disabled=${t.value === this.contentType}
                class="text-left p-3 rounded-lg border transition-all ${
                  t.value === this.contentType
                    ? 'border-[#063853] bg-[#063853]/[0.04] cursor-not-allowed'
                    : 'border-gray-200 hover:border-[#063853] hover:bg-gray-50'
                }"
              >
                <div class="flex items-center justify-between">
                  <span class="text-[13px] font-semibold text-[#1a1a1a]">${t.label}</span>
                  ${t.value === this.contentType ? html`<span class="text-[10px] text-[#063853] font-semibold">Current</span>` : ''}
                </div>
                <p class="text-[11px] text-gray-400 mt-0.5 leading-snug">${t.desc}</p>
              </button>
            `)}
          </div>
          <div class="flex justify-end mt-4">
            <button
              @click=${() => { this._showConvertPicker = false }}
              class="text-[12px] text-gray-500 hover:text-gray-700 px-3 py-1.5"
            >Cancel</button>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-app': FFApp }
}
