/**
 * Animated character: a skinned glTF model that idles, walks along a path
 * of cells and follows the ground under its feet.
 *
 * Layer: render. The model's materials are replaced by node materials that
 * end with the scene's output encoding and honour the cut height, like the
 * terrain. The character casts no shadow map shadow (it moves every frame,
 * and the shadow map is only redrawn when the scene changes): a soft blob
 * under the feet stands in for it. A ring at the feet shows the selection.
 *
 * Model conventions (Mixamo rig, see `tooling/compress_glb.py`): Y up,
 * facing +Z, feet at the origin, about 1 unit tall, walk clip in place.
 */
import { float, length, positionWorld, smoothstep, uniform, uv, vec2 } from 'three/tsl'
import {
  AnimationMixer,
  CircleGeometry,
  DoubleSide,
  Group,
  LoopRepeat,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  RingGeometry,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Object3D,
  type Texture,
  type UniformNode,
} from 'three/webgpu'
import { encodeOutput } from '../outputEncoding'

/** Character height, in world units (a cell is 1 unit wide). */
export const CHARACTER_HEIGHT = 1.35

/** Height of the source model, in model units (top of the head). */
const MODEL_HEIGHT = 1

/**
 * Ground speed of the walk clip at playback speed 1, in model units per
 * second: how fast a foot slides back while planted (measured on the clip).
 */
const CLIP_STRIDE_SPEED = 0.62

/** Walk clip playback speed: the walk is brisker than the clip. */
const WALK_TIME_SCALE = 1.5

/** Walking speed, in world units per second, matching the feet. */
export const WALK_SPEED = CLIP_STRIDE_SPEED * (CHARACTER_HEIGHT / MODEL_HEIGHT) * WALK_TIME_SCALE

/** Turning speed, in radians per second. */
const TURN_SPEED = 10

/** Cross-fade between idle and walk, in seconds. */
const FADE = 0.25

/** Lift of the ring and the blob over the ground, in world units. */
const DECAL_LIFT = 0.04

/** Radius of the selection ring and of the blob shadow, in world units. */
const RING_RADIUS = 0.45
const BLOB_RADIUS = 0.42

/** Names of the clips in the model (Tripo export). */
export interface CharacterClips {
  readonly idle: string
  readonly walk: string
}

/** A point of a walk: cell centre (world x, z) and feet height (world y). */
export interface WalkPoint {
  readonly x: number
  readonly y: number
  readonly z: number
  /** Reach this point with a hop (stepping stones) instead of walking the ground. */
  readonly hop?: boolean
}

/** Height of a hop's arc above the straight line, in world units. */
const HOP_HEIGHT = 0.3

/** Ground under a point: world height and unit normal, or null when none. */
export type GroundProbe = (
  x: number,
  z: number,
  nearY: number,
) => { y: number; normal: Vector3 } | null

/** One character in the scene. Add {@link Character.root} to the scene. */
export class Character {
  /** Scene object: feet at its origin. */
  readonly root = new Group()
  private readonly model: Object3D
  private readonly mixer: AnimationMixer
  private readonly idle: AnimationAction
  private readonly walkAction: AnimationAction
  private readonly ring: Mesh
  private readonly blob: Mesh
  /** Ring opacity: pulses while selected. */
  private readonly ringOpacity = uniform(0)
  private readonly materials: Material[] = []
  /** Remaining walk, next point first. */
  private path: WalkPoint[] = []
  /** Feet height the walk expects (between path points), world units. */
  private expectedY = 0
  private yaw = 0
  private time = 0
  private selectedFlag = false
  /** Hop in progress: start point and heights of both ends (world units). */
  private hop: { x: number; z: number; fromY: number; toY: number } | null = null

