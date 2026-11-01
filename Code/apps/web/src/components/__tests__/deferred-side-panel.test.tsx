import { lazy, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { DeferredSidePanel } from '../deferred-side-panel'
import { bufferAiAssistantMessages, subscribeAiAssistantMessages } from '@/lib/ai-assistant-message-events'

afterEach(cleanup)

describe('deferred panels', () => {
  it('does not load closed panels and retains a visited panel draft', async () => {
    const load = vi.fn(async () => ({
      default: function Draft() {
        const [value, setValue] = useState('')
        return <input aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} />
      },
    }))
    const Panel = lazy(load)
    const ui = (open: boolean) => <DeferredSidePanel isOpen={open} onClose={() => {}}><Panel /></DeferredSidePanel>
    const { rerender } = render(ui(false))
    expect(load).not.toHaveBeenCalled()
    rerender(ui(true))
    fireEvent.change(await screen.findByLabelText('Draft'), { target: { value: 'Keep me' } })
    rerender(ui(false))
    rerender(ui(true))
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Keep me')
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('buffers page-posted AI results before the panel loads and delivers each once', () => {
    const stopBuffering = bufferAiAssistantMessages()
    const first = new CustomEvent('aiAssistantMessage', { detail: { content: 'Result' } })
    window.dispatchEvent(first)
    const receive = vi.fn()
    const unsubscribe = subscribeAiAssistantMessages(receive)
    expect(receive).toHaveBeenCalledExactlyOnceWith(first)
    unsubscribe()
    const second = new CustomEvent('aiAssistantMessage', { detail: { content: 'Next' } })
    window.dispatchEvent(second)
    const receiveAgain = vi.fn()
    const unsubscribeAgain = subscribeAiAssistantMessages(receiveAgain)
    expect(receiveAgain).toHaveBeenCalledExactlyOnceWith(second)
    unsubscribeAgain()
    stopBuffering()
  })
  it('routes events to a standalone mounted panel and releases its listener', () => {
    const receive = vi.fn()
    const unsubscribe = subscribeAiAssistantMessages(receive)
    const event = new CustomEvent('aiAssistantMessage')
    window.dispatchEvent(event)
    expect(receive).toHaveBeenCalledExactlyOnceWith(event)
    unsubscribe()
    window.dispatchEvent(new CustomEvent('aiAssistantMessage'))
    const nextReceive = vi.fn()
    const nextUnsubscribe = subscribeAiAssistantMessages(nextReceive)
    expect(nextReceive).not.toHaveBeenCalled()
    nextUnsubscribe()
  })
})
