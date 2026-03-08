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

  socket.on('create-room', (callback) => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      host: socket.id,
      guest: null,
      gameState: null,
      moves: { black: null, white: null },
      committed: { black: false, white: false }
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'black';
    console.log(`[房间] 用户 ${socket.id} 创建房间 ${roomId}`);
    callback({ roomId, role: 'black' });
  });

  socket.on('join-room', (roomId, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }
    if (room.guest) {
      callback({ error: '房间已满' });
      return;
    }
    
    room.guest = socket.id;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'white';
    
    console.log(`[房间] 用户 ${socket.id} 加入房间 ${roomId}`);
    
    io.to(room.host).emit('player-joined', { guestId: socket.id });
    callback({ roomId, role: 'white' });
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
      io.to(roomId).emit('game-restarted');
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    console.log(`[断开] 用户 ${socket.id} 已断开，房间: ${roomId}`);
    
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const otherPlayer = room.host === socket.id ? room.guest : room.host;
        if (otherPlayer) {
          io.to(otherPlayer).emit('opponent-disconnected');
        }
        
        if (room.host === socket.id) {
          rooms.delete(roomId);
          console.log(`[房间] 房间 ${roomId} 已删除`);
        } else {
          room.guest = null;
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[服务器] 同步围棋服务器运行在端口 ${PORT}`);
});
