// Local content library — saved drafts persisted in localStorage.
// Each entry captures everything needed to re-open a piece in the editor.

import type { ExpertSource } from './api'

const STORAGE_KEY = 'ff_content_library_v1'

export type ContentStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'trash'

export interface ContentSource {
  title: string
  url: string
  note: string
}

export interface ContentEntry {
  id: string
  title: string
  contentType: string
  audience: string
  topic: string
  promptNotes: string           // formerly `notes`; instructions to the model
  expertSources: ExpertSource[]
  output: string                // the generated/edited short body
  createdAt: number
  updatedAt: number
  // CMS fields
  status: ContentStatus
  publishedAt: number | null
  author: string
  slug: string
  region: string
  language: string
  client: string
  excerpt: string
  documentNotes: string         // doc-level notes, owned by Meta tab
  referenceLink: string
  mimeType: 'HTML' | 'Markdown' | 'Plain Text'
  priority: number              // 0–100
  excludeClients: string[]
  showInLibrary: boolean
  redirect: string
  source: string
  paidContent: boolean
  legacyId: string
  excludeSmartBenefits: boolean
  categories: string[]          // hierarchical paths: "Debt/Borrowing Money"
  curatedCategories: string[]
  seoArticle: string            // long-form Context article, independent of `output`
  seoSourceOutput: string       // snapshot of `output` when `seoArticle` was last generated — drives "stale" detection
  sources: ContentSource[]      // references/citations for this piece
  // Workflow
  assignee: string              // name/email of reviewer — drives "My queue"
  reviewNotes: string           // most recent review message; shown as banner when in_review
  // Trash retention
  deletedAt: number | null      // set when status flips to 'trash'; drives 30-day auto-purge
}

// Trash retention window — anything older than this is hard-deleted on load.
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

// ── Current user (local) ──────────────────────────────────────────────────────
// Lightweight "who am I" used by My queue and assignee dropdown. Stored in
// localStorage until a real auth layer lands.

const CURRENT_USER_KEY = 'ff_current_user_v1'

export function getCurrentUser(): string {
  return localStorage.getItem(CURRENT_USER_KEY) ?? ''
}

export function setCurrentUser(name: string): void {
  localStorage.setItem(CURRENT_USER_KEY, name)
}

// Known assignees = every name that has ever been an author or assignee.
// Cheap MVP before an auth layer: lets the picker suggest teammates.
export function knownAssignees(): string[] {
  const set = new Set<string>()
  for (const e of loadAll()) {
    if (e.author?.trim()) set.add(e.author.trim())
    if (e.assignee?.trim()) set.add(e.assignee.trim())
  }
  const me = getCurrentUser().trim()
  if (me) set.add(me)
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function deriveSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100)
}

// Migrate a raw stored object (any shape) into a full ContentEntry.
function migrate(raw: Record<string, unknown>): ContentEntry {
  const promptNotes =
    typeof raw.promptNotes === 'string' ? raw.promptNotes :
    typeof raw.notes === 'string' ? raw.notes : ''
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? 'Untitled draft',
    contentType: (raw.contentType as string) ?? 'article',
    audience: (raw.audience as string) ?? 'all',
    topic: (raw.topic as string) ?? '',
    promptNotes,
    expertSources: (raw.expertSources as ExpertSource[]) ?? [{ insight: '', name: '', image: '' }],
    output: (raw.output as string) ?? '',
    createdAt: (raw.createdAt as number) ?? Date.now(),
    updatedAt: (raw.updatedAt as number) ?? Date.now(),
    status: (raw.status as ContentStatus) ?? 'draft',
    publishedAt: (raw.publishedAt as number | null) ?? null,
    author: (raw.author as string) ?? '',
    slug: (raw.slug as string) || deriveSlug((raw.topic as string) ?? ''),
    region: (raw.region as string) ?? 'United States',
    language: (raw.language as string) ?? 'English',
    client: Array.isArray(raw.client)
      ? (raw.client as string[]).join(', ')
      : (raw.client as string) ?? '',
    excerpt: (raw.excerpt as string) ?? '',
    documentNotes: (raw.documentNotes as string) ?? '',
    referenceLink: (raw.referenceLink as string) ?? '',
    mimeType: (raw.mimeType as ContentEntry['mimeType']) ?? 'HTML',
    priority: (raw.priority as number) ?? 0,
    excludeClients: (raw.excludeClients as string[]) ?? [],
    showInLibrary: typeof raw.showInLibrary === 'boolean' ? raw.showInLibrary : true,
    redirect: (raw.redirect as string) ?? '',
    source: (raw.source as string) ?? 'Financial Finesse',
    paidContent: (raw.paidContent as boolean) ?? false,
    legacyId: (raw.legacyId as string) ?? '',
    excludeSmartBenefits: (raw.excludeSmartBenefits as boolean) ?? false,
    categories: (raw.categories as string[]) ?? [],
    curatedCategories: (raw.curatedCategories as string[]) ?? [],
    seoArticle: (raw.seoArticle as string) ?? '',
    seoSourceOutput: (raw.seoSourceOutput as string) ?? '',
    sources: Array.isArray(raw.sources) ? (raw.sources as ContentSource[]) : [],
    assignee: (raw.assignee as string) ?? '',
    reviewNotes: (raw.reviewNotes as string) ?? '',
    deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : null,
  }
}

