import { useEffect, useMemo } from 'react'
import { ResourceReconciliationGuard } from '@/lib/resource-reconciliation'

export function useResourceReconciliation(scope: string): ResourceReconciliationGuard {
  const guard = useMemo(() => new ResourceReconciliationGuard(scope), [scope])
  useEffect(() => () => guard.reset(), [guard])
  return guard
}