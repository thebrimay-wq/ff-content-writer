import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'

/**
 * ff-editable-text
 *
 * Reusable inline-editing component. Renders as `display: contents` so the
 * host element is invisible in layout — the inner display/edit elements
 * inherit the parent's flow directly.
 *
 * Usage:
 *   <ff-editable-text
 *     .value=${text}
 *     displayClass="ff-prose-h1"
 *     @text-change=${(e) => handleChange(e.detail)}
 *   ></ff-editable-text>
 *
 * Properties:
 *   value        — current text (may contain markdown inline syntax)
 *   multiline    — use textarea instead of input
 *   placeholder  — shown when value is empty
 *   editable     — set false to make read-only
 *   required     — prevent saving an empty value
 *   displayClass — CSS class(es) applied to the display/edit element
 *
 * Events:
 *   text-change  — CustomEvent<string> fired on save with the new value
 */
@customElement('ff-editable-text')
export class FFEditableText extends LitElement {
  override createRenderRoot() { return this }

  @property() value = ''
  @property({ type: Boolean }) multiline = false
  @property() placeholder = 'Click to edit…'
  @property({ type: Boolean }) editable = true
  @property({ type: Boolean }) required = false
  @property() displayClass = ''

  @state() private _editing = false
  @state() private _draft = ''
  @state() private _saved = false

  private _savedTimer: ReturnType<typeof setTimeout> | null = null

  // ── Edit lifecycle ────────────────────────────────────────────────────────

  private _enter() {
    if (!this.editable || this._editing) return
    this._draft = this.value
    this._editing = true
    this.updateComplete.then(() => {
      const el = this.querySelector<HTMLInputElement | HTMLTextAreaElement>('.ffe-input')
      if (!el) return
      el.focus()
      if (el instanceof HTMLInputElement) {
        el.select()
      } else {
        el.setSelectionRange(el.value.length, el.value.length)
        this._resize(el)
      }
    })
  }

  private _save() {
    const next = this.multiline ? this._draft : this._draft.trim()
    if (this.required && !next.trim()) return
    this._editing = false
    if (next === this.value) return   // no change — skip event
    this.dispatchEvent(
      new CustomEvent<string>('text-change', { detail: next, bubbles: true }),
    )
    this._saved = true
    if (this._savedTimer) clearTimeout(this._savedTimer)
    this._savedTimer = setTimeout(() => { this._saved = false }, 1600)
  }

  private _cancel() {
    this._editing = false
    this._draft = ''
  }

  private _resize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  // ── Keyboard handling ─────────────────────────────────────────────────────

  private _onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); this._cancel(); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._save() }
    // Shift+Enter → native newline in textarea (falls through)
  }

  private _onDisplayKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._enter() }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  override render() {
    if (this._editing) return this._editTemplate()
    return this._displayTemplate()
  }

  private _displayTemplate() {
    const inner = this.value
      ? unsafeHTML(marked.parseInline(this.value) as string)
      : html`<span class="ffe-placeholder">${this.placeholder}</span>`

    const cls = [
      'ffe-display',
      this.displayClass,
      this.editable ? 'ffe-hoverable' : '',
      this._saved ? 'ffe-saved-flash' : '',
    ].filter(Boolean).join(' ')

    return html`
      <div
        class=${cls}
        role=${this.editable ? 'button' : 'presentation'}
        tabindex=${this.editable ? '0' : '-1'}
        aria-label=${this.editable ? `Edit: ${this.value || this.placeholder}` : ''}
        @click=${this._enter}
        @keydown=${this._onDisplayKey}
      >${inner}${this._saved
          ? html`<span class="ffe-saved-badge" aria-live="polite">✓</span>`
          : ''
        }</div>
    `
  }

  private _editTemplate() {
    const inputCls = `ffe-input ${this.displayClass}`
    return html`
      <div class="ffe-editing-wrapper">
        ${this.multiline
          ? html`
            <textarea
              class=${inputCls}
              .value=${this._draft}
              placeholder=${this.placeholder}
              @input=${(e: Event) => {
                this._draft = (e.target as HTMLTextAreaElement).value
                this._resize(e.target as HTMLTextAreaElement)
              }}
              @keydown=${this._onKey}
            ></textarea>`
          : html`
            <input
              type="text"
              class=${inputCls}
              .value=${this._draft}
              placeholder=${this.placeholder}
              @input=${(e: Event) => { this._draft = (e.target as HTMLInputElement).value }}
              @keydown=${this._onKey}
            />`
        }
        <div class="ffe-controls" role="group" aria-label="Edit controls">
          <button class="ffe-save" type="button" @click=${this._save} aria-label="Save">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M1 5.5L4 8.5L10 2" stroke="currentColor" stroke-width="1.75"
                stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Save
          </button>
          <button class="ffe-cancel" type="button" @click=${this._cancel} aria-label="Cancel (Esc)">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round"/>
            </svg>
            Cancel
          </button>
          <span class="ffe-hint">
            ${this.multiline ? 'Shift+Enter for newline' : 'Enter to save'}
            &nbsp;·&nbsp;Esc to cancel
          </span>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-editable-text': FFEditableText }
}
