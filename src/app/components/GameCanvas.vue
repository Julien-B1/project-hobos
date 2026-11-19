<script setup lang="ts">
/**
 * Full-size canvas hosting the 3D engine.
 *
 * Creates the engine when mounted and disposes it when unmounted. The engine
 * instance is a plain (non-reactive) variable: Three.js objects must never be
 * wrapped in Vue proxies. Only the HUD snapshot is reactive. The time of
 * day is a prop: changing it relights the running engine.
 */
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { TimeOfDay } from '@/render/timeOfDay'
import { Engine, type EngineHudState } from '@/render/engine'
import { config, readUrlFlags } from '@/app/config'
import { bindInputs } from '@/app/input/bindings'
import { createDebugEdits } from '@/app/editing/debugEdits'
import { createTestMap } from '@/core/generators/catalog'
import type { SessionInfo } from '@/app/session'

const props = defineProps<{
  /** Lighting of the scene; changes are applied live. */
  timeOfDay: TimeOfDay
  /** World height above which nothing is drawn (null: no cut); applied live. */
  cutHeight: number | null
}>()

const emit = defineEmits<{
  /** Fired whenever the engine publishes a new HUD snapshot. */
  hud: [state: EngineHudState]
  /** Fired once at start-up with the settings this session runs with. */
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
  const world = createTestMap(flags.map, {
    ...(flags.seed === undefined ? {} : { seed: flags.seed }),
    ...(flags.size === undefined ? {} : { size: flags.size }),
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
      mesher: flags.mesher,
      shadows: flags.shadows,
      grid: flags.grid,
      timeOfDay: props.timeOfDay,
      onHudChange: (state) => {
        emit('hud', state)
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
    const engineRef = engine
    const edits = createDebugEdits(world.map, () => engineRef.hoveredHit)
    unbindInputs = bindInputs(canvas.value, engine, config.input, edits)
    engine.start()
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
