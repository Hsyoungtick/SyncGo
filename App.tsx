import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Player, BoardState, GamePhase, Point, TerritoryMap, MoveRecord, NetworkRole } from './types';
import { createEmptyBoard, resolveTurn, calculateTerritory } from './utils/gameLogic';
import Goban from './components/Goban';
import { RotateCcw, EyeOff, Play, ChartBar, X, Check, Download, Upload, Wifi, Copy, Link, Flag, XCircle, WifiOff, Zap, HelpCircle, Sun, Moon, Github } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const SOCKET_SERVER = import.meta.env.VITE_SOCKET_SERVER || import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;

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
  const [showRules, setShowRules] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('syncgo_theme') === 'dark');

  // Socket ref
  const socketRef = useRef<Socket | null>(null);

  // Save quickMode to localStorage
  useEffect(() => {
    localStorage.setItem('quickMode', String(quickMode));
  }, [quickMode]);

  useEffect(() => {
    localStorage.setItem('syncgo_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

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
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
      console.log('[Socket] 已连接到服务器');
      
      // 检查是否有保存的房间信息，尝试自动重连
      const savedRoomId = localStorage.getItem('syncgo_room_id');
      const savedRole = localStorage.getItem('syncgo_role');
      if (savedRoomId && savedRole && netRole === NetworkRole.None) {
        console.log('[Socket] 尝试自动重连到房间:', savedRoomId);
        socket.emit('join-room', savedRoomId, (response: { roomId?: string; role?: string; error?: string; reconnected?: boolean; hasOpponent?: boolean }) => {
          if (response.error) {
            console.log('[Socket] 自动重连失败:', response.error);
            localStorage.removeItem('syncgo_room_id');
            localStorage.removeItem('syncgo_role');
            return;
          }
          console.log('[Socket] 自动重连成功', response);
          setRoomId(response.roomId!);
          setNetRole(response.role === 'black' ? NetworkRole.Host : NetworkRole.Client);
          setConnStatus(response.reconnected || response.hasOpponent ? 'CONNECTED' : 'WAITING');
          if (response.reconnected) {
            socket.emit('request-sync');
          }
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('[Socket] 已断开连接');
      // 不清除房间信息，保留以便重连
      setConnStatus('DISCONNECTED');
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

      // 保存房间信息到 localStorage
      localStorage.setItem('syncgo_room_id', response.roomId);
      localStorage.setItem('syncgo_role', response.role);

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

    if (netRole !== NetworkRole.None && socketRef.current) {
      const gameState = {
        board: currentBoard,
        captures: { black: bCaps, white: wCaps },
        turn: moves.length + 1,
        history: moves,
        lastClash: null
      };
      socketRef.current.emit('load-game', gameState);
    }
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

  const themeButtonClass = `w-12 h-12 flex items-center justify-center rounded-xl shadow-md transition-colors border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'}`;
  const containerClass = `min-h-screen font-sans flex flex-col ${darkMode ? 'bg-stone-900 text-stone-100' : 'bg-stone-100 text-stone-900'}`;
  const cardClass = `rounded-xl shadow-lg p-4 border transition-colors ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-900 border-stone-200'}`;
  const compactCardClass = `rounded-xl shadow-md p-4 border transition-colors ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-700 border-stone-200'}`;
  const buttonClass = `rounded-xl font-medium shadow-md border transition-colors ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'}`;
  const smallButtonClass = `rounded-lg border transition-colors ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'}`;
  const mutedTextClass = darkMode ? 'text-stone-300' : 'text-stone-500';
  const inputClass = `w-full px-3 py-2 rounded-lg text-center uppercase tracking-wider font-mono text-sm border focus:outline-none ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 placeholder:text-stone-500 hover:border-stone-500 focus:border-stone-500' : 'bg-white text-stone-700 border-stone-200 hover:border-stone-400 focus:border-stone-400'}`;

  return (
    <div className={containerClass}>

      {/* Main Game Area */}
      <main className="flex-1 flex items-center justify-center p-4 md:p-6">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-center gap-4 w-full max-w-[1400px]">
          {/* Left Panel - Info & Network */}
          <div className="hidden md:flex flex-col gap-3 w-48 shrink-0 items-end">
          {/* Game Info */}
          <div className={`${cardClass} w-full`}>
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full bg-stone-900 ${darkMode ? 'border border-white' : ''}`}></div>
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
            <div className={`border-t pt-3 mt-3 ${darkMode ? 'border-stone-700' : 'border-stone-200'}`}>
              <div className="flex justify-between items-center">
                <span className={`text-sm ${mutedTextClass}`}>回合</span>
                <span className="text-lg font-bold">{turnCount}</span>
              </div>
            </div>
          </div>

          {/* Network Status */}
          {netRole !== NetworkRole.None && (
            <div className={`${cardClass} w-full`}>
              <div className="flex items-center gap-2 mb-2">
                <Wifi size={18} className={darkMode ? 'text-stone-200' : (
                  connStatus === 'CONNECTED' ? 'text-green-600' :
                    connStatus === 'WAITING' ? 'text-amber-600' : 'text-red-600'
                )} />
                <span className={`text-sm px-2 py-0.5 rounded border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700' : (
                    connStatus === 'CONNECTED' ? 'bg-green-100 text-green-700 border-green-200' :
                    connStatus === 'WAITING' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-red-100 text-red-700 border-red-200'
                  )}`}>
                  {connStatus === 'CONNECTED' ? '已连接' :
                    connStatus === 'WAITING' ? '等待对手' : '断开连接'}
                </span>
              </div>
              {roomId && (
                <div className={`mt-2 text-lg ${mutedTextClass} text-center flex items-center justify-center gap-1`}>
                   <span className="font-mono font-bold">{roomId}</span>
                  <button
                    onClick={() => copyRoomId(roomId)}
                    className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-200'}`}
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
                  localStorage.removeItem('syncgo_room_id');
                  localStorage.removeItem('syncgo_role');
                  window.history.pushState({}, '', '/');
                }}
                className={`w-full mt-2 py-1.5 text-sm rounded-lg transition-colors border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'text-red-600 bg-red-50 hover:bg-red-100 border-red-100'}`}
              >
                退出房间
              </button>
            </div>
          )}

          {/* Network Panel - only show when not in a room */}
          {netRole === NetworkRole.None && (
            <div className={`${cardClass} w-full`}>
              <div className="flex items-center gap-2 mb-3">
                <Wifi size={18} className={darkMode ? 'text-stone-200' : 'text-blue-600'} />
                <span className="text-sm font-medium">创建房间</span>
              </div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => createRoom('black')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 ${smallButtonClass}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-stone-900 ${darkMode ? 'border border-white' : ''}`}></div>
                    <span className="text-sm">执黑</span>
                  </button>
                  <button
                    onClick={() => createRoom('white')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 ${smallButtonClass}`}
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
                  className={inputClass}
                  maxLength={6}
                />
              </div>
            </div>
          )}
        </div>

        {/* Center - Board */}
        <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
          <div className="w-full md:hidden">
            <div className={darkMode
              ? 'w-full flex items-center justify-center gap-2 p-3 rounded-xl font-semibold shadow-sm transition-colors duration-300 bg-stone-900 text-stone-100 border border-stone-700 hover:bg-stone-800'
              : `w-full flex items-center justify-center gap-2 p-3 rounded-xl font-semibold shadow-sm transition-colors duration-300
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
          </div>
          {/* Board Area */}
          {(netRole === NetworkRole.None && phase === GamePhase.Intermission) ? (
            <div className={`w-full aspect-square max-w-[92vmin] sm:max-w-[520px] md:max-w-[720px] rounded-lg flex flex-col items-center justify-center gap-6 shadow-inner border-4 border-dashed p-4 sm:p-6 md:p-8 text-center ${darkMode ? 'bg-stone-900 border-stone-700' : 'bg-stone-200 border-stone-300'}`}>
              <EyeOff size={64} className={darkMode ? 'text-stone-300' : 'text-stone-400'} />
              <div className="space-y-2">
                <h2 className={`text-2xl font-bold ${darkMode ? 'text-stone-100' : 'text-stone-700'}`}>请移交设备</h2>
                <p className={mutedTextClass}>黑方已完成操作。请将设备交给白方，以便其秘密落子。</p>
              </div>
              <button
                onClick={proceedFromIntermission}
                className={`flex items-center justify-center gap-2 px-8 py-3 rounded-xl transition-colors font-semibold shadow-lg border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-800 border-stone-200 hover:bg-stone-100'}`}
              >
                <Play size={18} fill="currentColor" />
                我是白方玩家
              </button>
            </div>
          ) : (
            <div className="relative w-full aspect-square max-w-[92vmin] sm:max-w-[520px] md:max-w-[720px]">
              <Goban
                board={board}
                onCellClick={handleCellClick}
                tempMarker={netRole === NetworkRole.Host ? blackSelection : netRole === NetworkRole.Client ? whiteSelection : phase === GamePhase.BlackInput ? blackSelection : whiteSelection}
                isInteractive={isInteractive()}
                currentPlayer={getDisplayPlayer()}
                territoryMap={territoryMap}
                lastMove={history.length > 0 ? history[history.length - 1] : null}
              />

              {(myMoveCommitted || connStatus === 'CONNECTING' || connStatus === 'WAITING') && netRole !== NetworkRole.None && phase !== GamePhase.Resolution && (
                <div className="absolute inset-0 bg-stone-900/10 backdrop-blur-[1px] rounded-sm flex items-center justify-center z-20">
                  <div className={`px-6 py-3 rounded-full shadow-lg font-bold animate-pulse border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700' : 'bg-white text-stone-600 border-stone-200'}`}>
                    {connStatus === 'CONNECTING' ? '连接中...' : connStatus === 'WAITING' ? '等待对手加入...' : '等待对手...'}
                  </div>
                </div>
              )}

              {netRole === NetworkRole.None && connStatus === 'CONNECTING' && (
                <div className="absolute inset-0 bg-stone-900/10 backdrop-blur-[1px] rounded-sm flex items-center justify-center z-20">
                  <div className={`px-6 py-3 rounded-full shadow-lg font-bold animate-pulse border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700' : 'bg-white text-stone-600 border-stone-200'}`}>
                    正在创建房间...
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="w-full md:hidden flex flex-col gap-2">
            {(phase !== GamePhase.Intermission && phase !== GamePhase.Resolution && phase !== GamePhase.GameOver) && (
              <div className="flex flex-col gap-2 w-full">
                <div className="flex gap-1">
                  <button
                    onClick={myMoveCommitted && !opponentCommitted ? cancelMove : confirmSelection}
                    disabled={!isInteractive() && !(myMoveCommitted && !opponentCommitted)}
                    className={`
                    flex-1 h-12 flex items-center justify-center gap-2 rounded-xl font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed border
                    ${myMoveCommitted && !opponentCommitted
                      ? (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600')
                      : (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-800 border-stone-200 hover:bg-stone-100')
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
                    className={`h-12 w-12 flex items-center justify-center rounded-xl shadow-md transition-all border ${
                    quickMode 
                      ? (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-stone-800 text-white border-stone-800 hover:bg-stone-700')
                      : (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100')
                  }`}
                    title={quickMode ? '快速模式已开启' : '开启快速模式'}
                  >
                  <Zap size={18} strokeWidth={quickMode ? 3 : 2} className={darkMode ? 'text-white' : undefined} />
                  </button>
                </div>

                {showEstimation && estimatedScore ? (
                  <button
                    onClick={toggleEstimation}
                    className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-stone-900 rounded-full"></div>
                        <span className="font-bold">{estimatedScore.black.toFixed(1)}</span>
                      </div>
                      <span className={`text-xs ${mutedTextClass}`}>{getScoreDiff(estimatedScore.black, estimatedScore.white)}</span>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-stone-100 rounded-full border border-stone-300"></div>
                        <span className="font-bold">{estimatedScore.white.toFixed(1)}</span>
                      </div>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={toggleEstimation}
                    className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                  >
                    <ChartBar size={18} />
                    形势判断
                  </button>
                )}

                {opponentEndGameRequested ? (
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => socketRef.current?.emit('agree-end-game')}
                      className={`flex-1 p-3 ${buttonClass}`}
                    >
                      同意
                    </button>
                    <button
                      onClick={() => socketRef.current?.emit('cancel-end-game')}
                      className={`flex-1 p-3 ${buttonClass}`}
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
                    className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                  >
                    <XCircle size={18} />
                    取消请求
                  </button>
                ) : (
                  <button
                    onClick={endGame}
                    className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                  >
                    <Flag size={18} />
                    结束对局
                  </button>
                )}

                <div className="flex gap-2 w-full">
                  <button
                    onClick={saveGame}
                    className={`flex-1 flex items-center justify-center gap-1.5 p-3 ${buttonClass}`}
                  >
                    <Download size={18} />
                    保存
                  </button>
                  <label className={`flex-1 flex items-center justify-center gap-1.5 p-3 cursor-pointer ${buttonClass}`}>
                    <Upload size={18} />
                    加载
                    <input type="file" accept=".json" onChange={loadGame} className="hidden" />
                  </label>
                </div>
              </div>
            )}

            {phase === GamePhase.GameOver && (
              <div className="flex flex-col gap-2 w-full">
                <div className={compactCardClass}>
                  <div className="text-center mb-3">
                    <span className={`text-sm font-medium ${mutedTextClass}`}>游戏结束</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-center flex-1">
                      <div className="text-xl font-black">{scores.black.toFixed(1)}</div>
                      <div className={`text-xs ${mutedTextClass}`}>黑</div>
                    </div>
                    <div className={`text-sm font-semibold ${darkMode ? 'text-stone-100' : 'text-stone-600'}`}>{getScoreDiff(scores.black, scores.white)}</div>
                    <div className="text-center flex-1">
                      <div className="text-xl font-black">{scores.white.toFixed(1)}</div>
                      <div className={`text-xs ${mutedTextClass}`}>白</div>
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={resetGameLocal}
                  className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                >
                  <RotateCcw size={18} />
                  再来一局
                </button>
                
                <div className="flex gap-2 w-full">
                  <button
                    onClick={saveGame}
                    className={`flex-1 flex items-center justify-center gap-1.5 p-3 ${buttonClass}`}
                  >
                    <Download size={14} />
                    保存
                  </button>
                  <label className={`flex-1 flex items-center justify-center gap-1.5 p-3 cursor-pointer ${buttonClass}`}>
                    <Upload size={14} />
                    加载
                    <input type="file" accept=".json" onChange={loadGame} className="hidden" />
                  </label>
                </div>
              </div>
            )}
          </div>
          <div className="w-full md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={`${cardClass} w-full`}>
              <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full bg-stone-900 ${darkMode ? 'border border-white' : ''}`}></div>
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
              <div className={`border-t pt-3 mt-3 ${darkMode ? 'border-stone-700' : 'border-stone-200'}`}>
                <div className="flex justify-between items-center">
                  <span className={`text-sm ${mutedTextClass}`}>回合</span>
                  <span className="text-lg font-bold">{turnCount}</span>
                </div>
              </div>
            </div>
            {netRole !== NetworkRole.None && (
              <div className={`${cardClass} w-full`}>
                <div className="flex items-center gap-2 mb-2">
                  <Wifi size={18} className={darkMode ? 'text-stone-200' : (
                  connStatus === 'CONNECTED' ? 'text-green-600' :
                    connStatus === 'WAITING' ? 'text-amber-600' : 'text-red-600'
                )} />
                  <span className={`text-sm px-2 py-0.5 rounded border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700' : (
                    connStatus === 'CONNECTED' ? 'bg-green-100 text-green-700 border-green-200' :
                    connStatus === 'WAITING' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-red-100 text-red-700 border-red-200'
                  )}`}>
                    {connStatus === 'CONNECTED' ? '已连接' :
                      connStatus === 'WAITING' ? '等待对手' : '断开连接'}
                  </span>
                </div>
                {roomId && (
                  <div className={`mt-2 text-lg ${mutedTextClass} text-center flex items-center justify-center gap-1`}>
                    <span className="font-mono font-bold">{roomId}</span>
                    <button
                      onClick={() => copyRoomId(roomId)}
                      className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-200'}`}
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
                    localStorage.removeItem('syncgo_room_id');
                    localStorage.removeItem('syncgo_role');
                    window.history.pushState({}, '', '/');
                  }}
                  className={`w-full mt-2 py-1.5 text-sm rounded-lg transition-colors border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'text-red-600 bg-red-50 hover:bg-red-100 border-red-100'}`}
                >
                  退出房间
                </button>
              </div>
            )}

            {netRole === NetworkRole.None && (
              <div className={`${cardClass} w-full`}>
                <div className="flex items-center gap-2 mb-3">
                  <Wifi size={18} className={darkMode ? 'text-stone-200' : 'text-blue-600'} />
                  <span className="text-sm font-medium">创建房间</span>
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => createRoom('black')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 ${smallButtonClass}`}
                    >
                      <div className="w-4 h-4 rounded-full bg-stone-900"></div>
                      <span className="text-sm">执黑</span>
                    </button>
                    <button
                      onClick={() => createRoom('white')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 ${smallButtonClass}`}
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
                    className={inputClass}
                    maxLength={6}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="w-full md:hidden flex gap-2 justify-center mt-2">
            <button
              onClick={() => setDarkMode(prev => !prev)}
              className={themeButtonClass}
              title={darkMode ? '切换日间模式' : '切换夜间模式'}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <a
              href="https://github.com/Hsyoungtick/SyncGo"
              target="_blank"
              rel="noreferrer"
              className={themeButtonClass}
              title="项目源地址"
            >
              <Github size={20} />
            </a>
            <button
              onClick={() => setShowRules(true)}
              className={themeButtonClass}
              title="游戏规则"
            >
              <HelpCircle size={20} />
            </button>
          </div>
        </div>
        
        {/* Right Panel - Status & Controls (Desktop only) */}
        <div className="hidden md:flex flex-col gap-3 w-48 shrink-0 items-start">
          {/* Status Bar */}
          <div className={darkMode
            ? 'w-full flex items-center justify-center gap-2 p-3 rounded-xl font-semibold shadow-sm transition-colors duration-300 bg-stone-900 text-stone-100 border border-stone-700 hover:bg-stone-800'
            : `w-full flex items-center justify-center gap-2 p-3 rounded-xl font-semibold shadow-sm transition-colors duration-300
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
                    flex-1 h-12 flex items-center justify-center gap-2 rounded-xl font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed border
                    ${myMoveCommitted && !opponentCommitted
                      ? (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600')
                      : (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-800 border-stone-200 hover:bg-stone-100')
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
                  className={`h-12 w-12 flex items-center justify-center rounded-xl shadow-md transition-all border ${
                    quickMode 
                      ? (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-stone-800 text-white border-stone-800 hover:bg-stone-700')
                      : (darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100')
                  }`}
                  title={quickMode ? '快速模式已开启' : '开启快速模式'}
                >
                  <Zap size={18} strokeWidth={quickMode ? 3 : 2} className={darkMode ? 'text-white' : undefined} />
                </button>
              </div>

              {showEstimation && estimatedScore ? (
                <button
                  onClick={toggleEstimation}
                  className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-stone-900 rounded-full"></div>
                      <span className="font-bold">{estimatedScore.black.toFixed(1)}</span>
                    </div>
                    <span className={`text-xs ${mutedTextClass}`}>{getScoreDiff(estimatedScore.black, estimatedScore.white)}</span>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-stone-100 rounded-full border border-stone-300"></div>
                      <span className="font-bold">{estimatedScore.white.toFixed(1)}</span>
                    </div>
                  </div>
                </button>
              ) : (
                <button
                  onClick={toggleEstimation}
                  className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                >
                  <ChartBar size={18} />
                  形势判断
                </button>
              )}

              {opponentEndGameRequested ? (
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => socketRef.current?.emit('agree-end-game')}
                    className={`flex-1 p-3 ${buttonClass}`}
                  >
                    同意
                  </button>
                  <button
                    onClick={() => socketRef.current?.emit('cancel-end-game')}
                    className={`flex-1 p-3 ${buttonClass}`}
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
                  className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                >
                  <XCircle size={18} />
                  取消请求
                </button>
              ) : (
                <button
                  onClick={endGame}
                  className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
                >
                  <Flag size={18} />
                  结束对局
                </button>
              )}

              <div className="flex gap-2 w-full">
                <button
                  onClick={saveGame}
                  className={`flex-1 flex items-center justify-center gap-1.5 p-3 ${buttonClass}`}
                >
                  <Download size={18} />
                  保存
                </button>
                <label className={`flex-1 flex items-center justify-center gap-1.5 p-3 cursor-pointer ${buttonClass}`}>
                  <Upload size={18} />
                  加载
                  <input type="file" accept=".json" onChange={loadGame} className="hidden" />
                </label>
              </div>
            </div>
          )}
          
          {phase === GamePhase.GameOver && (
            <div className="flex flex-col gap-2 w-full">
              <div className={compactCardClass}>
                <div className="text-center mb-3">
                  <span className={`text-sm font-medium ${mutedTextClass}`}>游戏结束</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center flex-1">
                    <div className="text-xl font-black">{scores.black.toFixed(1)}</div>
                    <div className={`text-xs ${mutedTextClass}`}>黑</div>
                  </div>
                  <div className={`text-sm font-semibold ${darkMode ? 'text-stone-100' : 'text-stone-600'}`}>{getScoreDiff(scores.black, scores.white)}</div>
                  <div className="text-center flex-1">
                    <div className="text-xl font-black">{scores.white.toFixed(1)}</div>
                    <div className={`text-xs ${mutedTextClass}`}>白</div>
                  </div>
                </div>
              </div>
              
              <button
                onClick={resetGameLocal}
                className={`w-full flex items-center justify-center gap-2 p-3 ${buttonClass}`}
              >
                <RotateCcw size={18} />
                再来一局
              </button>
              
              <div className="flex gap-2 w-full">
                <button
                  onClick={saveGame}
                  className={`flex-1 flex items-center justify-center gap-1.5 p-3 ${buttonClass}`}
                >
                  <Download size={14} />
                  保存
                </button>
                <label className={`flex-1 flex items-center justify-center gap-1.5 p-3 cursor-pointer ${buttonClass}`}>
                  <Upload size={14} />
                  加载
                  <input type="file" accept=".json" onChange={loadGame} className="hidden" />
                </label>
              </div>
            </div>
          )}

          <div className="flex gap-2 w-full mt-auto justify-center">
            <button
              onClick={() => setDarkMode(prev => !prev)}
              className={themeButtonClass}
              title={darkMode ? '切换日间模式' : '切换夜间模式'}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <a
              href="https://github.com/Hsyoungtick/SyncGo"
              target="_blank"
              rel="noreferrer"
              className={themeButtonClass}
              title="项目源地址"
            >
              <Github size={20} />
            </a>
            <button
              onClick={() => setShowRules(true)}
              className={themeButtonClass}
              title="游戏规则"
            >
              <HelpCircle size={20} />
            </button>
          </div>
          
        </div>
        </div>
        
        {territoryMap && showEstimation && phase !== GamePhase.GameOver && (
          <div className="hidden">
          </div>
        )}

        {showRules && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className={`w-full max-w-lg rounded-2xl border shadow-xl ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700' : 'bg-white text-stone-800 border-stone-200'}`}>
              <div className={`flex items-center justify-between px-6 py-4 border-b ${darkMode ? 'border-stone-700' : 'border-stone-200/60'}`}>
                <div className="text-lg font-bold">游戏规则</div>
                <button
                  onClick={() => setShowRules(false)}
                  className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'}`}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 py-4 space-y-3 text-sm leading-6">
                <div>1. 每手棋双方先各自选择落子点并同时亮出。</div>
                <div>2. 若双方选择相同点，则该手无效，该点成为禁入点。</div>
                <div>3. 若双方选择不同点，则同时落子后结算无气棋子并提掉。</div>
                <div>4. 如果提子只包含该回合落下的子，这两个位置成为禁入点。</div>
                <div>5. 禁入点可作为棋子的气，双方之后不能落子于该点，直到出现不同落子。</div>
                <div>6. 无贴目。</div>
              </div>
              <div className="px-6 pb-5">
                <button
                  onClick={() => setShowRules(false)}
                  className={`w-full py-2.5 rounded-xl font-semibold shadow-md border transition-colors ${darkMode ? 'bg-stone-700 text-stone-100 border-stone-600 hover:bg-stone-600' : 'bg-stone-900 text-white border-stone-900 hover:bg-stone-800'}`}
                >
                  我知道了
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
  };

export default App;
