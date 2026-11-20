<script setup lang="ts">
/**
 * Full-size canvas hosting the 3D engine.
 *
 * Creates the engine when mounted and disposes it when unmounted. The engine
 * instance is a plain (non-reactive) variable: Three.js objects must never be
 * wrapped in Vue proxies. Only the HUD snapshot is reactive. The time of
 * day and the cut height are props applied live.
 *
 * The map settings and grid visibility are read once, at mount: switching
 * the map remounts this component (App.vue changes its `key`), which
 * disposes the engine and input bindings and builds fresh ones on a new
 * canvas element. Regenerating in place would need an engine API to swap
 * the map; a remount reuses the existing create/dispose path instead.
 *
 * Start-up order, behind the loading screen (App.vue): let the screen
 * paint (map generation blocks the main thread), generate the map, create
 * the engine, frame the whole map as the farthest zoom, load the
 * character and centre the camera on it, draw a first frame, then emit
 * `ready`.
 */
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { TimeOfDay } from '@/render/timeOfDay'
import { Engine, type EngineHudState } from '@/render/engine'
import type { ClipRules } from '@/render/actors/animationLibrary'
import { config, readUrlFlags, type MapSettings } from '@/app/config'
import { bindInputs } from '@/app/input/bindings'
import { createDebugEdits } from '@/app/editing/debugEdits'
import { createTestMap } from '@/core/generators/catalog'
import type { SessionInfo } from '@/app/session'
import fighterUrl from '@/assets/models/fighter.glb?url'
import wizardUrl from '@/assets/models/wizard.glb?url'
import humanoidUrl from '@/assets/animations/humanoid.glb?url'
import clipRules from '@/assets/animations/humanoid.clips.json'
import swordUrl from '@/assets/models/sword.glb?url'
import staffUrl from '@/assets/models/staff.glb?url'

/**
 * Character models: file, clips of the shared animation library (idle:
 * looking around, walk, run) and arm
 * style (the wizard holds her arms clear of the skirt; both swing loosely).
 */
const CHARACTERS = {
  wizard: {
    url: wizardUrl,
    weapon: { url: staffUrl, kind: 'staff' },
    clips: {
      idle: 'look_around.001',
      walk: 'walk.001',
      run: 'run.001',
      arms: { abduction: 0.2, elbowFlex: 0.15, forwardFlex: 0.4, followThrough: 0.6, lag: 0.12 },
    },
  },
  fighter: {
    url: fighterUrl,
    weapon: { url: swordUrl, kind: 'sword' },
    clips: {
      idle: 'look_around.001',
      walk: 'walk.001',
      run: 'run.001',
      arms: { abduction: 0, elbowFlex: 0.1, forwardFlex: 0.3, followThrough: 0.5, lag: 0.1 },
    },
  },
} as const

const props = defineProps<{
  /** Lighting of the scene; changes are applied live. */
  timeOfDay: TimeOfDay
  /** World height above which nothing is drawn (null: no cut); applied live. */
  cutHeight: number | null
  /** Map to generate; read at mount only (remount to switch, see above). */
  mapSettings: MapSettings
  /** Show the battle-map grid at start-up; read at mount only (G toggles it later). */
  grid: boolean
}>()

const emit = defineEmits<{
  /** Fired whenever the engine publishes a new HUD snapshot. */
  hud: [state: EngineHudState]
  /** Fired once at mount with the settings this map runs with. */
  session: [info: SessionInfo]
  /** Fired once everything is loaded and drawn (or failed): hide the loading screen. */
  ready: []
}>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const error = ref<string | null>(null)

let engine: Engine | null = null
let unbindInputs: (() => void) | null = null
let unmounted = false

/** Whether the component was unmounted (read through a call: it changes across awaits). */
function isUnmounted(): boolean {
  return unmounted
}

