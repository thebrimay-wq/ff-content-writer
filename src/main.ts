import "./index.css"
// FF Content Writer — v2 prototype shell.
// Imports the production lib/* directly so voice, schemas, and API plumbing
// stay in sync with the live app. Only the UI is new.

import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'

import {
  buildUserMessage,
  buildJsonUserMessage,
  buildRefinementMessage,
  buildJsonRefinementMessage,
  streamMessage,
  AUDIENCE_LABELS,
  type GenerateRequest,
  type ExpertSource,
} from './lib/api'
import { SYSTEM_PROMPT } from './lib/systemPrompt'
import { JSON_SYSTEM_PROMPT } from './lib/jsonSystemPrompt'
import {
  parseJsonContent,
  parsePartialJsonContent,
  emptyContentForType,
  type AnyContent,
  type MoneyTip,
  type Checklist,
  type Quiz,
  type ExpertInsight,
  PLANNERS,
} from './lib/contentTypeSchemas'
import {
  createEntry,
  updateEntry,
  patchEntry,
  loadAll,
  deleteEntry,
  restoreEntry,
  emptyTrash,
  hideEntry,
  getCurrentUser,
  getHiddenIds,
  type ContentEntry,
  type ContentStatus,
} from './lib/store'
import { loadArticles } from './lib/articles'
import './components/ff-library'

// ── Type list / labels — overrides for the v2 UI ────────────────────────────
// Same keys as production TYPE_LABELS but presented in sentence case for the
// new dropdown.
const V2_TYPE_LABELS: Record<string, string> = {
  article:        'Article',
  money_tip:      'Money tip',
  checklist:      'Checklist',
  expert_insight: 'Expert insight',
  user_story:     'User story',
  quiz:           'Quiz',
  video:          'Video',
  calculator:     'Calculator',
  infographic:    'Infographic',
}

const V2_TYPE_DESC: Record<string, string> = {
  article:        'Long-form markdown article.',
  money_tip:      'Carousel of 3–5 short cards.',
  checklist:      'Actionable list grouped by section.',
  expert_insight: 'Coach-voiced sections from raw quotes.',
  user_story:     'Short narrative testimonial.',
  quiz:           'Questions with scored results.',
  video:          'Reference link + supporting copy.',
  calculator:     'Inputs + formula.',
  infographic:    'Image + supporting metadata.',
}

const V2_AUDIENCE_LABELS = AUDIENCE_LABELS

// Configure marked for safe rendering of GFM
marked.setOptions({ gfm: true, breaks: false })

// Strip trailing CTA / Meta Description / Metadata / Alt Headlines sections
// that the live system prompt sometimes emits. v2 is a single flowing
// document — these sections are not used. Also strip standalone "Intro" /
// "Body" structural headings the model occasionally inserts as scaffolding
// labels — keep their content, drop the heading line.
const TRAILING_SECTION_RE = /^##\s+(cta|meta\s*description|metadata|alt(?:ernate|ernative)?\s*head(?:line)?s?|alternate\s*titles?)\s*:?\s*$/i
const STRUCTURAL_LABEL_RE = /^##\s+(intro(?:duction)?|body|main\s*body|main\s*content)\s*:?\s*$/i
function stripPublishingSections(md: string): string {
  if (!md) return md
  // 1) Cut everything from the first trailing-section heading to the end
  const lines = md.split('\n')
  let cutAt = -1
  for (let i = 0; i < lines.length; i++) {
    if (TRAILING_SECTION_RE.test(lines[i].trim())) { cutAt = i; break }
  }
  let truncated = cutAt === -1 ? md : lines.slice(0, cutAt).join('\n').replace(/\s+$/, '') + '\n'
  // 2) Drop standalone Intro / Body / Main Body heading lines
  truncated = truncated
    .split('\n')
    .filter(l => !STRUCTURAL_LABEL_RE.test(l.trim()))
    .join('\n')
  // Collapse 3+ consecutive newlines that appear after dropped headings
  return truncated.replace(/\n{3,}/g, '\n\n')
}

// ── Root app ────────────────────────────────────────────────────────────────

type Mode = 'gate' | 'editor'

@customElement('ff-app')
class FFApp extends LitElement {
  override createRenderRoot() { return this }

  @state() private mode: Mode = 'gate'
  @state() private tab: 'new' | 'library' = 'new'
  @state() private creationMode: 'ai' | 'manual' = 'ai'
  @state() private contentType = 'article'
  @state() private libraryEntries: ContentEntry[] = []
  @state() private audience = 'all'
  @state() private topic = ''
  @state() private notes = ''
  @state() private expertSources: ExpertSource[] = [{ insight: '', name: '', image: '' }]
  @state() private region = 'United States'
  @state() private language = 'English'

  @state() private output = ''           // streaming text buffer (markdown for article, JSON for others)
  @state() private isGenerating = false
  @state() private error = ''
  @state() private lastRequest: GenerateRequest | null = null

  @state() private editingId: string | null = null
  @state() private isDirty = false

  // Undo stack — snapshots of `output` taken before each structural mutation.
  // Capped so memory doesn't grow unbounded over a long session.
  @state() private _undoStack: string[] = []
  @state() private _redoStack: string[] = []
  private _pushUndo() {
    this._undoStack = [...this._undoStack, this.output].slice(-50)
    this._redoStack = []
  }
  private _undo() {
    const prev = this._undoStack[this._undoStack.length - 1]
    if (prev === undefined) return
    this._undoStack = this._undoStack.slice(0, -1)
    this._redoStack = [...this._redoStack, this.output].slice(-50)
    this.output = prev
    this.isDirty = true
  }
  private _redo() {
    const next = this._redoStack[this._redoStack.length - 1]
    if (next === undefined) return
    this._redoStack = this._redoStack.slice(0, -1)
    this._undoStack = [...this._undoStack, this.output].slice(-50)
    this.output = next
    this.isDirty = true
  }

  // API key — same localStorage key the production app uses
  @state() private apiKey = localStorage.getItem('ff_api_key') ?? ''
  @state() private showKeyPrompt = false
  @state() private keyDraft = ''

  private _abort: AbortController | null = null

  override connectedCallback() {
    super.connectedCallback()
    this._refreshEntries()
  }

  private _refreshEntries() {
    const stored = loadAll()
    const hidden = getHiddenIds()
    const storedIds = new Set(stored.map(e => e.id))
    let cms: ContentEntry[] = []
    try { cms = loadArticles().filter(a => !storedIds.has(a.id) && !hidden.has(a.id)) } catch { cms = [] }
    this.libraryEntries = [...stored, ...cms]
  }

  private _switchTab(t: 'new' | 'library') {
    if (this.tab === t) return
    this.tab = t
    if (t === 'library') this._refreshEntries()
  }

  /** Open a library entry into the editor. Loads its fields and switches tabs. */
  private _openEntry = (e: CustomEvent<ContentEntry>) => {
    const entry = e.detail
    this.contentType = entry.contentType
    this.audience = entry.audience
    this.topic = entry.topic
    this.notes = entry.promptNotes ?? ''
    this.expertSources = entry.expertSources?.length
      ? entry.expertSources
      : [{ insight: '', name: '', image: '' }]
    this.region = entry.region ?? 'United States'
    this.language = entry.language ?? 'English'
    this.output = entry.output ?? ''
    this.editingId = entry.id
    this.isDirty = false
    this.error = ''
    this.lastRequest = {
      contentType: entry.contentType,
      audience: entry.audience,
      topic: entry.topic,
      notes: entry.promptNotes ?? '',
      expertSources: entry.expertSources ?? [],
    }
    this.tab = 'new'
    this.mode = 'editor'
    this.creationMode = 'ai'
    this._undoStack = []
    this._redoStack = []
  }

  private _deleteEntry = (e: CustomEvent<string>) => {
    const id = e.detail
    if (id.startsWith('cms_')) hideEntry(id); else deleteEntry(id)
    if (this.editingId === id) this._newContent()
    this._refreshEntries()
  }

  private _restoreEntry = (e: CustomEvent<string>) => {
    restoreEntry(e.detail)
    this._refreshEntries()
  }

  private _emptyTrash = () => {
    emptyTrash()
    this._refreshEntries()
  }

  private _bulkStatus = (e: CustomEvent<{ ids: string[]; status: ContentStatus }>) => {
    const { ids, status } = e.detail
    for (const id of ids) {
      const patch: Partial<ContentEntry> = { status }
      if (status === 'published') patch.publishedAt = Date.now()
      patchEntry(id, patch)
    }
    this._refreshEntries()
  }

  private _newContent() {
    this._abort?.abort()
    this.tab = 'new'
    this.mode = 'gate'
    this.editingId = null
    this.output = ''
    this.topic = ''
    this.notes = ''
    this.contentType = 'article'
    this.audience = 'all'
    this.error = ''
    this.lastRequest = null
    this.isDirty = false
    this._undoStack = []
    this._redoStack = []
  }

  private _enterEditor(creationMode: 'ai' | 'manual') {
    this.mode = 'editor'
    this.creationMode = creationMode
    if (creationMode === 'manual') {
      // Initialize a blank-but-shaped doc so the editor surfaces have something to bind to.
      if (this.contentType === 'article') {
        this.output = ''
      } else {
        this.output = JSON.stringify(emptyContentForType(this.contentType), null, 2)
      }
      this.isDirty = false
      this._undoStack = []
      this._redoStack = []
    }
  }

  /** Mid-flow toggle: switch between AI and manual without losing content. */
  private _flipMode(next: 'ai' | 'manual') {
    if (this.creationMode === next) return
    this.creationMode = next
    if (next === 'manual' && !this.output) {
      this.output = this.contentType === 'article' ? '' : JSON.stringify(emptyContentForType(this.contentType), null, 2)
    }
  }

