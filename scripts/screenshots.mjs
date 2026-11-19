/**
 * Screenshots of the running app, for visual checks (`make screenshots`).
 *
 * Runs inside the dev container: starts its own Vite dev server, opens the
 * page in headless Chromium (Playwright) and saves one PNG per view into
 * `screenshots/`. Headless Chromium has no GPU: the page is forced onto the
 * WebGL 2 backend, rendered in software (SwiftShader), so it is slow and
 * may differ slightly from a real GPU.
 *
 * Usage: node scripts/screenshots.mjs [views.json]
 * A views file is an array of { "name", "query" } (query string after `?`,
 * e.g. "map=bridges&cam=47,12,14,35"). Without one, the default views show
 * every crossing of the bridges map.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5199
const OUT = 'screenshots'
const SIZE = { width: 1280, height: 800 }

/** Default views: each crossing of the bridges map (see BRIDGES_LAYOUT). */
const BRIDGE_SLOTS = [
  ['fallen-log', 8.5, 14],
  ['stepping-stones', 21.5, 15],
  ['ford', 35.5, 15],
  ['wood-beam-bridge', 48, 15],
  ['slab-bridge', 61, 16],
  ['stone-arch-bridge', 74.5, 17],
  ['rope-bridge', 88.5, 20],
]
const DEFAULT_VIEWS = [
  { name: 'bridges-overview', query: 'map=bridges&cam=50,12,90,20' },
  ...BRIDGE_SLOTS.map(([name, x, distance]) => ({
    name: `bridge-${name}`,
    query: `map=bridges&cam=${x},12,${distance},35`,
  })),
]

const views = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : DEFAULT_VIEWS

const server = await createServer({ server: { port: PORT, strictPort: true, host: '127.0.0.1' } })
await server.listen()
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
await mkdir(OUT, { recursive: true })
try {
  const page = await browser.newPage({ viewport: SIZE })
  page.on('pageerror', (error) => console.error('page error:', error.message))
  for (const view of views) {
    const url = `http://127.0.0.1:${PORT}/?forceWebGL=1&${view.query}`
    await page.goto(url, { waitUntil: 'load' })
    // The HUD shows the backend once the renderer runs; then let the
    // camera settle and the shadows render.
    await page.getByText('Backend:').waitFor({ timeout: 120_000 })
    await page.waitForTimeout(6000)
    const file = `${OUT}/${view.name}.png`
    await page.screenshot({ path: file })
    console.log('saved', file)
  }
} finally {
  await browser.close()
  await server.close()
}
