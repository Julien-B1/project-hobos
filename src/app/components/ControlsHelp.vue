<script setup lang="ts">
/**
 * Controls panel: a summary of the mouse and keyboard controls, shown by
 * the round "?" button at the top left. Keys are bound by physical
 * position (see `input/bindings.ts`), so both AZERTY and QWERTY labels are
 * given where they differ. Purely presentational.
 */

/** One row: what it does, and the inputs that do it. */
interface ControlRow {
  readonly action: string
  readonly inputs: string
}

const ROWS: readonly ControlRow[] = [
  { action: 'Select the character', inputs: 'Left click on it' },
  { action: 'Move the character', inputs: 'Right click on the destination' },
  { action: 'Move the camera', inputs: 'Z Q S D (AZERTY) · W A S D · arrows' },
  { action: 'Rotate by 45°', inputs: 'A / E (AZERTY) · Q / E' },
  { action: 'Free rotation', inputs: 'Left drag' },
  { action: 'Pan', inputs: 'Middle drag' },
  { action: 'Zoom', inputs: 'Wheel · R / F' },
  { action: 'Back to the character', inputs: 'C · Home' },
  { action: 'Cut the scenery', inputs: 'Cut slider (left edge)' },
  { action: 'Grid', inputs: 'G' },
  { action: 'Hide all overlays', inputs: 'H' },
]
</script>

<template>
  <aside class="controls" aria-label="Controls">
    <h2>Controls</h2>
    <table>
      <tbody>
        <tr v-for="row in ROWS" :key="row.action">
          <th scope="row">{{ row.action }}</th>
          <td>{{ row.inputs }}</td>
        </tr>
      </tbody>
    </table>
  </aside>
</template>

<style scoped>
.controls {
  position: absolute;
  /* Under the round buttons, right of the cut slider. */
  top: 52px;
  left: 60px;
  max-width: calc(100% - 72px);
  padding: 8px 12px;
  border-radius: 6px;
  background: rgb(0 0 0 / 65%);
  font:
    13px/1.5 ui-monospace,
    monospace;
  user-select: none;
}

h2 {
  margin: 0 0 4px;
  font-size: 13px;
  color: rgb(255 214 140);
}

table {
  border-collapse: collapse;
}

th {
  padding: 1px 16px 1px 0;
  font-weight: normal;
  text-align: left;
  opacity: 0.75;
}

td {
  padding: 1px 0;
}
</style>
