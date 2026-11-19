<script setup lang="ts">
/**
 * Full-size canvas hosting the 3D engine.
 *
 * Creates the engine when mounted and disposes it when unmounted. The engine
 * instance is a plain (non-reactive) variable: Three.js objects must never be
 * wrapped in Vue proxies. Only the HUD snapshot is reactive.
 */
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { Engine, type EngineHudState } from '@/render/engine'
import { config, readUrlFlags } from '@/app/config'
import { bindInputs } from '@/app/input/bindings'

const emit = defineEmits<{
  /** Fired whenever the engine publishes a new HUD snapshot. */
  hud: [state: EngineHudState]
}>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const error = ref<string | null>(null)

let engine: Engine | null = null
let unbindInputs: (() => void) | null = null
let unmounted = false

onMounted(async () => {
  if (!canvas.value) return
  try {
    const created = await Engine.create(canvas.value, {
      forceWebGL: readUrlFlags().forceWebGL,
      camera: config.camera,
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
    // Look at the middle of the 32 x 32 test grid.
    engine.cameraRig.setTarget(16, 0, 16)
    unbindInputs = bindInputs(canvas.value, engine.cameraRig, config.input)
    engine.start()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
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
