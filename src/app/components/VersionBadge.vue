<script setup lang="ts">
/**
 * Version badge: the build's version and commit in the bottom-left corner,
 * so a bug report or a screenshot names the exact build. Always shown, even
 * with the overlays hidden (`H`); the text is selectable, to copy it.
 * Values come from `tooling/buildInfo.ts` at build time.
 */
const VERSION = __APP_VERSION__
const COMMIT = __APP_COMMIT__
</script>

<template>
  <small class="version" :title="`Version ${VERSION}, commit ${COMMIT}`">
    {{ VERSION }} · {{ COMMIT }}
  </small>
</template>

<style scoped>
.version {
  position: absolute;
  /* Right of the cut slider. */
  bottom: 12px;
  left: 60px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgb(0 0 0 / 45%);
  font:
    11px/1.3 ui-monospace,
    monospace;
  opacity: 0.75;
  user-select: text;
}
</style>
