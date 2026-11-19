/**
 * Boxed In — 3D Lattice Topology Generator
 * Pure geometric & graph topology for an N×N×N cubic lattice centered at (0,0,0).
 */

/**
 * Canonical string key for an undirected lattice edge between integer grid vertices.
 * Useful for deterministic snapshots, AI transpositions, and future online netcode.
 * @param {'x'|'y'|'z'} axis
 * @param {number} vx
 * @param {number} vy
 * @param {number} vz
 */
export function makeEdgeKey(axis, vx, vy, vz) {
  return `${axis}:${vx},${vy},${vz}`;
}

/**
 * Build a centered N×N×N lattice with unit edge spacing = 1.0.
 * - Vertices: (N+1)^3
 * - Edges:    3 * N * (N+1)^2
 * - Cubes:    N^3 (each referencing 12 edges)
 *
 * @param {number} size Grid dimension N (2, 3, or 4)
 */
export function createLattice(size) {
  const n = Math.max(2, Math.min(4, Math.floor(Number(size) || 3)));
  const half = n * 0.5;
  const vCountAxis = n + 1;

  // 1. Vertices
  const vertices = [];
  const vertexIndex = (vx, vy, vz) => (vx * vCountAxis + vy) * vCountAxis + vz;

  for (let vx = 0; vx <= n; vx++) {
    for (let vy = 0; vy <= n; vy++) {
      for (let vz = 0; vz <= n; vz++) {
        vertices.push({
          id: vertices.length,
          gx: vx,
          gy: vy,
          gz: vz,
          pos: [vx - half, vy - half, vz - half],
        });
      }
    }
  }

  // 2. Edges along X, Y, Z axes
  const edges = [];
  const edgeKeyToId = new Map();

  function addEdge(axis, vx, vy, vz, dx, dy, dz) {
    const id = edges.length;
    const key = makeEdgeKey(axis, vx, vy, vz);
    const p1 = [vx - half, vy - half, vz - half];
    const p2 = [vx + dx - half, vy + dy - half, vz + dz - half];
    const mid = [
      (p1[0] + p2[0]) * 0.5,
      (p1[1] + p2[1]) * 0.5,
      (p1[2] + p2[2]) * 0.5,
    ];
    const edge = {
      id,
      key,
      axis,
      vx,
      vy,
      vz,
      v1: vertexIndex(vx, vy, vz),
      v2: vertexIndex(vx + dx, vy + dy, vz + dz),
      p1,
      p2,
      mid,
      cubes: [],
      isInterior: false,
    };
    edges.push(edge);
    edgeKeyToId.set(key, id);
    return id;
  }

  // X-aligned edges: x in [0..n-1], y in [0..n], z in [0..n]
  for (let x = 0; x < n; x++) {
    for (let y = 0; y <= n; y++) {
      for (let z = 0; z <= n; z++) {
        addEdge('x', x, y, z, 1, 0, 0);
      }
    }
  }

  // Y-aligned edges: x in [0..n], y in [0..n-1], z in [0..n]
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y < n; y++) {
      for (let z = 0; z <= n; z++) {
        addEdge('y', x, y, z, 0, 1, 0);
      }
    }
  }

  // Z-aligned edges: x in [0..n], y in [0..n], z in [0..n-1]
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      for (let z = 0; z < n; z++) {
        addEdge('z', x, y, z, 0, 0, 1);
      }
    }
  }

  // 3. Cubes and bidirectional edge <-> cube adjacency
  const cubes = [];
  for (let cx = 0; cx < n; cx++) {
    for (let cy = 0; cy < n; cy++) {
      for (let cz = 0; cz < n; cz++) {
        const cubeId = cubes.length;
        const cubeEdges = [
          // 4 X-edges
          edgeKeyToId.get(makeEdgeKey('x', cx, cy, cz)),
          edgeKeyToId.get(makeEdgeKey('x', cx, cy + 1, cz)),
          edgeKeyToId.get(makeEdgeKey('x', cx, cy, cz + 1)),
          edgeKeyToId.get(makeEdgeKey('x', cx, cy + 1, cz + 1)),
          // 4 Y-edges
          edgeKeyToId.get(makeEdgeKey('y', cx, cy, cz)),
          edgeKeyToId.get(makeEdgeKey('y', cx + 1, cy, cz)),
          edgeKeyToId.get(makeEdgeKey('y', cx, cy, cz + 1)),
          edgeKeyToId.get(makeEdgeKey('y', cx + 1, cy, cz + 1)),
          // 4 Z-edges
          edgeKeyToId.get(makeEdgeKey('z', cx, cy, cz)),
          edgeKeyToId.get(makeEdgeKey('z', cx + 1, cy, cz)),
          edgeKeyToId.get(makeEdgeKey('z', cx, cy + 1, cz)),
          edgeKeyToId.get(makeEdgeKey('z', cx + 1, cy + 1, cz)),
        ];

        for (let i = 0; i < cubeEdges.length; i++) {
          edges[cubeEdges[i]].cubes.push(cubeId);
        }

        const isInterior =
          cx > 0 && cx < n - 1 &&
          cy > 0 && cy < n - 1 &&
          cz > 0 && cz < n - 1;

        cubes.push({
          id: cubeId,
          x: cx,
          y: cy,
          z: cz,
          center: [cx - half + 0.5, cy - half + 0.5, cz - half + 0.5],
          edges: cubeEdges,
          isInterior,
        });
      }
    }
  }

  for (let i = 0; i < edges.length; i++) {
    edges[i].isInterior = edges[i].cubes.length === 4;
  }

  return {
    size: n,
    vertexCount: vertices.length,
    edgeCount: edges.length,
    cubeCount: cubes.length,
    vertices,
    edges,
    cubes,
    edgeKeyToId,
  };
}
