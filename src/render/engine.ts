/**
 * Engine: owns the renderer, scene, camera, picking and render loop.
 *
 * Layer: render. The app layer creates one `Engine` per canvas and receives
 * HUD state through a callback. The engine never holds Vue objects, and the
 * app must keep the engine out of reactive state (plain variable or
 * `markRaw`) so Three.js objects are never proxied.
 */
import { Raycaster, Vector2, Vector3, type Mesh, type Scene } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { CHUNK_SIZE, VOXEL_HEIGHT, type VoxelCoord } from '@/core/coords'
import { TerrainField } from '@/core/terrainSurface'
import { isTerrainMaterial, materialName } from '@/core/materials'
import { shapeDefinition, topHeightAt, voxelTopCorners } from '@/core/shapes'
import {
  resolveColumnHit,
  resolveHit,
  wadeThrough,
  type HitFacing,
  type SurfaceHit,
} from '@/core/surface'
import { isAir, materialOf, shapeOf } from '@/core/voxel'
import { defaultStructureKinds } from '@/core/structures/kinds'
import type { StructureSet } from '@/core/structures/structureSet'
import type { VoxelMap } from '@/core/voxelMap'
import { WalkArea, type Stand } from '@/core/navigation/walkArea'
import { Character, type CharacterClips, type WalkPoint } from './actors/character'
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

/**
 * Performance probes (debug): parts of the frame that can be switched off
 * one at a time to read their cost in the HUD's GPU time. `halfRes` is the
 * opposite: on renders at half the pixel ratio (fill-rate bound or not).
 */
export const PROBES = ['shadows', 'foliage', 'scatter', 'water', 'terrain', 'halfRes'] as const

/** One performance probe. */
export type ProbeId = (typeof PROBES)[number]

/** Probe states at start-up: everything drawn, full resolution. */
const ALL_ON: Readonly<Record<ProbeId, boolean>> = {
  shadows: true,
  foliage: true,
  scatter: true,
  water: true,
  terrain: true,
  halfRes: false,
}

/**
 * How far above and below the expected feet height the ground under a
 * character is looked for, in world units (more than a step, less than the
 * gap between a bridge deck and the path under it).
 */
const GROUND_REACH = 0.9

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
  /** Performance probes: what is switched off to measure its cost. */
  readonly probes: Readonly<Record<ProbeId, boolean>>
  /** The character: the stand it is at or walks to, and its state; null before it loads. */
  readonly character: CharacterInfo | null
}

/** Character state for the HUD. */
export interface CharacterInfo {
  /** Stand it is at, or the end of its walk. Voxel coordinates. */
  readonly stand: VoxelCoord
  readonly selected: boolean
  readonly walking: boolean
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
  /** Structures of the map (already stamped into it), drawn by their meshers. */
  readonly structures?: StructureSet
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
  /** Pixel ratio factor (performance probe `halfRes`). */
  private resolutionScale = 1
  private readonly rig: CameraRig
  private readonly resizeObserver: ResizeObserver
  private readonly chunks: ChunkRenderer
  /** One material per render layer, shared by all chunks, plus shared controls. */
  private readonly layerMaterials: LayerMaterialSet
  private readonly highlight: SurfaceHighlight
  /** Fills the section of what the cut slices. */
  private readonly cutCap: CutCap
  /** Structure kinds (walking surfaces of the structures, for the cursor). */
  private readonly structureKinds = defaultStructureKinds()
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
  /** Where characters can stand and walk (built on first use). */
  private walkArea: WalkArea | null = null
  /** The player's character, once loaded. */
  private character: Character | null = null
  /** Stand the character is at, or will reach at the end of its walk. */
  private characterStand: Stand | null = null
  /** Downward ray finding the ground under the character. */
  private readonly groundRay = new Raycaster()

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
        ? new HybridMesher(materialColor, options.structures)
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
      character: null,
      probes: { ...ALL_ON },
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

