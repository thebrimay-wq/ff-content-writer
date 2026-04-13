export interface GenerateRequest {
  contentType: string
  audience: string
  topic: string
  notes: string
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
  coaching_insight: 'Coaching Insights',
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

  if (req.notes.trim()) {
    parts.push(``, `Notes:`, req.notes.trim())
  }

  parts.push(
    ``,
    `Instructions:`,
    `- Follow all system rules`,
    `- Match content type exactly`,
    `- Match audience tone`,
    `- Keep writing human and clear`,
  )

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
  ].join('\n')
}

export async function streamMessage(
  _apiKey: string,
  messages: Message[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch('/.netlify/functions/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt }),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    let message = `API error ${response.status}`
    try {
      const parsed = JSON.parse(errorText)
      if (parsed?.error?.message) message = parsed.error.message
      else if (parsed?.error) message = parsed.error
    } catch { /* use default */ }
    throw new Error(message)
  }

  const data = await response.json()
  if (data.text) {
    onChunk(data.text)
  }
}
