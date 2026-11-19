/**
 * Boxed In — Modular AI Strategy Engine
 * Supports Easy, Medium, and Hard difficulties with zero-allocation fast 3D chain analysis.
 * Designed as an extensible registry so harder/custom AI levels can be plugged in easily.
 */

function pickRandom(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Reusable scratch buffers keyed by board dimensions so cascade simulations do zero heap allocations.
 */
const scratchPool = new Map();
function getScratch(lattice) {
  const key = `${lattice.edgeCount}:${lattice.cubeCount}`;
  let s = scratchPool.get(key);
  if (!s) {
    s = {
      edgeOwned: new Uint8Array(lattice.edgeCount),
      cubeCounts: new Uint8Array(lattice.cubeCount),
      queue: new Int32Array(lattice.cubeCount),
      inQueue: new Uint8Array(lattice.cubeCount),
      visitedCube: new Uint8Array(lattice.cubeCount),
      chainQueue: new Int32Array(lattice.cubeCount),
    };
    scratchPool.set(key, s);
  }
  return s;
}

/**
 * Copy current engine arrays into scratch buffers.
 */
function syncScratchState(engine, scratch) {
  const { edgeOwner, cubeEdgeCount } = engine;
  for (let i = 0; i < edgeOwner.length; i++) {
    scratch.edgeOwned[i] = edgeOwner[i] === -1 ? 0 : 1;
  }
  scratch.cubeCounts.set(cubeEdgeCount);
}

/**
 * Simulate claiming `edgeId` (which must have completesCount === 0, or any edge)
 * and compute how many cubes the NEXT player can greedily sweep in a single cascade turn
 * through `11/12` and connected `10/12` cubes.
 *
 * Also returns the edge ids touched in that cascade so we know what the board looks like afterwards.
 */
export function simulateChainCapture(engine, edgeId, externalScratch = null) {
  const lattice = engine.lattice;
  const scratch = externalScratch || getScratch(lattice);
  syncScratchState(engine, scratch);

  const { edgeOwned, cubeCounts, queue, inQueue } = scratch;
  inQueue.fill(0);

  // Claim the candidate edge
  edgeOwned[edgeId] = 1;
  const edgeCubes = lattice.edges[edgeId].cubes;
  let immediateSelf = 0;
  let qTail = 0;

  for (let i = 0; i < edgeCubes.length; i++) {
    const cid = edgeCubes[i];
    cubeCounts[cid] += 1;
    if (cubeCounts[cid] === 12) {
      immediateSelf += 1;
    } else if (cubeCounts[cid] === 11) {
      queue[qTail++] = cid;
      inQueue[cid] = 1;
    }
  }

  // Also include any pre-existing 11/12 cubes if this edge didn't claim them
  for (let cid = 0; cid < lattice.cubeCount; cid++) {
    if (cubeCounts[cid] === 11 && !inQueue[cid]) {
      queue[qTail++] = cid;
      inQueue[cid] = 1;
    }
  }

  let qHead = 0;
  let opponentCascade = 0;

  while (qHead < qTail) {
    const cid = queue[qHead++];
    if (cubeCounts[cid] !== 11) continue;

    // Find the single remaining unclaimed edge of this cube
    const cEdges = lattice.cubes[cid].edges;
    let missingEdge = -1;
    for (let i = 0; i < 12; i++) {
      const eid = cEdges[i];
      if (edgeOwned[eid] === 0) {
        missingEdge = eid;
        break;
      }
    }
    if (missingEdge === -1) continue;

    edgeOwned[missingEdge] = 1;
    const adjCubes = lattice.edges[missingEdge].cubes;
    for (let i = 0; i < adjCubes.length; i++) {
      const nCid = adjCubes[i];
      cubeCounts[nCid] += 1;
      if (cubeCounts[nCid] === 12) {
        opponentCascade += 1;
      } else if (cubeCounts[nCid] === 11 && !inQueue[nCid]) {
        queue[qTail++] = nCid;
        inQueue[nCid] = 1;
      }
    }
  }

  // Check if any safe move (not touching a 10/12 cube) still exists after the cascade
  let safeRemaining = 0;
  for (let eid = 0; eid < lattice.edgeCount; eid++) {
    if (edgeOwned[eid] !== 0) continue;
    const adj = lattice.edges[eid].cubes;
    let createsVuln = false;
    for (let j = 0; j < adj.length; j++) {
      if (cubeCounts[adj[j]] >= 10 && cubeCounts[adj[j]] < 12) {
        createsVuln = true;
        break;
      }
    }
    if (!createsVuln) safeRemaining += 1;
  }

  return {
    immediateSelf,
    opponentCascade,
    safeRemaining,
  };
}

/**
 * Count how many cubes would be swept greedily right now from the current board state
 * if the active player takes all available 11/12 cubes.
 */
function measureCurrentAvailableSweep(engine, scratch) {
  const lattice = engine.lattice;
  syncScratchState(engine, scratch);
  const { edgeOwned, cubeCounts, queue, inQueue } = scratch;
  inQueue.fill(0);

  let qTail = 0;
  for (let cid = 0; cid < lattice.cubeCount; cid++) {
    if (cubeCounts[cid] === 11) {
      queue[qTail++] = cid;
      inQueue[cid] = 1;
    }
  }

  let qHead = 0;
  let captured = 0;
  while (qHead < qTail) {
    const cid = queue[qHead++];
    if (cubeCounts[cid] !== 11) continue;
    const cEdges = lattice.cubes[cid].edges;
    let missing = -1;
    for (let i = 0; i < 12; i++) {
      if (edgeOwned[cEdges[i]] === 0) {
        missing = cEdges[i];
        break;
      }
    }
    if (missing === -1) continue;

    edgeOwned[missing] = 1;
    const adj = lattice.edges[missing].cubes;
    for (let i = 0; i < adj.length; i++) {
      const nCid = adj[i];
      cubeCounts[nCid] += 1;
      if (cubeCounts[nCid] === 12) {
        captured += 1;
      } else if (cubeCounts[nCid] === 11 && !inQueue[nCid]) {
        queue[qTail++] = nCid;
        inQueue[nCid] = 1;
      }
    }
  }

  let safeRemaining = 0;
  for (let eid = 0; eid < lattice.edgeCount; eid++) {
    if (edgeOwned[eid] !== 0) continue;
    const adj = lattice.edges[eid].cubes;
    let createsVuln = false;
    for (let j = 0; j < adj.length; j++) {
      if (cubeCounts[adj[j]] >= 10 && cubeCounts[adj[j]] < 12) {
        createsVuln = true;
        break;
      }
    }
    if (!createsVuln) safeRemaining += 1;
  }

  return { captured, safeRemaining, edgeOwned, cubeCounts };
}

/**
 * Estimate the minimum forced sacrifice after taking the current sweep (used for double-cross detection).
 */
function estimateMinPostSweepSacrifice(lattice, scratch) {
  const { edgeOwned, cubeCounts, queue, inQueue } = scratch;
  // Save post-sweep arrays locally (small: <= 300 and <= 64 bytes)
  const baseEdgeOwned = edgeOwned.slice();
  const baseCubeCounts = cubeCounts.slice();

  let minCascade = Infinity;
  for (let eid = 0; eid < lattice.edgeCount; eid++) {
    if (baseEdgeOwned[eid] !== 0) continue;

    edgeOwned.set(baseEdgeOwned);
    cubeCounts.set(baseCubeCounts);
    inQueue.fill(0);

    edgeOwned[eid] = 1;
    const adj = lattice.edges[eid].cubes;
    let qTail = 0;
    for (let i = 0; i < adj.length; i++) {
      const cid = adj[i];
      cubeCounts[cid] += 1;
      if (cubeCounts[cid] === 11) {
        queue[qTail++] = cid;
        inQueue[cid] = 1;
      }
    }

    let qHead = 0;
    let cascade = 0;
    while (qHead < qTail) {
      const cid = queue[qHead++];
      if (cubeCounts[cid] !== 11) continue;
      const cEdges = lattice.cubes[cid].edges;
      let missing = -1;
      for (let i = 0; i < 12; i++) {
        if (edgeOwned[cEdges[i]] === 0) {
          missing = cEdges[i];
          break;
        }
      }
      if (missing === -1) continue;

      edgeOwned[missing] = 1;
      const nAdj = lattice.edges[missing].cubes;
      for (let i = 0; i < nAdj.length; i++) {
        const nCid = nAdj[i];
        cubeCounts[nCid] += 1;
        if (cubeCounts[nCid] === 12) {
          cascade += 1;
        } else if (cubeCounts[nCid] === 11 && !inQueue[nCid]) {
          queue[qTail++] = nCid;
          inQueue[nCid] = 1;
        }
      }
    }

    if (cascade < minCascade) {
      minCascade = cascade;
      if (minCascade <= 2) break;
    }
  }

  return minCascade === Infinity ? 0 : minCascade;
}

/**
 * Compute size of connected `remaining <= 2` chain reachable if `edgeId` pushes a 9->10 cube.
 */
function estimateCreatedChainSize(engine, edgeId, scratch) {
  const lattice = engine.lattice;
  const { edgeOwner, cubeEdgeCount } = engine;
  const { visitedCube, chainQueue } = scratch;
  visitedCube.fill(0);

  let qTail = 0;
  const adj = lattice.edges[edgeId].cubes;
  for (let i = 0; i < adj.length; i++) {
    const cid = adj[i];
    // Cube currently at 9/12 becomes 10/12 (2 remaining) when this edge is claimed
    if (cubeEdgeCount[cid] === 9) {
      visitedCube[cid] = 1;
      chainQueue[qTail++] = cid;
    }
  }

  if (qTail === 0) return 0;

  let qHead = 0;
  while (qHead < qTail) {
    const cid = chainQueue[qHead++];
    const cEdges = lattice.cubes[cid].edges;
    for (let i = 0; i < 12; i++) {
      const eid = cEdges[i];
      if (eid === edgeId || edgeOwner[eid] !== -1) continue;
      const neighbors = lattice.edges[eid].cubes;
      for (let j = 0; j < neighbors.length; j++) {
        const nCid = neighbors[j];
        if (!visitedCube[nCid] && cubeEdgeCount[nCid] >= 10 && cubeEdgeCount[nCid] < 12) {
          visitedCube[nCid] = 1;
          chainQueue[qTail++] = nCid;
        }
      }
    }
  }

  return qTail;
}

/**
 * Easy AI: Mostly random (75%), occasionally spots an open cube (25%).
 */
function chooseEasyMove(engine, rng = Math.random) {
  const unclaimed = engine.getUnclaimedEdges();
  if (unclaimed.length === 0) return -1;

  if (rng() < 0.25) {
    const captures = [];
    for (const eid of unclaimed) {
      const info = engine.analyzeEdge(eid);
      if (info.completesCount > 0) captures.push(eid);
    }
    if (captures.length > 0) return pickRandom(captures, rng);
  }

  return pickRandom(unclaimed, rng);
}

/**
 * Medium AI:
 * 1. Captures cubes when available (prefers multi-cube captures).
 * 2. Picks a safe move (creates 0 vulnerable cubes), preferring lower-risk interior/progress edges.
 * 3. If forced to open a cube, minimizes immediate vulnerable cubes created.
 */
function chooseMediumMove(engine, rng = Math.random) {
  const unclaimed = engine.getUnclaimedEdges();
  if (unclaimed.length === 0) return -1;

  const analyzed = unclaimed.map((id) => ({
    id,
    edge: engine.lattice.edges[id],
    ...engine.analyzeEdge(id),
  }));

  // 1. Immediate captures
  const captures = analyzed.filter((m) => m.completesCount > 0);
  if (captures.length > 0) {
    captures.sort((a, b) => b.completesCount - a.completesCount);
    const bestCount = captures[0].completesCount;
    const top = captures.filter((m) => m.completesCount === bestCount);
    return pickRandom(top, rng).id;
  }

  // 2. Safe moves (no 11/12 created)
  const safe = analyzed.filter((m) => m.vulnerableCount === 0);
  if (safe.length > 0) {
    let bestScore = -Infinity;
    let bestMoves = [];
    for (const m of safe) {
      // Slight preference for central/shared edges and advancing cubes safely without creating 10/12 chains
      let nineCount = 0;
      for (const cid of m.affectedCubes) {
        if (engine.cubeEdgeCount[cid] === 9) nineCount += 1;
      }
      const score = m.affectedCount * 1.2 - nineCount * 0.7 + rng() * 0.4;
      if (score > bestScore + 1e-6) {
        bestScore = score;
        bestMoves = [m];
      } else if (Math.abs(score - bestScore) <= 1e-6) {
        bestMoves.push(m);
      }
    }
    return pickRandom(bestMoves, rng).id;
  }

  // 3. Forced sacrifice: minimize newly created vulnerable cubes
  analyzed.sort((a, b) => a.vulnerableCount - b.vulnerableCount);
  const minVuln = analyzed[0].vulnerableCount;
  const leastBad = analyzed.filter((m) => m.vulnerableCount === minVuln);
  return pickRandom(leastBad, rng).id;
}

/**
 * Hard AI:
 * - Understands multi-cube chains via fast cascade simulation
 * - Recognizes double-cross / hard-hearted handout opportunities in late game
 * - Avoids giving away large cube runs when forced to sacrifice
 * - Prioritizes interior board control and avoids setting up long 10/12 chains during safe play
 */
function chooseHardMove(engine, rng = Math.random) {
  const lattice = engine.lattice;
  const unclaimed = engine.getUnclaimedEdges();
  if (unclaimed.length === 0) return -1;

  const scratch = getScratch(lattice);
  const analyzed = new Array(unclaimed.length);
  const captures = [];
  const safe = [];
  const risky = [];

  for (let i = 0; i < unclaimed.length; i++) {
    const id = unclaimed[i];
    const info = engine.analyzeEdge(id);
    const entry = {
      id,
      edge: lattice.edges[id],
      ...info,
    };
    analyzed[i] = entry;
    if (info.completesCount > 0) {
      captures.push(entry);
    } else if (info.vulnerableCount === 0) {
      safe.push(entry);
    } else {
      risky.push(entry);
    }
  }

  // Phase 1: Captures available
  if (captures.length > 0) {
    // Check for Hard-Hearted Handout / Double-Cross opportunity:
    // Only when few cubes are immediately capturable (<= 2) and taking them leaves 0 safe moves
    // and forces us to give away a larger chain (>= 3).
    const sweep = measureCurrentAvailableSweep(engine, scratch);
    const remainingTotal = engine.getRemainingCubes();

    if (
      sweep.captured > 0 &&
      sweep.captured <= 2 &&
      sweep.safeRemaining === 0 &&
      remainingTotal > sweep.captured + 2 &&
      risky.length > 0
    ) {
      const postSweepGift = estimateMinPostSweepSacrifice(lattice, scratch);
      if (postSweepGift > sweep.captured + 1) {
        // Look for a non-capturing edge that hands opponent <= 2 cubes and leaves 0 safe moves
        let bestHandout = null;
        let minHandoutGain = Infinity;
        for (let i = 0; i < risky.length; i++) {
          const r = risky[i];
          const sim = simulateChainCapture(engine, r.id, scratch);
          if (sim.opponentCascade <= 2 && sim.safeRemaining === 0) {
            if (sim.opponentCascade < minHandoutGain) {
              minHandoutGain = sim.opponentCascade;
              bestHandout = r;
            }
          }
        }
        if (bestHandout && postSweepGift > minHandoutGain + 1) {
          return bestHandout.id;
        }
      }
    }

    // Otherwise claim the best capture edge:
    // Prefer edges completing the most cubes, or edges that create/continue captures without stalling early
    let bestCapture = captures[0];
    let bestCapScore = -Infinity;
    for (let i = 0; i < captures.length; i++) {
      const m = captures[i];
      // Check if taking m creates another 11/12 immediately (chain continuation)
      let bonus = m.completesCount * 100 - m.vulnerableCount * 4;
      if (m.edge.isInterior) bonus += 1.5;
      bonus += rng() * 0.05;
      if (bonus > bestCapScore) {
        bestCapScore = bonus;
        bestCapture = m;
      }
    }
    return bestCapture.id;
  }

  // Phase 2: Safe moves available (no immediate 11/12 given away)
  if (safe.length > 0) {
    let bestScore = -Infinity;
    let bestCandidates = [];

    for (let i = 0; i < safe.length; i++) {
      const m = safe[i];
      let score = 0;

      // Board control: prioritize interior edges (shared by 4 cubes) and balanced progression
      if (m.edge.isInterior) score += 2.6;
      else if (m.edge.cubes.length === 2) score += 1.1;

      // Penalize pushing cubes to 10/12 (creates future vulnerability chains)
      let pushedTo10 = 0;
      let maxNeighborCount = 0;
      for (let j = 0; j < m.affectedCubes.length; j++) {
        const cid = m.affectedCubes[j];
        const cCount = engine.cubeEdgeCount[cid];
        if (cCount === 9) pushedTo10 += 1;
        if (cCount > maxNeighborCount) maxNeighborCount = cCount;
        // Mildly prefer building cubes up to 7-8 rather than stalling at 0
        if (cCount <= 7) score += 0.35;
      }

      if (pushedTo10 > 0) {
        const chainSize = estimateCreatedChainSize(engine, m.id, scratch);
        // Strongly penalize building long 10/12 chains that opponent could exploit later
        score -= pushedTo10 * 3.5 + chainSize * 2.2;
      } else if (maxNeighborCount === 8) {
        // Pushing 8 -> 9 is solid strategic control when safe
        score += 0.9;
      }

      // Slight tie-breaker jitter
      score += rng() * 0.12;

      if (score > bestScore + 1e-6) {
        bestScore = score;
        bestCandidates = [m];
      } else if (Math.abs(score - bestScore) <= 1e-6) {
        bestCandidates.push(m);
      }
    }

    return pickRandom(bestCandidates, rng).id;
  }

  // Phase 3: Forced sacrifice — pick the edge giving away the smallest exact cascade run!
  let bestRisk = risky[0];
  let bestCascade = Infinity;
  let bestTieScore = -Infinity;

  for (let i = 0; i < risky.length; i++) {
    const m = risky[i];
    const sim = simulateChainCapture(engine, m.id, scratch);
    const cascade = sim.opponentCascade;
    // Tie-break: prefer interior/smaller vulnerable footprint & slight randomness
    const tieScore = -m.vulnerableCount * 2 + (m.edge.isInterior ? 0.5 : 0) + rng() * 0.05;

    if (
      cascade < bestCascade ||
      (cascade === bestCascade && tieScore > bestTieScore)
    ) {
      bestCascade = cascade;
      bestTieScore = tieScore;
      bestRisk = m;
    }
  }

  return bestRisk.id;
}

/**
 * Extensible AI registry (supports adding future levels like 'grandmaster' cleanly).
 */
export const AI_STRATEGIES = {
  easy: chooseEasyMove,
  medium: chooseMediumMove,
  hard: chooseHardMove,
};

/**
 * Choose an edgeId for the active player according to difficulty.
 * @param {import('./game.js').GameEngine} engine
 * @param {'easy'|'medium'|'hard'} [difficulty]
 * @param {() => number} [rng]
 */
export function chooseAIMove(engine, difficulty = engine?.config?.aiDifficulty, rng = Math.random) {
  const strategy = AI_STRATEGIES[difficulty] || AI_STRATEGIES.medium;
  return strategy(engine, rng);
}
