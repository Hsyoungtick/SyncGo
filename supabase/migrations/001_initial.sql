-- 房间表
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(4) UNIQUE NOT NULL,
  host_id VARCHAR(50),
  host_name VARCHAR(50),
  host_role VARCHAR(10),
  guest_id VARCHAR(50),
  guest_name VARCHAR(50),
  status VARCHAR(20) DEFAULT 'waiting',
  host_offer TEXT,
  guest_answer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);

-- 信令表
CREATE TABLE IF NOT EXISTS signaling (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(4) NOT NULL,
  peer_id VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_rooms_room_id ON rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_last_heartbeat ON rooms(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_signaling_room_id ON signaling(room_id);

-- 启用 RLS (Row Level Security)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE signaling ENABLE ROW LEVEL SECURITY;

-- 允许匿名访问的策略
CREATE POLICY "Allow anonymous access" ON rooms FOR ALL USING (true);
CREATE POLICY "Allow anonymous access" ON signaling FOR ALL USING (true);
