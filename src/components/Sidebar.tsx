import { ChangeEvent, ReactNode } from 'react'
import { AUDIENCE_LABELS, TYPE_LABELS } from '../lib/api'

interface SidebarProps {
  contentType: string
  audience: string
  topic: string
  notes: string
  isGenerating: boolean
  onContentTypeChange: (v: string) => void
  onAudienceChange: (v: string) => void
  onTopicChange: (v: string) => void
  onNotesChange: (v: string) => void
  onGenerate: () => void
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

interface FieldProps {
  label: string
  children: ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold tracking-widest uppercase text-gray-400">
        {label}
      </label>
      {children}
    </div>
  )
}

interface SelectWrapperProps {
  value: string
  onChange: (v: string) => void
  options: Record<string, string>
  disabled?: boolean
}

function SelectWrapper({ value, onChange, options, disabled }: SelectWrapperProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 outline-none transition focus:border-gray-400 pr-9 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
        <svg
          className="h-4 w-4 text-gray-400"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}

export default function Sidebar({
  contentType,
  audience,
  topic,
  notes,
  isGenerating,
  onContentTypeChange,
  onAudienceChange,
  onTopicChange,
  onNotesChange,
  onGenerate,
}: SidebarProps) {
  const canGenerate = topic.trim().length > 0 && !isGenerating

  return (
    <div className="flex flex-col h-full" style={{ padding: '28px' }}>
      {/* Brand row */}
      <div className="flex items-center justify-between mb-8 shrink-0">
        <span className="font-bold text-[15px] tracking-tight text-gray-900">
          FF Content Writer
        </span>
      </div>

      {/* Form fields */}
      <div className="flex flex-col gap-6 flex-1">
        <Field label="Content type">
          <SelectWrapper
            value={contentType}
            onChange={onContentTypeChange}
            options={TYPE_LABELS}
            disabled={isGenerating}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold tracking-widest uppercase text-gray-400">
            Who is this for?
          </label>
          <SelectWrapper
            value={audience}
            onChange={onAudienceChange}
            options={AUDIENCE_LABELS}
            disabled={isGenerating}
          />
          <p className="text-[11px] text-gray-300 leading-snug">
            We'll adjust tone and depth automatically.
          </p>
        </div>

        <Field label="Topic">
          <input
            type="text"
            value={topic}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onTopicChange(e.target.value)}
            disabled={isGenerating}
            placeholder="What do you want to create?"
            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </Field>

        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onNotesChange(e.target.value)}
            disabled={isGenerating}
            rows={6}
            placeholder="Add stats, rough ideas, or paste existing content..."
            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 resize-none leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </Field>

        <div className="flex flex-col gap-2 mt-auto pt-2 shrink-0">
          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className={[
              'w-full h-11 rounded-lg font-bold text-[14px] text-white flex items-center justify-center gap-2 transition-colors',
              canGenerate
                ? 'bg-[#063853] hover:bg-[#04293D] cursor-pointer active:scale-[0.98]'
                : 'bg-[#063853]/40 cursor-not-allowed',
            ].join(' ')}
          >
            {isGenerating ? (
              <>
                <Spinner />
                <span>Writing...</span>
              </>
            ) : (
              'Generate content'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
