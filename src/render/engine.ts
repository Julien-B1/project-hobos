/**
 * Engine: owns the renderer, scene, camera, picking and render loop.
 *
 * Layer: render. The app layer creates one `Engine` per canvas and receives
 * HUD state through a callback. The engine never holds Vue objects, and the
 * app must keep the engine out of reactive state (plain variable or
 * `markRaw`) so Three.js objects are never proxied.
 */
import { Raycaster, Vector2, type Scene } from 'three/webgpu'
import { CHUNK_SIZE, VOXEL_HEIGHT, type VoxelCoord } from '@/core/coords'
import { TerrainField } from '@/core/terrainSurface'
import { isTerrainMaterial, materialName } from '@/core/materials'
import { shapeDefinition, topHeightAt, voxelTopCorners } from '@/core/shapes'
import { resolveColumnHit, resolveHit, type HitFacing, type SurfaceHit } from '@/core/surface'
import { materialOf, shapeOf } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { CameraRig, type CameraRigSettings } from './cameraRig'
import { ChunkRenderer } from './chunkRenderer'
import { NO_CUT, createLayerMaterials, type LayerMaterialSet } from './materials'
import { NO_HOVER } from './terrainMaterial'
import { SectionPlane, createStencilMaterials, type StencilMaterials } from './sectionCap'
import { createRenderer, type RenderBackend, type RendererHandle } from './createRenderer'
import { SurfaceHighlight, type SurfaceSampler } from './highlight'
import { materialColor } from './materialPalette'
import { BlockyMesher, HybridMesher, isTerrainVoxel } from './meshing/hybridMesher'
import { CapMesher } from './meshing/capMesher'
import { CutCap } from './cutCap'
import { applyLighting, createScene, type SceneHandle } from './sceneSetup'
import { setLightUniforms } from './lightUniforms'
import { LIGHTING, lightDirection, type TimeOfDay } from './timeOfDay'
import { SunShadow, type ShadowQuality } from './sunShadow'
import { FrameStats, estimateVram, type VramEstimate } from './frameStats'

/**
 * Margin (world units) of the hover tint's height band around the base
 * facet heights: more than the crags' offsets, less than the lowest cave or
 * arch roof above a floor.
 */
const HOVER_BAND = 0.45

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
  /** Rendering cost figures, null until the first measurement window ends. */
  readonly render: RenderStats | null
  /** Camera pose, to reproduce a view (updated with the measurement window). */
  readonly camera: CameraInfo
  /** Sun shadow quality in use. */
  readonly shadows: ShadowQuality
  /** Whether the battle-map grid is shown. */
  readonly grid: boolean
  /** Current time of day (lighting preset). */
  readonly timeOfDay: TimeOfDay
  /** Cut height (world units) above which nothing is drawn, or null when off. */
  readonly cutHeight: number | null
  /** Voxel and surface under the cursor, or null when the cursor is off the terrain. */
  readonly hover: HoverInfo | null
  /** Number of chunk meshes in the scene. */
  readonly chunkMeshes: number
  /** Last chunk rebuild batch, to check that edits rebuild only what they must. */
  readonly lastRebuild: RebuildInfo | null
}

/** Rendering cost of the last measurement window (see `frameStats.ts`). */
export interface RenderStats {
  /** Mean GPU time per frame in milliseconds; null when GPU timing is unavailable. */
  readonly gpuMs: number | null
  /** Share of the frame interval the GPU spends on this page (0..1); null when unavailable. */
  readonly gpuLoad: number | null
  /** Draw calls and triangles of the last frame (shadow pass included when it ran). */
  readonly drawCalls: number
  readonly triangles: number
  /** Estimated GPU memory of the page. */
  readonly vram: VramEstimate
  /** Drawing buffer size in device pixels, and the pixel ratio applied. */
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
  /** Shadow map passes since start: constant while the camera and terrain are still. */
  readonly shadowPasses: number
}

