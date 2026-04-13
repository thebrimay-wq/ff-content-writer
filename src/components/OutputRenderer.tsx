type Segment =
  | { type: 'major-header'; label: string; value: string }
  | { type: 'section-header'; label: string; value: string }
  | { type: 'section-divider'; label: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'spacer' }

const MAJOR_HEADER_LABELS = new Set(['TITLE', 'SUBHEAD', 'READ TIME', 'HOOK'])

const ALL_CAPS_LABEL_RE = /^([A-Z][A-Z 0-9]+):\s*(.*)$/
const BULLET_RE = /^(?:[-•*]|\[\s*[xX ]?\s*\]|\d+\.)\s+(.+)$/

function parseOutput(text: string): Segment[] {
  const lines = text.split('\n')
  const segments: Segment[] = []
  let lastWasSpacer = false

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (line.trim() === '') {
      if (!lastWasSpacer) {
        segments.push({ type: 'spacer' })
        lastWasSpacer = true
      }
      continue
    }

    lastWasSpacer = false

    // Check for ALL_CAPS label with colon
    const headerMatch = line.match(ALL_CAPS_LABEL_RE)
    if (headerMatch) {
      const [, label, value] = headerMatch
      const trimmedValue = value.trim()

      if (MAJOR_HEADER_LABELS.has(label)) {
        segments.push({ type: 'major-header', label, value: trimmedValue })
      } else if (trimmedValue) {
        segments.push({ type: 'section-header', label, value: trimmedValue })
      } else {
        segments.push({ type: 'section-divider', label })
      }
      continue
    }

    // Check for bullets
    const bulletMatch = line.match(BULLET_RE)
    if (bulletMatch) {
      segments.push({ type: 'bullet', text: bulletMatch[1] })
      continue
    }

    // Paragraph
    segments.push({ type: 'paragraph', text: line.trim() })
  }

  return segments
}

interface Props {
  text: string
}

export default function OutputRenderer({ text }: Props) {
  const segments = parseOutput(text)

  return (
    <div>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case 'major-header': {
            if (seg.label === 'TITLE') {
              return (
                <h2
                  key={i}
                  className="text-[22px] font-bold text-gray-900 leading-snug"
                >
                  {seg.value}
                </h2>
              )
            }
            if (seg.label === 'SUBHEAD') {
              return (
                <p
                  key={i}
                  className="text-[17px] font-light text-gray-600 leading-snug mt-1"
                >
                  {seg.value}
                </p>
              )
            }
            // READ TIME, HOOK, etc.
            return (
              <p key={i} className="flex items-baseline gap-1 mt-2">
                <span className="text-[10px] uppercase tracking-widest text-gray-300 mr-2 shrink-0">
                  {seg.label}
                </span>
                <span className="text-gray-700 text-[14px]">{seg.value}</span>
              </p>
            )
          }

          case 'section-header':
            return (
              <p key={i} className="flex items-baseline gap-1">
                <span className="text-[10px] font-bold tracking-widest uppercase text-gray-300 mr-2 shrink-0">
                  {seg.label}
                </span>
                <span className="text-gray-800 text-[15px]">{seg.value}</span>
              </p>
            )

          case 'section-divider':
            return (
              <p
                key={i}
                className="text-[10px] font-bold tracking-widest uppercase text-gray-300 mt-6 mb-1"
              >
                {seg.label}
              </p>
            )

          case 'paragraph':
            return (
              <p
                key={i}
                className="text-[15px] font-light text-gray-700 leading-[1.8]"
              >
                {seg.text}
              </p>
            )

          case 'bullet':
            return (
              <div key={i} className="flex flex-row items-start">
                <span className="text-gray-300 mt-1 mr-2.5 shrink-0 select-none">&mdash;</span>
                <p className="text-[15px] font-light text-gray-700 leading-[1.8]">{seg.text}</p>
              </div>
            )

          case 'spacer':
            return <div key={i} className="h-3" />

          default:
            return null
        }
      })}
    </div>
  )
}
