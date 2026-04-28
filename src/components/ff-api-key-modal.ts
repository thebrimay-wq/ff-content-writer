import { LitElement, html } from 'lit'
import { customElement, property, state, query } from 'lit/decorators.js'

@customElement('ff-api-key-modal')
export class FFApiKeyModal extends LitElement {
  override createRenderRoot() { return this }

  @property() initialKey = ''
  @state() private _value = ''
  @query('input') private _input!: HTMLInputElement

  override connectedCallback() {
    super.connectedCallback()
    this._value = this.initialKey
    window.addEventListener('keydown', this._onGlobalKey)
    this.updateComplete.then(() => this._input?.focus())
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this._onGlobalKey)
  }

  private _onGlobalKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._close()
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true }))
  }

  private _save() {
    this.dispatchEvent(new CustomEvent<string>('save', { detail: this._value.trim(), bubbles: true }))
  }

  override render() {
    return html`
      <div class="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center"
           @click=${this._close}>
        <div class="bg-white rounded-2xl shadow-xl p-8 w-[420px] max-w-[90vw]"
             @click=${(e: Event) => e.stopPropagation()}>

          <h2 class="font-bold text-[18px] text-gray-900 mb-1">Anthropic API Key</h2>
          <p class="text-[13px] text-gray-400 mb-6">
            Your key is stored for this browser session only and never sent anywhere except the Anthropic API.
          </p>

          <label class="text-[10px] font-bold tracking-widest uppercase text-gray-400 block mb-1.5">API Key</label>
          <input
            type="text"
            .value=${this._value}
            @input=${(e: Event) => { this._value = (e.target as HTMLInputElement).value }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this._save() }}
            placeholder="sk-ant-..."
            class="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px]
                   text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400
                   mb-6 font-mono"
            spellcheck="false"
            autocomplete="off"
          />

          <div class="flex items-center justify-end gap-3">
            <button @click=${this._close}
              class="px-4 py-2 text-[14px] font-semibold text-gray-500 hover:text-gray-700
                     transition-colors rounded-lg hover:bg-gray-100">
              Cancel
            </button>
            <button @click=${this._save}
              class="px-5 py-2 text-[14px] font-bold text-white bg-[#063853] hover:bg-[#04293D]
                     rounded-lg transition-colors">
              Save
            </button>
          </div>

        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-api-key-modal': FFApiKeyModal }
}
