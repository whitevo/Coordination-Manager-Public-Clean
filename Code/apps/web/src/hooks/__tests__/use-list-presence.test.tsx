import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useListPresence } from '../use-list-presence'

interface Item { id: string; label: string }

function Fixture({ items }: { items: Item[] }) {
  const presence = useListPresence(items)
  return <div ref={presence.containerRef}>
    <output data-testid="count">{items.length}</output>
    {presence.items.map(item => <div key={item.id} data-presence-key={item.id}
      data-testid={item.id} aria-hidden={presence.exitingIds.has(item.id)}>
      {item.label}
    </div>)}
  </div>
}

describe('list presence ownership', () => {
  afterEach(() => vi.useRealTimers())

  it('exits a batch together without restoring an older survivor snapshot', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Fixture items={[
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' },
    ]} />)
    rerender(<Fixture items={[{ id: 'a', label: 'A' }, { id: 'd', label: 'D' }]} />)
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(screen.getByTestId('b').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByTestId('c').getAttribute('aria-hidden')).toBe('true')
    rerender(<Fixture items={[{ id: 'a', label: 'A' }, { id: 'd', label: 'Latest D' }]} />)
    act(() => vi.advanceTimersByTime(150))
    expect(screen.queryByTestId('b')).toBeNull()
    expect(screen.queryByTestId('c')).toBeNull()
    expect(screen.getByTestId('d').textContent).toBe('Latest D')
  })

  it('cancels an exit when the current selector restores the same entity', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Fixture items={[{ id: 'a', label: 'A' }]} />)
    rerender(<Fixture items={[]} />)
    act(() => vi.advanceTimersByTime(50))
    rerender(<Fixture items={[{ id: 'a', label: 'Restored A' }]} />)
    act(() => vi.advanceTimersByTime(150))
    expect(screen.getByTestId('a').textContent).toBe('Restored A')
    expect(screen.getByTestId('a').getAttribute('aria-hidden')).toBe('false')
  })
})