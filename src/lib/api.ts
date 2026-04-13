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
  apiKey: string,
  messages: Message[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal
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
      model: 'claude-opus-4-6',
      max_tokens: 2048,
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
