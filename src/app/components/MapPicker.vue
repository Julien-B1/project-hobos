<script setup lang="ts">
/**
 * Map picker: bottom-right panel to switch the test map without reloading
 * the page. Procedural maps (`river`) also get a seed field, a random
 * seed button and an optional size field.
 *
 * Edits a local draft; nothing changes until "Load" (or Enter in a field),
 * which emits `apply` with the new settings. App.vue then regenerates the
 * world and updates the URL. Empty seed or size fields mean "generator
 * default"; the resolved values of the running map show as placeholders.
 */
import { computed, ref, watch } from 'vue'
import { TEST_MAP_IDS, type TestMapId } from '@/core/generators/catalog'
import { MAP_SIZE_RANGE, clampMapSize, randomSeed, type MapSettings } from '@/app/config'
import type { SessionInfo } from '@/app/session'

const props = defineProps<{
  /** Settings of the map currently loaded. */
  settings: MapSettings
  /** Resolved settings of the running map (defaults filled in), or null while loading. */
  session: SessionInfo | null
}>()

const emit = defineEmits<{
  /** Load a map with these settings (also fired when they equal the current ones: regenerates). */
  apply: [settings: MapSettings]
}>()

/** Maps that take a seed and a size; the fixed maps ignore both. */
const PROCEDURAL: ReadonlySet<TestMapId> = new Set<TestMapId>(['river'])

// Draft state. Fields are strings so an empty field can mean "default".
const map = ref<TestMapId>(props.settings.map)
const seedText = ref('')
const sizeText = ref('')

/** Reset the draft to the loaded settings (at start and after each load). */
function syncDraft(settings: MapSettings): void {
  map.value = settings.map
  seedText.value = settings.seed === undefined ? '' : String(settings.seed)
  sizeText.value = settings.size === undefined ? '' : String(settings.size)
}
watch(() => props.settings, syncDraft, { immediate: true })

const procedural = computed(() => PROCEDURAL.has(map.value))

/** Placeholders: what an empty field resolves to, when the running map tells us. */
const seedPlaceholder = computed(() =>
  props.session?.map === map.value && props.session.seed !== null
    ? String(props.session.seed)
    : 'default',
)
const sizePlaceholder = computed(() =>
  props.session?.map === map.value ? String(props.session.width) : 'default',
)

/** Integer from a field, or undefined when empty or not a number. */
function parseField(text: string): number | undefined {
  const value = Number.parseInt(text, 10)
  return Number.isFinite(value) ? value : undefined
}

function apply(): void {
  const seed = procedural.value ? parseField(seedText.value) : undefined
  const size = procedural.value ? parseField(sizeText.value) : undefined
  emit('apply', {
    map: map.value,
    // Keep seeds in the signed 32-bit range the noise expects.
    seed: seed === undefined ? undefined : seed | 0,
    size: size === undefined ? undefined : clampMapSize(size),
  })
  // Hand the keyboard back to the camera shortcuts (they ignore focused fields).
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

/** Roll a new seed and load it straight away. */
function rollSeed(): void {
  seedText.value = String(randomSeed())
  apply()
}
</script>

<template>
  <form class="map-picker" aria-label="Test map" @submit.prevent="apply">
    <select v-model="map" aria-label="Map">
      <option v-for="id in TEST_MAP_IDS" :key="id" :value="id">{{ id }}</option>
    </select>
    <template v-if="procedural">
      <label>
        Seed
        <input
          v-model="seedText"
          class="seed"
          type="text"
          inputmode="numeric"
          :placeholder="seedPlaceholder"
          aria-label="Seed"
        />
      </label>
      <button type="button" title="Random seed" aria-label="Random seed" @click="rollSeed">
        🎲
      </button>
      <label>
        Size
        <input
          v-model="sizeText"
          class="size"
          type="text"
          inputmode="numeric"
          :placeholder="sizePlaceholder"
          :title="`Edge length in cells (${MAP_SIZE_RANGE.min} to ${MAP_SIZE_RANGE.max})`"
          aria-label="Size"
        />
      </label>
    </template>
    <button type="submit" class="load">Load</button>
  </form>
</template>

<style scoped>
.map-picker {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  /* Stay clear of the cut slider along the left edge. */
  max-width: calc(100% - 84px);
  padding: 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  font:
    12px/1.2 ui-monospace,
    monospace;
}

label {
  display: flex;
  align-items: center;
  gap: 4px;
}

select,
input,
button {
  padding: 4px 6px;
  border: 1px solid rgb(255 255 255 / 15%);
  border-radius: 4px;
  background: rgb(0 0 0 / 30%);
  color: inherit;
  font: inherit;
}

select option {
  background: #222;
}

.seed {
  width: 11ch;
}

.size {
  width: 5ch;
}

button {
  background: transparent;
  cursor: pointer;
}

button:hover {
  background: rgb(255 255 255 / 10%);
}

.load {
  border-color: rgb(255 214 140 / 80%);
  background: rgb(255 214 140 / 20%);
}
</style>
