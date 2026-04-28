import { LitElement, html } from 'lit'
import { customElement, property, state, query } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { loadArticles } from '../lib/articles'
import type { ContentEntry } from '../lib/store'

/**
 * ff-rich-text-editor
 *
 * Inline WYSIWYG editor. Display mode renders HTML (no tag markup visible).
 * Click to edit — shows a toolbar with Bold / Italic / Link / Article link.
 *
 *   <ff-rich-text-editor
 *     .value=${htmlString}
 *     placeholder="Slide body…"
 *     @text-change=${(e) => handle(e.detail)}
 *   ></ff-rich-text-editor>
 */
@customElement('ff-rich-text-editor')
export class FFRichTextEditor extends LitElement {
  override createRenderRoot() { return this }

  @property() value = ''
  @property() placeholder = 'Click to edit…'
  @property() displayClass = ''
  @property({ type: Boolean }) editable = true

  @state() private _editing = false
  @state() private _linkDialog: 'url' | 'article' | null = null
  @state() private _linkText = ''
  @state() private _linkHref = ''
  @state() private _articleQuery = ''
  @state() private _articlePick: ContentEntry | null = null
  @state() private _saved = false

  @query('.ffr-edit') private _edit?: HTMLElement

  private _savedTimer: ReturnType<typeof setTimeout> | null = null
  private _savedRange: Range | null = null

  // ── Edit lifecycle ────────────────────────────────────────────────────────

  private _enter() {
    if (!this.editable || this._editing) return
    this._editing = true
    this.updateComplete.then(() => {
      if (!this._edit) return
      this._edit.innerHTML = this.value || ''
      this._edit.focus()
      // place caret at end
      const range = document.createRange()
      range.selectNodeContents(this._edit)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }

  private _save() {
    if (!this._edit) return
    const next = this._edit.innerHTML.trim()
    this._editing = false
    if (next === (this.value || '').trim()) return
    this.dispatchEvent(new CustomEvent<string>('text-change', { detail: next, bubbles: true }))
    this._saved = true
    if (this._savedTimer) clearTimeout(this._savedTimer)
    this._savedTimer = setTimeout(() => { this._saved = false }, 1600)
  }

  private _cancel() {
    this._editing = false
  }

  // ── Toolbar actions ───────────────────────────────────────────────────────

  private _exec(command: string) {
    this._edit?.focus()
    document.execCommand(command, false)
  }

  private _toggleHighlight() {
    this._edit?.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !this._edit) return
    if (!this._edit.contains(sel.anchorNode)) return

    // If the caret/selection sits inside an existing highlight span, unwrap it.
    const anchor = sel.anchorNode
    const node = anchor?.nodeType === Node.ELEMENT_NODE
      ? (anchor as Element)
      : (anchor?.parentElement ?? null)
    const existing = node?.closest<HTMLSpanElement>('span.highlight') ?? null
    if (existing && this._edit.contains(existing)) {
      const parent = existing.parentNode
      if (!parent) return
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing)
      parent.removeChild(existing)
      return
    }

    if (sel.isCollapsed) return
    const text = sel.toString()
    if (!text) return
    const safe = escapeHtml(text)
    document.execCommand('insertHTML', false, `<span class="highlight">${safe}</span>`)
  }

