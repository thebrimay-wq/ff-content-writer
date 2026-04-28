// Content type TypeScript interfaces and empty-state factories.
//
// Shape policy:
//   • The 5 content-heavy types (article, checklist, quiz, money_tip, expert_insight)
//     mirror the real backend C# models (see ff-content-explanations/*.cs).
//   • The 4 simpler types (video, calculator, infographic, user_story) use the
//     flat specs Bri confirmed: thumbnail + title/subtitle/copy + reference + related.
//   • Every content type carries an `_extras` passthrough so unknown CMS fields
//     survive a round trip. Never drop data you don't understand.

// ── Guid helper ───────────────────────────────────────────────────────────────

export function newGuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // RFC-4122-ish fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ── Planners (Financial Finesse coaches) ──────────────────────────────────────
// Stable placeholder Guids — swap with the real backend Guids when available.
// Hardcoded (not generated) so a saved plannerId keeps resolving to the same
// planner across page reloads.

export interface Planner {
  id: string
  name: string
}

export const PLANNERS: Planner[] = [
  { id: '9c405414-80f2-4d63-a909-25aade6e1bf9', name: 'Aissatou Sidime-Blanton, CFP®' },
  { id: 'dcb3e994-7161-424c-ad76-a168f9eedd62', name: 'Anita Pippin, CFP®, CPA' },
  { id: '917c508c-ed1a-4b05-ad25-2b18fdff7628', name: 'Becca Wilton, CFP®' },
  { id: 'ad68fa88-a08c-4652-b852-c89b287a54e1', name: 'Brian Kelly, CFP®' },
  { id: 'f2ba1306-c88a-413d-8d1b-cd9cfec4de29', name: 'Brigham Tappana, CFP®' },
  { id: '7d076b75-4adc-4c1c-b99e-794b3cad0772', name: 'Carlos Delgado (Carl), CFP®, CPWA' },
  { id: '07421612-470b-4089-8a9f-26626604c794', name: 'Chris Setter, CFP®, MBA' },
  { id: 'a7ba0baf-dd70-4b03-9919-5d5dd5f96d99', name: 'Cyrus Purnell, CFP®, MBA' },
  { id: 'b1f88815-1e53-4a1d-914a-be7b1485cce4', name: 'Dan Andrews, CFP®' },
  { id: 'ff049c49-4e92-4d8f-9103-d636fbf7287f', name: 'Derenda King, CFP®, CSLP' },
  { id: 'ff71cb66-56aa-4f22-8e07-1ac51c4114b3', name: 'Don Edlin, CFP®' },
  { id: 'e1273726-9909-4c79-9d15-0f02262de182', name: 'Doug Spencer, CFP®' },
  { id: '7eaeeff5-b872-4078-b0fa-02616ac8817b', name: 'Erik Carter, JD, CFP®' },
  { id: '764d035e-6b97-4cf1-8967-ad6adb0a88fd', name: 'Greg Ward, CFP®' },
  { id: '0e8f99a6-9627-4482-be12-20f0104e2662', name: 'Jim Jacobucci, CFP®, MBA' },
  { id: '4d515123-166f-49a4-b97a-fc0b0e87c12d', name: 'Julie Everett, CFP®, MBA' },
  { id: 'f214dadb-3d5f-41a6-a109-cc22f0abd07b', name: 'Kari Cedergren, CFP, CDFA' },
  { id: '04356b5e-4626-426a-b980-40b1e1c1415d', name: 'Mark Dennis, DBA, CFP®' },
  { id: 'f07d5a30-2372-4e86-b949-45a474e8f035', name: 'MaryKate Hughes, CFP®' },
  { id: '2ec7340e-a521-4584-bc1a-7b691924c16a', name: 'Michael Smith, CFP®' },
  { id: 'c77d04cd-6236-46f9-b990-115aabef5609', name: 'Nadia Fernandez, CFP®, CDFA' },
  { id: '4b71fb06-c774-4f74-85d2-5abd5f90af85', name: 'Reynolds Saunders, CFP®' },
  { id: 'a7b7c41e-ab74-491b-8f4a-720110b2419f', name: 'Sandra Harrell, CFP®, MBA' },
  { id: 'c0866d66-7145-473c-be6e-5aa97236d2fd', name: 'Scott Stark, CFP®' },
  { id: 'bd8bd053-516b-4aaf-a143-de81517cc1a0', name: 'Stephanie Thomas CFP®' },
  { id: '99482245-7ae3-4d9d-8ba5-7e4515002a46', name: 'Stephen White, CFP®, MBA' },
  { id: '8dfb8466-c662-4027-bcc1-d12c4e1fc73a', name: 'Veronica Arellano, CFP®' },
]

