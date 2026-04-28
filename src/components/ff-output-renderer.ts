import { LitElement, html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'
import './ff-editable-text'

// ── Block model ───────────────────────────────────────────────────────────────

type BlockKind = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'oli' | 'li-task' | 'bq' | 'hr' | 'blank'

interface Block {
  kind: BlockKind
  text: string    // content without markdown prefix
  prefix: string  // original prefix, used for reconstruction
  isAltHeadline?: boolean
}

// ── Parser ────────────────────────────────────────────────────────────────────

const H3   = /^###\s+(.+)$/
const H2   = /^##\s+(.+)$/
const H1   = /^#\s+(.+)$/
const HR   = /^(?:---|\*\*\*|___)\s*$/
const BQ   = /^>\s*(.*)/
const TASK = /^[-*]\s+\[([xX ]?)\]\s+(.*)/
const LI   = /^([-*])\s+(.*)/
const OLI  = /^(\d+\.)\s+(.*)/

function parseLine(line: string): Block {
  if (!line.trim()) return { kind: 'blank', text: '', prefix: '' }
  let m: RegExpMatchArray | null
  if (HR.test(line.trim()))  return { kind: 'hr',      text: '',   prefix: line.trim() }
  if ((m = line.match(H3)))  return { kind: 'h3',      text: m[1], prefix: '### ' }
  if ((m = line.match(H2)))  return { kind: 'h2',      text: m[1], prefix: '## ' }
  if ((m = line.match(H1)))  return { kind: 'h1',      text: m[1], prefix: '# ' }
  if ((m = line.match(BQ)))  return { kind: 'bq',      text: m[1], prefix: '> ' }
  if ((m = line.match(TASK))) return { kind: 'li-task', text: m[2], prefix: `- [${m[1] || ' '}] ` }
  if ((m = line.match(LI)))  return { kind: 'li',      text: m[2], prefix: `${m[1]} ` }
  if ((m = line.match(OLI))) return { kind: 'oli',     text: m[2], prefix: `${m[1]} ` }
  return { kind: 'p', text: line, prefix: '' }
}

function parseMarkdown(md: string): Block[] {
  let inAltHeadlines = false
  return md.split('\n').map(line => {
    const block = parseLine(line)
    if (block.kind === 'h2') {
      inAltHeadlines = /alt headlines?/i.test(block.text)
    }
    if (inAltHeadlines && (block.kind === 'li' || block.kind === 'oli')) {
      return { ...block, isAltHeadline: true }
    }
    return block
  })
}

function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map(b => {
    if (b.kind === 'blank') return ''
    if (b.kind === 'hr')    return b.prefix
    return b.prefix + b.text
  }).join('\n')
}

// ── Component ─────────────────────────────────────────────────────────────────

@customElement('ff-output-renderer')
export class FFOutputRenderer extends LitElement {
  override createRenderRoot() { return this }

  @property() text = ''
  @property({ type: Boolean }) isGenerating = false
  @property({ type: Boolean }) readonly = false

  @state() private _blocks: Block[] = []

  /** Guards against re-parsing our own emitted markdown */
  private _lastEmitted = ''

  override willUpdate(changed: PropertyValues) {
    if (changed.has('text') && this.text !== this._lastEmitted) {
      this._blocks = parseMarkdown(this.text)
      this._lastEmitted = ''
    }
  }

  // ── Alt headline selection ──────────────────────────────────────────────────

  private _selectAltHeadline(text: string) {
    if (!window.confirm(`Use this as the headline?\n\n"${text}"`)) return
    const h1Idx = this._blocks.findIndex(b => b.kind === 'h1')
    if (h1Idx === -1) return
    const updated = this._blocks.map((b, i) => i === h1Idx ? { ...b, text } : b)
    this._blocks = updated
    const md = blocksToMarkdown(updated)
    this._lastEmitted = md
    this.dispatchEvent(new CustomEvent<string>('text-change', { detail: md, bubbles: true }))
  }

  // ── Block change ────────────────────────────────────────────────────────────

  private _blockChanged(idx: number, newText: string) {
    const updated = this._blocks.map((b, i) =>
      i === idx ? { ...b, text: newText } : b,
    )
    this._blocks = updated
    const md = blocksToMarkdown(updated)
    this._lastEmitted = md
    this.dispatchEvent(new CustomEvent<string>('text-change', { detail: md, bubbles: true }))
  }

