import { useState, useEffect, useCallback } from 'react'
import { Wallet, Shield } from 'lucide-react'
import { detectWallets } from '../lib/cardano-wallet'
import { useAuth } from '../contexts/AuthContext'
import type { WalletInfo, CardanoWalletId } from '../lib/cardano-types'

interface CardanoWalletButtonProps {
  onSuccess?: () => void
  onError?: (error: string) => void
  getCaptchaToken?: () => string | null | undefined
  isCaptchaReady?: boolean
  className?: string
}

export default function CardanoWalletButton({ onSuccess, onError, getCaptchaToken, isCaptchaReady = true, className = '' }: CardanoWalletButtonProps) {
  const { loginWithCardano } = useAuth()
  const [wallets, setWallets] = useState<WalletInfo[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null)

  const refreshWallets = useCallback(() => {
    setWallets(detectWallets())
  }, [])

  // Detect available wallets on mount and after extension context changes.
  useEffect(() => {
    const delays = [350, 1000, 2200]
    const timers = delays.map((delay) => setTimeout(refreshWallets, delay))

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshWallets()
      }
    }

    window.addEventListener('focus', refreshWallets)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      window.removeEventListener('focus', refreshWallets)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refreshWallets])

  const installedWallets = wallets.filter((w) => w.installed)
  const hasWallets = installedWallets.length > 0

  const handleWalletConnect = useCallback(async (walletId: CardanoWalletId) => {
    setIsConnecting(true)
    setConnectingWallet(walletId)
    setIsOpen(false)

    try {
      if (!isCaptchaReady) {
        onError?.('Please complete the captcha verification first.')
        setIsConnecting(false)
        setConnectingWallet(null)
        return
      }
      await loginWithCardano(walletId, getCaptchaToken?.() || undefined)
      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wallet connection failed'
      onError?.(message)
    } finally {
      setIsConnecting(false)
      setConnectingWallet(null)
    }
  }, [onSuccess, onError, getCaptchaToken, isCaptchaReady, loginWithCardano])

  // If no wallets detected, show an install prompt
  if (!hasWallets) {
    return (
      <div className={`relative ${className}`}>
        <a
          href="https://lace.io"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl hover:bg-blue-100/80 dark:hover:bg-blue-900/60 transition-colors"
        >
          <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <span className="font-medium text-blue-800 dark:text-blue-200">
            Install a Cardano Wallet
          </span>
        </a>
        <p className="text-xs text-center text-muted-foreground mt-1">
          Install Eternl, Lace, or Typhon to connect with Cardano
        </p>
      </div>
    )
  }

  // Permission info shown below wallet buttons
  const permissionInfo = (
    <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
      <Shield className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>
        Connecting grants read-only access to your <strong>wallet address</strong> and <strong>UTXOs</strong>.
        You will sign a message to prove ownership — no transaction is submitted.
      </span>
    </div>
  )

  // Single wallet installed — direct connect button
  if (installedWallets.length === 1) {
    const wallet = installedWallets[0]
    return (
      <div className={`${className}`}>
        <button
          onClick={() => handleWalletConnect(wallet.id)}
          disabled={isConnecting}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl hover:bg-blue-100/80 dark:hover:bg-blue-900/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {wallet.icon ? (
            <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded" />
          ) : (
            <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          )}
          <span className="font-medium text-blue-800 dark:text-blue-200">
            {isConnecting ? 'Connecting...' : `Connect ${wallet.name} Wallet`}
          </span>
        </button>
        {isConnecting && (
          <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-2">
            Check your wallet extension — open it and click <strong>Sign</strong> to continue.
            The &quot;Confirm Data&quot; screen may show a loading spinner; you can still sign.
          </p>
        )}
        {!isConnecting && permissionInfo}
      </div>
    )
  }

  // Multiple wallets — show dropdown
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isConnecting}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl hover:bg-blue-100/80 dark:hover:bg-blue-900/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <span className="font-medium text-blue-800 dark:text-blue-200">
          {isConnecting ? `Connecting to ${connectingWallet}...` : 'Connect Cardano Wallet'}
        </span>
        {!isConnecting && (
          <svg
            className={`w-4 h-4 text-blue-600 dark:text-blue-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown list of wallets */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          {installedWallets.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => handleWalletConnect(wallet.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
            >
              {wallet.icon ? (
                <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded" />
              ) : (
                <Wallet className="w-5 h-5 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">{wallet.name}</span>
            </button>
          ))}
        </div>
      )}
      {isConnecting && (
        <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-2">
          Check your wallet extension — open it and click <strong>Sign</strong> to continue.
          The &quot;Confirm Data&quot; screen may show a loading spinner; you can still sign.
        </p>
      )}
      {!isConnecting && permissionInfo}
    </div>
  )
}