export function plannerName(id: string): string {
  return PLANNERS.find(p => p.id === id)?.name ?? ''
}

// ── Universal fields ──────────────────────────────────────────────────────────

export interface UniversalFields {
  content_type: string
  slug: string
  topic_category: string
  bookmarkable: boolean
  shareable: boolean
  copyable: boolean
  /** Passthrough for CMS fields the editor doesn't surface. Never drop data. */
  _extras?: Record<string, unknown>
}

const universalDefaults = (): UniversalFields => ({
  content_type: '',
  slug: '',
  topic_category: '',
  bookmarkable: true,
  shareable: true,
  copyable: true,
})

// ── Shared primitives ─────────────────────────────────────────────────────────

export interface RelatedResource {
  title: string
  content_type: string
}

// ── 1. Article ────────────────────────────────────────────────────────────────
// CMS `type: article` stores HTML in `content`. The editor keeps it as HTML so
// <snippet…> and *-card tags survive. Structural sub-parts (read time, hero,
// intro, sections, closing, related) are editor-only conveniences stacked on
// top of the raw HTML.

export interface ArticleTable {
  table_title: string
  columns: string[]
  rows: string[][]
}

export interface ArticleSection {
  heading: string
  body: string
  optional_table: ArticleTable | null
  optional_bullet_list: string[]
}

export interface Article extends UniversalFields {
  content_type: 'article'
  hero_image_description: string
  title: string
  read_time: string
  intro_paragraph: string
  sections: ArticleSection[]
  closing_section: { heading: string; body: string }
  related_resources: RelatedResource[]
}

export function emptyArticleSection(): ArticleSection {
  return { heading: '', body: '', optional_table: null, optional_bullet_list: [] }
}

export function emptyArticle(): Article {
  return {
    ...universalDefaults(),
    content_type: 'article',
    hero_image_description: '',
    title: '',
    read_time: '5 min',
    intro_paragraph: '',
    sections: [emptyArticleSection()],
    closing_section: { heading: 'What to do next', body: '' },
    related_resources: [],
  }
}

// ── 2. Money Tip (biteSized) ──────────────────────────────────────────────────
// Strict backend model per Bite_Sized.cs: just [{ preheading, heading, body }].

export interface MoneyTipSection {
  preheading: string | null
  heading: string | null
  body: string | null
}

export interface MoneyTip extends UniversalFields {
  content_type: 'money_tip'
  title: string
  /** Raw backend shape. Renderer-derived concepts (slide type, cover, etc) live in the editor, not the data. */
  sections: MoneyTipSection[]
}

export function emptyMoneyTipSection(): MoneyTipSection {
  return { preheading: null, heading: '', body: '' }
}

export function emptyMoneyTip(): MoneyTip {
  return {
    ...universalDefaults(),
    content_type: 'money_tip',
    title: '',
    sections: [emptyMoneyTipSection()],
  }
}

// ── 3. Calculator ─────────────────────────────────────────────────────────────
// Simplified per Bri's spec: thumbnail + title + copy + reference link + related.

export interface Calculator extends UniversalFields {
  content_type: 'calculator'
  title: string
  thumbnail_image: string
  copy: string                // HTML
  reference_link: string
  related_resources: RelatedResource[]
}

export function emptyCalculator(): Calculator {
  return {
    ...universalDefaults(),
    content_type: 'calculator',
    title: '',
    thumbnail_image: '',
    copy: '',
    reference_link: '',
    related_resources: [],
  }
}

