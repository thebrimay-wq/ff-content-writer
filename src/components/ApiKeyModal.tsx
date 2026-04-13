import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'

interface Props {
  initialKey: string
  onSave: (key: string) => void
  onClose: () => void
}

export default function ApiKeyModal({ initialKey, onSave, onClose }: Props) {
  const [value, setValue] = useState(initialKey)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSave = () => {
    onSave(value.trim())
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave()
    }
  }

  const handleBackdropClick = () => {
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-8 w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-bold text-[18px] text-gray-900 mb-1">Anthropic API Key</h2>
        <p className="text-[13px] text-gray-400 mb-6">
          Your key is stored for this browser session only and never sent anywhere except the
          Anthropic API.
        </p>

        <label className="text-[10px] font-bold tracking-widest uppercase text-gray-400 block mb-1.5">
          API Key
        </label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="sk-ant-..."
          className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 placeholder-gray-300 outline-none transition focus:border-gray-400 mb-6 font-mono"
          spellCheck={false}
          autoComplete="off"
        />

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[14px] font-semibold text-gray-500 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-[14px] font-bold text-white bg-[#063853] hover:bg-[#04293D] rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
