import { describe, expect, it } from 'vitest'
import { REFERENCE_LAYOUT as L, createReferenceMap } from './generators/referenceMap'
import { Shape } from './shapes'
import { columnSurfaces, resolveColumnHit, resolveHit, surfaceShape } from './surface'
import { packVoxel } from './voxel'
import { VoxelMap } from './voxelMap'

const UP = { x: 0, y: 1, z: 0 }
const DOWN = { x: 0, y: -1, z: 0 }
const WEST = { x: -1, y: 0, z: 0 }

describe('columnSurfaces', () => {
  it('finds one surface on a simple stack', () => {
    const map = new VoxelMap()
    for (let y = 0; y < 4; y++) map.set(0, y, 0, packVoxel(1))
    expect(columnSurfaces(map, 0, 0, -5, 20)).toEqual([3])
  })

  it('finds every surface separated by air, bottom to top', () => {
    const map = new VoxelMap()
    map.set(2, 0, -3, packVoxel(1))
    map.set(2, 5, -3, packVoxel(1))
    map.set(2, 6, -3, packVoxel(1))
    expect(columnSurfaces(map, 2, -3, 0, 10)).toEqual([0, 6])
  })

  it('returns nothing for an empty column', () => {
    expect(columnSurfaces(new VoxelMap(), 0, 0, 0, 10)).toEqual([])
  })
})

describe('resolveHit on the reference map', () => {
  const map = createReferenceMap()

  it('gives two different surfaces for the same column: bridge deck and path below', () => {
    const deck = resolveHit(map, { x: 23.5, y: (L.bridge.deckLevel + 1) * 0.5, z: 31.5 }, UP)
    const path = resolveHit(map, { x: 23.5, y: L.path.top * 0.5, z: 31.5 }, UP)
    expect(deck?.surface).toEqual({ x: 23, y: L.bridge.deckLevel, z: 31 })
    expect(path?.surface).toEqual({ x: 23, y: L.path.top - 1, z: 31 })
    expect(deck?.facing).toBe('top')
  })

  it('picks a slope from a hit on its sloped top', () => {
    // West bridge ramp, third step: slope voxel at level 8, rising towards +X.
    const level = L.groundTop + 2
    const n = { x: -0.5, y: 1, z: 0 }
    const len = Math.hypot(n.x, n.y)
    const normal = { x: n.x / len, y: n.y / len, z: 0 }
    const hit = resolveHit(map, { x: 17.5, y: (level + 0.5) * 0.5, z: 31.5 }, normal)
    expect(hit?.voxel).toEqual({ x: 17, y: level, z: 31 })
    expect(hit?.surface).toEqual({ x: 17, y: level, z: 31 })
    expect(hit && surfaceShape(hit)).toBe(Shape.SLOPE)
  })

  it('targets the top of the stack when hitting a cliff face', () => {
    const hit = resolveHit(map, { x: L.cliff.x.min, y: 4.25, z: 45.5 }, WEST)
    expect(hit?.facing).toBe('side')
    expect(hit?.voxel).toEqual({ x: L.cliff.x.min, y: 8, z: 45 })
    expect(hit?.surface).toEqual({ x: L.cliff.x.min, y: L.cliff.top - 1, z: 45 })
  })

  it('picks the tunnel floor from inside the tunnel', () => {
    const hit = resolveHit(map, { x: 10.5, y: L.tunnel.floorTop * 0.5, z: 51.5 }, UP)
    expect(hit?.surface).toEqual({ x: 10, y: L.tunnel.floorTop - 1, z: 51 })
  })

  it('maps a hit on the tunnel ceiling to the floor below it', () => {
    const hit = resolveHit(map, { x: 10.5, y: L.tunnel.ceilingLevel * 0.5, z: 51.5 }, DOWN)
    expect(hit?.facing).toBe('bottom')
    expect(hit?.voxel).toEqual({ x: 10, y: L.tunnel.ceilingLevel, z: 51 })
    expect(hit?.surface).toEqual({ x: 10, y: L.tunnel.floorTop - 1, z: 51 })
  })

  it('finds the voxel when a smooth mesh surface lies in front of the voxel face', () => {
    // Smooth meshes round corners: the hit can be a little outside the solid.
    const hit = resolveHit(map, { x: 23.5, y: L.path.top * 0.5 + 0.3, z: 5.5 }, UP)
    expect(hit?.surface).toEqual({ x: 23, y: L.path.top - 1, z: 5 })
  })

  it('returns null when the point resolves to air', () => {
    expect(resolveHit(map, { x: 10.5, y: 30, z: 10.5 }, UP)).toBeNull()
  })
})

describe('resolveHit with negative coordinates', () => {
  it('floors negative positions into the right voxel', () => {
    const map = new VoxelMap()
    map.set(-1, -1, -1, packVoxel(1))
    const hit = resolveHit(map, { x: -0.5, y: 0, z: -0.5 }, UP)
    expect(hit?.voxel).toEqual({ x: -1, y: -1, z: -1 })
  })
})

describe('resolveColumnHit', () => {
  const map = createReferenceMap()

  it('picks the column surface closest to the hit height', () => {
    // Bridge column over the path: near the deck -> deck; near the path -> path.
    expect(resolveColumnHit(map, { x: 23.5, y: 5.3, z: 31.5 })?.surface.y).toBe(L.bridge.deckLevel)
    expect(resolveColumnHit(map, { x: 23.5, y: 2.4, z: 31.5 })?.surface.y).toBe(L.path.top - 1)
  })

  it('tolerates a faceted surface drawn between voxel levels', () => {
    expect(resolveColumnHit(map, { x: 5.5, y: 2.7, z: 5.5 })?.surface).toEqual({ x: 5, y: 5, z: 5 })
  })

  it('returns null over an empty column', () => {
    expect(resolveColumnHit(map, { x: -10.5, y: 3, z: -10.5 })).toBeNull()
  })
})
