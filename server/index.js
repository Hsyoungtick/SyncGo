import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
  credentials: true
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ["GET", "POST"],
    credentials: true
  },
  pingInterval: 10000,
  pingTimeout: 60000,
  transports: ['websocket', 'polling']
});

const rooms = new Map();

const generateRoomId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const getRoomList = (userId = null) => {
  const roomList = [];
  rooms.forEach((room, roomId) => {
    const playerCount = (room.blackPlayer ? 1 : 0) + (room.whitePlayer ? 1 : 0);
    const spectatorCount = room.spectators ? room.spectators.length : 0;
    const hasDisconnected = room.disconnectedPlayers && room.disconnectedPlayers.length > 0;
    
    const wasInRoom = userId && (
      room.blackUserId === userId || 
      room.whiteUserId === userId ||
      (room.spectators && room.spectators.some(s => s.userId === userId)) ||
      room.disconnectedPlayers.some(p => p.userId === userId)
    );
    
    if (playerCount > 0 || hasDisconnected || spectatorCount > 0) {
      roomList.push({
        roomId,
        playerCount,
        spectatorCount,
        isFull: room.blackPlayer && room.whitePlayer,
        hasDisconnected,
        wasInRoom,
        blackUserName: room.blackUserName,
        whiteUserName: room.whiteUserName
      });
    }
  });
  
  if (userId) {
    roomList.sort((a, b) => {
      if (a.wasInRoom && !b.wasInRoom) return -1;
      if (!a.wasInRoom && b.wasInRoom) return 1;
      return 0;
    });
  }
  
  return roomList;
};

const broadcastRoomList = () => {
  io.sockets.sockets.forEach((socket) => {
    const userId = socket.data.userId;
    socket.emit('room-list', getRoomList(userId));
  });
};

app.get('/api/rooms', (req, res) => {
  res.json(getRoomList());
});

