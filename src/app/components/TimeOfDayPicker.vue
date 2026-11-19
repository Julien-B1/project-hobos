<script setup lang="ts">
/**
 * Time-of-day picker: one button per lighting preset, in chronological
 * order (dawn to late night). Two-way bound (`v-model`) to the time of day
 * the canvas renders with.
 */
import { LIGHTING, TIMES_OF_DAY, type TimeOfDay } from '@/render/timeOfDay'

const model = defineModel<TimeOfDay>({ required: true })

/** Small glyph per time of day, next to the label. */
const GLYPHS: Readonly<Record<TimeOfDay, string>> = {
  dawn: '◔',
  morning: '◑',
  noon: '●',
  afternoon: '◕',
  dusk: '◒',
  evening: '◓',
  midnight: '○',
  'late-night': '◌',
}
</script>

<template>
  <nav class="picker" aria-label="Time of day">
    <button
      v-for="time in TIMES_OF_DAY"
      :key="time"
      type="button"
      :class="{ active: model === time }"
      :aria-pressed="model === time"
      @click="model = time"
    >
      <span class="glyph" aria-hidden="true">{{ GLYPHS[time] }}</span>
      {{ LIGHTING[time].label }}
    </button>
  </nav>
</template>

<style scoped>
.picker {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  max-width: min(560px, calc(100% - 24px));
  padding: 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  font:
    12px/1.2 ui-monospace,
    monospace;
}

button {
  padding: 4px 8px;
  border: 1px solid rgb(255 255 255 / 15%);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

button:hover {
  background: rgb(255 255 255 / 10%);
}

button.active {
  border-color: rgb(255 214 140 / 80%);
  background: rgb(255 214 140 / 20%);
}

.glyph {
  margin-right: 4px;
  opacity: 0.8;
}
</style>
