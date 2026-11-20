import { describe, expect, it } from 'vitest'
import { Material } from './materials'
import { Orientation, Shape } from './shapes'
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

/**
 * Small picking fixture, in voxel coordinates (surface level L = standing on
 * voxel L - 1): ground at level 6, a lowered path at level 4 under a wooden
 * deck at voxel level 10, one ramp slope, a cliff face and a tunnel.
 */
const L = {
  groundTop: 6,
  path: { x: { min: 12, max: 14 }, top: 4 },
  bridge: { x: { min: 11, max: 15 }, z: { min: 9, max: 10 }, deckLevel: 10 },
  slope: { x: 8, z: 9 },
  cliff: { x: { min: 23, max: 25 }, z: { min: 24, max: 26 }, top: 14 },
  tunnel: { x: 5, z: 25, floorTop: 6, ceilingLevel: 10, top: 14 },
}

function createPickingFixture(): VoxelMap {
  const map = new VoxelMap()
  const stack = (x: number, z: number, from: number, to: number, material = Material.STONE) => {
    for (let y = from; y <= to; y++) map.set(x, y, z, packVoxel(material))
  }
  for (let z = 0; z < 28; z++)
    for (let x = 0; x < 28; x++) {
      const lowered = x >= L.path.x.min && x <= L.path.x.max
      stack(x, z, 0, (lowered ? L.path.top : L.groundTop) - 1)
    }
  for (let z = L.bridge.z.min; z <= L.bridge.z.max; z++)
    for (let x = L.bridge.x.min; x <= L.bridge.x.max; x++)
      map.set(x, L.bridge.deckLevel, z, packVoxel(Material.WOOD))
  // Ramp step two voxels above the ground, rising towards +X.
  stack(L.slope.x, L.slope.z, L.groundTop, L.groundTop + 1)
  map.set(
    L.slope.x,
    L.groundTop + 2,
    L.slope.z,
    packVoxel(Material.WOOD, Shape.SLOPE, Orientation.EAST),
  )
  for (let z = L.cliff.z.min; z <= L.cliff.z.max; z++)
    for (let x = L.cliff.x.min; x <= L.cliff.x.max; x++) stack(x, z, 0, L.cliff.top - 1)
  // Hill column with a tunnel: floor, air gap, ceiling.
  stack(L.tunnel.x, L.tunnel.z, L.tunnel.ceilingLevel, L.tunnel.top - 1)
  return map
}

describe('resolveHit on the picking fixture', () => {
  const map = createPickingFixture()

  it('gives two different surfaces for the same column: bridge deck and path below', () => {
    const deck = resolveHit(map, { x: 13.5, y: (L.bridge.deckLevel + 1) * 0.5, z: 9.5 }, UP)
    const path = resolveHit(map, { x: 13.5, y: L.path.top * 0.5, z: 9.5 }, UP)
    expect(deck?.surface).toEqual({ x: 13, y: L.bridge.deckLevel, z: 9 })
    expect(path?.surface).toEqual({ x: 13, y: L.path.top - 1, z: 9 })
    expect(deck?.facing).toBe('top')
  })

  it('picks a slope from a hit on its sloped top', () => {
    // Ramp step: slope voxel at level 8, rising towards +X.
    const level = L.groundTop + 2
    const n = { x: -0.5, y: 1, z: 0 }
    const len = Math.hypot(n.x, n.y)
    const normal = { x: n.x / len, y: n.y / len, z: 0 }
    const x = L.slope.x
    const hit = resolveHit(map, { x: x + 0.5, y: (level + 0.5) * 0.5, z: 9.5 }, normal)
    expect(hit?.voxel).toEqual({ x, y: level, z: 9 })
    expect(hit?.surface).toEqual({ x, y: level, z: 9 })
    expect(hit && surfaceShape(hit)).toBe(Shape.SLOPE)
  })

  it('targets the top of the stack when hitting a cliff face', () => {
    const hit = resolveHit(map, { x: L.cliff.x.min, y: 4.25, z: 25.5 }, WEST)
    expect(hit?.facing).toBe('side')
    expect(hit?.voxel).toEqual({ x: L.cliff.x.min, y: 8, z: 25 })
    expect(hit?.surface).toEqual({ x: L.cliff.x.min, y: L.cliff.top - 1, z: 25 })
  })

  it('picks the tunnel floor from inside the tunnel', () => {
    const hit = resolveHit(map, { x: 5.5, y: L.tunnel.floorTop * 0.5, z: 25.5 }, UP)
    expect(hit?.surface).toEqual({ x: 5, y: L.tunnel.floorTop - 1, z: 25 })
  })

  it('maps a hit on the tunnel ceiling to the floor below it', () => {
    const hit = resolveHit(map, { x: 5.5, y: L.tunnel.ceilingLevel * 0.5, z: 25.5 }, DOWN)
    expect(hit?.facing).toBe('bottom')
    expect(hit?.voxel).toEqual({ x: 5, y: L.tunnel.ceilingLevel, z: 25 })
    expect(hit?.surface).toEqual({ x: 5, y: L.tunnel.floorTop - 1, z: 25 })
  })

  it('finds the voxel when a smooth mesh surface lies in front of the voxel face', () => {
    // Smooth meshes round corners: the hit can be a little outside the solid.
    const hit = resolveHit(map, { x: 13.5, y: L.path.top * 0.5 + 0.3, z: 5.5 }, UP)
    expect(hit?.surface).toEqual({ x: 13, y: L.path.top - 1, z: 5 })
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
  const map = createPickingFixture()

  it('picks the column surface closest to the hit height', () => {
    // Bridge column over the path: near the deck -> deck; near the path -> path.
    expect(resolveColumnHit(map, { x: 13.5, y: 5.3, z: 9.5 })?.surface.y).toBe(L.bridge.deckLevel)
    expect(resolveColumnHit(map, { x: 13.5, y: 2.4, z: 9.5 })?.surface.y).toBe(L.path.top - 1)
  })

  it('tolerates a faceted surface drawn between voxel levels', () => {
    expect(resolveColumnHit(map, { x: 5.5, y: 2.7, z: 5.5 })?.surface).toEqual({ x: 5, y: 5, z: 5 })
  })

  it('returns null over an empty column', () => {
    expect(resolveColumnHit(map, { x: -10.5, y: 3, z: -10.5 })).toBeNull()
  })
})

describe('wadeThrough', () => {
  it('targets the bed of shallow water and the surface of deep water', async () => {
    const { wadeThrough } = await import('./surface')
    const { Material } = await import('./materials')
    const { packVoxel } = await import('./voxel')
    const { VoxelMap } = await import('./voxelMap')
    const map = new VoxelMap()
    // Shallow: gravel at y 3, water at y 4 (one level deep).
    map.set(0, 3, 0, packVoxel(Material.PATH))
    map.set(0, 4, 0, packVoxel(Material.WATER))
    // Deep: sand at y 0, water at y 1..4 (four levels deep).
    map.set(1, 0, 0, packVoxel(Material.SAND))
    for (let y = 1; y <= 4; y++) map.set(1, y, 0, packVoxel(Material.WATER))
    const hitAt = (x: number) => ({
      voxel: { x, y: 4, z: 0 },
      voxelValue: map.get(x, 4, 0),
      facing: 'top' as const,
      surface: { x, y: 4, z: 0 },
      surfaceValue: map.get(x, 4, 0),
    })
    expect(wadeThrough(map, hitAt(0)).surface.y).toBe(3)
    expect(wadeThrough(map, hitAt(1)).surface.y).toBe(4)
  })
})
