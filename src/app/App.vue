<script setup lang="ts">
/**
 * Root component of the application shell: the game canvas with the debug
 * HUD, the time-of-day picker, the cut slider and the map picker layered on
 * top. HUD state flows one way: engine -> GameCanvas -> here -> DebugHud.
 * The time of day flows the other way: picker -> here -> GameCanvas -> engine.
 *
 * The map settings live here: the map picker replaces them and bumps the
 * canvas `key`, so Vue unmounts GameCanvas (disposing its engine and input
 * bindings) and mounts a fresh one. Time of day, cut and grid are held here
 * too, so they carry over to the new map. `H` shows or hides all the
 * overlays (screenshots, a clean view).
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { EngineHudState } from '@/render/engine'
import type { TimeOfDay } from '@/render/timeOfDay'
import type { SessionInfo } from '@/app/session'
import { readUrlFlags, withMapParams, type MapSettings } from '@/app/config'
import { isTextEntryTarget } from '@/app/input/bindings'
import GameCanvas from './components/GameCanvas.vue'
import DebugHud from './components/DebugHud.vue'
import TimeOfDayPicker from './components/TimeOfDayPicker.vue'
import CutSlider from './components/CutSlider.vue'
import MapPicker from './components/MapPicker.vue'

const flags = readUrlFlags()

// shallowRef: the snapshot is replaced as a whole, never mutated in place.
const hud = shallowRef<EngineHudState | null>(null)

/** Grid visibility, mirrored from the engine (G toggles it) so a new map keeps it. */
const grid = ref(flags.grid)

function onHud(state: EngineHudState): void {
  hud.value = state
  grid.value = state.grid
}

// Set at each map load.
const session = shallowRef<SessionInfo | null>(null)

function onSession(info: SessionInfo): void {
  session.value = info
}

const timeOfDay = ref<TimeOfDay>(flags.timeOfDay)

/** World height above which the scene is hidden, or null to show everything. */
const cutHeight = ref<number | null>(null)

// Replaced as a whole by the map picker.
const mapSettings = shallowRef<MapSettings>({ map: flags.map, seed: flags.seed, size: flags.size })

/** Bumped on each load so even identical settings regenerate the map. */
const canvasKey = ref(0)

/** Load another map: remount the canvas and record the choice in the URL. */
function onApplyMap(settings: MapSettings): void {
  mapSettings.value = settings
  hud.value = null
  session.value = null
  canvasKey.value += 1
  // replaceState: a reload or shared link reproduces the map, without
  // filling the history with every map tried.
  const { pathname, search, hash } = window.location
  window.history.replaceState(
    window.history.state,
    '',
    pathname + withMapParams(search, settings) + hash,
  )
}

/** Whether the overlays (HUD, pickers, cut slider) are shown; `H` flips it. */
const overlays = ref(true)

function onKeyDown(e: KeyboardEvent): void {
  if (e.code !== 'KeyH' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
  if (isTextEntryTarget(e.target)) return
  overlays.value = !overlays.value
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <main class="app">
    <GameCanvas
      :key="canvasKey"
      :map-settings="mapSettings"
      :grid="grid"
      :time-of-day="timeOfDay"
      :cut-height="cutHeight"
      @hud="onHud"
      @session="onSession"
    />
    <template v-if="overlays">
      <DebugHud :state="hud" :session="session" />
      <TimeOfDayPicker v-model="timeOfDay" />
      <CutSlider v-model="cutHeight" />
      <MapPicker :settings="mapSettings" :session="session" @apply="onApplyMap" />
    </template>
  </main>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
}
</style>
