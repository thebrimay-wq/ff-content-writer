import { LitElement, html } from 'lit'
import { customElement, property, state, query } from 'lit/decorators.js'

@customElement('ff-refinement-input')
export class FFRefinementInput extends LitElement {
  override createRenderRoot() { return this }

  @property({ type: Boolean }) isGenerating = false
  @property({ type: Array }) quickActions: { label: string; prompt: string }[] = []
  @state() private _value = ''
  @query('textarea') private _textarea!: HTMLTextAreaElement

  private get _canSubmit() {
    return this._value.trim().length > 0 && !this.isGenerating
  }

  private _onInput(e: Event) {
    this._value = (e.target as HTMLTextAreaElement).value
    const el = e.target as HTMLTextAreaElement
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 22 * 5) + 'px'
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      this._submit()
    }
  }

  private _submit() {
    const trimmed = this._value.trim()
    if (!trimmed || this.isGenerating) return
    this.dispatchEvent(new CustomEvent<string>('refine', { detail: trimmed, bubbles: true }))
    this._value = ''
    if (this._textarea) this._textarea.style.height = 'auto'
  }

  private _fireQuick(prompt: string) {
    if (this.isGenerating) return
    this.dispatchEvent(new CustomEvent<string>('refine', { detail: prompt, bubbles: true }))
  }

  override render() {
    return html`
      <div class="flex flex-col">
        <p class="text-[10px] font-bold tracking-widest uppercase text-[#383838] mb-2">Refine</p>
        ${this.quickActions.length ? html`
          <div class="flex flex-wrap gap-1.5 mb-2.5">
            ${this.quickActions.map(a => html`
              <button
                ?disabled=${this.isGenerating}
                @click=${() => this._fireQuick(a.prompt)}
                class="text-[11px] px-2.5 py-0.5 rounded-full border transition-colors select-none ${
                  this.isGenerating
                    ? 'border-gray-100 text-gray-300 cursor-default'
                    : 'border-gray-200 text-gray-500 hover:border-[#063853] hover:text-[#063853] hover:bg-[#063853]/[0.04]'
                }"
              >${a.label}</button>
            `)}
          </div>
        ` : ''}
        <div class="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3
                    focus-within:border-gray-300 focus-within:bg-white transition-colors">
          <textarea
            .value=${this._value}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            ?disabled=${this.isGenerating}
            rows="1"
            placeholder="Make this shorter  ·  Make it warmer  ·  Turn this into a checklist  ·  Tighten the CTA"
            class="flex-1 bg-transparent text-[14px] text-gray-900 placeholder-gray-300 outline-none
                   resize-none leading-relaxed disabled:opacity-50"
            style="min-height:22px"
          ></textarea>
          <button
            @click=${this._submit}
            ?disabled=${!this._canSubmit}
            aria-label="Submit refinement"
            class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              this._canSubmit
                ? 'bg-[#063853] hover:bg-[#04293D] cursor-pointer'
                : 'bg-gray-200 cursor-not-allowed'
            }"
          >
            <svg class="${this._canSubmit ? 'text-white' : 'text-gray-400'}"
                 width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 12V2M7 2L3 6M7 2L11 6" stroke="currentColor"
                    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-refinement-input': FFRefinementInput }
}
