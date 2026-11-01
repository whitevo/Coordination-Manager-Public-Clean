export function isNavQuickToolVisible(key: string, adminBlockPower: boolean): boolean {
  return (key !== 'admin-oversight' && key !== 'admin-users') || adminBlockPower
}