  /**
   * @param scene The model (glTF scene), used as it is (not cloned).
   * @param clips Animations of the model.
   * @param names Which clips are idle and walk.
   * @param cutHeight Cut height uniform: nothing of the character shows above it.
   */
  constructor(
    scene: Object3D,
    clips: readonly AnimationClip[],
    names: CharacterClips,
    cutHeight: UniformNode<'float'>,
  ) {
    this.root.name = 'character'
    this.model = scene
    this.model.scale.setScalar(CHARACTER_HEIGHT / MODEL_HEIGHT)
    this.prepareMaterials(cutHeight)
    this.root.add(this.model)

    this.mixer = new AnimationMixer(this.model)
    const clip = (name: string): AnimationClip => {
      const found = clips.find((c) => c.name === name)
      if (!found) throw new Error(`Character clip "${name}" not found`)
      return found
    }
    this.idle = this.mixer.clipAction(clip(names.idle))
    this.walkAction = this.mixer.clipAction(clip(names.walk))
    this.walkAction.timeScale = WALK_TIME_SCALE
    for (const action of [this.idle, this.walkAction]) action.setLoop(LoopRepeat, Infinity)
    this.idle.play()

    const blob = blobMaterial(cutHeight)
    this.materials.push(blob)
    this.blob = decal(new CircleGeometry(BLOB_RADIUS, 24), blob)
    this.blob.name = 'character-blob'
    this.ring = decal(
      new RingGeometry(RING_RADIUS * 0.82, RING_RADIUS, 48),
      this.ringMaterial(cutHeight),
    )
    this.ring.name = 'character-ring'
    this.ring.visible = false
  }

  /** Decals that lie on the ground (add them to the scene next to {@link root}). */
  get decals(): readonly Mesh[] {
    return [this.blob, this.ring]
  }

  /** Whether the character is selected (ring shown). */
  get selected(): boolean {
    return this.selectedFlag
  }

  /** Select (show the ring) or deselect the character. */
  set selected(on: boolean) {
    this.selectedFlag = on
    this.ring.visible = on
  }

  /** Whether the character is walking. */
  get walking(): boolean {
    return this.path.length > 0
  }

  /** Next point of the walk, or null when standing. */
  get nextPoint(): WalkPoint | null {
    return this.path[0] ?? null
  }

  /** Put the character on a point, standing, facing +Z. */
  placeAt(p: WalkPoint): void {
    this.root.position.set(p.x, p.y, p.z)
    this.expectedY = p.y
    this.hop = null
    this.path = []
    this.setWalking(false)
  }

  /** Walk through `points` (the first one is the next to reach). */
  walk(points: readonly WalkPoint[]): void {
    this.path = [...points]
    // A hop in progress goes on: the new path starts where it was heading.
    this.setWalking(this.path.length > 0)
  }

  /**
   * Whether the ray (origin, unit direction) passes through the
   * character's body (a vertical cylinder around the feet).
   */
  hitBy(origin: Vector3, direction: Vector3): boolean {
    const p = this.root.position
    const radius = RING_RADIUS
    // Closest approach of the ray to the vertical axis, in the ground plane.
    const dx = origin.x - p.x
    const dz = origin.z - p.z
    const a = direction.x ** 2 + direction.z ** 2
    const t = a > 1e-9 ? -(dx * direction.x + dz * direction.z) / a : 0
    const cx = dx + direction.x * t
    const cz = dz + direction.z * t
    if (cx * cx + cz * cz > radius * radius) return false
    // The ray crosses the axis region within the body's height.
    const y = origin.y + direction.y * t
    return y >= p.y - 0.1 && y <= p.y + CHARACTER_HEIGHT
  }

  /**
   * Advance animation and walk by `dt` seconds; `ground` gives the height
   * under the feet. Returns whether the character moved.
   */
  update(dt: number, ground: GroundProbe): boolean {
    this.time += dt
    this.mixer.update(dt)
    this.ringOpacity.value = 0.65 + 0.25 * Math.sin(this.time * 4)
    const moved = this.advance(dt, ground)
    if (moved || !this.blob.userData.placed) {
      const p = this.root.position
      const hit = ground(p.x, p.z, this.expectedY)
      // Mid-hop the feet follow the arc (set by advance), not the ground.
      if (hit && !this.hop) p.y = hit.y
      const normal = hit?.normal ?? UP
      for (const d of [this.blob, this.ring]) {
        d.position.set(p.x, p.y, p.z).addScaledVector(normal, DECAL_LIFT)
        d.quaternion.setFromUnitVectors(UP, normal)
      }
      this.blob.userData.placed = true
    }
    return moved
  }

