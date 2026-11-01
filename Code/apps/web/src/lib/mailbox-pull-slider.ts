export function getMailboxPullStep(absPull: number, distanceToEdge: number): number {
  if (absPull < 5) return 0

  const edgeBoost = Math.max(0, 1 - distanceToEdge / 90)
  const edgeMultiplier = 1 + edgeBoost * 4.5

  const zones: [number, number][] = [
    [60, 1],
    [90, 2],
    [120, 3],
    [150, 4],
    [190, 5],
    [240, 7],
    [300, 9],
    [370, 14],
    [450, 19],
    [540, 25],
    [650, 33],
    [Infinity, 66],
  ]

  const [, step] = zones.find(([threshold]) => absPull < threshold) ?? zones[zones.length - 1]
  const boostedStep = Math.round(step * edgeMultiplier)
  return Math.max(1, boostedStep)
}
