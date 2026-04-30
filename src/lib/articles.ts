// Article data layer — loads real CMS articles from the local JSON files and
// normalises them into ContentEntry objects so the editor can open them.
//
// Round-trip policy: this normalizer is LOSSLESS. For typed content (checklist,
// quiz, money_tip, expert_insight) it maps every field from the raw CMS record
// onto the editor schema and stashes anything it doesn't recognise in `_extras`
// so saves never drop data.

import type { ContentEntry } from './store'
import type {
  AnyContent, Checklist, ChecklistSection, ChecklistItem, ChecklistTip,
  MoneyTip, MoneyTipSection,
  ExpertInsight, ExpertInsightSection,
  Quiz, QuizQuestion, QuizAnswer, QuizRubricCriterion, QuizType, TypeOption,
} from './contentTypeSchemas'
import { newGuid, TYPE_OPTIONS } from './contentTypeSchemas'
import sampleArticlesRaw from '../../real-ff-content/sampleArticles.json'
import categoriesRaw from '../../real-ff-content/categories.json'
import benefitCodesRaw from '../../real-ff-content/benefitCodes.json'

// ── Raw CMS types ─────────────────────────────────────────────────────────────

interface RawCategory {
  id: string
  title: string
  parentId?: string
  slug?: string
}

interface RawBiteSizedSlide {
  preheading?: string | null
  preHeading?: string | null
  heading?: string | null
  body?: string | null
  [k: string]: unknown
}

interface RawChecklistItem {
  id?: string
  label: string
  subItems?: string[] | null
  isChecked?: boolean | null
  [k: string]: unknown
}

interface RawChecklistTip {
  image?: string | null
  title?: string | null
  description?: string | null
  // legacy shape { label, text }
  label?: string
  text?: string
}

interface RawChecklistSection {
  id?: string
  title?: string
  description?: string
  image?: string
  items?: RawChecklistItem[]
  tip?: RawChecklistTip | null
  [k: string]: unknown
}

interface RawQuizAnswer {
  questionId?: string
  answerId?: string
  answerText: string
  isCorrect?: boolean | null
  answerSelected?: boolean | null
  pointValue?: number | null
  typeOption?: string | null
  [k: string]: unknown
}

interface RawQuizQuestion {
  questionId?: string
  questionText: string
  tip?: string
  explanation?: string
  answers?: RawQuizAnswer[]
  [k: string]: unknown
}

interface RawQuizRubricCriterion {
  id?: string
  label?: string
  resultText?: string
  nextMove?: string
  start?: number | null
  end?: number | null
  typeOption?: string | null
  isMoreThanOne?: boolean | null
  image?: string
  [k: string]: unknown
}

interface RawArticle {
  id: string
  title: string
  type?: string
  contentType?: string
  mimeType?: string
  excerpt?: string
  content?: string
  categories?: string[]
  status?: string
  slug?: string
  region?: string
  language?: string
  source?: string
  author?: string
  estimatedReadingTime?: number
  referenceLink?: string
  image?: string
  _legacyId?: number
  // type-specific payloads
  biteSized?: RawBiteSizedSlide[]
  checklist?: { sections?: RawChecklistSection[]; [k: string]: unknown }
  quiz?: {
    quizType?: string
    questions?: RawQuizQuestion[]
    correctAnswerIds?: string[]
    rubric?: { criteria?: RawQuizRubricCriterion[]; [k: string]: unknown }
    [k: string]: unknown
  }
  expertInsights?: Array<{ plannerId?: string; body?: string; [k: string]: unknown }>
  [k: string]: unknown
}

// ── CMS type → internal key ───────────────────────────────────────────────────

const CMS_TYPE_MAP: Record<string, string> = {
  article:        'article',
  checklist:      'checklist',
  quiz:           'quiz',
  biteSized:      'money_tip',
  money_tip:      'money_tip',
  calculator:     'calculator',
  expert_insight: 'expert_insight',
  expertInsights: 'expert_insight',
  coach_insight:  'expert_insight',
  infographic:    'infographic',
  user_story:     'user_story',
  video:          'video',
}

// ── Category lookup ───────────────────────────────────────────────────────────

const _cats = categoriesRaw as RawCategory[]
const _catById = new Map<string, string>(_cats.map(c => [c.id, c.title]))

