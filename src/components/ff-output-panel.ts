import { LitElement, html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'
import './ff-rich-text-editor'

// Ensure tables, task lists, and other GFM features render in Preview.
marked.setOptions({ gfm: true, breaks: false })
import { AUDIENCE_LABELS, TYPE_LABELS, streamMessage, extractCustomTags, restoreCustomTags } from '../lib/api'
import type { Message } from '../lib/api'
import type { ContentStatus } from '../lib/store'
import { isJsonContent, parseJsonContent, parsePartialJsonContent, normalizeUploadedJson, JSON_TYPE_TO_ENTRY_TYPE } from '../lib/contentTypeSchemas'
import type { AnyContent } from '../lib/contentTypeSchemas'
import { validate } from '../lib/validation'
import type { ValidationResult } from '../lib/validation'
import './ff-refinement-input'
import './ff-structured-editor'
import './ff-editable-text'
import './ff-rich-text-editor'

// ── HTML ↔ Markdown helpers ────────────────────────────────────────────────────

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
    case 'div': { const c = children(); if (!c.trim()) return '\n'; return `${c.trim()}\n\n` }
    case 'ul': {
      const items = Array.from(el.children)
        .filter(c => c.tagName.toLowerCase() === 'li')
        .map(li => `- ${Array.from(li.childNodes).map(domToMarkdown).join('').trim()}`)
        .join('\n')
      return items ? `${items}\n\n` : ''
    }
    case 'ol': {
      const items = Array.from(el.children)
        .filter(c => c.tagName.toLowerCase() === 'li')
        .map((li, i) => `${i + 1}. ${Array.from(li.childNodes).map(domToMarkdown).join('').trim()}`)
        .join('\n')
      return items ? `${items}\n\n` : ''
    }
    case 'li': return children()
    case 'strong': case 'b': return `**${children()}**`
    case 'em': case 'i': return `*${children()}*`
    case 'a': { const href = el.getAttribute('href') ?? ''; return `[${children()}](${href})` }
    case 'br': return '\n'
    case 'table': {
      const rows = Array.from(el.querySelectorAll('tr'))
      if (!rows.length) return ''
      const cellText = (cell: Element) => Array.from(cell.childNodes).map(domToMarkdown).join('').replace(/\|/g, '\\|').trim() || ' '
      const lines: string[] = []
      rows.forEach((tr, i) => {
        const cells = Array.from(tr.children).filter(c => /^(td|th)$/i.test(c.tagName))
        if (!cells.length) return
        lines.push(`| ${cells.map(cellText).join(' | ')} |`)
        if (i === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
      })
      return lines.length ? `${lines.join('\n')}\n\n` : ''
    }
    case 'thead': case 'tbody': case 'tr': case 'td': case 'th': return children()
    case 'blockquote': {
      const inner = children().trim()
      if (!inner) return ''
      return inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n'
    }
    case 'hr': return '\n---\n\n'
    default: return children()
  }
}

function htmlToMarkdown(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return Array.from(tmp.childNodes).map(domToMarkdown).join('').trim()
}

// When the AI slips HTML tags (<p>, <strong>, <ul>…) into what is supposed
// to be a markdown body, marked renders them inconsistently — often as
// literal text after the first ## heading. Pre-normalize: if a body looks
// like it contains inline HTML tags, push it through the same DOM →
// markdown converter used for the editor, so downstream renderers only
// ever see clean markdown.
function normalizeBodyHtml(md: string): string {
  if (!md) return md
  // Fast bail: no tag-like patterns present.
  if (!/<\s*\/?\s*[a-zA-Z][a-zA-Z0-9]*[^>]*>/.test(md)) return md
  try {
    return htmlToMarkdown(md)
  } catch {
    return md
  }
}

function renderInlineHtml(text: string) {
  if (!text) return ''
  const normalized = normalizeBodyHtml(text)
  try {
    return unsafeHTML(marked.parseInline(normalized) as string)
  } catch {
    return normalized
  }
}

// Converts a body string (markdown, stray HTML, or already-HTML) into a
// clean HTML string suitable for feeding into <ff-rich-text-editor value=…>
function toRichHtml(text: string): string {
  if (!text) return ''
  const normalized = normalizeBodyHtml(text)
  try { return marked.parse(normalized) as string }
  catch { return normalized }
}

// ── Preview section grouping ──────────────────────────────────────────────────
// Preview splits markdown into visual sections bounded by h2 headings, so each
// section can be edited inline and refined by AI independently.

interface PreviewSection {
  /** Heading text (h2), or null for intro/leading content before any h2. */
  heading: string | null
  /** Full markdown for the section, including its heading line if any. */
  markdown: string
}

function splitPreviewSections(md: string): PreviewSection[] {
  if (!md.trim()) return []
  const lines = md.split('\n')
  const out: PreviewSection[] = []
  let current: PreviewSection = { heading: null, markdown: '' }
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) {
      if (current.markdown.trim()) out.push(current)
      current = { heading: h2[1].trim(), markdown: line + '\n' }
    } else {
      current.markdown += line + '\n'
    }
  }
  if (current.markdown.trim()) out.push(current)
  return out
}

function reassemblePreviewSections(sections: PreviewSection[]): string {
  return sections.map(s => s.markdown.replace(/\s+$/, '')).join('\n\n').trim() + '\n'
}

const PREVIEW_SECTION_AI_ACTIONS: SectionAction[] = [
  { label: 'Improve', prompt: 'Improve this section — clearer wording, tighter structure, stronger flow. Preserve the original meaning, the section heading (if any), and all markdown structure (headings, bullets, numbered lists, tables, bold/italic, links, blockquotes).' },
  { label: 'Rewrite', prompt: 'Rewrite this section with a fresh take — same goal, different angle. Preserve the section heading (if any) and all markdown structure (headings, bullets, numbered lists, tables, bold/italic, links, blockquotes).' },
  { label: 'Shorten', prompt: 'Shorten this section while keeping the core message. Preserve the section heading (if any) and all markdown structure (headings, bullets, numbered lists, tables, bold/italic, links, blockquotes).' },
  { label: 'Make more actionable', prompt: 'Make this section more actionable — clearer next steps, direct advice, practical specifics. Preserve the section heading (if any) and all markdown structure (headings, bullets, numbered lists, tables, bold/italic, links, blockquotes).' },
  { label: 'Refine tone', prompt: 'Refine the tone to be warmer, more human, and more empathetic without being saccharine. Preserve the section heading (if any) and all markdown structure (headings, bullets, numbered lists, tables, bold/italic, links, blockquotes).' },
]

// ── Field model ───────────────────────────────────────────────────────────────

interface ParsedFields {
  title: string
  subheader: string
  body: string
  cta: string
  metadata: string
  alternateTitle: string
}

function trimLines(lines: string[]): string {
  let s = 0
  let e = lines.length - 1
  while (s <= e && !lines[s].trim()) s++
  while (e >= s && !lines[e].trim()) e--
  return s > e ? '' : lines.slice(s, e + 1).join('\n')
}

