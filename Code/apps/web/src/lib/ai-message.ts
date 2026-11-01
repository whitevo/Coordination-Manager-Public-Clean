export const AI_MESSAGE_MAX_LENGTH = 4000

export function getAiMessageError(message: string): string | null {
  if (message.length > AI_MESSAGE_MAX_LENGTH) {
    return `Your message is too long (${message.length} characters). The maximum is ${AI_MESSAGE_MAX_LENGTH} characters. Shorten it before sending; your text has not been cut.`
  }
  return null
}
