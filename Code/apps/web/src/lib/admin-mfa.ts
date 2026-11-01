function readResponseError(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('response' in error)) return ''
  const response = (error as { response?: { data?: { error?: unknown } } }).response
  return typeof response?.data?.error === 'string' ? response.data.error : ''
}

export function isAdminMfaRequiredError(error: unknown): boolean {
  return readResponseError(error) === 'ADMIN_MFA_REQUIRED'
}