  private _rememberSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && this._edit?.contains(sel.anchorNode)) {
      this._savedRange = sel.getRangeAt(0).cloneRange()
    }
  }

  private _restoreSelection() {
    if (!this._savedRange || !this._edit) return
    this._edit.focus()
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(this._savedRange)
  }

  private _openUrlDialog() {
    this._rememberSelection()
    const sel = window.getSelection()
    this._linkText = sel && !sel.isCollapsed ? sel.toString() : ''
    this._linkHref = ''
    this._linkDialog = 'url'
  }

  private _openArticleDialog() {
    this._rememberSelection()
    const sel = window.getSelection()
    this._linkText = sel && !sel.isCollapsed ? sel.toString() : ''
    this._articleQuery = ''
    this._articlePick = null
    this._linkDialog = 'article'
  }

  private _closeDialog() {
    this._linkDialog = null
    this._articlePick = null
    this._articleQuery = ''
  }

  private _insertLink(href: string, text: string) {
    if (!href) return
    this._restoreSelection()
    const safeText = text.trim() || href
    const safeHref = href.replace(/"/g, '&quot;')
    const anchor = `<a href="${safeHref}" target="_blank" rel="noopener">${escapeHtml(safeText)}</a>`
    document.execCommand('insertHTML', false, anchor)
    this._closeDialog()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  override render() {
    if (this._editing) return this._editTemplate()
    return this._displayTemplate()
  }

  private _displayTemplate() {
    const hasContent = this.value && this.value.trim().length > 0
    const cls = [
      'ffr-display',
      this.displayClass,
      this.editable ? 'ffr-hoverable' : '',
      this._saved ? 'ffr-saved-flash' : '',
    ].filter(Boolean).join(' ')

    return html`
      <div
        class=${cls}
        role=${this.editable ? 'button' : 'presentation'}
        tabindex=${this.editable ? '0' : '-1'}
        aria-label=${this.editable ? 'Edit rich text' : ''}
        @click=${this._enter}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._enter() }
        }}
      >
        ${hasContent
          ? unsafeHTML(this.value)
          : html`<span class="ffr-placeholder">${this.placeholder}</span>`}
        ${this._saved ? html`<span class="ffr-saved-badge" aria-live="polite">✓</span>` : ''}
      </div>
    `
  }

  private _editTemplate() {
    return html`
      <div class="ffr-editing-wrapper">
        <div class="ffr-toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" class="ffr-tb-btn" title="Bold (Ctrl+B)"
            @mousedown=${(e: Event) => e.preventDefault()}
            @click=${() => this._exec('bold')}><strong>B</strong></button>
          <button type="button" class="ffr-tb-btn" title="Italic (Ctrl+I)"
            @mousedown=${(e: Event) => e.preventDefault()}
            @click=${() => this._exec('italic')}><em>I</em></button>
          <button type="button" class="ffr-tb-btn ffr-tb-highlight" title="Highlight (wrap in yellow span)"
            @mousedown=${(e: Event) => e.preventDefault()}
            @click=${this._toggleHighlight}><span class="highlight">H</span></button>
          <span class="ffr-tb-sep"></span>
          <button type="button" class="ffr-tb-btn" title="Insert link"
            @mousedown=${(e: Event) => e.preventDefault()}
            @click=${this._openUrlDialog}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 10-7.07-7.07l-1.5 1.5M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 107.07 7.07l1.5-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            Link
          </button>
          <button type="button" class="ffr-tb-btn" title="Link to article in this CMS"
            @mousedown=${(e: Event) => e.preventDefault()}
            @click=${this._openArticleDialog}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 4h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 4v5h5M8 13h8M8 17h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            Article
          </button>
          <span class="ffr-tb-spacer"></span>
          <button type="button" class="ffr-tb-save" @click=${this._save}>Save</button>
          <button type="button" class="ffr-tb-cancel" @click=${this._cancel}>Cancel</button>
        </div>
        <div
          class="ffr-edit ${this.displayClass}"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); this._cancel() }
          }}
        ></div>
        ${this._linkDialog === 'url' ? this._urlDialogTemplate() : ''}
        ${this._linkDialog === 'article' ? this._articleDialogTemplate() : ''}
      </div>
    `
  }

  private _urlDialogTemplate() {
    const canInsert = this._linkHref.trim().length > 0
    return html`
      <div class="ffr-modal-overlay" @click=${this._closeDialog}>
        <div class="ffr-modal" @click=${(e: Event) => e.stopPropagation()}>
          <h3 class="ffr-modal-title">Insert link</h3>
          <label class="ffr-modal-label">Text to display</label>
          <input type="text" class="ffr-modal-input"
            .value=${this._linkText}
            placeholder="Click here"
            @input=${(e: Event) => { this._linkText = (e.target as HTMLInputElement).value }}
          />
          <label class="ffr-modal-label">URL</label>
          <input type="url" class="ffr-modal-input"
            .value=${this._linkHref}
            placeholder="https://…"
            @input=${(e: Event) => { this._linkHref = (e.target as HTMLInputElement).value }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' && canInsert) this._insertLink(this._linkHref, this._linkText)
            }}
          />
          <div class="ffr-modal-actions">
            <button type="button" class="ffr-tb-cancel" @click=${this._closeDialog}>Cancel</button>
            <button type="button" class="ffr-tb-save" ?disabled=${!canInsert}
              @click=${() => this._insertLink(this._linkHref, this._linkText)}>Insert link</button>
          </div>
        </div>
      </div>
    `
  }

  private _articleDialogTemplate() {
    const q = this._articleQuery.trim().toLowerCase()
    const all = loadArticles()
    const matches = (q
      ? all.filter(a =>
          a.title.toLowerCase().includes(q) ||
          a.slug.toLowerCase().includes(q) ||
          a.categories.some(c => c.toLowerCase().includes(q)))
      : all
    ).slice(0, 40)
    const canInsert = this._articlePick !== null
    return html`
      <div class="ffr-modal-overlay" @click=${this._closeDialog}>
        <div class="ffr-modal ffr-modal-wide" @click=${(e: Event) => e.stopPropagation()}>
          <h3 class="ffr-modal-title">Link to article</h3>
          <label class="ffr-modal-label">Search articles</label>
          <input type="text" class="ffr-modal-input"
            .value=${this._articleQuery}
            placeholder="Search by title, slug, or category…"
            @input=${(e: Event) => { this._articleQuery = (e.target as HTMLInputElement).value }}
          />
          <div class="ffr-article-list" role="listbox" aria-label="Articles">
            ${matches.length === 0
              ? html`<p class="ffr-article-empty">No matches.</p>`
              : matches.map(a => html`
                <button type="button" role="option"
                  class="ffr-article-row ${this._articlePick?.id === a.id ? 'ffr-article-row-selected' : ''}"
                  @click=${() => {
                    this._articlePick = a
                    if (!this._linkText.trim()) this._linkText = a.title
                  }}>
                  <span class="ffr-article-title">${a.title || '(untitled)'}</span>
                  <span class="ffr-article-meta">${a.contentType} · /${a.slug}</span>
                </button>
              `)}
          </div>
          <label class="ffr-modal-label">Text to display</label>
          <input type="text" class="ffr-modal-input"
            .value=${this._linkText}
            placeholder=${this._articlePick?.title || 'Click here'}
            @input=${(e: Event) => { this._linkText = (e.target as HTMLInputElement).value }}
          />
          <div class="ffr-modal-actions">
            <button type="button" class="ffr-tb-cancel" @click=${this._closeDialog}>Cancel</button>
            <button type="button" class="ffr-tb-save" ?disabled=${!canInsert}
              @click=${() => {
                if (!this._articlePick) return
                const href = `/articles/${this._articlePick.slug}`
                this._insertLink(href, this._linkText || this._articlePick.title)
              }}>Insert link</button>
          </div>
        </div>
      </div>
    `
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

declare global {
  interface HTMLElementTagNameMap { 'ff-rich-text-editor': FFRichTextEditor }
}
