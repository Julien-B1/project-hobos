<script setup lang="ts">
/**
 * Cut slider: a vertical slider along the left edge of the screen. Hides
 * everything above a height, to open caves and look under roofs and
 * canopies. The value is a world height (continuous, not tied to voxel
 * levels); the top position means "no cut" (null). Two-way bound
 * (`v-model`).
 */
import { computed } from 'vue'

/** Height of the slider's top position, in world units: nothing is cut there. */
const MAX_HEIGHT = 16

const model = defineModel<number | null>({ required: true })

const position = computed({
  get: () => model.value ?? MAX_HEIGHT,
  set: (value: number) => {
    model.value = value >= MAX_HEIGHT ? null : value
  },
})
</script>

<template>
  <label class="cut">
    <span class="title">Cut</span>
    <input
      v-model.number="position"
      type="range"
      min="0"
      :max="MAX_HEIGHT"
      step="any"
      aria-label="Cut height"
    />
    <span class="value">{{ model === null ? 'off' : model.toFixed(1) }}</span>
  </label>
</template>

<style scoped>
.cut {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 36px;
  padding: 8px 0;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  font:
    12px/1.2 ui-monospace,
    monospace;
}

input {
  flex: 1;
  width: 20px;
  /* Vertical slider: low values at the bottom. */
  writing-mode: vertical-lr;
  direction: rtl;
  accent-color: rgb(255 214 140);
}
</style>
