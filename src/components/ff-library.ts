import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { AUDIENCE_LABELS, TYPE_LABELS } from '../lib/api'
import type { ContentEntry, ContentStatus } from '../lib/store'

/**
 * Library view: list of saved drafts with search + filter.
 * Emits:
 *   - 'open-entry'   detail: ContentEntry  → load this draft into the editor
 *   - 'delete-entry' detail: string (id)
 *   - 'seed-demo'    detail: null          → seed 20 fake entries
 *   - 'new-content'  detail: null          → switch to the New tab fresh
 */

const STATUS_PILL: Record<ContentStatus, string> = {
  draft:     'bg-gray-100 text-gray-500',
  in_review: 'bg-amber-100 text-amber-800',
  approved:  'bg-blue-100 text-blue-800',
  published: 'bg-emerald-100 text-emerald-800',
  trash:     'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft:     'Draft',
  in_review: 'In Review',
  approved:  'Approved',
  published: 'Published',
  trash:     'Trash',
}

@customElement('ff-library')
export class FFLibrary extends LitElement {
  override createRenderRoot() { return this }

  @property({ type: Array }) entries: ContentEntry[] = []
  @property() currentUser = ''

  @state() private _search = ''
  @state() private _typeFilter = 'all'
  @state() private _statusFilter: 'all' | ContentStatus = 'all'
  @state() private _audienceFilter = 'all'
  @state() private _view: 'all' | 'queue' = 'all'
  @state() private _selectedIds = new Set<string>()
  @state() private _expandedGroups = new Set<string>()

  // Group key: items sharing the same slug + title are variants (different
  // region / client / language / status) and collapse into one expandable row.
  private _groupKey(e: ContentEntry): string {
    return `${(e.slug ?? '').toLowerCase()}|${(e.title ?? '').toLowerCase().trim()}`
  }

  private _toggleGroup(key: string, ev: Event) {
    ev.stopPropagation()
    const next = new Set(this._expandedGroups)
    if (next.has(key)) next.delete(key); else next.add(key)
    this._expandedGroups = next
  }