// ── 4. Checklist ──────────────────────────────────────────────────────────────
// Matches Checklist.cs exactly. Item `label` is HTML (can contain <a>). `tip` is
// the highlight block with image/title/description.

export interface ChecklistItem {
  id: string
  label: string                    // HTML
  subItems: string[] | null
  isChecked: boolean | null
}

export interface ChecklistTip {
  image: string | null
  title: string | null
  description: string | null
}

export interface ChecklistSection {
  id: string
  title: string
  description: string
  image: string | null              // section icon image URL (or empty)
  items: ChecklistItem[]
  tip: ChecklistTip | null
}

export interface Checklist extends UniversalFields {
  content_type: 'checklist'
  title: string
  intro_paragraph: string
  sections: ChecklistSection[]
}

export function emptyChecklistItem(): ChecklistItem {
  return { id: newGuid(), label: '', subItems: null, isChecked: null }
}

export function emptyChecklistSection(): ChecklistSection {
  return {
    id: newGuid(),
    title: '',
    description: '',
    image: null,
    items: [emptyChecklistItem()],
    tip: null,
  }
}

export function emptyChecklist(): Checklist {
  return {
    ...universalDefaults(),
    content_type: 'checklist',
    title: '',
    intro_paragraph: '',
    sections: [emptyChecklistSection()],
  }
}

// ── 5. Expert Insight (expertInsights) ────────────────────────────────────────
// Matches Expert_Insights.cs: array of { plannerId, body }. Planner is chosen
// from the PLANNERS dropdown above; body is HTML.

export interface ExpertInsightSection {
  plannerId: string
  body: string                     // HTML
}

export interface ExpertInsight extends UniversalFields {
  content_type: 'expert_insight'
  title: string
  read_time: string
  hero_image_description: string
  intro_paragraph: string
  sections: ExpertInsightSection[]
}

export function emptyExpertInsightSection(): ExpertInsightSection {
  return { plannerId: PLANNERS[0]?.id ?? '', body: '' }
}

export function emptyExpertInsight(): ExpertInsight {
  return {
    ...universalDefaults(),
    content_type: 'expert_insight',
    title: '',
    read_time: '4 min',
    hero_image_description: '',
    intro_paragraph: '',
    sections: [emptyExpertInsightSection()],
  }
}

// ── 6. Infographic ────────────────────────────────────────────────────────────
// Simplified per Bri's spec: thumbnail + infographic image + related. No title,
// no copy.

export interface Infographic extends UniversalFields {
  content_type: 'infographic'
  thumbnail_image: string
  infographic_image: string
  related_resources: RelatedResource[]
}

export function emptyInfographic(): Infographic {
  return {
    ...universalDefaults(),
    content_type: 'infographic',
    thumbnail_image: '',
    infographic_image: '',
    related_resources: [],
  }
}

// ── 7. Quiz ───────────────────────────────────────────────────────────────────
// Matches Quiz.cs exactly. Includes quizType (Tiered/Knowledge/Classification),
// per-question tip + explanation, per-answer typeOption + pointValue + isCorrect,
// correctAnswerIds, and full rubric criteria.

export type QuizType = 'tiered' | 'knowledge' | 'classification'
export type TypeOption = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'

