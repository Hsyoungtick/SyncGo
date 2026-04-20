import { useState, useEffect, useCallback, useRef } from 'react';
import { Point, BoardState, MoveRecord, NetworkRole, RoomInfo } from '../types';
import { webrtcManager, ConnectionStatus, GameState, WebRTCMessage } from '../lib/webrtc';

export type { GameState } from '../lib/webrtc';
import {
  createRoom as createRoomInDB,
  joinRoom as joinRoomInDB,
  getRoomList,
  getRoom,
  deleteRoom,
  updateRoomStatus,
  subscribeToRoom,
  getOffer,
  takeOverAsHost,
  sendHeartbeat,
  leaveRoomApi,
  claimHost,
  RoomInfo as DBRoomInfo
} from '../lib/signaling';

const generateUserId = () => {
  return 'user_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
};

const generateUserName = () => {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
};

export interface NetworkState {
  netRole: NetworkRole;
  connStatus: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'WAITING' | 'FAILED';
  roomId: string;
  myMoveCommitted: boolean;
  opponentCommitted: boolean;
  endGameRequested: boolean;
  opponentEndGameRequested: boolean;
  opponentDisconnected: boolean;
  roomList: RoomInfo[];
  userName: string;
  userId: string;
  hostRole: 'black' | 'white';
}

export interface NetworkActions {
  createRoom: (role: 'black' | 'white') => Promise<void>;
  joinRoom: (roomId: string) => Promise<{ success: boolean; error?: string }>;
  leaveRoom: () => void;
  commitMove: (move: Point | null) => void;
  cancelMove: () => void;
  resolveTurn: (blackMove: Point | null, whiteMove: Point | null) => void;
  requestEndGame: (gameState: GameState) => void;
  cancelEndGame: () => void;
  agreeEndGame: () => void;
  restartGame: () => void;
  loadGame: (gameState: GameState) => void;
  setUserName: (name: string) => void;
  refreshRoomList: () => Promise<void>;
  resetGameState: () => void;
  reconnect: (savedRoomId: string, savedRole: 'black' | 'white') => Promise<boolean>;
}

export interface NetworkCallbacks {
  onResolveTurn: (blackMove: Point | null, whiteMove: Point | null) => void;
  onFullSync: (gameState: GameState) => void;
  onGameRestarted: () => void;
  onGameEnded: (gameState?: GameState) => void;
  onOpponentReconnected: () => void;
  onRoomUpdated: (roomInfo: { hostName: string; guestName?: string; hostRole: string; amIHost: boolean }) => void;
}

