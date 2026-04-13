import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GenerateRequest,
  Message,
  buildRefinementMessage,
  buildUserMessage,
  streamMessage,
} from './lib/api'
import { SYSTEM_PROMPT } from './lib/systemPrompt'
import ApiKeyModal from './components/ApiKeyModal'
import OutputPanel from './components/OutputPanel'
import Sidebar from './components/Sidebar'

export default function App() {
  const keyIsEnvConfigured = !!import.meta.env.VITE_ANTHROPIC_KEY
  const [apiKey, setApiKey] = useState<string>(() => {
    return import.meta.env.VITE_ANTHROPIC_KEY ?? localStorage.getItem('ff_api_key') ?? ''
  })
  const [showApiModal, setShowApiModal] = useState(false)

  const [contentType, setContentType] = useState('article')
  const [audience, setAudience] = useState('all')
  const [topic, setTopic] = useState('')
  const [notes, setNotes] = useState('')

  const [output, setOutput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const runStream = useCallback(
    async (messages: Message[]) => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
      const controller = new AbortController()
      abortRef.current = controller

      setOutput('')
      setError('')
      setIsGenerating(true)

      try {
        await streamMessage(
          apiKey,
          messages,
          SYSTEM_PROMPT,
          (chunk) => {
            setOutput((prev) => prev + chunk)
          },
          controller.signal
        )
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // user cancelled
        } else {
          setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
        }
      } finally {
        setIsGenerating(false)
      }
    },
    [apiKey]
  )

  const handleGenerate = useCallback(() => {
    if (!apiKey) {
      setShowApiModal(true)
      return
    }
    const req: GenerateRequest = { contentType, audience, topic, notes }
    setLastRequest(req)
    const userMessage = buildUserMessage(req)
    runStream([{ role: 'user', content: userMessage }])
  }, [apiKey, contentType, audience, topic, notes, runStream])

  const handleRegenerate = useCallback(() => {
    if (!lastRequest) return
    const userMessage = buildUserMessage(lastRequest)
    runStream([{ role: 'user', content: userMessage }])
  }, [lastRequest, runStream])

  const handleRefine = useCallback(
    (instruction: string) => {
      if (!output || !lastRequest) return
      const refinementMsg = buildRefinementMessage(output, instruction, lastRequest)
      runStream([{ role: 'user', content: refinementMsg }])
    },
    [output, lastRequest, runStream]
  )

  const handleClear = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    setOutput('')
    setError('')
    setLastRequest(null)
    setIsGenerating(false)
  }, [])

  const handleSaveApiKey = useCallback((key: string) => {
    localStorage.setItem('ff_api_key', key)
    setApiKey(key)
    setShowApiModal(false)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!isGenerating && topic.trim()) {
          handleGenerate()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleGenerate, isGenerating, topic])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <aside className="hidden md:flex w-[340px] min-w-[340px] flex-col bg-white border-r border-gray-100 overflow-y-auto">
        <Sidebar
          apiKey={apiKey}
          keyIsEnvConfigured={keyIsEnvConfigured}
          contentType={contentType}
          audience={audience}
          topic={topic}
          notes={notes}
          isGenerating={isGenerating}
          onContentTypeChange={setContentType}
          onAudienceChange={setAudience}
          onTopicChange={setTopic}
          onNotesChange={setNotes}
          onApiKeyClick={() => setShowApiModal(true)}
          onGenerate={handleGenerate}
        />
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <OutputPanel
          output={output}
          isGenerating={isGenerating}
          error={error}
          contentType={contentType}
          audience={audience}
          onRegenerate={handleRegenerate}
          onRefine={handleRefine}
          onClear={handleClear}
        />
      </main>
      {showApiModal && !keyIsEnvConfigured && (
        <ApiKeyModal
          initialKey={apiKey}
          onSave={handleSaveApiKey}
          onClose={() => setShowApiModal(false)}
        />
      )}
    </div>
  )
}