  private async _generate() {
    if (!this.topic.trim()) return
    if (!this.apiKey) { this.showKeyPrompt = true; this.keyDraft = ''; return }

    const req: GenerateRequest = {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      notes: this.notes,
      expertSources: this.expertSources,
    }
    this.lastRequest = req

    const useJson = this.contentType !== 'article'
    const userMsg = useJson ? buildJsonUserMessage(req) : buildUserMessage(req)
    const systemPrompt = useJson ? JSON_SYSTEM_PROMPT : SYSTEM_PROMPT

    this._abort?.abort()
    const controller = new AbortController()
    this._abort = controller
    this.output = ''
    this.error = ''
    this.isGenerating = true
    this.editingId = null

    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: userMsg }],
        systemPrompt,
        (chunk) => { this.output += chunk; this.isDirty = true },
        controller.signal,
        useJson ? 8192 : 2048,
      )
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this.error = err instanceof Error ? err.message : 'Something went wrong.'
      }
    } finally {
      this.isGenerating = false
    }
  }

  private async _refine(instruction: string) {
    if (!this.output.trim() || !this.apiKey) return
    const ctx = this.lastRequest ?? {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      notes: this.notes,
      expertSources: this.expertSources,
    }
    const useJson = this.contentType !== 'article'
    const msg = useJson
      ? buildJsonRefinementMessage(this.output, instruction, ctx)
      : buildRefinementMessage(this.output, instruction, ctx)
    const systemPrompt = useJson ? JSON_SYSTEM_PROMPT : SYSTEM_PROMPT

    this._abort?.abort()
    const controller = new AbortController()
    this._abort = controller
    const previous = this.output
    this.output = ''
    this.isGenerating = true
    try {
      await streamMessage(this.apiKey, [{ role: 'user', content: msg }], systemPrompt,
        (chunk) => { this.output += chunk; this.isDirty = true },
        controller.signal,
        useJson ? 8192 : 2048,
      )
    } catch (err) {
      this.output = previous
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this.error = err instanceof Error ? err.message : 'Refine failed.'
      }
    } finally {
      this.isGenerating = false
    }
  }

  private _save() {
    if (!this.output.trim()) return
    // Persist the stripped version so saved entries don't carry CTA/Meta/Alt sections
    const cleaned = this.contentType === 'article' ? stripPublishingSections(this.output) : this.output
    const payload = {
      contentType: this.contentType,
      audience: this.audience,
      topic: this.topic,
      promptNotes: this.notes,
      expertSources: this.expertSources,
      output: cleaned,
      region: this.region,
      language: this.language,
    }
    if (this.editingId) {
      const u = updateEntry(this.editingId, payload)
      if (u) this.editingId = u.id
    } else {
      const c = createEntry(payload)
      this.editingId = c.id
    }
    this.isDirty = false
    this._refreshEntries()
  }

  private _saveApiKey() {
    const k = this.keyDraft.trim()
    if (!k) return
    localStorage.setItem('ff_api_key', k)
    this.apiKey = k
    this.showKeyPrompt = false
    // Continue the generate that triggered the prompt
    if (this.topic.trim()) this._generate()
  }

  override render() {
    return html`
      <div class="h-screen flex flex-col overflow-hidden">

        <!-- Top bar -->
        <header class="flex items-center justify-between px-4 h-12 shrink-0 bg-white border-b border-gray-100">
          <div class="flex items-center">
            <button
              @click=${() => this._switchTab('new')}
              class="relative h-12 px-4 text-[13px] font-semibold flex items-center transition-colors ${this.tab === 'new' ? 'text-[#063853]' : 'text-gray-400 hover:text-gray-600'}">
              New content
              ${this.tab === 'new' ? html`<span class="absolute inset-x-2 bottom-0 h-[2px] bg-[#063853] rounded-full"></span>` : ''}
            </button>
            <button
              @click=${() => this._switchTab('library')}
              class="relative h-12 px-4 text-[13px] font-semibold flex items-center gap-2 transition-colors ${this.tab === 'library' ? 'text-[#063853]' : 'text-gray-400 hover:text-gray-600'}">
              Library
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${this.tab === 'library' ? 'bg-[#063853]/10 text-[#063853]' : 'bg-gray-100 text-gray-400'}">
                ${this.libraryEntries.filter(e => e.status !== 'trash').length}
              </span>
              ${this.tab === 'library' ? html`<span class="absolute inset-x-2 bottom-0 h-[2px] bg-[#063853] rounded-full"></span>` : ''}
            </button>
          </div>
          <div class="flex items-center gap-3">
            <button
              @click=${() => { this.keyDraft = this.apiKey; this.showKeyPrompt = true }}
              class="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${this.apiKey ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-400 bg-gray-100 hover:bg-gray-200'}"
              title="Update Anthropic API key"
            >${this.apiKey ? 'Key set' : 'API key'}</button>
            <button
              @click=${() => this._newContent()}
              class="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#063853] hover:bg-[#04293D] text-white"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              New content
            </button>
          </div>
        </header>

        ${this.tab === 'library'
          ? this._renderLibrary()
          : this.mode === 'gate' ? this._renderGate() : this._renderEditor()}

        ${this._renderTableToolbar()}
        ${this._renderSelectionToolbar()}
        ${this._renderRewriteCard()}
        ${this._renderSlashMenu()}
        ${this._renderLinkModal()}
        ${this.showKeyPrompt ? this._renderKeyPrompt() : ''}
      </div>
    `
  }

  // ── Library ───────────────────────────────────────────────────────────────
  private _renderLibrary() {
    return html`
      <ff-library
        class="flex-1 overflow-hidden flex flex-col"
        .entries=${this.libraryEntries}
        .currentUser=${getCurrentUser()}
        @open-entry=${this._openEntry}
        @delete-entry=${this._deleteEntry}
        @restore-entry=${this._restoreEntry}
        @empty-trash=${this._emptyTrash}
        @new-content=${() => this._newContent()}
        @bulk-status=${this._bulkStatus}
      ></ff-library>
    `
  }

  // ── Intent gate ────────────────────────────────────────────────────────────
  private _renderGate() {
    return html`
      <div class="flex-1 flex items-center justify-center bg-gradient-to-b from-gray-50/40 to-white px-6 py-10 overflow-y-auto">
        <div class="w-full max-w-[760px]">
          <div class="text-center mb-8">
            <h2 class="text-[28px] font-semibold text-[#1a1a1a] mb-2 leading-tight">How do you want to start?</h2>
            <p class="text-[15px] text-gray-500">Pick a starting point. You can switch anytime from the sidebar.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <button @click=${() => this._enterEditor('manual')}
              class="group flex flex-col items-start gap-4 p-7 rounded-2xl bg-white border-2 border-gray-200 hover:border-[#063853] hover:shadow-lg transition-all text-left">
              <div class="w-14 h-14 rounded-xl bg-[#063853]/[0.06] group-hover:bg-[#063853]/[0.12] flex items-center justify-center transition-colors">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none"><path d="M18 4l4 4-12 12-5 1 1-5L18 4z" stroke="#063853" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div>
                <p class="text-[18px] font-semibold text-[#1a1a1a] mb-1.5">Write it myself</p>
                <p class="text-[14px] text-gray-500 leading-relaxed">Start with a blank page and write directly. No AI involvement until you ask for it.</p>
              </div>
              <div class="mt-auto pt-2 text-[12px] font-semibold text-gray-400 group-hover:text-[#063853] flex items-center gap-1">
                Start blank
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 6h6m-2-3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </button>

            <button @click=${() => this._enterEditor('ai')}
              class="group flex flex-col items-start gap-4 p-7 rounded-2xl bg-white border-2 border-gray-200 hover:border-[#7c70e3] hover:shadow-lg transition-all text-left">
              <div class="w-14 h-14 rounded-xl bg-violet-50 group-hover:bg-violet-100 flex items-center justify-center transition-colors">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none"><path d="M13 3l2.5 7.5L23 13l-7.5 2.5L13 23l-2.5-7.5L3 13l7.5-2.5L13 3z" fill="#7c70e3"/></svg>
              </div>
              <div>
                <p class="text-[18px] font-semibold text-[#1a1a1a] mb-1.5">Draft with AI</p>
                <p class="text-[14px] text-gray-500 leading-relaxed">Describe what you want. AI writes a first draft you can edit, refine, and publish.</p>
              </div>
              <div class="mt-auto pt-2 text-[12px] font-semibold text-gray-400 group-hover:text-[#7c70e3] flex items-center gap-1">
                Generate a draft
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 6h6m-2-3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </button>
          </div>

          <div class="rounded-xl border border-gray-200 bg-white px-5 py-4">
            <div class="flex items-center justify-between gap-3 mb-3">
              <p class="text-[13px] font-semibold text-[#1a1a1a]">Writing for</p>
              <p class="text-[11px] text-gray-400">You can change this later, too.</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Region</label>
                <select .value=${this.region}
                  @change=${(e: Event) => { this.region = (e.target as HTMLSelectElement).value }}
                  class="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[14px] outline-none focus:border-gray-400 cursor-pointer bg-white">
                  <option>United States</option><option>Canada</option><option>United Kingdom</option>
                </select>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Language</label>
                <select .value=${this.language}
                  @change=${(e: Event) => { this.language = (e.target as HTMLSelectElement).value }}
                  class="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[14px] outline-none focus:border-gray-400 cursor-pointer bg-white">
                  <option>English</option><option>Spanish</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  // ── Editor (3-pane) ────────────────────────────────────────────────────────
  private _renderEditor() {
    return html`
      <div class="flex flex-1 overflow-hidden">

        <!-- LEFT SIDEBAR -->
        <aside class="w-[320px] min-w-[320px] flex flex-col bg-white border-r border-gray-100 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <div class="flex flex-col p-7 gap-6 min-h-full">

            <!-- Region pill (compact) -->
            <button class="self-start flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 hover:bg-gray-100">
              <span class="text-[14px] leading-none">${regionFlag(this.region)}</span>
              <span class="text-[12px] font-semibold tracking-wide text-gray-700">${regionShort(this.region)} · ${langShort(this.language)}</span>
            </button>

            <!-- Mode flip: Blank ↔ With AI -->
            <div role="tablist" class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-gray-100 self-start">
              <button role="tab" aria-selected=${this.creationMode === 'manual' ? 'true' : 'false'}
                @click=${() => this._flipMode('manual')}
                class="px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${this.creationMode === 'manual' ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-gray-500 hover:text-gray-700'}">
                Blank
              </button>
              <button role="tab" aria-selected=${this.creationMode === 'ai' ? 'true' : 'false'}
                @click=${() => this._flipMode('ai')}
                class="px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${this.creationMode === 'ai' ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-gray-500 hover:text-gray-700'}">
                With AI
              </button>
            </div>

            <!-- Content type -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Content type</label>
              <div class="relative">
                <select .value=${this.contentType}
                  @change=${(e: Event) => { this.contentType = (e.target as HTMLSelectElement).value }}
                  ?disabled=${this.isGenerating}
                  class="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-gray-400 pr-9 cursor-pointer disabled:opacity-50">
                  ${Object.entries(V2_TYPE_LABELS).map(([k, v]) => html`<option value=${k} ?selected=${k === this.contentType}>${v}</option>`)}
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg class="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
              </div>
              <p class="text-[11px] text-gray-400 leading-snug">${V2_TYPE_DESC[this.contentType]}</p>
            </div>

            ${this.creationMode === 'ai' ? html`
              <!-- Audience -->
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Audience</label>
                <div class="relative">
                  <select .value=${this.audience}
                    @change=${(e: Event) => { this.audience = (e.target as HTMLSelectElement).value }}
                    ?disabled=${this.isGenerating}
                    class="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-gray-400 pr-9 cursor-pointer disabled:opacity-50">
                    ${Object.entries(V2_AUDIENCE_LABELS).map(([k, v]) => html`<option value=${k} ?selected=${k === this.audience}>${v}</option>`)}
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg class="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                </div>
                <p class="text-[11px] text-gray-400 leading-snug">We'll tune tone and depth.</p>
              </div>

              <!-- Topic -->
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Topic</label>
                <input type="text" .value=${this.topic}
                  @input=${(e: Event) => { this.topic = (e.target as HTMLInputElement).value }}
                  @keydown=${(e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') this._generate() }}
                  ?disabled=${this.isGenerating}
                  placeholder="What do you want to create?"
                  class="w-full rounded-lg border-2 border-gray-200 bg-white px-3.5 py-3 text-[15px] outline-none focus:border-[#063853] focus:ff-focus-ring disabled:opacity-50" />
              </div>

              <!-- Notes -->
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Notes <span class="font-normal text-gray-400 normal-case tracking-normal">(optional)</span></label>
                <textarea .value=${this.notes}
                  @input=${(e: Event) => { this.notes = (e.target as HTMLTextAreaElement).value }}
                  ?disabled=${this.isGenerating}
                  rows="4"
                  placeholder="Stats, voice, anything to steer the draft…"
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-gray-400 resize-none disabled:opacity-50"></textarea>
              </div>

              ${this.contentType === 'expert_insight' ? this._renderExpertSources() : ''}

              <!-- Generate -->
              <div class="mt-auto flex flex-col gap-2 shrink-0">
                ${this.isGenerating
                  ? html`
                    <button @click=${() => this._abort?.abort()}
                      class="h-12 rounded-lg font-bold text-[15px] text-white bg-red-500 hover:bg-red-600 flex items-center justify-center gap-2">
                      Stop generating
                    </button>
                  `
                  : html`
                    <button @click=${() => this._generate()}
                      ?disabled=${!this.topic.trim()}
                      class="h-12 rounded-lg font-bold text-[15px] text-white flex items-center justify-center gap-2 transition-colors ${
                        this.topic.trim() ? 'bg-[#063853] hover:bg-[#04293D] active:scale-[0.98]' : 'bg-[#063853]/40 cursor-not-allowed'
                      }">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 5L12.5 7L8.5 8.5L7 13L5.5 8.5L1.5 7L5.5 5L7 1Z" fill="currentColor"/></svg>
                      ${this.output ? 'Regenerate' : 'Generate draft'}
                    </button>
                  `}
                <p class="text-[11px] text-center text-gray-400">⌘ + Enter</p>
              </div>
            ` : html`
              <!-- Manual mode: minimal sidebar — just region, mode flip, type. Save/Publish lives in the right rail. -->
              <div class="mt-auto pt-2 text-[11px] text-gray-400 leading-relaxed shrink-0">
                Writing it yourself. Use the center to fill in your draft, then Save or Publish from the right.
              </div>
            `}

          </div>
        </aside>

        <!-- CENTER: output -->
        <main class="flex-1 flex flex-col overflow-hidden min-w-0 bg-white">
          ${this.output ? this._renderCenterToolbar() : ''}
          ${this._renderCenter()}
        </main>

        <!-- RIGHT RAIL -->
        <aside class="w-[260px] min-w-[260px] bg-gray-50/40 border-l border-gray-100 flex flex-col overflow-y-auto scrollbar-thin">
          <div class="p-5 flex flex-col gap-4">

            <!-- Status -->
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                <span class="h-1.5 w-1.5 rounded-full bg-current opacity-80"></span>
                Draft
                ${this.isGenerating ? html`<span class="text-gray-400 font-normal ml-1">· generating…</span>` :
                  this.isDirty ? html`<span class="text-amber-600 font-normal ml-1">· unsaved</span>` :
                  this.editingId ? html`<span class="text-gray-400 font-normal ml-1">· saved</span>` : ''
                }
              </span>
            </div>

            <!-- Save -->
            <button @click=${() => this._save()}
              ?disabled=${!this.output.trim() || this.isGenerating}
              class="w-full px-4 py-2.5 rounded-lg text-[12px] font-semibold border border-gray-200 hover:border-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              ${this.editingId ? (this.isDirty ? 'Save changes' : 'Saved') : 'Save to library'}
            </button>

            <!-- Publish -->
            <button
              ?disabled=${!this.output.trim() || this.isGenerating}
              class="w-full px-4 py-3 rounded-lg bg-[#063853] hover:bg-[#04293D] text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
              Publish this
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 6h6m-2-3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <p class="text-[11px] text-gray-400 text-center">${this.output.trim() ? '3 fields will be auto-filled' : 'Generate a draft first'}</p>

            ${this.contentType === 'article' && this.output ? html`
              <div class="border-t border-gray-100 pt-4 flex flex-col gap-2">
                <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">Insert</p>
                <div class="grid grid-cols-2 gap-1.5">
                  ${[
                    { type: 'h2',      label: 'Heading' },
                    { type: 'h3',      label: 'Subheading' },
                    { type: 'list',    label: 'Bulleted list' },
                    { type: 'olist',   label: 'Numbered list' },
                    { type: 'quote',   label: 'Quote' },
                    { type: 'table',   label: 'Table' },
                    { type: 'divider', label: 'Divider' },
                  ].map(b => html`
                    <button @click=${() => this._insertBlock(b.type as any)}
                      class="text-[11px] text-left px-2 py-1.5 rounded-md border border-gray-200 hover:border-[#063853] hover:bg-white text-gray-600 hover:text-[#063853] transition-colors">
                      + ${b.label}
                    </button>
                  `)}
                </div>
                <p class="text-[10px] text-gray-400 mt-1 leading-snug">Inserted at end. Drag or move with your cursor inside the article.</p>
              </div>
            ` : ''}

            <div class="border-t border-gray-100 pt-4 flex flex-col gap-2">
              <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">Quick refine</p>
              ${['Make warmer', 'Shorten', 'More professional', 'Simpler language'].map(label => html`
                <button @click=${() => this._refine(label.toLowerCase())}
                  ?disabled=${!this.output.trim() || this.isGenerating}
                  class="text-left text-[12px] text-gray-600 hover:text-[#063853] py-1 disabled:opacity-40 disabled:cursor-not-allowed">
                  ${label}
                </button>
              `)}
            </div>
          </div>
        </aside>
      </div>
    `
  }

  // ── Center pane top toolbar (undo/redo + slash hint) ──────────────────────
  private _renderCenterToolbar() {
    const canUndo = this._undoStack.length > 0
    const canRedo = this._redoStack.length > 0
    return html`
      <div class="shrink-0 flex items-center justify-between px-6 h-10 border-b border-gray-100 bg-white">
        <div class="flex items-center gap-1">
          <button @click=${() => this._undo()}
            ?disabled=${!canUndo}
            title="Undo (⌘Z)"
            class="w-8 h-8 flex items-center justify-center rounded-md transition-colors ${canUndo ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 5h6a4 4 0 010 8H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4.5 2.5L2 5l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button @click=${() => this._redo()}
            ?disabled=${!canRedo}
            title="Redo (⇧⌘Z)"
            class="w-8 h-8 flex items-center justify-center rounded-md transition-colors ${canRedo ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M12 5H6a4 4 0 000 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9.5 2.5L12 5l-2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="w-px h-5 bg-gray-200 mx-1"></span>
          <span class="text-[11px] text-gray-400 inline-flex items-center gap-1.5">
            <span class="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">/</span>
            for blocks
          </span>
        </div>
        <div class="flex items-center gap-2 text-[11px] text-gray-400">
          ${this.contentType === 'article' ? html`
            <span class="inline-flex items-center gap-1.5">
              <span class="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">⌘B</span>
              bold
              <span class="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 ml-1">⌘I</span>
              italic
            </span>
          ` : ''}
          <span class="w-px h-5 bg-gray-200 mx-1"></span>
          <button
            @click=${() => { this._viewMode = this._viewMode === 'source' ? 'edit' : 'source' }}
            title="Toggle source / HTML view (admin)"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${this._viewMode === 'source' ? 'bg-violet-50 text-violet-700' : 'text-gray-500 hover:bg-gray-100'}">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M5 4L1.5 7L5 10M9 4l3.5 3L9 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="text-[11px] font-semibold">${this._viewMode === 'source' ? 'Editing' : 'HTML'}</span>
          </button>
        </div>
      </div>
    `
  }

  /** "+ Add block" button rendered at the end of the article. Focuses the
   *  end of the editor and opens the slash menu. */
  private _focusEndAndOpenSlash() {
    const editor = this.querySelector('[data-rewrite="true"]') as HTMLElement | null
    if (!editor) return
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // Insert a "/" so the slash handler picks it up
    document.execCommand('insertText', false, '/')
    this._openSlashMenu()
  }

  // ── Source / HTML viewer (admin/dev) ──────────────────────────────────────

  private _sourcePayload(): { html: string; raw: string; rawLabel: string } {
    if (this.contentType === 'article') {
      const md = stripPublishingSections(this.output)
      const compiled = (marked.parse(md) as string).trim()
      return { html: compiled, raw: md, rawLabel: 'Markdown' }
    }
    // JSON-backed types — show pretty-printed JSON as raw, and best-effort
    // HTML render for that type via the production renderer would require
    // refactoring the per-type render methods. For now we surface what the
    // front-end consumes (the JSON itself) under both tabs.
    let pretty = this.output
    try {
      const parsed = parseJsonContent(this.output)
      if (parsed) pretty = JSON.stringify(parsed, null, 2)
    } catch { /* ignore */ }
    return { html: pretty, raw: pretty, rawLabel: 'JSON' }
  }

  private async _copySource(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      this._sourceCopied = true
      setTimeout(() => { this._sourceCopied = false }, 1500)
    } catch { /* ignore */ }
  }

  private _renderSourceView() {
    const { html: htmlText, raw, rawLabel } = this._sourcePayload()
    const active = this._sourceTab === 'html' ? htmlText : raw
    return html`
      <div class="flex-1 overflow-hidden flex flex-col bg-gray-50/40">
        <div class="shrink-0 flex items-center justify-between px-6 py-2.5 border-b border-gray-100 bg-white">
          <div class="flex items-center gap-1">
            <button
              @click=${() => { this._sourceTab = 'html' }}
              class="px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${this._sourceTab === 'html' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}">
              HTML
            </button>
            <button
              @click=${() => { this._sourceTab = 'raw' }}
              class="px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${this._sourceTab === 'raw' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}">
              ${rawLabel}
            </button>
            <span class="ml-2 text-[10px] font-bold tracking-widest uppercase text-violet-500 bg-violet-50 px-2 py-0.5 rounded">admin</span>
          </div>
          <button
            @click=${() => this._copySource(active)}
            class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md ${this._sourceCopied ? 'text-emerald-600 bg-emerald-50' : 'text-gray-600 hover:bg-gray-100'}">
            ${this._sourceCopied
              ? html`<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>Copied`
              : html`<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 10V2.5A.5.5 0 012.5 2H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy`}
          </button>
        </div>

        <div class="flex-1 overflow-auto scrollbar-thin">
          <pre class="text-[12px] leading-[1.55] text-gray-800 font-mono whitespace-pre-wrap break-words p-6 m-0">${active || '— empty —'}</pre>
        </div>

        ${this._sourceTab === 'html' && this.contentType === 'article' ? html`
          <div class="shrink-0 border-t border-gray-100 bg-white">
            <p class="px-6 py-2 text-[10px] font-semibold tracking-widest uppercase text-gray-400">Live preview</p>
            <div class="px-6 pb-5 ff-prose max-h-[260px] overflow-y-auto scrollbar-thin">${unsafeHTML(htmlText)}</div>
          </div>
        ` : ''}
      </div>
    `
  }

  // ── Center pane: routes by content type ───────────────────────────────────
  private _renderCenter() {
    if (this._viewMode === 'source' && this.output) return this._renderSourceView()
    if (this.error && !this.output) {
      return html`
        <div class="flex-1 flex items-center justify-center px-12">
          <div class="rounded-xl bg-red-50 border border-red-100 px-5 py-4 max-w-[600px]">
            <p class="text-[12px] font-semibold text-red-700 mb-1">Generation failed</p>
            <p class="text-[13px] text-red-600">${this.error}</p>
          </div>
        </div>
      `
    }

    // AI prompt empty state — only when in AI mode with nothing yet generated.
    // Manual mode falls through to the type-specific renderer below (which
    // handles its own blank canvas with placeholders).
    if (!this.output && !this.isGenerating && this.creationMode !== 'manual') {
      return html`
        <div class="flex-1 flex flex-col items-center justify-center px-12 text-center">
          <div class="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 3l2.5 8L24 14l-7.5 3L14 25l-2.5-8L4 14l7.5-3L14 3z" fill="#7c70e3"/></svg>
          </div>
          <h2 class="text-[20px] font-semibold text-[#1a1a1a] mb-2">Type a topic, generate a draft</h2>
          <p class="text-[14px] text-gray-500 max-w-md">Tell us what you want to make. We'll write a first draft in seconds. You'll edit and publish it.</p>
        </div>
      `
    }

    // Article — locked title section + read-time + divider + flowing body
    if (this.contentType === 'article') {
      const title = this._articleTitle()
      const body = this._articleBody()
      const bodyHtml = body ? (marked.parse(body) as string) : ''
      return html`
        <div class="flex-1 overflow-y-auto scrollbar-thin">
          <div class="mx-auto max-w-[720px] px-12 py-10">
            ${this._renderTitleHeader({
              title,
              placeholder: 'Untitled article',
              onCommit: (t) => this._setArticleTitle(t),
              readTimeFor: body,
            })}
            <div
              data-rewrite="true"
              data-placeholder="Press / for blocks, or just start writing…"
              class="ff-prose outline-none min-h-[280px] ${this.isGenerating ? 'ff-stream-cursor' : ''}"
              contenteditable=${this.isGenerating ? 'false' : 'true'}
              spellcheck="true"
              @blur=${(e: Event) => this._setArticleBody(htmlToMarkdown((e.target as HTMLElement).innerHTML))}
            >${unsafeHTML(bodyHtml)}</div>
            ${this.isGenerating ? '' : html`
              <button @click=${() => this._focusEndAndOpenSlash()}
                class="mt-6 flex items-center gap-2 text-[12px] font-medium text-gray-400 hover:text-[#063853] hover:bg-gray-50 px-2.5 py-1.5 rounded-md transition-colors">
                <span class="w-5 h-5 flex items-center justify-center rounded-md border border-gray-200">
                  <svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                </span>
                Add block — or press <span class="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">/</span>
              </button>
            `}
          </div>
        </div>
      `
    }

    // JSON-backed types — try to parse and render type-specifically
    const parsed = (parseJsonContent(this.output) ?? parsePartialJsonContent(this.output)) as AnyContent | null

    if (this.contentType === 'money_tip') {
      return this._renderMoneyTip(parsed as MoneyTip | null)
    }
    if (this.contentType === 'checklist') {
      return this._renderChecklist(parsed as Checklist | null)
    }
    if (this.contentType === 'expert_insight') {
      return this._renderExpertInsight(parsed as ExpertInsight | null)
    }
    if (this.contentType === 'quiz') {
      return this._renderQuiz(parsed as Quiz | null)
    }
    if (this.contentType === 'user_story') {
      return this._renderUserStory(parsed as any)
    }
    if (this.contentType === 'video') {
      return this._renderVideo(parsed as any)
    }
    if (this.contentType === 'calculator') {
      return this._renderCalculator(parsed as any)
    }
    if (this.contentType === 'infographic') {
      return this._renderInfographic(parsed as any)
    }
    return this._renderGenericJson(parsed as AnyContent | null)
  }

  // ── Video / Calculator / Infographic ───────────────────────────────────────
  private _setSimpleField(field: string, value: string) {
    this._updateJson<any>(c => ({ ...c, [field]: value }))
  }

  private _renderVideo(v: any | null) {
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}" data-rewrite="true">
          <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">Video</p>
          ${this._renderTitleHeader({
            title: v?.title ?? '',
            placeholder: 'Untitled video',
            onCommit: (t) => this._setSimpleField('title', t),
          })}

          <div class="flex flex-col gap-1.5 mb-5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Video URL</label>
            <input type="url"
              .value=${v?.reference_link ?? ''}
              @blur=${(e: Event) => this._setSimpleField('reference_link', (e.target as HTMLInputElement).value.trim())}
              placeholder="https://vimeo.com/… or video ID"
              class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-gray-400" />
            ${v?.reference_link ? html`
              <p class="text-[11px] text-gray-400 mt-1">Saved · <span class="font-mono">${v.reference_link}</span></p>
            ` : ''}
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Description <span class="font-normal normal-case tracking-normal text-gray-400">(optional)</span></label>
            <div
              data-placeholder="What's this video about?"
              class="ff-prose outline-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 min-h-[120px] focus:border-gray-400"
              contenteditable=${this.isGenerating ? 'false' : 'true'}
              @blur=${(e: Event) => this._setSimpleField('copy', (e.target as HTMLElement).innerHTML)}
            >${unsafeHTML(v?.copy ?? '')}</div>
          </div>
        </div>
      </div>
    `
  }

  private _renderCalculator(c: any | null) {
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}" data-rewrite="true">
          <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">Calculator</p>
          ${this._renderTitleHeader({
            title: c?.title ?? '',
            placeholder: 'Untitled calculator',
            onCommit: (t) => this._setSimpleField('title', t),
          })}

          <div class="flex flex-col gap-1.5 mb-5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Calculator embed code</label>
            <textarea
              .value=${c?.reference_link ?? ''}
              @blur=${(e: Event) => this._setSimpleField('reference_link', (e.target as HTMLTextAreaElement).value.trim())}
              placeholder="<iframe src=… or embed snippet"
              rows="4"
              class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[12px] font-mono outline-none focus:border-gray-400 resize-none"></textarea>
            <p class="text-[11px] text-gray-400 leading-snug">Paste the embed snippet for the correct calculator. The front-end renders this in place.</p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Description <span class="font-normal normal-case tracking-normal text-gray-400">(optional)</span></label>
            <div
              data-placeholder="What does this calculator do?"
              class="ff-prose outline-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 min-h-[120px] focus:border-gray-400"
              contenteditable=${this.isGenerating ? 'false' : 'true'}
              @blur=${(e: Event) => this._setSimpleField('copy', (e.target as HTMLElement).innerHTML)}
            >${unsafeHTML(c?.copy ?? '')}</div>
          </div>
        </div>
      </div>
    `
  }

  private _renderInfographic(g: any | null) {
    // Schema lacks a title field, so v2 stores it under _extras.title.
    const title = (g?._extras?.title as string | undefined) ?? (g?.title as string | undefined) ?? ''
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}" data-rewrite="true">
          <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">Infographic</p>
          ${this._renderTitleHeader({
            title,
            placeholder: 'Untitled infographic',
            onCommit: (t) => this._updateJson<any>(c => ({ ...c, title: t, _extras: { ...(c._extras ?? {}), title: t } })),
          })}

          <div class="flex flex-col gap-2">
            <label class="text-[10px] font-bold tracking-widest uppercase text-gray-500">Infographic image</label>
            ${g?.infographic_image ? html`
              <div class="relative rounded-lg border border-gray-200 overflow-hidden">
                <img src=${g.infographic_image} class="w-full h-auto block" alt="" />
                <button @click=${() => this._setSimpleField('infographic_image', '')}
                  class="absolute top-2 right-2 text-[11px] bg-white border border-gray-200 hover:border-red-300 text-gray-600 hover:text-red-500 px-2 py-1 rounded-md">
                  Remove
                </button>
              </div>
            ` : html`
              <label class="cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors rounded-lg p-10 text-center border-2 border-dashed border-gray-200 hover:border-gray-300 block">
                <div class="w-16 h-12 mx-auto mb-3 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-300">
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="3" width="18" height="14" rx="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="7.5" cy="9" r="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 16l5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="1.2"/></svg>
                </div>
                <p class="text-[13px] text-gray-700 mb-1">Click to upload, or drag and drop</p>
                <p class="text-[12px] text-gray-400">PNG, JPG, SVG</p>
                <input type="file" accept="image/*" class="hidden"
                  @change=${(e: Event) => {
                    const f = (e.target as HTMLInputElement).files?.[0]
                    if (!f) return
                    const reader = new FileReader()
                    reader.onload = (ev) => this._setSimpleField('infographic_image', ev.target?.result as string)
                    reader.readAsDataURL(f)
                  }} />
              </label>
              <p class="text-center text-[11px] text-gray-400 my-1">or paste an image URL</p>
              <input type="url"
                @blur=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value.trim()
                  if (v) this._setSimpleField('infographic_image', v)
                }}
                placeholder="https://…"
                class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-gray-400" />
            `}
          </div>
        </div>
      </div>
    `
  }

  // ── Money Tip: vertical card stack ─────────────────────────────────────────
  private _renderMoneyTip(tip: MoneyTip | null) {
    const cards = tip?.sections ?? []
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[560px] px-8 py-10 flex flex-col gap-3 ${this.isGenerating ? 'ff-stream-cursor' : ''}">
          <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">Money tip · carousel</p>
          ${this._renderTitleHeader({
            title: tip?.title ?? '',
            placeholder: 'Untitled money tip',
            asHtml: true,
            highlightTarget: true,
            onCommit: (htmlVal) => this._updateJson<MoneyTip>(t => ({ ...t, title: htmlVal })),
            readTimeFor: cards.map(c => `${c.heading ?? ''} ${c.body ?? ''}`).join(' '),
          })}
          <p class="text-[11px] text-gray-400 mb-3 -mt-3">Select text in the title above to highlight it on the front end.</p>
          ${cards.length === 0 && this.isGenerating ? html`
            <div class="text-center text-[13px] text-gray-400 py-8">Streaming first card…</div>
          ` : ''}
          ${cards.map((c, i) => html`
            <article class="group rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#063853]/40 transition-colors relative" data-rewrite="true">
              <div class="flex items-center justify-between mb-3">
                <span class="text-[10px] font-bold tracking-widest uppercase text-[#063853]">Card ${i + 1}${c.preheading ? ` · ${c.preheading}` : ''}</span>
                ${this.isGenerating ? '' : html`
                  <button @click=${() => this._removeCard(i)}
                    class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-[11px] transition-opacity">
                    Remove
                  </button>
                `}
              </div>
              <h3
                data-placeholder="Slide heading"
                class="text-[19px] font-semibold text-[#1a1a1a] leading-tight mb-2 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
                contenteditable=${this.isGenerating ? 'false' : 'true'}
                @blur=${(e: Event) => this._updateCardField(i, 'heading', (e.target as HTMLElement).innerHTML)}
              >${unsafeHTML(c.heading ?? '')}</h3>
              <p
                data-placeholder="Type slide copy here…"
                class="text-[13px] text-gray-600 leading-relaxed outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
                contenteditable=${this.isGenerating ? 'false' : 'true'}
                @blur=${(e: Event) => this._updateCardField(i, 'body', (e.target as HTMLElement).innerHTML)}
              >${unsafeHTML(c.body ?? '')}</p>
            </article>
          `)}
          ${this.isGenerating ? '' : html`
            <button @click=${() => this._addCard()}
              class="self-center mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#063853] hover:text-[#04293D] px-4 py-2 rounded-lg border border-dashed border-gray-300 hover:border-[#063853] hover:bg-gray-50 transition-colors">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              Add slide
            </button>
          `}
        </div>
      </div>
    `
  }

  // ── Checklist ──────────────────────────────────────────────────────────────
  private _renderChecklist(cl: Checklist | null) {
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}">
          ${this._renderTitleHeader({
            title: cl?.title ?? '',
            placeholder: 'Untitled checklist',
            onCommit: (t) => this._updateJson<Checklist>(c => ({ ...c, title: t })),
            readTimeFor: [cl?.intro_paragraph, ...(cl?.sections ?? []).flatMap(s => [s.title, s.description, ...(s.items ?? []).map(i => i.label)])].filter(Boolean).join(' '),
          })}
          <p
            data-placeholder="Intro paragraph (optional)"
            class="text-[15px] text-gray-700 leading-relaxed mb-6 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
            contenteditable=${this.isGenerating ? 'false' : 'true'}
            @blur=${(e: Event) => this._updateJson<Checklist>(c => ({ ...c, intro_paragraph: (e.target as HTMLElement).innerText.trim() }))}
          >${cl?.intro_paragraph ?? ''}</p>
          ${(cl?.sections ?? []).map((sec, sIdx) => html`
            <section class="group mb-6" data-rewrite="true">
              <h2
                data-placeholder="Section title"
                class="text-[16px] font-semibold text-[#1a1a1a] mb-1.5 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
                contenteditable=${this.isGenerating ? 'false' : 'true'}
                @blur=${(e: Event) => this._updateChecklistSection(sIdx, 'title', (e.target as HTMLElement).innerText.trim())}
              >${sec.title ?? ''}</h2>
              <p
                data-placeholder="Short description (optional)"
                class="text-[13px] text-gray-500 mb-3 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
                contenteditable=${this.isGenerating ? 'false' : 'true'}
                @blur=${(e: Event) => this._updateChecklistSection(sIdx, 'description', (e.target as HTMLElement).innerText.trim())}
              >${sec.description ?? ''}</p>
              <ul class="flex flex-col gap-2">
                ${(sec.items ?? []).map((it, iIdx) => html`
                  <li class="group/item flex items-start gap-2.5 text-[14px] text-gray-800">
                    <span class="mt-1 w-4 h-4 rounded border border-gray-300 shrink-0"></span>
                    <span
                      data-placeholder="Type a checklist item…"
                      class="flex-1 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
                      contenteditable=${this.isGenerating ? 'false' : 'true'}
                      @blur=${(e: Event) => this._updateChecklistItem(sIdx, iIdx, (e.target as HTMLElement).innerHTML)}
                    >${unsafeHTML(it.label ?? '')}</span>
                    ${this.isGenerating ? '' : html`
                      <button @click=${() => this._removeChecklistItem(sIdx, iIdx)}
                        class="opacity-0 group-hover/item:opacity-100 text-gray-300 hover:text-red-500 text-[11px] transition-opacity">×</button>
                    `}
                  </li>
                `)}
              </ul>
              ${this.isGenerating ? '' : html`
                <button @click=${() => this._addChecklistItem(sIdx)}
                  class="mt-2 text-[11px] text-[#063853] hover:text-[#04293D] flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                  Add item
                </button>
              `}
              ${sec.tip ? html`
                <div class="mt-3 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
                  ${sec.tip.title ? html`<p class="text-[12px] font-semibold text-amber-900 mb-1">${sec.tip.title}</p>` : ''}
                  ${sec.tip.description ? html`<p class="text-[13px] text-amber-800 leading-relaxed">${sec.tip.description}</p>` : ''}
                </div>
              ` : ''}
            </section>
          `)}
          ${this.isGenerating ? '' : html`
            <button @click=${() => this._addChecklistSection()}
              class="flex items-center gap-1.5 text-[12px] font-semibold text-[#063853] hover:text-[#04293D] px-4 py-2 rounded-lg border border-dashed border-gray-300 hover:border-[#063853] hover:bg-gray-50 transition-colors">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              Add section
            </button>
          `}
        </div>
      </div>
    `
  }

  // ── Expert Insight ─────────────────────────────────────────────────────────
  private _updateExpertField(field: 'title' | 'intro_paragraph' | 'read_time', value: string) {
    this._updateJson<ExpertInsight>(ei => ({ ...ei, [field]: value }))
  }
  private _updateExpertSection(idx: number, field: 'plannerId' | 'body', value: string) {
    this._updateJson<ExpertInsight>(ei => ({ ...ei, sections: (ei.sections ?? []).map((s, i) => i === idx ? { ...s, [field]: value } : s) }))
  }
  private _addExpertSection() {
    // Robust to a missing or unparseable output (e.g., before first AI generate)
    let ei = parseJsonContent(this.output) as ExpertInsight | null
    if (!ei || (ei as any).content_type !== 'expert_insight') {
      ei = emptyContentForType('expert_insight') as ExpertInsight
    }
    this._pushUndo()
    const next = { ...ei, sections: [...(ei.sections ?? []), { plannerId: PLANNERS[0]?.id ?? '', body: '' }] }
    this.output = JSON.stringify(next, null, 2)
    this.isDirty = true
  }
  private _removeExpertSection(idx: number) {
    this._updateJson<ExpertInsight>(ei => ({ ...ei, sections: (ei.sections ?? []).filter((_, i) => i !== idx) }))
  }

  private _renderExpertInsight(ei: ExpertInsight | null) {
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}" data-rewrite="true">

          ${this._renderTitleHeader({
            title: ei?.title ?? '',
            placeholder: 'Untitled expert insight',
            onCommit: (t) => this._updateExpertField('title', t),
            readTimeFor: [ei?.intro_paragraph, ...(ei?.sections ?? []).map(s => s.body)].filter(Boolean).join(' '),
          })}
          <p
            data-placeholder="Intro paragraph (optional)"
            class="text-[15px] text-gray-700 leading-relaxed mb-6 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
            contenteditable=${this.isGenerating ? 'false' : 'true'}
            @blur=${(e: Event) => this._updateExpertField('intro_paragraph', (e.target as HTMLElement).innerText.trim())}
          >${ei?.intro_paragraph ?? ''}</p>

          ${(ei?.sections ?? []).map((sec, sIdx) => {
            const planner = PLANNERS.find(p => p.id === sec.plannerId) ?? PLANNERS[0]
            const initials = (planner?.name ?? '').split(/[\s,]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
            const seed = (planner?.id ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
            const palette = ['#063853', '#7c70e3', '#0f6e56', '#a32d2d', '#854f0b', '#993556']
            const bg = palette[seed % palette.length]
            return html`
              <section class="group mb-6 rounded-xl border border-gray-200 p-5 hover:border-gray-300 transition-colors">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="w-11 h-11 rounded-full flex items-center justify-center text-white text-[12px] font-semibold shrink-0" style="background: ${bg}">
                      ${initials}
                    </div>
                    <div class="flex flex-col min-w-0">
                      <label class="text-[10px] font-semibold tracking-wider uppercase text-gray-400 mb-0.5">Coach</label>
                      <select .value=${sec.plannerId}
                        @change=${(e: Event) => this._updateExpertSection(sIdx, 'plannerId', (e.target as HTMLSelectElement).value)}
                        ?disabled=${this.isGenerating}
                        class="text-[14px] text-[#1a1a1a] font-medium bg-white border border-gray-200 rounded-md px-2.5 py-1.5 outline-none focus:border-gray-400 cursor-pointer max-w-[260px]">
                        ${PLANNERS.map(p => html`<option value=${p.id} ?selected=${p.id === sec.plannerId}>${p.name}</option>`)}
                      </select>
                    </div>
                  </div>
                  ${this.isGenerating ? '' : html`
                    <button @click=${() => this._removeExpertSection(sIdx)}
                      class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-[11px] transition-opacity shrink-0">Remove</button>
                  `}
                </div>
                <div data-rewrite="true"
                  data-placeholder="What does this coach say? Type their insight…"
                  class="ff-prose text-[15px] text-gray-800 leading-relaxed outline-none focus:bg-amber-50/40 rounded px-1 -mx-1 min-h-[60px]"
                  contenteditable=${this.isGenerating ? 'false' : 'true'}
                  @blur=${(e: Event) => this._updateExpertSection(sIdx, 'body', (e.target as HTMLElement).innerHTML)}
                >${unsafeHTML(sec.body ?? '')}</div>
              </section>
            `
          })}

          ${this.isGenerating ? '' : html`
            <button @click=${() => this._addExpertSection()}
              class="flex items-center gap-1.5 text-[12px] font-semibold text-[#063853] hover:text-[#04293D] px-4 py-2 rounded-lg border border-dashed border-gray-300 hover:border-[#063853] hover:bg-gray-50 transition-colors">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              Add coach section
            </button>
          `}
        </div>
      </div>
    `
  }

  // ── User Story ─────────────────────────────────────────────────────────────
  private _updateStoryField(field: 'title' | 'subtitle' | 'copy', value: string) {
    this._updateJson<any>(s => ({ ...s, [field]: value }))
  }

  private _renderUserStory(us: any | null) {
    const u = us as { title?: string; subtitle?: string; copy?: string } | null
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}" data-rewrite="true">

          ${this._renderTitleHeader({
            title: u?.title ?? '',
            placeholder: 'Untitled user story',
            onCommit: (t) => this._updateStoryField('title', t),
            readTimeFor: u?.copy ?? '',
          })}
          <p
            data-placeholder="Subtitle (optional)"
            class="text-[16px] text-gray-500 mb-6 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
            contenteditable=${this.isGenerating ? 'false' : 'true'}
            @blur=${(e: Event) => this._updateStoryField('subtitle', (e.target as HTMLElement).innerText.trim())}
          >${u?.subtitle ?? ''}</p>

          <div
            class="ff-prose outline-none focus:bg-amber-50/40 rounded min-h-[120px] ${u?.copy ? '' : 'text-gray-300 italic'}"
            contenteditable=${this.isGenerating ? 'false' : 'true'}
            @blur=${(e: Event) => this._updateStoryField('copy', (e.target as HTMLElement).innerHTML)}
          >${unsafeHTML(u?.copy || (this.isGenerating ? '' : '<p>Tell the story…</p>'))}</div>
        </div>
      </div>
    `
  }

  // ── Quiz ───────────────────────────────────────────────────────────────────
  private _renderQuiz(q: Quiz | null) {
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}">
          ${this._renderTitleHeader({
            title: q?.title ?? '',
            placeholder: 'Untitled quiz',
            onCommit: (t) => this._updateJson<Quiz>(c => ({ ...c, title: t })),
            readTimeFor: [q?.intro_paragraph, ...(q?.questions ?? []).flatMap(qq => [qq.questionText, qq.explanation, ...(qq.answers ?? []).map(a => a.answerText)])].filter(Boolean).join(' '),
          })}
          <p
            data-placeholder="Intro paragraph (optional)"
            class="text-[15px] text-gray-700 leading-relaxed mb-6 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
            contenteditable=${this.isGenerating ? 'false' : 'true'}
            @blur=${(e: Event) => this._updateJson<Quiz>(c => ({ ...c, intro_paragraph: (e.target as HTMLElement).innerText.trim() }))}
          >${q?.intro_paragraph ?? ''}</p>
          <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-3">Type · ${q?.quizType ?? '—'}</p>
          ${(q?.questions ?? []).map((qq, qIdx) => html`
            <article class="group mb-5 rounded-xl border border-gray-200 p-5" data-rewrite="true">
              <div class="flex items-center justify-between mb-2">
                <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400">Question ${qIdx + 1}</p>
                ${this.isGenerating ? '' : html`
                  <button @click=${() => this._removeQuestion(qIdx)}
                    class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-[11px] transition-opacity">Remove</button>
                `}
              </div>
              <p
                data-placeholder="Type your question…"
                class="text-[15px] font-semibold text-[#1a1a1a] mb-3 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
                contenteditable=${this.isGenerating ? 'false' : 'true'}
                @blur=${(e: Event) => this._updateQuestion(qIdx, 'questionText', (e.target as HTMLElement).innerText.trim())}
              >${qq.questionText ?? ''}</p>
              <ul class="flex flex-col gap-1.5">
                ${(qq.answers ?? []).map((a, aIdx) => html`
                  <li class="flex items-center gap-2 text-[14px] text-gray-800">
                    <span class="w-5 h-5 rounded-full border border-gray-300 text-[10px] font-semibold flex items-center justify-center shrink-0">${a.typeOption ?? ''}</span>
                    <span
                      data-placeholder=${'Answer ' + (a.typeOption ?? '')}
                      class="flex-1 outline-none focus:bg-amber-50/40 rounded px-1 -mx-1"
                      contenteditable=${this.isGenerating ? 'false' : 'true'}
                      @blur=${(e: Event) => this._updateAnswer(qIdx, aIdx, (e.target as HTMLElement).innerText.trim())}
                    >${a.answerText ?? ''}</span>
                  </li>
                `)}
              </ul>
              ${this.isGenerating ? '' : html`
                <button @click=${() => this._addAnswer(qIdx)}
                  class="mt-2 text-[11px] text-[#063853] hover:text-[#04293D] flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                  Add answer
                </button>
              `}
              <p
                class="mt-3 text-[12px] text-gray-500 italic outline-none focus:bg-amber-50/40 rounded px-1 -mx-1 ${qq.explanation ? '' : 'text-gray-300'}"
                contenteditable=${this.isGenerating ? 'false' : 'true'}
                @blur=${(e: Event) => this._updateQuestion(qIdx, 'explanation', (e.target as HTMLElement).innerText.trim())}
              >${qq.explanation || (this.isGenerating ? '' : 'Explanation (optional)')}</p>
            </article>
          `)}
          ${this.isGenerating ? '' : html`
            <button @click=${() => this._addQuestion()}
              class="flex items-center gap-1.5 text-[12px] font-semibold text-[#063853] hover:text-[#04293D] px-4 py-2 rounded-lg border border-dashed border-gray-300 hover:border-[#063853] hover:bg-gray-50 transition-colors">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              Add question
            </button>
          `}
        </div>
      </div>
    `
  }

  // ── Generic JSON fallback ──────────────────────────────────────────────────
  private _renderGenericJson(content: AnyContent | null) {
    if (!content) {
      return html`
        <div class="flex-1 overflow-y-auto scrollbar-thin">
          <div class="mx-auto max-w-[720px] px-12 py-10">
            <p class="text-[12px] text-gray-400 mb-2 ${this.isGenerating ? 'ff-stream-cursor' : ''}">Streaming…</p>
            <pre class="text-[12px] text-gray-700 bg-gray-50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">${this.output}</pre>
          </div>
        </div>
      `
    }
    const c = content as unknown as Record<string, unknown>
    return html`
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="mx-auto max-w-[720px] px-12 py-10 ${this.isGenerating ? 'ff-stream-cursor' : ''}">
          ${c.title ? html`<h1 class="text-[24px] font-semibold mb-3">${c.title as string}</h1>` : ''}
          ${c.copy ? html`<div class="text-[15px] text-gray-700 leading-relaxed mb-6">${unsafeHTML(c.copy as string)}</div>` : ''}
          ${c.thumbnail_image ? html`<img src=${c.thumbnail_image as string} class="rounded-lg max-h-[200px] mb-4" alt="" />` : ''}
          ${c.infographic_image ? html`<img src=${c.infographic_image as string} class="rounded-lg w-full mb-4" alt="" />` : ''}
          ${c.reference_link ? html`<p class="text-[13px]"><a href=${c.reference_link as string} class="text-[#063853] underline" target="_blank">${c.reference_link as string}</a></p>` : ''}
        </div>
      </div>
    `
  }

  // ── Expert Sources sidebar block ───────────────────────────────────────────
  private _renderExpertSources() {
    return html`
      <div class="flex flex-col gap-3">
        ${this.expertSources.map((src, i) => html`
          <div class="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p class="text-[10px] font-bold tracking-widest uppercase text-[#383838]">Expert source ${this.expertSources.length > 1 ? i + 1 : ''}</p>
            <textarea .value=${src.insight} rows="3"
              @input=${(e: Event) => this._updateExpert(i, 'insight', (e.target as HTMLTextAreaElement).value)}
              placeholder="Paste raw expert words here…"
              class="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-gray-400 resize-none"></textarea>
            <input type="text" .value=${src.name}
              @input=${(e: Event) => this._updateExpert(i, 'name', (e.target as HTMLInputElement).value)}
              placeholder="Expert name"
              class="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-gray-400" />
          </div>
        `)}
        <button @click=${() => { this.expertSources = [...this.expertSources, { insight: '', name: '', image: '' }] }}
          class="text-left text-[12px] font-semibold text-[#063853] hover:text-[#04293D]">+ Add another expert</button>
      </div>
    `
  }
  private _updateExpert(i: number, field: keyof ExpertSource, value: string) {
    this.expertSources = this.expertSources.map((s, idx) => idx === i ? { ...s, [field]: value } : s)
  }

  // ── Title / body / read time helpers ──────────────────────────────────────

  /** Estimated reading time from raw text or HTML. ~220 words/minute. */
  private _readTime(text: string): string {
    if (!text) return '— min'
    const plain = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#*_>`~\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!plain) return '— min'
    const words = plain.split(' ').length
    const minutes = Math.max(1, Math.round(words / 220))
    return `${minutes} min`
  }

  /** Article: extract the first `# Title` line. */
  private _articleTitle(): string {
    const md = stripPublishingSections(this.output)
    const m = md.match(/^#\s+(.*?)\s*$/m)
    return m ? m[1] : ''
  }
  /** Article: everything after the first `# Title` line. */
  private _articleBody(): string {
    const md = stripPublishingSections(this.output)
    return md.replace(/^#\s+.*\r?\n+/, '')
  }
  private _setArticleTitle(title: string) {
    const body = this._articleBody()
    const t = title.trim()
    const next = (t ? `# ${t}\n\n` : '') + body
    if (next === this.output) return
    this._pushUndo()
    this.output = next
    this.isDirty = true
  }
  private _setArticleBody(bodyMd: string) {
    const title = this._articleTitle()
    const next = (title ? `# ${title}\n\n` : '') + bodyMd
    if (next === this.output) return
    this._pushUndo()
    this.output = next
    this.isDirty = true
  }

  /** Standard locked-title block: big fixed font, Enter disables paragraph
   *  break, optional read-time chip, divider below. Used by every renderer. */
  private _renderTitleHeader(opts: {
    title: string
    placeholder: string
    onCommit: (text: string) => void
    /** When set, the title is rendered as HTML (used for Money Tip highlight markup). */
    asHtml?: boolean
    /** When provided, shows "Read time: …". Pass body text — we estimate. */
    readTimeFor?: string | null
    /** Pass true on Money Tip title for highlight-toolbar support. */
    highlightTarget?: boolean
  }) {
    const enterBlur = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur() }
    }
    const onBlur = (e: Event) => {
      const el = e.target as HTMLElement
      const v = opts.asHtml ? el.innerHTML : el.innerText.trim()
      opts.onCommit(v)
    }
    const dataAttrs = opts.highlightTarget
      ? html`<h1
          data-highlight-target="true"
          data-rewrite="true"
          data-placeholder=${opts.placeholder}
          class="text-[32px] font-semibold text-[#1a1a1a] leading-tight outline-none focus:bg-amber-50/40 rounded px-1 -mx-1 break-words"
          contenteditable=${this.isGenerating ? 'false' : 'true'}
          spellcheck="true"
          @keydown=${enterBlur}
          @blur=${onBlur}
        >${opts.asHtml ? unsafeHTML(opts.title) : opts.title}</h1>`
      : html`<h1
          data-placeholder=${opts.placeholder}
          class="text-[32px] font-semibold text-[#1a1a1a] leading-tight outline-none focus:bg-amber-50/40 rounded px-1 -mx-1 break-words"
          contenteditable=${this.isGenerating ? 'false' : 'true'}
          spellcheck="true"
          @keydown=${enterBlur}
          @blur=${onBlur}
        >${opts.asHtml ? unsafeHTML(opts.title) : opts.title}</h1>`

    return html`
      <div class="mb-5">
        ${dataAttrs}
        ${opts.readTimeFor !== undefined && opts.readTimeFor !== null ? html`
          <p class="text-[11px] text-gray-400 mt-2 flex items-center gap-1.5">
            <span class="font-semibold tracking-wider uppercase">Read time:</span>
            <span>${this._readTime(opts.readTimeFor)}</span>
            <span class="text-gray-300">· auto-calculated from body</span>
          </p>
        ` : ''}
      </div>
      <hr class="border-gray-200 mb-6" />
    `
  }

  // ── Inline editing ─────────────────────────────────────────────────────────
  // (Article edits go through _setArticleBody; per-type edits go through their
  // specific update methods. No generic capture handler is needed.)

  /** Generic JSON-mutator: parse current output, apply updater, re-serialize. */
  private _updateJson<T extends AnyContent>(updater: (c: T) => T) {
    const parsed = parseJsonContent(this.output) as T | null
    if (!parsed) return
    this._pushUndo()
    const next = updater(parsed)
    this.output = JSON.stringify(next, null, 2)
    this.isDirty = true
  }

  /** Money Tip mutators */
  private _updateCardField(idx: number, field: 'heading' | 'body' | 'preheading', value: string) {
    this._updateJson<MoneyTip>(t => ({ ...t, sections: (t.sections ?? []).map((s, i) => i === idx ? { ...s, [field]: value } : s) }))
  }
  private _addCard() {
    this._updateJson<MoneyTip>(t => ({ ...t, sections: [...(t.sections ?? []), { preheading: null, heading: '', body: '' }] }))
  }
  private _removeCard(idx: number) {
    this._updateJson<MoneyTip>(t => ({ ...t, sections: (t.sections ?? []).filter((_, i) => i !== idx) }))
  }

  /** Quiz mutators */
  private _updateQuestion(qIdx: number, field: 'questionText' | 'explanation' | 'tip', value: string) {
    this._updateJson<Quiz>(q => ({ ...q, questions: (q.questions ?? []).map((qq, i) => i === qIdx ? { ...qq, [field]: value } : qq) }))
  }
  private _updateAnswer(qIdx: number, aIdx: number, value: string) {
    this._updateJson<Quiz>(q => ({
      ...q,
      questions: (q.questions ?? []).map((qq, i) => i !== qIdx ? qq : ({
        ...qq,
        answers: (qq.answers ?? []).map((a, j) => j !== aIdx ? a : ({ ...a, answerText: value })),
      })),
    }))
  }
  private _addQuestion() {
    const id = newId()
    const newQ = { questionId: id, questionText: 'New question', tip: '', explanation: '', answers: [
      { questionId: id, answerId: newId(), answerText: 'Answer A', isCorrect: null, answerSelected: null, pointValue: null, typeOption: 'A' as const },
      { questionId: id, answerId: newId(), answerText: 'Answer B', isCorrect: null, answerSelected: null, pointValue: null, typeOption: 'B' as const },
    ] }
    this._updateJson<Quiz>(q => ({ ...q, questions: [...(q.questions ?? []), newQ] }))
  }
  private _removeQuestion(qIdx: number) {
    this._updateJson<Quiz>(q => ({ ...q, questions: (q.questions ?? []).filter((_, i) => i !== qIdx) }))
  }
  private _addAnswer(qIdx: number) {
    const LETTERS: Array<'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'> = ['A','B','C','D','E','F','G','H','I','J']
    this._updateJson<Quiz>(q => ({
      ...q,
      questions: (q.questions ?? []).map((qq, i) => {
        if (i !== qIdx) return qq
        const next = LETTERS[(qq.answers ?? []).length] ?? 'A'
        return { ...qq, answers: [...(qq.answers ?? []), { questionId: qq.questionId, answerId: newId(), answerText: '', isCorrect: null, answerSelected: null, pointValue: null, typeOption: next }] }
      }),
    }))
  }

  /** Checklist mutators */
  private _updateChecklistItem(sIdx: number, iIdx: number, label: string) {
    this._updateJson<Checklist>(cl => ({
      ...cl,
      sections: (cl.sections ?? []).map((s, si) => si !== sIdx ? s : ({
        ...s, items: (s.items ?? []).map((it, ii) => ii !== iIdx ? it : ({ ...it, label })),
      })),
    }))
  }
  private _updateChecklistSection(sIdx: number, field: 'title' | 'description', value: string) {
    this._updateJson<Checklist>(cl => ({
      ...cl,
      sections: (cl.sections ?? []).map((s, si) => si !== sIdx ? s : ({ ...s, [field]: value })),
    }))
  }
  private _addChecklistItem(sIdx: number) {
    this._updateJson<Checklist>(cl => ({
      ...cl,
      sections: (cl.sections ?? []).map((s, si) => si !== sIdx ? s : ({
        ...s, items: [...(s.items ?? []), { id: newId(), label: '', subItems: null, isChecked: null }],
      })),
    }))
  }
  private _removeChecklistItem(sIdx: number, iIdx: number) {
    this._updateJson<Checklist>(cl => ({
      ...cl,
      sections: (cl.sections ?? []).map((s, si) => si !== sIdx ? s : ({
        ...s, items: (s.items ?? []).filter((_, ii) => ii !== iIdx),
      })),
    }))
  }
  private _addChecklistSection() {
    this._updateJson<Checklist>(cl => ({
      ...cl,
      sections: [...(cl.sections ?? []), { id: newId(), title: 'New section', description: '', image: null, items: [{ id: newId(), label: '', subItems: null, isChecked: null }], tip: null }],
    }))
  }

  /** Article block insert — append markdown block to end of current output. */
  private _insertBlock(type: 'h2' | 'h3' | 'list' | 'olist' | 'quote' | 'table' | 'divider') {
    const tpl: Record<string, string> = {
      h2:      '\n\n## New section\n\n',
      h3:      '\n\n### New subsection\n\n',
      list:    '\n\n- New item\n- Another item\n\n',
      olist:   '\n\n1. New item\n2. Another item\n\n',
      quote:   '\n\n> A quote here\n\n',
      table:   '\n\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |\n\n',
      divider: '\n\n---\n\n',
    }
    this._pushUndo()
    this.output = (this.output || '') + tpl[type]
    this.isDirty = true
  }

  // ── Selection AI toolbar ───────────────────────────────────────────────────

  @state() private _selRect: DOMRect | null = null
  @state() private _selText = ''
  @state() private _aiBefore = ''
  @state() private _aiAfter = ''
  @state() private _aiOpen = false
  @state() private _aiAction = ''
  @state() private _aiCustom = ''
  @state() private _aiStreaming = false
  private _aiAbort: AbortController | null = null
  // Saved at rewrite time so Accept can splice the result back into the
  // exact selected range — survives streaming and works for all types.
  private _savedRange: Range | null = null
  private _savedEditable: HTMLElement | null = null

  // Slash-command menu state
  @state() private _slashOpen = false
  @state() private _slashTop = 0
  @state() private _slashLeft = 0
  @state() private _slashFilter = ''
  @state() private _slashIndex = 0

  private _selListenerAttached = false
  override updated() {
    if (this._selListenerAttached) return
    this._selListenerAttached = true
    document.addEventListener('mouseup', this._onSelection)
    document.addEventListener('keyup', this._onSelection)
    document.addEventListener('selectionchange', this._onSelectionChange)
    document.addEventListener('mousedown', this._onOutsideMousedown, true)
    document.addEventListener('keydown', this._onEditorKeydown, true)
    document.addEventListener('input', this._onEditorInput as EventListener, true)
    document.addEventListener('keydown', this._onUndoShortcut)
    document.addEventListener('keydown', this._onEscape)
    document.addEventListener('paste', this._onPaste, true)
  }

  /** Sanitize anything pasted into a contenteditable surface — strip the
   *  Office/Word noise (namespaces, mso-* styles, classes, font tags,
   *  conditional comments) and keep only the structural HTML we support.
   *  Falls back to plain text if no HTML is on the clipboard. */
  private _onPaste = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null
    if (!target?.closest?.('[contenteditable="true"]')) return
    const data = e.clipboardData
    if (!data) return
    const html = data.getData('text/html')
    const text = data.getData('text/plain')
    if (!html && !text) return
    e.preventDefault()
    if (html) {
      const cleaned = sanitizePastedHtml(html)
      if (cleaned) {
        document.execCommand('insertHTML', false, cleaned)
        return
      }
    }
    document.execCommand('insertText', false, text || '')
  }

  // Active table cell — drives the table-editing mini-toolbar.
  @state() private _tableCell: HTMLTableCellElement | null = null
  @state() private _tableRect: DOMRect | null = null
  // HTML/source viewer mode (admin/dev convenience).
  @state() private _viewMode: 'edit' | 'source' = 'edit'
  @state() private _sourceTab: 'html' | 'raw' = 'html'
  @state() private _sourceCopied = false
  // True when the current selection is inside an element marked
  // data-highlight-target="true" (e.g. Money Tip title). Drives the
  // Highlight button in the selection toolbar.
  @state() private _highlightable = false

  // Article-link modal state
  @state() private _linkModalOpen = false
  @state() private _linkFilter = ''
  @state() private _linkEntries: ContentEntry[] = []

  /** Auto-close the selection toolbar when the user collapses or moves the
   *  selection away. Skipped while an AI rewrite is in flight (the rewrite
   *  card owns its own dismissal). */
  private _onSelectionChange = () => {
    // Update table-cell awareness regardless of AI state
    const sel = window.getSelection()
    let cell: HTMLTableCellElement | null = null
    if (sel && sel.anchorNode) {
      let n: Node | null = sel.anchorNode
      while (n && n !== document.body) {
        if (n.nodeType === 1) {
          const tag = (n as HTMLElement).tagName?.toLowerCase()
          if (tag === 'td' || tag === 'th') { cell = n as HTMLTableCellElement; break }
        }
        n = n.parentNode
      }
    }
    if (cell !== this._tableCell) {
      this._tableCell = cell
      this._tableRect = cell?.closest('table')?.getBoundingClientRect() ?? null
    }

    // Detect if selection is inside a highlight-target (Money Tip title).
    let highlightable = false
    if (sel?.anchorNode) {
      let n: Node | null = sel.anchorNode
      while (n && n !== document.body) {
        if (n.nodeType === 1 && (n as HTMLElement).dataset?.highlightTarget === 'true') { highlightable = true; break }
        n = n.parentNode
      }
    }
    if (highlightable !== this._highlightable) this._highlightable = highlightable

    if (this._aiOpen) return
    if (!sel || sel.isCollapsed) {
      this._selText = ''
      this._selRect = null
    }
  }

  /** Click outside the toolbar dismisses it. We catch this in capture phase
   *  so it runs before the toolbar's own mousedown.preventDefault. */
  private _onOutsideMousedown = (e: MouseEvent) => {
    if (this._aiOpen) return
    if (!this._selText) return
    const target = e.target as HTMLElement | null
    if (!target) return
    // Don't dismiss if the click is inside the toolbar itself, or inside
    // an editable surface (where it'd just move the caret).
    if (target.closest?.('[data-toolbar="rewrite"]')) return
    if (target.closest?.('[data-rewrite="true"]')) return
    this._selText = ''
    this._selRect = null
  }

  private _onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (this._aiOpen) { this._closeRewrite(); return }
    if (this._selText) { this._selText = ''; this._selRect = null; return }
    if (this._slashOpen) { this._closeSlash(); return }
  }

  private _onUndoShortcut = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
    // Ignore inside contenteditable so the browser's native text-undo still works.
    const t = e.target as HTMLElement | null
    if (t?.closest?.('[data-rewrite="true"]')) return
    e.preventDefault()
    if (e.shiftKey) this._redo(); else this._undo()
  }

  private _onSelection = () => {
    setTimeout(() => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || this._aiOpen) return
      const text = sel.toString().trim()
      if (text.length < 4) return
      let node: Node | null = sel.anchorNode
      while (node && node.nodeType !== 1) node = node.parentNode
      const inEditor = node && (node as HTMLElement).closest('[data-rewrite="true"]')
      if (!inEditor) return
      this._selRect = sel.getRangeAt(0).getBoundingClientRect()
      this._selText = text
    }, 0)
  }

  private async _runRewrite(action: string, instruction: string) {
    if (!this.apiKey) { this.showKeyPrompt = true; return }
    if (!this._selText) return

    // Snapshot the selection range and the editable element BEFORE the
    // toolbar disappears. Accept will splice the result back into this range.
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      this._savedRange = sel.getRangeAt(0).cloneRange()
      let n: Node | null = this._savedRange.startContainer
      while (n) {
        if (n.nodeType === 1 && (n as HTMLElement).getAttribute?.('contenteditable') === 'true') break
        n = n.parentNode
      }
      this._savedEditable = (n as HTMLElement | null) ?? null
    }

    this._aiOpen = true
    this._aiAction = action
    this._aiBefore = this._selText
    this._aiAfter = ''
    this._aiStreaming = true
    this._aiAbort?.abort()
    const controller = new AbortController()
    this._aiAbort = controller

    const prompt = [
      'Rewrite the passage below per the instruction.',
      'Return ONLY the rewritten passage — no quotation marks, no labels, no markdown code fences, no commentary.',
      'Keep the length similar to the original. Preserve **bold**, *italic*, and links that appeared in the passage.',
      '',
      'Passage:',
      this._selText,
      '',
      `Instruction: ${instruction}`,
    ].join('\n')

    try {
      let acc = ''
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: prompt }],
        'You are a careful copy editor for Financial Finesse. Return only the rewritten passage, nothing else.',
        (chunk) => { acc += chunk; this._aiAfter = acc },
        controller.signal,
        1024,
      )
      let cleaned = acc.trim().replace(/^```[a-z]*\n?|\n?```$/gi, '').trim().replace(/^["'](.+)["']$/s, '$1').trim()
      this._aiAfter = cleaned
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this._aiAfter = '[error] ' + (err instanceof Error ? err.message : String(err))
      }
    } finally {
      this._aiStreaming = false
    }
  }

  private _acceptRewrite = () => {
    if (!this._aiAfter || this._aiStreaming) return

    const editable = this._savedEditable
    const range = this._savedRange

    // Path A — splice into the saved range. Works for both article markdown
    // surfaces and inner card / item / answer / section editables.
    if (editable && range && document.body.contains(editable)) {
      try {
        // Build a fragment from the rewritten text. We allow simple inline
        // HTML (e.g., <strong>) by parsing through a div.
        const tmp = document.createElement('div')
        tmp.innerHTML = this._aiAfter
        const frag = document.createDocumentFragment()
        Array.from(tmp.childNodes).forEach(n => frag.appendChild(n))
        range.deleteContents()
        range.insertNode(frag)

        this._pushUndo()
        // Sync output from the editable's current state.
        if (this.contentType === 'article') {
          this.output = htmlToMarkdown(editable.innerHTML)
        } else {
          // For JSON-backed types we drive a real blur so the field-specific
          // handler runs (e.g., _updateCardField, _updateChecklistItem, etc.).
          editable.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        }
        this.isDirty = true
        this._closeRewrite()
        return
      } catch {
        // fall through to Path B
      }
    }

    // Path B — fallback: text-replace inside output (works when the surface
    // is not in the DOM anymore but the literal string still exists).
    if (this.output.includes(this._aiBefore)) {
      this._pushUndo()
      this.output = this.output.replace(this._aiBefore, this._aiAfter)
      this.isDirty = true
    }
    this._closeRewrite()
  }
  private _closeRewrite = () => {
    this._aiAbort?.abort()
    this._aiOpen = false
    this._aiBefore = ''
    this._aiAfter = ''
    this._aiAction = ''
    this._selText = ''
    this._selRect = null
    this._savedRange = null
    this._savedEditable = null
  }

  private _exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value)
    // After format change, force re-capture from the active editable surface
    const sel = window.getSelection()
    let node: Node | null = sel?.anchorNode ?? null
    while (node && node.nodeType !== 1) node = node.parentNode
    const editor = node && (node as HTMLElement).closest('[data-rewrite="true"]')
    if (editor && (editor as HTMLElement).dataset.rewrite === 'true' && this.contentType === 'article') {
      const md = htmlToMarkdown((editor as HTMLElement).innerHTML)
      if (md && md !== this.output) { this.output = md; this.isDirty = true }
    }
  }

  private _exec_link() {
    const url = window.prompt('Link URL:')
    if (!url) return
    this._exec('createLink', url)
  }

  /** Toggle a yellow highlight on the current selection. Used in Money Tip
   *  titles to mark words that the front-end will render with emphasis.
   *  If the selection sits entirely inside an existing .ff-highlight, the
   *  wrapper is unwrapped instead. */
  private _toggleHighlight() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const range = sel.getRangeAt(0)

    // If anchor and focus are both inside a .ff-highlight, unwrap it.
    const enclosing = (n: Node | null): HTMLElement | null => {
      let cur: Node | null = n
      while (cur) {
        if (cur.nodeType === 1 && (cur as HTMLElement).classList?.contains('ff-highlight')) return cur as HTMLElement
        cur = cur.parentNode
      }
      return null
    }
    const anchorMark = enclosing(sel.anchorNode)
    const focusMark = enclosing(sel.focusNode)
    if (anchorMark && anchorMark === focusMark) {
      // Unwrap
      const parent = anchorMark.parentNode
      if (parent) {
        while (anchorMark.firstChild) parent.insertBefore(anchorMark.firstChild, anchorMark)
        parent.removeChild(anchorMark)
      }
    } else {
      // Wrap
      const text = range.toString()
      if (!text) return
      const mark = document.createElement('mark')
      mark.className = 'ff-highlight'
      mark.textContent = text
      range.deleteContents()
      range.insertNode(mark)
    }

    // Find the editable host and capture
    let host: Node | null = sel.anchorNode
    while (host) {
      if (host.nodeType === 1 && (host as HTMLElement).getAttribute?.('contenteditable') === 'true') break
      host = host.parentNode
    }
    if (host) (host as HTMLElement).dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    this.isDirty = true
  }

  private _renderSelectionToolbar() {
    if (!this._selText || this._aiOpen) return ''
    const r = this._selRect
    const W = 300, H = 360, GAP = 12, MARGIN = 8
    const winW = window.innerWidth, winH = window.innerHeight

    let left: number
    let top: number = Math.max(MARGIN, Math.min(winH - H - MARGIN, (r?.top ?? 60) - 4))

    if (r) {
      // 1) Right of selection
      if (r.right + GAP + W <= winW - MARGIN) {
        left = r.right + GAP
      // 2) Left of selection
      } else if (r.left - GAP - W >= MARGIN) {
        left = r.left - GAP - W
      // 3) Below (or above if no room below)
      } else {
        left = Math.max(MARGIN, Math.min(winW - W - MARGIN, r.left))
        if (r.bottom + GAP + H <= winH - MARGIN) {
          top = r.bottom + GAP
        } else {
          top = Math.max(MARGIN, r.top - GAP - H)
        }
      }
    } else {
      left = MARGIN
    }

    return html`
      <div class="fixed z-40 bg-white rounded-xl shadow-2xl border border-gray-200 ff-fade-in"
        data-toolbar="rewrite"
        style="top: ${top}px; left: ${left}px; width: ${W}px;"
        @mousedown=${(e: Event) => e.preventDefault()}>

        <!-- Formatting row 1 -->
        <div class="flex items-center px-2 py-1.5 border-b border-gray-100">
          <button @click=${() => this._exec('formatBlock', '<p>')} title="Paragraph"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <span class="text-[14px] font-serif">T</span>
          </button>
          <button @click=${() => this._exec('formatBlock', '<h2>')} title="Heading"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <span class="text-[13px] font-bold">H</span>
          </button>
          <button @click=${() => this._exec('formatBlock', '<h3>')} title="Subheading"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <span class="text-[12px] font-bold">h</span>
          </button>
          <span class="w-px h-5 bg-gray-200 mx-0.5"></span>
          <button @click=${() => this._exec('bold')} title="Bold (⌘B)"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <span class="text-[13px] font-bold">B</span>
          </button>
          <button @click=${() => this._exec('italic')} title="Italic (⌘I)"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <span class="text-[13px] italic font-serif">I</span>
          </button>
          <button @click=${() => this._exec('underline')} title="Underline"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <span class="text-[13px] underline">U</span>
          </button>
          <button @click=${() => this._exec('strikeThrough')} title="Strikethrough"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <span class="text-[13px] line-through">S</span>
          </button>
          <button @click=${() => this._exec_link()} title="External link"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5 9l4-4M6 4l1-1a2.5 2.5 0 013.5 3.5L9 9M8 5L7 6m0 4L6 11a2.5 2.5 0 01-3.5-3.5L4 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button @click=${() => this._openLinkModal()} title="Link to internal article"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="3" width="10" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M4 6h6M4 8h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
          ${this._highlightable ? html`
            <span class="w-px h-5 bg-gray-200 mx-0.5"></span>
            <button @click=${() => this._toggleHighlight()} title="Toggle highlight (Money Tip titles)"
              class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100">
              <span class="text-[12px] font-semibold" style="background:#fef08a;padding:1px 4px;border-radius:3px;">A</span>
            </button>
          ` : ''}
        </div>

        <!-- AI Skills -->
        <div class="px-3 py-2 border-b border-gray-100">
          <p class="text-[10px] font-semibold tracking-wider uppercase text-gray-400 mb-1">AI</p>
          ${[
            { label: 'Improve writing', instr: 'Improve clarity and flow while preserving the original meaning. Tighten weak sentences. Keep Financial Finesse voice.' },
            { label: 'Proofread',       instr: 'Fix spelling, grammar, and punctuation. Do not change meaning, voice, or formatting.' },
            { label: 'Make warmer',     instr: 'Rewrite with a warmer, more empathetic, human tone.' },
            { label: 'Make shorter',    instr: 'Make this shorter and more concise while keeping the core message.' },
            { label: 'Simpler language', instr: 'Rewrite using simpler, clearer language and avoid jargon.' },
            { label: 'Explain',         instr: 'Add a brief plain-English explanation alongside or in place of jargon, so a beginner reader follows it.' },
          ].map(a => html`
            <button @click=${() => this._runRewrite(a.label, a.instr)}
              class="w-full text-left text-[13px] text-gray-800 hover:bg-gray-50 px-2 py-1.5 rounded flex items-center justify-between">
              <span>${a.label}</span>
            </button>
          `)}
        </div>

        <!-- Custom AI -->
        <div class="px-3 py-2">
          <input type="text" .value=${this._aiCustom}
            @input=${(e: Event) => { this._aiCustom = (e.target as HTMLInputElement).value }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && this._aiCustom.trim()) { this._runRewrite('Custom', this._aiCustom.trim()); this._aiCustom = '' } }}
            placeholder="Edit with AI…"
            class="w-full text-[13px] px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-md outline-none focus:border-gray-400 focus:bg-white" />
        </div>
      </div>
    `
  }

  private _renderRewriteCard() {
    if (!this._aiOpen) return ''
    return html`
      <div class="fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[min(720px,calc(100vw-2rem))]">
        <div class="rounded-xl overflow-hidden shadow-lg bg-white border border-violet-200">
          <div class="flex items-center justify-between px-3 py-2 bg-violet-50 border-b border-violet-100">
            <div class="flex items-center gap-2 text-[12px] font-semibold text-violet-700">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 5L12.5 7L8.5 8.5L7 13L5.5 8.5L1.5 7L5.5 5L7 1Z" fill="currentColor"/></svg>
              AI rewrite · ${this._aiAction}
              ${this._aiStreaming ? html`<span class="text-[11px] text-gray-400 ml-1 font-normal">writing…</span>` : ''}
            </div>
            <div class="flex items-center gap-1.5">
              <button @click=${this._closeRewrite}
                class="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md">Reject</button>
              <button @click=${this._acceptRewrite}
                ?disabled=${this._aiStreaming || !this._aiAfter.trim()}
                class="text-[11px] font-semibold text-white bg-[#1a1a1a] hover:bg-black rounded-md px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed">Accept</button>
            </div>
          </div>
          <div class="px-4 py-2.5 text-[13px] leading-relaxed text-gray-500 border-b border-dashed border-gray-200 bg-rose-50/50">
            <span class="inline-block text-[10px] font-semibold tracking-wider uppercase text-rose-700 mr-2 align-middle">Before</span>
            <span class="align-middle">${this._aiBefore}</span>
          </div>
          <div class="px-4 py-2.5 text-[13px] leading-relaxed text-[#1a1a1a] bg-emerald-50/40">
            <span class="inline-block text-[10px] font-semibold tracking-wider uppercase text-emerald-700 mr-2 align-middle">After</span>
            <span class="align-middle">${this._aiAfter || html`<span class="text-gray-400 italic">waiting for AI…</span>`}</span>
          </div>
        </div>
      </div>
    `
  }

  // ── Link to article ────────────────────────────────────────────────────────

  private _openLinkModal() {
    // Save the current selection so we can splice the link back into it
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      this._savedRange = sel.getRangeAt(0).cloneRange()
      let n: Node | null = this._savedRange.startContainer
      while (n) {
        if (n.nodeType === 1 && (n as HTMLElement).getAttribute?.('contenteditable') === 'true') break
        n = n.parentNode
      }
      this._savedEditable = (n as HTMLElement | null) ?? null
    }
    // Lazy-load entries: saved drafts + CMS articles, deduped
    const stored = loadAll()
    const storedIds = new Set(stored.map(e => e.id))
    let cms: ContentEntry[] = []
    try { cms = loadArticles().filter(a => !storedIds.has(a.id)) } catch { cms = [] }
    this._linkEntries = [...stored, ...cms].filter(e => e.status !== 'trash')
    this._linkFilter = ''
    this._linkModalOpen = true
    this._selText = '' // close the selection toolbar so it doesn't overlap
  }

  private _applyArticleLink(entry: ContentEntry) {
    const range = this._savedRange
    const editable = this._savedEditable
    if (!range || !editable) { this._linkModalOpen = false; return }

    const text = range.toString()
    if (!text) { this._linkModalOpen = false; return }

    this._pushUndo()
    const a = document.createElement('a')
    a.href = `internal://${entry.slug || entry.id}`
    a.textContent = text
    a.dataset.entryId = entry.id
    range.deleteContents()
    range.insertNode(a)

    if (this.contentType === 'article') {
      this.output = htmlToMarkdown(editable.innerHTML)
    } else {
      editable.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    }
    this.isDirty = true
    this._linkModalOpen = false
    this._savedRange = null
    this._savedEditable = null
  }

  private _renderLinkModal() {
    if (!this._linkModalOpen) return ''
    const q = this._linkFilter.trim().toLowerCase()
    const filtered = !q ? this._linkEntries : this._linkEntries.filter(e =>
      (e.title ?? '').toLowerCase().includes(q) ||
      (e.topic ?? '').toLowerCase().includes(q) ||
      (e.slug ?? '').toLowerCase().includes(q),
    )
    return html`
      <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
        @click=${(e: Event) => { if (e.target === e.currentTarget) this._linkModalOpen = false }}>
        <div class="bg-white rounded-2xl shadow-2xl w-[560px] max-w-[calc(100vw-2rem)] mx-4 flex flex-col max-h-[70vh] ff-fade-in">
          <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
            <h3 class="text-[15px] font-semibold text-[#1a1a1a]">Link to an article</h3>
            <button @click=${() => { this._linkModalOpen = false }} class="text-gray-400 hover:text-gray-700 text-[18px]">×</button>
          </div>
          <div class="px-5 py-3 border-b border-gray-100 shrink-0">
            <input type="text" autofocus
              .value=${this._linkFilter}
              @input=${(e: Event) => { this._linkFilter = (e.target as HTMLInputElement).value }}
              placeholder="Search by title, topic, or slug…"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400" />
          </div>
          <div class="flex-1 overflow-y-auto scrollbar-thin">
            ${filtered.length === 0 ? html`
              <p class="px-5 py-6 text-[12px] text-gray-400 text-center">No articles match.</p>
            ` : html`
              <ul class="divide-y divide-gray-100">
                ${filtered.map(e => html`
                  <li>
                    <button @click=${() => this._applyArticleLink(e)}
                      class="w-full text-left px-5 py-3 hover:bg-gray-50 flex items-center gap-3">
                      <span class="flex-1 min-w-0">
                        <span class="block text-[14px] text-gray-900 font-medium truncate">${e.title || 'Untitled'}</span>
                        <span class="block text-[11px] text-gray-400 truncate">
                          ${V2_TYPE_LABELS[e.contentType] ?? e.contentType}
                          · ${e.region ?? ''}
                          ${e.slug ? html` · <span class="font-mono">${e.slug}</span>` : ''}
                        </span>
                      </span>
                      <span class="text-[11px] text-gray-300 shrink-0">Insert</span>
                    </button>
                  </li>
                `)}
              </ul>
            `}
          </div>
        </div>
      </div>
    `
  }

  // ── Table editing ─────────────────────────────────────────────────────────

  private _captureFromTable(table: HTMLTableElement) {
    const editable = table.closest('[contenteditable="true"]') as HTMLElement | null
    if (!editable) return
    this._pushUndo()
    if (this.contentType === 'article') {
      this.output = htmlToMarkdown(editable.innerHTML)
    } else {
      editable.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    }
    this.isDirty = true
  }

  private _addRow(where: 'above' | 'below') {
    const cell = this._tableCell; if (!cell) return
    const tr = cell.parentElement as HTMLTableRowElement | null
    const table = cell.closest('table') as HTMLTableElement | null
    if (!tr || !table) return
    const cellCount = tr.cells.length
    const newTr = document.createElement('tr')
    for (let i = 0; i < cellCount; i++) {
      const td = document.createElement('td')
      td.innerHTML = '<br>'
      newTr.appendChild(td)
    }
    if (where === 'above') tr.parentElement!.insertBefore(newTr, tr)
    else tr.parentElement!.insertBefore(newTr, tr.nextSibling)
    this._captureFromTable(table)
  }

  private _addCol(where: 'left' | 'right') {
    const cell = this._tableCell; if (!cell) return
    const idx = cell.cellIndex
    const table = cell.closest('table') as HTMLTableElement | null
    if (!table || idx < 0) return
    const rows = Array.from(table.rows)
    rows.forEach(r => {
      const isHeader = r.cells[0]?.tagName?.toLowerCase() === 'th'
      const newCell = document.createElement(isHeader ? 'th' : 'td')
      newCell.innerHTML = isHeader ? 'New' : '<br>'
      const targetIdx = where === 'left' ? idx : idx + 1
      const ref = r.cells[targetIdx] ?? null
      r.insertBefore(newCell, ref)
    })
    this._captureFromTable(table)
  }

  private _deleteRow() {
    const cell = this._tableCell; if (!cell) return
    const tr = cell.parentElement as HTMLTableRowElement | null
    const table = cell.closest('table') as HTMLTableElement | null
    if (!tr || !table) return
    if (table.rows.length <= 1) return // keep at least one row
    tr.remove()
    this._tableCell = null
    this._captureFromTable(table)
  }

  private _deleteCol() {
    const cell = this._tableCell; if (!cell) return
    const idx = cell.cellIndex
    const table = cell.closest('table') as HTMLTableElement | null
    if (!table || idx < 0) return
    const rows = Array.from(table.rows)
    if ((rows[0]?.cells.length ?? 0) <= 1) return // keep at least one column
    rows.forEach(r => { if (r.cells[idx]) r.deleteCell(idx) })
    this._tableCell = null
    this._captureFromTable(table)
  }

  private _renderTableToolbar() {
    const r = this._tableRect; const cell = this._tableCell
    if (!r || !cell) return ''
    if (this._slashOpen || this._aiOpen) return ''
    // Anchor above the table; fall back below if no room
    const W = 280, H = 32
    let top = Math.max(8, r.top - 8 - H)
    if (top < 8) top = Math.min(window.innerHeight - H - 8, r.bottom + 8)
    const left = Math.max(8, Math.min(window.innerWidth - W - 8, r.left + (r.width - W) / 2))
    return html`
      <div class="fixed z-30 bg-white rounded-lg shadow-md border border-gray-200 px-1.5 py-1 flex items-center gap-0.5"
        style="top: ${top}px; left: ${left}px;"
        @mousedown=${(e: Event) => e.preventDefault()}>
        ${this._tbBtn('+ Row above', () => this._addRow('above'))}
        ${this._tbBtn('+ Row below', () => this._addRow('below'))}
        <span class="w-px h-4 bg-gray-200 mx-0.5"></span>
        ${this._tbBtn('+ Col left',  () => this._addCol('left'))}
        ${this._tbBtn('+ Col right', () => this._addCol('right'))}
        <span class="w-px h-4 bg-gray-200 mx-0.5"></span>
        ${this._tbBtn('− Row', () => this._deleteRow(), true)}
        ${this._tbBtn('− Col', () => this._deleteCol(), true)}
      </div>
    `
  }

  private _tbBtn(label: string, fn: () => void, danger = false) {
    return html`
      <button @click=${fn}
        class="text-[11px] px-2 py-1 rounded hover:bg-gray-50 ${danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700'}">
        ${label}
      </button>
    `
  }

  // ── Slash-command block menu ───────────────────────────────────────────────

  private _slashBlocks() {
    return [
      { key: 'text',    label: 'Text',          shortcut: '',     html: '<p><br></p>',
        desc: 'Just start writing with plain text.' },
      { key: 'h2',      label: 'Heading',       shortcut: '##',   html: '<h2>Heading</h2>',
        desc: 'Section heading.' },
      { key: 'h3',      label: 'Subheading',    shortcut: '###',  html: '<h3>Subheading</h3>',
        desc: 'Subsection heading.' },
      { key: 'bullet',  label: 'Bulleted list', shortcut: '-',    html: '<ul><li>Item</li></ul>',
        desc: 'Create a simple bulleted list.' },
      { key: 'number',  label: 'Numbered list', shortcut: '1.',   html: '<ol><li>Item</li></ol>',
        desc: 'Create a list with numbers.' },
      { key: 'quote',   label: 'Quote',         shortcut: '"',    html: '<blockquote>Quote</blockquote>',
        desc: 'Capture a quote.' },
      { key: 'divider', label: 'Divider',       shortcut: '---',  html: '<hr>',
        desc: 'Visually divide blocks.' },
      { key: 'table',   label: 'Table',         shortcut: '',     html: '<table style="border-collapse:collapse;width:100%"><thead><tr><th style="border:1px solid #e5e7eb;padding:6px 10px;text-align:left">Column 1</th><th style="border:1px solid #e5e7eb;padding:6px 10px;text-align:left">Column 2</th></tr></thead><tbody><tr><td style="border:1px solid #e5e7eb;padding:6px 10px">Cell</td><td style="border:1px solid #e5e7eb;padding:6px 10px">Cell</td></tr><tr><td style="border:1px solid #e5e7eb;padding:6px 10px">Cell</td><td style="border:1px solid #e5e7eb;padding:6px 10px">Cell</td></tr></tbody></table>',
        desc: 'Add a simple table.' },
    ]
  }

  private _filteredSlash() {
    const q = this._slashFilter.toLowerCase().trim()
    if (!q) return this._slashBlocks()
    return this._slashBlocks().filter(b => b.label.toLowerCase().includes(q))
  }

  private _onEditorKeydown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    const inEditor = target?.closest?.('[data-rewrite="true"]')

    // While slash menu is open, capture nav keys
    if (this._slashOpen) {
      const items = this._filteredSlash()
      if (e.key === 'Escape') { e.preventDefault(); this._closeSlash(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); this._slashIndex = Math.min(this._slashIndex + 1, Math.max(items.length - 1, 0)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this._slashIndex = Math.max(this._slashIndex - 1, 0); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        const pick = items[this._slashIndex]
        if (pick) this._insertSlashBlock(pick)
        return
      }
      // Backspace handled by input event below to keep filter in sync
    }

    // Trigger menu on "/"
    if (!this._slashOpen && inEditor && e.key === '/') {
      // Let the "/" land in the DOM, then read its position
      setTimeout(() => this._openSlashMenu(), 0)
    }
  }

  private _openSlashMenu() {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const r = sel.getRangeAt(0).getBoundingClientRect()
    this._slashTop = Math.min(window.innerHeight - 320, r.bottom + 6)
    this._slashLeft = Math.max(8, Math.min(window.innerWidth - 320, r.left))
    this._slashOpen = true
    this._slashFilter = ''
    this._slashIndex = 0
  }

  private _onEditorInput = (e: Event) => {
    if (!this._slashOpen) return
    const sel = window.getSelection()
    if (!sel || !sel.anchorNode) return
    const text = (sel.anchorNode.textContent ?? '')
    const slashIdx = text.lastIndexOf('/')
    if (slashIdx === -1) { this._closeSlash(); return }
    // Filter is everything after the "/"
    const offset = (sel.anchorOffset ?? 0)
    this._slashFilter = text.slice(slashIdx + 1, offset)
    this._slashIndex = 0
    void e
  }

  private _closeSlash() {
    this._slashOpen = false
    this._slashFilter = ''
    this._slashIndex = 0
  }

  /** Replace the "/" + filter chars at cursor with the chosen block HTML. */
  private _insertSlashBlock(block: { html: string; key: string }) {
    const sel = window.getSelection()
    if (!sel || !sel.anchorNode) { this._closeSlash(); return }

    // Find the "/" anchor in the current text node and select from there to caret.
    const node = sel.anchorNode
    if (node.nodeType !== Node.TEXT_NODE) { this._closeSlash(); return }
    const text = node.textContent ?? ''
    const slashIdx = text.lastIndexOf('/', sel.anchorOffset)
    if (slashIdx === -1) { this._closeSlash(); return }

    this._pushUndo()

    const range = document.createRange()
    range.setStart(node, slashIdx)
    range.setEnd(node, sel.anchorOffset)
    sel.removeAllRanges()
    sel.addRange(range)

    document.execCommand('insertHTML', false, block.html)

    // Capture markdown roundtrip from the editor surface we landed in
    let parent: Node | null = sel.anchorNode
    while (parent && parent.nodeType !== 1) parent = parent.parentNode
    const editor = parent && (parent as HTMLElement).closest('[data-rewrite="true"]') as HTMLElement | null
    if (editor && this.contentType === 'article') {
      const md = htmlToMarkdown(editor.innerHTML)
      if (md && md !== this.output) { this.output = md; this.isDirty = true }
    }

    this._closeSlash()
  }

  private _renderSlashMenu() {
    if (!this._slashOpen) return ''
    const items = this._filteredSlash()
    return html`
      <div class="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-200 ff-fade-in flex flex-col"
        style="top: ${this._slashTop}px; left: ${this._slashLeft}px; width: 300px; max-height: 320px;"
        @mousedown=${(e: Event) => e.preventDefault()}>

        <div class="px-3 py-2 border-b border-gray-100">
          <div class="text-[11px] text-gray-400">Type to filter… <span class="text-gray-300 ml-1">${this._slashFilter || ''}</span></div>
        </div>

        <div class="flex-1 overflow-y-auto py-1.5">
          <p class="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase text-gray-400">Basic blocks</p>
          ${items.length === 0 ? html`
            <p class="px-3 py-3 text-[12px] text-gray-400">No matches</p>
          ` : items.map((b, i) => html`
            <button
              @mouseenter=${() => { this._slashIndex = i }}
              @click=${() => this._insertSlashBlock(b)}
              class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 ${this._slashIndex === i ? 'bg-gray-50' : ''}">
              <span class="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 bg-white shrink-0 text-[11px] font-semibold text-gray-700">
                ${blockIcon(b.key)}
              </span>
              <span class="flex-1 min-w-0">
                <span class="block text-[13px] text-gray-900 font-medium">${b.label}</span>
                <span class="block text-[11px] text-gray-400 truncate">${b.desc ?? ''}</span>
              </span>
              ${b.shortcut ? html`<span class="text-[11px] text-gray-300 font-mono">${b.shortcut}</span>` : ''}
            </button>
          `)}
        </div>

        <div class="border-t border-gray-100 px-3 py-1.5 flex items-center justify-between text-[11px] text-gray-400">
          <button @click=${() => this._closeSlash()} class="hover:text-gray-700">Close menu</button>
          <span class="font-mono">esc</span>
        </div>
      </div>
    `
  }

  // ── API key prompt ─────────────────────────────────────────────────────────
  private _renderKeyPrompt() {
    return html`
      <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
        <div class="bg-white rounded-2xl shadow-2xl w-[440px] mx-4 p-6 ff-fade-in">
          <h3 class="text-[16px] font-semibold mb-1">Anthropic API key</h3>
          <p class="text-[12px] text-gray-500 mb-4">v2 uses your API key to call Claude directly from the browser. Stored in localStorage on this machine — same key the live app uses.</p>
          <input type="password" .value=${this.keyDraft} autofocus
            @input=${(e: Event) => { this.keyDraft = (e.target as HTMLInputElement).value }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && this.keyDraft.trim()) this._saveApiKey() }}
            placeholder="sk-ant-…"
            class="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[13px] font-mono outline-none focus:border-gray-400 mb-4" />
          <div class="flex justify-end gap-2">
            <button @click=${() => { this.showKeyPrompt = false }}
              class="text-[12px] text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
            <button @click=${() => this._saveApiKey()}
              ?disabled=${!this.keyDraft.trim()}
              class="text-[12px] font-semibold px-4 py-2 rounded-lg bg-[#063853] hover:bg-[#04293D] text-white disabled:opacity-40">Save and generate</button>
          </div>
        </div>
      </div>
    `
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16)
  })
}

