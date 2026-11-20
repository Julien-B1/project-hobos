<script setup lang="ts">
/**
 * Action bar: bottom-centre menu shown while a character is selected, with
 * the animations its class can play (see `CHARACTER_ACTIONS` in config).
 * Purely presentational: emits `play` with a clip name; the engine
 * cross-fades to it from the current pose.
 */
import type { CharacterAction } from '@/app/config'

defineProps<{
  /** Actions of the selected character's class. */
  actions: readonly CharacterAction[]
}>()

const emit = defineEmits<{
  /** Play this library clip on the selected character. */
  play: [clip: string]
}>()
</script>

<template>
  <nav class="action-bar" aria-label="Character actions">
    <button
      v-for="action in actions"
      :key="action.clip"
      type="button"
      :title="action.clip"
      @click="emit('play', action.clip)"
    >
      {{ action.label }}
    </button>
  </nav>
</template>

<style scoped>
.action-bar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  display: flex;
  gap: 4px;
  padding: 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  transform: translateX(-50%);
  font:
    12px/1.2 ui-monospace,
    monospace;
}

button {
  padding: 4px 8px;
  border: 1px solid rgb(255 255 255 / 15%);
  border-radius: 4px;
  background: rgb(0 0 0 / 30%);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

button:hover {
  background: rgb(255 255 255 / 12%);
}
</style>