io.on('connection', (socket) => {
  console.log(`[连接] 用户 ${socket.id.slice(-4).toUpperCase()} 已连接`);

  socket.on('register-user', (userId) => {
    socket.data.userId = userId;
    socket.emit('room-list', getRoomList(userId));
  });

  setTimeout(() => {
    socket.emit('room-list', getRoomList(socket.data.userId));
  }, 100);

  socket.on('get-room-list', () => {
    socket.emit('room-list', getRoomList(socket.data.userId));
  });

  socket.on('create-room', (data, callback) => {
    const roomId = generateRoomId();
    const role = data?.role || 'black';
    const userId = data?.userId || socket.id;
    const userName = data?.userName || userId.slice(-4).toUpperCase();
    
    const room = {
      blackPlayer: role === 'black' ? socket.id : null,
      whitePlayer: role === 'white' ? socket.id : null,
      blackUserId: role === 'black' ? userId : null,
      whiteUserId: role === 'white' ? userId : null,
      blackUserName: role === 'black' ? userName : null,
      whiteUserName: role === 'white' ? userName : null,
      spectators: [],
      gameState: null,
      moves: { black: null, white: null },
      committed: { black: false, white: false },
      endGameRequested: null,
      disconnectedPlayers: [],
      reconnectTimeout: null
    };
    
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.data.userId = userId;
    socket.data.userName = userName;
    
    console.log(`[房间] 用户 ${userName} 创建房间 ${roomId}，角色: ${role}`);
    broadcastRoomList();
    callback({ roomId, role });
  });

  socket.on('join-room', (data, callback) => {
    const roomId = typeof data === 'string' ? data : data.roomId;
    const userId = typeof data === 'object' ? data.userId : null;
    const userName = typeof data === 'object' ? data.userName : userId?.slice(-4).toUpperCase() || 'USER';
    
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }

    const disconnectedPlayer = room.disconnectedPlayers.find(p => 
      userId ? p.userId === userId : p.socketId !== socket.id
    );
    if (disconnectedPlayer) {
      if (disconnectedPlayer.role === 'black') {
        room.blackPlayer = socket.id;
        room.blackUserId = disconnectedPlayer.userId;
        room.blackUserName = disconnectedPlayer.userName;
      } else {
        room.whitePlayer = socket.id;
        room.whiteUserId = disconnectedPlayer.userId;
        room.whiteUserName = disconnectedPlayer.userName;
      }
      
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = disconnectedPlayer.role;
      socket.data.userId = disconnectedPlayer.userId;
      socket.data.userName = disconnectedPlayer.userName;
      
      room.disconnectedPlayers = room.disconnectedPlayers.filter(p => p.socketId !== disconnectedPlayer.socketId);
      
      if (room.disconnectedPlayers.length === 0 && room.reconnectTimeout) {
        clearTimeout(room.reconnectTimeout);
        room.reconnectTimeout = null;
      }
      
      const otherPlayer = disconnectedPlayer.role === 'black' ? room.whitePlayer : room.blackPlayer;
      if (otherPlayer) {
        io.to(otherPlayer).emit('opponent-reconnected');
      }
      
      if (room.gameState) {
        socket.emit('full-sync', room.gameState);
      }
      
      console.log(`[重连] 用户 ${disconnectedPlayer.userName} 重连到房间 ${roomId}，角色: ${disconnectedPlayer.role}`);
      broadcastRoomList();
      callback({ roomId, role: disconnectedPlayer.role, reconnected: true, hasOpponent: !!otherPlayer });
      return;
    }

    if (room.blackPlayer && room.whitePlayer) {
      if (userId && (room.blackUserId === userId || room.whiteUserId === userId)) {
        const existingRole = room.blackUserId === userId ? 'black' : 'white';
        
        if (existingRole === 'black') {
          room.blackPlayer = socket.id;
        } else {
          room.whitePlayer = socket.id;
        }
        
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.role = existingRole;
        socket.data.userId = userId;
        socket.data.userName = userName;
        
        if (room.gameState) {
          socket.emit('full-sync', room.gameState);
        }
        
        console.log(`[重连] 相同用户 ${userName} 重新连接到房间 ${roomId}，角色: ${existingRole}`);
        const otherPlayer = existingRole === 'black' ? room.whitePlayer : room.blackPlayer;
        callback({ roomId, role: existingRole, reconnected: true, hasOpponent: !!otherPlayer });
        return;
      }
      
      callback({ error: '房间已满' });
      return;
    }

    let role;
    if (!room.blackPlayer) {
      room.blackPlayer = socket.id;
      room.blackUserId = userId;
      room.blackUserName = userName;
      role = 'black';
    } else {
      room.whitePlayer = socket.id;
      room.whiteUserId = userId;
      room.whiteUserName = userName;
      role = 'white';
    }
    
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.data.userId = userId;
    socket.data.userName = userName;
    
    console.log(`[房间] 用户 ${userName} 加入房间 ${roomId}，角色: ${role}`);
    
    const otherPlayer = role === 'black' ? room.whitePlayer : room.blackPlayer;
    if (otherPlayer) {
      io.to(otherPlayer).emit('player-joined', { playerId: socket.id, role });
    }
    
    broadcastRoomList();
    callback({ roomId, role, hasOpponent: !!otherPlayer });
  });

  socket.on('spectate-room', (data, callback) => {
    const roomId = typeof data === 'string' ? data : data.roomId;
    const userId = typeof data === 'object' ? data.userId : null;
    const userName = typeof data === 'object' ? data.userName : userId?.slice(-4).toUpperCase() || 'USER';
    
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }

    const spectator = {
      socketId: socket.id,
      userId,
      userName
    };
    room.spectators.push(spectator);
    
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'spectator';
    socket.data.userId = userId;
    socket.data.userName = userName;
    
    if (room.gameState) {
      socket.emit('full-sync', room.gameState);
    }
    
    console.log(`[观战] 用户 ${userName} 以观战者身份加入房间 ${roomId}`);
    broadcastRoomList();
    callback({ roomId, role: 'spectator' });
  });

  socket.on('take-seat', (data, callback) => {
    const roomId = socket.data.roomId;
    const seatRole = data.role;
    const currentRole = socket.data.role;
    
    if (!roomId) {
      callback({ error: '未加入房间' });
      return;
    }
    
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }

    if (seatRole === 'black' && room.blackPlayer && room.blackPlayer !== socket.id) {
      callback({ error: '黑方已有人' });
      return;
    }
    if (seatRole === 'white' && room.whitePlayer && room.whitePlayer !== socket.id) {
      callback({ error: '白方已有人' });
      return;
    }

    if (currentRole === 'black') {
      room.blackPlayer = null;
      room.blackUserId = null;
      room.blackUserName = null;
    } else if (currentRole === 'white') {
      room.whitePlayer = null;
      room.whiteUserId = null;
      room.whiteUserName = null;
    } else if (currentRole === 'spectator') {
      room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
    }
    
    if (seatRole === 'black') {
      room.blackPlayer = socket.id;
      room.blackUserId = socket.data.userId;
      room.blackUserName = socket.data.userName;
    } else {
      room.whitePlayer = socket.id;
      room.whiteUserId = socket.data.userId;
      room.whiteUserName = socket.data.userName;
    }
    
    socket.data.role = seatRole;
    
    console.log(`[上座] 用户 ${socket.data.userName} 在房间 ${roomId} 上座为 ${seatRole}`);
    broadcastRoomList();
    callback({ role: seatRole });
  });

  socket.on('leave-seat', (callback) => {
    const roomId = socket.data.roomId;
    const currentRole = socket.data.role;
    
    if (!roomId || (currentRole !== 'black' && currentRole !== 'white')) {
      callback({ error: '无法离座' });
      return;
    }
    
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }

    if (currentRole === 'black') {
      room.blackPlayer = null;
      room.blackUserId = null;
      room.blackUserName = null;
    } else {
      room.whitePlayer = null;
      room.whiteUserId = null;
      room.whiteUserName = null;
    }
    
    room.spectators.push({
      socketId: socket.id,
      userId: socket.data.userId,
      userName: socket.data.userName
    });
    
    socket.data.role = 'spectator';
    
    console.log(`[离座] 用户 ${socket.data.userName} 在房间 ${roomId} 离座成为观战者`);
    broadcastRoomList();
    callback({ role: 'spectator' });
  });

  socket.on('get-room-info', (roomId, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }
    
    callback({
      blackUserId: room.blackUserId,
      blackUserName: room.blackUserName,
      whiteUserId: room.whiteUserId,
      whiteUserName: room.whiteUserName,
      spectators: room.spectators.map(s => ({ userId: s.userId, userName: s.userName }))
    });
  });

  socket.on('commit-move', (data) => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;
    
    if (!roomId || !role) {
      console.log(`[错误] 用户未加入房间`);
      return;
    }
    
    const room = rooms.get(roomId);
    if (!room) return;

    console.log(`[落子] 房间 ${roomId} ${role === 'black' ? '黑方' : '白方'} 确认落子:`, data.move);
    
    room.moves[role] = data.move;
    room.committed[role] = true;

    socket.to(roomId).emit('opponent-committed', { role });

    if (room.committed.black && room.committed.white) {
      console.log(`[结算] 房间 ${roomId} 双方都已确认，发送结算`);
      io.to(roomId).emit('resolve-turn', {
        blackMove: room.moves.black,
        whiteMove: room.moves.white
      });
      
      room.moves = { black: null, white: null };
      room.committed = { black: false, white: false };
    }
  });

  socket.on('cancel-move', () => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;
    
    if (!roomId || !role) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.committed[role] && !room.committed[role === 'black' ? 'white' : 'black']) {
      console.log(`[撤销] 房间 ${roomId} ${role === 'black' ? '黑方' : '白方'} 撤销落子`);
      room.moves[role] = null;
      room.committed[role] = false;
      socket.to(roomId).emit('opponent-cancelled-move', { role });
    }
  });

  socket.on('sync-state', (gameState) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (room) {
      room.gameState = gameState;
    }
  });

  socket.on('request-sync', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (room && room.gameState) {
      socket.emit('full-sync', room.gameState);
    }
  });

  socket.on('restart-game', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (room) {
      room.gameState = null;
      room.moves = { black: null, white: null };
      room.committed = { black: false, white: false };
      room.endGameRequested = null;
      io.to(roomId).emit('game-restarted');
    }
  });

  socket.on('load-game', (gameState) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (room) {
      room.gameState = gameState;
      socket.to(roomId).emit('full-sync', gameState);
      console.log(`[加载棋局] 房间 ${roomId} 用户 ${socket.data.userName} 加载棋局并同步`);
    }
  });

  socket.on('request-end-game', (gameState) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    room.endGameRequested = socket.id;
    room.gameState = gameState;
    socket.to(roomId).emit('opponent-requested-end');
    console.log(`[结束请求] 房间 ${roomId} 用户 ${socket.data.userName} 请求结束游戏`);
  });

  socket.on('cancel-end-game', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.endGameRequested === socket.id) {
      socket.to(roomId).emit('end-game-cancelled');
    } else {
      if (room.endGameRequested) {
        io.to(room.endGameRequested).emit('end-game-rejected');
      }
    }
    room.endGameRequested = null;
    io.to(roomId).emit('end-game-cancelled');
    console.log(`[结束请求] 房间 ${roomId} 结束游戏请求已取消`);
  });

  socket.on('agree-end-game', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    console.log(`[结束请求] 房间 ${roomId} 双方同意结束游戏`);
    io.to(roomId).emit('game-ended', { gameState: room.gameState });
    room.endGameRequested = null;
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;
    const userId = socket.data.userId;
    const userName = socket.data.userName;
    console.log(`[断开] 用户 ${userName || socket.id.slice(-4).toUpperCase()} 已断开，房间: ${roomId}，角色: ${role}`);
    
    if (roomId && role) {
      const room = rooms.get(roomId);
      if (room) {
        if (role === 'spectator') {
          room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
          broadcastRoomList();
        } else {
          if (role === 'black') {
            room.blackPlayer = null;
          } else {
            room.whitePlayer = null;
          }
          
          room.disconnectedPlayers.push({ socketId: socket.id, role, userId, userName });
          
          broadcastRoomList();
          
          const otherPlayer = role === 'black' ? room.whitePlayer : room.blackPlayer;
          if (otherPlayer) {
            io.to(otherPlayer).emit('opponent-disconnected', { canReconnect: true });
          }
          
          if (room.reconnectTimeout) {
            clearTimeout(room.reconnectTimeout);
          }
          
          room.reconnectTimeout = setTimeout(() => {
            console.log(`[重连超时] 房间 ${roomId} 等待重连超时`);
            const r = rooms.get(roomId);
            if (r) {
              if (r.blackPlayer) {
                io.to(r.blackPlayer).emit('opponent-reconnect-timeout');
              }
              if (r.whitePlayer) {
                io.to(r.whitePlayer).emit('opponent-reconnect-timeout');
              }
            }
            rooms.delete(roomId);
            broadcastRoomList();
          }, 60000);
        }
        
        console.log(`[断开] 房间 ${roomId} ${role === 'black' ? '黑方' : '白方'} 断开，等待重连`);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[服务器] 同步围棋服务器运行在端口 ${PORT}`);
});
