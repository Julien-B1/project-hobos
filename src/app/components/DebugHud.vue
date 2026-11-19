<script setup lang="ts">
/**
 * Debug overlay: renderer backend, frame rate and hovered cell.
 *
 * Purely presentational: receives a HUD snapshot from the engine (through
 * App.vue) and renders it. Never reads engine objects directly.
 */
import type { EngineHudState } from '@/render/engine'

defineProps<{
  /** Latest engine snapshot, or null before the engine has started. */
  state: EngineHudState | null
}>()
</script>

<template>
  <aside class="hud">
    <template v-if="state">
      <div>
        Backend: <strong>{{ state.backend }}</strong>
      </div>
      <div>FPS: {{ state.fps }}</div>
      <div>Chunks: {{ state.chunkMeshes }}</div>
      <div>
        Cell:
        <template v-if="state.hoveredCell">
          x {{ state.hoveredCell.x }}, z {{ state.hoveredCell.z }}
        </template>
        <template v-else>—</template>
      </div>
    </template>
    <div v-else>Starting renderer…</div>
  </aside>
</template>

<style scoped>
.hud {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  font:
    13px/1.5 ui-monospace,
    monospace;
  pointer-events: none;
  user-select: none;
}
</style>
