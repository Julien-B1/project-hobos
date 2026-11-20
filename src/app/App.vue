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
 * overlays (screenshots, a clean view). The debug HUD is hidden by
 * default: the round bug button at the top left shows or hides it; the
 * "?" button next to it shows the controls (one panel at a time). A
 * loading screen covers the canvas until it reports `ready`, at launch and
 * at each map change.
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
import LoadingScreen from './components/LoadingScreen.vue'
import ControlsHelp from './components/ControlsHelp.vue'

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

/** Whether a map is loading (the loading screen covers the canvas). */
const loading = ref(true)

/** Bumped on each load so even identical settings regenerate the map. */
const canvasKey = ref(0)

/** Load another map: remount the canvas and record the choice in the URL. */
function onApplyMap(settings: MapSettings): void {
  mapSettings.value = settings
  loading.value = true
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

/** Panel open under the round buttons: debug HUD (`?hud=on` at start), controls, or none. */
const panel = ref<'debug' | 'controls' | null>(flags.hud ? 'debug' : null)

/** Open `which`, or close it when it is already open (one panel at a time). */
function togglePanel(which: 'debug' | 'controls'): void {
  panel.value = panel.value === which ? null : which
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
  <main class="app" :data-ready="!loading">
    <GameCanvas
      :key="canvasKey"
      :map-settings="mapSettings"
      :grid="grid"
      :time-of-day="timeOfDay"
      :cut-height="cutHeight"
      @hud="onHud"
      @session="onSession"
      @ready="loading = false"
    />
    <Transition name="fade">
      <LoadingScreen v-if="loading" :settings="mapSettings" />
    </Transition>
    <template v-if="overlays">
      <button
        type="button"
        class="round debug-toggle"
        :class="{ on: panel === 'debug' }"
        :aria-pressed="panel === 'debug'"
        :title="panel === 'debug' ? 'Hide debug info' : 'Show debug info'"
        aria-label="Debug info"
        @click="togglePanel('debug')"
      >
        <!-- Bug icon (stroke follows the text colour). -->
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M9 7.5a3 3 0 0 1 6 0" />
            <rect x="7" y="8" width="10" height="12" rx="5" />
            <path
              d="M12 12v8M7 13H3M21 13h-4M7.5 17.5 4 20M16.5 17.5 20 20M7.5 9.5 4 7M16.5 9.5 20 7"
            />
          </g>
        </svg>
      </button>
      <button
        type="button"
        class="round help-toggle"
        :class="{ on: panel === 'controls' }"
        :aria-pressed="panel === 'controls'"
        :title="panel === 'controls' ? 'Hide controls' : 'Show controls'"
        aria-label="Controls"
        @click="togglePanel('controls')"
      >
        ?
      </button>
      <DebugHud v-if="panel === 'debug'" :state="hud" :session="session" />
      <ControlsHelp v-if="panel === 'controls'" />
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

.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-leave-to {
  opacity: 0;
}

/* Round buttons at the top left, right of the cut slider. */
.round {
  position: absolute;
  top: 12px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 50%;
  background: rgb(0 0 0 / 55%);
  color: inherit;
  font:
    bold 16px/1 ui-monospace,
    monospace;
  cursor: pointer;
}

.debug-toggle {
  left: 60px;
}

.help-toggle {
  left: 100px;
}

.round:hover {
  background: rgb(255 255 255 / 15%);
}

.round.on {
  border-color: rgb(255 214 140 / 80%);
  background: rgb(255 214 140 / 20%);
}
</style>
