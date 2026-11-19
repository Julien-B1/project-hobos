/**
 * Engine: owns the renderer, scene, camera, picking and render loop.
 *
 * Layer: render. The app layer creates one `Engine` per canvas and receives
 * HUD state through a callback. The engine never holds Vue objects, and the
 * app must keep the engine out of reactive state (plain variable or
 * `markRaw`) so Three.js objects are never proxied.
 */
import { Raycaster, Vector2, type Scene } from 'three/webgpu'
import { worldToCell, type CellCoord } from '@/core/coords'
import type { VoxelMap } from '@/core/voxelMap'
import { CameraRig, type CameraRigSettings } from './cameraRig'
import { ChunkRenderer } from './chunkRenderer'
import { createRenderer, type RenderBackend, type RendererHandle } from './createRenderer'
import { CellHighlight } from './highlight'
import { materialColor } from './materialPalette'
import { CulledMesher } from './meshing/culledMesher'
import { createScene } from './sceneSetup'

/** Snapshot of engine state shown by the debug HUD. Replaced, never mutated. */
export interface EngineHudState {
  /** Backend selected by the renderer. */
  readonly backend: RenderBackend
  /** Frames per second, averaged over the last measurement window. */
  readonly fps: number
  /** Cell under the mouse cursor, or null when the cursor is off the terrain. */
  readonly hoveredCell: CellCoord | null
  /** Number of chunk meshes in the scene. */
  readonly chunkMeshes: number
}

/** Options for {@link Engine.create}. */
export interface EngineOptions {
  /** Force the WebGL 2 backend instead of WebGPU. */
  readonly forceWebGL: boolean
  /** Orbit camera settings. */
  readonly camera: CameraRigSettings
  /** Voxel terrain to display and pick on. The engine only reads it. */
  readonly map: VoxelMap
  /** Called when HUD-visible state changes (at most a few times per second for FPS). */
  readonly onHudChange: (state: EngineHudState) => void
}

/** Length of the FPS measurement window, in milliseconds. */
const FPS_WINDOW_MS = 500

/**
 * Upper bound for one frame's time step, in seconds. Avoids big jumps in
 * animations after the tab was in the background.
 */
const MAX_FRAME_DT = 0.1

/**
 * Rendering engine bound to one canvas.
 *
 * Lifecycle: `await Engine.create(...)`, then `start()`, then `dispose()`
 * when the canvas goes away.
 */
export class Engine {
  private readonly scene: Scene
  private readonly rig: CameraRig
  private readonly resizeObserver: ResizeObserver
  private readonly chunks: ChunkRenderer
  private readonly highlight = new CellHighlight()
  private readonly raycaster = new Raycaster()
  /** Cursor in normalised device coordinates, or null when outside the canvas. */
  private pointerNdc: Vector2 | null = null
  private hud: EngineHudState
  private frameCount = 0
  private windowStart = 0
  private lastFrameTime: number | null = null

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handle: RendererHandle,
    private readonly options: EngineOptions,
  ) {
    this.scene = createScene()
    this.rig = new CameraRig(options.camera)

    this.chunks = new ChunkRenderer(options.map, new CulledMesher(materialColor))
    // Every chunk of a freshly generated map is dirty: the first update builds them all.
    this.chunks.update()
    this.scene.add(this.chunks.group)
    this.scene.add(this.highlight.mesh)

    this.hud = {
      backend: handle.backend,
      fps: 0,
      hoveredCell: null,
      chunkMeshes: this.chunks.meshCount,
    }

    // Observe the canvas itself: it is sized by CSS, the renderer follows.
    this.resizeObserver = new ResizeObserver(() => {
      this.resize()
    })
    this.resizeObserver.observe(canvas)
    this.resize()
  }

  /** Create an engine on `canvas`. Resolves once the GPU backend is ready. */
  static async create(canvas: HTMLCanvasElement, options: EngineOptions): Promise<Engine> {
    const handle = await createRenderer(canvas, { forceWebGL: options.forceWebGL })
    return new Engine(canvas, handle, options)
  }

  /** Orbit camera, driven by the app's input bindings. */
  get cameraRig(): CameraRig {
    return this.rig
  }

  /**
   * Update the cursor position, in CSS pixels relative to the canvas'
   * top-left corner. Picking runs on the next frame.
   */
  setPointer(cssX: number, cssY: number): void {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    // NDC: x and y in [-1, 1], y pointing up (screen y points down).
    this.pointerNdc ??= new Vector2()
    this.pointerNdc.set((cssX / width) * 2 - 1, -(cssY / height) * 2 + 1)
  }

  /** The cursor left the canvas: stop picking and hide the highlight. */
  clearPointer(): void {
    this.pointerNdc = null
  }

  /** Start the render loop and publish the initial HUD state. */
  start(): void {
    this.options.onHudChange(this.hud)
    void this.handle.renderer.setAnimationLoop((time) => {
      this.frame(time)
    })
  }

  /** Stop the loop and release GPU resources and observers. */
  dispose(): void {
    void this.handle.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.chunks.dispose()
    // dispose() is async in WebGPURenderer; nothing to wait for on teardown.
    void this.handle.renderer.dispose()
  }

  /** One frame: camera, picking, stats, draw. `time` is in milliseconds. */
  private frame(time: number): void {
    const dt = this.lastFrameTime === null ? 0 : (time - this.lastFrameTime) / 1000
    this.lastFrameTime = time
    this.rig.update(Math.min(dt, MAX_FRAME_DT))
    this.chunks.update()
    // Pick every frame: the camera may move under a still cursor.
    this.updateHover()
    this.updateFps(time)
    this.handle.renderer.render(this.scene, this.rig.camera)
  }

  /** Raycast the cursor against the chunk meshes and update highlight and HUD. */
  private updateHover(): void {
    let cell: CellCoord | null = null
    let height = 0
    if (this.pointerNdc) {
      this.raycaster.setFromCamera(this.pointerNdc, this.rig.camera)
      const hit = this.raycaster.intersectObjects(this.chunks.pickables, false)[0]
      if (hit) {
        cell = worldToCell(hit.point.x, hit.point.z)
        height = hit.point.y
      }
    }

    if (cell) this.highlight.showCell(cell.x, cell.z, height)
    else this.highlight.hide()

    const previous = this.hud.hoveredCell
    const changed = cell?.x !== previous?.x || cell?.z !== previous?.z
    if (changed) this.publish({ ...this.hud, hoveredCell: cell })
  }

  /** Count frames and publish the FPS once per measurement window. */
  private updateFps(time: number): void {
    this.frameCount++
    const elapsed = time - this.windowStart
    if (elapsed < FPS_WINDOW_MS) return
    const fps = Math.round((this.frameCount * 1000) / elapsed)
    this.frameCount = 0
    this.windowStart = time
    this.publish({ ...this.hud, fps })
  }

  /** Replace the HUD state and notify the app. */
  private publish(next: EngineHudState): void {
    this.hud = next
    this.options.onHudChange(next)
  }

  /**
   * Match the drawing buffer to the canvas CSS size.
   *
   * `setSize(..., false)` keeps the canvas style untouched (CSS drives the
   * layout). Pixel ratio is capped at 2 to bound fill-rate on dense screens.
   */
  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    const renderer = this.handle.renderer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height, false)
    this.rig.setAspect(width / height)
  }
}