/** Minimal DOM → markdown converter for inline-edited article surfaces.
 *  Mirrors the production helper in ff-output-panel.ts (kept narrow). */
function domToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  const children = () => Array.from(el.childNodes).map(domToMarkdown).join('')
  switch (tag) {
    case 'h1': return `# ${children().trim()}\n\n`
    case 'h2': return `## ${children().trim()}\n\n`
    case 'h3': return `### ${children().trim()}\n\n`
    case 'h4': return `#### ${children().trim()}\n\n`
    case 'p': { const t = children().trim(); return t ? `${t}\n\n` : '\n' }
    case 'div': { const c = children(); return c.trim() ? `${c.trim()}\n\n` : '\n' }
    case 'ul': {
      const items = Array.from(el.children).filter(c => c.tagName.toLowerCase() === 'li')
        .map(li => `- ${Array.from(li.childNodes).map(domToMarkdown).join('').trim()}`).join('\n')
      return items ? `${items}\n\n` : ''
    }
    case 'ol': {
      const items = Array.from(el.children).filter(c => c.tagName.toLowerCase() === 'li')
        .map((li, i) => `${i + 1}. ${Array.from(li.childNodes).map(domToMarkdown).join('').trim()}`).join('\n')
      return items ? `${items}\n\n` : ''
    }
    case 'li': return children()
    case 'strong': case 'b': return `**${children()}**`
    case 'em': case 'i': return `*${children()}*`
    case 'a': { const href = el.getAttribute('href') ?? ''; return `[${children()}](${href})` }
    case 'br': return '\n'
    case 'blockquote': {
      const inner = children().trim()
      return inner ? inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n' : ''
    }
    case 'hr': return '\n---\n\n'
    default: return children()
  }
}
function htmlToMarkdown(htmlStr: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = htmlStr
  return Array.from(tmp.childNodes).map(domToMarkdown).join('').trim()
}

