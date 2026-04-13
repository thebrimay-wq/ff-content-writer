import { useEffect, useRef, useState } from 'react'
import { AUDIENCE_LABELS, TYPE_LABELS } from '../lib/api'
import OutputRenderer from './OutputRenderer'
import RefinementInput from './RefinementInput'

interface Props {
  output: string
  isGenerating: boolean
  error: string
  contentType: string
  audience: string
  onRegenerate: () => void
  onRefine: (instruction: string) => void
  onClear: () => void
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2 10V2.5A.5.5 0 012.5 2H10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 7.5L5.5 10.5L11.5 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 7A5.5 5.5 0 0112.5 4.5M12.5 7A5.5 5.5 0 011.5 9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M10.5 2.5L12.5 4.5L10.5 6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 11.5L1.5 9.5L3.5 7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 3.5h10M5 3.5V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M5.5 6v4M8.5 6v4M3 3.5l.75 8a.5.5 0 00.5.5h5.5a.5.5 0 00.5-.5l.75-8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function OutputPanel({
  output,
  isGenerating,
  error,
  contentType,
  audience,
  onRegenerate,
  onRefine,
  onClear,
}: Props) {
  const [copied, setCopied] = useState(false)
  const hasContent = output.length > 0
  const hasShownContent = useRef(false)

  useEffect(() => {
    if (hasContent) {
      hasShownContent.current = true
    } else {
      hasShownContent.current = false
    }
  }, [hasContent])

  const handleCopy = () => {
    if (!output) return
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const wordCount = output.trim()
    ? output.trim().split(/\s+/).filter(Boolean).length
    : 0

  const typeLabel = TYPE_LABELS[contentType] ?? contentType
  const audienceLabel = AUDIENCE_LABELS[audience] ?? audience

  const showRefineBar = hasContent || isGenerating

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="px-8 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
        <span className="text-[11px] font-bold tracking-widest uppercase text-gray-400">
          Generated Content
        </span>
        <div className="flex items-center gap-5">
          <button
            onClick={handleCopy}
            disabled={!hasContent}
            className={[
              'flex items-center gap-1.5 text-[13px] transition-colors',
              hasContent
                ? copied
                  ? 'text-emerald-500'
                  : 'text-gray-400 hover:text-gray-700'
                : 'text-gray-200 cursor-default',
            ].join(' ')}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            onClick={onRegenerate}
            disabled={!hasContent && !isGenerating}
            className={[
              'flex items-center gap-1.5 text-[13px] transition-colors',
              hasContent || isGenerating
                ? 'text-gray-400 hover:text-gray-700'
                : 'text-gray-200 cursor-default',
            ].join(' ')}
          >
            <RefreshIcon />
            <span>Regenerate</span>
          </button>
          <button
            onClick={onClear}
            disabled={!hasContent && !isGenerating}
            className={[
              'flex items-center gap-1.5 text-[13px] transition-colors',
              hasContent || isGenerating
                ? 'text-gray-400 hover:text-gray-700'
                : 'text-gray-200 cursor-default',
            ].join(' ')}
          >
            <TrashIcon />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-10 py-8 md:px-16 md:py-12">
        <div className="max-w-[680px] mx-auto w-full">
          {!hasContent && !isGenerating && !error && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
              <p className="text-[17px] text-gray-300 font-light">
                Your content will appear here.
              </p>
              <p className="text-[13px] text-gray-200 mt-2">
                Select a type, audience, and topic on the left.
              </p>
            </div>
          )}

          {error && !hasContent && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-5 py-4">
              <p className="text-[13px] text-red-400">{error}</p>
            </div>
          )}

          {(hasContent || isGenerating) && (
            <div className={hasShownContent.current ? '' : 'animate-fade-in'}>
              {/* Meta tags */}
              {hasContent && (
                <div className="flex items-center gap-2 mb-6">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#063853]/[0.08] text-[#063853]">
                    {typeLabel}
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-500">
                    {audienceLabel}
                  </span>
                </div>
              )}

              <OutputRenderer text={output} />

              {isGenerating && (
                <span className="inline-block w-0.5 h-4 bg-gray-400 animate-pulse ml-0.5" />
              )}

              {hasContent && wordCount > 0 && (
                <p className="text-[12px] text-gray-300 mt-6">
                  {wordCount} words
                </p>
              )}

              {error && hasContent && (
                <p className="text-[12px] text-red-400 mt-4">{error}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Refine bar */}
      {showRefineBar && (
        <div className="shrink-0 border-t border-gray-100 bg-white px-8 py-4">
          <RefinementInput onRefine={onRefine} isGenerating={isGenerating} />
        </div>
      )}
    </div>
  )
}
