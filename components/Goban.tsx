import React, { useMemo } from 'react';
import { BoardState, Player, Point, TerritoryMap } from '../types';
import { BOARD_SIZE } from '../constants';

interface GobanProps {
  board: BoardState;
  onCellClick: (p: Point) => void;
  tempMarker: Point | null;
  isInteractive: boolean;
  currentPlayer: Player;
  territoryMap?: TerritoryMap | null;
  lastMove?: { black: Point | null; white: Point | null } | null;
}

const Goban: React.FC<GobanProps> = ({ board, onCellClick, tempMarker, isInteractive, currentPlayer, territoryMap, lastMove }) => {

  const gridLinesSVG = useMemo(() => {
    const cellSize = 100 / BOARD_SIZE;
    const offset = cellSize / 2;
    const lines: React.ReactNode[] = [];

    for (let i = 0; i < BOARD_SIZE; i++) {
      const pos = i * cellSize + offset;
      lines.push(
        <line
          key={`v-${i}`}
          x1={`${pos}%`}
          y1={`${offset}%`}
          x2={`${pos}%`}
          y2={`${100 - offset}%`}
          stroke="#1c1917"
          strokeWidth="0.3"
        />
      );
      lines.push(
        <line
          key={`h-${i}`}
          x1={`${offset}%`}
          y1={`${pos}%`}
          x2={`${100 - offset}%`}
          y2={`${pos}%`}
          stroke="#1c1917"
          strokeWidth="0.3"
        />
      );
    }
    return lines;
  }, []);

  const starPointsSVG = useMemo(() => {
    const points: React.ReactNode[] = [];
    const coords = BOARD_SIZE === 19 ? [3, 9, 15] : BOARD_SIZE === 13 ? [3, 9] : [4];
    const cellSize = 100 / BOARD_SIZE;
    const offset = cellSize / 2;

    for (const r of coords) {
      for (const c of coords) {
        points.push(
          <circle
            key={`star-${r}-${c}`}
            cx={`${c * cellSize + offset}%`}
            cy={`${r * cellSize + offset}%`}
            r="0.8"
            fill="#1c1917"
          />
        );
      }
    }
    return points;
  }, []);

  return (
    <div className="relative aspect-square w-full h-full bg-[#eecfa1] shadow-xl rounded-sm p-1 sm:p-1 select-none">
      <div className="relative w-full h-full">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-0"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {gridLinesSVG}
          {starPointsSVG}
        </svg>

        <div
          className="absolute inset-0 z-10 grid"
          style={{
            gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`,
          }}
        >
          {board.map((row, r) => (
            row.map((cell, c) => {
              const isForbidden = cell === Player.Forbidden;
              const isBlack = cell === Player.Black;
              const isWhite = cell === Player.White;
              const isTemp = tempMarker?.row === r && tempMarker?.col === c;
              const isLastBlack = lastMove?.black?.row === r && lastMove?.black?.col === c;
              const isLastWhite = lastMove?.white?.row === r && lastMove?.white?.col === c;

              const territoryVal = territoryMap ? territoryMap[r][c] : 0;
              const absVal = Math.abs(territoryVal);
              // Threshold for display
              const hasTerritory = absVal > 0.15 && cell === Player.None;

              // Dynamic Size Calculation
              // 1.0 -> 40% size (Solid)
              // 0.2 -> 15% size (Weak)
              const sizePercent = Math.min(45, 10 + 35 * Math.min(1.0, absVal));
              const opacity = Math.min(0.9, 0.3 + 0.6 * Math.min(1.0, absVal));

              const canClick = isInteractive && cell === Player.None;

              return (
                <div
                  key={`${r}-${c}`}
                  className={`relative flex items-center justify-center ${canClick ? 'cursor-pointer group' : ''}`}
                  onClick={() => canClick && onCellClick({ row: r, col: c })}
                >
                  {canClick && !isTemp && (
                    <div 
                      className={`w-[90%] h-[90%] rounded-full opacity-0 group-hover:opacity-40 ${currentPlayer === Player.Black ? 'bg-black' : 'bg-white border border-stone-300'}`}
                    />
                  )}

                  {/* Territory Marker */}
                  {hasTerritory && (
                    <div
                      className={`absolute transition-all duration-300 ${territoryVal > 0
                          ? 'bg-black'
                          : 'bg-white border border-stone-300'
                        }`}
                      style={{
                        width: `${sizePercent}%`,
                        height: `${sizePercent}%`,
                        opacity: opacity
                      }}
                    />
                  )}

                  {isBlack && (
                    <div className="w-[90%] h-[90%] rounded-full bg-black shadow-[2px_2px_4px_rgba(0,0,0,0.5)] bg-[radial-gradient(circle_at_30%_30%,#555,#000)] relative">
                      {isLastBlack && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-[30%] h-[30%] rounded-full bg-white/80" />
                        </div>
                      )}
                    </div>
                  )}
                  {isWhite && (
                    <div className="w-[90%] h-[90%] rounded-full bg-white shadow-[2px_2px_4px_rgba(0,0,0,0.4)] bg-[radial-gradient(circle_at_30%_30%,#fff,#ddd)] relative">
                      {isLastWhite && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-[30%] h-[30%] rounded-full bg-black/70" />
                        </div>
                      )}
                    </div>
                  )}

                  {isTemp && !isBlack && !isWhite && (
                    <div
                      className={`w-[90%] h-[90%] rounded-full opacity-60 shadow-sm ${currentPlayer === Player.Black ? 'bg-black' : 'bg-white'}`}
                    />
                  )}

                  {isForbidden && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" className="w-[80%] h-[80%] text-red-700 opacity-80" stroke="currentColor" strokeWidth="2">
                        <line x1="4" y1="4" x2="20" y2="20" />
                        <line x1="20" y1="4" x2="4" y2="20" />
                      </svg>
                    </div>
                  )}
                </div>
              );
            })
          ))}
        </div>
      </div>
    </div>
  );
};

export default Goban;