export function useNetwork(callbacks: NetworkCallbacks): [NetworkState, NetworkActions] {
  const [netRole, setNetRole] = useState<NetworkRole>(NetworkRole.None);
  const [connStatus, setConnStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'WAITING' | 'FAILED'>('DISCONNECTED');
  const [roomId, setRoomId] = useState<string>('');
    const [myMoveCommittedLocal, setMyMoveCommittedLocal] = useState(false);
  const myMoveCommittedRef = useRef(false);

  const setMyMoveCommitted = (val: boolean) => {
    setMyMoveCommittedLocal(val);
    myMoveCommittedRef.current = val;
  };
  const [opponentCommitted, setOpponentCommitted] = useState(false);
  const [endGameRequested, setEndGameRequested] = useState(false);
  const [opponentEndGameRequested, setOpponentEndGameRequested] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [roomList, setRoomList] = useState<RoomInfo[]>([]);
  const [hostRole, setHostRole] = useState<'black' | 'white'>('black');
  const hostRoleRef = useRef(hostRole);
  hostRoleRef.current = hostRole;

  const opponentMoveRef = useRef<Point | null>(null);
  const myMoveRef = useRef<{ black: Point | null; white: Point | null }>({ black: null, white: null });

  const [userId] = useState(() => localStorage.getItem('syncgo_userid') || (() => {
    const newId = generateUserId();
    localStorage.setItem('syncgo_userid', newId);
    return newId;
  })());

  const [userName, setUserNameState] = useState(() => {
    const saved = localStorage.getItem('syncgo_username');
    // 验证名称宽度（汉字算2，英文算1，最多4）
    const getDisplayWidth = (str: string) => {
      let width = 0;
      for (const char of str) {
        width += char.charCodeAt(0) > 127 ? 2 : 1;
      }
      return width;
    };
    if (saved && getDisplayWidth(saved) <= 4) {
      return saved;
    }
    return generateUserName();
  });

  const roomSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const netRoleRef = useRef(netRole);
  netRoleRef.current = netRole;
  const reconnectCheckRef = useRef<NodeJS.Timeout | null>(null);
  const lastOfferRef = useRef<string | null>(null);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const userNameRef = useRef(userName);
  userNameRef.current = userName;
  const hasConnectedRef = useRef(false);
  const isReconnectingRef = useRef(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    localStorage.setItem('syncgo_username', userName);
  }, [userName]);

  // 心跳检测 - 每30秒发送一次
  useEffect(() => {
    if (netRole !== NetworkRole.None && roomId) {
      sendHeartbeat(roomId);
      heartbeatIntervalRef.current = setInterval(() => {
        sendHeartbeat(roomId);
      }, 30000);
    }
    
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [netRole, roomId]);

  const handleWebRTCMessage = useCallback((message: WebRTCMessage) => {
    switch (message.type) {
      case 'commit-move':
        setOpponentCommitted(true);
        opponentMoveRef.current = message.payload as Point | null;
        
        if (myMoveCommittedRef.current && netRoleRef.current === NetworkRole.Host) {
          const currentRole = hostRoleRef.current;
          const blackMove = currentRole === 'black' ? myMoveRef.current.black : opponentMoveRef.current;
          const whiteMove = currentRole === 'black' ? opponentMoveRef.current : myMoveRef.current.white;
          
          callbacks.onResolveTurn(blackMove, whiteMove);
          
          webrtcManager.sendResolveTurn(blackMove, whiteMove);
          setMyMoveCommitted(false);
          setOpponentCommitted(false);
          opponentMoveRef.current = null;
          myMoveRef.current = { black: null, white: null };
        }
        break;

      case 'cancel-move':
        setOpponentCommitted(false);
        opponentMoveRef.current = null;
        break;

      case 'resolve-turn':
        const resolvePayload = message.payload as { blackMove: Point | null; whiteMove: Point | null };
        callbacks.onResolveTurn(resolvePayload.blackMove, resolvePayload.whiteMove);
        setMyMoveCommitted(false);
        setOpponentCommitted(false);
        break;

      case 'full-sync':
        callbacks.onFullSync(message.payload as GameState);
        break;

      case 'restart-game':
        setMyMoveCommitted(false);
        setOpponentCommitted(false);
        setEndGameRequested(false);
        setOpponentEndGameRequested(false);
        callbacks.onGameRestarted();
        break;

      case 'opponent-disconnected':
        setOpponentDisconnected(true);
        break;

      case 'opponent-reconnected':
        setOpponentDisconnected(false);
        callbacks.onOpponentReconnected();
        break;

      case 'request-end-game':
        setOpponentEndGameRequested(true);
        gameStateRef.current = message.payload as GameState;
        break;

      case 'cancel-end-game':
        setOpponentEndGameRequested(false);
        setEndGameRequested(false);
        break;

      case 'agree-end-game':
        callbacks.onGameEnded(gameStateRef.current || undefined);
        break;

      case 'load-game':
        callbacks.onFullSync(message.payload as GameState);
        break;
    }
  }, [callbacks]);

  const handleWebRTCMessageRef = useRef(handleWebRTCMessage);
  handleWebRTCMessageRef.current = handleWebRTCMessage;

  useEffect(() => {
    webrtcManager.setMessageHandler((message: WebRTCMessage) => {
      handleWebRTCMessageRef.current(message);
    });

    webrtcManager.setConnectionHandler(async (status: ConnectionStatus) => {
      switch (status) {
        case 'connected':
          setConnStatus('CONNECTED');
          setOpponentDisconnected(false);
          hasConnectedRef.current = true;
          isReconnectingRef.current = false;
          if (reconnectCheckRef.current) {
            clearInterval(reconnectCheckRef.current);
            reconnectCheckRef.current = null;
          }
          break;
        case 'connecting':
          setConnStatus('CONNECTING');
          break;
        case 'disconnected':
          if (netRoleRef.current !== NetworkRole.None && hasConnectedRef.current) {
            setOpponentDisconnected(true);
            
            if (netRoleRef.current === NetworkRole.Client && roomIdRef.current) {
              console.log('[Guest] 检测到 Host 掉线，尝试接管...');
              
              const takeoverResult = await takeOverAsHost(roomIdRef.current, userIdRef.current, userNameRef.current);
              
              if (takeoverResult.success) {
                console.log('[Guest→Host] 接管成功，升级为 Host');
                setNetRole(NetworkRole.Host);
                netRoleRef.current = NetworkRole.Host;
                
                const room = await getRoom(roomIdRef.current);
                if (room) {
                  setHostRole(room.hostRole as 'black' | 'white');
                }
                
                const result = await webrtcManager.createRoom(roomIdRef.current, userIdRef.current);
                if (result.success) {
                  setOpponentDisconnected(false);
                  setConnStatus('WAITING');
                  console.log('[Guest→Host] 已创建 offer，等待新 Guest');
                }
              } else {
                console.log('[Guest] 接管失败，等待 Host 的新 offer');
                
                if (reconnectCheckRef.current) {
                  clearInterval(reconnectCheckRef.current);
                }
                
                lastOfferRef.current = null;
                
                reconnectCheckRef.current = setInterval(async () => {
                  try {
                    const offer = await getOffer(roomIdRef.current!);
                    if (offer) {
                      const offerStr = JSON.stringify(offer);
                      if (lastOfferRef.current && offerStr !== lastOfferRef.current) {
                        console.log('[Guest] 检测到新 offer，重连');
                        clearInterval(reconnectCheckRef.current!);
                        reconnectCheckRef.current = null;
                        
                        const result = await webrtcManager.joinRoom(roomIdRef.current!, userIdRef.current);
                        if (result.success) {
                          setOpponentDisconnected(false);
                          setConnStatus('CONNECTED');
                          hasConnectedRef.current = true;
                        }
                      }
                      lastOfferRef.current = offerStr;
                    }
                  } catch (e) {
                    console.error('[Guest] 检查 offer 失败:', e);
                  }
                }, 500);
              }
            } else if (netRoleRef.current === NetworkRole.Host && roomIdRef.current && !isReconnectingRef.current) {
              isReconnectingRef.current = true;
              console.log('[Host] 检测到掉线，创建新 offer');
              
              const result = await webrtcManager.createRoom(roomIdRef.current, userIdRef.current);
              if (result.success) {
                console.log('[Host] 已创建新 offer，等待 Guest');
              } else {
                isReconnectingRef.current = false;
              }
            }
          }
          break;
        case 'failed':
          setConnStatus('FAILED');
          break;
      }
    });

    return () => {
      webrtcManager.disconnect();
      if (reconnectCheckRef.current) {
        clearInterval(reconnectCheckRef.current);
      }
    };
  }, []);

  const refreshRoomList = useCallback(async () => {
    const rooms = await getRoomList();
    setRoomList(rooms.map(room => ({
      roomId: room.roomId,
      playerCount: (room as any).playerCount ?? 0,
      spectatorCount: 0,
      isFull: !!(room as any).isFull,
      hasDisconnected: false,
      blackUserName: (room as any).hostRole === 'black' ? (room as any).hostName : (room as any).guestName,
      whiteUserName: (room as any).hostRole === 'white' ? (room as any).hostName : (room as any).guestName
    })));
  }, []);

  useEffect(() => {
    refreshRoomList();
    const interval = setInterval(refreshRoomList, 1000);
    return () => clearInterval(interval);
  }, [refreshRoomList]);

  const createRoom = useCallback(async (role: 'black' | 'white') => {
    setConnStatus('CONNECTING');
    setHostRole(role);

    try {
      const result = await createRoomInDB(userId, userName, role);
      setRoomId(result.roomId);
      setNetRole(NetworkRole.Host);

      const webrtcResult = await webrtcManager.createRoom(result.roomId, userId);
      
      if (webrtcResult.success) {
        setConnStatus('WAITING');

        callbacks.onRoomUpdated({
          hostName: result.hostName || userName,
          guestName: undefined,
          hostRole: result.role,
          amIHost: true
        });

        roomSubscriptionRef.current = subscribeToRoom(result.roomId, async (room) => {
          if (room && room.guestId && room.status === 'playing') {
            setConnStatus('CONNECTED');
            callbacks.onRoomUpdated({
              hostName: room.hostName,
              guestName: room.guestName || undefined,
              hostRole: room.hostRole,
              amIHost: true
            });
          }
        });

        return result;
      } else {
        setConnStatus('FAILED');
        await deleteRoom(result.roomId);
        setRoomId('');
        setNetRole(NetworkRole.None);
        return null;
      }
    } catch (error) {
      console.error('创建房间失败:', error);
      setConnStatus('FAILED');
      return null;
    }
  }, [userId, userName]);

  const joinRoom = useCallback(async (targetRoomId: string): Promise<{ success: boolean; error?: string }> => {
    setConnStatus('CONNECTING');

    try {
      const room = await getRoom(targetRoomId);
      if (!room) {
        setConnStatus('DISCONNECTED');
        return { success: false, error: '房间不存在' };
      }

      // 如果房间没有 Host，先接管成为 Host
      if (!room.hostId) {
        const claimResult = await claimHost(targetRoomId, userId, userName, 'black');
        if (!claimResult.success) {
          setConnStatus('DISCONNECTED');
          return { success: false, error: claimResult.error || '接管房间失败' };
        }

        setHostRole('black');
        setRoomId(targetRoomId);
        setNetRole(NetworkRole.Host);

        const webrtcResult = await webrtcManager.createRoom(targetRoomId, userId);
        
        if (webrtcResult.success) {
          setConnStatus('WAITING');
          localStorage.setItem('syncgo_room_id', targetRoomId);

          callbacks.onRoomUpdated({
            hostName: userName,
            guestName: undefined,
            hostRole: 'black',
            amIHost: true
          });

          roomSubscriptionRef.current = subscribeToRoom(targetRoomId, async (updatedRoom) => {
            if (updatedRoom && updatedRoom.guestId && updatedRoom.status === 'playing') {
              setConnStatus('CONNECTED');
              callbacks.onRoomUpdated({
                hostName: updatedRoom.hostName,
                guestName: updatedRoom.guestName || undefined,
                hostRole: updatedRoom.hostRole,
                amIHost: true
              });
            }
          });

          return { success: true };
        } else {
          setConnStatus('FAILED');
          setRoomId('');
          setNetRole(NetworkRole.None);
          return { success: false, error: webrtcResult.error };
        }
      }

      setHostRole(room.hostRole as 'black' | 'white');

      const joinResult = await joinRoomInDB(targetRoomId, userId, userName);
      if (!joinResult.success) {
        setConnStatus('DISCONNECTED');
        return { success: false, error: joinResult.error };
      }

      setRoomId(targetRoomId);
      setNetRole(NetworkRole.Client);

      const webrtcResult = await webrtcManager.joinRoom(targetRoomId, userId);
      
      if (webrtcResult.success) {
        setConnStatus('CONNECTED');
        localStorage.setItem('syncgo_room_id', targetRoomId);
        
        const currentRoom = await getRoom(targetRoomId);
        if (currentRoom) {
          callbacks.onRoomUpdated({
            hostName: currentRoom.hostName,
            guestName: currentRoom.guestName || undefined,
            hostRole: currentRoom.hostRole,
            amIHost: false
          });
        }
        
        return { success: true };
      } else {
        setConnStatus('FAILED');
        setRoomId('');
        setNetRole(NetworkRole.None);
        return { success: false, error: webrtcResult.error };
      }
    } catch (error) {
      console.error('加入房间失败:', error);
      setConnStatus('FAILED');
      return { success: false, error: String(error) };
    }
  }, [userId, userName]);

  const leaveRoom = useCallback(async () => {
    if (roomSubscriptionRef.current) {
      roomSubscriptionRef.current.unsubscribe();
      roomSubscriptionRef.current = null;
    }

    await webrtcManager.disconnect();

    if (roomId) {
      // 使用新的 leave API，支持 HOST 转移
      await leaveRoomApi(roomId, userIdRef.current, userNameRef.current);
    }

    setNetRole(NetworkRole.None);
    setRoomId('');
    setConnStatus('DISCONNECTED');
    setMyMoveCommitted(false);
    setOpponentCommitted(false);
    setEndGameRequested(false);
    setOpponentEndGameRequested(false);
    setOpponentDisconnected(false);
  }, [roomId]);

  const commitMove = useCallback((move: Point | null) => {
    setMyMoveCommitted(true);
    
    const myColor = netRoleRef.current === NetworkRole.Host 
      ? hostRoleRef.current 
      : (hostRoleRef.current === 'black' ? 'white' : 'black');
    
    if (myColor === 'black') {
      myMoveRef.current.black = move;
    } else {
      myMoveRef.current.white = move;
    }
    
    webrtcManager.sendMove(move);
  }, []);

  const cancelMove = useCallback(() => {
    if (myMoveCommittedLocal && !opponentCommitted) {
      setMyMoveCommitted(false);
      webrtcManager.sendCancelMove();
    }
  }, [myMoveCommittedLocal, opponentCommitted]);

  const resolveTurn = useCallback((myBlackSelection: Point | null, myWhiteSelection: Point | null) => {
    setMyMoveCommitted(false);
    setOpponentCommitted(false);
    
    const currentRole = hostRoleRef.current;
    const blackMove = currentRole === 'black' ? myBlackSelection : opponentMoveRef.current;
    const whiteMove = currentRole === 'black' ? opponentMoveRef.current : myWhiteSelection;
    
    webrtcManager.sendResolveTurn(blackMove, whiteMove);
    opponentMoveRef.current = null;
  }, []);

  const requestEndGame = useCallback((gameState: GameState) => {
    setEndGameRequested(true);
    gameStateRef.current = gameState;
    webrtcManager.sendRequestEndGame(gameState);
  }, []);

  const cancelEndGame = useCallback(() => {
    setEndGameRequested(false);
    setOpponentEndGameRequested(false);
    webrtcManager.sendCancelEndGame();
  }, []);

  const agreeEndGame = useCallback(() => {
    webrtcManager.sendAgreeEndGame();
    callbacks.onGameEnded(gameStateRef.current || undefined);
  }, [callbacks]);

  const restartGame = useCallback(() => {
    setMyMoveCommitted(false);
    setOpponentCommitted(false);
    setEndGameRequested(false);
    setOpponentEndGameRequested(false);
    webrtcManager.sendRestartGame();
    callbacks.onGameRestarted();
  }, [callbacks]);

  const loadGame = useCallback((gameState: GameState) => {
    webrtcManager.sendLoadGame(gameState);
  }, []);

  const setUserName = useCallback((name: string) => {
    // 验证名称宽度（汉字算2，英文算1，最多4）
    const getDisplayWidth = (str: string) => {
      let width = 0;
      for (const char of str) {
        width += char.charCodeAt(0) > 127 ? 2 : 1;
      }
      return width;
    };
    if (getDisplayWidth(name) <= 4) {
      setUserNameState(name);
    }
  }, []);

  const resetGameState = useCallback(() => {
    setMyMoveCommitted(false);
    setOpponentCommitted(false);
    setEndGameRequested(false);
    setOpponentEndGameRequested(false);
  }, []);

  const reconnect = useCallback(async (savedRoomId: string): Promise<boolean> => {
    setConnStatus('CONNECTING');
    
    try {
      const room = await getRoom(savedRoomId);
      
      if (!room) {
        console.log('[重连] 房间不存在');
        setConnStatus('FAILED');
        return false;
      }

      if (room.status === 'finished') {
        console.log('[重连] 游戏已结束');
        setConnStatus('FAILED');
        return false;
      }

      const isHost = room.hostId === userId;
      console.log(`[重连] 当前 Host: ${room.hostId}, 我: ${userId}, 角色: ${isHost ? 'Host' : 'Guest'}`);
      
      if (isHost) {
        setNetRole(NetworkRole.Host);
        setHostRole(room.hostRole as 'black' | 'white');
        setRoomId(savedRoomId);
        
        const webrtcResult = await webrtcManager.createRoom(savedRoomId, userId);
        
        if (webrtcResult.success) {
          setConnStatus('WAITING');
          
          callbacks.onRoomUpdated({
            hostName: room.hostName,
            guestName: room.guestName || undefined,
            hostRole: room.hostRole,
            amIHost: true
          });

          roomSubscriptionRef.current = subscribeToRoom(savedRoomId, async (updatedRoom) => {
            if (updatedRoom && updatedRoom.guestId && updatedRoom.status === 'playing') {
              setConnStatus('CONNECTED');
              hasConnectedRef.current = true;
              callbacks.onRoomUpdated({
                hostName: updatedRoom.hostName,
                guestName: updatedRoom.guestName || undefined,
                hostRole: updatedRoom.hostRole,
                amIHost: true
              });
            }
          });

          return true;
        }
      } else {
        setNetRole(NetworkRole.Client);
        setHostRole(room.hostRole as 'black' | 'white');
        setRoomId(savedRoomId);
        
        const joinResult = await joinRoomInDB(savedRoomId, userId, userName);
        if (!joinResult.success) {
          console.log('[重连] 加入房间失败:', joinResult.error);
          setConnStatus('FAILED');
          return false;
        }
        
        console.log('[重连] Guest 等待 Host 创建新 offer...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        let webrtcResult = await webrtcManager.joinRoom(savedRoomId, userId);
        
        for (let i = 0; i < 15 && !webrtcResult.success; i++) {
          console.log(`[重连] 等待 Host 重新创建 offer... (${i + 1}/15)`);
          await new Promise(resolve => setTimeout(resolve, 500));
          webrtcResult = await webrtcManager.joinRoom(savedRoomId, userId);
        }
        
        if (webrtcResult.success) {
          setConnStatus('CONNECTED');
          hasConnectedRef.current = true;
          
          callbacks.onRoomUpdated({
            hostName: room.hostName,
            guestName: userName,
            hostRole: room.hostRole,
            amIHost: false
          });

          return true;
        }
      }
      
      setConnStatus('FAILED');
      return false;
    } catch (error) {
      console.error('[重连] 失败:', error);
      setConnStatus('FAILED');
      return false;
    }
  }, [userId, callbacks]);

  const state: NetworkState = {
    netRole,
    connStatus,
    roomId,
    myMoveCommitted: myMoveCommittedLocal,
    opponentCommitted,
    endGameRequested,
    opponentEndGameRequested,
    opponentDisconnected,
    roomList,
    userName,
    userId,
    hostRole
  };

  const actions: NetworkActions = {
    createRoom,
    joinRoom,
    leaveRoom,
    commitMove,
    cancelMove,
    resolveTurn,
    requestEndGame,
    cancelEndGame,
    agreeEndGame,
    restartGame,
    loadGame,
    setUserName,
    refreshRoomList,
    resetGameState,
    reconnect
  };

  return [state, actions];
}
