import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Player, BoardState, GamePhase, Point, TerritoryMap, MoveRecord, NetworkRole } from './types';
import { createEmptyBoard, resolveTurn, calculateTerritory } from './utils/gameLogic';
import Goban from './components/Goban';
import { RotateCcw, EyeOff, Play, ChartBar, X, Check, Download, Upload, Wifi, Copy, Link } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const SOCKET_SERVER = `http://${window.location.hostname}:3001`;

const App: React.FC = () => {
  // Game State
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [phase, setPhase] = useState<GamePhase>(GamePhase.BlackInput);
  const [turnCount, setTurnCount] = useState<number>(1);
  const [captures, setCaptures] = useState({ black: 0, white: 0 });
  const [history, setHistory] = useState<MoveRecord[]>([]);
  
  // Selection State
  const [blackSelection, setBlackSelection] = useState<Point | null>(null);
  const [whiteSelection, setWhiteSelection] = useState<Point | null>(null);
  
  // UI State
  const [lastClash, setLastClash] = useState<Point | null>(null);
  const [scores, setScores] = useState<{black: number, white: number} | null>(null);
  
  // Estimation State
  const [estimationMode, setEstimationMode] = useState(false);
  const [territoryMap, setTerritoryMap] = useState<TerritoryMap | null>(null);
  const [estimatedScore, setEstimatedScore] = useState<{black: number, white: number} | null>(null);

  // --- Network State ---
  const [showNetPanel, setShowNetPanel] = useState(false);
  const [netRole, setNetRole] = useState<NetworkRole>(NetworkRole.None);
  const [roomId, setRoomId] = useState<string>('');
  const [connStatus, setConnStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'WAITING'>('DISCONNECTED');
  const [joinInputId, setJoinInputId] = useState('');
  const [myMoveCommitted, setMyMoveCommitted] = useState(false);
  const [opponentCommitted, setOpponentCommitted] = useState(false);
  const [endGameRequested, setEndGameRequested] = useState(false);
  const [opponentEndGameRequested, setOpponentEndGameRequested] = useState(false);
  const [selectedCreateRole, setSelectedCreateRole] = useState<'black' | 'white'>('black');

  // Socket ref
  const socketRef = useRef<Socket | null>(null);

  // Refs to access latest state in callbacks
  const movesRef = useRef<{black: Point|null, white: Point|null}>({black: null, white: null});
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

  // --- URL Room Detection ---
  useEffect(() => {
    const path = window.location.pathname;
    const roomIdFromPath = path.slice(1).toUpperCase();
    
    if (roomIdFromPath && roomIdFromPath.length >= 6 && /^[A-Z0-9]+$/.test(roomIdFromPath)) {
      setJoinInputId(roomIdFromPath);
      setShowNetPanel(true);
    }
  }, []);

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
        alert('对手已断开连接，等待重连中...（60秒）');
      } else {
        alert('对手已断开连接');
        setConnStatus('DISCONNECTED');
        setNetRole(NetworkRole.None);
        setRoomId('');
        resetGameLocal();
      }
    });

    socket.on('opponent-reconnected', () => {
      console.log('[Socket] 对手已重连');
      alert('对手已重新连接');
    });

    socket.on('opponent-reconnect-timeout', () => {
      console.log('[Socket] 等待重连超时');
      alert('等待重连超时，游戏结束');
      setConnStatus('DISCONNECTED');
      setNetRole(NetworkRole.None);
      setRoomId('');
      resetGameLocal();
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

    socket.on('game-ended', () => {
      console.log('[Socket] 游戏结束');
      const {black, white} = calculateTerritory(boardRef.current);
      setScores({black, white});
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
      setShowNetPanel(false);
      copyRoomId(response.roomId);
      
      window.history.pushState({}, '', `/${response.roomId}`);
    });
  }, [connectSocket]);

  const joinRoom = useCallback(() => {
    if (!joinInputId) return;
    
    const socket = connectSocket();
    setConnStatus('CONNECTING');
    
    socket.emit('join-room', joinInputId, (response: { roomId?: string; role?: string; error?: string; reconnected?: boolean }) => {
      if (response.error) {
        alert(response.error);
        setConnStatus('DISCONNECTED');
        return;
      }
      console.log('[Socket] 加入房间成功', response);
      setRoomId(response.roomId!);
      setNetRole(response.role === 'black' ? NetworkRole.Host : NetworkRole.Client);
      setConnStatus('CONNECTED');
      setShowNetPanel(false);
      
      window.history.pushState({}, '', `/${response.roomId}`);
      
      if (response.reconnected) {
        alert('重连成功！');
      } else {
        socket.emit('request-sync');
      }
    });
  }, [joinInputId, connectSocket]);

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
    setEstimationMode(false);
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
    if (estimationMode) {
      toggleEstimation();
      return;
    }
    
    if (phase === GamePhase.Resolution || phase === GamePhase.GameOver) return;
    if (netRole !== NetworkRole.None && myMoveCommitted) return;

    if (netRole === NetworkRole.None) {
      if (phase === GamePhase.BlackInput) {
        if (blackSelection?.row === p.row && blackSelection?.col === p.col) setBlackSelection(null);
        else setBlackSelection(p);
      } else if (phase === GamePhase.WhiteInput) {
        if (whiteSelection?.row === p.row && whiteSelection?.col === p.col) setWhiteSelection(null);
        else setWhiteSelection(p);
      }
    } else if (netRole === NetworkRole.Host) {
      if (blackSelection?.row === p.row && blackSelection?.col === p.col) setBlackSelection(null);
      else setBlackSelection(p);
    } else if (netRole === NetworkRole.Client) {
      if (whiteSelection?.row === p.row && whiteSelection?.col === p.col) setWhiteSelection(null);
      else setWhiteSelection(p);
    }
  };

  const toggleEstimation = () => {
    if (estimationMode) {
      setEstimationMode(false);
      setTerritoryMap(null);
      setEstimatedScore(null);
    } else {
      const { black, white, territoryMap } = calculateTerritory(board);
      setEstimationMode(true);
      setTerritoryMap(territoryMap);
      setEstimatedScore({ black, white });
    }
  };

  const confirmSelection = () => {
    if (estimationMode) toggleEstimation();

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
      socketRef.current?.emit('request-end-game');
      return;
    }
    const {black, white} = calculateTerritory(board);
    setScores({black, white});
    setPhase(GamePhase.GameOver);
  };

  // --- Save / Load Logic ---
  const saveGame = () => {
    const data = { date: new Date().toISOString(), history: history };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synchro-go-${new Date().toISOString().slice(0,10)}.json`;
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
    setEstimationMode(false);
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
    if (netRole !== NetworkRole.None) {
      if (phase === GamePhase.GameOver) return "游戏结束";
      if (myMoveCommitted && opponentCommitted) return "正在结算...";
      if (myMoveCommitted) return "已确认，等待对方...";
      if (opponentCommitted) return "对方已确认，请落子";
      if (netRole === NetworkRole.Host) return "主机（黑方）回合：请落子";
      if (netRole === NetworkRole.Client) return "客机（白方）回合：请落子";
    }

    switch (phase) {
      case GamePhase.BlackInput: return "黑方回合：请选择落子位置（隐藏）";
      case GamePhase.Intermission: return "请将设备移交给白方玩家";
      case GamePhase.WhiteInput: return "白方回合：请选择落子位置（隐藏）";
      case GamePhase.Resolution: return "正在结算双方走子...";
      case GamePhase.GameOver: return "游戏结束";
      default: return "";
    }
  };

  const getScoreDiff = (b: number, w: number) => {
    const diff = Math.abs(b - w).toFixed(1);
    if (b > w) return `黑领先 ${diff}`;
    if (w > b) return `白领先 ${diff}`;
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
      
      {/* Header */}
      <header className="bg-stone-800 text-stone-100 p-4 shadow-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-stone-400 to-stone-600 border border-stone-300"></div>
            <h1 className="text-xl font-bold tracking-wide hidden sm:block">同步围棋</h1>
            <h1 className="text-xl font-bold tracking-wide sm:hidden">同步</h1>
          </div>
          
          <div className="flex items-center gap-4">
              {netRole !== NetworkRole.None && (
                  <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                    connStatus === 'CONNECTED' ? 'bg-green-900 text-green-300' : 
                    connStatus === 'WAITING' ? 'bg-amber-900 text-amber-300' : 'bg-red-900 text-red-300'
                  }`}>
                      <Wifi size={14} />
                      <span className="hidden sm:inline">
                        {netRole === NetworkRole.Host ? '主机' : '客机'}: {
                          connStatus === 'CONNECTED' ? '已连接' : 
                          connStatus === 'WAITING' ? '等待对手' : '断开'
                        }
                      </span>
                  </div>
              )}

              <div className="flex gap-3 text-sm font-medium">
                <div className="flex flex-col items-center">
                    <span className="text-stone-400 text-xs">黑方</span>
                    <span className="text-lg">{captures.black}</span>
                </div>
                 <div className="flex flex-col items-center">
                    <span className="text-stone-400 text-xs">回合</span>
                    <span className="text-lg">{turnCount}</span>
                </div>
                <div className="flex flex-col items-center">
                    <span className="text-stone-400 text-xs">白方</span>
                    <span className="text-lg">{captures.white}</span>
                </div>
              </div>
              
              <button 
                onClick={() => setShowNetPanel(!showNetPanel)}
                className={`p-2 rounded-full transition-colors ${showNetPanel ? 'bg-stone-700 text-white' : 'hover:bg-stone-700 text-stone-400'}`}
                title="联机对战"
              >
                  <Wifi size={20} />
              </button>
          </div>
        </div>
      </header>

      {/* Network Panel Modal/Overlay */}
      {showNetPanel && (
          <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20 px-4 pointer-events-none">
              <div className="bg-white shadow-2xl rounded-xl border border-stone-200 p-6 w-full max-w-md pointer-events-auto animate-in fade-in slide-in-from-top-4">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                          <Wifi size={20} className="text-blue-600"/> 联机大厅
                      </h3>
                      <button onClick={() => setShowNetPanel(false)} className="text-stone-400 hover:text-stone-800"><X size={20}/></button>
                  </div>
                  
                  {netRole === NetworkRole.None ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <button 
                                    onClick={() => createRoom('black')}
                                    className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 border-2 rounded-lg transition-colors ${selectedCreateRole === 'black' ? 'border-stone-900 bg-stone-50' : 'border-stone-200 hover:border-stone-400 hover:bg-stone-50'}`}
                                >
                                    <div className="w-10 h-10 rounded-full bg-stone-900"></div>
                                    <span className="font-semibold">创建房间（执黑）</span>
                                </button>
                                <button 
                                    onClick={() => createRoom('white')}
                                    className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 border-2 rounded-lg transition-colors ${selectedCreateRole === 'white' ? 'border-stone-900 bg-stone-50' : 'border-stone-200 hover:border-stone-400 hover:bg-stone-50'}`}
                                >
                                    <div className="w-10 h-10 rounded-full bg-white border-2 border-stone-300"></div>
                                    <span className="font-semibold">创建房间（执白）</span>
                                </button>
                            </div>
                            <div className="flex flex-col gap-2">
                                <input 
                                    type="text" 
                                    value={joinInputId}
                                    onChange={(e) => setJoinInputId(e.target.value.toUpperCase())}
                                    placeholder="输入房间号"
                                    className="flex-1 p-4 border-2 border-stone-200 rounded-lg text-center uppercase tracking-wider font-mono hover:border-stone-400 focus:outline-none focus:border-stone-400"
                                    maxLength={6}
                                />
                                <button 
                                    onClick={joinRoom}
                                    disabled={!joinInputId}
                                    className="flex-1 flex items-center justify-center gap-2 p-4 border-2 border-stone-200 rounded-lg hover:border-stone-400 hover:bg-stone-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="w-5 h-5 rounded-full bg-stone-900"></div>
                                    <div className="w-5 h-5 rounded-full bg-white border-2 border-stone-300"></div>
                                    <span className="font-semibold">加入房间</span>
                                </button>
                            </div>
                        </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-stone-100 rounded-lg">
                            <div>
                                <div className="text-xs text-stone-400">房间号</div>
                                <div className="font-mono text-lg font-bold tracking-wider">{roomId}</div>
                            </div>
                            <button 
                                onClick={() => copyRoomId(roomId)}
                                className="p-2 hover:bg-stone-200 rounded-lg transition-colors"
                                title="复制房间号"
                            >
                                <Copy size={18} />
                            </button>
                        </div>
                        <div className="text-center text-sm">
                            {connStatus === 'WAITING' && (
                                <p className="text-amber-600">等待对手加入...</p>
                            )}
                            {connStatus === 'CONNECTED' && (
                                <p className="text-green-600">对手已连接，开始游戏！</p>
                            )}
                        </div>
                        <button 
                            onClick={() => {
                              socketRef.current?.disconnect();
                              setNetRole(NetworkRole.None);
                              setRoomId('');
                              setConnStatus('DISCONNECTED');
                              resetGameLocal();
                            }}
                            className="w-full py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm"
                        >
                            断开连接
                        </button>
                    </div>
                  )}
              </div>
          </div>
      )}

      {/* Main Game Area */}
      <main className="flex-1 flex flex-col items-center justify-center gap-6 p-4">
        
        {/* Status Bar */}
        <div className="w-full max-w-lg text-center">
            <div className={`inline-flex items-center gap-2 px-6 py-2 rounded-full font-semibold shadow-sm transition-colors duration-300
                ${(netRole === NetworkRole.Host || phase === GamePhase.BlackInput) ? 'bg-black text-white' : ''}
                ${(netRole === NetworkRole.Client || phase === GamePhase.WhiteInput) ? 'bg-white text-black border border-stone-300' : ''}
                ${(netRole === NetworkRole.None && phase === GamePhase.Intermission) ? 'bg-amber-100 text-amber-900 border border-amber-300' : ''}
                ${phase === GamePhase.Resolution ? 'bg-blue-100 text-blue-900' : ''}
            `}>
                {phase === GamePhase.Intermission && <EyeOff size={18} />}
                {phase === GamePhase.Resolution && <RotateCcw size={18} className="animate-spin" />}
                {getPhaseMessage()}
            </div>
        </div>

        {/* Board Area */}
        {(netRole === NetworkRole.None && phase === GamePhase.Intermission) ? (
            <div className="w-full max-w-[600px] aspect-square bg-stone-200 rounded-lg flex flex-col items-center justify-center gap-6 shadow-inner border-4 border-dashed border-stone-300 p-8 text-center">
                <EyeOff size={64} className="text-stone-400" />
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-stone-700">请移交设备</h2>
                    <p className="text-stone-500">黑方已完成操作。请将设备交给白方，以便其秘密落子。</p>
                </div>
                <button 
                    onClick={proceedFromIntermission}
                    className="flex items-center gap-2 px-8 py-3 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-all font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                >
                    <Play size={20} fill="currentColor" />
                    我是白方玩家
                </button>
            </div>
        ) : (
            <div className="relative w-full max-w-[600px]">
                <Goban 
                    board={board}
                    onCellClick={handleCellClick}
                    tempMarker={netRole === NetworkRole.Host ? blackSelection : netRole === NetworkRole.Client ? whiteSelection : phase === GamePhase.BlackInput ? blackSelection : whiteSelection}
                    isInteractive={isInteractive()}
                    currentPlayer={getDisplayPlayer()}
                    territoryMap={territoryMap}
                />
                
                {myMoveCommitted && netRole !== NetworkRole.None && phase !== GamePhase.Resolution && (
                    <div className="absolute inset-0 bg-stone-900/10 backdrop-blur-[1px] rounded-sm flex items-center justify-center z-20">
                        <div className="bg-white px-6 py-3 rounded-full shadow-lg font-bold text-stone-600 animate-pulse border border-stone-200">
                             等待对手...
                        </div>
                    </div>
                )}
                
                {estimationMode && estimatedScore && (
                     <div className="mt-4 bg-white shadow-lg rounded-xl p-4 flex items-center gap-6 border border-stone-200 animate-in fade-in slide-in-from-bottom-2">
                         <div className="text-center">
                             <div className="text-xs text-stone-500 font-bold uppercase">黑方</div>
                             <div className="text-2xl font-black text-black">{estimatedScore.black.toFixed(1)}</div>
                         </div>
                         <div className="flex-1 text-center">
                             <div className="text-sm font-semibold text-stone-600">{getScoreDiff(estimatedScore.black, estimatedScore.white)}</div>
                         </div>
                         <div className="text-center">
                             <div className="text-xs text-stone-500 font-bold uppercase">白方</div>
                             <div className="text-2xl font-black text-stone-800">{estimatedScore.white.toFixed(1)}</div>
                         </div>
                     </div>
                )}
            </div>
        )}

        {/* Action Controls */}
        <div className="w-full max-w-[600px] flex flex-col gap-4">
            {(phase !== GamePhase.Intermission && phase !== GamePhase.Resolution && phase !== GamePhase.GameOver) && (
                <>
                <div className="flex justify-between items-center h-16 gap-4">
                    <div className="flex-1 flex justify-start">
                         <button 
                            onClick={toggleEstimation}
                            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors font-medium
                                ${estimationMode ? 'bg-stone-200 text-stone-800' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/50'}
                            `}
                            title="形势判断"
                        >
                            <ChartBar size={18} />
                            <span className="hidden sm:inline">形势判断</span>
                         </button>
                    </div>
                    
                    <button
                        onClick={myMoveCommitted && !opponentCommitted ? cancelMove : confirmSelection}
                        disabled={!isInteractive() && !(myMoveCommitted && !opponentCommitted)}
                        className={`
                            flex-1 flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                            ${myMoveCommitted && !opponentCommitted 
                                ? 'bg-amber-500 text-white hover:bg-amber-600' 
                                : getDisplayPlayer() === Player.Black 
                                    ? 'bg-stone-900 text-white hover:bg-stone-800' 
                                    : 'bg-white text-stone-900 border-2 border-stone-200 hover:bg-stone-50'
                            }
                        `}
                    >
                        {myMoveCommitted && !opponentCommitted ? (
                            <>
                                <X size={20} strokeWidth={3} />
                                撤销
                            </>
                        ) : (
                            <>
                                <Check size={20} strokeWidth={3} />
                                确认{getDisplayPlayer() === Player.Black ? "黑方" : "白方"}
                            </>
                        )}
                    </button>

                    <div className="flex-1 flex justify-end">
                        {opponentEndGameRequested ? (
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => socketRef.current?.emit('agree-end-game')}
                                    className="text-green-600 hover:text-green-700 transition-colors text-sm font-semibold px-2"
                                >
                                    同意结束
                                </button>
                                <button 
                                    onClick={() => socketRef.current?.emit('cancel-end-game')}
                                    className="text-red-400 hover:text-red-600 transition-colors text-sm font-semibold px-2"
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
                                className="text-stone-400 hover:text-stone-600 transition-colors text-sm font-semibold px-2"
                            >
                                取消请求
                            </button>
                        ) : (
                            <button 
                                onClick={endGame}
                                className="text-stone-400 hover:text-red-600 transition-colors text-sm font-semibold px-2"
                            >
                                结束对局
                            </button>
                        )}
                    </div>
                </div>

                {/* Save/Load Controls */}
                <div className="flex justify-center items-center gap-6 text-stone-400 text-sm">
                    <button 
                        onClick={saveGame} 
                        className="flex items-center gap-1.5 hover:text-stone-700 transition-colors px-2 py-1"
                        title="保存当前棋谱"
                    >
                        <Download size={16} />
                        保存
                    </button>
                    <span className="text-stone-300">|</span>
                    <label 
                        className="flex items-center gap-1.5 hover:text-stone-700 transition-colors cursor-pointer px-2 py-1"
                        title="加载棋谱"
                    >
                        <Upload size={16} />
                        加载
                        <input type="file" accept=".json" onChange={loadGame} className="hidden" />
                    </label>
                </div>
                </>
            )}
        </div>

        {/* Game Over Modal */}
        {phase === GamePhase.GameOver && scores && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center animate-in zoom-in-95">
                    <h2 className="text-2xl font-bold mb-4">游戏结束</h2>
                    <div className="flex justify-around mb-6">
                        <div className="text-center">
                            <div className="w-12 h-12 rounded-full bg-stone-900 mx-auto mb-2"></div>
                            <div className="text-3xl font-black">{scores.black.toFixed(1)}</div>
                            <div className="text-sm text-stone-500">黑方</div>
                        </div>
                        <div className="text-center">
                            <div className="w-12 h-12 rounded-full bg-white border-2 border-stone-300 mx-auto mb-2"></div>
                            <div className="text-3xl font-black">{scores.white.toFixed(1)}</div>
                            <div className="text-sm text-stone-500">白方</div>
                        </div>
                    </div>
                    <div className="text-xl font-bold mb-6">
                        {getScoreDiff(scores.black, scores.white)}
                    </div>
                    <div className="flex gap-4">
                        <button 
                            onClick={resetGame}
                            className="flex-1 py-3 bg-stone-900 text-white rounded-lg font-semibold hover:bg-stone-800 transition-colors"
                        >
                            再来一局
                        </button>
                        <button 
                            onClick={saveGame}
                            className="flex-1 py-3 border border-stone-300 rounded-lg font-semibold hover:bg-stone-50 transition-colors"
                        >
                            保存棋谱
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