// Legacy data repair: some older saves of JSON-backed content types
// (Money Tips, Quizzes, etc.) got stored as plain-text with JSON fragments
// appended — the body ends mid-sentence and is followed by things like
// `", "optional_table": null, "closing_section": { ... }, "related_resources": [ ... ]`.
// When we detect those markers we cut the body at the first one so the user
// at least sees clean prose instead of a data-model leak.
const JSON_LEAK_MARKERS = /(?:"optional_table"|"optional_bullet_list"|"closing_section"|"related_resources"|"sections"\s*:\s*\[|"content_type"\s*:)/
function stripJsonLeak(text: string): string {
  const m = text.match(JSON_LEAK_MARKERS)
  if (!m || m.index === undefined) return text
  // Walk back through any stray closing quote/punctuation so we don't leave
  // a dangling `",` on the tail of the clean prose.
  let cut = m.index
  while (cut > 0 && /[",\s]/.test(text[cut - 1])) cut--
  return text.slice(0, cut).trimEnd()
}

function parseOutputFields(output: string): ParsedFields {
  const empty: ParsedFields = { title: '', subheader: '', body: '', cta: '', metadata: '', alternateTitle: '' }
  if (!output.trim()) return empty

  const lines = output.split('\n')
  let title = ''
  let subheader = ''
  let alternateTitle = ''
  const bodyLines: string[] = []
  const ctaLines: string[] = []
  const metaLines: string[] = []

  type Mode = 'pre-title' | 'post-title' | 'body' | 'cta' | 'metadata' | 'alt'
  let mode: Mode = 'pre-title'
  let subheaderDone = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (mode !== 'pre-title' && /^## /.test(trimmed)) {
      const name = trimmed.slice(3).trim()
      if (/^cta$/i.test(name)) { mode = 'cta'; continue }
      if (/^metadata$/i.test(name)) { mode = 'metadata'; continue }
      if (/alt headlines?/i.test(name)) { mode = 'alt'; continue }
      if (/^(intro|body|introduction|meta\s*description)$/i.test(name)) { mode = 'body'; continue }
      mode = 'body'
      bodyLines.push(line)
      continue
    }

    if (mode === 'pre-title') {
      if (/^# /.test(trimmed)) { title = trimmed.slice(2).trim(); mode = 'post-title' }
      continue
    }

    if (mode === 'post-title') {
      if (!trimmed) continue
      if (!subheaderDone) { subheader = trimmed; subheaderDone = true }
      else { mode = 'body'; bodyLines.push(line) }
      continue
    }

    if (mode === 'body') { bodyLines.push(line) }
    else if (mode === 'cta') { if (trimmed || ctaLines.length) ctaLines.push(line) }
    else if (mode === 'metadata') { if (trimmed || metaLines.length) metaLines.push(line) }
    else if (mode === 'alt') {
      if (!alternateTitle && (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\.\s/.test(trimmed))) {
        alternateTitle = trimmed.replace(/^[-*]\s+|^\d+\.\s+/, '')
      }
    }
  }

  // Fallback: if the article never had a `# Title` line (some saved or
  // uploaded content), surface everything as body so the Edit tab still
  // shows the content instead of appearing blank.
  if (mode === 'pre-title' && output.trim()) {
    return { ...empty, body: stripJsonLeak(output.trim()) }
  }

  return {
    title: stripJsonLeak(title),
    subheader: stripJsonLeak(subheader),
    body: normalizeBodyHtml(stripJsonLeak(trimLines(bodyLines))),
    cta: stripJsonLeak(trimLines(ctaLines)),
    metadata: stripJsonLeak(trimLines(metaLines)),
    alternateTitle: stripJsonLeak(alternateTitle),
  }
}

function buildOutput(f: ParsedFields): string {
  const parts: string[] = []
  if (f.title) parts.push(`# ${f.title}`)
  if (f.subheader) { parts.push(''); parts.push(f.subheader) }
  if (f.body) { parts.push(''); parts.push(f.body) }
  if (f.cta) { parts.push(''); parts.push('## CTA'); parts.push(''); parts.push(f.cta) }
  if (f.metadata) { parts.push(''); parts.push('## Metadata'); parts.push(''); parts.push(f.metadata) }
  if (f.alternateTitle) { parts.push(''); parts.push('## Alt Headlines'); parts.push(''); parts.push(`- ${f.alternateTitle}`) }
  return parts.join('\n')
}

// ── Section AI config ─────────────────────────────────────────────────────────

const SECTION_SYSTEM_PROMPT = `You are a content editor for a financial wellness platform. You improve specific sections of financial content pieces. Follow instructions precisely and return only the requested content — no labels, no commentary, no surrounding quotes.

OUTPUT FORMAT: pure markdown only. Do NOT use any HTML tags (no <p>, </p>, <strong>, </strong>, <em>, <ul>, <li>, <br>, etc.). Use **bold** instead of <strong>, *italic* instead of <em>, blank lines between paragraphs instead of <p>…</p>, and - or 1. for lists.

CRITICAL: Preserve all custom HTML tags exactly as written. Never remove, move, or rewrite tags starting with <snippet or ending with -card. If the content contains [PRESERVE_CUSTOM_TAG:N] placeholders, reproduce each one verbatim in its original position — they are protected embed tags that must not be touched.`

interface SectionAction {
  label: string
  prompt: string
  multi?: boolean
}

const UNIVERSAL_SECTION_ACTIONS: SectionAction[] = [
  { label: 'Try again', prompt: 'Rewrite this with a fresh take — same goal, different angle.' },
  { label: 'Make shorter', prompt: 'Make this shorter and more concise while keeping the core message.' },
  { label: 'Make longer', prompt: 'Expand this with more detail, context, and depth.' },
  { label: 'Make warmer', prompt: 'Rewrite with a warmer, more empathetic, human tone.' },
]

const SECTION_EXTRA_ACTIONS: Partial<Record<keyof ParsedFields, SectionAction[]>> = {
  title: [
    { label: '5 alternatives', prompt: 'Write 5 alternative title options as a numbered list (1. through 5.), one per line. Nothing else.', multi: true },
  ],
  body: [
    { label: 'More professional', prompt: 'Rewrite in a more professional, authoritative, expert tone. Preserve markdown structure.' },
    { label: 'Tighten copy', prompt: 'Tighten the copy — cut redundancy, sharpen sentences, improve flow. Preserve all key points and markdown structure.' },
  ],
  cta: [
    { label: 'Stronger CTA', prompt: 'Write 3 stronger, more urgent and compelling versions of this CTA as a numbered list (1. through 3.), one per line. Nothing else.', multi: true },
    { label: 'Softer CTA', prompt: 'Write 3 softer, more helpful, less pushy versions of this CTA as a numbered list (1. through 3.), one per line. Nothing else.', multi: true },
  ],
  alternateTitle: [
    { label: '5 alternatives', prompt: 'Write 5 alternate title options as a numbered list (1. through 5.), one per line. Nothing else.', multi: true },
  ],
}


const QUICK_EDIT_ACTIONS = [
  { label: 'Make shorter', prompt: 'Make the content shorter and more concise while preserving all key points.' },
  { label: 'Make warmer', prompt: 'Rewrite with a warmer, more empathetic and encouraging tone.' },
  { label: 'More professional', prompt: 'Rewrite with a more professional, authoritative, expert tone.' },
  { label: 'Simpler language', prompt: 'Rewrite using simpler, clearer language and avoid jargon.' },
  { label: 'More actionable', prompt: 'Strengthen actionable takeaways and add clear next steps throughout.' },
]

// ── Component ─────────────────────────────────────────────────────────────────

@customElement('ff-output-panel')
export class FFOutputPanel extends LitElement {
  override createRenderRoot() { return this }

  @property() output = ''
  @property({ type: Boolean }) isGenerating = false
  @property() error = ''
  @property() contentType = 'article'
  @property() audience = 'all'
  @property() editingId: string | null = null
  @property({ type: Boolean }) isDirty = false
  @property() status: ContentStatus = 'draft'
  @property() apiKey = ''
  @property() topic = ''
  @property() promptNotes = ''
  @property({ type: Boolean }) canUndo = false
  @property({ type: Boolean }) manualMode = false
  @property() reviewNotes = ''
  @property({ type: Number }) streamCharCount = 0
  @property({ type: Number }) streamElapsedMs = 0

  @state() private _copied = false
  private _copyTimer: ReturnType<typeof setTimeout> | null = null

  // JSON structured editor state — Editor (visual) is the default view
  @state() private _jsonData: AnyContent | null = null
  @state() private _showPreview = true
  @state() private _validationResult: ValidationResult | null = null

  // Markdown (article) view mode — Editor (visual) is the default view
  @state() private _showMarkdownPreview = true
  @state() private _previewFocusedIdx: number | null = null
  @state() private _previewAIMenuIdx: number | null = null
  @state() private _previewAILoadingIdx: number | null = null
  @state() private _previewAIUndo: Record<number, string> = {}
  private _previewAIAbort: AbortController | null = null
  @state() private _showPublishConfirm = false
  // First-use coachmark for the section-AI feature
  @state() private _showSectionCoach = false

  // Section AI state
  @state() private _aiMenuField: keyof ParsedFields | null = null
  @state() private _aiLoadingField: keyof ParsedFields | null = null
  @state() private _aiOptions: { field: keyof ParsedFields; values: string[] } | null = null
  @state() private _aiUndo: Partial<Record<keyof ParsedFields, string>> = {}
  private _aiAbort: AbortController | null = null
  private _onDocMousedown = (e: MouseEvent) => {
    const target = e.target as Node
    if (this._aiMenuField && !this.contains(target)) this._aiMenuField = null
    if (this._bodyTypeMenuOpen && !this.contains(target)) this._bodyTypeMenuOpen = false
    if (this._intLinkOpen && !this.contains(target)) { this._intLinkOpen = false }
    // Close preview-section AI menu when clicking outside its section.
    if (this._previewAIMenuIdx !== null) {
      const menuHost = this.renderRoot.querySelector(`[data-preview-section="${this._previewAIMenuIdx}"]`)
      if (!menuHost || !menuHost.contains(target)) this._previewAIMenuIdx = null
    }
  }

  // Editor field state
  @state() private _title = ''
  @state() private _subheader = ''
  @state() private _body = ''   // stored as markdown
  @state() private _cta = ''
  @state() private _metadata = ''
  @state() private _alternateTitle = ''
  private _lastEmitted = ''
  // When true, imperatively push state → DOM in updated() for simple text
  // fields (title/subheader/cta/metadata/alt). Avoids the controlled-input
  // race that clobbered fast typing with a stale state value.
  private _textFieldsNeedSync = false

  @state() private _editingPublished = false

  // Body rich-text editor state (most toolbar state now lives inside
  // ff-rich-text-editor; kept only what's still consulted elsewhere).
  private _autoMetaPending = false
  @state() private _bodyTypeMenuOpen = false
  private _bodyNeedsSync = false

  // Internal article link state (legacy body popover — still referenced
  // by _intLinkOpen render branches)
  @state() private _intLinkOpen = false
  // (Legacy selection handler — ff-rich-text-editor manages its own selection now.)
  private _onSelectionChange = () => { /* noop */ }

  override connectedCallback() {
    super.connectedCallback()
    document.addEventListener('mousedown', this._onDocMousedown)
    document.addEventListener('selectionchange', this._onSelectionChange)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('mousedown', this._onDocMousedown)
    document.removeEventListener('selectionchange', this._onSelectionChange)
    this._aiAbort?.abort()
    this._previewAIAbort?.abort()
  }

  override willUpdate(changed: PropertyValues) {
    if (changed.has('editingId')) {
      this._editingPublished = false
      // Reset view mode to Editor (visual) when switching entries
      this._showMarkdownPreview = true
      this._showPreview = true
      this._previewAIMenuIdx = null
      this._previewAILoadingIdx = null
      this._previewAIUndo = {}
      this._previewFocusedIdx = null
      this._previewAIAbort?.abort()
    }
    // Previously: flipping to "Blank" forced the Advanced Editor view, which
    // surprised users mid-flow. Now we respect the user's chosen view. The
    // Editor's empty state (below) renders editable blocks directly, so the
    // visual editor is usable even with no content yet.
    // Auto-switch to Editor (visual) whenever generation starts, so users land
    // in the friendly rendered view rather than a technical screen.
    if (changed.has('isGenerating') && this.isGenerating) {
      this._showMarkdownPreview = true
      this._showPreview = true
    }
    const outputChanged = changed.has('output') && this.output !== this._lastEmitted
    const justFinishedGenerating = changed.has('isGenerating') && !this.isGenerating && !!this.output

    // First time the user sees a finished article with >1 section, show the
    // section-AI coachmark so they know about the best feature in the app.
    if (justFinishedGenerating && !this._isJson) {
      try {
        if (!localStorage.getItem('ff_coach_section_ai_v1')) {
          const sections = splitPreviewSections(this.output)
          if (sections.filter(s => s.heading).length >= 1) {
            this._showSectionCoach = true
            this.setAttribute('data-coach', 'on')
          }
        }
      } catch { /* ignore */ }
    }

    // Safety net: any time the user leaves Preview or Raw (toggles into Edit),
    // force the Edit-form fields to mirror the current output. Covers cases
    // where Preview mutations didn't run through _syncFieldsFromOutput for
    // any reason — Edit should never end up blank for an article that has
    // content in Preview.
    const switchedIntoEdit =
      changed.has('_showMarkdownPreview') &&
      !this._showMarkdownPreview &&
      !this._isJson &&
      !!this.output

    if (outputChanged || justFinishedGenerating || switchedIntoEdit) {
      if (isJsonContent(this.output)) {
        // Try strict parse first (works for complete JSON and after streaming).
        let raw = parseJsonContent(this.output)
        // During streaming, fall back to a best-effort partial parser so the
        // structured editor can fill in progressively rather than staying blank.
        if (!raw && this.isGenerating) {
          raw = parsePartialJsonContent(this.output)
        }
        if (raw) {
          const parsed = normalizeUploadedJson(raw)
          this._jsonData = parsed
          // Skip validation while streaming — partial JSON would flag false errors.
          this._validationResult = this.isGenerating ? null : validate(parsed)
          const entryType = JSON_TYPE_TO_ENTRY_TYPE[parsed.content_type] ?? parsed.content_type
          this.dispatchEvent(new CustomEvent('content-type-resolved', { detail: entryType, bubbles: true }))
        } else if (justFinishedGenerating) {
          // Streaming finished but JSON still won't parse — surface a clear error
          // rather than silently leaving the user with a blank screen.
          this._jsonData = null
          this._validationResult = null
          this.dispatchEvent(new CustomEvent('generation-error', {
            detail: 'The model returned invalid or truncated JSON. Try Regenerate.',
            bubbles: true,
          }))
        }
      } else {
        this._jsonData = null
        this._validationResult = null
        const f = parseOutputFields(this.output)
        this._title = f.title
        this._subheader = f.subheader
        this._body = f.body
        this._cta = f.cta
        this._metadata = f.metadata
        this._alternateTitle = f.alternateTitle
        this._bodyNeedsSync = true
        this._textFieldsNeedSync = true
        if (justFinishedGenerating && !f.metadata && f.title) {
          this._autoMetaPending = true
        }
      }
    }
  }

  private get _isJson() {
    return this._jsonData !== null
  }

  // Patch a single article/expert_insight/user_story section body from the
  // rich-text editor inline in Preview. Accepts HTML from ff-rich-text-editor,
  // writes it back into _jsonData, and emits an output change so the draft
  // saves normally.
  private _patchArticleSectionBody(idx: number, html: string) {
    if (!this._jsonData) return
    const data = this._jsonData as unknown as Record<string, unknown>
    const sections = Array.isArray(data.sections) ? (data.sections as Array<Record<string, unknown>>).slice() : []
    if (!sections[idx]) return
    sections[idx] = { ...sections[idx], body: html }
    const next = { ...data, sections } as unknown as AnyContent
    this._onJsonDataChange(new CustomEvent<AnyContent>('json-data-change', { detail: next }))
  }

  private _patchIntroParagraph(html: string) {
    if (!this._jsonData) return
    const data = this._jsonData as unknown as Record<string, unknown>
    const next = { ...data, intro_paragraph: html } as unknown as AnyContent
    this._onJsonDataChange(new CustomEvent<AnyContent>('json-data-change', { detail: next }))
  }

  private _patchUserStoryCopy(html: string) {
    if (!this._jsonData) return
    const data = this._jsonData as unknown as Record<string, unknown>
    const next = { ...data, copy: html } as unknown as AnyContent
    this._onJsonDataChange(new CustomEvent<AnyContent>('json-data-change', { detail: next }))
  }

  private _onJsonDataChange(e: CustomEvent<AnyContent>) {
    const data = e.detail
    this._jsonData = data
    this._validationResult = validate(data)
    const jsonStr = JSON.stringify(data, null, 2)
    this._lastEmitted = jsonStr
    this.dispatchEvent(new CustomEvent('output-change', { detail: jsonStr, bubbles: true }))
  }

  override updated() {
    this.renderRoot.querySelectorAll<HTMLTextAreaElement>('textarea[data-ar]').forEach(ta => {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    })

    if (this._autoMetaPending && this.apiKey && !this._aiLoadingField) {
      this._autoMetaPending = false
      this._runSectionAI('metadata', {
        label: 'Generate',
        prompt: 'Write a compelling SEO meta description (150-160 characters) for this content based on the title, subheader, and body. Return only the meta description text, nothing else.',
      })
    }

    if (this._intLinkOpen) {
      const input = this.renderRoot.querySelector<HTMLInputElement>('[data-int-link-input]')
      if (input && document.activeElement !== input) input.focus()
    }

    if (this._bodyNeedsSync) {
      const editor = this.renderRoot.querySelector<HTMLElement>('[data-body-editor]')
      if (editor) {
        const clean = normalizeBodyHtml(this._body)
        editor.innerHTML = clean ? marked.parse(clean) as string : ''
        this._bodyNeedsSync = false
      }
    }

    // Push external field updates (load/AI/regenerate) into the uncontrolled
    // textareas. Skip any field the user is currently focused in so we never
    // clobber an in-progress edit.
    if (this._textFieldsNeedSync) {
      const active = document.activeElement as HTMLElement | null
      const setIfUnfocused = (field: keyof ParsedFields, value: string) => {
        const el = this.renderRoot.querySelector<HTMLTextAreaElement>(`textarea[data-field="${field}"]`)
        if (!el) return
        if (el === active) return
        if (el.value !== value) {
          el.value = value
          el.style.height = 'auto'
          el.style.height = `${el.scrollHeight}px`
        }
      }
      setIfUnfocused('title', this._title)
      setIfUnfocused('subheader', this._subheader)
      setIfUnfocused('cta', this._cta)
      setIfUnfocused('metadata', this._metadata)
      setIfUnfocused('alternateTitle', this._alternateTitle)
      this._textFieldsNeedSync = false
    }

    // Sync each Preview section's innerHTML — skip the one the user is
    // actively editing so their caret/selection stays put. Normalize any
    // stray HTML to markdown before marked so <p>…</p> never leaks as
    // literal text after a ## heading.
    const sectionEls = this.renderRoot.querySelectorAll<HTMLElement>('[data-preview-section]')
    if (sectionEls.length) {
      const sections = splitPreviewSections(this.output)
      sectionEls.forEach(el => {
        const idx = Number(el.dataset.previewSection)
        if (idx === this._previewFocusedIdx) return
        const md = normalizeBodyHtml(sections[idx]?.markdown ?? '')
        el.innerHTML = md ? marked.parse(md) as string : ''
      })
    }
  }

  private get _outputLocked() {
    if (this._editingPublished) return false
    return this.status === 'approved' || this.status === 'published'
  }

  private get _fullyLocked() {
    if (this._editingPublished) return false
    return this.status === 'published'
  }

  private _fieldChange(field: keyof ParsedFields, value: string) {
    if (field === 'title') this._title = value
    else if (field === 'subheader') this._subheader = value
    else if (field === 'body') this._body = value
    else if (field === 'cta') this._cta = value
    else if (field === 'metadata') this._metadata = value
    else this._alternateTitle = value

    const md = buildOutput({
      title: this._title,
      subheader: this._subheader,
      body: this._body,
      cta: this._cta,
      metadata: this._metadata,
      alternateTitle: this._alternateTitle,
    })
    this._lastEmitted = md
    this.dispatchEvent(new CustomEvent('output-change', { detail: md, bubbles: true }))
  }

  // ── Section AI helpers ────────────────────────────────────────────────────────

  private _getFieldValue(field: keyof ParsedFields): string {
    if (field === 'title') return this._title
    if (field === 'subheader') return this._subheader
    if (field === 'body') return this._body
    if (field === 'cta') return this._cta
    if (field === 'metadata') return this._metadata
    return this._alternateTitle
  }

  private _applyFieldValue(field: keyof ParsedFields, value: string) {
    if (field === 'title') this._title = value
    else if (field === 'subheader') this._subheader = value
    else if (field === 'body') { this._body = value; this._bodyNeedsSync = true }
    else if (field === 'cta') this._cta = value
    else if (field === 'metadata') this._metadata = value
    else this._alternateTitle = value
  }

  private _emitOutput() {
    const md = buildOutput({
      title: this._title, subheader: this._subheader, body: this._body,
      cta: this._cta, metadata: this._metadata, alternateTitle: this._alternateTitle,
    })
    this._lastEmitted = md
    this.dispatchEvent(new CustomEvent('output-change', { detail: md, bubbles: true }))
  }

  private _parseOptions(text: string): string[] {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => l.replace(/^\d+[.)]\s+/, '').replace(/^[-*]\s+/, '').trim())
      .filter(l => l.length > 3)
      .slice(0, 6)
  }

  private _buildSectionMessage(field: keyof ParsedFields, action: SectionAction, valueOverride?: string): string {
    const audienceLabel = AUDIENCE_LABELS[this.audience] ?? this.audience
    const typeLabel = TYPE_LABELS[this.contentType] ?? this.contentType
    const ctx = [
      `Content type: ${typeLabel}`,
      `Audience: ${audienceLabel}`,
      this.topic ? `Topic: ${this.topic}` : '',
      this.promptNotes ? `Notes: ${this.promptNotes}` : '',
    ].filter(Boolean).join('\n')
    const value = valueOverride ?? this._getFieldValue(field)
    return `${ctx}\n\nCurrent ${field === 'alternateTitle' ? 'alternate title' : field}:\n${value}\n\n${action.prompt}`
  }

  private async _runSectionAI(field: keyof ParsedFields, action: SectionAction) {
    if (!this.apiKey) return
    const prevValue = this._getFieldValue(field)

    // For the body field, extract custom tags before sending to AI so they
    // are not accidentally removed or rewritten during refinement.
    let messageValue = prevValue
    let savedTags: string[] = []
    if (field === 'body' && prevValue) {
      const extracted = extractCustomTags(prevValue)
      messageValue = extracted.sanitized
      savedTags = extracted.tags
    }

    this._aiMenuField = null
    this._aiLoadingField = field
    this._aiOptions = null
    if (!action.multi) this._aiUndo = { ...this._aiUndo, [field]: prevValue }

    this._aiAbort?.abort()
    const controller = new AbortController()
    this._aiAbort = controller
    let accumulated = ''

    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: this._buildSectionMessage(field, action, messageValue) }] as Message[],
        SECTION_SYSTEM_PROMPT,
        (chunk) => {
          accumulated += chunk
          if (!action.multi) this._applyFieldValue(field, accumulated)
        },
        controller.signal,
      )
      if (action.multi) {
        const opts = this._parseOptions(accumulated)
        if (opts.length > 0) this._aiOptions = { field, values: opts }
      } else {
        let final = accumulated.trim()
        if (savedTags.length > 0) final = restoreCustomTags(final, savedTags)
        // Belt-and-suspenders: if the model slipped in raw HTML despite the
        // prompt, strip it back to clean markdown before committing.
        if (field === 'body') final = normalizeBodyHtml(final)
        if (final) { this._applyFieldValue(field, final); this._emitOutput() }
        else {
          this._applyFieldValue(field, prevValue)
          const upd = { ...this._aiUndo }; delete (upd as Record<string, string>)[field]; this._aiUndo = upd
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this._applyFieldValue(field, prevValue)
        const upd = { ...this._aiUndo }; delete (upd as Record<string, string>)[field]; this._aiUndo = upd
        this._emitOutput()
      }
    } finally {
      this._aiLoadingField = null
    }
  }

  private _selectOption(field: keyof ParsedFields, value: string) {
    this._aiUndo = { ...this._aiUndo, [field]: this._getFieldValue(field) }
    this._applyFieldValue(field, value)
    this._emitOutput()
    this._aiOptions = null
  }

  private _undoField(field: keyof ParsedFields) {
    const prev = this._aiUndo[field]
    if (prev !== undefined) {
      this._applyFieldValue(field, prev)
      this._emitOutput()
      const upd = { ...this._aiUndo }; delete (upd as Record<string, string>)[field]; this._aiUndo = upd
    }
  }

  private _renderSectionControls(field: keyof ParsedFields) {
    const isLoading = this._aiLoadingField === field
    const hasUndo = field in this._aiUndo
    const menuOpen = this._aiMenuField === field
    const extras = SECTION_EXTRA_ACTIONS[field] ?? []

    return html`
      <div class="relative flex items-center gap-2">
        ${isLoading ? html`
          <span class="text-[11px] text-[#063853] animate-pulse select-none">Updating…</span>
        ` : html`
          ${hasUndo ? html`
            <button @click=${() => this._undoField(field)}
              class="flex items-center gap-1 text-[11px] text-gray-400 hover:text-[#063853] transition-colors"
              title="Revert to previous">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M2 4.5H7a2.5 2.5 0 010 5H5M2 4.5L4 2M2 4.5L4 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Revert
            </button>
          ` : ''}
          <button
            @click=${(e: Event) => { e.stopPropagation(); this._aiMenuField = menuOpen ? null : field }}
            class="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md font-medium transition-all ${menuOpen
              ? 'bg-gradient-to-r from-violet-600 to-indigo-700 text-white shadow-md'
              : 'bg-gradient-to-r from-violet-500 to-indigo-600 text-white shadow-sm hover:from-violet-600 hover:to-indigo-700 hover:shadow-md'}"
            title="AI actions"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 1L7.12 4.88L11 6L7.12 7.12L6 11L4.88 7.12L1 6L4.88 4.88L6 1Z"/>
            </svg>
            <span>AI</span>
          </button>
          ${menuOpen ? html`
            <div class="absolute right-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-100 py-1 min-w-[170px]">
              ${UNIVERSAL_SECTION_ACTIONS.map(action => html`
                <button
                  @click=${() => this._runSectionAI(field, action)}
                  class="w-full text-left px-3.5 py-2 text-[12px] text-[#383838] hover:bg-gray-50 hover:text-[#063853] transition-colors"
                >${action.label}</button>
              `)}
              ${extras.length ? html`
                <div class="my-1 border-t border-gray-100"></div>
                ${extras.map(action => html`
                  <button
                    @click=${() => this._runSectionAI(field, action)}
                    class="flex items-center justify-between w-full text-left px-3.5 py-2 text-[12px] text-[#383838] hover:bg-gray-50 hover:text-[#063853] transition-colors"
                  >
                    <span>${action.label}</span>
                    ${action.multi ? html`<span class="text-[10px] text-gray-300 ml-3">options</span>` : ''}
                  </button>
                `)}
              ` : ''}
            </div>
          ` : ''}
        `}
      </div>
    `
  }

  private _renderOptionsPanel(field: keyof ParsedFields, values: string[]) {
    return html`
      <div class="mt-3 rounded-lg border border-[#063853]/[0.12] bg-[#063853]/[0.025] p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-semibold uppercase tracking-widest text-[#063853]/60">Suggestions — pick one</span>
          <button @click=${() => { this._aiOptions = null }}
            class="text-[11px] text-gray-400 hover:text-gray-600 transition-colors">Dismiss</button>
        </div>
        <div class="flex flex-col gap-1">
          ${values.map((v, i) => html`
            <button
              @click=${() => this._selectOption(field, v)}
              class="text-left text-[12px] px-3 py-2 rounded-md bg-white border border-gray-100 hover:border-[#063853]/25 hover:bg-[#063853]/[0.03] text-[#2a2a2a] transition-all leading-snug"
            >
              <span class="text-[10px] text-gray-400 mr-1.5">${i + 1}.</span>${v}
            </button>
          `)}
        </div>
      </div>
    `
  }


  // Commit a rich-text editor save into the stored body. HTML → markdown so
  // the draft stays consistent with the rest of the markdown pipeline.
  private _onBodyHtmlChange(htmlValue: string) {
    const md = htmlToMarkdown(htmlValue)
    this._body = md
    this._bodyNeedsSync = false
    const out = buildOutput({
      title: this._title, subheader: this._subheader, body: md,
      cta: this._cta, metadata: this._metadata, alternateTitle: this._alternateTitle,
    })
    this._lastEmitted = out
    this.dispatchEvent(new CustomEvent('output-change', { detail: out, bubbles: true }))
  }



  private _renderJsonPreview() {
    const d = this._jsonData!
    const ct = d.content_type

    if (ct === 'article' || ct === 'expert_insight' || ct === 'user_story') {
      const a = (d as unknown) as Record<string, unknown>
      // Simple planner-id → name lookup for expert_insight preview
      const plannerName = (id: string): string => {
        try {
          const mod = (window as unknown as { __ff_planners?: Array<{id: string; name: string}> }).__ff_planners
          return mod?.find(p => p.id === id)?.name ?? ''
        } catch { return '' }
      }
      return html`
        <div class="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div class="px-8 py-7">
            <p class="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">${ct.replace('_', ' ')}</p>
            <h1 class="text-[28px] font-bold text-[#1a1a1a] leading-tight mb-3">${a['title'] as string}</h1>
            ${(a['subtitle'] || a['read_time']) ? html`<p class="text-[16px] text-gray-500 mb-4">${a['subtitle'] ?? `${a['read_time']} read`}</p>` : ''}
            ${a['intro_paragraph'] ? html`
              <div class="mb-5">
                <ff-rich-text-editor
                  .value=${toRichHtml(a['intro_paragraph'] as string)}
                  .editable=${!this._outputLocked}
                  placeholder="Intro paragraph…"
                  displayClass="text-[15px] leading-relaxed text-[#2a2a2a]"
                  @text-change=${(e: CustomEvent<string>) => this._patchIntroParagraph(e.detail)}
                ></ff-rich-text-editor>
              </div>
            ` : ''}
            ${ct === 'article' && Array.isArray(a['sections']) ? (a['sections'] as Array<{heading: string; body: string; optional_bullet_list?: string[]}>).map((s, i) => html`
              <h2 class="text-[18px] font-bold text-[#1a1a1a] mt-6 mb-2">${s.heading}</h2>
              <div class="ff-article-body mb-3">
                <ff-rich-text-editor
                  .value=${toRichHtml(s.body)}
                  .editable=${!this._outputLocked}
                  placeholder="Section body…"
                  displayClass="text-[15px] leading-relaxed text-[#2a2a2a]"
                  @text-change=${(e: CustomEvent<string>) => this._patchArticleSectionBody(i, e.detail)}
                ></ff-rich-text-editor>
              </div>
              ${s.optional_bullet_list?.length ? html`<ul class="list-disc pl-5 text-[14px] text-[#2a2a2a] space-y-1 mb-3">${s.optional_bullet_list.map(it => html`<li>${renderInlineHtml(it)}</li>`)}</ul>` : ''}
            `) : ''}
            ${ct === 'expert_insight' && Array.isArray(a['sections']) ? (a['sections'] as Array<{plannerId: string; body: string}>).map((s, i) => html`
              <div class="border-l-2 border-[#063853] pl-4 mt-5">
                ${plannerName(s.plannerId) ? html`<p class="text-[12px] font-semibold text-[#063853]">${plannerName(s.plannerId)}</p>` : ''}
                <div class="ff-article-body mt-1">
                  <ff-rich-text-editor
                    .value=${toRichHtml(s.body)}
                    .editable=${!this._outputLocked}
                    placeholder="Insight body…"
                    displayClass="text-[14px] leading-relaxed text-[#2a2a2a]"
                    @text-change=${(e: CustomEvent<string>) => this._patchArticleSectionBody(i, e.detail)}
                  ></ff-rich-text-editor>
                </div>
              </div>
            `) : ''}
            ${ct === 'user_story' && typeof a['copy'] === 'string' ? html`
              <div class="ff-article-body">
                <ff-rich-text-editor
                  .value=${toRichHtml(a['copy'] as string)}
                  .editable=${!this._outputLocked}
                  placeholder="Story copy…"
                  displayClass="text-[15px] leading-relaxed text-[#2a2a2a]"
                  @text-change=${(e: CustomEvent<string>) => this._patchUserStoryCopy(e.detail)}
                ></ff-rich-text-editor>
              </div>
            ` : ''}
          </div>
        </div>
      `
    }

    if (ct === 'money_tip') {
      const m = d as unknown as { title?: string; sections?: Array<{ preheading: string | null; heading: string | null; body: string | null }> }
      const slides = m.sections ?? []
      const patchSlide = (i: number, patch: Partial<{ preheading: string | null; heading: string | null; body: string | null }>) => {
        const next = { ...(d as object), sections: slides.map((s, j) => j === i ? { ...s, ...patch } : s) } as AnyContent
        this._onJsonDataChange(new CustomEvent<AnyContent>('json-data-change', { detail: next }))
      }
      return html`
        <div class="flex flex-col gap-3">
          <p class="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Money tip carousel — ${slides.length} slide${slides.length === 1 ? '' : 's'}</p>
          <div class="flex flex-col gap-3">
            ${slides.map((slide, i) => html`
              <div class="rounded-xl bg-white border border-gray-200 px-6 py-5 relative">
                <span class="absolute top-3 right-4 text-[10px] font-semibold text-gray-400">Slide ${i + 1} of ${slides.length}</span>
                <ff-editable-text
                  .value=${slide.preheading ?? ''}
                  displayClass="block text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1"
                  placeholder="Preheading (optional)…"
                  @text-change=${(e: CustomEvent<string>) => { e.stopPropagation(); patchSlide(i, { preheading: e.detail || null }) }}
                ></ff-editable-text>
                <ff-rich-text-editor
                  .value=${slide.heading ?? ''}
                  displayClass="block text-[18px] font-bold text-[#1a1a1a] leading-snug mb-2"
                  placeholder="Slide heading…"
                  @text-change=${(e: CustomEvent<string>) => { e.stopPropagation(); patchSlide(i, { heading: e.detail || null }) }}
                ></ff-rich-text-editor>
                <ff-rich-text-editor
                  .value=${slide.body ?? ''}
                  displayClass="block text-[14px] leading-relaxed text-[#2a2a2a]"
                  placeholder="Slide body…"
                  @text-change=${(e: CustomEvent<string>) => { e.stopPropagation(); patchSlide(i, { body: e.detail || null }) }}
                ></ff-rich-text-editor>
              </div>
            `)}
          </div>
        </div>
      `
    }

    if (ct === 'checklist') {
      const c = (d as unknown) as Record<string, unknown>
      const sections = (c['sections'] as Array<Record<string, unknown>>) ?? []
      return html`
        <div class="border border-gray-200 rounded-xl overflow-hidden bg-white px-8 py-7">
          <h1 class="text-[26px] font-bold text-[#1a1a1a] mb-3">${c['title'] as string}</h1>
          ${c['intro_paragraph'] ? html`<p class="text-[14px] text-gray-500 mb-6">${c['intro_paragraph'] as string}</p>` : ''}
          ${sections.map(s => html`
            <div class="mb-6">
              <h2 class="text-[16px] font-bold text-[#1a1a1a] mb-1">${s['title'] as string}</h2>
              ${s['description'] ? html`<p class="text-[13px] text-gray-500 mb-3" .innerHTML=${s['description'] as string}></p>` : ''}
              ${((s['items'] ?? []) as Array<Record<string, unknown>>).map(item => html`
                <div class="flex items-start gap-3 py-2 border-b border-gray-100">
                  <span class="text-gray-300 mt-0.5">☐</span>
                  <span class="text-[14px] text-[#2a2a2a]" .innerHTML=${item['label'] as string}></span>
                </div>
              `)}
              ${s['tip'] ? html`
                <div class="mt-3 rounded-lg bg-[#f0f7f9] border border-[#cfe3ea] px-4 py-3">
                  ${(s['tip'] as Record<string, unknown>)['title'] ? html`<p class="text-[12px] font-bold text-[#063853] mb-1">${(s['tip'] as Record<string, unknown>)['title'] as string}</p>` : ''}
                  ${(s['tip'] as Record<string, unknown>)['description'] ? html`<p class="text-[13px] text-[#063853]" .innerHTML=${(s['tip'] as Record<string, unknown>)['description'] as string}></p>` : ''}
                </div>
              ` : ''}
            </div>
          `)}
        </div>
      `
    }

    if (ct === 'quiz') {
      const q = (d as unknown) as Record<string, unknown>
      const questions = (q['questions'] as Array<Record<string, unknown>>) ?? []
      const criteria = ((q['rubric'] as Record<string, unknown>)?.['criteria'] as Array<Record<string, unknown>>) ?? []
      return html`
        <div class="border border-gray-200 rounded-xl overflow-hidden bg-white px-8 py-7">
          <h1 class="text-[26px] font-bold text-[#1a1a1a] mb-2">${q['title'] as string}</h1>
          ${q['intro_paragraph'] ? html`<p class="text-[14px] text-gray-500 mb-6">${q['intro_paragraph'] as string}</p>` : ''}
          ${questions.map((question, i) => html`
            <div class="mb-6 pb-6 border-b border-gray-100">
              <p class="text-[11px] font-semibold text-gray-400 mb-2">Question ${i + 1} of ${questions.length}</p>
              <p class="text-[15px] font-medium text-[#1a1a1a] mb-3">${question['questionText'] as string}</p>
              ${((question['answers'] ?? []) as Array<Record<string, unknown>>).map((opt, j) => html`
                <div class="flex items-center gap-3 py-2 px-3 rounded-lg border border-gray-200 mb-2 hover:border-[#063853] cursor-pointer">
                  <span class="text-[12px] font-bold text-gray-400 w-4 shrink-0">${String.fromCharCode(65 + j)}</span>
                  <span class="text-[14px] text-[#2a2a2a] flex-1">${opt['answerText'] as string}</span>
                  ${opt['isCorrect'] === true ? html`<span class="text-[11px] font-semibold text-emerald-600">✓</span>` : ''}
                  ${typeof opt['pointValue'] === 'number' ? html`<span class="text-[11px] text-gray-400">${opt['pointValue']} pts</span>` : ''}
                </div>
              `)}
            </div>
          `)}
          ${criteria.length ? html`
            <div class="mt-4">
              <h3 class="text-[12px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Results</h3>
              ${criteria.map(cr => html`
                <div class="mb-3 pb-3 border-b border-gray-100">
                  <p class="text-[13px] font-semibold text-[#1a1a1a] mb-0.5">${cr['label'] as string}${cr['typeOption'] ? html` <span class="text-[11px] text-gray-400">· ${cr['typeOption']}</span>` : ''}</p>
                  ${cr['resultText'] ? html`<p class="text-[13px] text-gray-600 leading-relaxed">${cr['resultText'] as string}</p>` : ''}
                  ${cr['nextMove'] ? html`<p class="text-[12px] text-[#063853] mt-1"><strong>Next:</strong> ${cr['nextMove'] as string}</p>` : ''}
                </div>
              `)}
            </div>
          ` : ''}
        </div>
      `
    }

    if (ct === 'infographic') {
      const inf = (d as unknown) as Record<string, unknown>
      const img = inf['infographic_image'] as string
      const thumb = inf['thumbnail_image'] as string
      return html`
        <div class="flex flex-col gap-3">
          <div class="rounded-2xl overflow-hidden bg-gray-50 border border-gray-200 flex items-center justify-center" style="min-height:240px">
            ${img ? html`<img src=${img} alt="Infographic" class="w-full h-auto" />` : html`
              <div class="flex flex-col items-center gap-2 text-gray-400 py-10">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><path d="M4 17l5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="1.5"/></svg>
                <p class="text-[13px]">Infographic image not set</p>
              </div>
            `}
          </div>
          ${thumb ? html`<p class="text-[11px] text-gray-400">Thumbnail: ${thumb}</p>` : ''}
        </div>
      `
    }

    if (ct === 'video') {
      const v = (d as unknown) as Record<string, unknown>
      const ref = v['reference_link'] as string
      return html`
        <div class="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div class="aspect-video bg-gray-100 flex items-center justify-center">
            ${ref ? html`<iframe src=${ref} class="w-full h-full" allowfullscreen></iframe>` : html`
              <div class="flex flex-col items-center gap-3 text-gray-400">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="currentColor" stroke-width="1.5"/><polygon points="16,13 30,20 16,27" fill="currentColor"/></svg>
                <p class="text-[13px]">Video reference not set</p>
              </div>
            `}
          </div>
          <div class="px-6 py-5">
            <h2 class="text-[20px] font-bold text-[#1a1a1a] mb-2">${v['title'] as string}</h2>
            ${v['copy'] ? html`<div class="text-[14px] text-gray-500 leading-relaxed" .innerHTML=${v['copy'] as string}></div>` : ''}
          </div>
        </div>
      `
    }

    if (ct === 'calculator') {
      const c = (d as unknown) as Record<string, unknown>
      return html`
        <div class="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div class="px-8 py-7 border-b border-gray-100">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 rounded-lg bg-[#f0f7f9] flex items-center justify-center text-[#063853]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3M8 19h3M13 19h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </div>
              <h1 class="text-[22px] font-bold text-[#1a1a1a]">${c['title'] as string}</h1>
            </div>
          </div>
          <div class="px-8 py-6">
            ${c['copy'] ? html`<div class="text-[14px] leading-relaxed text-[#2a2a2a]" .innerHTML=${c['copy'] as string}></div>` : ''}
            ${c['reference_link'] ? html`<p class="text-[12px] text-gray-400 mt-4">Link: ${c['reference_link'] as string}</p>` : ''}
          </div>
        </div>
      `
    }

    return html`<div class="text-[13px] text-gray-400 italic">Preview not available for this content type.</div>`
  }

  private get _hasContent() { return this.output.length > 0 }

  private get _wordCount() {
    return this.output.trim() ? this.output.trim().split(/\s+/).filter(Boolean).length : 0
  }

  private _copy() {
    if (!this.output) return
    navigator.clipboard.writeText(this.output).then(() => {
      this._copied = true
      if (this._copyTimer) clearTimeout(this._copyTimer)
      this._copyTimer = setTimeout(() => { this._copied = false }, 2000)
    })
  }

  private _fire(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }))
  }

  private _renderStatusBanner() {
    if (this.status === 'in_review') {
      const notes = this.reviewNotes?.trim()
      return html`
        <div class="shrink-0 px-8 py-2 bg-amber-50 border-b border-amber-100">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="shrink-0 text-amber-700">
                <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/>
                <path d="M7 4v3.5M7 9.5v0.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
              <span class="text-[12px] text-amber-800 font-semibold">In review</span>
              ${notes ? html`
                <span class="text-[12px] text-amber-800 truncate" title=${notes}>— ${notes}</span>
              ` : html`
                <span class="text-[12px] text-amber-700">— edits still allowed</span>
              `}
            </div>
          </div>
        </div>
      `
    }
    if (this.status === 'approved') {
      return html`
        <div class="shrink-0 px-8 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
          <span class="text-[12px] text-blue-800 font-medium">Approved — unlock to edit content</span>
          <button
            @click=${() => this._fire('status-change', 'in_review')}
            class="text-[12px] font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 px-3 py-1 rounded-md transition-colors"
          >Unlock to edit</button>
        </div>
      `
    }
    if (this.status === 'published') {
      if (this._editingPublished) {
        return html`
          <div class="shrink-0 px-8 py-2 border-b flex items-center justify-between ${
            this.isDirty ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'
          }">
            <div class="flex items-center gap-2">
              ${this.isDirty ? html`
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
                <span class="text-[12px] text-amber-800 font-medium">Unpublished changes</span>
              ` : html`
                <span class="text-[12px] text-emerald-800 font-medium">Editing published content</span>
              `}
            </div>
            <div class="flex items-center gap-2">
              ${this.isDirty ? html`
                <button
                  @click=${() => { this._fire('save'); this._editingPublished = false }}
                  class="text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded-md transition-colors"
                >Publish changes</button>
              ` : ''}
              <button
                @click=${() => { this._editingPublished = false }}
                class="text-[12px] font-medium transition-colors ${
                  this.isDirty ? 'text-amber-600 hover:text-amber-800' : 'text-emerald-700 hover:text-emerald-900'
                }"
              >Done editing</button>
            </div>
          </div>
        `
      }
      return html`
        <div class="shrink-0 px-8 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
          <span class="text-[12px] text-emerald-800 font-medium">Published</span>
          <div class="flex items-center gap-2">
            <button
              @click=${() => { this._editingPublished = true }}
              class="text-[12px] font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-3 py-1 rounded-md transition-colors"
            >Edit</button>
            <button
              @click=${() => this._fire('status-change', 'approved')}
              class="text-[12px] font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
            >Unpublish</button>
          </div>
        </div>
      `
    }
    return ''
  }

  private _onSectionInput(idx: number, e: Event) {
    const el = e.target as HTMLElement
    const sections = splitPreviewSections(this.output)
    if (!sections[idx]) return
    const newSectionMd = htmlToMarkdown(el.innerHTML)
    sections[idx] = { ...sections[idx], markdown: newSectionMd }
    const md = reassemblePreviewSections(sections)
    this._lastEmitted = md
    // Keep Edit-tab fields in sync so switching tabs after a Preview edit
    // shows the latest content instead of the pre-edit state.
    this._syncFieldsFromOutput(md)
    this.dispatchEvent(new CustomEvent('output-change', { detail: md, bubbles: true }))
  }

  /**
   * Mirror `this.output` into the Edit-form field state. Called whenever
   * Preview changes the output so the Edit tab stays current even though
   * `_lastEmitted` is suppressing willUpdate's re-parse.
   */
  private _syncFieldsFromOutput(md: string) {
    if (this._isJson) return
    const f = parseOutputFields(md)
    this._title = f.title
    this._subheader = f.subheader
    this._body = f.body
    this._cta = f.cta
    this._metadata = f.metadata
    this._alternateTitle = f.alternateTitle
    this._bodyNeedsSync = true
  }

  private _buildPreviewSectionMessage(section: PreviewSection, action: SectionAction): string {
    const audienceLabel = AUDIENCE_LABELS[this.audience] ?? this.audience
    const typeLabel = TYPE_LABELS[this.contentType] ?? this.contentType
    const ctx = [
      `Content type: ${typeLabel}`,
      `Audience: ${audienceLabel}`,
      this.topic ? `Topic: ${this.topic}` : '',
      this.promptNotes ? `Notes: ${this.promptNotes}` : '',
      section.heading ? `Section heading: ${section.heading}` : 'Section: (intro, no heading)',
    ].filter(Boolean).join('\n')
    return `${ctx}\n\nCurrent section markdown:\n${section.markdown.trim()}\n\n${action.prompt}`
  }

  private async _runPreviewSectionAI(idx: number, action: SectionAction) {
    if (!this.apiKey) return
    const sections = splitPreviewSections(this.output)
    const section = sections[idx]
    if (!section) return

    // Sanitize custom tags so the model can't rewrite them.
    const { sanitized, tags } = extractCustomTags(section.markdown)

    this._previewAIMenuIdx = null
    this._previewAILoadingIdx = idx
    this._previewAIUndo = { ...this._previewAIUndo, [idx]: section.markdown }

    this._previewAIAbort?.abort()
    const controller = new AbortController()
    this._previewAIAbort = controller

    let accumulated = ''
    const applyStreaming = (chunk: string) => {
      accumulated += chunk
      const current = splitPreviewSections(this.output)
      if (!current[idx]) return
      current[idx] = { ...current[idx], markdown: accumulated }
      const md = reassemblePreviewSections(current)
      this._lastEmitted = md
      this._syncFieldsFromOutput(md)
      this.dispatchEvent(new CustomEvent('output-change', { detail: md, bubbles: true }))
    }

    try {
      await streamMessage(
        this.apiKey,
        [{ role: 'user', content: this._buildPreviewSectionMessage({ ...section, markdown: sanitized }, action) }] as Message[],
        SECTION_SYSTEM_PROMPT,
        applyStreaming,
        controller.signal,
      )
      let final = accumulated.trim()
      if (!final) {
        // Empty response — revert.
        this._revertPreviewSection(idx)
        return
      }
      if (tags.length) final = restoreCustomTags(final, tags)
      const current = splitPreviewSections(this.output)
      if (current[idx]) {
        current[idx] = { ...current[idx], markdown: final + '\n' }
        const md = reassemblePreviewSections(current)
        this._lastEmitted = md
        this._syncFieldsFromOutput(md)
        this.dispatchEvent(new CustomEvent('output-change', { detail: md, bubbles: true }))
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this._revertPreviewSection(idx)
      }
    } finally {
      this._previewAILoadingIdx = null
    }
  }

  private _revertPreviewSection(idx: number) {
    const prev = this._previewAIUndo[idx]
    if (prev === undefined) return
    const current = splitPreviewSections(this.output)
    if (!current[idx]) return
    current[idx] = { ...current[idx], markdown: prev }
    const md = reassemblePreviewSections(current)
    this._lastEmitted = md
    this._syncFieldsFromOutput(md)
    this.dispatchEvent(new CustomEvent('output-change', { detail: md, bubbles: true }))
    const upd = { ...this._previewAIUndo }
    delete upd[idx]
    this._previewAIUndo = upd
  }

  private _renderMarkdownPreview() {
    const editable = !this.isGenerating && !this._outputLocked
    const sections = splitPreviewSections(this.output)
    return html`
      <div class="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <style>
          .ff-prose h1 { font-size: 1.75rem; font-weight: 700; margin: 0 0 0.75rem; color: #1a1a1a; line-height: 1.2; }
          .ff-prose h2 { font-size: 1.2rem; font-weight: 700; margin: 1.75rem 0 0.5rem; color: #1a1a1a; }
          .ff-prose h3 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.35rem; color: #2a2a2a; }
          .ff-prose p { font-size: 0.9375rem; line-height: 1.75; margin: 0 0 0.875rem; color: #2a2a2a; }
          .ff-prose ul, .ff-prose ol { padding-left: 1.5em; margin: 0.5rem 0 1rem; }
          .ff-prose li { margin: 0.3rem 0; font-size: 0.9375rem; line-height: 1.65; color: #2a2a2a; }
          .ff-prose strong, .ff-prose b { font-weight: 600; }
          .ff-prose em, .ff-prose i { font-style: italic; }
          .ff-prose a { color: #063853; text-decoration: underline; }
          .ff-prose blockquote { border-left: 3px solid #063853; padding-left: 1rem; color: #555; font-style: italic; margin: 1rem 0; }
          .ff-prose hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
          .ff-prose table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9375rem; }
          .ff-prose th, .ff-prose td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
          .ff-prose thead th { background: #f9fafb; font-weight: 600; color: #1a1a1a; }
          .ff-preview-editable:focus { outline: none; }
          .ff-preview-editable[contenteditable="true"]:hover { cursor: text; }
          .ff-section-group { position: relative; }
          .ff-section-group + .ff-section-group { border-top: 1px solid #f3f4f6; }
          .ff-section-ai-btn {
            position: absolute; top: 0.75rem; right: 0.75rem;
            display: inline-flex; align-items: center; gap: 0.25rem;
            font-size: 11px; font-weight: 600; color: #9ca3af;
            padding: 0.25rem 0.5rem; border-radius: 0.375rem;
            background: rgba(255,255,255,0.9); border: 1px solid #e5e7eb;
            opacity: 0.55; transition: opacity 120ms, color 120ms, border-color 120ms, background 120ms;
            cursor: pointer; z-index: 3;
          }
          .ff-section-group:hover .ff-section-ai-btn,
          .ff-section-group:focus-within .ff-section-ai-btn,
          .ff-section-ai-btn[data-open="true"] { opacity: 1; color: #063853; border-color: #063853; }
          .ff-section-ai-btn:hover { color: #063853; border-color: #063853; background: #fff; }
          /* First-use pulse — only applies if the coachmark hasn't been dismissed.
             Host element toggles data-coach="on" which triggers the animation. */
          ff-output-panel[data-coach="on"] .ff-section-ai-btn { animation: ff-coach-pulse 1.6s ease-in-out 3; }
          @keyframes ff-coach-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(6,56,83,0.35); }
            50%      { box-shadow: 0 0 0 6px rgba(6,56,83,0); }
          }
          .ff-section-ai-menu {
            position: absolute; top: 2.5rem; right: 0.75rem; z-index: 4;
            min-width: 200px; background: #1a1a1a; color: #fff;
            border-radius: 0.5rem; padding: 0.375rem; box-shadow: 0 10px 25px rgba(0,0,0,0.15);
          }
          .ff-section-ai-menu button {
            display: block; width: 100%; text-align: left;
            font-size: 12px; padding: 0.4rem 0.6rem; border-radius: 0.35rem;
            color: #e5e7eb; background: transparent; border: none; cursor: pointer;
          }
          .ff-section-ai-menu button:hover { background: rgba(255,255,255,0.1); color: #fff; }
          .ff-section-loading {
            position: absolute; inset: 0; background: rgba(255,255,255,0.55);
            display: flex; align-items: flex-start; justify-content: flex-end;
            padding: 0.75rem; pointer-events: none; z-index: 2;
          }
          .ff-section-loading span {
            font-size: 11px; color: #063853; font-weight: 600;
            background: #fff; border: 1px solid #cfe3ea; border-radius: 0.375rem;
            padding: 0.25rem 0.5rem;
          }
          .ff-section-undo {
            position: absolute; bottom: 0.5rem; right: 0.75rem; z-index: 3;
            font-size: 11px; color: #6b7280; padding: 0.2rem 0.45rem;
            border-radius: 0.35rem; background: rgba(255,255,255,0.9);
            border: 1px solid #e5e7eb; cursor: pointer;
          }
          .ff-section-undo:hover { color: #063853; border-color: #063853; }
        </style>
        ${sections.length === 0 ? html`
          <!-- Blank-state editor: friendly inline fields so the user can
               start writing immediately without switching to Advanced. -->
          <div class="px-10 py-10 flex flex-col gap-5">
            <div>
              <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1.5">Title</p>
              <input
                type="text"
                placeholder="What's this piece called?"
                class="w-full text-[26px] font-bold text-[#1a1a1a] leading-tight outline-none bg-transparent placeholder-gray-300"
                @input=${(e: Event) => this._fieldChange('title', (e.target as HTMLInputElement).value)}
                ?disabled=${this._outputLocked || this.isGenerating}
              />
            </div>
            <div>
              <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1.5">Subheader</p>
              <input
                type="text"
                placeholder="One line that sets the stage"
                class="w-full text-[16px] text-[#444] leading-snug outline-none bg-transparent placeholder-gray-300"
                @input=${(e: Event) => this._fieldChange('subheader', (e.target as HTMLInputElement).value)}
                ?disabled=${this._outputLocked || this.isGenerating}
              />
            </div>
            <div>
              <p class="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1.5">Body</p>
              <textarea
                rows="6"
                placeholder="Start writing your article body here. You can add headings by starting a line with ## and bullets with -."
                class="w-full text-[15px] leading-relaxed text-[#2a2a2a] outline-none bg-transparent placeholder-gray-300 resize-none"
                @input=${(e: Event) => this._fieldChange('body', (e.target as HTMLTextAreaElement).value)}
                ?disabled=${this._outputLocked || this.isGenerating}
              ></textarea>
            </div>
            <p class="text-[11px] text-gray-400 pt-2 border-t border-gray-50">Keep writing — section blocks and AI actions appear as soon as you have a title and some content.</p>
          </div>
        ` : sections.map((section, idx) => this._renderPreviewSection(section, idx, editable))}
        ${editable ? html`
          <div class="px-10 py-2 border-t border-gray-50 bg-gray-50/60">
            <p class="text-[11px] text-gray-400">Click to edit inline · Hover a section for AI actions · Switch to <strong>Advanced Editor</strong> for the full form</p>
          </div>
        ` : ''}
      </div>
    `
  }

  private _renderPreviewSection(_section: PreviewSection, idx: number, editable: boolean) {
    const isLoading = this._previewAILoadingIdx === idx
    const menuOpen = this._previewAIMenuIdx === idx
    const hasUndo = idx in this._previewAIUndo && !isLoading
    return html`
      <div class="ff-section-group px-10 py-6">
        ${editable ? html`
          <button
            class="ff-section-ai-btn"
            data-open=${menuOpen ? 'true' : 'false'}
            ?disabled=${isLoading}
            @click=${(e: Event) => {
              e.stopPropagation()
              this._previewAIMenuIdx = menuOpen ? null : idx
            }}
            title="AI actions for this section"
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 1.5L8.25 5l3.5 1.25L8.25 7.5 7 11l-1.25-3.5L2.25 6.25 5.75 5 7 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
            AI
          </button>
        ` : ''}
        ${menuOpen ? html`
          <div class="ff-section-ai-menu" @click=${(e: Event) => e.stopPropagation()}>
            ${PREVIEW_SECTION_AI_ACTIONS.map(action => html`
              <button @click=${() => this._runPreviewSectionAI(idx, action)}>${action.label}</button>
            `)}
          </div>
        ` : ''}
        <div
          class="ff-preview-editable ff-prose"
          data-preview-section=${idx}
          contenteditable=${editable && !isLoading ? 'true' : 'false'}
          @focus=${() => { this._previewFocusedIdx = idx }}
          @blur=${() => { if (this._previewFocusedIdx === idx) this._previewFocusedIdx = null }}
          @input=${(e: Event) => this._onSectionInput(idx, e)}
        ></div>
        ${isLoading ? html`
          <div class="ff-section-loading"><span>Updating section…</span></div>
        ` : ''}
        ${hasUndo ? html`
          <button class="ff-section-undo" @click=${() => this._revertPreviewSection(idx)}>Undo</button>
        ` : ''}
      </div>
    `
  }

  private _renderEditorForm() {
    const disabled = this._outputLocked || this.isGenerating
    const labelSpan = 'text-[11px] font-semibold uppercase tracking-widest text-gray-400'
    const inputBase = `w-full bg-transparent border-none outline-none resize-none placeholder-gray-300 ${disabled ? 'cursor-default' : ''}`

    const sectionHead = (field: keyof ParsedFields, label: string) => html`
      <div class="flex items-center justify-between mb-2.5">
        <span class="${labelSpan}">${label}</span>
        ${!disabled ? this._renderSectionControls(field) : ''}
      </div>
    `

    // Uncontrolled textarea: we only push state → DOM on external changes
    // (loading a draft, AI refine, regeneration) via updated(). During user
    // typing, the DOM is the source of truth — no `.value=${}` rebinding so
    // Lit can't clobber fast keystrokes with a stale state value.
    const ta = (
      field: keyof ParsedFields,
      _value: string,
      placeholder: string,
      textClass: string,
      minRows = 3,
    ) => html`
      <textarea
        data-ar
        data-field=${field}
        ?disabled=${disabled}
        placeholder=${placeholder}
        rows=${minRows}
        class="${inputBase} ${textClass} leading-relaxed"
        style="overflow:hidden; min-height:${minRows * 1.625}rem;"
        @input=${(e: Event) => {
          const el = e.target as HTMLTextAreaElement
          el.style.height = 'auto'
          el.style.height = `${el.scrollHeight}px`
          this._fieldChange(field, el.value)
        }}
      ></textarea>
    `

    return html`
      <div class="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">

        <!-- Title -->
        <div class="px-10 py-8 border-b border-gray-100">
          ${sectionHead('title', 'Title')}
          ${ta('title', this._title, 'Content title…', 'text-[28px] font-bold text-[#1a1a1a] leading-tight', 1)}
          ${this._aiOptions?.field === 'title' ? this._renderOptionsPanel('title', this._aiOptions.values) : ''}
        </div>

        <!-- Subheader -->
        <div class="px-10 py-7 border-b border-gray-100">
          ${sectionHead('subheader', 'Subheader')}
          ${ta('subheader', this._subheader, 'Supporting intro line or deck…', 'text-[17px] text-[#444] leading-snug', 1)}
          ${this._aiOptions?.field === 'subheader' ? this._renderOptionsPanel('subheader', this._aiOptions.values) : ''}
        </div>

        <!-- Body: rich text editor. Displays rendered HTML (no markdown
             syntax visible), click to edit, toolbar has Bold / Italic /
             Link / Article-link. -->
        <div class="px-10 py-7 border-b border-gray-100">
          ${sectionHead('body', 'Body')}
          <ff-rich-text-editor
            .value=${toRichHtml(this._body)}
            .editable=${!this._outputLocked && !this.isGenerating}
            placeholder="Main content body…"
            displayClass="text-[15px] text-[#2a2a2a] leading-relaxed min-h-[10rem]"
            @text-change=${(e: CustomEvent<string>) => this._onBodyHtmlChange(e.detail)}
          ></ff-rich-text-editor>
          ${this._aiOptions?.field === 'body' ? this._renderOptionsPanel('body', this._aiOptions.values) : ''}
        </div>

        <!-- CTA -->
        <div class="px-10 py-7 border-b border-gray-100">
          ${sectionHead('cta', 'CTA')}
          ${ta('cta', this._cta, 'Closing action text…', 'text-[15px] text-[#2a2a2a]', 3)}
          ${this._aiOptions?.field === 'cta' ? this._renderOptionsPanel('cta', this._aiOptions.values) : ''}
        </div>

        <!-- Meta Description -->
        <div class="px-10 py-7">
          ${sectionHead('metadata', 'Meta Description')}
          ${this._aiLoadingField === 'metadata' ? html`
            <span class="text-[11px] text-[#063853] animate-pulse">Generating…</span>
          ` : ta('metadata', this._metadata, 'SEO meta description…', 'text-[14px] text-[#555]', 3)}
          ${this._aiOptions?.field === 'metadata' ? this._renderOptionsPanel('metadata', this._aiOptions.values) : ''}
        </div>

      </div>
    `
  }

  override render() {
    const typeLabel = TYPE_LABELS[this.contentType] ?? this.contentType
    const audienceLabel = AUDIENCE_LABELS[this.audience] ?? this.audience
    const showRefine = (this._hasContent || this.isGenerating) && !this._outputLocked
    const active = this._hasContent || this.isGenerating

    return html`
      <div class="flex flex-col h-full">

        <!-- Header: mode + type + actions -->
        <div class="px-6 py-3 border-b border-gray-100 bg-white flex justify-between items-center shrink-0">

          <!-- Left: mode badge + type + title + save indicator -->
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="shrink-0 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-md ${
              this.editingId ? 'bg-amber-100 text-amber-700' : 'bg-[#063853]/10 text-[#063853]'
            }">
              ${this.editingId ? 'Editing' : 'Creating'}
            </span>
            <span class="shrink-0 text-[12px] font-semibold text-gray-500">${typeLabel}</span>
            ${this._hasContent ? html`
              <span class="text-[12px] text-gray-200 shrink-0">·</span>
              <span class="text-[13px] font-semibold text-[#1a1a1a] truncate max-w-[180px]">
                ${this._isJson
                  ? ((this._jsonData as unknown as Record<string, unknown>)?.['title'] as string | undefined) ?? this.topic ?? 'Untitled'
                  : (this._title || this.topic || 'Untitled')
                }
              </span>
              <span class="shrink-0 text-[11px] font-medium ${this.isDirty ? 'text-amber-500' : 'text-emerald-500'}">
                ${this.isDirty ? '• Unsaved' : (this.editingId ? '✓ Saved' : '')}
              </span>
            ` : ''}
          </div>

          <!-- Right: Save (primary) + secondary actions -->
          <div class="flex items-center gap-1 shrink-0">

            <!-- Save — primary button when dirty, subtle when clean -->
            <button @click=${() => this._fire('save')}
              ?disabled=${!this._hasContent || this.isGenerating || this._outputLocked}
              class="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors mr-2 ${
                this._hasContent && !this.isGenerating && !this._outputLocked
                  ? this.isDirty
                    ? 'bg-[#063853] text-white hover:bg-[#04293D]'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  : 'bg-gray-50 text-gray-300 cursor-default'
              }">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 2h7l2 2v8a.5.5 0 01-.5.5H2.5a.5.5 0 01-.5-.5V2.5a.5.5 0 01.5-.5z"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 2v3.5h5V2M4 12.5v-4h5v4"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              ${this.editingId ? (this.isDirty ? 'Save' : 'Saved') : 'Save to library'}
            </button>

            <!-- Publish -->
            ${this.editingId && this._hasContent && !this.isGenerating && this.status !== 'published' ? html`
              <button
                @click=${() => { this._showPublishConfirm = true }}
                class="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors mr-1"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v7M3 5l3-4 3 4M2 11h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Publish
              </button>
            ` : ''}

            <!-- Copy -->
            <button @click=${this._copy} ?disabled=${!this._hasContent}
              title="Copy to clipboard"
              class="flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                this._hasContent
                  ? this._copied ? 'text-emerald-500 bg-emerald-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                  : 'text-gray-200 cursor-default'
              }">
              ${this._copied
                ? html`<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                : html`<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 10V2.5A.5.5 0 012.5 2H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
              }
            </button>

            <!-- Regenerate -->
            <button @click=${() => this._fire('regenerate')}
              ?disabled=${!active || this._fullyLocked}
              title="Regenerate content"
              class="flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                active && !this._fullyLocked ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-200 cursor-default'
              }">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1.5 7A5.5 5.5 0 0112.5 4.5M12.5 7A5.5 5.5 0 011.5 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                <path d="M10.5 2.5L12.5 4.5L10.5 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M3.5 11.5L1.5 9.5L3.5 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- Undo last AI action -->
            ${this.canUndo ? html`
              <button @click=${() => this._fire('undo')}
                title="Undo last AI change"
                class="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 5h6a4 4 0 010 8H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M4.5 2.5L2 5l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            ` : ''}

            <!-- Discard changes -->
            ${this.editingId && this.isDirty ? html`
              <button @click=${() => this._fire('discard-changes')}
                title="Discard changes"
                class="flex items-center justify-center w-8 h-8 rounded-lg text-red-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              </button>
            ` : ''}

            <!-- Clear -->
            <button @click=${() => this._fire('clear')} ?disabled=${!active}
              title="Clear content"
              class="flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                active ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-200 cursor-default'
              }">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 3.5h10M5 3.5V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M5.5 6v4M8.5 6v4M3 3.5l.75 8a.5.5 0 00.5.5h5.5a.5.5 0 00.5-.5l.75-8"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

          </div>
        </div>

        <!-- Streaming progress (shimmer + char count + elapsed) -->
        ${this.isGenerating ? html`
          <div class="shrink-0 px-6 py-1.5 bg-[#063853]/[0.04] border-b border-[#063853]/10 flex items-center gap-3">
            <div class="relative flex-1 h-1 bg-[#063853]/10 rounded-full overflow-hidden">
              <div class="absolute inset-0 ff-stream-shimmer bg-gradient-to-r from-transparent via-[#063853]/60 to-transparent"></div>
            </div>
            <span class="text-[11px] text-[#063853] font-mono tabular-nums shrink-0">
              ${this.streamCharCount.toLocaleString()} chars
            </span>
            <span class="text-[11px] text-[#063853]/60 font-mono tabular-nums shrink-0">
              ${(this.streamElapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        ` : ''}

        <!-- Status banner -->
        ${this._renderStatusBanner()}

        <!-- Content area -->
        <div class="flex-1 overflow-y-auto min-h-0 scrollbar-thin py-8 px-4">
          <div class="w-full max-w-[750px] mx-auto">

            ${!this._hasContent && !this.isGenerating && !this.error && this.manualMode && !this._isJson ? html`
              <div class="animate-fade-in">
                ${this._renderEditorForm()}
              </div>
            ` : ''}

            ${!this._hasContent && !this.isGenerating && !this.error && !(this.manualMode && !this._isJson) ? html`
              <div class="flex flex-col items-center justify-center min-h-[50vh] text-center">
                <p class="text-[17px] text-[#383838] font-light">Your content will appear here.</p>
                <p class="text-[13px] text-[#383838] mt-2">Select a type, audience, and topic on the left.</p>
              </div>
            ` : ''}

            ${this.error && !this._hasContent ? html`
              <div class="rounded-xl bg-red-50 border border-red-100 px-5 py-4">
                <p class="text-[13px] text-red-400">${this.error}</p>
              </div>
            ` : ''}

            ${this._hasContent || this.isGenerating ? html`
              <div class="animate-fade-in">

                <!-- Top bar: badges + view mode tabs -->
                ${this._hasContent ? html`
                  <div class="flex items-center gap-2 mb-6 flex-wrap">

                    <!-- Left: type, audience, validation -->
                    <span class="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#063853]/[0.08] text-[#063853]">${typeLabel}</span>
                    <span class="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-500">${audienceLabel}</span>
                    ${this._isJson && this._validationResult && !this._validationResult.valid ? html`
                      <span class="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-red-50 text-red-600">
                        ${this._validationResult.blockingCount} issue${this._validationResult.blockingCount !== 1 ? 's' : ''}
                      </span>
                    ` : this._isJson && this._validationResult?.valid ? html`
                      <span class="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700">✓ Valid</span>
                    ` : ''}
                    ${this._outputLocked ? html`
                      <span class="text-[11px] text-gray-400">— read only</span>
                    ` : ''}
                    ${!this._isJson && this._wordCount > 0 ? html`
                      <span class="text-[11px] text-gray-400">${this._wordCount} words</span>
                    ` : ''}

                    <!-- Right: view mode segmented control — Editor / Advanced Editor -->
                    <div class="ml-auto flex items-center rounded-lg border border-gray-200 overflow-hidden">
                      ${this._isJson
                        ? (['preview', 'edit'] as const).map(v => {
                            const isActive = v === 'preview' ? this._showPreview : !this._showPreview
                            const label = v === 'preview' ? 'Editor' : 'Advanced Editor'
                            return html`<button
                              @click=${() => { this._showPreview = v === 'preview' }}
                              class="text-[11px] font-semibold px-3 py-1.5 transition-colors border-r border-gray-200 last:border-r-0 ${
                                isActive ? 'bg-[#063853] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                              }"
                            >${label}</button>`
                          })
                        : (['preview', 'edit'] as const).map(v => {
                            const isActive = v === 'preview' ? this._showMarkdownPreview : !this._showMarkdownPreview
                            const label = v === 'preview' ? 'Editor' : 'Advanced Editor'
                            return html`<button
                              @click=${() => { this._showMarkdownPreview = v === 'preview' }}
                              class="text-[11px] font-semibold px-3 py-1.5 transition-colors border-r border-gray-200 last:border-r-0 ${
                                isActive ? 'bg-[#063853] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                              }"
                            >${label}</button>`
                          })
                      }
                    </div>
                  </div>
                ` : ''}

                <!-- JSON: structured editor (Advanced Editor) -->
                ${this._isJson && this._jsonData && !this._showPreview ? html`
                  <ff-structured-editor
                    .data=${this._jsonData}
                    .disabled=${this._outputLocked || this.isGenerating}
                    .validationErrors=${this._validationResult?.errors ?? []}
                    @data-change=${this._onJsonDataChange}
                  ></ff-structured-editor>
                ` : ''}

                <!-- JSON: visual editor -->
                ${this._isJson && this._showPreview ? this._renderJsonPreview() : ''}

                <!-- Non-JSON (Article): Advanced Editor form -->
                ${!this._isJson && !this._showMarkdownPreview ? html`
                  ${this._renderEditorForm()}
                  ${this.isGenerating ? html`
                    <div class="flex items-center gap-2 mt-5 text-[12px] text-gray-400">
                      <span class="inline-block w-0.5 h-4 bg-gray-400 animate-pulse rounded-full"></span>
                      <span class="animate-pulse">Generating…</span>
                    </div>
                  ` : ''}
                ` : ''}

                <!-- First-use coachmark for section AI -->
                ${this._showSectionCoach && !this._isJson && this._showMarkdownPreview ? html`
                  <div class="mb-3 flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-[#063853] to-[#0a5170] text-white shadow-sm">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" class="shrink-0 mt-0.5">
                      <path d="M9 1.5L10.7 6.3L15.5 8L10.7 9.7L9 14.5L7.3 9.7L2.5 8L7.3 6.3L9 1.5Z" fill="currentColor"/>
                    </svg>
                    <div class="flex-1 text-[12px] leading-snug">
                      <p class="font-semibold mb-0.5">Tip: refine one section at a time</p>
                      <p class="text-white/80">Each section has a small <span class="inline-flex items-center gap-0.5 px-1 rounded bg-white/15">✦ AI</span> button — use it to rewrite just that part without touching the rest.</p>
                    </div>
                    <button
                      @click=${() => {
                        this._showSectionCoach = false
                        this.removeAttribute('data-coach')
                        try { localStorage.setItem('ff_coach_section_ai_v1', '1') } catch { /* ignore */ }
                      }}
                      class="shrink-0 text-[11px] font-semibold px-2 py-1 rounded bg-white/15 hover:bg-white/25 transition-colors"
                    >Got it</button>
                  </div>
                ` : ''}

                <!-- Non-JSON (Article): visual editor -->
                ${!this._isJson && this._showMarkdownPreview ? this._renderMarkdownPreview() : ''}

                <!-- JSON generating indicator -->
                ${this.isGenerating && this._isJson ? html`
                  <div class="flex items-center gap-2 mt-5 text-[12px] text-gray-400">
                    <span class="inline-block w-0.5 h-4 bg-gray-400 animate-pulse rounded-full"></span>
                    <span class="animate-pulse">Generating structured content…</span>
                  </div>
                ` : ''}

                ${this.error && this._hasContent ? html`
                  <p class="text-[12px] text-red-400 mt-4">${this.error}</p>
                ` : ''}
              </div>
            ` : ''}

          </div>
        </div>

        <!-- Refine bar -->
        ${showRefine ? html`
          <div class="shrink-0 border-t border-gray-100 bg-white px-8 py-4">
            <ff-refinement-input
              .isGenerating=${this.isGenerating}
              .quickActions=${!this._outputLocked ? QUICK_EDIT_ACTIONS : []}
              @refine=${(e: CustomEvent<string>) => {
                // JSON types (Money Tips, Quizzes, etc.) bubble to the parent
                // which owns the JSON refine path. Markdown types (articles)
                // get a targeted body-only refine right here so the title,
                // subheader, CTA, and metadata are never touched — previous
                // behavior sent the whole output and rewrote everything.
                if (this._isJson) {
                  this.dispatchEvent(new CustomEvent('json-refine', { detail: e.detail, bubbles: true }))
                  return
                }
                this._runSectionAI('body', { label: 'Refine', prompt: e.detail })
              }}
            ></ff-refinement-input>
          </div>
        ` : ''}

      </div>

      <!-- Publish confirmation dialog -->
      ${this._showPublishConfirm ? html`
        <div class="fixed inset-0 bg-black/25 flex items-center justify-center z-50"
          @click=${(e: Event) => { if (e.target === e.currentTarget) this._showPublishConfirm = false }}>
          <div class="bg-white rounded-xl shadow-xl p-6 w-[360px] max-w-[calc(100vw-2rem)] mx-4">
            <h3 class="text-[15px] font-semibold text-[#1a1a1a] mb-1.5">Publish this content?</h3>
            <p class="text-[13px] text-gray-500 mb-5">This will mark the content as published. You can unpublish it later from the details panel.</p>
            <div class="flex flex-col gap-2">
              <button
                @click=${() => { this._showPublishConfirm = false; this._fire('status-change', 'published') }}
                class="w-full px-4 py-2.5 text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
              >Yes, publish</button>
              <button
                @click=${() => { this._showPublishConfirm = false }}
                class="w-full px-4 py-2.5 text-[13px] font-medium text-[#383838] bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >Cancel</button>
            </div>
          </div>
        </div>
      ` : ''}

    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-output-panel': FFOutputPanel }
}
