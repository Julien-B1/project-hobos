/**
 * AppImage of the desktop demo, for Linux (`make release`, after Neutralino).
 *
 * Runs inside the dev container. Wraps the Neutralino Linux binary
 * (`release/hobos/hobos-linux_x64`, game files embedded) into a single
 * portable file, `release/hobos/hobos-x86_64.AppImage`: AppDir with the
 * binary, a launcher, a desktop entry and an icon, packed by appimagetool.
 *
 * The web view (WebKitGTK, `libwebkit2gtk-4.1`) is not bundled: it comes
 * from the system, like for the bare binary (bundling GTK and WebKit would
 * weigh about 100 MB).
 *
 * Tools are downloaded once into `bin/appimage/` (git-ignored), pinned by
 * version and SHA-256. appimagetool is itself an AppImage: it runs
 * extracted (`APPIMAGE_EXTRACT_AND_RUN`), as containers have no FUSE.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const TOOLS_DIR = 'bin/appimage'
const TOOLS = [
  {
    name: 'appimagetool',
    url: 'https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage',
    sha256: 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0',
  },
  {
    // Runtime prepended to the image (appimagetool would download it otherwise).
    name: 'runtime',
    url: 'https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64',
    sha256: '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d',
  },
]

const BINARY = 'release/hobos/hobos-linux_x64'
const APPDIR = 'release/hobos.AppDir'
const OUTPUT = 'release/hobos/hobos-x86_64.AppImage'

const DESKTOP = `[Desktop Entry]
Type=Application
Name=Project Hobos (demo)
Comment=HD-2D voxel battle-map prototype
Exec=hobos
Icon=hobos
Categories=Game;
Terminal=false
`

const APPRUN = `#!/bin/sh
# Launcher: run the Neutralino binary from the mounted image.
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/hobos" "$@"
`

/** SHA-256 of a buffer, hex. */
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** Download a tool unless a copy with the right checksum is already there. */
async function ensureTool(tool) {
  const path = `${TOOLS_DIR}/${tool.name}`
  const existing = await readFile(path).catch(() => null)
  if (existing && sha256(existing) === tool.sha256) return path
  console.log(`downloading ${tool.url}`)
  const response = await fetch(tool.url)
  if (!response.ok) throw new Error(`${tool.url}: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (sha256(data) !== tool.sha256) throw new Error(`${tool.name}: checksum mismatch`)
  await mkdir(TOOLS_DIR, { recursive: true })
  await writeFile(path, data)
  await chmod(path, 0o755)
  return path
}

const [tool, runtime] = await Promise.all(TOOLS.map(ensureTool))

await rm(APPDIR, { recursive: true, force: true })
await mkdir(`${APPDIR}/usr/bin`, { recursive: true })
await copyFile(BINARY, `${APPDIR}/usr/bin/hobos`)
await chmod(`${APPDIR}/usr/bin/hobos`, 0o755)
await writeFile(`${APPDIR}/AppRun`, APPRUN)
await chmod(`${APPDIR}/AppRun`, 0o755)
await writeFile(`${APPDIR}/hobos.desktop`, DESKTOP)
await copyFile('tooling/appimage/hobos.png', `${APPDIR}/hobos.png`)
await copyFile('tooling/appimage/hobos.png', `${APPDIR}/.DirIcon`)

execFileSync(tool, ['--no-appstream', '--runtime-file', runtime, APPDIR, OUTPUT], {
  stdio: 'inherit',
  env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: 'x86_64' },
})
await rm(APPDIR, { recursive: true, force: true })
console.log(`saved ${OUTPUT}`)
