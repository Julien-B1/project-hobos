<script setup lang="ts">
/**
 * Debug overlay: renderer backend, frame rate, chunks, hovered voxel and surface.
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
      <div>Chunks: {{ state.chunkMeshes }} meshes</div>
      <div v-if="state.lastRebuild">
        Rebuild #{{ state.lastRebuild.seq }}: {{ state.lastRebuild.keys.length }} chunk(s) in
        {{ state.lastRebuild.ms.toFixed(1) }} ms
        <span v-if="state.lastRebuild.keys.length <= 8" class="keys">
          [{{ state.lastRebuild.keys.join(' | ') }}]
        </span>
      </div>
      <template v-if="state.hover">
        <div>
          Voxel: ({{ state.hover.voxel.x }}, {{ state.hover.voxel.y }}, {{ state.hover.voxel.z }})
          {{ state.hover.material }} {{ state.hover.shape }}, {{ state.hover.facing }} face
        </div>
        <div>
          Surface: column ({{ state.hover.surface.x }}, {{ state.hover.surface.z }}), voxel y
          {{ state.hover.surface.y }} → level {{ state.hover.surface.y + 1 }} ({{
            state.hover.surfaceShape
          }})
        </div>
      </template>
      <div v-else>Voxel: —</div>
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

.keys {
  opacity: 0.7;
}
</style>