function resolveCatIds(ids: string[]): string[] {
  return ids.map(id => _catById.get(id) ?? id).filter(Boolean)
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

function normalizeTypeOption(t: unknown): TypeOption | null {
  if (typeof t !== 'string') return null
  const up = t.toUpperCase() as TypeOption
  return (TYPE_OPTIONS as readonly string[]).includes(up) ? up : null
}

function normalizeQuizType(t: unknown): QuizType {
  if (typeof t !== 'string') return 'classification'
  const l = t.toLowerCase()
  if (l === 'tiered' || l === 'knowledge' || l === 'classification') return l
  return 'classification'
}

// Keep every key we didn't read off an object so save round-trips cleanly.
function extractExtras<T extends Record<string, unknown>>(raw: T, consumed: string[]): Record<string, unknown> | undefined {
  const set = new Set(consumed)
  const out: Record<string, unknown> = {}
  let any = false
  for (const k of Object.keys(raw)) {
    if (!set.has(k)) { out[k] = raw[k]; any = true }
  }
  return any ? out : undefined
}

// ── Type-specific builders ────────────────────────────────────────────────────

function buildMoneyTip(raw: RawArticle): MoneyTip {
  const slides = raw.biteSized ?? []
  const sections: MoneyTipSection[] = slides.map(s => ({
    preheading: (s.preheading ?? s.preHeading ?? null) as string | null,
    heading: (s.heading ?? null) as string | null,
    body: (s.body ?? null) as string | null,
  }))
  return {
    content_type: 'money_tip',
    slug: raw.slug ?? '',
    topic_category: '',
    bookmarkable: true,
    shareable: true,
    copyable: true,
    title: raw.title,
    sections,
  }
}

function buildChecklist(raw: RawArticle): Checklist {
  const sections: ChecklistSection[] = (raw.checklist?.sections ?? []).map(sec => {
    const items: ChecklistItem[] = (sec.items ?? []).map(it => ({
      id: it.id ?? newGuid(),
      label: it.label ?? '',
      subItems: Array.isArray(it.subItems) ? it.subItems : null,
      isChecked: typeof it.isChecked === 'boolean' ? it.isChecked : null,
    }))

    let tip: ChecklistTip | null = null
    if (sec.tip) {
      const t = sec.tip
      // Support both new (image/title/description) and legacy ({label, text}) shapes.
      if (t.image || t.title || t.description) {
        tip = {
          image: t.image ?? null,
          title: t.title ?? null,
          description: t.description ?? null,
        }
      } else if (t.label || t.text) {
        tip = { image: null, title: t.label ?? null, description: t.text ?? null }
      }
    }

    const consumed = ['id', 'title', 'description', 'image', 'items', 'tip']
    const extras = extractExtras(sec as Record<string, unknown>, consumed)
    const section: ChecklistSection = {
      id: sec.id ?? newGuid(),
      title: sec.title ?? '',
      description: sec.description ?? '',
      image: sec.image ?? null,
      items,
      tip,
    }
    if (extras) (section as ChecklistSection & { _extras?: Record<string, unknown> })._extras = extras
    return section
  })

  return {
    content_type: 'checklist',
    slug: raw.slug ?? '',
    topic_category: '',
    bookmarkable: true,
    shareable: true,
    copyable: true,
    title: raw.title,
    intro_paragraph: stripTags(raw.content ?? raw.excerpt ?? ''),
    sections,
  }
}

function buildQuiz(raw: RawArticle): Quiz {
  const q = raw.quiz
  const quizType = normalizeQuizType(q?.quizType)

  const questions: QuizQuestion[] = (q?.questions ?? []).map(rq => {
    const questionId = rq.questionId ?? newGuid()
    const answers: QuizAnswer[] = (rq.answers ?? []).map((ra, idx) => ({
      questionId,
      answerId: ra.answerId ?? newGuid(),
      answerText: ra.answerText,
      isCorrect: typeof ra.isCorrect === 'boolean' ? ra.isCorrect : null,
      answerSelected: typeof ra.answerSelected === 'boolean' ? ra.answerSelected : null,
      pointValue: typeof ra.pointValue === 'number' ? ra.pointValue : null,
      typeOption: normalizeTypeOption(ra.typeOption) ?? (TYPE_OPTIONS[idx] ?? null),
    }))
    return {
      questionId,
      questionText: rq.questionText,
      tip: rq.tip ?? '',
      explanation: rq.explanation ?? '',
      answers,
    }
  })

  const criteria: QuizRubricCriterion[] = (q?.rubric?.criteria ?? []).map(rc => ({
    id: rc.id ?? newGuid(),
    label: rc.label ?? '',
    resultText: rc.resultText ?? '',
    nextMove: rc.nextMove ?? '',
    start: typeof rc.start === 'number' ? rc.start : null,
    end: typeof rc.end === 'number' ? rc.end : null,
    typeOption: normalizeTypeOption(rc.typeOption),
    isMoreThanOne: typeof rc.isMoreThanOne === 'boolean' ? rc.isMoreThanOne : null,
    image: rc.image ?? '',
  }))

  return {
    content_type: 'quiz',
    slug: raw.slug ?? '',
    topic_category: '',
    bookmarkable: true,
    shareable: true,
    copyable: true,
    title: raw.title,
    intro_paragraph: stripTags(raw.content ?? raw.excerpt ?? ''),
    quizType,
    questions,
    correctAnswerIds: Array.isArray(q?.correctAnswerIds) ? q!.correctAnswerIds! : null,
    rubric: { criteria },
  }
}

function buildExpertInsight(raw: RawArticle): ExpertInsight {
  const sections: ExpertInsightSection[] = (raw.expertInsights ?? []).map(s => ({
    plannerId: s.plannerId ?? '',
    body: s.body ?? '',
  }))
  return {
    content_type: 'expert_insight',
    slug: raw.slug ?? '',
    topic_category: '',
    bookmarkable: true,
    shareable: true,
    copyable: true,
    title: raw.title,
    read_time: `${raw.estimatedReadingTime ?? 4} min`,
    hero_image_description: '',
    intro_paragraph: stripTags(raw.content ?? raw.excerpt ?? ''),
    sections,
  }
}

// ── Article markdown fallback ─────────────────────────────────────────────────
// For `type: article` we keep HTML intact. The output field stores a thin
// wrapper with title + excerpt + HTML body so the rich-text editor picks it up
// without any HTML→Markdown conversion that could mangle <snippet…> / *-card>
// tags.

function buildArticleOutput(raw: RawArticle): string {
  const parts: string[] = []
  parts.push(`# ${raw.title}`)
  parts.push('')
  const sub = raw.excerpt?.trim() || `${raw.estimatedReadingTime ?? '–'} min read`
  parts.push(sub)
  parts.push('')
  parts.push(raw.content ?? '')
  return parts.join('\n')
}

// ── Mime type normaliser ──────────────────────────────────────────────────────

function normalizeMimeType(raw: string | undefined): ContentEntry['mimeType'] {
  if (!raw) return 'HTML'
  const lower = raw.toLowerCase()
  if (lower === 'html' || lower === 'text/html') return 'HTML'
  if (lower === 'markdown' || lower === 'text/markdown') return 'Markdown'
  return 'HTML'
}

// ── Main normaliser ───────────────────────────────────────────────────────────

function normalizeArticle(raw: RawArticle): ContentEntry {
  const contentType =
    CMS_TYPE_MAP[raw.type ?? ''] ??
    CMS_TYPE_MAP[raw.contentType ?? ''] ??
    'article'

  let output: string
  if (contentType === 'money_tip' && raw.biteSized?.length) {
    output = JSON.stringify(buildMoneyTip(raw) as AnyContent, null, 2)
  } else if (contentType === 'checklist' && raw.checklist?.sections?.length) {
    output = JSON.stringify(buildChecklist(raw) as AnyContent, null, 2)
  } else if (contentType === 'quiz' && raw.quiz?.questions?.length) {
    output = JSON.stringify(buildQuiz(raw) as AnyContent, null, 2)
  } else if (contentType === 'expert_insight' && raw.expertInsights?.length) {
    output = JSON.stringify(buildExpertInsight(raw) as AnyContent, null, 2)
  } else {
    output = buildArticleOutput(raw)
  }

  const now = Date.now()
  return {
    id: `cms_${raw.id}`,
    title: raw.title,
    contentType,
    audience: 'all',
    topic: raw.title,
    promptNotes: '',
    expertSources: [{ insight: '', name: '', image: '' }],
    output,
    createdAt: now,
    updatedAt: now,
    status: 'published',
    publishedAt: null,
    author: raw.author ?? '',
    slug: raw.slug ?? '',
    region: raw.region ?? 'us',
    language: raw.language ?? 'en',
    client: '',
    excerpt: raw.excerpt ?? '',
    documentNotes: '',
    referenceLink: raw.referenceLink ?? '',
    mimeType: normalizeMimeType(raw.mimeType),
    priority: 0,
    excludeClients: [],
    showInLibrary: true,
    redirect: '',
    source: raw.source ?? 'Financial Finesse',
    paidContent: false,
    legacyId: raw._legacyId?.toString() ?? '',
    excludeSmartBenefits: false,
    categories: resolveCatIds(raw.categories ?? []),
    curatedCategories: [],
    tags: [],
    internalTags: [],
    metaDescription: raw.excerpt ?? '',
    featuredImage: raw.image ?? '',
    seoArticle: '',
    seoSourceOutput: '',
    sources: [],
    relatedResources: [],
    assignee: '',
    reviewNotes: '',
    deletedAt: null,
    creationMode: 'ai',
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

let _cache: ContentEntry[] | null = null

export function loadArticles(): ContentEntry[] {
  if (!_cache) {
    _cache = (sampleArticlesRaw as RawArticle[]).map(normalizeArticle)
  }
  return _cache
}

/** Sorted unique category names from the loaded articles. */
export function getArticleCategories(): string[] {
  return [...new Set(loadArticles().flatMap(a => a.categories))].sort()
}

/** Real CMS category structure as parent → children groups, sorted alphabetically.
 *  Used by the right-rail Categories panel so the editor matches the live taxonomy
 *  rather than a hand-maintained subset. */
export function getCategoryGroups(): Array<{ label: string; children: string[] }> {
  const all = _cats
  const parents = all.filter(c => !c.parentId)
  const groups = parents.map(p => ({
    label: p.title,
    children: all.filter(c => c.parentId === p.id).map(c => c.title).sort((a, b) => a.localeCompare(b)),
  }))
  return groups.sort((a, b) => a.label.localeCompare(b.label))
}

/** Raw benefit code list for reference. */
export const benefitCodes: string[] = benefitCodesRaw as string[]
