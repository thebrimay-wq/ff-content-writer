// Per-type validation. Rules align with the new backend-faithful schema in
// contentTypeSchemas.ts. Blocking errors prevent save; warnings are nudges.

import type {
  AnyContent, Article, Calculator, Checklist, ExpertInsight, Infographic,
  MoneyTip, Quiz, UserStory, Video,
} from './contentTypeSchemas'

export type Severity = 'blocking' | 'warning'

export interface ValidationError {
  field: string
  message: string
  severity: Severity
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  blockingCount: number
  warningCount: number
}

function err(field: string, message: string, severity: Severity = 'blocking'): ValidationError {
  return { field, message, severity }
}

function req(val: unknown, field: string, label: string): ValidationError | null {
  if (!val || (typeof val === 'string' && !val.trim())) return err(field, `${label} is required`)
  return null
}

function push(errors: ValidationError[], e: ValidationError | null) {
  if (e) errors.push(e)
}

// ── Per-type validators ────────────────────────────────────────────────────────

function validateArticle(d: Article): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  push(e, req(d.intro_paragraph, 'intro_paragraph', 'Intro paragraph'))
  if (!d.sections?.length) e.push(err('sections', 'At least one section is required'))
  d.sections?.forEach((s, i) => {
    if (!s.heading?.trim()) e.push(err(`sections[${i}].heading`, `Section ${i + 1} heading is required`))
    if (!s.body?.trim()) e.push(err(`sections[${i}].body`, `Section ${i + 1} body is required`))
  })
  if (!d.closing_section?.heading?.trim()) e.push(err('closing_section.heading', 'Closing section heading is required', 'warning'))
  return e
}

function validateMoneyTip(d: MoneyTip): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  if (!d.sections?.length) e.push(err('sections', 'At least one slide is required'))
  d.sections?.forEach((s, i) => {
    const hasAny = !!(s.heading?.trim() || s.body?.trim() || s.preheading?.trim())
    if (!hasAny) e.push(err(`sections[${i}].heading`, `Slide ${i + 1} needs a heading, body, or preheading`))
  })
  return e
}

function validateCalculator(d: Calculator): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  push(e, req(d.copy, 'copy', 'Copy'))
  if (!d.reference_link?.trim()) e.push(err('reference_link', 'Reference link is recommended', 'warning'))
  return e
}

function validateChecklist(d: Checklist): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  if (!d.sections?.length) e.push(err('sections', 'At least one section is required'))
  d.sections?.forEach((s, i) => {
    if (!s.title?.trim()) e.push(err(`sections[${i}].title`, `Section ${i + 1} needs a title`))
    if (!s.items?.length) e.push(err(`sections[${i}].items`, `Section ${i + 1} needs at least one item`, 'warning'))
    s.items?.forEach((it, k) => {
      if (!it.label?.trim()) e.push(err(`sections[${i}].items[${k}].label`, `Item ${k + 1} in section ${i + 1} needs text`))
    })
  })
  return e
}

function validateExpertInsight(d: ExpertInsight): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  push(e, req(d.intro_paragraph, 'intro_paragraph', 'Intro paragraph'))
  if (!d.sections?.length) e.push(err('sections', 'At least one planner insight is required'))
  d.sections?.forEach((s, i) => {
    if (!s.plannerId?.trim()) e.push(err(`sections[${i}].plannerId`, `Insight ${i + 1} needs a planner`))
    if (!s.body?.trim()) e.push(err(`sections[${i}].body`, `Insight ${i + 1} needs body text`))
  })
  return e
}

function validateInfographic(d: Infographic): ValidationError[] {
  const e: ValidationError[] = []
  if (!d.infographic_image?.trim()) e.push(err('infographic_image', 'Infographic image is required'))
  if (!d.thumbnail_image?.trim()) e.push(err('thumbnail_image', 'Thumbnail image is recommended', 'warning'))
  return e
}

function validateQuiz(d: Quiz): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  if (!d.questions?.length) e.push(err('questions', 'At least one question is required'))
  d.questions?.forEach((q, i) => {
    if (!q.questionText?.trim()) e.push(err(`questions[${i}].questionText`, `Question ${i + 1} text is required`))
    if (!q.answers?.length) e.push(err(`questions[${i}].answers`, `Question ${i + 1} needs answers`))

    // Type-specific answer checks
    if (d.quizType === 'knowledge') {
      const anyCorrect = q.answers?.some(a => a.isCorrect === true)
      if (!anyCorrect) e.push(err(`questions[${i}].answers`, `Knowledge question ${i + 1} needs at least one correct answer`, 'warning'))
    }
    if (d.quizType === 'tiered') {
      q.answers?.forEach((a, ai) => {
        if (a.pointValue === null || a.pointValue === undefined) {
          e.push(err(`questions[${i}].answers[${ai}].pointValue`, `Tiered quiz answer ${ai + 1} needs a point value`, 'warning'))
        }
      })
    }
  })
  if (!d.rubric?.criteria?.length) e.push(err('rubric.criteria', 'At least one result is required', 'warning'))
  d.rubric?.criteria?.forEach((c, i) => {
    if (!c.label?.trim()) e.push(err(`rubric.criteria[${i}].label`, `Result ${i + 1} needs a label`))
    if (!c.resultText?.trim()) e.push(err(`rubric.criteria[${i}].resultText`, `Result ${i + 1} needs result text`, 'warning'))
    if (d.quizType === 'tiered') {
      if (c.start === null || c.end === null) {
        e.push(err(`rubric.criteria[${i}].start`, `Tiered result ${i + 1} needs a score range`, 'warning'))
      }
    }
  })
  return e
}

function validateUserStory(d: UserStory): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  push(e, req(d.copy, 'copy', 'Copy'))
  if (!d.subtitle?.trim()) e.push(err('subtitle', 'Subtitle is recommended', 'warning'))
  return e
}

function validateVideo(d: Video): ValidationError[] {
  const e: ValidationError[] = []
  push(e, req(d.title, 'title', 'Title'))
  push(e, req(d.copy, 'copy', 'Copy'))
  if (!d.reference_link?.trim()) e.push(err('reference_link', 'Reference link / Vimeo ID is recommended', 'warning'))
  return e
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export function validate(data: AnyContent): ValidationResult {
  let errors: ValidationError[] = []

  switch (data.content_type) {
    case 'article':        errors = validateArticle(data as Article); break
    case 'money_tip':      errors = validateMoneyTip(data as MoneyTip); break
    case 'calculator':     errors = validateCalculator(data as Calculator); break
    case 'checklist':      errors = validateChecklist(data as Checklist); break
    case 'expert_insight': errors = validateExpertInsight(data as ExpertInsight); break
    case 'infographic':    errors = validateInfographic(data as Infographic); break
    case 'quiz':           errors = validateQuiz(data as Quiz); break
    case 'user_story':     errors = validateUserStory(data as UserStory); break
    case 'video':          errors = validateVideo(data as Video); break
  }

  const blockingCount = errors.filter(e => e.severity === 'blocking').length
  const warningCount = errors.filter(e => e.severity === 'warning').length
  return { valid: blockingCount === 0, errors, blockingCount, warningCount }
}
