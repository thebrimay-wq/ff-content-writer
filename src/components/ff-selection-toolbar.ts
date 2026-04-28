import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'

/**
 * Floating AI toolbar that appears whenever the user selects text inside any
 * element marked with `data-ai-selectable`. Notion-style: highlight → popup.
 *
 * Emits:
 *   - 'selection-ai' detail: { text: string; action: string; instruction: string }
 *       Parent component (ff-app) decides how to run it — usually as a refine.
 *
 * Usage: just mount this element anywhere inside the app. It attaches a global
 * listener. No props required.
 */

interface ActionDef {
  key: string
  label: string
  instruction: string
}

const ACTIONS: ActionDef[] = [
  { key: 'improve',    label: 'Improve',      instruction: 'Improve this passage — clearer wording, tighter structure, stronger verbs. Keep the same meaning and voice.' },
  { key: 'shorten',    label: 'Shorten',      instruction: 'Shorten this passage while keeping the core message.' },
  { key: 'simplify',   label: 'Simplify',     instruction: 'Simplify this passage. Plainer words, shorter sentences, easier reading level. Keep meaning.' },
  { key: 'warmer',     label: 'Warmer',       instruction: 'Rewrite this passage in a warmer, more human tone. Less corporate, more direct, still professional.' },
  { key: 'actionable', label: 'More actionable', instruction: 'Rewrite to make this more actionable — concrete steps, specific numbers, clear verbs. Keep length similar.' },
]

@customElement('ff-selection-toolbar')
export class FFSelectionToolbar extends LitElement {
  override createRenderRoot() { return this }

  @state() private _visible = false
  @state() private _x = 0
  @state() private _y = 0
  @state() private _text = ''
  @state() private _askOpen = false
  @state() private _askInput = ''

  override connectedCallback() {
    super.connectedCallback()
    document.addEventListener('mouseup', this._onMouseUp, true)
    document.addEventListener('keyup', this._onMouseUp, true)
    document.addEventListener('mousedown', this._onMouseDown, true)
    document.addEventListener('scroll', this._hide, true)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('mouseup', this._onMouseUp, true)
    document.removeEventListener('keyup', this._onMouseUp, true)
    document.removeEventListener('mousedown', this._onMouseDown, true)
    document.removeEventListener('scroll', this._hide, true)
  }

  private _inSelectable(node: Node | null): boolean {
    let el = node instanceof Element ? node : node?.parentElement ?? null
    while (el) {
      if (el.hasAttribute?.('data-ai-selectable')) return true
      if (el.hasAttribute?.('data-ai-toolbar-skip')) return false
      el = el.parentElement
    }
    return false
  }

  private _onMouseDown = (e: MouseEvent) => {
    // If clicking inside the toolbar itself, ignore.
    const target = e.target as HTMLElement | null
    if (target?.closest?.('.ff-selection-toolbar')) return
    // Otherwise, a new interaction begins — hide current toolbar state.
    this._visible = false
    this._askOpen = false
  }

  private _onMouseUp = () => {
    // Defer to let selection settle.
    setTimeout(() => this._updateFromSelection(), 10)
  }

  private _updateFromSelection() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { this._visible = false; return }
    const text = sel.toString().trim()
    if (text.length < 4) { this._visible = false; return }
    const range = sel.getRangeAt(0)
    if (!this._inSelectable(range.commonAncestorContainer)) { this._visible = false; return }
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) { this._visible = false; return }
    this._text = text
    // Position above selection, with a small gap. Clamp to viewport.
    // Widened from 360 → 440 so "More actionable" + "Ask" both fit on one
    // line without clipping the last button.
    const toolbarWidth = 440
    const toolbarHeight = 40
    let x = rect.left + rect.width / 2 - toolbarWidth / 2
    x = Math.max(8, Math.min(x, window.innerWidth - toolbarWidth - 8))
    let y = rect.top - toolbarHeight - 10
    if (y < 10) y = rect.bottom + 10
    this._x = x
    this._y = y
    this._visible = true
    this._askOpen = false
    this._askInput = ''
  }

  private _hide = () => {
    if (!this._visible) return
    this._visible = false
    this._askOpen = false
  }

  private _run(action: ActionDef) {
    const text = this._text
    if (!text) return
    this.dispatchEvent(new CustomEvent('selection-ai', {
      detail: { text, action: action.key, instruction: action.instruction },
      bubbles: true,
    }))
    this._visible = false
  }

  private _runAsk() {
    const raw = this._askInput.trim()
    if (!raw || !this._text) return
    this.dispatchEvent(new CustomEvent('selection-ai', {
      detail: { text: this._text, action: 'ask', instruction: raw },
      bubbles: true,
    }))
    this._visible = false
    this._askOpen = false
    this._askInput = ''
  }

  override render() {
    if (!this._visible) return html``
    return html`
      <div
        class="ff-selection-toolbar fixed z-[60] flex items-center rounded-lg shadow-lg bg-white border border-gray-200 overflow-hidden whitespace-nowrap"
        style="left:${this._x}px; top:${this._y}px; width:440px"
        data-ai-toolbar-skip
        @mousedown=${(e: Event) => e.stopPropagation()}
      >
        ${this._askOpen ? html`
          <div class="flex items-center gap-1 w-full px-2 py-1">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-[#063853] shrink-0">
              <path d="M7 1L8.5 5L12.5 7L8.5 8.5L7 13L5.5 8.5L1.5 7L5.5 5L7 1Z" fill="currentColor"/>
            </svg>
            <input
              type="text"
              autofocus
              .value=${this._askInput}
              @input=${(e: Event) => { this._askInput = (e.target as HTMLInputElement).value }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') { e.preventDefault(); this._runAsk() }
                if (e.key === 'Escape') { this._askOpen = false; this._askInput = '' }
              }}
              placeholder="Tell AI what to do with this…"
              class="flex-1 h-8 px-2 text-[13px] bg-transparent outline-none placeholder-gray-300"
            />
            <button
              @click=${this._runAsk}
              ?disabled=${!this._askInput.trim()}
              class="text-[11px] font-semibold text-white bg-[#063853] hover:bg-[#04293D] px-2 py-1 rounded disabled:opacity-30"
            >Go</button>
          </div>
        ` : html`
          ${ACTIONS.map(a => html`
            <button
              @click=${() => this._run(a)}
              title=${a.instruction}
              class="px-2.5 h-9 text-[12px] font-medium text-gray-700 hover:bg-gray-100 border-r border-gray-100 last:border-r-0 transition-colors whitespace-nowrap shrink-0"
            >${a.label}</button>
          `)}
          <button
            @click=${() => { this._askOpen = true }}
            class="px-2.5 h-9 text-[12px] font-semibold text-[#063853] hover:bg-gray-100 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
            title="Ask AI something custom"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1L6.12 3.88L9 5L6.12 6.12L5 9L3.88 6.12L1 5L3.88 3.88L5 1Z" fill="currentColor"/>
            </svg>
            Ask
          </button>
        `}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-selection-toolbar': FFSelectionToolbar }
}
