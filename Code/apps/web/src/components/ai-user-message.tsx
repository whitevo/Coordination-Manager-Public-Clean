import { useId, useState } from 'react'
import { Button } from './ui'

interface AiUserMessageProps {
  content: string
}

const PREVIEW_CHARACTERS = 600
const PREVIEW_LINES = 8

export function AiUserMessage({ content }: AiUserMessageProps) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const lines = content.split('\n')
  const preview = lines.slice(0, PREVIEW_LINES).join('\n').slice(0, PREVIEW_CHARACTERS)
  const collapsible = preview.length < content.length

  return (
    <div className="min-w-0">
      <div id={id} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {expanded || !collapsible ? content : `${preview}...`}
      </div>
      {collapsible && (
        <Button
          emphasis="outline"
          size="compact"
          className="mt-2"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  )
}