  private _emit<T>(name: string, detail: T) {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true }))
  }

  private get _counts(): Record<string, number> {
    const c: Record<string, number> = { all: 0, draft: 0, in_review: 0, approved: 0, published: 0, trash: 0 }
    for (const e of this.entries) {
      if (e.status !== 'trash') c.all++
      c[e.status] = (c[e.status] ?? 0) + 1
    }
    return c
  }

  private get _filtered(): ContentEntry[] {
    const q = this._search.trim().toLowerCase()
    return this.entries.filter(e => {
      if (this._view === 'queue') {
        if (!this.currentUser) return false
        if (e.assignee !== this.currentUser) return false
        // My queue never shows trash
        if (e.status === 'trash') return false
      }
      if (this._statusFilter === 'all') {
        if (e.status === 'trash') return false
      } else {
        if (e.status !== this._statusFilter) return false
      }
      if (this._typeFilter !== 'all') {
        const t = e.contentType === 'coach_insight' ? 'expert_insight' : e.contentType
        if (t !== this._typeFilter) return false
      }
      if (this._audienceFilter !== 'all' && e.audience !== this._audienceFilter) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        e.topic.toLowerCase().includes(q) ||
        (e.promptNotes ?? '').toLowerCase().includes(q) ||
        e.output.toLowerCase().includes(q) ||
        (e.author ?? '').toLowerCase().includes(q) ||
        (e.assignee ?? '').toLowerCase().includes(q) ||
        (e.excerpt ?? '').toLowerCase().includes(q) ||
        (e.categories ?? []).some(c => c.toLowerCase().includes(q))
      )
    })
  }

  private _toggleSelect(id: string, ev: Event) {
    ev.stopPropagation()
    const next = new Set(this._selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    this._selectedIds = next
  }

  private _clearSelection() { this._selectedIds = new Set() }

  private _bulkStatus(status: ContentStatus) {
    const ids = Array.from(this._selectedIds)
    if (!ids.length) return
    this._emit('bulk-status', { ids, status })
    this._selectedIds = new Set()
  }

  private _queueCount(): number {
    if (!this.currentUser) return 0
    return this.entries.filter(e => e.assignee === this.currentUser && e.status !== 'trash').length
  }

  private _formatDate(ms: number): string {
    const d = new Date(ms)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  private _regionLabel(r: string): string {
    if (!r) return '—'
    const map: Record<string, string> = {
      'United States': 'us', 'USA': 'us', 'US': 'us',
      'Canada': 'ca', 'CA': 'ca',
      'United Kingdom': 'uk', 'UK': 'uk',
    }
    return map[r] ?? r.toLowerCase()
  }

  private _languageLabel(l: string): string {
    if (!l) return '—'
    const map: Record<string, string> = {
      'English': 'en', 'Spanish': 'es', 'French': 'fr', 'German': 'de',
    }
    return map[l] ?? l.toLowerCase().slice(0, 2)
  }

  private _confirmDelete(e: Event, entry: ContentEntry) {
    e.stopPropagation()
    const msg = entry.status === 'trash'
      ? `Permanently delete "${entry.title}"? This can't be undone.`
      : `Move "${entry.title}" to Trash? You have 30 days to restore it.`
    if (window.confirm(msg)) this._emit('delete-entry', entry.id)
  }

  private _restore(e: Event, entry: ContentEntry) {
    e.stopPropagation()
    this._emit('restore-entry', entry.id)
  }

  private _confirmEmptyTrash() {
    const count = this.entries.filter(x => x.status === 'trash').length
    if (count === 0) return
    if (window.confirm(`Permanently delete all ${count} item${count !== 1 ? 's' : ''} in Trash? This can't be undone.`)) {
      this._emit('empty-trash', null)
    }
  }

  private _renderStatusChips() {
    const counts = this._counts
    const chips: Array<{ key: 'all' | ContentStatus; label: string }> = [
      { key: 'all', label: 'All' },
      { key: 'draft', label: 'Draft' },
      { key: 'in_review', label: 'In Review' },
      { key: 'approved', label: 'Approved' },
      { key: 'published', label: 'Published' },
      { key: 'trash', label: 'Trash' },
    ]
    return html`
      <div class="flex items-center gap-1.5 flex-wrap">
        ${chips.map(chip => {
          const active = this._statusFilter === chip.key
          const count = counts[chip.key] ?? 0
          return html`
            <button
              @click=${() => { this._statusFilter = chip.key }}
              class="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                active
                  ? 'bg-[#063853] text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }"
            >
              ${chip.label}
              <span class="text-[10px] opacity-75">${count}</span>
            </button>
          `
        })}
      </div>
    `
  }

  override render() {
    const filtered = this._filtered
    const total = this.entries.length
    const selCount = this._selectedIds.size
    const queueCount = this._queueCount()

    return html`
      <div class="flex flex-col h-full">

        <!-- Toolbar -->
        <div class="px-8 py-3 border-b border-gray-100 flex flex-col gap-3 shrink-0">
          <div class="flex items-center gap-4">
            <div class="flex-1 flex items-center gap-3">
              <!-- All vs My queue toggle -->
              <div class="flex items-center rounded-lg border border-gray-200 overflow-hidden shrink-0">
                <button
                  @click=${() => { this._view = 'all'; this._clearSelection() }}
                  class="text-[12px] font-semibold px-3 py-1.5 transition-colors ${
                    this._view === 'all' ? 'bg-[#063853] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }"
                >All content</button>
                <button
                  @click=${() => { this._view = 'queue'; this._clearSelection() }}
                  title=${this.currentUser ? `Items assigned to ${this.currentUser}` : 'Set your name in Details → Workflow'}
                  class="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 border-l border-gray-200 transition-colors ${
                    this._view === 'queue' ? 'bg-[#063853] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }"
                >
                  My queue
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    this._view === 'queue' ? 'bg-white/20' : 'bg-gray-100 text-gray-400'
                  }">${queueCount}</span>
                </button>
              </div>

              <div class="relative flex-1 max-w-md">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
                <input
                  type="text"
                  .value=${this._search}
                  @input=${(e: Event) => { this._search = (e.target as HTMLInputElement).value }}
                  placeholder="Search title, topic, author, category…"
                  class="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-gray-200 bg-white outline-none focus:border-gray-400"
                />
              </div>

              <select
                .value=${this._typeFilter}
                @change=${(e: Event) => { this._typeFilter = (e.target as HTMLSelectElement).value }}
                class="text-[13px] rounded-lg border border-gray-200 bg-white px-3 py-2 outline-none focus:border-gray-400 cursor-pointer"
              >
                <option value="all">All types</option>
                ${Object.entries(TYPE_LABELS).map(([k, v]) => html`
                  <option value=${k}>${v}</option>
                `)}
              </select>

              <select
                .value=${this._audienceFilter}
                @change=${(e: Event) => { this._audienceFilter = (e.target as HTMLSelectElement).value }}
                class="text-[13px] rounded-lg border border-gray-200 bg-white px-3 py-2 outline-none focus:border-gray-400 cursor-pointer"
                title="Filter by audience"
              >
                <option value="all">All audiences</option>
                ${Object.entries(AUDIENCE_LABELS).map(([k, v]) => html`
                  <option value=${k}>${v}</option>
                `)}
              </select>
            </div>

            <div class="flex items-center gap-3 shrink-0">
              <span class="text-[12px] text-gray-400">
                ${filtered.length} of ${total}
              </span>
              ${this._statusFilter === 'trash' && filtered.length > 0 ? html`
                <button
                  @click=${this._confirmEmptyTrash}
                  class="text-[12px] font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors"
                  title="Permanently delete everything in Trash"
                >Empty Trash</button>
              ` : ''}
              <button
                @click=${() => this._emit('new-content', null)}
                class="text-[12px] font-semibold text-white bg-[#063853] hover:bg-[#04293D] px-3 py-1.5 rounded-md transition-colors"
              >+ New content</button>
            </div>
          </div>

          ${this._renderStatusChips()}
        </div>

        <!-- Bulk action bar -->
        ${selCount > 0 ? html`
          <div class="px-8 py-2 bg-[#063853] text-white flex items-center justify-between shrink-0">
            <span class="text-[12px] font-semibold">${selCount} selected</span>
            <div class="flex items-center gap-2">
              <button @click=${() => this._bulkStatus('in_review')}
                class="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors">
                Move to In Review
              </button>
              <button @click=${() => this._bulkStatus('approved')}
                class="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors">
                Approve
              </button>
              <button @click=${() => this._bulkStatus('draft')}
                class="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors">
                Back to Draft
              </button>
              <button @click=${() => this._bulkStatus('trash')}
                class="text-[11px] font-semibold px-2.5 py-1 rounded bg-red-500/80 hover:bg-red-500 transition-colors">
                Move to Trash
              </button>
              <button @click=${() => this._clearSelection()}
                class="text-[11px] px-2 py-1 text-white/70 hover:text-white transition-colors">
                Clear
              </button>
            </div>
          </div>
        ` : ''}

        <!-- List -->
        <div class="flex-1 overflow-y-auto scrollbar-thin">
          ${this._statusFilter === 'trash' && filtered.length > 0 ? html`
            <div class="px-8 py-2 bg-red-50 border-b border-red-100 text-[11px] text-red-700">
              Trash empties automatically after 30 days.
            </div>
          ` : ''}
          ${total === 0 ? this._renderEmptyState() : ''}
          ${total > 0 && filtered.length === 0 ? html`
            <div class="text-center py-16 text-[13px] text-gray-400">
              No saved content matches your filters.
            </div>
          ` : ''}

          ${this._view === 'queue' && filtered.length === 0 && total > 0 ? html`
            <div class="text-center py-16 text-[13px] text-gray-400">
              ${this.currentUser
                ? html`<p>Nothing assigned to ${this.currentUser} right now.</p>
                  <p class="text-[11px] text-gray-300 mt-2">Open any draft and use Details → Workflow to assign it.</p>`
                : html`<p>Tell the app who you are first.</p>
                  <p class="text-[11px] text-gray-300 mt-2">Open any draft and set "Signed in as" in the Workflow card.</p>`}
            </div>
          ` : ''}
          ${filtered.length > 0 ? this._renderTable(filtered) : ''}
        </div>
      </div>
    `
  }

  private _renderTable(entries: ContentEntry[]) {
    // Group by slug+title. Variants (different region/client/language/status)
    // collapse into one expandable row.
    const groups = new Map<string, ContentEntry[]>()
    const order: string[] = []
    for (const e of entries) {
      const k = this._groupKey(e)
      if (!groups.has(k)) { groups.set(k, []); order.push(k) }
      groups.get(k)!.push(e)
    }

    // 6-col grid: title | categories | type | created | modified | action
    const grid = 'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.8fr)_120px_120px_120px_80px] items-center gap-4'

    return html`
      <div class="text-[13px]">
        <!-- Header -->
        <div class="${grid} px-8 py-3 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <div>Title</div>
          <div>Categories</div>
          <div>Type</div>
          <div>Created</div>
          <div>Modified</div>
          <div class="text-right">Action</div>
        </div>

        <!-- Rows -->
        <div class="divide-y divide-gray-100">
          ${(() => {
            // Auto-expand all multi-variant groups while a search is active so
            // matches inside collapsed groups don't get hidden.
            const autoExpand = this._search.trim().length > 0
            return order.map(k => {
              const items = groups.get(k)!
              // Newest variant represents the group in the parent row.
              const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
              const head = sorted[0]
              const isGroup = items.length > 1
              const expanded = autoExpand || this._expandedGroups.has(k)
              return isGroup
                ? this._renderGroupedRow(k, head, sorted, expanded, grid)
                : this._renderSingleRow(head, grid)
            })
          })()}
        </div>
      </div>
    `
  }

  private _categoriesText(e: ContentEntry): string {
    const cats = (e.categories ?? []).map(c => {
      // Show just the leaf segment when paths are present (e.g., "Debt/Borrowing Money" → "Borrowing Money").
      const segs = c.split('/').map(s => s.trim()).filter(Boolean)
      return segs[segs.length - 1] ?? c
    })
    return cats.length ? cats.join(' | ') : '—'
  }

  private _typeText(e: ContentEntry): string {
    // Image shows lowercase plain-text type ("article", "podcast", "biteSized").
    const rt = e.contentType === 'coach_insight' ? 'expert_insight' : e.contentType
    if (rt === 'expert_insight') return 'expert insight'
    if (rt === 'user_story')     return 'user story'
    if (rt === 'money_tip')      return 'money tip'
    return rt
  }

  private _renderSingleRow(entry: ContentEntry, grid: string) {
    const sel = this._selectedIds.has(entry.id)
    return html`
      <div class="group ${grid} px-8 py-3.5 hover:bg-gray-50/70 transition-colors ${sel ? 'bg-[#063853]/[0.03]' : ''}">
        <!-- Title cell with checkbox -->
        <div class="flex items-center gap-3 min-w-0">
          <input
            type="checkbox"
            .checked=${sel}
            @click=${(e: Event) => this._toggleSelect(entry.id, e)}
            class="shrink-0 accent-[#063853] cursor-pointer opacity-0 group-hover:opacity-100 ${sel ? 'opacity-100' : ''} transition-opacity"
            title="Select for bulk actions"
          />
          <button
            @click=${() => this._emit('open-entry', entry)}
            class="text-left text-[14px] font-semibold text-gray-900 hover:text-[#063853] truncate min-w-0"
            title=${entry.title}
          >${entry.title}</button>
        </div>
        <div class="text-[13px] text-gray-600 truncate" title=${this._categoriesText(entry)}>
          ${this._categoriesText(entry)}
        </div>
        <div class="text-[13px] text-gray-700">${this._typeText(entry)}</div>
        <div class="text-[13px] text-gray-500 tabular-nums">${this._formatDate(entry.createdAt)}</div>
        <div class="text-[13px] text-gray-500 tabular-nums">${this._formatDate(entry.updatedAt)}</div>
        <div class="flex items-center justify-end gap-2">
          ${entry.status === 'trash' ? html`
            <button
              @click=${(e: Event) => this._restore(e, entry)}
              class="text-[13px] font-semibold text-[#0070C0] hover:underline"
            >Restore</button>
          ` : html`
            <button
              @click=${() => this._emit('open-entry', entry)}
              class="text-[13px] font-semibold text-[#0070C0] hover:underline"
            >Edit</button>
          `}
          <button
            @click=${(e: Event) => this._confirmDelete(e, entry)}
            class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
            title=${entry.status === 'trash' ? 'Permanently delete' : 'Move to Trash'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3.5h10M5 3.5V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M5.5 6v4M8.5 6v4M3 3.5l.75 8a.5.5 0 00.5.5h5.5a.5.5 0 00.5-.5l.75-8"
                stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    `
  }

  private _renderGroupedRow(
    key: string,
    head: ContentEntry,
    items: ContentEntry[],
    expanded: boolean,
    grid: string,
  ) {
    // Group spans: earliest created, latest modified.
    const created  = Math.min(...items.map(i => i.createdAt))
    const modified = Math.max(...items.map(i => i.updatedAt))

    return html`
      <div>
        <!-- Group header row -->
        <div class="group ${grid} px-8 py-3.5 hover:bg-gray-50/70 transition-colors ${expanded ? 'bg-gray-50/40' : ''}">
          <div class="flex items-center gap-3 min-w-0">
            <button
              @click=${(e: Event) => this._toggleGroup(key, e)}
              class="shrink-0 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-transform ${expanded ? 'rotate-90' : ''}"
              title=${expanded ? 'Collapse variants' : 'Expand variants'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M3 1.5l3.5 3.5L3 8.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button
              @click=${(e: Event) => this._toggleGroup(key, e)}
              class="text-left text-[14px] font-semibold text-gray-900 hover:text-[#063853] truncate min-w-0"
              title=${head.title}
            >${head.title}</button>
            <span class="shrink-0 text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
              ${items.length}
            </span>
          </div>
          <div class="text-[13px] text-gray-600 truncate" title=${this._categoriesText(head)}>
            ${this._categoriesText(head)}
          </div>
          <div class="text-[13px] text-gray-700">${this._typeText(head)}</div>
          <div class="text-[13px] text-gray-500 tabular-nums">${this._formatDate(created)}</div>
          <div class="text-[13px] text-gray-500 tabular-nums">${this._formatDate(modified)}</div>
          <div class="flex items-center justify-end">
            <button
              @click=${(e: Event) => this._toggleGroup(key, e)}
              class="flex items-center gap-1 text-[13px] font-semibold text-[#0070C0] hover:underline"
            >
              ${expanded ? 'Collapse' : 'Expand'}
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" class="transition-transform ${expanded ? 'rotate-180' : ''}">
                <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Expanded variants -->
        ${expanded ? html`
          <div class="bg-gray-50/60 border-t border-gray-100">
            ${items.map(v => this._renderVariantRow(v))}
          </div>
        ` : ''}
      </div>
    `
  }

  private _renderVariantRow(entry: ContentEntry) {
    // Pipe-separated meta strip mirrors the screenshot: Type, Status, Region, Language, Edit.
    return html`
      <div class="group flex items-center px-8 py-2.5 pl-[3.75rem] hover:bg-white transition-colors">
        <div class="flex-1 min-w-0 text-[13px] text-gray-700 font-medium truncate">${entry.title}</div>
        <div class="flex items-center gap-6 text-[12px] text-gray-500 shrink-0">
          <span><span class="text-gray-400">Type:</span> <span class="text-gray-700">${this._typeText(entry)}</span></span>
          <span class="flex items-center gap-1.5">
            <span class="text-gray-400">Status:</span>
            <span class="inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_PILL[entry.status] ?? STATUS_PILL.draft}">
              ${STATUS_LABELS[entry.status] ?? entry.status}
            </span>
          </span>
          <span><span class="text-gray-400">Region:</span> <span class="text-gray-700">${this._regionLabel(entry.region)}</span></span>
          <span><span class="text-gray-400">Language:</span> <span class="text-gray-700">${this._languageLabel(entry.language)}</span></span>
          ${entry.client ? html`
            <span class="truncate max-w-[160px]"><span class="text-gray-400">Client:</span> <span class="text-gray-700">${entry.client}</span></span>
          ` : ''}
        </div>
        <div class="ml-6 shrink-0">
          <button
            @click=${() => this._emit('open-entry', entry)}
            class="text-[13px] font-semibold text-[#0070C0] hover:underline"
          >Edit</button>
        </div>
      </div>
    `
  }

  private _renderEmptyState() {
    return html`
      <div class="flex flex-col items-center justify-center text-center py-20">
        <p class="text-[17px] text-[#383838] font-light">Your saved content will appear here.</p>
        <p class="text-[13px] text-[#383838] mt-2 max-w-sm">
          Generate a draft on the New tab and save it here.
        </p>
        <div class="flex items-center gap-3 mt-6">
          <button
            @click=${() => this._emit('new-content', null)}
            class="text-[13px] font-semibold text-white bg-[#063853] hover:bg-[#04293D] px-4 py-2 rounded-md transition-colors"
          >+ New content</button>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ff-library': FFLibrary }
}
