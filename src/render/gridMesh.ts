/**
 * Mesh for the flat test grid (step 1).
 *
 * Layer: render. Builds one quad per cell at y = 0 with a checker colour
 * stored per vertex. Reads `FlatGrid` from core, never modifies it.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial } from 'three/webgpu'
import type { FlatGrid } from '@/core/generators/flatGrid'

/** Checker colours (sRGB hex), indexed by `FlatGrid.shade()`. */
const SHADES = [0x6d8f4e, 0x5f7f43] as const

/**
 * Build the grid mesh. Cell (x, z) spans world [x, x+1] x [z, z+1] at y = 0.
 * Vertices are not shared between cells, so each cell keeps a flat colour.
 */
export function createGridMesh(grid: FlatGrid): Mesh {
  const cellCount = grid.width * grid.depth
  const positions = new Float32Array(cellCount * 4 * 3)
  const normals = new Float32Array(cellCount * 4 * 3)
  const colors = new Float32Array(cellCount * 4 * 3)
  const indices = new Uint32Array(cellCount * 6)
  const color = new Color()

  let v = 0
  let i = 0
  for (let z = 0; z < grid.depth; z++) {
    for (let x = 0; x < grid.width; x++) {
      // Vertex colours are linear in Three.js: convert from the sRGB hex.
      color.setHex(SHADES[grid.shade({ x, z })])
      const corners = [
        [x, z],
        [x + 1, z],
        [x + 1, z + 1],
        [x, z + 1],
      ] as const
      for (const [cx, cz] of corners) {
        positions.set([cx, 0, cz], v * 3)
        normals.set([0, 1, 0], v * 3)
        colors.set([color.r, color.g, color.b], v * 3)
        v++
      }
      // Counter-clockwise when seen from above (+Y), so the face points up.
      const base = v - 4
      indices.set([base, base + 2, base + 1, base, base + 3, base + 2], i)
      i += 6
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()

  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'flat-grid'
  return mesh
}
