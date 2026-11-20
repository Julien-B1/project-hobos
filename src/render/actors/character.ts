/**
 * Animated character: a skinned glTF model that idles, walks along a path
 * of cells and follows the ground under its feet.
 *
 * Layer: render. The model's materials are replaced by node materials that
 * end with the scene's output encoding: toon shading with an ink outline (`toonMaterial.ts`). It casts
 * and receives sun shadows (the engine redraws the shadow map every frame
 * while a character is on the map). A ring at the feet shows the selection,
 * draped on the ground around them. The cut never slices the character: it
 * is hidden whole when the ground it stands on is cut away
 * ({@link CutSupported}).
 *
 * Model conventions (Mixamo rig, see `tooling/compress_glb.py`): Y up,
 * facing +Z, feet at the origin, about 1 unit tall, walk clip in place.
 */
import { uniform } from 'three/tsl'
import {
  AnimationMixer,
  DoubleSide,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicNodeMaterial,
  RingGeometry,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Object3D,
  type Texture,
} from 'three/webgpu'
import { encodeOutput } from '../outputEncoding'
import type { CutSupported } from './cutSupported'
import { FootIk } from './footIk'
import { ArmPose, NEUTRAL_ARMS, type ArmStyle } from './armPose'
import type { ClipRules } from './animationLibrary'
import { ArcaneWisps } from './arcaneWisps'
import { GRIP_SOCKET, WEAPON_SHAPES, Weapon, type WeaponKind } from './weapon'
import { SPRING_PREFIX, SpringBones } from './springBones'
import { createOutlineMaterial, createToonMaterial } from './toonMaterial'

/** Character height, in world units (a cell is 1 unit wide). */
export const CHARACTER_HEIGHT = 1.6

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

/** Running speed: walking speed times this. */
const RUN_FACTOR = 2

/** Running speed, in world units per second. */
export const RUN_SPEED = WALK_SPEED * RUN_FACTOR

/**
 * Ground speed of the run clip at playback speed 1, in model units per
 * second (measured on the wizard's run clip, as for the walk).
 */
const RUN_CLIP_STRIDE_SPEED = 1.58

/** How fast the arm style comes and goes around action clips (1/s). */
const ARMS_FADE_RATE = 8

/** How fast the incantation effects come and go (1/s). */
const CAST_FADE_RATE = 4

/** Paths of more cells than this are run, shorter ones walked. */
export const RUN_FROM_CELLS = 2

/** How the character moves: standing, walking or running. */
export type Gait = 'idle' | 'walk' | 'run'

/** Gait for a path of `cells` moves (0: standing). */
export function gaitFor(cells: number): Gait {
  if (cells <= 0) return 'idle'
  return cells > RUN_FROM_CELLS ? 'run' : 'walk'
}

/** Turning speed, in radians per second. */
const TURN_SPEED = 10

/** Cross-fade between idle and walk, in seconds. */
const FADE = 0.25

/** Ground probes around the ring when it is draped. */
const RING_SAMPLES = 16

/** Lift of the ring over the ground, in world units. */
const DECAL_LIFT = 0.04

/** Radius of the selection ring (and of the body, for picking), in world units. */
const RING_RADIUS = 0.45

/** Names of the clips in the model (Tripo export), and how it holds its arms. */
export interface CharacterClips {
  readonly idle: string
  readonly walk: string
  /** Run clip; without one, the walk clip is played faster. */
  readonly run?: string
  /** Arm spacing and swing on top of the clips (default: as the clips are). */
  readonly arms?: ArmStyle
}

