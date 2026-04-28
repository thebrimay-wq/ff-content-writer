import { LitElement, html, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type {
  AnyContent, Article, ArticleSection, ArticleTable,
  Calculator, Checklist, ChecklistItem, ChecklistSection, ChecklistTip,
  ExpertInsight, ExpertInsightSection,
  Infographic, MoneyTip, MoneyTipSection,
  Quiz, QuizAnswer, QuizQuestion, QuizRubricCriterion, QuizType, TypeOption,
  RelatedResource, UserStory, Video,
} from '../lib/contentTypeSchemas'
import {
  PLANNERS, TYPE_OPTIONS,
  emptyArticleSection, emptyChecklistItem, emptyChecklistSection,
  emptyExpertInsightSection, emptyMoneyTipSection,
  emptyQuizAnswer, emptyQuizCriterion, emptyQuizQuestion,
} from '../lib/contentTypeSchemas'
import type { ValidationError } from '../lib/validation'

// ── Shared style helpers ───────────────────────────────────────────────────────

const LABEL = 'text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5 block'
const SECTION_WRAP = 'border border-gray-200 rounded-xl overflow-hidden bg-white mb-4'
const SECTION_HEAD = 'px-5 py-3.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between'
const SECTION_BODY = 'px-5 py-4 flex flex-col gap-3'
const INPUT_CLS = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-[14px] text-[#1a1a1a] outline-none focus:border-[#063853] transition-colors placeholder-gray-300 bg-white'
// All textareas auto-grow, wrap naturally, and never show horizontal scroll —
// the Edit tab should read like a long-form editor, not a cramped form.
const TA_CLS = `${INPUT_CLS} resize-none leading-relaxed whitespace-pre-wrap break-words`
const CARD_CLS = 'border border-gray-200 rounded-lg overflow-hidden bg-white'
const CARD_HDR = 'px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2'
const CARD_BODY = 'px-4 py-3 flex flex-col gap-2.5'
const BTN_ADD = 'flex items-center gap-1.5 text-[12px] font-medium text-[#063853] hover:text-[#04293D] transition-colors'
const BTN_DEL = 'text-[11px] text-gray-400 hover:text-red-500 transition-colors shrink-0'
const BTN_MOVE = 'text-[11px] text-gray-300 hover:text-gray-500 transition-colors shrink-0'
const TOGGLE_ON = 'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors bg-[#063853]'
const TOGGLE_OFF = 'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors bg-gray-200'

@customElement('ff-structured-editor')
export class FFStructuredEditor extends LitElement {
  override createRenderRoot() { return this }

  @property({ type: Object }) data: AnyContent | null = null
  @property({ type: Boolean }) disabled = false
  @property({ type: Array }) validationErrors: ValidationError[] = []

  @state() private _showUniversal = false

  private _emit(data: AnyContent) {
    this.dispatchEvent(new CustomEvent('data-change', { detail: data, bubbles: true }))
  }

  private _patch(patch: Partial<AnyContent>) {
    if (!this.data) return
    this._emit({ ...this.data, ...patch } as AnyContent)
  }

  private _errFor(field: string): string | null {
    return this.validationErrors.find(e => e.field === field)?.message ?? null
  }

  // ── Shared render helpers ─────────────────────────────────────────────────────

  private _inp(label: string, value: string, onChange: (v: string) => void, opts: {
    placeholder?: string; multiline?: boolean; rows?: number; hint?: string; field?: string; type?: string
  } = {}): TemplateResult {
    const err = opts.field ? this._errFor(opts.field) : null
    // Text fields always render as auto-growing textareas so long content
    // wraps and grows vertically instead of scrolling sideways.
    // Typed inputs (url, email, number) stay as <input> because browser
    // validation and single-line semantics matter.
    const isTyped = !!opts.type && opts.type !== 'text'
    const useTextarea = !isTyped
    return html`
      <div>
        <label class="${LABEL}">${label}</label>
        ${useTextarea ? html`
          <textarea
            data-ar
            class="${TA_CLS} ${err ? 'border-red-300' : ''}"
            rows=${opts.rows ?? (opts.multiline ? 3 : 1)}
            ?disabled=${this.disabled}
            placeholder=${opts.placeholder ?? ''}
            .value=${value}
            @input=${(e: Event) => {
              const el = e.target as HTMLTextAreaElement
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
              onChange(el.value)
            }}
          ></textarea>
        ` : html`
          <input
            type=${opts.type!}
            class="${INPUT_CLS} ${err ? 'border-red-300' : ''}"
            ?disabled=${this.disabled}
            placeholder=${opts.placeholder ?? ''}
            .value=${value}
            @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
          />
        `}
        ${err ? html`<p class="text-[11px] text-red-500 mt-1">${err}</p>` : ''}
        ${opts.hint ? html`<p class="text-[11px] text-gray-400 mt-1">${opts.hint}</p>` : ''}
      </div>
    `
  }

  override updated() {
    // Auto-size every textarea after render so long pre-populated content
    // reveals itself fully without the user needing to click or type.
    this.querySelectorAll<HTMLTextAreaElement>('textarea[data-ar]').forEach(ta => {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    })
  }

  /** Number input that round-trips null ⇄ empty string cleanly. */
  private _num(label: string, value: number | null, onChange: (v: number | null) => void, opts: {
    placeholder?: string; hint?: string; step?: string
  } = {}): TemplateResult {
    return html`
      <div>
        <label class="${LABEL}">${label}</label>
        <input
          type="number"
          step=${opts.step ?? '1'}
          class="${INPUT_CLS}"
          ?disabled=${this.disabled}
          placeholder=${opts.placeholder ?? ''}
          .value=${value === null || value === undefined ? '' : String(value)}
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value
            onChange(raw === '' ? null : Number(raw))
          }}
        />
        ${opts.hint ? html`<p class="text-[11px] text-gray-400 mt-1">${opts.hint}</p>` : ''}
      </div>
    `
  }

  /** Image URL field with inline thumbnail preview. */
  private _imageField(label: string, value: string, onChange: (v: string) => void, opts: {
    placeholder?: string; hint?: string
  } = {}): TemplateResult {
    const has = !!value?.trim()
    return html`
      <div>
        <label class="${LABEL}">${label}</label>
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 shrink-0 rounded-md border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
            ${has ? html`
              <img src=${value} alt="" class="w-full h-full object-cover" @error=${(e: Event) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ` : html`
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#d1d5db" stroke-width="1.2"/><circle cx="6" cy="7" r="1" fill="#d1d5db"/><path d="M2.5 12l3.5-3.5 3 3 2-2 2.5 2.5" stroke="#d1d5db" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            `}
          </div>
          <input
            type="url"
            class="${INPUT_CLS} flex-1"
            ?disabled=${this.disabled}
            placeholder=${opts.placeholder ?? 'https://…'}
            .value=${value}
            @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
          />
        </div>
        ${opts.hint ? html`<p class="text-[11px] text-gray-400 mt-1">${opts.hint}</p>` : ''}
      </div>
    `
  }

  private _toggle(label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): TemplateResult {
    return html`
      <div class="flex items-center justify-between">
        <div>
          <span class="text-[13px] text-[#1a1a1a] font-medium">${label}</span>
          ${hint ? html`<p class="text-[11px] text-gray-400">${hint}</p>` : ''}
        </div>
        <button
          type="button"
          ?disabled=${this.disabled}
          class="${value ? TOGGLE_ON : TOGGLE_OFF}"
          @click=${() => onChange(!value)}
        >
          <span class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}" style="margin-top:2px"></span>
        </button>
      </div>
    `
  }

  private _select(label: string, value: string, options: string[] | Array<{v: string; l: string}>, onChange: (v: string) => void): TemplateResult {
    const opts = options.map(o => typeof o === 'string' ? { v: o, l: o } : o)
    return html`
      <div>
        <label class="${LABEL}">${label}</label>
        <div class="relative">
          <select
            class="${INPUT_CLS} appearance-none pr-8 cursor-pointer"
            ?disabled=${this.disabled}
            .value=${value}
            @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
          >
            ${opts.map(o => html`<option value=${o.v} ?selected=${o.v === value}>${o.l}</option>`)}
          </select>
          <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </div>
      </div>
    `
  }

  private _moveBtn(onUp: (() => void) | null, onDown: (() => void) | null): TemplateResult {
    return html`
      <div class="flex flex-col gap-0.5">
        <button type="button" class="${BTN_MOVE}" ?disabled=${!onUp || this.disabled} @click=${onUp ?? (() => {})} title="Move up">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="${BTN_MOVE}" ?disabled=${!onDown || this.disabled} @click=${onDown ?? (() => {})} title="Move down">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `
  }

  private _addBtn(label: string, onClick: () => void): TemplateResult {
    return html`
      <button type="button" class="${BTN_ADD}" ?disabled=${this.disabled} @click=${onClick}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        ${label}
      </button>
    `
  }

  private _delBtn(onClick: () => void, title = 'Remove'): TemplateResult {
    return html`
      <button type="button" class="${BTN_DEL}" ?disabled=${this.disabled} @click=${onClick} title=${title}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 3.5h8M5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M5.5 5.5v4M7.5 5.5v4M3.5 3.5l.5 7a.5.5 0 00.5.5h4a.5.5 0 00.5-.5l.5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `
  }

  private _sectionHead(title: string, badge?: string | number, actions?: TemplateResult): TemplateResult {
    return html`
      <div class="${SECTION_HEAD}">
        <div class="flex items-center gap-2">
          <span class="text-[13px] font-semibold text-[#1a1a1a]">${title}</span>
          ${badge !== undefined ? html`<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#063853]/10 text-[#063853]">${badge}</span>` : ''}
        </div>
        ${actions ?? ''}
      </div>
    `
  }

  // ── Universal fields ──────────────────────────────────────────────────────────

  private _renderUniversal(): TemplateResult {
    const d = this.data!
    return html`
      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Universal fields', undefined, html`
          <button type="button" class="text-[11px] text-gray-400 hover:text-gray-600 transition-colors" @click=${() => { this._showUniversal = !this._showUniversal }}>
            ${this._showUniversal ? 'Collapse' : 'Expand'}
          </button>
        `)}
        ${this._showUniversal ? html`
          <div class="${SECTION_BODY}">
            ${this._inp('Slug', d.slug, v => this._patch({ slug: v }), { placeholder: 'kebab-case-slug', field: 'slug' })}
            ${this._inp('Topic category', d.topic_category, v => this._patch({ topic_category: v }), { placeholder: 'e.g. Emergency Savings' })}
            <div class="flex flex-col gap-2 pt-1">
              ${this._toggle('Bookmarkable', d.bookmarkable, v => this._patch({ bookmarkable: v }))}
              ${this._toggle('Shareable', d.shareable, v => this._patch({ shareable: v }))}
              ${this._toggle('Copyable', d.copyable, v => this._patch({ copyable: v }))}
            </div>
          </div>
        ` : html`
          <div class="px-5 py-3 flex items-center gap-4">
            <span class="text-[12px] text-gray-500">Slug: <span class="text-[#1a1a1a]">${d.slug || '(not set)'}</span></span>
            <span class="text-[12px] text-gray-500">Category: <span class="text-[#1a1a1a]">${d.topic_category || '(not set)'}</span></span>
          </div>
        `}
      </div>
    `
  }

  // ── Related resources ─────────────────────────────────────────────────────────

  private _renderRelatedResources(resources: RelatedResource[], onChange: (r: RelatedResource[]) => void): TemplateResult {
    const typeOptions = ['article', 'money_tip', 'calculator', 'checklist', 'expert_insight', 'infographic', 'quiz', 'user_story', 'video'].map(v => ({ v, l: v }))
    return html`
      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Related resources', resources.length)}
        <div class="${SECTION_BODY} gap-2">
          ${resources.map((r, i) => html`
            <div class="flex items-center gap-2">
              <input
                class="${INPUT_CLS} flex-1"
                placeholder="Resource title"
                .value=${r.title}
                ?disabled=${this.disabled}
                @input=${(e: Event) => {
                  const updated = [...resources]; updated[i] = { ...r, title: (e.target as HTMLInputElement).value }; onChange(updated)
                }}
              />
              <div class="relative shrink-0 w-36">
                <select
                  class="${INPUT_CLS} appearance-none pr-6 text-[12px]"
                  ?disabled=${this.disabled}
                  .value=${r.content_type}
                  @change=${(e: Event) => {
                    const updated = [...resources]; updated[i] = { ...r, content_type: (e.target as HTMLSelectElement).value }; onChange(updated)
                  }}
                >
                  ${typeOptions.map(o => html`<option value=${o.v} ?selected=${o.v === r.content_type}>${o.l}</option>`)}
                </select>
              </div>
              ${this._delBtn(() => onChange(resources.filter((_, j) => j !== i)))}
            </div>
          `)}
          ${this._addBtn('Add resource', () => onChange([...resources, { title: '', content_type: 'article' }]))}
        </div>
      </div>
    `
  }

  // ── ARTICLE ───────────────────────────────────────────────────────────────────

  private _renderArticle(d: Article): TemplateResult {
    const patchSection = (i: number, patch: Partial<ArticleSection>) => {
      const sections = d.sections.map((s, j) => j === i ? { ...s, ...patch } : s)
      this._patch({ sections } as Partial<AnyContent>)
    }
    const swapSections = (i: number, j: number) => {
      const sections = [...d.sections];
      [sections[i], sections[j]] = [sections[j], sections[i]]
      this._patch({ sections } as Partial<AnyContent>)
    }

    return html`
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), {
        placeholder: 'Article title (max 65 chars)', field: 'title',
        hint: `${d.title.length}/65 characters`,
      })}
      <div class="grid grid-cols-2 gap-3">
        ${this._inp('Read time', d.read_time, v => this._patch({ read_time: v } as Partial<AnyContent>), { placeholder: '5 min' })}
        ${this._inp('Hero image description', d.hero_image_description, v => this._patch({ hero_image_description: v } as Partial<AnyContent>), { placeholder: 'Describe the ideal hero image' })}
      </div>
      ${this._inp('Intro paragraph', d.intro_paragraph, v => this._patch({ intro_paragraph: v } as Partial<AnyContent>), {
        multiline: true, rows: 3, placeholder: 'Opening hook paragraph…', field: 'intro_paragraph',
      })}

      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Body sections', d.sections.length)}
        <div class="${SECTION_BODY}">
          ${d.sections.map((section, i) => this._renderArticleSection(section, i, d.sections.length, patchSection, swapSections, () => {
            this._patch({ sections: d.sections.filter((_, j) => j !== i) } as Partial<AnyContent>)
          }))}
          ${this._addBtn('Add section', () => {
            this._patch({ sections: [...d.sections, emptyArticleSection()] } as Partial<AnyContent>)
          })}
        </div>
      </div>

      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Closing section')}
        <div class="${SECTION_BODY}">
          ${this._inp('Heading', d.closing_section.heading, v => this._patch({ closing_section: { ...d.closing_section, heading: v } } as Partial<AnyContent>), { placeholder: 'What to do next' })}
          ${this._inp('Body', d.closing_section.body, v => this._patch({ closing_section: { ...d.closing_section, body: v } } as Partial<AnyContent>), { multiline: true, rows: 2, placeholder: 'Closing action paragraph…' })}
        </div>
      </div>

      ${this._renderRelatedResources(d.related_resources, rr => this._patch({ related_resources: rr } as Partial<AnyContent>))}
    `
  }

  private _renderArticleSection(
    s: ArticleSection, i: number, total: number,
    onPatch: (i: number, p: Partial<ArticleSection>) => void,
    onSwap: (i: number, j: number) => void,
    onDelete: () => void,
  ): TemplateResult {
    const showTable = !!s.optional_table

    return html`
      <div class="${CARD_CLS}">
        <div class="${CARD_HDR}">
          <div class="flex items-center gap-2">
            ${this._moveBtn(i > 0 ? () => onSwap(i, i - 1) : null, i < total - 1 ? () => onSwap(i, i + 1) : null)}
            <span class="text-[12px] font-semibold text-gray-600">Section ${i + 1}</span>
          </div>
          ${this._delBtn(onDelete)}
        </div>
        <div class="${CARD_BODY}">
          ${this._inp('Heading', s.heading, v => onPatch(i, { heading: v }), { placeholder: 'Section heading', field: `sections[${i}].heading` })}
          ${this._inp('Body', s.body, v => onPatch(i, { body: v }), { multiline: true, rows: 4, placeholder: 'Section body text (HTML ok — <snippet…> and *-card tags preserved)', field: `sections[${i}].body` })}

          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="${LABEL} mb-0">Bullet list (optional)</label>
              ${s.optional_bullet_list?.length
                ? this._delBtn(() => onPatch(i, { optional_bullet_list: [] }), 'Clear bullets')
                : this._addBtn('Add bullets', () => onPatch(i, { optional_bullet_list: [''] }))
              }
            </div>
            ${s.optional_bullet_list?.length ? html`
              <div class="flex flex-col gap-1.5">
                ${s.optional_bullet_list.map((item, bi) => html`
                  <div class="flex items-center gap-2">
                    <span class="text-gray-400 text-[13px] shrink-0">•</span>
                    <input
                      class="${INPUT_CLS} flex-1"
                      .value=${item}
                      placeholder="Bullet item…"
                      ?disabled=${this.disabled}
                      @input=${(e: Event) => {
                        const list = [...(s.optional_bullet_list ?? [])]
                        list[bi] = (e.target as HTMLInputElement).value
                        onPatch(i, { optional_bullet_list: list })
                      }}
                    />
                    ${this._delBtn(() => {
                      const list = (s.optional_bullet_list ?? []).filter((_, j) => j !== bi)
                      onPatch(i, { optional_bullet_list: list })
                    })}
                  </div>
                `)}
                <button type="button" class="${BTN_ADD}" @click=${() => onPatch(i, { optional_bullet_list: [...(s.optional_bullet_list ?? []), ''] })}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                  Add item
                </button>
              </div>
            ` : ''}
          </div>

          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="${LABEL} mb-0">Table (optional)</label>
              ${showTable
                ? this._delBtn(() => onPatch(i, { optional_table: null }), 'Remove table')
                : this._addBtn('Add table', () => onPatch(i, { optional_table: { table_title: '', columns: ['Column 1', 'Column 2'], rows: [['', '']] } }))
              }
            </div>
            ${showTable && s.optional_table ? this._renderArticleTable(s.optional_table, t => onPatch(i, { optional_table: t })) : ''}
          </div>
        </div>
      </div>
    `
  }

  private _renderArticleTable(t: ArticleTable, onChange: (t: ArticleTable) => void): TemplateResult {
    return html`
      <div class="border border-gray-200 rounded-lg p-3 bg-gray-50 flex flex-col gap-2">
        ${this._inp('Table title', t.table_title, v => onChange({ ...t, table_title: v }), { placeholder: 'Table title (optional)' })}
        <div class="flex gap-2 flex-wrap">
          ${t.columns.map((col, ci) => html`
            <input class="${INPUT_CLS} flex-1 min-w-[100px]" .value=${col} placeholder="Column ${ci + 1}"
              @input=${(e: Event) => {
                const cols = [...t.columns]; cols[ci] = (e.target as HTMLInputElement).value; onChange({ ...t, columns: cols })
              }}
            />
          `)}
          <button type="button" class="${BTN_ADD}" @click=${() => {
            const cols = [...t.columns, `Column ${t.columns.length + 1}`]
            const rows = t.rows.map(r => [...r, ''])
            onChange({ ...t, columns: cols, rows })
          }}>+ Col</button>
        </div>
        ${t.rows.map((row, ri) => html`
          <div class="flex gap-2 items-center">
            ${row.map((cell, ci) => html`
              <input class="${INPUT_CLS} flex-1 min-w-[80px] text-[13px]" .value=${cell} placeholder="…"
                @input=${(e: Event) => {
                  const rows = t.rows.map((rr, rj) => rj === ri ? rr.map((c, cj) => cj === ci ? (e.target as HTMLInputElement).value : c) : rr)
                  onChange({ ...t, rows })
                }}
              />
            `)}
            ${this._delBtn(() => onChange({ ...t, rows: t.rows.filter((_, j) => j !== ri) }))}
          </div>
        `)}
        ${this._addBtn('Add row', () => onChange({ ...t, rows: [...t.rows, new Array(t.columns.length).fill('')] }))}
      </div>
    `
  }

  // ── MONEY TIP ─────────────────────────────────────────────────────────────────
  // Backend shape (Bite_Sized.cs): array of { preheading, heading, body }.

  private _renderMoneyTip(d: MoneyTip): TemplateResult {
    const patchSection = (i: number, patch: Partial<MoneyTipSection>) => {
      const sections = d.sections.map((s, j) => j === i ? { ...s, ...patch } : s)
      this._patch({ sections } as Partial<AnyContent>)
    }
    const swapSections = (i: number, j: number) => {
      const sections = [...d.sections]
      ;[sections[i], sections[j]] = [sections[j], sections[i]]
      this._patch({ sections } as Partial<AnyContent>)
    }

    return html`
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), { placeholder: 'Carousel title (max 65 chars)', field: 'title' })}

      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Slides', d.sections.length)}
        <div class="${SECTION_BODY}">
          ${d.sections.map((s, i) => html`
            <div class="${CARD_CLS}">
              <div class="${CARD_HDR}">
                <div class="flex items-center gap-2">
                  ${this._moveBtn(i > 0 ? () => swapSections(i, i - 1) : null, i < d.sections.length - 1 ? () => swapSections(i, i + 1) : null)}
                  <span class="text-[12px] font-semibold text-gray-600">Slide ${i + 1}</span>
                </div>
                ${this._delBtn(() => this._patch({ sections: d.sections.filter((_, j) => j !== i) } as Partial<AnyContent>))}
              </div>
              <div class="${CARD_BODY}">
                ${this._inp('Preheading', s.preheading ?? '', v => patchSection(i, { preheading: v || null }), { placeholder: 'Kicker text (optional)' })}
                ${this._inp('Heading', s.heading ?? '', v => patchSection(i, { heading: v || null }), { placeholder: 'Slide heading' })}
                ${this._inp('Body', s.body ?? '', v => patchSection(i, { body: v || null }), { multiline: true, rows: 3, placeholder: 'Slide body (HTML ok — custom tags preserved)' })}
              </div>
            </div>
          `)}
          ${this._addBtn('Add slide', () => this._patch({ sections: [...d.sections, emptyMoneyTipSection()] } as Partial<AnyContent>))}
        </div>
      </div>
    `
  }

  // ── CALCULATOR ────────────────────────────────────────────────────────────────
  // Simplified: thumbnail + title + copy + reference_link + related.

  private _renderCalculator(d: Calculator): TemplateResult {
    return html`
      ${this._imageField('Thumbnail image', d.thumbnail_image, v => this._patch({ thumbnail_image: v } as Partial<AnyContent>))}
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), { placeholder: 'Calculator title', field: 'title' })}
      ${this._inp('Copy', d.copy, v => this._patch({ copy: v } as Partial<AnyContent>), {
        multiline: true, rows: 6, placeholder: 'Calculator description (HTML ok)', field: 'copy',
      })}
      ${this._inp('Reference link', d.reference_link, v => this._patch({ reference_link: v } as Partial<AnyContent>), {
        placeholder: 'https:// or Vimeo ID', type: 'url',
      })}
      ${this._renderRelatedResources(d.related_resources, rr => this._patch({ related_resources: rr } as Partial<AnyContent>))}
    `
  }

  // ── CHECKLIST ─────────────────────────────────────────────────────────────────
  // Matches Checklist.cs: sections[{ id, title, description, image, items[{ id, label, subItems, isChecked }], tip }].

  private _renderChecklist(d: Checklist): TemplateResult {
    const patchSection = (i: number, patch: Partial<ChecklistSection>) => {
      const sections = d.sections.map((s, j) => j === i ? { ...s, ...patch } : s)
      this._patch({ sections } as Partial<AnyContent>)
    }
    const patchItem = (si: number, ii: number, patch: Partial<ChecklistItem>) => {
      const sections = d.sections.map((s, j) => j !== si ? s : {
        ...s, items: s.items.map((it, k) => k === ii ? { ...it, ...patch } : it),
      })
      this._patch({ sections } as Partial<AnyContent>)
    }

    return html`
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), { placeholder: 'Checklist title', field: 'title' })}
      ${this._inp('Intro paragraph', d.intro_paragraph, v => this._patch({ intro_paragraph: v } as Partial<AnyContent>), {
        multiline: true, rows: 2, placeholder: 'Why this checklist matters…',
      })}

      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Sections', d.sections.length)}
        <div class="${SECTION_BODY}">
          ${d.sections.map((section, si) => html`
            <div class="${CARD_CLS}">
              <div class="${CARD_HDR}">
                <span class="text-[12px] font-semibold text-gray-600">${section.title || `Section ${si + 1}`}</span>
                ${this._delBtn(() => this._patch({ sections: d.sections.filter((_, j) => j !== si) } as Partial<AnyContent>))}
              </div>
              <div class="${CARD_BODY}">
                ${this._imageField('Icon / image', section.image ?? '', v => patchSection(si, { image: v || null }), { placeholder: 'Section icon image URL' })}
                ${this._inp('Title', section.title, v => patchSection(si, { title: v }), { placeholder: 'Section title', field: `sections[${si}].title` })}
                ${this._inp('Description', section.description, v => patchSection(si, { description: v }), {
                  multiline: true, rows: 2, placeholder: 'Brief section description (HTML ok)',
                })}

                <label class="${LABEL}">Checklist items</label>
                ${section.items.map((item, ii) => html`
                  <div class="border border-gray-100 rounded-lg p-3 bg-gray-50/40 flex flex-col gap-2">
                    <div class="flex items-start gap-2">
                      <span class="text-gray-400 mt-2 shrink-0">☐</span>
                      <input class="${INPUT_CLS} flex-1" .value=${item.label} placeholder="Item text (HTML ok — links allowed)" ?disabled=${this.disabled}
                        @input=${(e: Event) => patchItem(si, ii, { label: (e.target as HTMLInputElement).value })}
                      />
                      ${this._delBtn(() => patchSection(si, { items: section.items.filter((_, k) => k !== ii) }))}
                    </div>

                    <div>
                      <div class="flex items-center justify-between mb-1">
                        <label class="${LABEL} mb-0">Sub-items (optional)</label>
                        ${item.subItems?.length
                          ? this._delBtn(() => patchItem(si, ii, { subItems: null }), 'Clear sub-items')
                          : this._addBtn('Add sub-items', () => patchItem(si, ii, { subItems: [''] }))
                        }
                      </div>
                      ${item.subItems?.length ? html`
                        <div class="flex flex-col gap-1.5 pl-6">
                          ${item.subItems.map((sub, bi) => html`
                            <div class="flex items-center gap-2">
                              <span class="text-gray-300 text-[13px] shrink-0">–</span>
                              <input class="${INPUT_CLS} flex-1 text-[13px]" .value=${sub} placeholder="Sub-item…" ?disabled=${this.disabled}
                                @input=${(e: Event) => {
                                  const subs = [...(item.subItems ?? [])]
                                  subs[bi] = (e.target as HTMLInputElement).value
                                  patchItem(si, ii, { subItems: subs })
                                }}
                              />
                              ${this._delBtn(() => {
                                const subs = (item.subItems ?? []).filter((_, j) => j !== bi)
                                patchItem(si, ii, { subItems: subs.length ? subs : null })
                              })}
                            </div>
                          `)}
                          <button type="button" class="${BTN_ADD}" @click=${() => patchItem(si, ii, { subItems: [...(item.subItems ?? []), ''] })}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                            Add sub-item
                          </button>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `)}
                ${this._addBtn('Add item', () => patchSection(si, { items: [...section.items, emptyChecklistItem()] }))}

                <div class="mt-1">
                  <div class="flex items-center justify-between mb-1">
                    <label class="${LABEL} mb-0">Tip block (optional)</label>
                    ${section.tip
                      ? this._delBtn(() => patchSection(si, { tip: null }), 'Remove tip')
                      : this._addBtn('Add tip', () => patchSection(si, { tip: { image: null, title: '', description: '' } }))
                    }
                  </div>
                  ${section.tip ? html`
                    <div class="border border-amber-200 rounded-lg p-3 bg-amber-50 flex flex-col gap-2">
                      ${this._imageField('Tip image', section.tip.image ?? '', v => patchSection(si, { tip: { ...(section.tip as ChecklistTip), image: v || null } }))}
                      ${this._inp('Title', section.tip.title ?? '', v => patchSection(si, { tip: { ...(section.tip as ChecklistTip), title: v || null } }), { placeholder: 'Tip title' })}
                      ${this._inp('Description', section.tip.description ?? '', v => patchSection(si, { tip: { ...(section.tip as ChecklistTip), description: v || null } }), {
                        multiline: true, rows: 2, placeholder: 'Tip body (HTML ok)',
                      })}
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
          `)}
          ${this._addBtn('Add section', () => this._patch({ sections: [...d.sections, emptyChecklistSection()] } as Partial<AnyContent>))}
        </div>
      </div>
    `
  }

  // ── EXPERT INSIGHT ────────────────────────────────────────────────────────────
  // Matches Expert_Insights.cs: sections[{ plannerId, body }].

  private _renderExpertInsight(d: ExpertInsight): TemplateResult {
    const patchSection = (i: number, patch: Partial<ExpertInsightSection>) => {
      const sections = d.sections.map((s, j) => j === i ? { ...s, ...patch } : s)
      this._patch({ sections } as Partial<AnyContent>)
    }
    const plannerOpts = PLANNERS.map(p => ({ v: p.id, l: p.name }))

    return html`
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), { placeholder: 'Article title (max 65 chars)', field: 'title' })}
      <div class="grid grid-cols-2 gap-3">
        ${this._inp('Read time', d.read_time, v => this._patch({ read_time: v } as Partial<AnyContent>), { placeholder: '4 min' })}
        ${this._inp('Hero image description', d.hero_image_description, v => this._patch({ hero_image_description: v } as Partial<AnyContent>), { placeholder: 'Describe hero image' })}
      </div>
      ${this._inp('Intro paragraph', d.intro_paragraph, v => this._patch({ intro_paragraph: v } as Partial<AnyContent>), {
        multiline: true, rows: 3, placeholder: '2-3 sentences framing the theme…', field: 'intro_paragraph',
      })}

      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Planner insights', d.sections.length)}
        <div class="${SECTION_BODY}">
          ${d.sections.map((section, i) => html`
            <div class="${CARD_CLS}">
              <div class="${CARD_HDR}">
                <span class="text-[12px] font-semibold text-gray-600">Insight ${i + 1}</span>
                ${this._delBtn(() => this._patch({ sections: d.sections.filter((_, j) => j !== i) } as Partial<AnyContent>))}
              </div>
              <div class="${CARD_BODY}">
                ${this._select('Coach (planner)', section.plannerId, plannerOpts, v => patchSection(i, { plannerId: v }))}
                ${(() => {
                  const planner = PLANNERS.find(p => p.id === section.plannerId)
                  return planner ? html`
                    <div class="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-gray-50 border border-gray-100">
                      <div class="w-7 h-7 rounded-full bg-[#063853]/10 flex items-center justify-center shrink-0">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="2.5" stroke="#063853" stroke-width="1.3"/><path d="M2 12c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="#063853" stroke-width="1.3" stroke-linecap="round"/></svg>
                      </div>
                      <span class="text-[12px] text-gray-600">${planner.name}</span>
                      <span class="text-[11px] text-gray-400 ml-auto">Coach photo managed via Planner directory</span>
                    </div>
                  ` : ''
                })()}
                ${this._inp('Insight body', section.body, v => patchSection(i, { body: v }), {
                  multiline: true, rows: 5,
                  placeholder: '3-5 sentences in first person. HTML ok — <strong>…</strong> for emphasis.',
                  field: `sections[${i}].body`,
                  hint: 'Write in first person as the planner. HTML tags preserved on save.',
                })}
              </div>
            </div>
          `)}
          ${this._addBtn('Add planner insight', () => this._patch({ sections: [...d.sections, emptyExpertInsightSection()] } as Partial<AnyContent>))}
        </div>
      </div>
    `
  }

  // ── INFOGRAPHIC ───────────────────────────────────────────────────────────────
  // Simplified: thumbnail + infographic image + related resources.

  private _renderInfographic(d: Infographic): TemplateResult {
    return html`
      ${this._imageField('Thumbnail image', d.thumbnail_image, v => this._patch({ thumbnail_image: v } as Partial<AnyContent>))}
      ${this._imageField('Infographic image', d.infographic_image, v => this._patch({ infographic_image: v } as Partial<AnyContent>), {
        hint: 'The full-size infographic graphic (renders in the body).',
      })}
      ${this._renderRelatedResources(d.related_resources, rr => this._patch({ related_resources: rr } as Partial<AnyContent>))}
    `
  }

  // ── QUIZ ──────────────────────────────────────────────────────────────────────
  // Matches Quiz.cs. quizType selects which fields are relevant per answer:
  //   • tiered          → pointValue + typeOption (range-based)
  //   • knowledge       → isCorrect (right/wrong)
  //   • classification  → typeOption (result bucket)

  private _renderQuiz(d: Quiz): TemplateResult {
    const quizType = d.quizType
    const showPoints = quizType === 'tiered'
    const showCorrect = quizType === 'knowledge'
    const showRange = quizType === 'tiered'
    const showTypeOption = quizType === 'tiered' || quizType === 'classification'

    const patchQ = (qi: number, patch: Partial<QuizQuestion>) => {
      const questions = d.questions.map((q, j) => j === qi ? { ...q, ...patch } : q)
      this._patch({ questions } as Partial<AnyContent>)
    }
    const patchAns = (qi: number, ai: number, patch: Partial<QuizAnswer>) => {
      const questions = d.questions.map((q, j) => j !== qi ? q : {
        ...q, answers: q.answers.map((a, k) => k === ai ? { ...a, ...patch } : a),
      })
      this._patch({ questions } as Partial<AnyContent>)
    }
    const patchCrit = (ci: number, patch: Partial<QuizRubricCriterion>) => {
      const criteria = d.rubric.criteria.map((c, j) => j === ci ? { ...c, ...patch } : c)
      this._patch({ rubric: { ...d.rubric, criteria } } as Partial<AnyContent>)
    }

    const quizTypeOpts: Array<{ v: QuizType; l: string }> = [
      { v: 'classification', l: 'Classification (personality / buckets)' },
      { v: 'tiered',         l: 'Tiered (scored range → level)' },
      { v: 'knowledge',      l: 'Knowledge (right / wrong)' },
    ]
    const typeOptOpts = TYPE_OPTIONS.map(t => ({ v: t, l: t }))

    return html`
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), { placeholder: 'Quiz title', field: 'title' })}
      ${this._inp('Intro paragraph', d.intro_paragraph, v => this._patch({ intro_paragraph: v } as Partial<AnyContent>), {
        multiline: true, rows: 2, placeholder: '1-2 sentences. Friendly, low-pressure.',
      })}
      ${this._select('Quiz type', quizType, quizTypeOpts as Array<{v:string;l:string}>, v => this._patch({ quizType: v as QuizType } as Partial<AnyContent>))}

      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Questions', d.questions.length)}
        <div class="${SECTION_BODY}">
          ${d.questions.map((q, qi) => html`
            <div class="${CARD_CLS}">
              <div class="${CARD_HDR}">
                <span class="text-[12px] font-semibold text-gray-600">Question ${qi + 1}</span>
                ${this._delBtn(() => this._patch({ questions: d.questions.filter((_, j) => j !== qi) } as Partial<AnyContent>))}
              </div>
              <div class="${CARD_BODY}">
                ${this._inp('Question text', q.questionText, v => patchQ(qi, { questionText: v }), {
                  multiline: true, rows: 2, placeholder: 'Relatable, specific question…', field: `questions[${qi}].questionText`,
                })}
                <div class="grid grid-cols-2 gap-2">
                  ${this._inp('Tip', q.tip, v => patchQ(qi, { tip: v }), { placeholder: 'Optional hint for the user' })}
                  ${this._inp('Explanation', q.explanation, v => patchQ(qi, { explanation: v }), { placeholder: 'Optional post-answer explanation' })}
                </div>

                <label class="${LABEL}">Answers</label>
                ${q.answers.map((a, ai) => html`
                  <div class="border border-gray-100 rounded-lg p-3 bg-gray-50/40 flex flex-col gap-2">
                    <div class="flex items-start gap-2">
                      <span class="text-[11px] font-semibold text-gray-400 w-5 shrink-0 mt-2">${ai + 1}.</span>
                      <input class="${INPUT_CLS} flex-1" .value=${a.answerText} placeholder="Answer text…" ?disabled=${this.disabled}
                        @input=${(e: Event) => patchAns(qi, ai, { answerText: (e.target as HTMLInputElement).value })}
                      />
                      ${this._delBtn(() => patchQ(qi, { answers: q.answers.filter((_, k) => k !== ai) }))}
                    </div>
                    <div class="grid grid-cols-${showRange ? '3' : '2'} gap-2 pl-7">
                      ${showTypeOption ? this._select('Type option', a.typeOption ?? 'A', typeOptOpts, v => patchAns(qi, ai, { typeOption: v as TypeOption })) : ''}
                      ${showPoints ? this._num('Points', a.pointValue, v => patchAns(qi, ai, { pointValue: v }), { placeholder: '1' }) : ''}
                      ${showCorrect ? html`
                        <div class="flex items-end">
                          ${this._toggle('Correct', !!a.isCorrect, v => patchAns(qi, ai, { isCorrect: v }))}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `)}
                ${this._addBtn('Add answer', () => {
                  const nextType = TYPE_OPTIONS[q.answers.length % TYPE_OPTIONS.length]
                  patchQ(qi, { answers: [...q.answers, emptyQuizAnswer(q.questionId, nextType)] })
                })}
              </div>
            </div>
          `)}
          ${this._addBtn('Add question', () => {
            this._patch({ questions: [...d.questions, emptyQuizQuestion()] } as Partial<AnyContent>)
          })}
        </div>
      </div>

      <div class="${SECTION_WRAP}">
        ${this._sectionHead('Rubric / results', d.rubric.criteria.length)}
        <div class="${SECTION_BODY}">
          ${d.rubric.criteria.map((c, ci) => html`
            <div class="${CARD_CLS}">
              <div class="${CARD_HDR}">
                <span class="text-[12px] font-semibold text-gray-600">${c.label || `Result ${ci + 1}`}</span>
                ${this._delBtn(() => this._patch({ rubric: { ...d.rubric, criteria: d.rubric.criteria.filter((_, j) => j !== ci) } } as Partial<AnyContent>))}
              </div>
              <div class="${CARD_BODY}">
                ${this._imageField('Result image', c.image, v => patchCrit(ci, { image: v }))}
                ${this._inp('Label', c.label, v => patchCrit(ci, { label: v }), { placeholder: 'e.g. "The Strategist"' })}
                ${this._inp('Result text', c.resultText, v => patchCrit(ci, { resultText: v }), {
                  multiline: true, rows: 3, placeholder: '3-4 sentences. Specific, empowering.',
                })}
                ${this._inp('Next move', c.nextMove, v => patchCrit(ci, { nextMove: v }), {
                  multiline: true, rows: 2, placeholder: 'What this person should do next.',
                })}
                <div class="grid grid-cols-3 gap-2">
                  ${this._select('Type option', c.typeOption ?? 'A', typeOptOpts, v => patchCrit(ci, { typeOption: v as TypeOption }))}
                  ${showRange ? this._num('Score start', c.start, v => patchCrit(ci, { start: v }), { placeholder: '0' }) : html`<div></div>`}
                  ${showRange ? this._num('Score end', c.end, v => patchCrit(ci, { end: v }), { placeholder: '10' }) : html`<div></div>`}
                </div>
                ${this._toggle('Allow more than one match', !!c.isMoreThanOne, v => patchCrit(ci, { isMoreThanOne: v }))}
              </div>
            </div>
          `)}
          ${this._addBtn('Add result', () => {
            const nextType = TYPE_OPTIONS[d.rubric.criteria.length % TYPE_OPTIONS.length]
            this._patch({ rubric: { ...d.rubric, criteria: [...d.rubric.criteria, emptyQuizCriterion(nextType)] } } as Partial<AnyContent>)
          })}
        </div>
      </div>
    `
  }

  // ── USER STORY ────────────────────────────────────────────────────────────────
  // Simplified: thumbnail + title + subtitle + copy + related.

  private _renderUserStory(d: UserStory): TemplateResult {
    return html`
      ${this._imageField('Thumbnail image', d.thumbnail_image, v => this._patch({ thumbnail_image: v } as Partial<AnyContent>))}
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), {
        placeholder: 'Story title (e.g. How Maria paid off $42K)', field: 'title',
      })}
      ${this._inp('Subtitle', d.subtitle, v => this._patch({ subtitle: v } as Partial<AnyContent>), {
        placeholder: 'Supporting line / emotional hook',
      })}
      ${this._inp('Copy', d.copy, v => this._patch({ copy: v } as Partial<AnyContent>), {
        multiline: true, rows: 8, placeholder: 'Full story body (HTML ok — custom tags preserved)', field: 'copy',
      })}
      ${this._renderRelatedResources(d.related_resources, rr => this._patch({ related_resources: rr } as Partial<AnyContent>))}
    `
  }

  // ── VIDEO ─────────────────────────────────────────────────────────────────────
  // Simplified: thumbnail + title + copy + reference_link (Vimeo id) + related.

  private _renderVideo(d: Video): TemplateResult {
    return html`
      ${this._imageField('Thumbnail image', d.thumbnail_image, v => this._patch({ thumbnail_image: v } as Partial<AnyContent>))}
      ${this._inp('Title', d.title, v => this._patch({ title: v } as Partial<AnyContent>), { placeholder: 'Video title (max 65 chars)', field: 'title' })}
      ${this._inp('Copy', d.copy, v => this._patch({ copy: v } as Partial<AnyContent>), {
        multiline: true, rows: 5, placeholder: 'Video description (HTML ok)', field: 'copy',
      })}
      ${this._inp('Reference link / Vimeo ID', d.reference_link, v => this._patch({ reference_link: v } as Partial<AnyContent>), {
        placeholder: 'Vimeo ID or full URL',
        hint: 'Paste the Vimeo ID (e.g. 123456789) or the full video URL.',
      })}
      ${this._renderRelatedResources(d.related_resources, rr => this._patch({ related_resources: rr } as Partial<AnyContent>))}
    `
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  override render() {
    if (!this.data) {
      return html`<div class="flex items-center justify-center min-h-[10rem] text-[14px] text-gray-400">No content loaded.</div>`
    }

    const d = this.data
    let typeFields: TemplateResult

    switch (d.content_type) {
      case 'article':        typeFields = this._renderArticle(d as Article); break
      case 'money_tip':      typeFields = this._renderMoneyTip(d as MoneyTip); break
      case 'calculator':     typeFields = this._renderCalculator(d as Calculator); break
      case 'checklist':      typeFields = this._renderChecklist(d as Checklist); break
      case 'expert_insight': typeFields = this._renderExpertInsight(d as ExpertInsight); break
      case 'infographic':    typeFields = this._renderInfographic(d as Infographic); break
      case 'quiz':           typeFields = this._renderQuiz(d as Quiz); break
      case 'user_story':     typeFields = this._renderUserStory(d as UserStory); break
      case 'video':          typeFields = this._renderVideo(d as Video); break
      default: {
        const unknownType = (d as { content_type: string }).content_type
        typeFields = html`<p class="text-gray-400 text-[13px]">Unknown content type: ${unknownType}</p>`
      }
    }

    // Show a compact error summary at top — only fields with errors, grouped.
    // This reinforces the red borders below without duplicating every message.
    const blocking = this.validationErrors.filter(e => e.severity === 'blocking')
    const warnings = this.validationErrors.filter(e => e.severity === 'warning')
    const summary = (blocking.length > 0 || warnings.length > 0) ? html`
      <details ?open=${blocking.length > 0} class="rounded-lg border ${
        blocking.length > 0 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
      } overflow-hidden">
        <summary class="flex items-center justify-between px-4 py-2 cursor-pointer select-none">
          <span class="text-[12px] font-semibold ${
            blocking.length > 0 ? 'text-red-700' : 'text-amber-800'
          }">
            ${blocking.length > 0
              ? `${blocking.length} issue${blocking.length !== 1 ? 's' : ''} to fix`
              : `${warnings.length} suggestion${warnings.length !== 1 ? 's' : ''}`
            }
          </span>
          <span class="text-[11px] ${
            blocking.length > 0 ? 'text-red-600' : 'text-amber-700'
          }">Expand ↓</span>
        </summary>
        <ul class="px-4 py-2 space-y-1 text-[12px]">
          ${blocking.map(e => html`
            <li class="flex items-start gap-2">
              <span class="mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
              <span class="text-red-800">${e.message}</span>
            </li>
          `)}
          ${warnings.map(e => html`
            <li class="flex items-start gap-2">
              <span class="mt-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
              <span class="text-amber-800">${e.message}</span>
            </li>
          `)}
        </ul>
      </details>
    ` : ''

    return html`
      <div class="flex flex-col gap-4">
        ${summary}
        ${this._renderUniversal()}
        ${typeFields}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-structured-editor': FFStructuredEditor }
}
