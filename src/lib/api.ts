// ── Custom tag preservation ───────────────────────────────────────────────────
// Tags starting with <snippet or whose name ends with -card must survive AI
// refinement unchanged. We swap them for placeholders before sending to the
// model and restore them from the saved list once the response is complete.

const CUSTOM_PAIRED_RE = /<(snippet[\w-]*|[\w][\w-]*-card)(\s[^>]*)?>[\s\S]*?<\/\1>/gi
const CUSTOM_STANDALONE_RE = /<(?:snippet[\w-]*|[\w][\w-]*-card)(?:\s[^>]*)?\/?>/gi

export function extractCustomTags(content: string): { sanitized: string; tags: string[] } {
  const tags: string[] = []
  // Paired elements first so their inner content is captured whole
  let result = content.replace(CUSTOM_PAIRED_RE, (match) => {
    const idx = tags.length
    tags.push(match)
    return `[PRESERVE_CUSTOM_TAG:${idx}]`
  })
  // Then standalone/self-closing tags
  result = result.replace(CUSTOM_STANDALONE_RE, (match) => {
    const idx = tags.length
    tags.push(match)
    return `[PRESERVE_CUSTOM_TAG:${idx}]`
  })
  return { sanitized: result, tags }
}

export function restoreCustomTags(content: string, tags: string[]): string {
  return content.replace(/\[PRESERVE_CUSTOM_TAG:(\d+)\]/g, (_, i) => tags[parseInt(i, 10)] ?? '')
}

export interface ExpertSource {
  insight: string
  name: string
  image: string
}

