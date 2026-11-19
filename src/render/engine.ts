/**
 * Engine: owns the renderer, scene, camera, picking and render loop.
 *
 * Layer: render. The app layer creates one `Engine` per canvas and receives
 * HUD state through a callback. The engine never holds Vue objects, and the
 * app must keep the engine out of reactive state (plain variable or
 * `markRaw`) so Three.js objects are never proxied.
 */
import { Raycaster, Vector2, Vector3, type Scene } from 'three/webgpu'
import { VOXEL_HEIGHT, type VoxelCoord } from '@/core/coords'
import { isNaturalMaterial, materialName } from '@/core/materials'
import { shapeDefinition, topHeightAt, voxelTopCorners } from '@/core/shapes'
import { resolveHit, type HitFacing, type SurfaceHit } from '@/core/surface'
import { materialOf, shapeOf } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { CameraRig, type CameraRigSettings } from './cameraRig'
import { ChunkRenderer } from './chunkRenderer'
import { createRenderer, type RenderBackend, type RendererHandle } from './createRenderer'
import { SurfaceHighlight, type SurfaceSampler } from './highlight'
import { materialColor } from './materialPalette'
import { CulledMesher } from './meshing/culledMesher'
import { HybridMesher } from './meshing/hybridMesher'
import { createScene } from './sceneSetup'

/** What the cursor points at, for the HUD. Voxel coordinates. */
export interface HoverInfo {
  /** Voxel touched by the ray. */
  readonly voxel: VoxelCoord
  /** Material and shape names of the touched voxel. */
  readonly material: string
  readonly shape: string
  /** Orientation of the touched face. */
  readonly facing: HitFacing
  /** Voxel whose top is the targeted surface. */
  readonly surface: VoxelCoord
  /** Shape name of the surface voxel. */
  readonly surfaceShape: string
}

/** Snapshot of engine state shown by the debug HUD. Replaced, never mutated. */
export interface EngineHudState {
  /** Backend selected by the renderer. */
  readonly backend: RenderBackend
  /** Frames per second, averaged over the last measurement window. */
  readonly fps: number
  /** Voxel and surface under the cursor, or null when the cursor is off the terrain. */
  readonly hover: HoverInfo | null
  /** Number of chunk meshes in the scene. */
  readonly chunkMeshes: number
  /** Last chunk rebuild batch, to check that edits rebuild only what they must. */
  readonly lastRebuild: RebuildInfo | null
}

/** One batch of chunk rebuilds (one frame). */
export interface RebuildInfo {
  /** Keys ("cx,cy,cz") of the rebuilt or removed chunks. */
  readonly keys: readonly string[]
  /** Time spent meshing and uploading, in milliseconds. */
  readonly ms: number
  /** Sequence number, increases with every batch. */
  readonly seq: number
}

/** Options for {@link Engine.create}. */
export interface EngineOptions {
  /** Force the WebGL 2 backend instead of WebGPU. */
  readonly forceWebGL: boolean
  /** Orbit camera settings. */
  readonly camera: CameraRigSettings
  /** Voxel terrain to display and pick on. The engine only reads it. */
  readonly map: VoxelMap
  /**
   * Terrain rendering: `smooth` (natural terrain smoothed, structures and
   * water as blocks) or `blocky` (every voxel as its exact shape).
   */
  readonly mesher: TerrainMesherKind
  /** Called when HUD-visible state changes (at most a few times per second for FPS). */
  readonly onHudChange: (state: EngineHudState) => void
}

