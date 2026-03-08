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
}

const Goban: React.FC<GobanProps> = ({ board, onCellClick, tempMarker, isInteractive, currentPlayer, territoryMap }) => {
  
  const gridLines = useMemo(() => {
    const lines = [];
    const step = 100 / BOARD_SIZE;
    const offset = step / 2;

    for (let i = 0; i < BOARD_SIZE; i++) {
      lines.push(
        <div 
          key={`v-${i}`} 
          className="absolute bg-stone-900 pointer-events-none"
          style={{
            left: `${i * step + offset}%`,
            top: `${offset}%`,
            bottom: `${offset}%`,
            width: '1px',
          }}
        />
      );
    }
    for (let i = 0; i < BOARD_SIZE; i++) {
      lines.push(
        <div 
          key={`h-${i}`} 
          className="absolute bg-stone-900 pointer-events-none"
          style={{
            top: `${i * step + offset}%`,
            left: `${offset}%`,
            right: `${offset}%`,
            height: '1px',
          }}
        />
      );
    }
    return lines;
  }, []);

  const starPoints = useMemo(() => {
    const points = [];
    const coords = BOARD_SIZE === 19 ? [3, 9, 15] : BOARD_SIZE === 13 ? [3, 9] : [4];
    const step = 100 / BOARD_SIZE;
    const offset = step / 2;

    for (const r of coords) {
      for (const c of coords) {
        points.push(
            <div
                key={`star-${r}-${c}`}
                className="absolute bg-stone-900 rounded-full -translate-x-1/2 -translate-y-1/2"
                style={{
                    left: `${c * step + offset}%`,
                    top: `${r * step + offset}%`,
                    width: '4px',
                    height: '4px',
                }}
            />
        )
      }
    }
    return points;
  }, []);

  return (
    <div className="relative aspect-square w-full max-w-[600px] bg-[#eecfa1] shadow-xl rounded-sm p-2 sm:p-4 select-none">
      <div className="relative w-full h-full">
        <div className="absolute inset-0 z-0">
          {gridLines}
          {starPoints}
        </div>

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
                            className={`relative flex items-center justify-center cursor-pointer`}
                            onClick={() => canClick && onCellClick({row: r, col: c})}
                        >
                            {canClick && !isTemp && (
                                <div className="hidden hover:block w-[40%] h-[40%] rounded-full bg-stone-900/10" />
                            )}

                            {/* Territory Marker */}
                            {hasTerritory && (
                                <div 
                                    className={`absolute transition-all duration-300 ${
                                        territoryVal > 0 
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
                                <div className="w-[90%] h-[90%] rounded-full bg-black shadow-[2px_2px_4px_rgba(0,0,0,0.5)] bg-[radial-gradient(circle_at_30%_30%,#555,#000)]" />
                            )}
                            {isWhite && (
                                <div className="w-[90%] h-[90%] rounded-full bg-white shadow-[2px_2px_4px_rgba(0,0,0,0.4)] bg-[radial-gradient(circle_at_30%_30%,#fff,#ddd)]" />
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
