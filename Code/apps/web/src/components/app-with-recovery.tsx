import { useEffect } from 'react'
import App from '@/App'
import { markAppReady } from '@/lib/asset-recovery'

export default function AppWithRecovery() {
  useEffect(markAppReady, [])
  return <App />
}
