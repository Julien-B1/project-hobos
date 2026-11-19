<script setup lang="ts">
/**
 * Root component of the application shell: the game canvas with the debug
 * HUD layered on top. HUD state flows one way: engine -> GameCanvas -> here
 * -> DebugHud.
 */
import { shallowRef } from 'vue'
import type { EngineHudState } from '@/render/engine'
import GameCanvas from './components/GameCanvas.vue'
import DebugHud from './components/DebugHud.vue'

// shallowRef: the snapshot is replaced as a whole, never mutated in place.
const hud = shallowRef<EngineHudState | null>(null)

function onHud(state: EngineHudState): void {
  hud.value = state
}
</script>

<template>
  <main class="app">
    <GameCanvas @hud="onHud" />
    <DebugHud :state="hud" />
  </main>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
}
</style>
