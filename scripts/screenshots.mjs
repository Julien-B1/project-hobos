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
 * e.g. "map=bridges&cam=47,12,14,35"), with optional "steps": mouse
 * clicks played before the capture, each { "click": [x, y], "button":
 * "left" | "right", "wait": ms } in viewport pixels (1280 x 800), or a
 * burst of captures { "frames": n, "every": ms } saved as name-NN.png. Without a
 * views file, the default views show every crossing of the bridges map.
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
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.error(`console ${message.type()}:`, message.text())
    }
  })
  for (const view of views) {
    const url = `http://127.0.0.1:${PORT}/?forceWebGL=1&${view.query}`
    await page.goto(url, { waitUntil: 'load' })
    // The HUD shows the backend once the renderer runs; then let the
    // camera settle and the shadows render.
    await page.getByText('Backend:').waitFor({ timeout: 120_000 })
    await page.waitForTimeout(6000)
    for (const step of view.steps ?? []) {
      if (step.frames) {
        // A burst of captures (animation checks): name-00.png, name-01.png...
        for (let i = 0; i < step.frames; i++) {
          const burst = `${OUT}/${view.name}-${String(i).padStart(2, '0')}.png`
          await page.screenshot({ path: burst })
          await page.waitForTimeout(step.every ?? 100)
        }
        continue
      }
      const [x, y] = step.click
      await page.mouse.move(x, y)
      await page.waitForTimeout(500) // hover picking runs in the next frames
      await page.mouse.click(x, y, { button: step.button ?? 'left' })
      await page.waitForTimeout(step.wait ?? 500)
    }
    // Network weight of the page (what a remote tester downloads).
    const entries = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .concat(performance.getEntriesByType('navigation'))
        .map((e) => ({
          name: e.name,
          transfer: e.transferSize ?? 0,
          body: e.decodedBodySize ?? 0,
        })),
    )
    const kB = (bytes) => `${(bytes / 1024).toFixed(0)} kB`
    const transfer = entries.reduce((sum, e) => sum + e.transfer, 0)
    console.log(`${view.name}: ${kB(transfer)} transferred`)
    // The heavy ones (over 50 kB on the wire): what to slim first.
    for (const e of entries.filter((e) => e.transfer > 50 * 1024)) {
      console.log(`  ${kB(e.transfer)} (${kB(e.body)} decoded) ${new URL(e.name).pathname}`)
    }
    const file = `${OUT}/${view.name}.png`
    await page.screenshot({ path: file })
    console.log('saved', file)
  }
} finally {
  await browser.close()
  await server.close()
}
