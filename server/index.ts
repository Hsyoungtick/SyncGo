import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const dbPath = join(__dirname, '..', 'data', 'syncgo.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY,
    host_id TEXT,
    host_name TEXT,
    host_role TEXT,
    guest_id TEXT,
    guest_name TEXT,
    status TEXT DEFAULT 'waiting',
    host_offer TEXT,
    guest_answer TEXT,
    last_heartbeat TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS signaling (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT,
    peer_id TEXT,
    type TEXT,
    data TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'syncgo-signaling-local' });
});

app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY created_at DESC LIMIT 20').all();
  res.json(rooms.map((r: any) => ({
    roomId: r.room_id,
    hostId: r.host_id,
    hostName: r.host_name,
    hostRole: r.host_role,
    guestId: r.guest_id,
    guestName: r.guest_name,
    status: r.status,
    playerCount: (r.host_id ? 1 : 0) + (r.guest_id ? 1 : 0),
    isFull: !!(r.host_id && r.guest_id),
  })));
});

app.post('/api/rooms', (req, res) => {
  const { hostId, hostName, hostRole } = req.body;
  
  const maxRoom = db.prepare('SELECT room_id FROM rooms ORDER BY room_id DESC LIMIT 1').get() as any;
  const maxId = maxRoom?.room_id ? parseInt(maxRoom.room_id) : 0;
  const nextId = String(Math.min(maxId + 1, 9999)).padStart(4, '0');
  
  db.prepare('INSERT INTO rooms (room_id, host_id, host_name, host_role, status) VALUES (?, ?, ?, ?, ?)')
    .run(nextId, hostId, hostName, hostRole, 'waiting');
  
  res.json({ roomId: nextId });
});

app.get('/api/rooms/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(req.params.id) as any;
  if (!room) return res.json(null);
  res.json({
    roomId: room.room_id,
    hostId: room.host_id,
    hostName: room.host_name,
    hostRole: room.host_role,
    guestId: room.guest_id,
    guestName: room.guest_name,
    status: room.status,
    hostOffer: room.host_offer,
    guestAnswer: room.guest_answer,
  });
});

app.put('/api/rooms/:id/join', (req, res) => {
  const { guestId, guestName } = req.body;
  const roomId = req.params.id;
  
  const room = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId) as any;
  if (!room) return res.json({ success: false, error: '房间不存在' });
  if (room.status !== 'waiting') return res.json({ success: false, error: '房间已满或已开始游戏' });
  if (room.guest_id) return res.json({ success: false, error: '房间已满' });
  
  db.prepare('UPDATE rooms SET guest_id = ?, guest_name = ?, status = ? WHERE room_id = ?')
    .run(guestId, guestName, 'playing', roomId);
  
  const updated = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId) as any;
  res.json({ success: true, room: updated });
});

app.put('/api/rooms/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE rooms SET status = ? WHERE room_id = ?').run(status, req.params.id);
  res.json({ success: true });
});

app.put('/api/rooms/:id/heartbeat', (req, res) => {
  db.prepare('UPDATE rooms SET last_heartbeat = ? WHERE room_id = ?')
    .run(new Date().toISOString(), req.params.id);
  res.json({ success: true });
});

app.delete('/api/rooms/:id', (req, res) => {
  db.prepare('DELETE FROM signaling WHERE room_id = ?').run(req.params.id);
  db.prepare('DELETE FROM rooms WHERE room_id = ?').run(req.params.id);
  res.json({ success: true });
});

app.put('/api/rooms/:id/leave', (req, res) => {
  const { userId, userName } = req.body;
  const roomId = req.params.id;
  
  const room = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId) as any;
  if (!room) return res.json({ success: false, error: '房间不存在' });
  
  if (room.host_id === userId) {
    if (room.guest_id) {
      const newRole = room.host_role === 'black' ? 'white' : 'black';
      db.prepare('UPDATE rooms SET host_id = ?, host_name = ?, host_role = ?, guest_id = ?, guest_name = ?, host_offer = ?, guest_answer = ?, status = ? WHERE room_id = ?')
        .run(room.guest_id, room.guest_name, newRole, null, null, null, null, 'waiting', roomId);
      db.prepare('DELETE FROM signaling WHERE room_id = ?').run(roomId);
      return res.json({ success: true, hostTransferred: true, newHostId: room.guest_id });
    }
    db.prepare('DELETE FROM signaling WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId);
    return res.json({ success: true, hostTransferred: false });
  }
  
  if (room.guest_id === userId) {
    if (room.host_id) {
      db.prepare('UPDATE rooms SET guest_id = ?, guest_name = ?, status = ? WHERE room_id = ?')
        .run(null, null, 'waiting', roomId);
      return res.json({ success: true, hostTransferred: false });
    }
    db.prepare('DELETE FROM signaling WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId);
    return res.json({ success: true, hostTransferred: false });
  }
  
  res.json({ success: false, error: '用户不在此房间' });
});

app.get('/api/rooms/:id/offer', (req, res) => {
  const room = db.prepare('SELECT host_offer FROM rooms WHERE room_id = ?').get(req.params.id) as any;
  const offer = room?.host_offer;
  if (!offer) return res.json(null);
  try { res.json(JSON.parse(offer)); } catch { res.json(null); }
});

app.put('/api/rooms/:id/offer', (req, res) => {
  const { offer } = req.body;
  db.prepare('UPDATE rooms SET host_offer = ?, guest_answer = ? WHERE room_id = ?')
    .run(JSON.stringify(offer), null, req.params.id);
  res.json({ success: true });
});

app.get('/api/rooms/:id/answer', (req, res) => {
  const room = db.prepare('SELECT guest_answer FROM rooms WHERE room_id = ?').get(req.params.id) as any;
  const answer = room?.guest_answer;
  if (!answer) return res.json(null);
  try { res.json(JSON.parse(answer)); } catch { res.json(null); }
});

app.put('/api/rooms/:id/answer', (req, res) => {
  const { answer } = req.body;
  db.prepare('UPDATE rooms SET guest_answer = ? WHERE room_id = ?')
    .run(JSON.stringify(answer), req.params.id);
  res.json({ success: true });
});

app.post('/api/signaling/:roomId', (req, res) => {
  const { peerId, candidate } = req.body;
  db.prepare('INSERT INTO signaling (room_id, peer_id, type, data) VALUES (?, ?, ?, ?)')
    .run(req.params.roomId, peerId, 'ice-candidate', JSON.stringify(candidate));
  res.json({ success: true });
});

app.get('/api/signaling/:roomId', (req, res) => {
  const excludePeerId = req.query.excludePeerId as string;
  let query = 'SELECT * FROM signaling WHERE room_id = ? AND type = ? ORDER BY created_at ASC';
  let params: any[] = [req.params.roomId, 'ice-candidate'];
  
  if (excludePeerId) {
    query = 'SELECT * FROM signaling WHERE room_id = ? AND type = ? AND peer_id != ? ORDER BY created_at ASC';
    params = [req.params.roomId, 'ice-candidate', excludePeerId];
  }
  
  const results = db.prepare(query).all(...params) as any[];
  res.json(results.map(r => {
    try { return JSON.parse(r.data); } catch { return null; }
  }).filter(Boolean));
});

app.delete('/api/signaling/:roomId', (req, res) => {
  db.prepare('DELETE FROM signaling WHERE room_id = ?').run(req.params.roomId);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[本地信令服务器] 运行在 http://localhost:${PORT}`);
});