export const TYPE_OPTIONS: TypeOption[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

export interface QuizAnswer {
  questionId: string
  answerId: string
  answerText: string
  isCorrect: boolean | null
  answerSelected: boolean | null
  pointValue: number | null
  typeOption: TypeOption | null
}

export interface QuizQuestion {
  questionId: string
  questionText: string
  tip: string
  explanation: string
  answers: QuizAnswer[]
}

export interface QuizRubricCriterion {
  id: string
  label: string
  resultText: string
  nextMove: string
  start: number | null
  end: number | null
  typeOption: TypeOption | null
  isMoreThanOne: boolean | null
  image: string
}

export interface QuizRubric {
  criteria: QuizRubricCriterion[]
}

export interface Quiz extends UniversalFields {
  content_type: 'quiz'
  title: string
  intro_paragraph: string
  quizType: QuizType
  questions: QuizQuestion[]
  correctAnswerIds: string[] | null
  rubric: QuizRubric
}

export function emptyQuizAnswer(questionId: string, typeOption: TypeOption = 'A'): QuizAnswer {
  return {
    questionId,
    answerId: newGuid(),
    answerText: '',
    isCorrect: null,
    answerSelected: null,
    pointValue: null,
    typeOption,
  }
}

export function emptyQuizQuestion(): QuizQuestion {
  const qid = newGuid()
  return {
    questionId: qid,
    questionText: '',
    tip: '',
    explanation: '',
    answers: [emptyQuizAnswer(qid, 'A'), emptyQuizAnswer(qid, 'B')],
  }
}

export function emptyQuizCriterion(typeOption: TypeOption = 'A'): QuizRubricCriterion {
  return {
    id: newGuid(),
    label: '',
    resultText: '',
    nextMove: '',
    start: null,
    end: null,
    typeOption,
    isMoreThanOne: null,
    image: '',
  }
}

export function emptyQuiz(): Quiz {
  return {
    ...universalDefaults(),
    content_type: 'quiz',
    title: '',
    intro_paragraph: '',
    quizType: 'classification',
    questions: [emptyQuizQuestion(), emptyQuizQuestion(), emptyQuizQuestion()],
    correctAnswerIds: null,
    rubric: { criteria: [emptyQuizCriterion('A'), emptyQuizCriterion('B')] },
  }
}

// ── 8. User Story ─────────────────────────────────────────────────────────────
// Simplified per Bri's spec: thumbnail + title + subtitle + copy + related.

export interface UserStory extends UniversalFields {
  content_type: 'user_story'
  thumbnail_image: string
  title: string
  subtitle: string
  copy: string                     // HTML
  related_resources: RelatedResource[]
}

export function emptyUserStory(): UserStory {
  return {
    ...universalDefaults(),
    content_type: 'user_story',
    thumbnail_image: '',
    title: '',
    subtitle: '',
    copy: '',
    related_resources: [],
  }
}

// ── 9. Video ──────────────────────────────────────────────────────────────────
// Simplified per Bri's spec: thumbnail + title + copy + reference link (vimeo id)
// + related.

export interface Video extends UniversalFields {
  content_type: 'video'
  thumbnail_image: string
  title: string
  copy: string                     // HTML
  reference_link: string           // vimeo id or URL
  related_resources: RelatedResource[]
}

export function emptyVideo(): Video {
  return {
    ...universalDefaults(),
    content_type: 'video',
    thumbnail_image: '',
    title: '',
    copy: '',
    reference_link: '',
    related_resources: [],
  }
}

// ── Union + factory ───────────────────────────────────────────────────────────

export type AnyContent =
  | Article | MoneyTip | Calculator | Checklist | ExpertInsight
  | Infographic | Quiz | UserStory | Video

export function emptyContentForType(contentType: string): AnyContent {
  switch (contentType) {
    case 'article':        return emptyArticle()
    case 'money_tip':      return emptyMoneyTip()
    case 'calculator':     return emptyCalculator()
    case 'checklist':      return emptyChecklist()
    case 'expert_insight':
    case 'coach_insight':  return emptyExpertInsight()
    case 'infographic':    return emptyInfographic()
    case 'quiz':           return emptyQuiz()
    case 'user_story':     return emptyUserStory()
    case 'video':          return emptyVideo()
    default:               return emptyArticle()
  }
}

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) and surrounding
 * whitespace. The AI sometimes wraps JSON despite prompt instructions telling
 * it not to — don't let that break parsing.
 */
function stripCodeFences(output: string): string {
  let t = output.trim()
  // Opening fence: ```json, ```JSON, ```  (optionally with language tag)
  const openFence = /^```[a-zA-Z0-9_-]*\s*\n?/
  if (openFence.test(t)) {
    t = t.replace(openFence, '')
    // Closing fence
    t = t.replace(/\n?```\s*$/, '')
  }
  return t.trim()
}

