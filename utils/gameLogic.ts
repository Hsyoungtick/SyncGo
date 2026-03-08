import { BOARD_SIZE } from '../constants';
import { BoardState, Player, Point, TerritoryMap } from '../types';

// Helper to create an empty board
export const createEmptyBoard = (): BoardState => {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(Player.None));
};

// Get neighbors (Up, Down, Left, Right)
const getNeighbors = (p: Point): Point[] => {
  const neighbors: Point[] = [];
  if (p.row > 0) neighbors.push({ row: p.row - 1, col: p.col });
  if (p.row < BOARD_SIZE - 1) neighbors.push({ row: p.row + 1, col: p.col });
  if (p.col > 0) neighbors.push({ row: p.row, col: p.col - 1 });
  if (p.col < BOARD_SIZE - 1) neighbors.push({ row: p.row, col: p.col + 1 });
  return neighbors;
};

// Flood fill to find a group of stones
const getGroup = (board: BoardState, start: Point): { stones: Point[], liberties: number } => {
  const color = board[start.row][start.col];
  if (color === Player.None || color === Player.Forbidden) {
    return { stones: [], liberties: 0 };
  }

  const group: Point[] = [];
  const visited = new Set<string>();
  const queue: Point[] = [start];
  visited.add(`${start.row},${start.col}`);

  let liberties = 0;
  const countedLiberties = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    group.push(current);

    const neighbors = getNeighbors(current);
    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.row},${neighbor.col}`;
      const neighborColor = board[neighbor.row][neighbor.col];

      if (neighborColor === Player.None || neighborColor === Player.Forbidden) {
        if (!countedLiberties.has(neighborKey)) {
          liberties++;
          countedLiberties.add(neighborKey);
        }
      } else if (neighborColor === color) {
        if (!visited.has(neighborKey)) {
          visited.add(neighborKey);
          queue.push(neighbor);
        }
      }
    }
  }

  return { stones: group, liberties };
};

export const resolveTurn = (
  currentBoard: BoardState,
  blackMove: Point | null,
  whiteMove: Point | null
): {
  newBoard: BoardState;
  blackCapturesDelta: number;
  whiteCapturesDelta: number;
  clashed: boolean;
  clashedPoint: Point | null;
} => {
  const nextBoard = currentBoard.map(row => [...row]);

  // Clear forbidden points
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (nextBoard[r][c] === Player.Forbidden) {
        nextBoard[r][c] = Player.None;
      }
    }
  }

  let clashed = false;
  let clashedPoint: Point | null = null;
  let blackCapturesDelta = 0;
  let whiteCapturesDelta = 0;

  // 1. Place stones
  if (blackMove && whiteMove) {
    if (blackMove.row === whiteMove.row && blackMove.col === whiteMove.col) {
      clashed = true;
      clashedPoint = blackMove;
      if (nextBoard[blackMove.row][blackMove.col] === Player.None) {
          nextBoard[blackMove.row][blackMove.col] = Player.Forbidden;
      }
    } else {
      if (nextBoard[blackMove.row][blackMove.col] === Player.None) nextBoard[blackMove.row][blackMove.col] = Player.Black;
      if (nextBoard[whiteMove.row][whiteMove.col] === Player.None) nextBoard[whiteMove.row][whiteMove.col] = Player.White;
    }
  } else if (blackMove) {
     if (nextBoard[blackMove.row][blackMove.col] === Player.None) nextBoard[blackMove.row][blackMove.col] = Player.Black;
  } else if (whiteMove) {
     if (nextBoard[whiteMove.row][whiteMove.col] === Player.None) nextBoard[whiteMove.row][whiteMove.col] = Player.White;
  }

  // 2. Resolve captures
  const deadGroups: Point[][] = [];
  const processedStones = new Set<string>();

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const color = nextBoard[r][c];
      if (color === Player.Black || color === Player.White) {
        const key = `${r},${c}`;
        if (processedStones.has(key)) continue;

        const groupInfo = getGroup(nextBoard, { row: r, col: c });
        groupInfo.stones.forEach(s => processedStones.add(`${s.row},${s.col}`));

        if (groupInfo.liberties === 0) deadGroups.push(groupInfo.stones);
      }
    }
  }

  deadGroups.forEach(group => {
    if (group.length > 0) {
      const first = group[0];
      const color = nextBoard[first.row][first.col];
      if (color === Player.Black) whiteCapturesDelta += group.length;
      else if (color === Player.White) blackCapturesDelta += group.length;

      group.forEach(p => nextBoard[p.row][p.col] = Player.None);
    }
  });

  return { newBoard: nextBoard, blackCapturesDelta, whiteCapturesDelta, clashed, clashedPoint };
};

/**
 * Advanced Territory Estimation
 * Uses Accumulation Model: Stones + Edge Projection + Radiation
 */
export const calculateTerritory = (board: BoardState): { 
    black: number, 
    white: number, 
    territoryMap: TerritoryMap 
} => {
    const SIZE = board.length;
    // We will accumulate float values. +ve for Black, -ve for White.
    const map: TerritoryMap = Array(SIZE).fill(0).map(() => Array(SIZE).fill(0));

    // --- 1. Base Stone Strength ---
    // Stones themselves are the strongest sources of territory.
    const stones: Point[] = [];
    const stoneStrengthMap = Array(SIZE).fill(0).map(() => Array(SIZE).fill(0));
    const processedGroups = new Set<string>();

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = board[r][c];
            if (cell === Player.Black || cell === Player.White) {
                stones.push({row:r, col:c});
                const val = (cell === Player.Black) ? 2.0 : -2.0;
                map[r][c] = val; // Set stone value

                // Calculate group strength for radiation
                if (!processedGroups.has(`${r},${c}`)) {
                     const { stones: groupStones } = getGroup(board, {row:r, col:c});
                     let strength = 0.5;
                     if (groupStones.length === 2) strength = 0.8;
                     else if (groupStones.length >= 3) strength = 1.0;
                     
                     groupStones.forEach(s => {
                         processedGroups.add(`${s.row},${s.col}`);
                         stoneStrengthMap[s.row][s.col] = strength;
                     });
                }
            }
        }
    }

    // --- 2. Edge Projection (Polygonal Skyline) ---
    // Projects influence from stones towards the edge.
    // Supports "Higher stones have less influence" and "Gradient decay".
    
    const SCAN_DEPTH = 6; // Check up to 6th line (indices 0-5)

    const applyEdgeInfluence = (color: Player, edgeType: number) => {
        const isBlack = color === Player.Black;
        const opponent = isBlack ? Player.White : Player.Black;
        
        // 1. Identify Boundary Stones
        // We filter stones that are within scan depth.
        // For Top Edge (0): stones with row < SCAN_DEPTH.
        const bandStones: Point[] = [];
        
        for (const s of stones) {
            if (board[s.row][s.col] !== color) continue;
            
            let depth = 0;
            if (edgeType === 0) depth = s.row;
            else if (edgeType === 1) depth = SIZE - 1 - s.row;
            else if (edgeType === 2) depth = s.col;
            else depth = SIZE - 1 - s.col;

            if (depth < SCAN_DEPTH) {
                bandStones.push(s);
            }
        }

        if (bandStones.length === 0) return;

        // Sort stones by the "parallel" coordinate (col for Top/Bottom edges)
        bandStones.sort((a, b) => {
             if (edgeType <= 1) return a.col - b.col;
             return a.row - b.row;
        });

        // Add virtual corners to close the shape at the ends
        const boundary = [...bandStones];
        const first = bandStones[0];
        const last = bandStones[bandStones.length - 1];

        // Helper to create point
        const mkPt = (d: number, p: number) => {
            if (edgeType === 0) return {row: d, col: p};
            if (edgeType === 1) return {row: SIZE-1-d, col: p};
            if (edgeType === 2) return {row: p, col: d};
            return {row: p, col: SIZE-1-d};
        };

        // Add virtual points at corners if the stones are somewhat close to them
        // "Parallel" coords for corners are 0 and SIZE-1.
        // "Depth" for corners is 0.
        const pFirst = (edgeType <= 1) ? first.col : first.row;
        const pLast = (edgeType <= 1) ? last.col : last.row;

        if (pFirst < SCAN_DEPTH * 2) boundary.unshift(mkPt(0, 0));
        if (pLast > SIZE - 1 - SCAN_DEPTH * 2) boundary.push(mkPt(0, SIZE - 1));

        // 2. Create Skyline (Interpolated Depth map)
        const skyline = new Array(SIZE).fill(-1);

        for (let i = 0; i < boundary.length - 1; i++) {
            const p1 = boundary[i];
            const p2 = boundary[i+1];

            // Extract Parallel (x) and Depth (y) relative to edge
            let x1, y1, x2, y2;
            if (edgeType === 0) { x1=p1.col; y1=p1.row; x2=p2.col; y2=p2.row; }
            else if (edgeType === 1) { x1=p1.col; y1=SIZE-1-p1.row; x2=p2.col; y2=SIZE-1-p2.row; }
            else if (edgeType === 2) { x1=p1.row; y1=p1.col; x2=p2.row; y2=p2.col; }
            else { x1=p1.row; y1=SIZE-1-p1.col; x2=p2.row; y2=SIZE-1-p2.col; }

            const dx = x2 - x1;
            const steps = Math.abs(dx);
            if (steps === 0) continue;

            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const x = Math.round(x1 + dx * t);
                const y = y1 + (y2 - y1) * t;
                if (x >= 0 && x < SIZE) {
                    skyline[x] = Math.max(skyline[x], y); // Keep max depth (outer hull)
                }
            }
        }

        // 3. Fill Area under Skyline
        for (let p = 0; p < SIZE; p++) {
            const limit = skyline[p];
            if (limit <= 0) continue;

            // Fill from edge (d=0) up to limit
            const maxD = Math.floor(limit);
            
            // Calculate base strength based on how far the stone is (the limit)
            // Limit 0-2 (Lines 1-3): Strong (1.0)
            // Limit 3 (Line 4): 0.9
            // Limit 4+ (Line 5+): Decays rapidly
            let baseStrength = 1.0;
            if (limit > 2) {
                baseStrength = Math.max(0.4, 1.0 - (limit - 2) * 0.2); 
            }

            for (let d = 0; d <= maxD; d++) {
                let r, c;
                if (edgeType === 0) { r = d; c = p; }
                else if (edgeType === 1) { r = SIZE-1-d; c = p; }
                else if (edgeType === 2) { r = p; c = d; }
                else { r = p; c = SIZE-1-d; }

                if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;

                // Stop if we hit an opponent stone (Shadow casting)
                if (board[r][c] === opponent) break;

                // Do not apply to self stones (already handled)
                if (board[r][c] === color) continue;

                // Gradient Logic: "Further from stone = smaller square"
                // d is distance from edge. limit is position of stone.
                // Distance from stone = (limit - d).
                // We want value to be higher when close to stone (d near limit), lower at edge (d=0)?
                // User said: "Off-board edge to stone... territory".
                // Usually "smaller further from stone".
                // Let's implement linear falloff from stone to edge.
                // At d ~= limit (near stone): Val = baseStrength.
                // At d = 0 (edge): Val = baseStrength * 0.5.
                
                const proximityToStone = d / (limit || 1); // 0 at edge, 1 at stone
                const gradient = 0.4 + 0.6 * proximityToStone; 
                
                const finalVal = baseStrength * gradient;
                
                // Accumulate influence
                // We add to existing value.
                if (isBlack) map[r][c] += finalVal;
                else map[r][c] -= finalVal;
            }
        }
    };

    [Player.Black, Player.White].forEach(p => {
        for(let e=0; e<4; e++) applyEdgeInfluence(p, e);
    });


    // --- 3. Radiation (Open Influence) ---
    // Standard decay from stones
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            // Optimization: Skip if we are far from any stone? 
            // We just iterate stones instead of board points.
        }
    }
    
    // Better Radiation Loop: Iterate stones and project outwards
    for (const s of stones) {
        const color = board[s.row][s.col];
        const valSign = (color === Player.Black) ? 1 : -1;
        const strength = stoneStrengthMap[s.row][s.col];

        const RADIUS = 3;
        const rMin = Math.max(0, s.row - RADIUS);
        const rMax = Math.min(SIZE - 1, s.row + RADIUS);
        const cMin = Math.max(0, s.col - RADIUS);
        const cMax = Math.min(SIZE - 1, s.col + RADIUS);

        for (let nr = rMin; nr <= rMax; nr++) {
            for (let nc = cMin; nc <= cMax; nc++) {
                if (nr === s.row && nc === s.col) continue;

                const dist = Math.max(Math.abs(nr - s.row), Math.abs(nc - s.col)); // Chebyshev
                
                // Decay
                let decay = 0;
                if (dist === 1) decay = 0.5; // Reduced because we are accumulating
                else if (dist === 2) decay = 0.25;
                else if (dist === 3) decay = 0.1;

                if (decay > 0) {
                     map[nr][nc] += (valSign * strength * decay);
                }
            }
        }
    }

    // --- 4. Closed Territory Override ---
    // If a region is completely enclosed by one color, it's solid territory (1.0).
    const visitedEmpty = new Set<string>();
    
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] !== Player.None && board[r][c] !== Player.Forbidden) continue;
            if (visitedEmpty.has(`${r},${c}`)) continue;

            const region: Point[] = [];
            const queue: Point[] = [{row: r, col: c}];
            visitedEmpty.add(`${r},${c}`);
            
            let touchesBlack = false;
            let touchesWhite = false;

            while(queue.length > 0) {
                const cur = queue.shift()!;
                region.push(cur);

                const nbrs = getNeighbors(cur);
                for(const n of nbrs) {
                    const nVal = board[n.row][n.col];
                    if (nVal === Player.Black) touchesBlack = true;
                    else if (nVal === Player.White) touchesWhite = true;
                    else if ((nVal === Player.None || nVal === Player.Forbidden) && !visitedEmpty.has(`${n.row},${n.col}`)) {
                        visitedEmpty.add(`${n.row},${n.col}`);
                        queue.push(n);
                    }
                }
            }

            if (touchesBlack && !touchesWhite) {
                // Boost to >= 1.0 if not already
                region.forEach(p => {
                    if (map[p.row][p.col] < 1.0) map[p.row][p.col] = 1.0;
                });
            } else if (touchesWhite && !touchesBlack) {
                region.forEach(p => {
                    if (map[p.row][p.col] > -1.0) map[p.row][p.col] = -1.0;
                });
            }
        }
    }

    // --- 5. Scoring ---
    let blackScore = 0;
    let whiteScore = 0;
    const THRESHOLD = 0.2; // Minimum influence to count as points

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            // Clamp map values for display sanity (optional, but good for rendering)
            // map[r][c] = Math.max(-1.5, Math.min(1.5, map[r][c]));

            const val = map[r][c];
            
            if (board[r][c] === Player.Black) {
                blackScore += 1;
            } else if (board[r][c] === Player.White) {
                whiteScore += 1;
            } else {
                // Empty point
                if (val > THRESHOLD) {
                    // Cap contribution at 1.0
                    blackScore += Math.min(1.0, val);
                } else if (val < -THRESHOLD) {
                    whiteScore += Math.min(1.0, Math.abs(val));
                }
            }
        }
    }

    return { 
        black: Math.round(blackScore * 10) / 10, 
        white: Math.round(whiteScore * 10) / 10, 
        territoryMap: map 
    };
}

export const calculateScore = (board: BoardState): { black: number, white: number } => {
    const { black, white } = calculateTerritory(board);
    return { black, white };
}
