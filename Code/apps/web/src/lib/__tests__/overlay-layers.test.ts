import { beforeEach, describe, expect, it } from 'vitest'
import {
  OVERLAY_BASE_Z,
  OVERLAY_LAYER_CLASS,
  SHELL_LAYER_CLASS,
  SHELL_LAYER_Z,
  isBlockingOverlayKind,
  isTopOverlay,
  pushOverlay,
  resetOverlayStack,
} from '../overlay-layers'

describe('overlay layers', () => {
  beforeEach(() => resetOverlayStack())

  it('gives each kind its base layer when nothing else is open', () => {
    expect(pushOverlay('dialog').z).toBe(OVERLAY_BASE_Z.dialog)
    resetOverlayStack()
    expect(pushOverlay('drawer').z).toBe(OVERLAY_BASE_Z.drawer)
  })

  it('stacks a dialog above a focus modal that opened it', () => {
    const modal = pushOverlay('focusModal')
    const dialog = pushOverlay('dialog')
    expect(dialog.z).toBeGreaterThan(modal.z)
  })

  it('stacks a dialog above another dialog', () => {
    const first = pushOverlay('dialog')
    const second = pushOverlay('dialog')
    expect(second.z).toBeGreaterThan(first.z)
  })

  it('keeps toasts above blocking overlays without being pushed by them', () => {
    pushOverlay('focusModal')
    pushOverlay('dialog')
    const toast = pushOverlay('toast')
    expect(toast.z).toBe(OVERLAY_BASE_Z.toast)
  })

  it('reports only the newest blocking overlay as top', () => {
    const first = pushOverlay('dialog')
    const second = pushOverlay('dialog')
    expect(isTopOverlay(first.id)).toBe(false)
    expect(isTopOverlay(second.id)).toBe(true)
  })

  it('restores the previous top when an overlay is released', () => {
    const first = pushOverlay('dialog')
    const second = pushOverlay('dialog')
    second.release()
    expect(isTopOverlay(first.id)).toBe(true)
  })

  it('does not let a released overlay keep inflating later layers', () => {
    const first = pushOverlay('dialog')
    first.release()
    expect(pushOverlay('dialog').z).toBe(OVERLAY_BASE_Z.dialog)
  })

  describe('floating tiers (popover, tooltip)', () => {
    it('orders popover below tooltip, and both below drawers', () => {
      expect(OVERLAY_BASE_Z.popover).toBeLessThan(OVERLAY_BASE_Z.tooltip)
      expect(OVERLAY_BASE_Z.tooltip).toBeLessThan(OVERLAY_BASE_Z.drawer)
    })

    it('keeps the static layer classes in sync with the base z values', () => {
      expect(OVERLAY_LAYER_CLASS.popover).toBe(`z-${OVERLAY_BASE_Z.popover}`)
      expect(OVERLAY_LAYER_CLASS.tooltip).toBe(`z-${OVERLAY_BASE_Z.tooltip}`)
      expect(OVERLAY_LAYER_CLASS.toast).toBe(`z-${OVERLAY_BASE_Z.toast}`)
    })

    it('uses the base when nothing blocking is open', () => {
      expect(pushOverlay('popover').z).toBe(OVERLAY_BASE_Z.popover)
      expect(pushOverlay('tooltip').z).toBe(OVERLAY_BASE_Z.tooltip)
    })

    it('resolves a menu opened inside a dialog above that dialog', () => {
      const dialog = pushOverlay('dialog')
      const menu = pushOverlay('popover')
      expect(menu.z).toBeGreaterThan(dialog.z)
    })

    it('never becomes the top overlay or raises later dialogs', () => {
      const dialog = pushOverlay('dialog')
      const menu = pushOverlay('popover')
      pushOverlay('tooltip')
      expect(isTopOverlay(menu.id)).toBe(false)
      expect(isTopOverlay(dialog.id)).toBe(true)
      const nested = pushOverlay('dialog')
      expect(nested.z).toBe(dialog.z + 2)
      expect(nested.z).toBeGreaterThan(menu.z)
    })

    it('classifies only drawer, dialog and focusModal as blocking', () => {
      expect(isBlockingOverlayKind('popover')).toBe(false)
      expect(isBlockingOverlayKind('tooltip')).toBe(false)
      expect(isBlockingOverlayKind('toast')).toBe(false)
      expect(isBlockingOverlayKind('drawer')).toBe(true)
      expect(isBlockingOverlayKind('dialog')).toBe(true)
      expect(isBlockingOverlayKind('focusModal')).toBe(true)
    })
  })

  describe('app-shell layers', () => {
    it('keeps the shell classes in sync with the shell z values', () => {
      expect(SHELL_LAYER_CLASS.sidePanelBackdrop).toBe(`z-${SHELL_LAYER_Z.sidePanelBackdrop}`)
      expect(SHELL_LAYER_CLASS.sidePanel).toBe(`z-${SHELL_LAYER_Z.sidePanel}`)
      expect(SHELL_LAYER_CLASS.nav).toBe(`z-${SHELL_LAYER_Z.navMobile} md:z-${SHELL_LAYER_Z.navDesktop}`)
    })

    it('puts side panels under page popovers and above their backdrop', () => {
      expect(SHELL_LAYER_Z.sidePanelBackdrop).toBeLessThan(SHELL_LAYER_Z.sidePanel)
      expect(SHELL_LAYER_Z.sidePanel).toBeLessThan(OVERLAY_BASE_Z.popover)
    })

    it('puts the desktop nav above popovers but under tooltips and blocking overlays', () => {
      expect(SHELL_LAYER_Z.navDesktop).toBeGreaterThan(OVERLAY_BASE_Z.popover)
      expect(SHELL_LAYER_Z.navDesktop).toBeLessThan(OVERLAY_BASE_Z.tooltip)
      expect(SHELL_LAYER_Z.navDesktop).toBeLessThan(OVERLAY_BASE_Z.drawer)
    })

    it('keeps the mobile nav above drawers but never above dialogs or toasts', () => {
      expect(SHELL_LAYER_Z.navMobile).toBeGreaterThan(OVERLAY_BASE_Z.drawer)
      expect(SHELL_LAYER_Z.navMobile).toBeLessThanOrEqual(OVERLAY_BASE_Z.dialog)
      expect(SHELL_LAYER_Z.navMobile).toBeLessThan(OVERLAY_BASE_Z.toast)
    })
  })
})