/** What a character is built from, besides its model. */
export interface CharacterParts {
  /** Clips of the animation library, adapted to the model's size. */
  readonly clips: readonly AnimationClip[]
  /** Which clips are idle, walk and run, and the arm style. */
  readonly names: CharacterClips
  /** Rules of the library clips. */
  readonly rules: ClipRules
  /** Weapon sockets added to the model's skeleton, by name. */
  readonly sockets: ReadonlyMap<string, Object3D>
  /** Its weapon, if any: model (glTF scene) and kind. */
  readonly weapon?: { readonly model: Object3D; readonly kind: WeaponKind }
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
export class Character implements CutSupported {
  /** Scene object: feet at its origin. */
  readonly root = new Group()
  private readonly model: Object3D
  private readonly mixer: AnimationMixer
  private readonly idle: AnimationAction
  /** All clips of the character (baked from the animation library). */
  private readonly clips: readonly AnimationClip[]
  /** Action playing now (the target of the last cross-fade). */
  private current: AnimationAction
  /** Standing clip: idle, or the combat guard after a sword move. */
  private standing: AnimationAction
  /** Glow and wisps at the staff's head during an incantation. */
  private readonly wisps = new ArcaneWisps()
  /** Incantation strength, 0 to 1 (smoothed during a clip's `cast` period). */
  private casting = 0
  private readonly rules: ClipRules
  /** The character's weapon, in its sheath or in hand. */
  private readonly weapon: Weapon | null
  /** Putting the weapon back (the draw clip played backwards). */
  private sheathing = false
  /** Share of the arm style applied, 0 to 1 (none during action clips). */
  private armsWeight = 1
  /** Clips to play next, each when the current one-shot clip ends. */
  private queue: string[] = []
  private readonly walkAction: AnimationAction
  /** Run clip's action (the walk's own action when the model has no run clip). */
  private readonly runAction: AnimationAction
  /** Clip playback speed while running. */
  private readonly runTimeScale: number
  private gait: Gait = 'idle'
  private readonly ring: Mesh
  /** Ring vertices on the ground plane (x, z pairs), around the origin. */
  private readonly ringBase: Float32Array
  /** Whether the ring has been laid at least once. */
  private placed = false
  /** Ring opacity: pulses while selected. */
  private readonly ringOpacity = uniform(0)
  private readonly materials: Material[] = []
  /** Plants the feet on uneven ground. */
  private readonly feet: FootIk
  /** Arm spacing and follow-through on top of the clips. */
  private readonly arms: ArmPose
  /** Cloth and hair chains (none on models without spring bones). */
  private readonly springs: SpringBones
  /** Remaining walk, next point first. */
  private path: WalkPoint[] = []
  /** Feet height the walk expects (between path points), world units. */
  private expectedY = 0
  private yaw = 0
  private time = 0
  private selectedFlag = false
  private shownFlag = true
  /** Hop in progress: start point and heights of both ends (world units). */
  private hop: { x: number; z: number; fromY: number; toY: number } | null = null

