/**
 * Gzip compression for the Vite dev and preview servers.
 *
 * Neither server compresses its responses, and the dev server sends Three.js
 * unminified with inline source maps: over a slow link (remote testing
 * through a VPN) the page took a minute to load. This plugin gzips text
 * responses (scripts, styles, HTML, JSON) when the browser accepts it.
 * Node's own zlib, no dependency.
 *
 * Pre-bundled dependencies also lose their inline source maps (see
 * `DEPS_PREFIX`).
 *
 * Responses are buffered, then compressed in one go: fine for a dev server
 * (largest file a few MB, compressed once, then served 304 from the cache).
 */
import type { ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import type { Connect, Plugin } from 'vite'

/** Content types worth compressing (`gltf`: glTF models, `model/gltf-binary`). */
const COMPRESSIBLE = /javascript|css|json|html|svg|text|xml|wasm|gltf/
/** Smaller bodies are sent as they are. */
const MIN_BYTES = 1024

/**
 * URL prefix of the dev server's pre-bundled dependencies (Three.js, Vue).
 * The server inlines their source maps (base64, about 80 % of the bytes):
 * they are stripped, as nobody steps through the library internals here.
 */
const DEPS_PREFIX = '/node_modules/.vite/deps/'
/** Marker of an inline source map comment. */
const INLINE_MAP = '\n//# sourceMappingURL=data:'

/** `body` without its trailing inline source map comment, if any. */
function stripInlineSourceMap(body: Buffer): Buffer {
  const at = body.lastIndexOf(INLINE_MAP)
  return at >= 0 ? body.subarray(0, at + 1) : body
}

/** Vite plugin: gzip the responses of the dev and preview servers. */
export function gzip(): Plugin {
  return {
    name: 'hobos:gzip',
    configureServer(server) {
      server.middlewares.use(compress)
    },
    configurePreviewServer(server) {
      server.middlewares.use(compress)
    },
  }
}

/** Connect middleware: buffer the response, gzip it when worth it. */
const compress: Connect.NextHandleFunction = (req, res, next) => {
  const accepts = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  if (!accepts || req.method === 'HEAD') {
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

  const collect = (chunk: unknown, encoding: unknown): void => {
    if (typeof chunk === 'string') {
      chunks.push(
        Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8'),
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
  res.write = ((chunk: unknown, encoding?: unknown) => {
    collect(chunk, encoding)
    return true
  }) as typeof res.write
  res.end = ((...args: unknown[]) => {
    const [chunk, encoding] = args
    if (typeof chunk !== 'function') collect(chunk, encoding)
    const callback = args.find((a) => typeof a === 'function') as (() => void) | undefined
    Object.assign(res, original)
    if (head) applyHead(res, head)
    let body: Buffer = Buffer.concat(chunks)
    if (req.url?.startsWith(DEPS_PREFIX)) body = stripInlineSourceMap(body)
    const type = String(res.getHeader('content-type') ?? '')
    const compressible =
      res.statusCode === 200 &&
      body.length >= MIN_BYTES &&
      COMPRESSIBLE.test(type) &&
      !res.hasHeader('content-encoding')
    if (compressible) {
      body = gzipSync(body)
      res.setHeader('content-encoding', 'gzip')
      res.setHeader('vary', 'Accept-Encoding')
    }
    if (res.statusCode !== 204 && res.statusCode !== 304)
      res.setHeader('content-length', body.length)
    return res.end(body, callback)
  }) as typeof res.end
  next()
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
