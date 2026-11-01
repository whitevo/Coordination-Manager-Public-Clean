import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import type { Intent } from '../lib/design-tokens';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** `danger` only for destructive consequences; wide scope alone is not danger. */
  intent?: Extract<Intent, 'primary' | 'danger'>;
  /** Shown next to the confirm action so scope is explicit before acting. */
  affectedCount?: number;
  /** Extra detail between the message and the actions (scope lists, opt-outs). */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  intent = 'danger',
  affectedCount,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // The least destructive action takes initial focus, even when the extra
  // content holds controls that would otherwise come first.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmLabel =
    typeof affectedCount === 'number' ? `${confirmText} (${affectedCount})` : confirmText;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      initialFocusRef={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} emphasis="ghost" intent="neutral" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button emphasis="solid" intent={intent} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