  /** Release geometries and materials (textures included). */
  dispose(): void {
    this.mixer.stopAllAction()
    this.blob.geometry.dispose()
    this.ring.geometry.dispose()
    for (const m of this.materials) m.dispose()
    this.model.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose()
    })
  }

  /** Move along the path; returns whether the position changed. */
  private advance(dt: number, ground: GroundProbe): boolean {
    const target = this.path[0]
    if (!target) return false
    const p = this.root.position
    if (target.hop && !this.hop) {
      const to = ground(target.x, target.z, target.y)
      this.hop = { x: p.x, z: p.z, fromY: p.y, toY: to?.y ?? target.y }
    }
    const dx = target.x - p.x
    const dz = target.z - p.z
    const distance = Math.hypot(dx, dz)
    let step = WALK_SPEED * dt
    if (distance > 1e-6) {
      this.turnTowards(Math.atan2(dx, dz), dt)
    }
    if (step >= distance) {
      p.x = target.x
      p.z = target.z
      this.expectedY = target.y
      if (this.hop) p.y = this.hop.toY
      this.hop = null
      this.path.shift()
      step -= distance
      if (this.path.length === 0) this.setWalking(false)
      return true
    }
    const k = step / distance
    p.x += dx * k
    p.z += dz * k
    this.expectedY += (target.y - this.expectedY) * Math.min(1, k)
    const hop = this.hop
    if (hop) {
      // Parabolic arc over the straight line between both ends.
      const total = Math.hypot(target.x - hop.x, target.z - hop.z)
      const t = total > 1e-6 ? 1 - Math.hypot(target.x - p.x, target.z - p.z) / total : 1
      p.y = hop.fromY + (hop.toY - hop.fromY) * t + 4 * HOP_HEIGHT * t * (1 - t)
    }
    return true
  }

  /** Turn the model towards `goal` (yaw, radians), at most {@link TURN_SPEED}. */
  private turnTowards(goal: number, dt: number): void {
    let delta = goal - this.yaw
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    const max = TURN_SPEED * dt
    this.yaw += Math.max(-max, Math.min(max, delta))
    this.model.quaternion.setFromAxisAngle(UP, this.yaw)
  }

  /** Cross-fade between the idle and the walk clips. */
  private setWalking(on: boolean): void {
    const [from, to] = on ? [this.idle, this.walkAction] : [this.walkAction, this.idle]
    if (to.isRunning() && to.getEffectiveWeight() > 0.99) return
    to.reset().play()
    from.crossFadeTo(to, FADE, false)
  }

  /**
   * Replace the model's materials: same texture, node materials with the
   * scene's output encoding, cut at the cut height. Meshes receive the sun's
   * shadow but cast none (see the module comment).
   */
  private prepareMaterials(cutHeight: UniformNode<'float'>): void {
    this.model.traverse((o) => {
      if (!(o instanceof Mesh)) return
      const source = o.material as Material & { map?: Texture | null }
      const material = new MeshStandardNodeMaterial({
        map: source.map ?? null,
        roughness: 0.85,
        metalness: 0,
        side: source.side,
      })
      material.maskNode = positionWorld.y.lessThan(cutHeight)
      encodeOutput(material)
      source.dispose()
      o.material = material
      o.castShadow = false
      o.receiveShadow = true
      this.materials.push(material)
    })
  }

  /** Material of the selection ring: bright, pulsing, drawn over the ground. */
  private ringMaterial(cutHeight: UniformNode<'float'>): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({
      color: 0x5ad2ff,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    material.opacityNode = this.ringOpacity
    material.maskNode = positionWorld.y.lessThan(cutHeight)
    this.materials.push(material)
    return encodeOutput(material)
  }
}

/** World up. */
const UP = new Vector3(0, 1, 0)

/** A flat mesh laid on the ground (built in the XZ plane, facing up). */
function decal(geometry: CircleGeometry | RingGeometry, material: Material): Mesh {
  geometry.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geometry, material)
  mesh.renderOrder = 1
  mesh.raycast = () => undefined
  return mesh
}

/** Soft dark disc under the feet, darker in the middle. */
function blobMaterial(cutHeight: UniformNode<'float'>): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    color: 0x000000,
    transparent: true,
    depthWrite: false,
  })
  const r = length(uv().sub(vec2(0.5, 0.5))).mul(2)
  material.opacityNode = smoothstep(float(1), float(0.25), r).mul(0.45)
  material.maskNode = positionWorld.y.lessThan(cutHeight)
  return encodeOutput(material)
}
