declare global {
  interface Window {
    __assetRecovery?: {
      markReady: () => void
      handleError: (error: unknown) => boolean
    }
  }
}

export function handleAssetError(error: unknown): boolean {
  return window.__assetRecovery?.handleError(error) ?? false
}

export function markAppReady(): void {
  window.__assetRecovery?.markReady()
}