/** Camera pose for the HUD. World units and degrees. */
export interface CameraInfo {
  /** Orbit target on the ground plane. */
  readonly targetX: number
  readonly targetZ: number
  /** Distance from the camera to its target. */
  readonly distance: number
  /** Yaw in [0, 360). */
  readonly yawDeg: number
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
   * Terrain rendering: `faceted` (terrain as a low-poly height surface, structures and
   * water as blocks) or `blocky` (every voxel as its exact shape).
   */
  readonly mesher: TerrainMesherKind
  /** Sun shadow quality (`off` disables the shadow pass and lookups). */
  readonly shadows: ShadowQuality
  /** Show the battle-map grid at start-up (toggle later with {@link Engine.setGridVisible}). */
  readonly grid: boolean
  /** Lighting at start-up (change later with {@link Engine.setTimeOfDay}). */
  readonly timeOfDay: TimeOfDay
  /** Called when HUD-visible state changes (at most a few times per second for FPS). */
  readonly onHudChange: (state: EngineHudState) => void
}

/** Available terrain rendering modes, see {@link EngineOptions.mesher}. */
export type TerrainMesherKind = 'faceted' | 'blocky'

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
  private readonly lights: SceneHandle
  private readonly sunShadow: SunShadow
  private readonly rig: CameraRig
  private readonly resizeObserver: ResizeObserver
  private readonly chunks: ChunkRenderer
  /** One material per render layer, shared by all chunks, plus shared controls. */
  private readonly layerMaterials: LayerMaterialSet
  private readonly highlight: SurfaceHighlight
  /** Fills the section of what the cut slices. */
  private readonly cutCap: CutCap
  /** Cut section: stencil companions of the solid layers and the plane they mask. */
  private readonly stencilMaterials: StencilMaterials
  private readonly sectionPlane = new SectionPlane()
  /** The cap must be rebuilt (the cut height changed). */
  private capDirty = false
  /** Latest resolved hit under the cursor. */
  private hit: SurfaceHit | null = null
  private readonly raycaster = new Raycaster()
  /** Hover key and rebuild sequence the highlight was last draped for. */
  private highlightKey = ''
  /** Cursor in normalised device coordinates, or null when outside the canvas. */
  private pointerNdc: Vector2 | null = null
  private hud: EngineHudState
  private readonly stats = new FrameStats()
  /** True while a GPU timestamp readback is in flight (one at a time). */
  private gpuPending = false
  /** Draw calls and triangles of the last rendered frame. */
  private lastDrawCalls = 0
  private lastTriangles = 0
  private lastFrameTime: number | null = null

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handle: RendererHandle,
    private readonly options: EngineOptions,
  ) {
    this.lights = createScene(LIGHTING[options.timeOfDay])
    this.scene = this.lights.scene
    this.layerMaterials = createLayerMaterials(options.grid)
    this.highlight = new SurfaceHighlight(this.layerMaterials.cutHeight)
    this.sunShadow = new SunShadow(this.lights.sun, options.shadows)
    this.applyTimeOfDay(options.timeOfDay)
    this.rig = new CameraRig(options.camera)

    const mesher =
      options.mesher === 'faceted'
        ? new HybridMesher(materialColor)
        : new BlockyMesher(materialColor)
    this.stencilMaterials = createStencilMaterials(this.layerMaterials.cutHeight)
    this.chunks = new ChunkRenderer(
      options.map,
      mesher,
      this.layerMaterials.materials,
      this.stencilMaterials,
    )
    this.scene.add(this.sectionPlane.mesh)
    this.scene.add(this.chunks.group)
    this.scene.add(this.highlight.mesh)
    const terrain = options.mesher === 'faceted' ? isTerrainVoxel : (): boolean => false
    this.cutCap = new CutCap(options.map, new CapMesher(terrain, materialColor))
    this.scene.add(this.cutCap.mesh)

    this.hud = {
      backend: handle.backend,
      fps: 0,
      render: null,
      camera: this.cameraInfo(),
      shadows: options.shadows,
      grid: options.grid,
      timeOfDay: options.timeOfDay,
      cutHeight: null,
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
    const handle = await createRenderer(canvas, {
      forceWebGL: options.forceWebGL,
      shadows: options.shadows !== 'off',
    })
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

  /** Show or hide the battle-map grid (no rebuild: a shader uniform). */
  setGridVisible(visible: boolean): void {
    this.layerMaterials.gridOpacity.value = visible ? 1 : 0
    this.publish({ ...this.hud, grid: visible })
  }

  /** Whether the battle-map grid is shown. */
  get gridVisible(): boolean {
    return this.hud.grid
  }

  /**
   * Hide everything above `height` (world units, any value; null shows
   * everything), to open caves and look under roofs. What the cut slices
   * shows as a section: a plane masked by stencil (`sectionCap.ts`), and
   * the patterned caps of built voxels over it (`cutCap.ts`). Display
   * only: the map is untouched, and picking ignores what is hidden.
   */
  setCutHeight(height: number | null): void {
    this.layerMaterials.cutHeight.value = height ?? NO_CUT
    this.chunks.setSectionVisible(height !== null)
    this.sectionPlane.update(height)
    // Rebuilt in the next frame (several slider events may arrive per frame).
    this.capDirty = true
    this.highlightKey = ''
    this.publish({ ...this.hud, cutHeight: height })
  }

  /** Relight the scene for a time of day (sun or moon, ambient, background, shadows). */
  setTimeOfDay(time: TimeOfDay): void {
    this.applyTimeOfDay(time)
    this.publish({ ...this.hud, timeOfDay: time })
  }

  /** Apply a lighting preset to the lights, the shadow framing and the shader uniforms. */
  private applyTimeOfDay(time: TimeOfDay): void {
    const preset = LIGHTING[time]
    applyLighting(this.lights, preset)
    this.sunShadow.setDirection(lightDirection(preset.azimuthDeg, preset.elevationDeg))
    setLightUniforms(this.layerMaterials.light, preset)
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
    this.cutCap.dispose()
    this.sectionPlane.dispose()
    this.stencilMaterials.back.dispose()
    this.stencilMaterials.front.dispose()
    for (const material of Object.values(this.layerMaterials.materials)) material.dispose()
    // dispose() is async in WebGPURenderer; nothing to wait for on teardown.
    void this.handle.renderer.dispose()
  }

  /** One frame: camera, picking, stats, draw. `time` is in milliseconds. */
  private frame(time: number): void {
    const dt = this.lastFrameTime === null ? 0 : (time - this.lastFrameTime) / 1000
    this.lastFrameTime = time
    this.rig.update(Math.min(dt, MAX_FRAME_DT))
    const rebuilt = this.rebuildDirtyChunks()
    if (this.capDirty || (rebuilt && this.hud.cutHeight !== null)) {
      this.capDirty = false
      this.cutCap.update(this.hud.cutHeight)
      // Hidden parts no longer cast shadows, the cap does.
      this.sunShadow.invalidate()
    }
    this.sunShadow.update(this.rig.focus, this.rig.currentDistance, rebuilt)
    // Pick every frame: the camera may move under a still cursor.
    this.updateHover()
    this.handle.renderer.render(this.scene, this.rig.camera)
    const info = this.handle.renderer.info.render
    this.lastDrawCalls = info.drawCalls
    this.lastTriangles = info.triangles
    this.sampleGpuTime()
    this.updateStats(time)
  }

  /**
   * Rebuild dirty chunks and report the batch to the HUD when not empty.
   * Returns whether any chunk mesh changed.
   */
  private rebuildDirtyChunks(): boolean {
    const start = performance.now()
    const keys = this.chunks.update()
    if (keys.length === 0) return false
    const ms = performance.now() - start
    const seq = (this.hud.lastRebuild?.seq ?? 0) + 1
    this.publish({
      ...this.hud,
      chunkMeshes: this.chunks.meshCount,
      lastRebuild: { keys, ms, seq },
    })
    return true
  }

  /** Raycast the cursor against the chunk meshes and update highlight and HUD. */
  private updateHover(): void {
    let resolved: SurfaceHit | null = null
    if (this.pointerNdc) {
      this.raycaster.setFromCamera(this.pointerNdc, this.rig.camera)
      // First front-facing hit below the cut: what is hidden cannot be
      // picked, nor inner faces.
      const cut = this.layerMaterials.cutHeight.value + 1e-3
      const direction = this.raycaster.ray.direction
      const hit = this.raycaster
        .intersectObjects(this.chunks.pickables, false)
        .find((h) => h.point.y <= cut && (h.face?.normal.dot(direction) ?? 0) < 0)
      // Chunk meshes have an identity transform: the face normal is already in
      // world space. It is the geometric normal of the hit triangle.
      if (hit?.face) {
        // Faceted terrain tops do not match voxel tops: resolve them by column.
        const facetTop = this.options.mesher === 'faceted' && hit.face.normal.y > 0.3
        resolved = facetTop
          ? (resolveColumnHit(this.options.map, hit.point) ??
            resolveHit(this.options.map, hit.point, hit.face.normal))
          : resolveHit(this.options.map, hit.point, hit.face.normal)
      }
    }
    this.hit = resolved

    const hover = resolved ? toHoverInfo(resolved) : null
    if (resolved) {
      // Update only when the target or the terrain changed.
      const key = `${hoverKey(hover)}#${this.hud.lastRebuild?.seq ?? 0}`
      if (key !== this.highlightKey) {
        this.highlightKey = key
        const band = this.terrainBand(resolved)
        if (band) {
          // Terrain: the terrain shader tints the cell (exact on the drawn ground).
          this.highlight.hide()
          this.layerMaterials.hover.value.set(
            resolved.surface.x,
            resolved.surface.z,
            band[0],
            band[1],
          )
        } else {
          this.layerMaterials.hover.value.set(NO_HOVER, NO_HOVER, 0, 0)
          const { x, z } = resolved.surface
          this.highlight.show(x, z, this.surfaceSampler(resolved))
        }
      }
    } else {
      this.highlight.hide()
      this.layerMaterials.hover.value.set(NO_HOVER, NO_HOVER, 0, 0)
      this.highlightKey = ''
    }

    if (hoverKey(hover) !== hoverKey(this.hud.hover)) this.publish({ ...this.hud, hover })
  }

  /**
   * Height function of the targeted surface cell, in world units: the
   * voxel's top corners (blocks, and the fallback for terrain).
   */
  private surfaceSampler(hit: SurfaceHit): SurfaceSampler {
    const { y } = hit.surface
    const corners = voxelTopCorners(hit.surfaceValue)
    return (fx, fz) => (y + topHeightAt(corners, fx, fz)) * VOXEL_HEIGHT
  }

  /**
   * World height band of the targeted terrain cell's ground, for the
   * terrain shader's hover tint: the base facet heights of the targeted run
   * (`TerrainField` corner heights), widened by {@link HOVER_BAND} for the
   * crags; a cave ceiling or a ledge above stays out. Null when the target
   * is not faceted terrain.
   */
  private terrainBand(hit: SurfaceHit): [number, number] | null {
    const { x, y, z } = hit.surface
    if (this.options.mesher !== 'faceted' || !isTerrainMaterial(materialOf(hit.surfaceValue))) {
      return null
    }
    // Same vertical window as the chunk mesher, so heights agree with the mesh.
    const oy = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE
    const field = new TerrainField(
      this.options.map,
      isTerrainVoxel,
      oy - CHUNK_SIZE,
      oy + 2 * CHUNK_SIZE - 1,
    )
    const run = field.runsAt(x, z).find((r) => r.topY === y)
    if (!run) return null
    const heights = field.cornerHeights(x, z, run).map((h) => h * VOXEL_HEIGHT)
    return [Math.min(...heights) - HOVER_BAND, Math.max(...heights) + HOVER_BAND]
  }

  /**
   * Read back the GPU time of a recent frame, at most one readback in
   * flight: the pool returns the last frame it resolved, so each answer is
   * one sample.
   */
  private sampleGpuTime(): void {
    if (!this.handle.gpuTiming || this.gpuPending) return
    this.gpuPending = true
    this.handle.renderer
      .resolveTimestampsAsync()
      .then((ms) => {
        this.stats.gpuSample(ms)
      })
      .catch(() => undefined)
      .finally(() => {
        this.gpuPending = false
      })
  }

  /** Count the frame and publish FPS, cost figures and camera once per window. */
  private updateStats(time: number): void {
    const window = this.stats.frame(time)
    if (!window) return
    const renderer = this.handle.renderer
    const width = renderer.domElement.width
    const height = renderer.domElement.height
    this.publish({
      ...this.hud,
      fps: window.fps,
      render: {
        gpuMs: window.gpuMs,
        gpuLoad: window.gpuLoad,
        drawCalls: this.lastDrawCalls,
        triangles: this.lastTriangles,
        vram: estimateVram(renderer.info.memory, width, height, renderer.samples),
        width,
        height,
        pixelRatio: renderer.getPixelRatio(),
        shadowPasses: this.sunShadow.passCount,
      },
      camera: this.cameraInfo(),
    })
  }

  /** Current camera pose for the HUD. */
  private cameraInfo(): CameraInfo {
    const yaw = this.rig.yawDeg % 360
    return {
      targetX: this.rig.focus.x,
      targetZ: this.rig.focus.z,
      distance: this.rig.currentDistance,
      yawDeg: yaw < 0 ? yaw + 360 : yaw,
    }
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