export interface GenerateRequest {
  contentType: string
  audience: string
  topic: string
  notes: string
  expertSources?: ExpertSource[]
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export const TYPE_LABELS: Record<string, string> = {
  article: 'Articles',
  money_tip: 'Money Tips',
  calculator: 'Calculators',
  checklist: 'Checklists',
  expert_insight: 'Expert Insights',
  infographic: 'Infographics',
  quiz: 'Quizzes',
  user_story: 'User Stories',
  video: 'Videos',
}

export const AUDIENCE_LABELS: Record<string, string> = {
  all: 'All Users',
  crisis: 'Crisis',
  struggling: 'Struggling',
  planning: 'Planning',
  optimizing: 'Optimizing',
}

export function buildUserMessage(req: GenerateRequest): string {
  const typeLabel = TYPE_LABELS[req.contentType] ?? req.contentType
  const audienceLabel = AUDIENCE_LABELS[req.audience] ?? req.audience

  const parts: string[] = [
    `Create Financial Finesse content.`,
    ``,
    `Content type: ${typeLabel}`,
    `Audience: ${audienceLabel}`,
    `Topic: ${req.topic}`,
  ]

  if (req.contentType === 'expert_insight' && req.expertSources?.length) {
    req.expertSources.forEach((src, i) => {
      const label = req.expertSources!.length > 1 ? ` ${i + 1}` : ''
      if (src.name.trim()) {
        parts.push(``, `Expert${label}: ${src.name.trim()}`)
      }
      if (src.insight.trim()) {
        parts.push(``, `Raw expert insight${label}:`, src.insight.trim())
      }
    })
  }

  if (req.notes.trim()) {
    parts.push(``, `Notes:`, req.notes.trim())
  }

  const instructions = [
    ``,
    `Instructions:`,
    `- Follow all system rules`,
    `- Match content type exactly`,
    `- Match audience tone`,
    `- Keep writing human and clear`,
  ]

  const hasInsight = req.expertSources?.some(s => s.insight.trim())
  if (req.contentType === 'expert_insight' && hasInsight) {
    instructions.push(
      `- Use the raw expert insight(s) above as your primary source material`,
      `- Rewrite and polish them to sound strong, clear, professional, and human`,
      `- Preserve each expert's core meaning, voice, and expertise — do not invent new claims`,
    )
  }

  parts.push(...instructions)

  return parts.join('\n')
}

export function buildRefinementMessage(
  current: string,
  instruction: string,
  ctx: GenerateRequest
): string {
  const typeLabel = TYPE_LABELS[ctx.contentType] ?? ctx.contentType
  const audienceLabel = AUDIENCE_LABELS[ctx.audience] ?? ctx.audience

  return [
    `Refine this Financial Finesse content.`,
    ``,
    `Content type: ${typeLabel}`,
    `Audience: ${audienceLabel}`,
    ``,
    `Current draft:`,
    current,
    ``,
    `Refinement request:`,
    instruction.trim(),
    ``,
    `Instructions:`,
    `- Modify the current draft`,
    `- Do not fully rewrite unless needed`,
    `- Keep structure intact`,
    `- Improve clarity and tone`,
    `- Keep it human and compliant`,
    `- CRITICAL: preserve all custom HTML tags exactly — never remove or rewrite tags starting with <snippet or ending with -card`,
    `- [PRESERVE_CUSTOM_TAG:N] placeholders represent protected tags — reproduce each one verbatim in the same position`,
  ].join('\n')
}

export function buildSourcesMessage(ctx: GenerateRequest, draft: string): string {
  const typeLabel = TYPE_LABELS[ctx.contentType] ?? ctx.contentType
  return [
    `List the sources, references, and citations that would be appropriate for the financial content piece below.`,
    ``,
    `Content type: ${typeLabel}`,
    `Topic: ${ctx.topic}`,
    ``,
    `Content:`,
    draft,
    ``,
    `Return ONLY a JSON array (no prose, no code fence). Each item is an object with keys:`,
    `- "title": short source name (e.g., "IRS Publication 590-A", "Consumer Financial Protection Bureau")`,
    `- "url": best-known URL for that source, or "" if unknown`,
    `- "note": one-sentence description of what this source supports in the content`,
    ``,
    `Aim for 4–8 high-quality sources (government agencies, major financial regulators, reputable research orgs, or the specific studies/publications the content relies on). Do not invent URLs — leave "url" empty if you're not confident.`,
    ``,
    `Example format:`,
    `[{"title":"IRS","url":"https://www.irs.gov","note":"Authoritative source for retirement contribution limits."}]`,
  ].join('\n')
}

export function buildSeoArticleMessage(ctx: GenerateRequest, shortDraft: string): string {
  const typeLabel = TYPE_LABELS[ctx.contentType] ?? ctx.contentType
  const audienceLabel = AUDIENCE_LABELS[ctx.audience] ?? ctx.audience
  return [
    `Expand this Financial Finesse draft into a 1,500–2,000 word SEO article.`,
    ``,
    `Content type: ${typeLabel}`,
    `Audience: ${audienceLabel}`,
    `Topic: ${ctx.topic}`,
    ``,
    `Short draft:`,
    shortDraft,
    ``,
    `Instructions:`,
    `- Write a complete long-form SEO article (~1,500–2,000 words)`,
    `- Use H2 and H3 headings for logical structure`,
    `- Maintain Financial Finesse voice: clear, direct, jargon-free, human`,
    `- Include actionable takeaways throughout`,
    `- Do not truncate — deliver the full article`,
  ].join('\n')
}

export function buildSeoRefinementMessage(
  current: string,
  instruction: string,
  ctx: GenerateRequest,
): string {
  return [
    `Refine this Financial Finesse SEO article.`,
    ``,
    `Topic: ${ctx.topic}`,
    ``,
    `Current article:`,
    current,
    ``,
    `Refinement request:`,
    instruction.trim(),
    ``,
    `Instructions:`,
    `- Apply the refinement request to the existing article`,
    `- Preserve overall structure and length unless the request changes them`,
    `- Maintain Financial Finesse voice throughout`,
    `- CRITICAL: preserve all custom HTML tags exactly — never remove or rewrite tags starting with <snippet or ending with -card`,
    `- [PRESERVE_CUSTOM_TAG:N] placeholders represent protected tags — reproduce each one verbatim in the same position`,
  ].join('\n')
}

export function buildJsonUserMessage(req: GenerateRequest): string {
  const typeLabel = TYPE_LABELS[req.contentType] ?? req.contentType
  const audienceLabel = AUDIENCE_LABELS[req.audience] ?? req.audience

  const parts: string[] = [
    `Generate Financial Finesse Hub structured content as JSON.`,
    ``,
    `Content type: ${typeLabel}`,
    `content_type field value: ${req.contentType === 'expert_insight' ? 'coach_insight' : req.contentType}`,
    `Audience: ${audienceLabel}`,
    `Topic: ${req.topic}`,
  ]

  if (req.contentType === 'expert_insight' && req.expertSources?.length) {
    req.expertSources.forEach((src, i) => {
      const label = req.expertSources!.length > 1 ? ` ${i + 1}` : ''
      if (src.name.trim()) parts.push(``, `Coach name${label}: ${src.name.trim()}`)
      if (src.insight.trim()) parts.push(``, `Raw insight${label}:`, src.insight.trim())
    })
    parts.push(``, `Use the raw insight(s) above as primary source material. Rewrite to sound polished and professional.`)
  }

  if (req.notes.trim()) parts.push(``, `Additional notes:`, req.notes.trim())

  parts.push(
    ``,
    `Return ONLY a valid JSON object matching the schema for this content type. No markdown, no code fences, no commentary.`,
    `Fill all fields with real, polished, on-brand Financial Finesse content.`,
    `Match the audience tone: ${audienceLabel}.`,
  )

  return parts.join('\n')
}

export function buildJsonRefinementMessage(
  currentJson: string,
  instruction: string,
  ctx: GenerateRequest,
): string {
  const typeLabel = TYPE_LABELS[ctx.contentType] ?? ctx.contentType
  const audienceLabel = AUDIENCE_LABELS[ctx.audience] ?? ctx.audience
  return [
    `Refine this Financial Finesse Hub structured content JSON.`,
    ``,
    `Content type: ${typeLabel}`,
    `Audience: ${audienceLabel}`,
    ``,
    `Current JSON:`,
    currentJson,
    ``,
    `Instruction: ${instruction.trim()}`,
    ``,
    `Return ONLY valid JSON with the same structure and all the same fields. Apply the instruction to improve the content text. No markdown, no code fences, no commentary.`,
  ].join('\n')
}

export async function streamMessage(
  apiKey: string,
  messages: Message[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  maxTokens = 2048,
): Promise<void> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      stream: true,
      system: systemPrompt,
      messages,
    }),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    let message = `API error ${response.status}`
    try {
      const parsed = JSON.parse(errorText)
      if (parsed?.error?.message) {
        message = parsed.error.message
      }
    } catch {
      // use default message
    }
    throw new Error(message)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          onChunk(parsed.delta.text)
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}