/** Resolves after the browser has painted at least one frame. */
function painted(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

onMounted(async () => {
  // Generating the map blocks the main thread: show the loading screen first.
  await painted()
  if (!canvas.value || isUnmounted()) return
  const flags = readUrlFlags()
  const { map, seed, size, character } = props.mapSettings
  const world = createTestMap(map, {
    ...(seed === undefined ? {} : { seed }),
    ...(size === undefined ? {} : { size }),
  })
  emit('session', {
    map: world.id,
    seed: world.seed ?? null,
    width: world.width,
    depth: world.depth,
    mesher: flags.mesher,
    forceWebGL: flags.forceWebGL,
  })
  try {
    const created = await Engine.create(canvas.value, {
      forceWebGL: flags.forceWebGL,
      camera: config.camera,
      map: world.map,
      structures: world.structures,
      mesher: flags.mesher,
      shadows: flags.shadows,
      grid: props.grid,
      timeOfDay: props.timeOfDay,
      onHudChange: (state) => {
        // An engine disposed by a map switch must not overwrite the HUD of its successor.
        if (!unmounted) emit('hud', state)
      },
    })
    // The component may have been unmounted while the GPU was initialising.
    if (isUnmounted()) {
      created.dispose()
      return
    }
    engine = created
    engine.setCutHeight(props.cutHeight)
    const rig = engine.cameraRig
    // Keep the target over the map; the farthest zoom shows it whole.
    rig.setHome(world.home.x, world.home.y, world.home.z)
    rig.setTargetBounds({ minX: 0, maxX: world.width, minZ: 0, maxZ: world.depth })
    rig.setFitRadius(Math.hypot(world.width, world.depth) / 2)
    const engineRef = engine
    const edits = createDebugEdits(world.map, () => engineRef.hoveredHit)
    unbindInputs = bindInputs(canvas.value, engine, config.input, edits)
    engine.start()
    const feet = await engine
      .spawnCharacter(
        {
          ...CHARACTERS[character],
          libraryUrl: humanoidUrl,
          rules: clipRules satisfies ClipRules,
          ...(flags.pose ? { pose: flags.pose } : {}),
        },
        flags.spawn ?? world.home,
      )
      .catch((e: unknown) => {
        console.warn('Character failed to load:', e)
        return null
      })
    if (isUnmounted()) return
    // Start on the character (also the reset view, see Engine.resetView).
    if (feet) rig.setHome(feet.x, feet.y, feet.z)
    // Optional start-up view (`?cam=`), e.g. for reproducible screenshots.
    const view = flags.camera
    if (view) {
      rig.setTarget(view.x, world.home.y, view.z)
      if (view.distance !== undefined) rig.zoomBy(view.distance / rig.currentDistance)
      if (view.yawDeg !== undefined) rig.rotateBy(((view.yawDeg - rig.yawDeg) * Math.PI) / 180)
    }
    await engine.rendered()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  if (!isUnmounted()) emit('ready')
})

watch(
  () => props.timeOfDay,
  (time) => {
    engine?.setTimeOfDay(time)
  },
)

watch(
  () => props.cutHeight,
  (height) => {
    engine?.setCutHeight(height)
  },
)

defineExpose({
  /** Play a library clip on the character (action bar); false if not played. */
  playClip: (name: string): boolean => engine?.playClip(name) ?? false,
})

onBeforeUnmount(() => {
  unmounted = true
  unbindInputs?.()
  unbindInputs = null
  engine?.dispose()
  engine = null
})
</script>

<template>
  <canvas ref="canvas" class="game-canvas" />
  <p v-if="error" class="game-error">Renderer failed to start: {{ error }}</p>
</template>

<style scoped>
.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* The engine handles its own gestures (drag, wheel). */
  touch-action: none;
}

.game-error {
  position: absolute;
  inset: auto 0 0 0;
  margin: 0;
  padding: 12px 16px;
  background: #5a1e1e;
  color: #fff;
}
</style>
