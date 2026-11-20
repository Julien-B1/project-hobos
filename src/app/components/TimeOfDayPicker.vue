<script setup lang="ts">
/**
 * Time-of-day picker: a compact row of small sky swatches, one per lighting
 * preset, in chronological order (dawn to late night), with the current
 * time's name beside them. Each swatch is drawn from its preset: sky and
 * ground colours, and the sun (or the moon, by night) placed by its
 * direction (east on the left, west on the right) and height. Two-way bound
 * (`v-model`) to the time of day the canvas renders with; the engine
 * blends the lighting from one time to the next.
 */
import { computed } from 'vue'
import { LIGHTING, TIMES_OF_DAY, type TimeOfDay } from '@/render/timeOfDay'

const model = defineModel<TimeOfDay>({ required: true })

/** Swatch size, in SVG units (= CSS pixels). */
const W = 26
const H = 18
/** Height of the ground band at the bottom of a swatch. */
const GROUND = 4

/** Lights dimmer than this are drawn as the moon. */
const MOON_BELOW = 1

/** CSS colour from an sRGB hex number. */
function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

/** What a swatch draws for one time of day. */
interface Swatch {
  readonly time: TimeOfDay
  readonly label: string
  readonly sky: string
  readonly ground: string
  readonly light: string
  readonly x: number
  readonly y: number
  readonly moon: boolean
}

const SWATCHES: readonly Swatch[] = TIMES_OF_DAY.map((time) => {
  const p = LIGHTING[time]
  // East (azimuth 90) on the left, west (270) on the right.
  const across = Math.min(1, Math.max(0, (p.azimuthDeg - 60) / 240))
  const up = Math.min(1, p.elevationDeg / 70)
  return {
    time,
    label: p.label,
    sky: css(p.skyColor),
    ground: css(p.groundColor),
    light: css(p.lightColor),
    x: 4 + across * (W - 8),
    y: H - GROUND - 2 - up * (H - GROUND - 6),
    moon: p.lightIntensity < MOON_BELOW,
  }
})

const current = computed(() => LIGHTING[model.value].label)
</script>

<template>
  <nav class="picker" aria-label="Time of day">
    <span class="label" aria-live="polite">{{ current }}</span>
    <button
      v-for="s in SWATCHES"
      :key="s.time"
      type="button"
      :class="{ active: model === s.time }"
      :aria-pressed="model === s.time"
      :aria-label="s.label"
      :title="s.label"
      @click="model = s.time"
    >
      <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" aria-hidden="true">
        <rect :width="W" :height="H" :fill="s.sky" />
        <template v-if="s.moon">
          <circle :cx="s.x" :cy="s.y" r="3" :fill="s.light" />
          <circle :cx="s.x + 1.4" :cy="s.y - 1" r="2.6" :fill="s.sky" />
        </template>
        <circle v-else :cx="s.x" :cy="s.y" r="3.2" :fill="s.light" />
        <rect :y="H - GROUND" :width="W" :height="GROUND" :fill="s.ground" />
      </svg>
    </button>
  </nav>
</template>

<style scoped>
.picker {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border-radius: 6px;
  background: rgb(0 0 0 / 45%);
  font:
    12px/1.2 ui-monospace,
    monospace;
}

.label {
  min-width: 10ch;
  padding: 0 6px;
  text-align: right;
  opacity: 0.85;
}

button {
  display: block;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  overflow: hidden;
  background: none;
  line-height: 0;
  cursor: pointer;
  opacity: 0.7;
  transition:
    opacity 0.15s,
    transform 0.15s;
}

button:hover {
  opacity: 1;
  transform: translateY(-1px);
}

button.active {
  border-color: rgb(255 214 140 / 90%);
  opacity: 1;
}
</style>
