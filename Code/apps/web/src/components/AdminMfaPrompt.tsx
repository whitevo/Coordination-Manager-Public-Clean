import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button } from './ui'

type AdminMfaMode = 'loading' | 'verify' | 'enroll' | 'missing'

interface AdminMfaPromptProps {
  onVerified: () => void
  onCancel?: () => void
}

export function AdminMfaPrompt({ onVerified, onCancel }: AdminMfaPromptProps) {
  const [mode, setMode] = useState<AdminMfaMode>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const startChallenge = useCallback(async (nextFactorId: string) => {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId: nextFactorId })
    if (error || !data?.id) {
      throw error ?? new Error('Unable to start MFA challenge')
    }
    setChallengeId(data.id)
  }, [])

  const initialize = useCallback(async () => {
    setMode('loading')
    setMessage(null)
    try {
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assurance.data?.currentLevel === 'aal2') {
        onVerified()
        return
      }

      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error

      const verifiedTotp = data?.totp?.find((factor) => factor.status === 'verified')
      if (verifiedTotp?.id) {
        setFactorId(verifiedTotp.id)
        await startChallenge(verifiedTotp.id)
        setMode('verify')
        return
      }

      const enrollment = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Coordination Manager Admin',
      })
      if (enrollment.error || !enrollment.data?.id) {
        throw enrollment.error ?? new Error('Unable to create MFA factor')
      }
      setFactorId(enrollment.data.id)
      setQrCode(enrollment.data.totp.qr_code)
      setSecret(enrollment.data.totp.secret ?? null)
      await startChallenge(enrollment.data.id)
      setMode('enroll')
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to prepare admin MFA verification.'
      setMessage(text)
      setMode('missing')
    }
  }, [onVerified, startChallenge])

  useEffect(() => {
    initialize()
  }, [initialize])

  const submitCode = async () => {
    const trimmedCode = code.trim().replace(/\s+/g, '')
    if (!factorId || !challengeId || trimmedCode.length < 6) {
      setMessage('Enter the 6-digit code from your authenticator app.')
      return
    }

    setIsSubmitting(true)
    setMessage(null)
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: trimmedCode,
      })
      if (error) throw error
      await supabase.auth.refreshSession()
      onVerified()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'MFA verification failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xs">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Admin verification</h2>
            <p className="text-sm text-muted-foreground">Verify once for this signed-in session.</p>
          </div>
        </div>

        {mode === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing MFA verification...
          </div>
        )}

        {mode === 'enroll' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with an authenticator app, then enter the 6-digit code.
            </p>
            {qrCode && <img src={qrCode} alt="Admin MFA QR code" className="mx-auto h-44 w-44 rounded-md bg-white p-2" />}
            {secret && (
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground break-all">
                Manual setup key: {secret}
              </div>
            )}
          </div>
        )}

        {mode === 'verify' && (
          <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
        )}

        {(mode === 'verify' || mode === 'enroll') && (
          <div className="mt-4 space-y-3">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden focus:ring-2 focus:ring-ring"
              placeholder="123456"
            />
            <Button intent="primary" fullWidth onClick={submitCode} loading={isSubmitting}>
              Verify admin session
            </Button>
          </div>
        )}

        {mode === 'missing' && (
          <Button intent="primary" onClick={initialize} className="mt-3">
            Retry MFA setup
          </Button>
        )}

        {message && <p className="mt-3 text-sm text-destructive">{message}</p>}
        {onCancel && (
          <Button emphasis="ghost" onClick={onCancel} className="mt-4">
            Back to settings
          </Button>
        )}
      </div>
    </div>
  )
}