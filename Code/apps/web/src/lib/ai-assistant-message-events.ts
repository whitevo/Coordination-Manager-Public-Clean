type MessageListener = (event: Event) => void
let listener: MessageListener | null = null
const pending: Event[] = []
let owners = 0
let stopRouting: (() => void) | null = null

function ensureRouting(): void {
  if (stopRouting) return
  const receive = (event: Event) => {
    if (listener) listener(event)
    else pending.push(event)
  }
  window.addEventListener('aiAssistantMessage', receive)
  stopRouting = () => {
    window.removeEventListener('aiAssistantMessage', receive)
    pending.length = 0
  }
}

function releaseRouting(): void {
  if (owners || listener) return
  stopRouting?.()
  stopRouting = null
}

export function bufferAiAssistantMessages(): () => void {
  owners += 1
  ensureRouting()
  return () => {
    owners -= 1
    releaseRouting()
  }
}

export function subscribeAiAssistantMessages(receive: MessageListener): () => void {
  ensureRouting()
  listener = receive
  for (const event of pending.splice(0)) receive(event)
  return () => {
    if (listener === receive) listener = null
    releaseRouting()
  }
}
