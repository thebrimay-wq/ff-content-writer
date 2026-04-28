import { LitElement, html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

// ── Types ─────────────────────────────────────────────────────────────────────

type InputType = 'currency' | 'number' | 'percent' | 'years'
type OutputType = 'currency' | 'number' | 'percent' | 'years'

interface CalcInput {
  id: string
  label: string
  type: InputType
  default: number
  min?: number
  max?: number
}

interface CalcSpec {
  title: string
  description: string
  inputs: CalcInput[]
  formula: string
  outputLabel: string
  outputType: OutputType
  cta: string
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parseSpec(text: string): CalcSpec | null {
  const lines = text.split('\n')
  let title = ''
  let currentSection = ''
  const sections: Record<string, string[]> = {}

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/)
    const h2 = line.match(/^##\s+(.+)$/)
    if (h1) { title = h1[1].trim(); continue }
    if (h2) { currentSection = h2[1].toLowerCase().trim(); sections[currentSection] = []; continue }
    if (currentSection) sections[currentSection].push(line)
  }

  const inputs: CalcInput[] = (sections['inputs'] ?? [])
    .filter(l => l.trim().startsWith('-'))
    .map((l): CalcInput | null => {
      const parts = l.replace(/^-\s*/, '').split('|').map(s => s.trim())
      const [id, label, type, defaultVal, min, max] = parts
      if (!id || !label) return null
      return {
        id,
        label,
        type: (['currency','number','percent','years'].includes(type) ? type : 'number') as InputType,
        default: parseFloat(defaultVal) || 0,
        min: min ? parseFloat(min) : undefined,
        max: max ? parseFloat(max) : undefined,
      }
    })
    .filter((i): i is CalcInput => i !== null)

  const formula = (sections['formula'] ?? []).find(l => l.trim())?.trim() ?? ''

  const outputLine = (sections['output'] ?? []).find(l => l.trim())?.trim() ?? ''
  const outputParts = outputLine.split('|').map(s => s.trim())
  const outputLabel = outputParts[0] || 'Result'
  const outputType = (['currency','number','percent','years'].includes(outputParts[1])
    ? outputParts[1] : 'number') as OutputType

  const description = (sections['description'] ?? []).filter(l => l.trim()).join(' ').trim()
  const cta = (sections['cta'] ?? []).filter(l => l.trim()).join(' ').trim()

  if (!title || inputs.length === 0 || !formula) return null
  return { title, description, inputs, formula, outputLabel, outputType, cta }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatResult(value: number, type: OutputType): string {
  if (!isFinite(value) || isNaN(value)) return '—'
  switch (type) {
    case 'currency': return '$' + Math.round(value).toLocaleString('en-US')
    case 'percent':  return value.toFixed(1) + '%'
    case 'years':    return Math.round(value) + (Math.round(value) === 1 ? ' year' : ' years')
    default:         return Math.round(value).toLocaleString('en-US')
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

@customElement('ff-calculator')
export class FFCalculator extends LitElement {
  override createRenderRoot() { return this }

  @property() spec = ''
  @property({ type: Boolean }) isGenerating = false

  @state() private _parsed: CalcSpec | null = null
  @state() private _values: Record<string, number> = {}

  override willUpdate(changed: PropertyValues) {
    if (changed.has('spec') && this.spec && !this.isGenerating) {
      const parsed = parseSpec(this.spec)
      this._parsed = parsed
      if (parsed) {
        this._values = Object.fromEntries(parsed.inputs.map(i => [i.id, i.default]))
      }
    }
  }

  private _compute(): number | null {
    if (!this._parsed) return null
    try {
      const ids = this._parsed.inputs.map(i => i.id)
      const vals = ids.map(id => this._values[id] ?? 0)
      // eslint-disable-next-line no-new-func
      return new Function(...ids, `return (${this._parsed.formula})`)(...vals) as number
    } catch {
      return null
    }
  }

  private _setValue(id: string, raw: string) {
    const v = parseFloat(raw.replace(/[^0-9.-]/g, ''))
    if (!isNaN(v)) this._values = { ...this._values, [id]: v }
  }

  override render() {
    if (this.isGenerating) {
      return html`
        <div class="ff-calc-generating">
          <span class="inline-block w-0.5 h-4 bg-gray-400 animate-pulse"></span>
          <span class="ff-calc-generating-text">Building calculator…</span>
        </div>`
    }

    if (!this._parsed) {
      return html`<p class="ff-prose-p text-gray-400 italic">Could not parse calculator spec.</p>`
    }

    const { title, description, inputs, outputLabel, outputType, cta } = this._parsed
    const result = this._compute()

    return html`
      <div class="ff-calc-wrap">
        <h1 class="ff-prose-h1">${title}</h1>
        ${description ? html`<p class="ff-prose-p">${description}</p>` : ''}

        <div class="ff-calc-inputs">
          ${inputs.map(input => {
            const val = this._values[input.id] ?? input.default
            const prefix = input.type === 'currency' ? '$' : ''
            const suffix = input.type === 'percent' ? '%'
                         : input.type === 'years'   ? 'yrs'
                         : ''
            return html`
              <div class="ff-calc-row">
                <label class="ff-calc-label">${input.label}</label>
                <div class="ff-calc-input-wrap">
                  ${prefix ? html`<span class="ff-calc-affix">${prefix}</span>` : ''}
                  <input
                    type="number"
                    class="ff-calc-input"
                    .value=${String(val)}
                    min=${input.min ?? ''}
                    max=${input.max ?? ''}
                    @input=${(e: Event) => this._setValue(input.id, (e.target as HTMLInputElement).value)}
                  />
                  ${suffix ? html`<span class="ff-calc-affix ff-calc-suffix">${suffix}</span>` : ''}
                </div>
              </div>`
          })}
        </div>

        <div class="ff-calc-result">
          <span class="ff-calc-result-label">${outputLabel}</span>
          <span class="ff-calc-result-value">
            ${result !== null ? formatResult(result, outputType) : '—'}
          </span>
        </div>

        ${cta ? html`
          <div class="ff-cta-box">
            <span class="ff-cta-next-steps">Next Steps</span>
            <p class="ff-prose-p">${cta}</p>
          </div>` : ''}
      </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-calculator': FFCalculator }
}