  // ── Block rendering ─────────────────────────────────────────────────────────

  private _block(block: Block, idx: number) {
    const onChange = (e: CustomEvent<string>) => {
      e.stopPropagation()   // prevent fragment from bubbling past this renderer
      this._blockChanged(idx, e.detail)
    }

    switch (block.kind) {
      case 'blank':
        return html`<div class="h-2" aria-hidden="true"></div>`

      case 'hr':
        return html`<hr class="ff-prose-hr" />`

      case 'h1':
        return html`<ff-editable-text
          .value=${block.text}
          displayClass="ff-prose-h1"
          placeholder="Title…"
          @text-change=${onChange}
        ></ff-editable-text>`

      case 'h2':
        return html`<ff-editable-text
          .value=${block.text}
          displayClass="ff-prose-h2"
          @text-change=${onChange}
        ></ff-editable-text>`

      case 'h3':
        return html`<ff-editable-text
          .value=${block.text}
          displayClass="ff-prose-h3"
          @text-change=${onChange}
        ></ff-editable-text>`

      case 'bq':
        return html`<ff-editable-text
          .value=${block.text}
          displayClass="ff-prose-bq"
          multiline
          @text-change=${onChange}
        ></ff-editable-text>`

      case 'li':
      case 'oli':
        if (block.isAltHeadline) {
          return html`<div class="ff-prose-li-row ff-alt-headline-row">
            <span class="ff-prose-li-bullet" aria-hidden="true">—</span>
            <ff-editable-text
              .value=${block.text}
              displayClass="ff-prose-li-text"
              @text-change=${onChange}
            ></ff-editable-text>
            <button class="ff-alt-headline-btn" type="button"
              @click=${() => this._selectAltHeadline(block.text)}>
              Use this
            </button>
          </div>`
        }
        return html`<div class="ff-prose-li-row">
          <span class="ff-prose-li-bullet" aria-hidden="true">
            ${block.kind === 'oli' ? block.prefix.trim() : '—'}
          </span>
          <ff-editable-text
            .value=${block.text}
            displayClass="ff-prose-li-text"
            @text-change=${onChange}
          ></ff-editable-text>
        </div>`

      case 'li-task':
        return html`<div class="ff-prose-li-row">
          <input type="checkbox" class="ff-prose-checkbox" readonly
            ?checked=${block.prefix.includes('x') || block.prefix.includes('X')} />
          <ff-editable-text
            .value=${block.text}
            displayClass="ff-prose-li-text"
            @text-change=${onChange}
          ></ff-editable-text>
        </div>`

      case 'p':
      default:
        return html`<ff-editable-text
          .value=${block.text}
          displayClass="ff-prose-p"
          multiline
          @text-change=${onChange}
        ></ff-editable-text>`
    }
  }

  // ── Section grouping ────────────────────────────────────────────────────────

  private _renderSections() {
    type Section = { headerBlock: Block | null; headerIdx: number; items: Array<{ block: Block; idx: number }> }
    const sections: Section[] = []
    let current: Section = { headerBlock: null, headerIdx: -1, items: [] }

    this._blocks.forEach((block, idx) => {
      if (block.kind === 'h2') {
        sections.push(current)
        current = { headerBlock: block, headerIdx: idx, items: [] }
      } else {
        current.items.push({ block, idx })
      }
    })
    sections.push(current)

    return sections.map(section => {
      const isCta = section.headerBlock && /^cta$/i.test(section.headerBlock.text.trim())
      const content = [
        section.headerBlock ? this._block(section.headerBlock, section.headerIdx) : null,
        ...section.items.map(({ block, idx }) => this._block(block, idx)),
      ]
      if (isCta) {
        const header = section.headerBlock
          ? this._block(section.headerBlock, section.headerIdx)
          : null
        const body = section.items.map(({ block, idx }) => this._block(block, idx))
        return html`
          ${header}
          <div class="ff-cta-box">
            <span class="ff-cta-next-steps">Next Steps</span>
            ${body}
          </div>`
      }
      return content
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  override render() {
    // During streaming or read-only: fast unsafeHTML path, no editable UI
    if (this.isGenerating || this.readonly) {
      return html`<div class="ff-prose">${unsafeHTML(marked.parse(this.text) as string)}</div>`
    }

    // Idle: block-based editable view
    return html`
      <div class="ff-prose ff-prose-editable">
        ${this._renderSections()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-output-renderer': FFOutputRenderer }
}
