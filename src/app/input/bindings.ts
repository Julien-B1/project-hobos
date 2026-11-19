/**
 * Mouse and keyboard bindings for the game view.
 *
 * Layer: app. Translates DOM events into calls on the render-layer camera rig.
 * Keys use `KeyboardEvent.code` (physical position), so the same physical keys
 * work on AZERTY and QWERTY layouts:
 *
 * | Physical key (QWERTY name) | AZERTY label | Action                     |
 * | -------------------------- | ------------ | -------------------------- |
 * | KeyW / KeyS                | Z / S        | Move target forward / back |
 * | KeyA / KeyD                | Q / D        | Move target left / right   |
 * | KeyQ / KeyE                | A / E        | Rotate 45 degrees (snap)   |
 * | KeyR / KeyF                | R / F        | Zoom in / out (held)       |
 * | NumpadAdd / NumpadSubtract | + / - (pad)  | Zoom in / out (held)       |
 * | KeyC or Home               | C or Home    | Reset view (animated)      |
 * | KeyG                       | G            | Show / hide the grid       |
 * | Arrow keys                 | Arrow keys   | Same as W/A/S/D            |
 *
 * Mouse: left drag = free rotation, middle drag = pan, wheel = zoom. The
 * cursor position is forwarded for hover picking.
 *
 * Debug edits: right click = remove the voxel under the cursor,
 * Shift + left click (without dragging) = place a voxel on the surface.
 */
import type { CameraRig } from '@/render/cameraRig'
import type { EditActions } from '@/app/editing/debugEdits'

/** What the bindings drive: the camera rig and the hover cursor. Implemented by `Engine`. */
export interface InputTarget {
  readonly cameraRig: CameraRig
  /** Cursor position in CSS pixels relative to the canvas top-left corner. */
  setPointer(cssX: number, cssY: number): void
  /** Cursor left the canvas. */
  clearPointer(): void
  /** Whether the battle-map grid is shown. */
  readonly gridVisible: boolean
  /** Show or hide the battle-map grid. */
  setGridVisible(visible: boolean): void
}

/** Sensitivity settings, see `config.input`. */
export interface InputSettings {
  readonly rotateRadPerPixel: number
  readonly zoomPerWheelUnit: number
  readonly dragThresholdPx: number
}

/** Key codes per movement direction. */
const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const

/** Key codes for held keyboard zoom. */
const ZOOM_KEYS = {
  in: ['KeyR', 'NumpadAdd'],
  out: ['KeyF', 'NumpadSubtract'],
} as const

/** Key codes that reset the view. */
const RESET_KEYS: readonly string[] = ['KeyC', 'Home']

/** Ongoing pointer gesture. */
type Drag =
  | { kind: 'none' }
  /** Left button pressed; becomes a rotation once past the drag threshold. */
  | { kind: 'left'; startX: number; lastX: number; rotating: boolean }
  | { kind: 'pan'; lastX: number; lastY: number }

/**
 * Attach input listeners. Returns a function that removes them all.
 *
 * Keyboard listeners go on `window` (the canvas is not focusable); pointer and
 * wheel listeners go on the canvas.
 */
export function bindInputs(
  canvas: HTMLCanvasElement,
  target: InputTarget,
  settings: InputSettings,
  edits: EditActions,
): () => void {
  const rig = target.cameraRig
  const pressed = new Set<string>()
  let drag: Drag = { kind: 'none' }

  const isPressed = (codes: readonly string[]): boolean => codes.some((c) => pressed.has(c))

  /** Recompute the rig's move and zoom intents from the set of held keys. */
  const updateMoveIntent = (): void => {
    const forward = Number(isPressed(MOVE_KEYS.forward)) - Number(isPressed(MOVE_KEYS.back))
    const right = Number(isPressed(MOVE_KEYS.right)) - Number(isPressed(MOVE_KEYS.left))
    rig.setMoveIntent(forward, right)
    // Zooming in = shorter distance = negative intent.
    rig.setZoomIntent(Number(isPressed(ZOOM_KEYS.out)) - Number(isPressed(ZOOM_KEYS.in)))
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.code === 'KeyQ' || e.code === 'KeyE') {
      // Ignore auto-repeat: one press = one 45-degree step.
      if (!e.repeat) rig.snapRotate(e.code === 'KeyQ' ? -1 : 1)
      return
    }
    if (e.code === 'KeyG') {
      if (!e.repeat) target.setGridVisible(!target.gridVisible)
      return
    }
    if (RESET_KEYS.includes(e.code)) {
      if (!e.repeat) rig.reset()
      e.preventDefault() // Home would scroll the page otherwise
      return
    }
    pressed.add(e.code)
    updateMoveIntent()
    if (e.code.startsWith('Arrow')) e.preventDefault()
  }

  const onKeyUp = (e: KeyboardEvent): void => {
    pressed.delete(e.code)
    updateMoveIntent()
  }

  /** Keys released while the window is unfocused never fire keyup: reset. */
  const onBlur = (): void => {
    pressed.clear()
    updateMoveIntent()
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) {
      drag = { kind: 'left', startX: e.clientX, lastX: e.clientX, rotating: false }
    } else if (e.button === 1) {
      // Prevent the browser's middle-click auto-scroll.
      e.preventDefault()
      drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY }
    } else {
      if (e.button === 2) edits.remove()
      return
    }
    canvas.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect()
    target.setPointer(e.clientX - rect.left, e.clientY - rect.top)
    if (drag.kind === 'left') {
      if (!drag.rotating && Math.abs(e.clientX - drag.startX) >= settings.dragThresholdPx) {
        drag.rotating = true
      }
      if (drag.rotating) {
        // Dragging right turns the world right, i.e. the camera left.
        rig.rotateBy(-(e.clientX - drag.lastX) * settings.rotateRadPerPixel)
      }
      drag.lastX = e.clientX
    } else if (drag.kind === 'pan') {
      rig.panByPixels(e.clientX - drag.lastX, e.clientY - drag.lastY, canvas.clientHeight)
      drag.lastX = e.clientX
      drag.lastY = e.clientY
    }
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    // A left press that never turned into a rotation is a click.
    const isClick = e.type === 'pointerup' && drag.kind === 'left' && !drag.rotating
    if (isClick && e.button === 0 && e.shiftKey) edits.place()
    drag = { kind: 'none' }
  }

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    // deltaMode 1 = lines (Firefox): convert to an approximate pixel delta.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    rig.zoomBy(Math.exp(delta * settings.zoomPerWheelUnit))
  }

  const onPointerLeave = (): void => {
    target.clearPointer()
  }

  /** Right click is a debug edit, not the browser menu. */
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
  }

  /** Middle click must not open the auto-scroll or paste on some systems. */
  const onAuxClick = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('auxclick', onAuxClick)
  canvas.addEventListener('contextmenu', onContextMenu)

  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('auxclick', onAuxClick)
    canvas.removeEventListener('contextmenu', onContextMenu)
  }
}