function safeParse(raw: string | null): ContentEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(item => migrate(item as Record<string, unknown>))
  } catch {
    return []
  }
}

export function loadAll(): ContentEntry[] {
  const all = safeParse(localStorage.getItem(STORAGE_KEY))
  // Auto-purge trashed entries older than the retention window.
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const kept = all.filter(e => !(e.status === 'trash' && e.deletedAt !== null && e.deletedAt < cutoff))
  if (kept.length !== all.length) persist(kept)
  return kept.sort((a, b) => b.updatedAt - a.updatedAt)
}

function persist(entries: ContentEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function getById(id: string): ContentEntry | null {
  return loadAll().find(e => e.id === id) ?? null
}

export interface SaveInput {
  contentType: string
  audience: string
  topic: string
  promptNotes: string
  expertSources: ExpertSource[]
  output: string
  region?: string
  language?: string
}

const ENTRY_DEFAULTS: Omit<ContentEntry, 'id' | 'title' | 'contentType' | 'audience' | 'topic' | 'promptNotes' | 'expertSources' | 'output' | 'createdAt' | 'updatedAt'> = {
  status: 'draft',
  publishedAt: null,
  author: '',
  slug: '',
  region: 'United States',
  language: 'English',
  client: '',
  excerpt: '',
  documentNotes: '',
  referenceLink: '',
  mimeType: 'HTML',
  priority: 0,
  excludeClients: [],
  showInLibrary: true,
  redirect: '',
  source: 'Financial Finesse',
  paidContent: false,
  legacyId: '',
  excludeSmartBenefits: false,
  categories: [],
  curatedCategories: [],
  seoArticle: '',
  seoSourceOutput: '',
  sources: [],
  assignee: '',
  reviewNotes: '',
  deletedAt: null,
}

export function createEntry(input: SaveInput): ContentEntry {
  const now = Date.now()
  const entry: ContentEntry = {
    ...ENTRY_DEFAULTS,
    id: newId(),
    title: deriveTitle(input.topic, input.output),
    contentType: input.contentType,
    audience: input.audience,
    topic: input.topic,
    promptNotes: input.promptNotes,
    expertSources: input.expertSources,
    output: input.output,
    slug: deriveSlug(input.topic),
    createdAt: now,
    updatedAt: now,
    ...(input.region ? { region: input.region } : {}),
    ...(input.language ? { language: input.language } : {}),
  }
  const all = loadAll()
  all.unshift(entry)
  persist(all)
  return entry
}

export function updateEntry(id: string, input: SaveInput): ContentEntry | null {
  const all = loadAll()
  const idx = all.findIndex(e => e.id === id)
  if (idx === -1) return null
  const updated: ContentEntry = {
    ...all[idx],
    contentType: input.contentType,
    audience: input.audience,
    topic: input.topic,
    promptNotes: input.promptNotes,
    expertSources: input.expertSources,
    output: input.output,
    title: deriveTitle(input.topic, input.output) || all[idx].title,
    updatedAt: Date.now(),
  }
  all[idx] = updated
  persist(all)
  return updated
}

export function patchEntry(id: string, patch: Partial<ContentEntry>): ContentEntry | null {
  const all = loadAll()
  const idx = all.findIndex(e => e.id === id)
  if (idx === -1) return null
  const current = all[idx]
  const merged: Partial<ContentEntry> = { ...patch }
  // Auto-maintain deletedAt when status changes through this function.
  if (patch.status !== undefined) {
    if (patch.status === 'trash' && current.status !== 'trash') {
      merged.deletedAt = Date.now()
    } else if (patch.status !== 'trash' && current.status === 'trash') {
      merged.deletedAt = null
    }
  }
  const updated: ContentEntry = { ...current, ...merged, updatedAt: Date.now() }
  all[idx] = updated
  persist(all)
  return updated
}

/**
 * Soft delete: move to Trash. Entries stay recoverable for 30 days and then
 * auto-purge on the next load. Use `permanentlyDelete` to skip the Trash.
 */
export function deleteEntry(id: string): void {
  const all = loadAll()
  const idx = all.findIndex(e => e.id === id)
  if (idx === -1) return
  const entry = all[idx]
  // If already in Trash, hard delete (user emptied a specific item).
  if (entry.status === 'trash') {
    persist(all.filter(e => e.id !== id))
    return
  }
  all[idx] = { ...entry, status: 'trash', deletedAt: Date.now(), updatedAt: Date.now() }
  persist(all)
}

/** Hard-delete a specific entry, bypassing Trash. */
export function permanentlyDelete(id: string): void {
  persist(loadAll().filter(e => e.id !== id))
}

/** Restore a trashed entry back to draft. */
export function restoreEntry(id: string): ContentEntry | null {
  return patchEntry(id, { status: 'draft', deletedAt: null })
}

/** Permanently delete every entry currently in Trash. */
export function emptyTrash(): number {
  const all = loadAll()
  const keep = all.filter(e => e.status !== 'trash')
  const removed = all.length - keep.length
  if (removed > 0) persist(keep)
  return removed
}

export function clearAll(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// ── One-time seed purge ───────────────────────────────────────────────────────
// Removes any demo entries that were seeded by the old seedDemoEntries function.
// Runs once per browser (guarded by a version flag) so real user content is untouched.

const SEED_PURGE_KEY = 'ff_seed_purged_v1'

const SEED_TOPICS_SET = new Set([
  'Building a 6-month emergency fund without burning out',
  'What to do first when you lose your job',
  'Backdoor Roth IRA mechanics for high earners',
  'Round up purchases to pay down debt faster',
  'Use the 24-hour rule to stop impulse buys',
  'Negotiate one bill per quarter',
  'How much house can I actually afford?',
  'Roth vs. Traditional 401(k) breakeven',
  'New baby financial checklist',
  'Year-end financial checklist',
  'When to refinance a mortgage in a flat-rate environment',
  'How to think about concentrated stock from your employer',
  'The order of operations for your paycheck',
  'Where your $100 actually goes each month',
  'What kind of money personality are you?',
  'Are you on track for retirement?',
  'Maria paid off $42K of credit card debt in 3 years',
  'How James turned a windfall into early retirement runway',
  '3-minute explainer: how compound growth actually works',
  '60-second guide: what to cut first when money is tight',
])

export function purgeSeedEntries(): void {
  if (localStorage.getItem(SEED_PURGE_KEY)) return
  const all = loadAll()
  const filtered = all.filter(e => !SEED_TOPICS_SET.has(e.topic))
  if (filtered.length !== all.length) persist(filtered)
  localStorage.setItem(SEED_PURGE_KEY, '1')
}

// ── Hidden CMS entry tracking ─────────────────────────────────────────────────
// Tracks cms_ article IDs that the user has dismissed from the library.

const HIDDEN_KEY = 'ff_hidden_cms_v1'

export function hideEntry(id: string): void {
  const existing: string[] = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
  if (!existing.includes(id)) {
    existing.push(id)
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(existing))
  }
}

export function getHiddenIds(): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]'))
}

function deriveTitle(topic: string, output: string): string {
  const t = topic.trim()
  if (t) return t.length > 80 ? t.slice(0, 77) + '…' : t
  const firstLine = output.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const cleaned = firstLine.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '')
  if (!cleaned) return 'Untitled draft'
  return cleaned.length > 80 ? cleaned.slice(0, 77) + '…' : cleaned
}

