<script setup lang="ts">
/**
 * Loading screen: covers the canvas while a map is generated, the engine
 * starts, the character loads and the first frame is drawn (at launch and
 * at each map or seed change). Fades out when App.vue says the canvas is
 * ready. Purely presentational.
 */
import type { MapSettings } from '@/app/config'

defineProps<{
  /** Map being loaded, named on the screen. */
  settings: MapSettings
}>()
</script>

<template>
  <div class="loading" role="status" aria-live="polite">
    <div class="card">
      <span class="spinner" aria-hidden="true" />
      <span>
        Loading <strong>{{ settings.map }}</strong><template
          v-if="settings.map === 'river' && settings.seed !== undefined"
        >
          · seed {{ settings.seed }}</template
        >…
      </span>
    </div>
  </div>
</template>

<style scoped>
.loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  /* Same ground as the page: the half-built scene never shows. */
  background: #101418;
  z-index: 10;
}

.card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-radius: 8px;
  background: rgb(0 0 0 / 40%);
  font:
    14px/1.2 ui-monospace,
    monospace;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 3px solid rgb(255 214 140 / 25%);
  border-top-color: rgb(255 214 140 / 90%);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(1turn);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2.4s;
  }
}
</style>
