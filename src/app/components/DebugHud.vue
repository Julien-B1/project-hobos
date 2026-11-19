<script setup lang="ts">
/**
 * Debug overlay: session settings, renderer and cost figures (GPU time and
 * load, estimated VRAM, draw calls), camera pose, chunks, hovered voxel and
 * surface. Meant to make screenshots self-describing.
 *
 * Purely presentational: receives a HUD snapshot from the engine (through
 * App.vue) and renders it. Never reads engine objects directly.
 */
import type { SessionInfo } from '@/app/session'
import type { EngineHudState } from '@/render/engine'

defineProps<{
  /** Latest engine snapshot, or null before the engine has started. */
  state: EngineHudState | null
  /** Start-up settings, or null before the map is generated. */
  session: SessionInfo | null
}>()

/** Bytes to mebibytes, no decimals. */
function mb(bytes: number): string {
  return (bytes / 2 ** 20).toFixed(0)
}

/** Compact count: 1234 -> "1.2 k", 1234567 -> "1.23 M". */
function count(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`
  return String(n)
}
</script>

<template>
  <aside class="hud">
    <div v-if="session">
      Map: <strong>{{ session.map }}</strong> {{ session.width }}×{{ session.depth
      }}<template v-if="session.seed !== null">
        · seed <strong>{{ session.seed }}</strong></template
      >
      · {{ session.mesher
      }}<template v-if="state">
        · shadows {{ state.shadows }} · grid {{ state.grid ? 'on' : 'off' }} (G) ·
        {{ state.timeOfDay }} · cut {{ state.cutHeight?.toFixed(1) ?? 'off' }}</template
      ><template v-if="session.forceWebGL"> · forceWebGL</template>
    </div>
    <template v-if="state">
      <div>
        Backend: <strong>{{ state.backend }}</strong>
        <template v-if="state.render">
          · {{ state.render.width }}×{{ state.render.height }} px (ratio
          {{ state.render.pixelRatio }})
        </template>
      </div>
      <div>
        FPS: {{ state.fps }} · GPU:
        <template v-if="state.render?.gpuMs != null">
          <strong>{{ ((state.render.gpuLoad ?? 0) * 100).toFixed(0) }} %</strong>
          ({{ state.render.gpuMs.toFixed(2) }} ms/frame)
        </template>
        <template v-else>n/a (no GPU timer)</template>
      </div>
      <template v-if="state.render">
        <div>
          VRAM ≈ <strong>{{ mb(state.render.vram.total) }} MB</strong> (textures
          {{ mb(state.render.vram.textures) }}, buffers {{ mb(state.render.vram.buffers) }}, MSAA +
          canvas {{ mb(state.render.vram.framebuffer) }})
        </div>
        <div>
          Draw: {{ state.render.drawCalls }} calls · {{ count(state.render.triangles) }} tris ·
          shadow passes {{ state.render.shadowPasses }}
        </div>
      </template>
      <div>
        Camera: target ({{ state.camera.targetX.toFixed(1) }},
        {{ state.camera.targetZ.toFixed(1) }}) · distance {{ state.camera.distance.toFixed(1) }} ·
        yaw {{ state.camera.yawDeg.toFixed(0) }}°
      </div>
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
  /* Right of the cut slider. */
  left: 60px;
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
