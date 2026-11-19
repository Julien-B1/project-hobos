/**
 * Compression and caching for the Vite dev and preview servers, and
 * precompressed files for the production build.
 *
 * Neither server compresses its responses, and the dev server sends Three.js
 * unminified with inline source maps: over a slow link (remote testing
 * through a VPN) the page took a minute to load. This plugin:
 * - compresses responses (scripts, styles, HTML, JSON, glTF models) with
 *   Brotli when the browser accepts it (15-20 % smaller than gzip on
 *   Three.js), else gzip. Compressed bodies are kept in memory by content
 *   hash, so each distinct file is compressed once per server run;
 * - strips the inline source maps of pre-bundled dependencies (see
 *   `DEPS_PREFIX`);
 * - preview server (the production build): files under `/assets/` have a
 *   content hash in their name, so they are cached for a year as
 *   immutable; a new version gives new names, and `index.html`, which
 *   lists them, is never cached (revalidated on every load);
 * - build: writes `.br` and `.gz` next to each compressible output file,
 *   for a host that serves precompressed files (nginx `brotli_static`,
 *   `gzip_static`); skipped with `PRECOMPRESS=off` (desktop demo).
 * Node's own zlib, no dependency.
 *
 * Responses are buffered, then compressed in one go: fine for these
 * servers (largest file a few MB).
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import type { Connect, Plugin } from 'vite'

/** Content types worth compressing (`gltf`: glTF models, `model/gltf-binary`). */
const COMPRESSIBLE = /javascript|css|json|html|svg|text|xml|wasm|gltf/
/** Build output files worth precompressing. */
const COMPRESSIBLE_FILE = /\.(js|mjs|css|html|svg|json|wasm|glb|gltf)$/
/** Smaller bodies are sent as they are. */
const MIN_BYTES = 1024

/** Brotli quality: on the fly (fast, cached anyway), and for the build (best). */
const BROTLI_LIVE = 9
const BROTLI_BUILD = 11

/** Cache policy of the preview server's hashed assets. */
const IMMUTABLE = 'public, max-age=31536000, immutable'
/** Cache policy of everything else in preview (`index.html`): always revalidate. */
const REVALIDATE = 'no-cache'

/**
 * URL prefix of the dev server's pre-bundled dependencies (Three.js, Vue).
 * The server inlines their source maps (base64, about 80 % of the bytes):
 * they are stripped, as nobody steps through the library internals here.
 */
const DEPS_PREFIX = '/node_modules/.vite/deps/'
/** Marker of an inline source map comment. */
const INLINE_MAP = '\n//# sourceMappingURL=data:'

/** Compressed bodies by encoding and content hash (one server run). */
const compressed = new Map<string, Buffer>()
/** Bound of {@link compressed}: cleared when full (a dev session stays far below). */
const MAX_CACHED = 500

/** `body` without its trailing inline source map comment, if any. */
function stripInlineSourceMap(body: Buffer): Buffer {
  const at = body.lastIndexOf(INLINE_MAP)
  return at >= 0 ? body.subarray(0, at + 1) : body
}

/** Brotli at `quality`, with the text mode hint. */
function brotli(body: Buffer, quality: number): Buffer {
  return brotliCompressSync(body, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality,
      [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
    },
  })
}

/** `body` compressed with `encoding`, from the cache when already done. */
function compressCached(body: Buffer, encoding: 'br' | 'gzip'): Buffer {
  const key = `${encoding}:${createHash('sha1').update(body).digest('hex')}`
  let out = compressed.get(key)
  if (!out) {
    out = encoding === 'br' ? brotli(body, BROTLI_LIVE) : gzipSync(body, { level: 9 })
    if (compressed.size >= MAX_CACHED) compressed.clear()
    compressed.set(key, out)
  }
  return out
}

