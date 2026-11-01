import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Dialog } from './Dialog'
import { Button } from './Button'
import type { Intent } from '../../lib/design-tokens'

export interface DialogChoice<T extends string> {
  value: T
  label: string
  description?: string
  intent?: Intent
}

export interface ChoiceDialogProps<T extends string> {
  open: boolean
  title: string
  description?: ReactNode
  choices: DialogChoice<T>[]
  onChoose: (value: T) => void
  onCancel: () => void
  cancelText?: string
}

/**
 * A decision with more than two outcomes, such as "this occurrence / the whole
 * series / cancel". Stacks vertically so no option is hidden behind a cycle.
 */
export function ChoiceDialog<T extends string>({
  open,
  title,
  description,
  choices,
  onChoose,
  onCancel,
  cancelText = 'Cancel',
}: ChoiceDialogProps<T>) {
  // Cancel takes initial focus so Enter never commits an outcome by accident.
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      initialFocusRef={cancelRef}
    >
      <div className="flex flex-col gap-2">
        {choices.map(choice => (
          <Button
            key={choice.value}
            emphasis="outline"
            intent={choice.intent ?? 'neutral'}
            fullWidth
            className="h-auto flex-col items-start py-2 text-left"
            onClick={() => onChoose(choice.value)}
          >
            <span className="font-medium">{choice.label}</span>
            {choice.description && (
              <span className="text-xs font-normal opacity-80">{choice.description}</span>
            )}
          </Button>
        ))}
        <Button ref={cancelRef} emphasis="ghost" intent="neutral" fullWidth onClick={onCancel}>
          {cancelText}
        </Button>
      </div>
    </Dialog>
  )
}