export function isJsonContent(output: string): boolean {
  const t = stripCodeFences(output).trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

export function parseJsonContent(output: string): AnyContent | null {
  const cleaned = stripCodeFences(output)
  try {
    return JSON.parse(cleaned) as AnyContent
  } catch {
    // Fallback: try to extract the first top-level JSON object from the string
    // (handles cases where the AI added a leading sentence despite instructions).
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0]) as AnyContent
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Best-effort parse of a partial / mid-stream JSON string. Auto-closes open
 * strings, objects, and arrays so the structured editor can render what has
 * arrived so far. Returns null if even the repair attempt fails. Intended for
 * live streaming preview — the final `parseJsonContent` result should be used
 * once streaming completes.
 */
export function parsePartialJsonContent(output: string): AnyContent | null {
  const cleaned = stripCodeFences(output)
  // Find the first { — we only auto-repair objects.
  const start = cleaned.indexOf('{')
  if (start === -1) return null
  const body = cleaned.slice(start)

  // Walk the string tracking string/escape state and bracket depth. When we
  // hit the end mid-stream, close whatever is still open.
  let inString = false
  let escape = false
  const stack: string[] = []

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') { stack.push(ch); continue }
    if (ch === '}' || ch === ']') { stack.pop(); continue }
  }

  let repaired = body
  // Close unterminated string
  if (inString) repaired += '"'
  // Trim a dangling comma or colon before closing structures
  repaired = repaired.replace(/[,:\s]+$/, '')
  // Close unterminated arrays/objects in reverse order
  while (stack.length > 0) {
    const open = stack.pop()
    repaired += open === '{' ? '}' : ']'
  }

  try {
    const parsed = JSON.parse(repaired)
    if (parsed && typeof parsed === 'object') return parsed as AnyContent
    return null
  } catch {
    return null
  }
}

// ── Type resolution for uploaded / CMS JSON ───────────────────────────────────

// Maps every known raw type string → canonical JSON content_type
const RAW_TYPE_TO_JSON_TYPE: Record<string, string> = {
  article:         'article',
  checklist:       'checklist',
  quiz:            'quiz',
  money_tip:       'money_tip',
  calculator:      'calculator',
  expert_insight:  'expert_insight',
  infographic:     'infographic',
  user_story:      'user_story',
  video:           'video',
  // CMS aliases
  biteSized:       'money_tip',
  coach_insight:   'expert_insight',
  coachInsight:    'expert_insight',
  expertInsights:  'expert_insight',
  moneyTip:        'money_tip',
  userStory:       'user_story',
}

/**
 * Maps JSON content_type → the ContentEntry.contentType key used by sidebar and
 * library. Currently a 1:1 identity map for all 9 types.
 */
export const JSON_TYPE_TO_ENTRY_TYPE: Record<string, string> = {
  article:         'article',
  checklist:       'checklist',
  quiz:            'quiz',
  money_tip:       'money_tip',
  calculator:      'calculator',
  expert_insight:  'expert_insight',
  infographic:     'infographic',
  user_story:      'user_story',
  video:           'video',
}

/**
 * Resolve the canonical JSON content_type from a raw parsed object.
 * Priority: item.type > item.content_type > item.contentType.
 */
export function resolveContentType(raw: Record<string, unknown>): string {
  const candidates = [raw.type, raw.content_type, raw.contentType]
  for (const c of candidates) {
    if (typeof c === 'string' && c) {
      const resolved = RAW_TYPE_TO_JSON_TYPE[c]
      if (resolved) return resolved
    }
  }
  return 'article'
}

/**
 * Normalize a raw parsed JSON object into a proper AnyContent.
 * Resolves content_type from type / content_type / contentType.
 */
export function normalizeUploadedJson(raw: AnyContent): AnyContent {
  const obj = raw as unknown as Record<string, unknown>
  const resolvedType = resolveContentType(obj)
  return { ...raw, content_type: resolvedType } as AnyContent
}
