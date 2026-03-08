export enum Player {
  None = 0,
  Black = 1,
  White = 2,
  Forbidden = 3, // Special state for clashed moves
}

export type BoardState = Player[][];
export type TerritoryMap = number[][]; // >0 for Black, <0 for White, value = strength

export interface Point {
  row: number;
  col: number;
}

export enum GamePhase {
  BlackInput = 'BLACK_INPUT',
  Intermission = 'INTERMISSION',
  WhiteInput = 'WHITE_INPUT',
  Resolution = 'RESOLUTION',
  GameOver = 'GAME_OVER',
}

export interface GameStats {
  blackCaptures: number;
  whiteCaptures: number;
  turn: number;
}

export interface MoveRecord {
  turn: number;
  black: Point | null;
  white: Point | null;
}

// --- Networking Types ---

export enum NetworkRole {
    None = 'NONE',
    Host = 'HOST',
    Client = 'CLIENT'
}

export type NetworkPacket = 
    | { type: 'HELLO'; role: NetworkRole }
    | { type: 'MOVE'; move: Point | null }
    | { type: 'SYNC'; board: BoardState; captures: {black:number, white:number}; turn: number; history: MoveRecord[]; lastClash: Point | null }
    | { type: 'RESTART' };