/** Available terrain rendering modes, see {@link EngineOptions.mesher}. */
export type TerrainMesherKind = 'smooth' | 'blocky'

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
  private readonly highlight = new SurfaceHighlight()
  /** Latest resolved hit under the cursor. */
  private hit: SurfaceHit | null = null
  private readonly raycaster = new Raycaster()
  /** Short vertical rays used to drape the highlight on the smooth mesh. */
  private readonly probe = new Raycaster()
  /** Hover key and rebuild sequence the highlight was last draped for. */
  private highlightKey = ''
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

    const mesher =
      options.mesher === 'smooth'
        ? new HybridMesher(materialColor)
        : new CulledMesher(materialColor)
    this.chunks = new ChunkRenderer(options.map, mesher)
    this.scene.add(this.chunks.group)
    this.scene.add(this.highlight.mesh)

    this.hud = {
      backend: handle.backend,
      fps: 0,
      hover: null,
      chunkMeshes: 0,
      lastRebuild: null,
    }
    // Every chunk of a freshly generated map is dirty: the first update builds them all.
    this.rebuildDirtyChunks()

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

  /** Latest hit under the cursor (voxel and surface), or null. */
  get hoveredHit(): SurfaceHit | null {
    return this.hit
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
    this.rebuildDirtyChunks()
    // Pick every frame: the camera may move under a still cursor.
    this.updateHover()
    this.updateFps(time)
    this.handle.renderer.render(this.scene, this.rig.camera)
  }

  /** Rebuild dirty chunks and report the batch to the HUD when not empty. */
  private rebuildDirtyChunks(): void {
    const start = performance.now()
    const keys = this.chunks.update()
    if (keys.length === 0) return
    const ms = performance.now() - start
    const seq = (this.hud.lastRebuild?.seq ?? 0) + 1
    this.publish({
      ...this.hud,
      chunkMeshes: this.chunks.meshCount,
      lastRebuild: { keys, ms, seq },
    })
  }

  /** Raycast the cursor against the chunk meshes and update highlight and HUD. */
  private updateHover(): void {
    let resolved: SurfaceHit | null = null
    if (this.pointerNdc) {
      this.raycaster.setFromCamera(this.pointerNdc, this.rig.camera)
      const hit = this.raycaster.intersectObjects(this.chunks.pickables, false)[0]
      // Chunk meshes have an identity transform: the face normal is already in
      // world space. It is the geometric normal of the hit triangle.
      if (hit?.face) resolved = resolveHit(this.options.map, hit.point, hit.face.normal)
    }
    this.hit = resolved

    const hover = resolved ? toHoverInfo(resolved) : null
    if (resolved) {
      // Re-drape only when the target or the terrain changed: draping casts rays.
      const key = `${hoverKey(hover)}#${this.hud.lastRebuild?.seq ?? 0}`
      if (key !== this.highlightKey) {
        this.highlightKey = key
        const { x, z } = resolved.surface
        this.highlight.show(x, z, this.surfaceSampler(resolved))
      }
    } else {
      this.highlight.hide()
      this.highlightKey = ''
    }

    if (hoverKey(hover) !== hoverKey(this.hud.hover)) this.publish({ ...this.hud, hover })
  }

  /**
   * Height function of the targeted surface cell, in world units.
   *
   * Blocky tops follow the voxel's corner heights. Smooth terrain does not
   * match voxel tops exactly, so its height is measured on the mesh with a
   * short downward ray per sample, starting just above the voxel surface
   * (below any bridge deck or tunnel ceiling above it). Falls back to the
   * voxel top when a ray misses.
   */
  private surfaceSampler(hit: SurfaceHit): SurfaceSampler {
    const { x, y, z } = hit.surface
    const corners = voxelTopCorners(hit.surfaceValue)
    const voxelTop: SurfaceSampler = (fx, fz) => (y + topHeightAt(corners, fx, fz)) * VOXEL_HEIGHT
    const smooth =
      this.options.mesher === 'smooth' && isNaturalMaterial(materialOf(hit.surfaceValue))
    if (!smooth) return voxelTop

    const targets = this.chunks.pickables
    const startY = (y + 1) * VOXEL_HEIGHT + 0.75
    const origin = new Vector3()
    const down = new Vector3(0, -1, 0)
    this.probe.far = 2
    return (fx, fz) => {
      // Stay a hair inside the cell so border samples do not hit the neighbour's wall.
      const px = x + Math.min(0.99, Math.max(0.01, fx))
      const pz = z + Math.min(0.99, Math.max(0.01, fz))
      this.probe.set(origin.set(px, startY, pz), down)
      const hitBelow = this.probe.intersectObjects(targets, false)[0]
      return hitBelow ? hitBelow.point.y : voxelTop(fx, fz)
    }
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

/** Describe a hit for the HUD. */
function toHoverInfo(hit: SurfaceHit): HoverInfo {
  return {
    voxel: hit.voxel,
    material: materialName(materialOf(hit.voxelValue)),
    shape: shapeDefinition(shapeOf(hit.voxelValue)).name,
    facing: hit.facing,
    surface: hit.surface,
    surfaceShape: shapeDefinition(shapeOf(hit.surfaceValue)).name,
  }
}

/** Identity of a hover state, to publish only on change. */
function hoverKey(h: HoverInfo | null): string {
  if (!h) return ''
  const { voxel: v, surface: s } = h
  return `${v.x},${v.y},${v.z}|${s.x},${s.y},${s.z}|${h.facing}|${h.material}|${h.shape}`
}