/** Clean Word/Office paste output to an allow-listed HTML subset.
 *  - Drops `<style>`, `<script>`, `<head>`, conditional comments, `<o:*>` /
 *    `<w:*>` / `<v:*>` Office tags, `<font>`, empty paragraphs.
 *  - Strips every `style`, `class`, `lang`, `dir`, `mso-*`, and namespaced
 *    attribute. Keeps only the bare structural tags we render. */
const PASTE_ALLOWED_TAGS = new Set<string>([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'hr',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'div', 'span', 'mark',
])

function sanitizePastedHtml(rawHtml: string): string {
  if (!rawHtml) return ''
  // Pre-strip non-DOM noise that DOMParser would otherwise drag along
  let pre = rawHtml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')

  const doc = new DOMParser().parseFromString(pre, 'text/html')
  if (!doc.body) return ''
  walkPaste(doc.body)

  // Final pass: drop empty paragraphs / runs of nbsp the cleanup leaves behind
  let out = doc.body.innerHTML
    .replace(/<p>\s*(?:<br\s*\/?>|&nbsp;| |\s)*\s*<\/p>/gi, '')
    .replace(/<div>\s*<\/div>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
  return out.trim()
}

function walkPaste(node: Element) {
  const kids = Array.from(node.children) as Element[]
  for (const child of kids) {
    const tag = child.tagName.toLowerCase()
    // Office namespaces (`o:p`, `w:something`, `v:shape`) — drop entirely
    if (tag.includes(':')) { child.remove(); continue }
    // <font> — unwrap (keep its content)
    if (tag === 'font') { unwrap(child); continue }
    // Unknown tag — unwrap so we keep the text but drop the markup
    if (!PASTE_ALLOWED_TAGS.has(tag)) { unwrap(child); continue }
    // Strip every attribute except href on links
    Array.from(child.attributes).forEach(attr => {
      if (tag === 'a' && attr.name === 'href') return
      if (tag === 'mark' && attr.name === 'class' && /\bff-highlight\b/.test(attr.value)) return
      child.removeAttribute(attr.name)
    })
    // Unwrap empty <span> / <div> with nothing useful left on them
    if ((tag === 'span' || tag === 'div') && child.attributes.length === 0) {
      unwrap(child); continue
    }
    walkPaste(child)
  }
}

function unwrap(el: Element) {
  const parent = el.parentNode
  if (!parent) { el.remove(); return }
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

function blockIcon(key: string): string {
  switch (key) {
    case 'text':    return 'T'
    case 'h2':      return 'H'
    case 'h3':      return 'h'
    case 'bullet':  return '•'
    case 'number':  return '1.'
    case 'quote':   return '“'
    case 'divider': return '—'
    case 'table':   return '⊞'
    default:        return '•'
  }
}

function regionFlag(region: string): string {
  if (region === 'United States') return '🇺🇸'
  if (region === 'Canada') return '🇨🇦'
  if (region === 'United Kingdom') return '🇬🇧'
  return '🌐'
}
function regionShort(region: string): string {
  return ({ 'United States': 'us', 'Canada': 'ca', 'United Kingdom': 'uk' }[region]) ?? region.slice(0, 2).toLowerCase()
}
function langShort(lang: string): string {
  return ({ 'English': 'en', 'Spanish': 'es' }[lang]) ?? lang.slice(0, 2).toLowerCase()
}

declare global {
  interface HTMLElementTagNameMap { 'ff-app': FFApp }
}
