/**
 * Version and commit of the build, shown in the app's corner badge so a bug
 * report names the exact build (`src/app/components/VersionBadge.vue`).
 *
 * Read at build time (dev server or `vite build`, see vite.config.ts):
 * 1. `BUILD_DESCRIBE` (output of `git describe --tags --long`) and
 *    `BUILD_COMMIT` from the environment when set: the production image
 *    has no `.git`, `make deploy` passes them as build arguments
 *    (deploy/compose.yaml, deploy/Dockerfile);
 * 2. else git: `git describe --tags --long` (last tag, commits since it,
 *    hash), e.g. `v0.3.0-demo.2-3-g1e1c980` gives version
 *    `v0.3.0-demo.2+3` and commit `1e1c980`;
 * 3. else the `package.json` version and commit `unknown`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** What the badge shows. */
export interface BuildInfo {
  /** Last tag, plus `+N` when N commits came after it (or the package version). */
  readonly version: string
  /** Short commit hash, or `unknown`. */
  readonly commit: string
}

/** Output of a git command, or null when git or the repository is missing. */
function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** Version from `git describe --tags --long` output, or null when it does not parse. */
export function versionFromDescribe(describe: string): string | null {
  const match = /^(.*)-(\d+)-g[0-9a-f]+$/.exec(describe)
  if (!match) return null
  const [, tag, count] = match
  return count === '0' ? (tag ?? null) : `${tag ?? ''}+${count ?? ''}`
}

/** `value` when it is a non-empty string, else null (Compose passes unset build arguments as ''). */
function present(value: string | null | undefined): string | null {
  return value !== undefined && value !== null && value !== '' ? value : null
}

/** Resolve the build's version and commit (see the module comment). */
export function buildInfo(): BuildInfo {
  const envDescribe = present(process.env.BUILD_DESCRIBE)
  const fromEnv = envDescribe === null ? null : versionFromDescribe(envDescribe)
  const describe = git(['describe', '--tags', '--long'])
  const fromGit = describe === null ? null : versionFromDescribe(describe)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version?: string
  }
  return {
    version: fromEnv ?? fromGit ?? `v${pkg.version ?? '0.0.0'}`,
    commit:
      present(process.env.BUILD_COMMIT) ??
      present(git(['rev-parse', '--short', 'HEAD'])) ??
      'unknown',
  }
}