  /** Flip a performance probe (debug, see {@link PROBES}). */
  toggleProbe(id: ProbeId): void {
    const probes = { ...this.hud.probes, [id]: !this.hud.probes[id] }
    const on = probes[id]
    switch (id) {
      case 'shadows':
        this.sunShadow.setEnabled(on)
        break
      case 'scatter':
        this.chunks.setLayerVisible('scatter', on)
        this.chunks.setLayerVisible('props', on)
        break
      case 'halfRes':
        this.resolutionScale = on ? 0.5 : 1
        this.resize()
        break
      default:
        this.chunks.setLayerVisible(id, on)
    }
    this.publish({ ...this.hud, probes })
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

  /**
   * Load a character model and put it on grass, in the largest walkable
   * region of the map, as close as possible to (x, z) (world units).
   * Resolves to false when the map has no such spot.
   */
  async spawnCharacter(
    url: string,
    clips: CharacterClips,
    near: { readonly x: number; readonly z: number },
  ): Promise<boolean> {
    const stand = this.walking().spawnPoint(near.x, near.z)
    if (!stand) return false
    const gltf = await new GLTFLoader().loadAsync(url)
    const character = new Character(
      gltf.scene,
      gltf.animations,
      clips,
      this.layerMaterials.cutHeight,
    )
    character.placeAt(walkPoint(stand))
    this.character?.dispose()
    this.character = character
    this.characterStand = stand
    this.scene.add(character.root, ...character.decals)
    this.publishCharacter()
    return true
  }

  /**
   * Left click: select the character when the cursor is on it (its body or
   * its cell), else clear the selection.
   */
  select(): void {
    const character = this.character
    if (!character) return
    let on = false
    if (this.pointerNdc) {
      this.raycaster.setFromCamera(this.pointerNdc, this.rig.camera)
      on = character.hitBy(this.raycaster.ray.origin, this.raycaster.ray.direction)
    }
    const stand = this.characterStand
    const cell = this.hit?.surface
    if (!on && cell && stand && !character.walking) on = cell.x === stand.x && cell.z === stand.z
    character.selected = on
    this.publishCharacter()
  }

  /**
   * Right click: send the selected character to the surface under the
   * cursor, along the shortest walkable path. Nothing happens when nothing
   * is selected or the spot cannot be reached.
   */
  command(): void {
    const character = this.character
    const hit = this.hit
    if (!character?.selected || !hit || !this.characterStand) return
    const area = this.walking()
    const target = area.nearestStand(hit.surface.x, hit.surface.y, hit.surface.z)
    if (!target) return
    // A walking character turns back from the cell it is heading to.
    const next = character.nextPoint
    const from = next ? standAt(next) : this.characterStand
    const path = area.findPath(from, target)
    if (!path) return
    const points = path.map((s, i) => {
      // Onto, off or between stepping stones: hop.
      const before = i > 0 ? path[i - 1] : this.characterStand
      return { ...walkPoint(s), hop: this.hopsOn(s) || (!!before && this.hopsOn(before)) }
    })
    // When standing, the first stand is where the character already is.
    character.walk(next ? points : points.slice(1))
    this.characterStand = target
    this.publishCharacter()
  }

  /** Publish the character's state to the HUD. */
  private publishCharacter(): void {
    const c = this.character
    const stand = this.characterStand
    const character = c && stand ? { stand, selected: c.selected, walking: c.walking } : null
    this.publish({ ...this.hud, character })
  }

  /** Whether stand `s` belongs to a structure one hops on (see `StructureKind.hops`). */
  private hopsOn(s: Stand): boolean {
    const owner = this.options.structures?.ownerOf(s.x, s.y, s.z)
    return owner ? this.structureKinds.get(owner.kind).hops === true : false
  }

  /**
   * Walking height of a structure under (x, z) near height `nearY` (world
   * units): its `surfaceAt`, else the top of its owned voxel. Decks are
   * drawn as separate planks, slabs or stones: a ray could slip between
   * them. Undefined when no built structure is walked there (terrain
   * voxels a structure owns, like a ford's bed, are drawn as terrain).
   */
  private structureSurface(x: number, z: number, nearY: number): number | undefined {
    const structures = this.options.structures
    if (!structures) return undefined
    const cx = Math.floor(x)
    const cz = Math.floor(z)
    const level = Math.round(nearY / VOXEL_HEIGHT) - 1
    for (const y of [level, level - 1, level + 1]) {
      const owner = structures.ownerOf(cx, y, cz)
      const voxel = this.options.map.get(cx, y, cz)
      // A bank under a deck's end: the ground is drawn lower, under the
      // planks; one walks on the deck, flush with the voxel's top.
      if (
        !owner &&
        isTerrainMaterial(materialOf(voxel)) &&
        isAir(this.options.map.get(cx, y + 1, cz)) &&
        structures.within(cx, y + 1, cz)
      ) {
        return (y + 1) * VOXEL_HEIGHT
      }
      if (!owner || isTerrainMaterial(materialOf(voxel))) continue
      if (structures.ownerOf(cx, y + 1, cz)) continue // not the top
      const kind = this.structureKinds.get(owner.kind)
      if (kind.hops) return undefined // stones: the ray finds each stone's top
      const corners = voxelTopCorners(voxel)
      return (
        kind.surfaceAt?.(owner, x, z) ?? (y + topHeightAt(corners, x - cx, z - cz)) * VOXEL_HEIGHT
      )
    }
    return undefined
  }

  /** The walk area, built on first use. */
  private walking(): WalkArea {
    this.walkArea ??= new WalkArea(this.options.map)
    return this.walkArea
  }

  /**
   * Drawn ground under (x, z) near height `nearY` (world units): a short
   * downward ray on the chunk meshes, water left out (one wades to the
   * bed). Null when nothing is found.
   */
  private groundAt(x: number, z: number, nearY: number): { y: number; normal: Vector3 } | null {
    const deck = this.structureSurface(x, z, nearY)
    if (deck !== undefined) return { y: deck, normal: UP }
    this.groundRay.set(GROUND_ORIGIN.set(x, nearY + GROUND_REACH, z), DOWN)
    this.groundRay.far = 2 * GROUND_REACH
    const meshes = this.chunks.pickables.filter((m: Mesh) => m.userData.layer !== 'water')
    const hit = this.groundRay
      .intersectObjects(meshes, false)
      .find((h) => (h.face?.normal.y ?? 0) > 0)
    if (!hit?.face) return null
    return { y: hit.point.y, normal: hit.face.normal }
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
    this.character?.dispose()
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
    const character = this.character
    if (character) {
      const walking = character.walking
      character.update(Math.min(dt, MAX_FRAME_DT), (x, z, nearY) => this.groundAt(x, z, nearY))
      if (walking !== character.walking) this.publishCharacter()
    }
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
    // Edited voxels may change where characters stand.
    this.walkArea?.invalidate()
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
    // Shallow water (a ford): the cursor goes to the bed, where one walks.
    if (resolved) resolved = wadeThrough(this.options.map, resolved)
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
    const { x, y, z } = hit.surface
    const corners = voxelTopCorners(hit.surfaceValue)
    const voxelTop: SurfaceSampler = (fx, fz) => (y + topHeightAt(corners, fx, fz)) * VOXEL_HEIGHT
    // A structure's walking surface may differ from its voxels (a sagging
    // rope deck): its kind gives the drawn height.
    const owner = this.options.structures?.ownerOf(x, y, z)
    const kind = owner ? this.structureKinds.get(owner.kind) : undefined
    if (!owner || !kind?.surfaceAt) return voxelTop
    const surfaceAt = kind.surfaceAt.bind(kind)
    return (fx, fz) => surfaceAt(owner, x + fx, z + fz) ?? voxelTop(fx, fz)
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
    // Ground inside a structure's footprint (a bank under a bridge's end,
    // at the deck's walking level): the drawn ground there is smoothed
    // lower, under the deck; the flat patch at the voxel top lies on the
    // deck instead.
    if (this.options.structures?.within(x, y + 1, z)) return null
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.resolutionScale)
    renderer.setSize(width, height, false)
    this.rig.setAspect(width / height)
  }
}

/** Straight down. */
const DOWN = new Vector3(0, -1, 0)
/** Straight up (normal of a flat deck). */
const UP = new Vector3(0, 1, 0)
/** Scratch origin of the ground ray. */
const GROUND_ORIGIN = new Vector3()

/** Walk point of a stand: centre of its cell, at feet height. */
function walkPoint(s: Stand): WalkPoint {
  return { x: s.x + 0.5, y: (s.y + 1) * VOXEL_HEIGHT, z: s.z + 0.5 }
}

/** Stand of a walk point (inverse of {@link walkPoint}). */
function standAt(p: WalkPoint): Stand {
  return { x: Math.floor(p.x), y: Math.round(p.y / VOXEL_HEIGHT) - 1, z: Math.floor(p.z) }
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
