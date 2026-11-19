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
 */
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { TimeOfDay } from '@/render/timeOfDay'
import { Engine, type EngineHudState } from '@/render/engine'
import { config, readUrlFlags, type MapSettings } from '@/app/config'
import { bindInputs } from '@/app/input/bindings'
import { createDebugEdits } from '@/app/editing/debugEdits'
import { createTestMap } from '@/core/generators/catalog'
import type { SessionInfo } from '@/app/session'
import fighterUrl from '@/assets/models/fighter.glb?url'

/** Clips of the fighter model: idle (looking around) and walk. */
const FIGHTER_CLIPS = { idle: 'look_around.001', walk: 'walk.001' } as const

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
}>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const error = ref<string | null>(null)

let engine: Engine | null = null
let unbindInputs: (() => void) | null = null
let unmounted = false

onMounted(async () => {
  if (!canvas.value) return
  const flags = readUrlFlags()
  const { map, seed, size } = props.mapSettings
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
    if (unmounted) {
      created.dispose()
      return
    }
    engine = created
    engine.setCutHeight(props.cutHeight)
    // Frame the map (also the reset view) and keep the target over it.
    engine.cameraRig.setHome(world.home.x, world.home.y, world.home.z)
    engine.cameraRig.setTargetBounds({ minX: 0, maxX: world.width, minZ: 0, maxZ: world.depth })
    // Optional start-up view (`?cam=`), e.g. for reproducible screenshots.
    const view = flags.camera
    if (view) {
      const rig = engine.cameraRig
      rig.setTarget(view.x, world.home.y, view.z)
      if (view.distance !== undefined) rig.zoomBy(view.distance / rig.currentDistance)
      if (view.yawDeg !== undefined) rig.rotateBy(((view.yawDeg - rig.yawDeg) * Math.PI) / 180)
    }
    const engineRef = engine
    const edits = createDebugEdits(world.map, () => engineRef.hoveredHit)
    unbindInputs = bindInputs(canvas.value, engine, config.input, edits)
    engine.start()
    // The character loads in the background: the map shows meanwhile.
    engine.spawnCharacter(fighterUrl, FIGHTER_CLIPS, world.home).catch((e: unknown) => {
      console.warn('Character failed to load:', e)
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
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