/** Vite plugin: compression and cache headers (servers), precompressed files (build). */
export function compression(): Plugin {
  let outDir = 'dist'
  return {
    name: 'hobos:compression',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use(middleware(false))
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(true))
    },
    async writeBundle() {
      // The desktop demo (`make release`) serves files locally: no use for them.
      if (process.env.PRECOMPRESS === 'off') return
      for (const file of await listFiles(outDir)) {
        if (!COMPRESSIBLE_FILE.test(file)) continue
        const body = await readFile(file)
        if (body.length < MIN_BYTES) continue
        await writeFile(`${file}.br`, brotli(body, BROTLI_BUILD))
        await writeFile(`${file}.gz`, gzipSync(body, { level: 9 }))
      }
    },
  }
}

/** Every file under `dir`, recursively. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(path)))
    else out.push(path)
  }
  return out
}

/**
 * Connect middleware: buffer the response, compress it when worth it;
 * with `cacheHeaders` (preview), set the cache policy.
 */
function middleware(cacheHeaders: boolean): Connect.NextHandleFunction {
  return (req, res, next) => {
    const accepted = req.headers['accept-encoding'] ?? ''
    const encoding = /\bbr\b/.test(accepted) ? 'br' : /\bgzip\b/.test(accepted) ? 'gzip' : null
    if (req.method === 'HEAD' || (!encoding && !cacheHeaders)) {
      next()
      return
    }
    const chunks: Buffer[] = []
    // Restored once the body is complete (whatever they were: prototype or wrappers).
    const original = {
      writeHead: res.writeHead.bind(res),
      write: res.write.bind(res),
      end: res.end.bind(res),
    }
    let head: unknown[] | null = null

    const collect = (chunk: unknown, chunkEncoding: unknown): void => {
      if (typeof chunk === 'string') {
        chunks.push(
          Buffer.from(
            chunk,
            typeof chunkEncoding === 'string' ? (chunkEncoding as BufferEncoding) : 'utf8',
          ),
        )
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk))
      }
    }

    // Headers are held back until the body is known (its encoding and length change).
    res.writeHead = (...args: unknown[]) => {
      head = args
      return res
    }
    res.write = ((chunk: unknown, chunkEncoding?: unknown) => {
      collect(chunk, chunkEncoding)
      return true
    }) as typeof res.write
    res.end = ((...args: unknown[]) => {
      const [chunk, chunkEncoding] = args
      if (typeof chunk !== 'function') collect(chunk, chunkEncoding)
      const callback = args.find((a) => typeof a === 'function') as (() => void) | undefined
      Object.assign(res, original)
      if (head) applyHead(res, head)
      if (cacheHeaders) {
        // After the static server's own headers (it sends no-store).
        const path = (req.url ?? '').split('?')[0] ?? ''
        res.setHeader('cache-control', path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE)
      }
      let body: Buffer = Buffer.concat(chunks)
      if (req.url?.startsWith(DEPS_PREFIX)) body = stripInlineSourceMap(body)
      const type = String(res.getHeader('content-type') ?? '')
      const compressible =
        encoding !== null &&
        res.statusCode === 200 &&
        body.length >= MIN_BYTES &&
        COMPRESSIBLE.test(type) &&
        !res.hasHeader('content-encoding')
      if (compressible) {
        body = compressCached(body, encoding)
        res.setHeader('content-encoding', encoding)
        res.setHeader('vary', 'Accept-Encoding')
      }
      if (res.statusCode !== 204 && res.statusCode !== 304)
        res.setHeader('content-length', body.length)
      return res.end(body, callback)
    }) as typeof res.end
    next()
  }
}

/** Apply held-back `writeHead(status, [message], [headers])` arguments as plain headers. */
function applyHead(res: ServerResponse, args: unknown[]): void {
  const [status, second, third] = args
  if (typeof status === 'number') res.statusCode = status
  if (typeof second === 'string') res.statusMessage = second
  const headers = typeof second === 'object' ? second : third
  if (!headers || typeof headers !== 'object') return
  if (Array.isArray(headers)) {
    // Flat [name, value, name, value, ...] form.
    for (let i = 0; i + 1 < headers.length; i += 2)
      res.setHeader(String(headers[i]), headers[i + 1] as string)
    return
  }
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value !== undefined) res.setHeader(name, value as string | number | string[])
  }
}
