import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

const generateRoomId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

io.on('connection', (socket) => {
  console.log(`[连接] 用户 ${socket.id} 已连接`);

  socket.on('create-room', (data, callback) => {
    const roomId = generateRoomId();
    const role = data?.role || 'black';
    
    const room = {
      blackPlayer: role === 'black' ? socket.id : null,
      whitePlayer: role === 'white' ? socket.id : null,
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
    
    console.log(`[房间] 用户 ${socket.id} 创建房间 ${roomId}，角色: ${role}`);
    callback({ roomId, role });
  });

  socket.on('join-room', (roomId, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }

    const disconnectedPlayer = room.disconnectedPlayers.find(p => p.socketId !== socket.id);
    if (disconnectedPlayer) {
      if (disconnectedPlayer.role === 'black') {
        room.blackPlayer = socket.id;
      } else {
        room.whitePlayer = socket.id;
      }
      
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = disconnectedPlayer.role;
      
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
      
      console.log(`[重连] 用户 ${socket.id} 重连到房间 ${roomId}，角色: ${disconnectedPlayer.role}`);
      callback({ roomId, role: disconnectedPlayer.role, reconnected: true });
      return;
    }

    if (room.blackPlayer && room.whitePlayer) {
      callback({ error: '房间已满' });
      return;
    }

    let role;
    if (!room.blackPlayer) {
      room.blackPlayer = socket.id;
      role = 'black';
    } else {
      room.whitePlayer = socket.id;
      role = 'white';
    }
    
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;
    
    console.log(`[房间] 用户 ${socket.id} 加入房间 ${roomId}，角色: ${role}`);
    
    const otherPlayer = role === 'black' ? room.whitePlayer : room.blackPlayer;
    if (otherPlayer) {
      io.to(otherPlayer).emit('player-joined', { playerId: socket.id, role });
    }
    
    callback({ roomId, role });
  });

  socket.on('commit-move', (data) => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;
    
    if (!roomId || !role) {
      console.log(`[错误] 用户 ${socket.id} 未加入房间`);
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

  socket.on('request-end-game', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    room.endGameRequested = socket.id;
    socket.to(roomId).emit('opponent-requested-end');
    console.log(`[结束请求] 房间 ${roomId} 用户 ${socket.id} 请求结束游戏`);
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
    io.to(roomId).emit('game-ended');
    room.endGameRequested = null;
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;
    console.log(`[断开] 用户 ${socket.id} 已断开，房间: ${roomId}，角色: ${role}`);
    
    if (roomId && role) {
      const room = rooms.get(roomId);
      if (room) {
        if (role === 'black') {
          room.blackPlayer = null;
        } else {
          room.whitePlayer = null;
        }
        
        room.disconnectedPlayers.push({ socketId: socket.id, role });
        
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
        }, 60000);
        
        console.log(`[断开] 房间 ${roomId} ${role === 'black' ? '黑方' : '白方'} 断开，等待重连`);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[服务器] 同步围棋服务器运行在端口 ${PORT}`);
});
