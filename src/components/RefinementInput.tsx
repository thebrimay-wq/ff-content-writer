import { ChangeEvent, KeyboardEvent, useRef, useState } from 'react'

interface Props {
  onRefine: (instruction: string) => void
  isGenerating: boolean
}

export default function RefinementInput({ onRefine, isGenerating }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    // auto-grow
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      const lineHeight = 22
      const maxHeight = lineHeight * 5
      el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || isGenerating) return
    onRefine(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const canSubmit = value.trim().length > 0 && !isGenerating

  return (
    <div className="flex flex-col">
      <p className="text-[10px] font-bold tracking-widest uppercase text-gray-300 mb-2">
        Refine
      </p>
      <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus-within:border-gray-300 focus-within:bg-white transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          rows={1}
          placeholder="Make this shorter  ·  Make it warmer  ·  Turn this into a checklist  ·  Tighten the CTA"
          className="flex-1 bg-transparent text-[14px] text-gray-900 placeholder-gray-300 outline-none resize-none leading-relaxed disabled:opacity-50"
          style={{ minHeight: '22px' }}
        />
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={[
            'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
            canSubmit
              ? 'bg-[#063853] hover:bg-[#04293D] cursor-pointer'
              : 'bg-gray-200 cursor-not-allowed',
          ].join(' ')}
          aria-label="Submit refinement"
        >
          <svg
            className={canSubmit ? 'text-white' : 'text-gray-400'}
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M7 12V2M7 2L3 6M7 2L11 6"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
