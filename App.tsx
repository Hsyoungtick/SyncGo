import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Player, BoardState, GamePhase, Point, TerritoryMap, MoveRecord, NetworkRole } from './types';
import { createEmptyBoard, resolveTurn, calculateTerritory } from './utils/gameLogic';
import Goban from './components/Goban';
import { RotateCcw, EyeOff, Play, ChartBar, X, Check, Download, Upload, Wifi, Copy, Link, Flag, XCircle, WifiOff, Zap } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const SOCKET_SERVER = `http://${window.location.hostname}:3001`;

const App: React.FC = () => {
  // Game State
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [phase, setPhase] = useState<GamePhase>(GamePhase.BlackInput);
  const [turnCount, setTurnCount] = useState<number>(0);
  const [captures, setCaptures] = useState({ black: 0, white: 0 });
  const [history, setHistory] = useState<MoveRecord[]>([]);

  // Selection State
  const [blackSelection, setBlackSelection] = useState<Point | null>(null);
  const [whiteSelection, setWhiteSelection] = useState<Point | null>(null);

  // UI State
  const [lastClash, setLastClash] = useState<Point | null>(null);
  const [scores, setScores] = useState<{ black: number, white: number } | null>(null);

  // Estimation State
  const [showEstimation, setShowEstimation] = useState(false);
  const [territoryMap, setTerritoryMap] = useState<TerritoryMap | null>(null);
  const [estimatedScore, setEstimatedScore] = useState<{ black: number, white: number } | null>(null);

  // --- Network State ---
  const [netRole, setNetRole] = useState<NetworkRole>(NetworkRole.None);
  const [roomId, setRoomId] = useState<string>('');
  const [connStatus, setConnStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'WAITING'>('DISCONNECTED');
  const [joinInputId, setJoinInputId] = useState('');
  const [myMoveCommitted, setMyMoveCommitted] = useState(false);
  const [opponentCommitted, setOpponentCommitted] = useState(false);
  const [endGameRequested, setEndGameRequested] = useState(false);
  const [opponentEndGameRequested, setOpponentEndGameRequested] = useState(false);
  const [selectedCreateRole, setSelectedCreateRole] = useState<'black' | 'white'>('black');
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [reconnectCountdown, setReconnectCountdown] = useState(60);
  const [quickMode, setQuickMode] = useState(() => localStorage.getItem('quickMode') === 'true');

  // Socket ref
  const socketRef = useRef<Socket | null>(null);

  // Save quickMode to localStorage
  useEffect(() => {
    localStorage.setItem('quickMode', String(quickMode));
  }, [quickMode]);

  // Refs to access latest state in callbacks
  const movesRef = useRef<{ black: Point | null, white: Point | null }>({ black: null, white: null });
  const boardRef = useRef(board);
  const turnCountRef = useRef(turnCount);
  const capturesRef = useRef(captures);
  const historyRef = useRef(history);
  const netRoleRef = useRef(netRole);

  useEffect(() => {
    movesRef.current = { black: blackSelection, white: whiteSelection };
  }, [blackSelection, whiteSelection]);
  useEffect(() => { boardRef.current = board; }, [board]);
  useEffect(() => { turnCountRef.current = turnCount; }, [turnCount]);
  useEffect(() => { capturesRef.current = captures; }, [captures]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { netRoleRef.current = netRole; }, [netRole]);

  // --- Update estimation when board changes ---
  useEffect(() => {
    if (showEstimation) {
      const { black, white, territoryMap } = calculateTerritory(board);
      setTerritoryMap(territoryMap);
      setEstimatedScore({ black, white });
    }
  }, [board, showEstimation]);

  // --- URL Room Detection & Auto Join ---
  useEffect(() => {
    const path = window.location.pathname;
    const roomIdFromPath = path.slice(1).toUpperCase();

    if (roomIdFromPath && roomIdFromPath.length === 6 && /^[A-Z0-9]+$/.test(roomIdFromPath)) {
      setJoinInputId(roomIdFromPath);
    }
  }, []);

  // --- Auto Join from URL ---
  useEffect(() => {
    if (joinInputId && joinInputId.length === 6 && /^[A-Z0-9]+$/.test(joinInputId) && netRole === NetworkRole.None && connStatus === 'DISCONNECTED') {
      const socket = connectSocket();
      setConnStatus('CONNECTING');

      socket.emit('join-room', joinInputId, (response: { roomId?: string; role?: string; error?: string; reconnected?: boolean; hasOpponent?: boolean }) => {
        if (response.error) {
          console.log('[Socket] 自动加入房间失败:', response.error);
          setConnStatus('DISCONNECTED');
          setJoinInputId('');
          window.history.pushState({}, '', '/');
          return;
        }
        console.log('[Socket] 自动加入房间成功', response);
        setRoomId(response.roomId!);
        setNetRole(response.role === 'black' ? NetworkRole.Host : NetworkRole.Client);
        setConnStatus(response.reconnected || response.hasOpponent ? 'CONNECTED' : 'WAITING');

        window.history.pushState({}, '', `/${response.roomId}`);

        if (response.reconnected) {
          socket.emit('request-sync');
        }
      });
    }
  }, [joinInputId, netRole, connStatus]);

  // --- Socket.io Connection ---
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return socketRef.current;

    const socket = io(SOCKET_SERVER, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('[Socket] 已连接到服务器');
    });

    socket.on('disconnect', () => {
      console.log('[Socket] 已断开连接');
      setConnStatus('DISCONNECTED');
      setNetRole(NetworkRole.None);
      setRoomId('');
      setJoinInputId('');
      setOpponentDisconnected(false);
      setReconnectCountdown(60);
      window.history.pushState({}, '', '/');
    });

    socket.on('player-joined', () => {
      console.log('[Socket] 对手已加入');
      setConnStatus('CONNECTED');
    });

    socket.on('opponent-committed', () => {
      console.log('[Socket] 对手已确认落子');
      setOpponentCommitted(true);
    });

    socket.on('opponent-cancelled-move', () => {
      console.log('[Socket] 对手撤销了落子');
      setOpponentCommitted(false);
    });

    socket.on('resolve-turn', (data: { blackMove: Point | null; whiteMove: Point | null }) => {
      console.log('[Socket] 收到结算指令', data);
      performResolution(data.blackMove, data.whiteMove);
    });

    socket.on('full-sync', (gameState: any) => {
      console.log('[Socket] 收到完整同步');
      if (gameState) {
        setBoard(gameState.board);
        setCaptures(gameState.captures);
        setTurnCount(gameState.turn);
        setHistory(gameState.history);
        setLastClash(gameState.lastClash);
        setPhase(GamePhase.WhiteInput);
        setBlackSelection(null);
        setWhiteSelection(null);
        setMyMoveCommitted(false);
        setOpponentCommitted(false);
      }
    });

    socket.on('game-restarted', () => {
      console.log('[Socket] 游戏已重置');
      resetGameLocal();
    });

    socket.on('opponent-disconnected', (data: { canReconnect: boolean }) => {
      console.log('[Socket] 对手已断开', data);
      if (data.canReconnect) {
        setOpponentDisconnected(true);
        setReconnectCountdown(60);
      } else {
        setConnStatus('DISCONNECTED');
        setNetRole(NetworkRole.None);
        setRoomId('');
        resetGameLocal();
      }
    });

    socket.on('opponent-reconnected', () => {
      console.log('[Socket] 对手已重连');
      setOpponentDisconnected(false);
      setReconnectCountdown(60);
    });

    socket.on('opponent-reconnect-timeout', () => {
      console.log('[Socket] 等待重连超时');
      setConnStatus('DISCONNECTED');
      setNetRole(NetworkRole.None);
      setRoomId('');
      setJoinInputId('');
      setOpponentDisconnected(false);
      resetGameLocal();
      window.history.pushState({}, '', '/');
    });

    socket.on('opponent-requested-end', () => {
      console.log('[Socket] 对手请求结束游戏');
      setOpponentEndGameRequested(true);
    });

    socket.on('end-game-cancelled', () => {
      console.log('[Socket] 结束游戏请求已取消');
      setOpponentEndGameRequested(false);
      setEndGameRequested(false);
    });

    socket.on('end-game-rejected', () => {
      console.log('[Socket] 结束游戏请求被拒绝');
      alert('对方拒绝了结束游戏请求');
      setEndGameRequested(false);
    });

    socket.on('game-ended', (data: { gameState?: { board: BoardState; captures: { black: number; white: number } } }) => {
      console.log('[Socket] 游戏结束');
      const boardToUse = data.gameState?.board || boardRef.current;
      const { black, white } = calculateTerritory(boardToUse);
      setScores({ black, white });
      setPhase(GamePhase.GameOver);
    });

    socketRef.current = socket;
    return socket;
  }, []);

  const createRoom = useCallback((role: 'black' | 'white' = 'black') => {
    const socket = connectSocket();
    setConnStatus('CONNECTING');

    socket.emit('create-room', { role }, (response: { roomId: string; role: string }) => {
      console.log('[Socket] 创建房间成功', response);
      setRoomId(response.roomId);
      setNetRole(response.role === 'black' ? NetworkRole.Host : NetworkRole.Client);
      setConnStatus('WAITING');
      copyRoomId(response.roomId);

      window.history.pushState({}, '', `/${response.roomId}`);
    });
  }, [connectSocket]);

  const performResolution = useCallback((blackMove: Point | null, whiteMove: Point | null) => {
    setPhase(GamePhase.Resolution);

    setTimeout(() => {
      // Use refs to get latest state values
      const currentBoard = boardRef.current;
      const currentTurnCount = turnCountRef.current;
      const currentCaptures = capturesRef.current;
      const currentHistory = historyRef.current;
      const currentNetRole = netRoleRef.current;

      const { newBoard, blackCapturesDelta, whiteCapturesDelta, clashed, clashedPoint } = resolveTurn(currentBoard, blackMove, whiteMove);

      setBoard(newBoard);
      const newCaptures = {
        black: currentCaptures.black + blackCapturesDelta,
        white: currentCaptures.white + whiteCapturesDelta
      };
      setCaptures(newCaptures);

      const newHistory = [...currentHistory, {
        turn: currentTurnCount,
        black: blackMove,
        white: whiteMove
      }];
      setHistory(newHistory);
      setLastClash(clashed ? clashedPoint : null);

      setTurnCount(prev => prev + 1);
      setPhase(GamePhase.BlackInput);
      setBlackSelection(null);
      setWhiteSelection(null);
      setMyMoveCommitted(false);
      setOpponentCommitted(false);

      if (currentNetRole === NetworkRole.Host) {
        socketRef.current?.emit('sync-state', {
          board: newBoard,
          captures: newCaptures,
          turn: currentTurnCount + 1,
          history: newHistory,
          lastClash: clashed ? clashedPoint : null
        });
      }
    }, 500);
  }, []);

  // --- Reconnect Countdown ---
  useEffect(() => {
    if (!opponentDisconnected) return;
    
    const timer = setInterval(() => {
      setReconnectCountdown(prev => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [opponentDisconnected]);

  // --- Game Logic ---

  const resetGameLocal = () => {
    setBoard(createEmptyBoard());
    setPhase(GamePhase.BlackInput);
    setTurnCount(1);
    setCaptures({ black: 0, white: 0 });
    setHistory([]);
    setBlackSelection(null);
    setWhiteSelection(null);
    setLastClash(null);
    setScores(null);
    setShowEstimation(false);
    setTerritoryMap(null);
    setEstimatedScore(null);
    setMyMoveCommitted(false);
    setOpponentCommitted(false);
    setEndGameRequested(false);
    setOpponentEndGameRequested(false);
  };

  const resetGame = () => {
    resetGameLocal();
    if (netRole !== NetworkRole.None && socketRef.current) {
      socketRef.current.emit('restart-game');
    }
  };

  const handleCellClick = (p: Point) => {
    if (phase === GamePhase.Resolution || phase === GamePhase.GameOver) return;
    if (netRole !== NetworkRole.None && myMoveCommitted) return;

    if (netRole === NetworkRole.None) {
      if (phase === GamePhase.BlackInput) {
        if (!quickMode && blackSelection?.row === p.row && blackSelection?.col === p.col) {
          setBlackSelection(null);
        } else {
          setBlackSelection(p);
          if (quickMode) {
            setPhase(GamePhase.Intermission);
          }
        }
      } else if (phase === GamePhase.WhiteInput) {
        if (!quickMode && whiteSelection?.row === p.row && whiteSelection?.col === p.col) {
          setWhiteSelection(null);
        } else {
          setWhiteSelection(p);
          if (quickMode) {
            setPhase(GamePhase.Resolution);
          }
        }
      }
    } else if (netRole === NetworkRole.Host) {
      if (!quickMode && blackSelection?.row === p.row && blackSelection?.col === p.col) {
        setBlackSelection(null);
      } else {
        setBlackSelection(p);
        if (quickMode && socketRef.current) {
          setMyMoveCommitted(true);
          socketRef.current.emit('commit-move', { move: p });
        }
      }
    } else if (netRole === NetworkRole.Client) {
      if (!quickMode && whiteSelection?.row === p.row && whiteSelection?.col === p.col) {
        setWhiteSelection(null);
      } else {
        setWhiteSelection(p);
        if (quickMode && socketRef.current) {
          setMyMoveCommitted(true);
          socketRef.current.emit('commit-move', { move: p });
        }
      }
    }
  };

  const toggleEstimation = () => {
    if (showEstimation) {
      setShowEstimation(false);
      setTerritoryMap(null);
      setEstimatedScore(null);
    } else {
      const { black, white, territoryMap } = calculateTerritory(board);
      setShowEstimation(true);
      setTerritoryMap(territoryMap);
      setEstimatedScore({ black, white });
    }
  };

  const confirmSelection = () => {
    if (netRole !== NetworkRole.None && socketRef.current) {
      setMyMoveCommitted(true);
      const move = netRole === NetworkRole.Host ? blackSelection : whiteSelection;
      socketRef.current.emit('commit-move', { move });
      return;
    }

    if (phase === GamePhase.BlackInput) {
      setPhase(GamePhase.Intermission);
    } else if (phase === GamePhase.WhiteInput) {
      setPhase(GamePhase.Resolution);
    }
  };

  const cancelMove = () => {
    if (netRole !== NetworkRole.None && socketRef.current && myMoveCommitted && !opponentCommitted) {
      setMyMoveCommitted(false);
      socketRef.current.emit('cancel-move');
    }
  };

  const proceedFromIntermission = () => {
    setPhase(GamePhase.WhiteInput);
  };

  // Resolution Effect (Local Only)
  useEffect(() => {
    if (netRole === NetworkRole.None && phase === GamePhase.Resolution) {
      const timer = setTimeout(() => {
        const { black, white } = movesRef.current;
        const { newBoard, blackCapturesDelta, whiteCapturesDelta, clashed, clashedPoint } = resolveTurn(board, black, white);

        setBoard(newBoard);
        setCaptures(prev => ({
          black: prev.black + blackCapturesDelta,
          white: prev.white + whiteCapturesDelta
        }));

        setHistory(prev => [...prev, {
          turn: turnCount,
          black: black,
          white: white
        }]);

        setLastClash(clashed ? clashedPoint : null);
        setBlackSelection(null);
        setWhiteSelection(null);
        setTurnCount(prev => prev + 1);
        setPhase(GamePhase.BlackInput);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [phase, netRole, board, turnCount]);

  const endGame = () => {
    if (netRole !== NetworkRole.None) {
      if (endGameRequested) {
        return;
      }
      setEndGameRequested(true);
      socketRef.current?.emit('request-end-game', {
        board: board,
        captures: captures,
        turn: turnCount,
        history: history,
        lastClash: null
      });
      return;
    }
    const { black, white } = calculateTerritory(board);
    setScores({ black, white });
    setPhase(GamePhase.GameOver);
  };

  // --- Save / Load Logic ---
  const saveGame = () => {
    const data = { date: new Date().toISOString(), history: history };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synchro-go-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const loadGame = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        if (Array.isArray(data.history)) {
          replayGame(data.history);
        } else {
          alert("文件格式不正确");
        }
      } catch (err) {
        console.error("Failed to load game", err);
        alert("无法读取棋谱文件");
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const replayGame = (moves: MoveRecord[]) => {
    let currentBoard = createEmptyBoard();
    let bCaps = 0;
    let wCaps = 0;
    moves.forEach(move => {
      const result = resolveTurn(currentBoard, move.black, move.white);
      currentBoard = result.newBoard;
      bCaps += result.blackCapturesDelta;
      wCaps += result.whiteCapturesDelta;
    });
    setBoard(currentBoard);
    setCaptures({ black: bCaps, white: wCaps });
    setTurnCount(moves.length + 1);
    setHistory(moves);
    setPhase(GamePhase.BlackInput);
    setBlackSelection(null);
    setWhiteSelection(null);
    setLastClash(null);
    setScores(null);
setShowEstimation(false);
    setTerritoryMap(null);
    setEstimatedScore(null);
  };

  const copyRoomId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = id;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (e) {
        alert('复制失败，请手动复制: ' + id);
      }
      document.body.removeChild(textArea);
    }
  };

  const getPhaseMessage = () => {
    if (opponentDisconnected) {
      return `对方掉线...${reconnectCountdown}秒`;
    }
    
    if (netRole !== NetworkRole.None) {
      if (phase === GamePhase.GameOver) return "游戏结束";
      if (myMoveCommitted && opponentCommitted) return "正在结算...";
      if (myMoveCommitted) return "已确认，等待对方...";
      if (opponentCommitted) return "对方已确认，请落子";
      if (netRole === NetworkRole.Host) return "黑方请落子";
      if (netRole === NetworkRole.Client) return "白方请落子";
    }

    switch (phase) {
      case GamePhase.BlackInput: return "黑方请落子";
      case GamePhase.Intermission: return "请将设备移交给白方";
      case GamePhase.WhiteInput: return "白方请落子";
      case GamePhase.Resolution: return "正在结算双方走子...";
      case GamePhase.GameOver: return "游戏结束";
      default: return "";
    }
  };

  const getScoreDiff = (b: number, w: number) => {
    const diff = Math.abs(b - w).toFixed(1);
    if (b > w) return `黑胜 ${diff}`;
    if (w > b) return `白胜 ${diff}`;
    return "平局";
  };

  const isInteractive = () => {
    if (phase === GamePhase.Resolution || phase === GamePhase.GameOver) return false;
    if (netRole === NetworkRole.None) {
      return phase === GamePhase.BlackInput || phase === GamePhase.WhiteInput;
    }
    return !myMoveCommitted;
  };

  const getDisplayPlayer = () => {
    if (netRole === NetworkRole.Host) return Player.Black;
    if (netRole === NetworkRole.Client) return Player.White;
    return phase === GamePhase.BlackInput ? Player.Black : Player.White;
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 font-sans flex flex-col">

      {/* Main Game Area */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="flex items-center justify-center gap-4 w-full max-w-[1200px]">
          {/* Left Panel - Info & Network */}
          <div className="hidden md:flex flex-col gap-3 w-48 shrink-0 items-end">
          {/* Game Info */}
          <div className="bg-white rounded-xl shadow-lg p-4 border border-stone-200 w-full">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-stone-900"></div>
                <span className="text-sm font-medium">黑方提子</span>
              </div>
              <span className="text-lg font-bold">{captures.black}</span>
            </div>
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-white border-2 border-stone-300"></div>
                <span className="text-sm font-medium">白方提子</span>
              </div>
              <span className="text-lg font-bold">{captures.white}</span>
            </div>
            <div className="border-t border-stone-200 pt-3 mt-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-stone-500">回合</span>
                <span className="text-lg font-bold">{turnCount}</span>
              </div>
            </div>
          </div>

          {/* Network Status */}
          {netRole !== NetworkRole.None && (
            <div className="bg-white rounded-xl shadow-lg p-4 border border-stone-200 w-full">
              <div className="flex items-center gap-2 mb-2">
                <Wifi size={18} className={
                  connStatus === 'CONNECTED' ? 'text-green-600' :
                    connStatus === 'WAITING' ? 'text-amber-600' : 'text-red-600'
                } />
                <span className={`text-sm px-2 py-0.5 rounded ${connStatus === 'CONNECTED' ? 'bg-green-100 text-green-700' :
                    connStatus === 'WAITING' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                  }`}>
                  {connStatus === 'CONNECTED' ? '已连接' :
                    connStatus === 'WAITING' ? '等待对手' : '断开连接'}
                </span>
              </div>
              {roomId && (
                <div className="mt-2 text-lg text-stone-500 text-center flex items-center justify-center gap-1">
                   <span className="font-mono font-bold">{roomId}</span>
                  <button
                    onClick={() => copyRoomId(roomId)}
                    className="p-1 hover:bg-stone-200 rounded transition-colors"
                    title="复制房间号"
                  >
                    <Copy size={18} />
                  </button>
                </div>
              )}
              <button
                onClick={() => {
                  socketRef.current?.disconnect();
                  setNetRole(NetworkRole.None);
                  setRoomId('');
                  setConnStatus('DISCONNECTED');
                  setJoinInputId('');
                  setOpponentDisconnected(false);
                  setReconnectCountdown(60);
                  resetGameLocal();
                  window.history.pushState({}, '', '/');
                }}
                className="w-full mt-2 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
              >
                退出房间
              </button>
            </div>
          )}

          {/* Network Panel - only show when not in a room */}
          {netRole === NetworkRole.None && (
            <div className="bg-white rounded-xl shadow-lg p-4 border border-stone-200 w-full">
              <div className="flex items-center gap-2 mb-3">
                <Wifi size={18} className="text-blue-600" />
                <span className="text-sm font-medium">创建房间</span>
              </div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => createRoom('black')}
                    className="flex-1 flex items-center justify-center gap-2 py-2 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
                  >
                    <div className="w-4 h-4 rounded-full bg-stone-900"></div>
                    <span className="text-sm">执黑</span>
                  </button>
                  <button
                    onClick={() => createRoom('white')}
                    className="flex-1 flex items-center justify-center gap-2 py-2 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
                  >
                    <div className="w-4 h-4 rounded-full bg-white border-2 border-stone-300"></div>
                    <span className="text-sm">执白</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={joinInputId}
                  onChange={(e) => setJoinInputId(e.target.value.toUpperCase())}
                  placeholder="输入房间号加入"
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-center uppercase tracking-wider font-mono text-sm hover:border-stone-400 focus:outline-none focus:border-stone-400"
                  maxLength={6}
                />
              </div>
            </div>
          )}
        </div>

        {/* Center - Board */}
        <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
          {/* Board Area */}
          {(netRole === NetworkRole.None && phase === GamePhase.Intermission) ? (
            <div className="w-full aspect-square max-w-[600px] bg-stone-200 rounded-lg flex flex-col items-center justify-center gap-6 shadow-inner border-4 border-dashed border-stone-300 p-8 text-center">
              <EyeOff size={64} className="text-stone-400" />
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-stone-700">请移交设备</h2>
                <p className="text-stone-500">黑方已完成操作。请将设备交给白方，以便其秘密落子。</p>
              </div>
              <button
                onClick={proceedFromIntermission}
                className="flex items-center justify-center gap-2 px-8 py-3 bg-white text-stone-800 rounded-xl hover:bg-stone-100 transition-colors font-semibold shadow-lg border border-stone-200"
              >
                <Play size={18} fill="currentColor" />
                我是白方玩家
              </button>
            </div>
          ) : (
            <div className="relative w-full aspect-square max-w-[600px]">
              <Goban
                board={board}
                onCellClick={handleCellClick}
                tempMarker={netRole === NetworkRole.Host ? blackSelection : netRole === NetworkRole.Client ? whiteSelection : phase === GamePhase.BlackInput ? blackSelection : whiteSelection}
                isInteractive={isInteractive()}
                currentPlayer={getDisplayPlayer()}
                territoryMap={territoryMap}
                lastMove={history.length > 0 ? history[history.length - 1] : null}
              />

              {myMoveCommitted && netRole !== NetworkRole.None && phase !== GamePhase.Resolution && (
                <div className="absolute inset-0 bg-stone-900/10 backdrop-blur-[1px] rounded-sm flex items-center justify-center z-20">
                  <div className="bg-white px-6 py-3 rounded-full shadow-lg font-bold text-stone-600 animate-pulse border border-stone-200">
                    等待对手...
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Right Panel - Status & Controls (Desktop only) */}
        <div className="hidden md:flex flex-col gap-3 w-48 shrink-0 items-start">
          {/* Status Bar */}
          <div className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl font-semibold shadow-sm transition-colors duration-300
            ${opponentDisconnected ? 'bg-red-100 text-red-900' : ''}
            ${phase === GamePhase.Resolution ? 'bg-blue-100 text-blue-900' : ''}
            ${netRole === NetworkRole.None && phase === GamePhase.Intermission ? 'bg-amber-100 text-amber-900' : ''}
            ${!opponentDisconnected && !((netRole === NetworkRole.None && phase === GamePhase.Intermission) || phase === GamePhase.Resolution) ? 'bg-stone-800 text-white' : ''}
          `}>
            {opponentDisconnected && <WifiOff size={18} />}
            {phase === GamePhase.Intermission && <EyeOff size={18} />}
            {phase === GamePhase.Resolution && <RotateCcw size={18} className="animate-spin" />}
            {getPhaseMessage()}
          </div>

          {/* Desktop Action Controls */}
          {(phase !== GamePhase.Intermission && phase !== GamePhase.Resolution && phase !== GamePhase.GameOver) && (
            <div className="flex flex-col gap-2 w-full">
              <div className="flex gap-1">
                <button
                  onClick={myMoveCommitted && !opponentCommitted ? cancelMove : confirmSelection}
                  disabled={!isInteractive() && !(myMoveCommitted && !opponentCommitted)}
                  className={`
                    flex-1 h-12 flex items-center justify-center gap-2 rounded-xl font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed
                    ${myMoveCommitted && !opponentCommitted
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-white text-stone-800 hover:bg-stone-100 border border-stone-200'
                    }
                  `}
                >
                  {myMoveCommitted && !opponentCommitted ? (
                    <>
                      <X size={18} strokeWidth={3} />
                      撤销
                    </>
                  ) : (
                    <>
                      <Check size={18} strokeWidth={3} />
                      {quickMode ? '直接落子' : '确认落子'}
                    </>
                  )}
                </button>
                <button
                  onClick={() => setQuickMode(!quickMode)}
                  className={`h-12 w-12 flex items-center justify-center rounded-xl shadow-md transition-all ${
                    quickMode 
                      ? 'bg-stone-800 text-white hover:bg-stone-700'
                      : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
                  }`}
                  title={quickMode ? '快速模式已开启' : '开启快速模式'}
                >
                  <Zap size={18} strokeWidth={quickMode ? 3 : 2} />
                </button>
              </div>

              {showEstimation && estimatedScore ? (
                <button
                  onClick={toggleEstimation}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-white text-stone-700 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-stone-900 rounded-full"></div>
                      <span className="font-bold">{estimatedScore.black.toFixed(1)}</span>
                    </div>
                    <span className="text-xs text-stone-500">{getScoreDiff(estimatedScore.black, estimatedScore.white)}</span>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-stone-100 rounded-full border border-stone-300"></div>
                      <span className="font-bold">{estimatedScore.white.toFixed(1)}</span>
                    </div>
                  </div>
                </button>
              ) : (
                <button
                  onClick={toggleEstimation}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-white text-stone-700 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200 transition-colors"
                >
                  <ChartBar size={18} />
                  形势判断
                </button>
              )}

              {opponentEndGameRequested ? (
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => socketRef.current?.emit('agree-end-game')}
                    className="flex-1 p-3 bg-white text-green-700 rounded-xl font-medium shadow-md hover:bg-green-50 border border-stone-200"
                  >
                    同意
                  </button>
                  <button
                    onClick={() => socketRef.current?.emit('cancel-end-game')}
                    className="flex-1 p-3 bg-white text-red-600 rounded-xl font-medium shadow-md hover:bg-red-50 border border-stone-200"
                  >
                    拒绝
                  </button>
                </div>
              ) : endGameRequested ? (
                <button
                  onClick={() => {
                    setEndGameRequested(false);
                    socketRef.current?.emit('cancel-end-game');
                  }}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-white text-stone-600 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200"
                >
                  <XCircle size={18} />
                  取消请求
                </button>
              ) : (
                <button
                  onClick={endGame}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-white text-stone-600 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200"
                >
                  <Flag size={18} />
                  结束对局
                </button>
              )}

              <div className="flex gap-2 w-full">
                <button
                  onClick={saveGame}
                  className="flex-1 flex items-center justify-center gap-1.5 p-3 bg-white text-stone-700 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200"
                >
                  <Download size={18} />
                  保存
                </button>
                <label className="flex-1 flex items-center justify-center gap-1.5 p-3 bg-white text-stone-700 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200 cursor-pointer">
                  <Upload size={18} />
                  加载
                  <input type="file" accept=".json" onChange={loadGame} className="hidden" />
                </label>
              </div>
            </div>
          )}
          
          {phase === GamePhase.GameOver && (
            <div className="flex flex-col gap-2 w-full">
              <div className="bg-white shadow-md rounded-xl p-4 border border-stone-200">
                <div className="text-center mb-3">
                  <span className="text-sm text-stone-500 font-medium">游戏结束</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center flex-1">
                    <div className="text-xl font-black text-black">{scores.black.toFixed(1)}</div>
                    <div className="text-xs text-stone-500">黑</div>
                  </div>
                  <div className="text-sm font-semibold text-stone-600">{getScoreDiff(scores.black, scores.white)}</div>
                  <div className="text-center flex-1">
                    <div className="text-xl font-black text-stone-800">{scores.white.toFixed(1)}</div>
                    <div className="text-xs text-stone-500">白</div>
                  </div>
                </div>
              </div>
              
              <button
                onClick={resetGameLocal}
                className="w-full flex items-center justify-center gap-2 p-3 bg-white text-stone-700 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200"
              >
                <RotateCcw size={18} />
                再来一局
              </button>
              
              <div className="flex gap-2 w-full">
                <button
                  onClick={saveGame}
                  className="flex-1 flex items-center justify-center gap-1.5 p-3 bg-white text-stone-700 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200"
                >
                  <Download size={14} />
                  保存
                </button>
                <label className="flex-1 flex items-center justify-center gap-1.5 p-3 bg-white text-stone-700 rounded-xl font-medium shadow-md hover:bg-stone-100 border border-stone-200 cursor-pointer">
                  <Upload size={14} />
                  加载
                  <input type="file" accept=".json" onChange={loadGame} className="hidden" />
                </label>
              </div>
            </div>
          )}
          
        </div>
        </div>
        
        {territoryMap && showEstimation && phase !== GamePhase.GameOver && (
          <div className="hidden">
          </div>
        )}
      </main>
    </div>
  );
  };

export default App;
