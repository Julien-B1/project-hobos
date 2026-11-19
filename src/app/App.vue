<script setup lang="ts">
/**
 * Root component of the application shell: the game canvas with the debug
 * HUD, the time-of-day picker and the cut slider layered on top. HUD state flows one way:
 * engine -> GameCanvas -> here -> DebugHud. The time of day flows the other
 * way: picker -> here -> GameCanvas -> engine.
 */
import { ref, shallowRef } from 'vue'
import type { EngineHudState } from '@/render/engine'
import type { TimeOfDay } from '@/render/timeOfDay'
import type { SessionInfo } from '@/app/session'
import { readUrlFlags } from '@/app/config'
import GameCanvas from './components/GameCanvas.vue'
import DebugHud from './components/DebugHud.vue'
import TimeOfDayPicker from './components/TimeOfDayPicker.vue'
import CutSlider from './components/CutSlider.vue'

// shallowRef: the snapshot is replaced as a whole, never mutated in place.
const hud = shallowRef<EngineHudState | null>(null)

function onHud(state: EngineHudState): void {
  hud.value = state
}

// Set once at start-up.
const session = shallowRef<SessionInfo | null>(null)

function onSession(info: SessionInfo): void {
  session.value = info
}

const timeOfDay = ref<TimeOfDay>(readUrlFlags().timeOfDay)

/** World height above which the scene is hidden, or null to show everything. */
const cutHeight = ref<number | null>(null)
</script>

<template>
  <main class="app">
    <GameCanvas
      :time-of-day="timeOfDay"
      :cut-height="cutHeight"
      @hud="onHud"
      @session="onSession"
    />
    <DebugHud :state="hud" :session="session" />
    <TimeOfDayPicker v-model="timeOfDay" />
    <CutSlider v-model="cutHeight" />
  </main>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
}
</style>
