import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  language?: string
  title?: string
  children: string
}

export function CodeBlock({ language = '', title, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-surface-700 mb-4 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-800 border-b border-surface-700">
        <span className="text-xs text-gray-400 font-mono">{title || language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* Code content */}
      <pre className="p-4 bg-surface-850 overflow-x-auto mb-0! border-0! rounded-none!">
        <code className="text-sm font-mono text-gray-200 bg-transparent! p-0!">
          {children}
        </code>
      </pre>
    </div>
  )
}