  /**
   * @param scene The model (glTF scene), used as it is (not cloned).
   * @param parts Clips, rules, sockets and weapon.
   */
  constructor(scene: Object3D, parts: CharacterParts) {
    const { clips, names } = parts
    this.rules = parts.rules
    this.root.name = 'character'
    this.model = scene
    this.model.scale.setScalar(CHARACTER_HEIGHT / MODEL_HEIGHT)
    this.prepareMaterials(this.model)
    this.root.add(this.model)
    const sheath = parts.weapon && parts.sockets.get(WEAPON_SHAPES[parts.weapon.kind].sheath)
    const hand = parts.sockets.get(GRIP_SOCKET)
    if (parts.weapon && sheath && hand) {
      this.prepareMaterials(parts.weapon.model)
      this.weapon = new Weapon(parts.weapon.model, parts.weapon.kind, sheath, hand)
    } else {
      this.weapon = null
    }

    // Spring bones read their rest pose: before any clip runs.
    this.springs = new SpringBones(this.model)
    this.mixer = new AnimationMixer(this.model)
    const clip = (name: string): AnimationClip => {
      const found = clips.find((c) => c.name === name)
      if (!found) throw new Error(`Character clip "${name}" not found`)
      // The clips hold spring bones at rest: the simulation drives them.
      found.tracks = found.tracks.filter((t) => !t.name.startsWith(SPRING_PREFIX))
      return found
    }
    this.idle = this.mixer.clipAction(clip(names.idle))
    this.walkAction = this.mixer.clipAction(clip(names.walk))
    this.walkAction.timeScale = WALK_TIME_SCALE
    const scale = CHARACTER_HEIGHT / MODEL_HEIGHT
    if (names.run) {
      this.runAction = this.mixer.clipAction(clip(names.run))
      this.runTimeScale = RUN_SPEED / (RUN_CLIP_STRIDE_SPEED * scale)
    } else {
      this.runAction = this.walkAction
      this.runTimeScale = WALK_TIME_SCALE * RUN_FACTOR
    }
    for (const action of [this.idle, this.walkAction, this.runAction])
      action.setLoop(LoopRepeat, Infinity)
    this.idle.play()
    this.current = this.idle
    this.standing = this.idle
    this.clips = clips
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.current) return
      if (this.sheathing) {
        // The weapon is back in its sheath: at ease.
        this.sheathing = false
        this.standing = this.idle
        this.fadeTo(this.idle)
        return
      }
      const rule = this.rules[e.action.getClip().name]
      const next = this.queue.shift() ?? rule?.then
      if (next) this.start(next)
      else if (!rule?.hold) this.fadeTo(this.standing)
    })
    this.arms = new ArmPose(this.model, names.arms ?? NEUTRAL_ARMS)
    this.feet = new FootIk(this.model, this.model)
    // Stance: the idle clip's first frame.
    this.mixer.update(0)
    this.feet.captureStance()

    this.ring = decal(new RingGeometry(RING_RADIUS * 0.82, RING_RADIUS, 48), this.ringMaterial())
    this.ring.name = 'character-ring'
    // The ring is draped in world space (see drapeRing): keep its flat shape.
    const flat = this.ring.geometry.getAttribute('position')
    this.ringBase = new Float32Array(flat.count * 2)
    for (let v = 0; v < flat.count; v++) {
      this.ringBase[v * 2] = flat.getX(v)
      this.ringBase[v * 2 + 1] = flat.getZ(v)
    }
    this.ring.visible = false
  }

  /**
   * World-space objects to add to the scene next to {@link root}: the
   * selection ring on the ground and the incantation effect.
   */
  get decals(): readonly Object3D[] {
    return [this.ring, this.wisps.object, ...(this.weapon ? [this.weapon.object] : [])]
  }

  /** Whether the character is selected (ring shown). */
  get selected(): boolean {
    return this.selectedFlag
  }

  /** Select (show the ring) or deselect the character. */
  set selected(on: boolean) {
    this.selectedFlag = on
    this.ring.visible = on && this.shownFlag
    // Laid on the ground on the next update.
    if (on) this.placed = false
  }

  /** Height of the ground under the feet (mid-hop: between both ends), world units. */
  get supportHeight(): number {
    const hop = this.hop
    if (!hop) return this.root.position.y
    const target = this.path[0]
    const total = target ? Math.hypot(target.x - hop.x, target.z - hop.z) : 0
    const p = this.root.position
    const t = total > 1e-6 ? Math.min(1, Math.hypot(p.x - hop.x, p.z - hop.z) / total) : 1
    return hop.fromY + (hop.toY - hop.fromY) * t
  }

  /** Whether the character is drawn and pickable (false: hidden by the cut). */
  get shown(): boolean {
    return this.shownFlag
  }

  /** Show or hide the character whole, ring included. */
  set shown(on: boolean) {
    this.shownFlag = on
    this.root.visible = on
    if (this.weapon) this.weapon.object.visible = on
    this.ring.visible = on && this.selectedFlag
    // The ring may be stale after a hidden walk: lay it again.
    if (on) this.placed = false
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
    this.setGait('idle')
    this.springs.reset()
    this.arms.reset()
  }

  /**
   * Walk through `points` (the first one is the next to reach): walked up
   * to {@link RUN_FROM_CELLS} cells, run beyond.
   */
  walk(points: readonly WalkPoint[]): void {
    this.path = [...points]
    // A hop in progress goes on: the new path starts where it was heading.
    this.setGait(gaitFor(this.path.length))
  }

  /**
   * Whether the ray (origin, unit direction) passes through the
   * character's body (a vertical cylinder around the feet).
   */
  hitBy(origin: Vector3, direction: Vector3): boolean {
    if (!this.shownFlag) return false
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
    if (moved || !this.placed) {
      const p = this.root.position
      const hit = ground(p.x, p.z, this.expectedY)
      // Mid-hop the feet follow the arc (set by advance), not the ground.
      if (hit && !this.hop) p.y = hit.y
      if (this.ring.visible) this.drapeRing(ground)
      this.placed = true
    }
    this.root.updateMatrixWorld(true)
    // What the clip being played allows: the arm style is for standing and
    // moving about, not for action clips; lying bodies keep their feet.
    const clip = this.current.getClip()
    const rule = this.rules[clip.name]
    const time = this.current.time
    const relaxed =
      this.current === this.idle ||
      this.current === this.walkAction ||
      this.current === this.runAction
    this.armsWeight += ((relaxed ? 1 : 0) - this.armsWeight) * Math.min(1, dt * ARMS_FADE_RATE)
    this.arms.update(dt, this.armsWeight)
    // The stance lock only holds the idle clip's foot shuffles still; action
    // clips (combat guard, steps) place the feet themselves.
    this.feet.update(
      dt,
      this.root.position.y,
      ground,
      !this.hop && rule?.foot_ik !== false,
      !this.walking && this.current === this.idle,
    )
    const cast = rule?.cast
    const casting = cast && time >= (cast[0] ?? 0) && time <= (cast[1] ?? 0) ? 1 : 0
    this.casting += (casting - this.casting) * Math.min(1, dt * CAST_FADE_RATE)
    this.springs.setLift(this.casting)
    this.springs.update(dt)
    this.weapon?.update(dt, rule, time)
    this.updateWisps(dt)
    return moved
  }

  /**
   * Lay the ring on the ground around the feet: heights probed at
   * {@link RING_SAMPLES} points around it, interpolated between them, so it
   * follows a slope and a step between two surfaces alike.
   */
  private drapeRing(ground: GroundProbe): void {
    const p = this.root.position
    const heights: number[] = []
    for (let k = 0; k < RING_SAMPLES; k++) {
      const a = (k / RING_SAMPLES) * 2 * Math.PI
      const r = RING_RADIUS * 0.91
      heights.push(ground(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.y)?.y ?? p.y)
    }
    const position = this.ring.geometry.getAttribute('position')
    const base = this.ringBase
    for (let v = 0; v < position.count; v++) {
      const x = base[v * 2] ?? 0
      const z = base[v * 2 + 1] ?? 0
      let t = ((Math.atan2(z, x) / (2 * Math.PI)) * RING_SAMPLES + RING_SAMPLES) % RING_SAMPLES
      const k = Math.floor(t)
      t -= k
      const h0 = heights[k] ?? p.y
      const h1 = heights[(k + 1) % RING_SAMPLES] ?? p.y
      position.setXYZ(v, p.x + x, h0 + (h1 - h0) * t + DECAL_LIFT, p.z + z)
    }
    position.needsUpdate = true
    this.ring.geometry.computeBoundingSphere()
  }

  /** Place the incantation effect on the weapon's head. */
  private updateWisps(dt: number): void {
    const weapon = this.weapon
    if (!weapon || this.casting < 0.01 || !this.shownFlag) {
      this.wisps.object.visible = false
      return
    }
    this.wisps.update(dt, weapon.glowPoint(new Vector3()), this.casting)
  }

  /** Release geometries and materials (textures included). */
  dispose(): void {
    this.mixer.stopAllAction()
    this.ring.geometry.dispose()
    this.wisps.dispose()
    for (const m of this.materials) m.dispose()
    for (const root of [this.model, this.weapon?.object]) {
      root?.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose()
      })
    }
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
    let step = (this.gait === 'run' ? RUN_SPEED : WALK_SPEED) * dt
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
      if (this.path.length === 0) this.setGait('idle')
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

  /**
   * Play a clip by name while standing (action menu), cross-faded from the
   * current pose, following the clip's rule (see `ClipRule`):
   * - a clip of the character's weapon asked for with the weapon sheathed
   *   plays the draw first;
   * - a looping clip becomes the standing clip; another one plays once,
   *   then goes on with its follow-up, or back to the standing clip, or
   *   holds its last frame (a defeat);
   * - the idle clip's name puts the weapon back first when it is in hand
   *   (the draw played backwards).
   * Returns false when the clip is unknown or the character is walking.
   */
  play(name: string): boolean {
    if (this.walking || !this.clips.some((c) => c.name === name)) return false
    this.queue = []
    if (name === this.idle.getClip().name) return this.rest()
    const rule = this.rules[name]
    const weapon = this.weapon
    if (weapon && rule?.weapon === weapon.kind && !rule.draw && !weapon.inHand) {
      this.queue.push(name)
      return this.start(`${weapon.kind}_draw`)
    }
    return this.start(name)
  }

  /**
   * Freeze the character on a clip at a time (seconds): a pose to look at
   * (debug, screenshots). Returns false when the clip is unknown.
   */
  freeze(name: string, time: number): boolean {
    const rule = this.rules[name]
    if (this.weapon && rule?.weapon === this.weapon.kind) {
      this.weapon.place(rule.draw && time < (rule.grab ?? 0) ? 'sheath' : 'hand')
    }
    if (!this.start(name)) return false
    this.current.paused = true
    this.current.time = Math.min(time, this.current.getClip().duration)
    return true
  }

  /** Back to the idle clip, the weapon put back in its sheath first. */
  private rest(): boolean {
    const weapon = this.weapon
    const draw = weapon?.inHand
      ? this.clips.find((c) => c.name === `${weapon.kind}_draw`)
      : undefined
    if (!draw) {
      this.standing = this.idle
      this.fadeTo(this.idle)
      return true
    }
    // The draw clip, backwards from its end.
    const action = this.mixer.clipAction(draw)
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    this.sheathing = true
    this.fadeTo(action, draw.duration, -1)
    return true
  }

  /** Cross-fade to a clip now (see {@link play}). */
  private start(name: string): boolean {
    const clip = this.clips.find((c) => c.name === name)
    if (!clip) return false
    this.sheathing = false
    const action = this.mixer.clipAction(clip)
    if (action === this.idle) {
      this.standing = action
    } else if (this.rules[name]?.loop) {
      action.setLoop(LoopRepeat, Infinity)
      this.standing = action
    } else {
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.fadeTo(action)
    return true
  }

  /**
   * Cross-fade from the current action to `to`, started at `time` seconds
   * and played at `speed` (-1: backwards).
   */
  private fadeTo(to: AnimationAction, time = 0, speed = 1): void {
    if (to === this.current) {
      // The same clip again (a second slash): from its start, nothing to fade.
      if (to.loop === LoopOnce) to.reset().play()
      to.time = time
      to.timeScale = speed
      return
    }
    to.reset().play()
    to.time = time
    to.timeScale = speed
    this.current.crossFadeTo(to, FADE, false)
    this.current = to
  }

  /** Cross-fade to the clip of `gait` (a run keeps running to the end of its path). */
  private setGait(gait: Gait): void {
    if (gait === this.gait) return
    this.gait = gait
    // Walking drops queued clips; a weapon in hand stays there, so the
    // guard comes back when the character stops.
    if (gait !== 'idle') {
      this.queue = []
      this.sheathing = false
      if (!this.weapon?.inHand) this.standing = this.idle
    }
    const to = gait === 'idle' ? this.standing : gait === 'run' ? this.runAction : this.walkAction
    const speed = gait === 'idle' ? 1 : gait === 'run' ? this.runTimeScale : WALK_TIME_SCALE
    if (to === this.current) {
      // Same action (no run clip): only the playback speed changes.
      to.timeScale = speed
      return
    }
    this.fadeTo(to, 0, speed)
  }

  /**
   * Replace a model's materials (the character, its weapon): same texture,
   * toon shading with the scene's output encoding, never cut; add an ink
   * outline (inverted hull) per mesh. Meshes cast and receive sun shadows.
   */
  private prepareMaterials(root: Object3D): void {
    const meshes: Mesh[] = []
    root.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o)
    })
    for (const mesh of meshes) {
      const source = mesh.material as Material & { map?: Texture | null }
      const map = source.map ?? null
      const material = createToonMaterial(map, source.side)
      const outline = createOutlineMaterial(map)
      this.materials.push(outline)
      source.dispose()
      mesh.material = material
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.materials.push(material)
      if (mesh instanceof SkinnedMesh) {
        const hull = new SkinnedMesh(mesh.geometry, outline)
        hull.name = `${mesh.name} outline`
        hull.bind(mesh.skeleton, mesh.bindMatrix)
        hull.bindMode = mesh.bindMode
        hull.position.copy(mesh.position)
        hull.quaternion.copy(mesh.quaternion)
        hull.scale.copy(mesh.scale)
        hull.castShadow = false
        hull.receiveShadow = false
        hull.raycast = () => undefined
        mesh.parent?.add(hull)
      } else {
        // A rigid model (a weapon): the same hull, not skinned.
        const hull = new Mesh(mesh.geometry, outline)
        hull.name = `${mesh.name} outline`
        hull.position.copy(mesh.position)
        hull.quaternion.copy(mesh.quaternion)
        hull.scale.copy(mesh.scale)
        hull.frustumCulled = false
        hull.raycast = () => undefined
        mesh.parent?.add(hull)
      }
    }
  }

  /** Material of the selection ring: bright, pulsing, drawn over the ground. */
  private ringMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({
      color: 0x5ad2ff,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    material.opacityNode = this.ringOpacity
    this.materials.push(material)
    return encodeOutput(material)
  }
}

/** World up. */
const UP = new Vector3(0, 1, 0)

/** A flat mesh laid on the ground (built in the XZ plane, facing up). */
function decal(geometry: RingGeometry, material: Material): Mesh {
  geometry.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geometry, material)
  mesh.renderOrder = 1
  mesh.raycast = () => undefined
  return mesh
}
