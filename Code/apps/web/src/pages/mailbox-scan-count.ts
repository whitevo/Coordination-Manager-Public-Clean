export function getMailboxScanVisibleCount<Message>({
  previousCount, previousSnapshot, countedSnapshot, messages, changedMessages, replacedMessages, count, filtersChanged,
}: {
  previousCount: number
  previousSnapshot: Message[]
  countedSnapshot: Message[]
  messages: Message[]
  changedMessages: Message[]
  replacedMessages: Message[]
  count: (messages: Message[]) => number
  filtersChanged: boolean
}): number {
  if (filtersChanged || previousSnapshot !== countedSnapshot) return count(messages)
  return previousCount + count(changedMessages) - count(replacedMessages)
}
