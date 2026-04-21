-- ICE 候选表
CREATE TABLE IF NOT EXISTS ice_candidates (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(4) NOT NULL,
  peer_id VARCHAR(50) NOT NULL,
  candidate JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ice_candidates_room_id ON ice_candidates(room_id);

-- 启用 RLS
ALTER TABLE ice_candidates ENABLE ROW LEVEL SECURITY;

-- 允许匿名访问的策略
CREATE POLICY "Allow anonymous access" ON ice_candidates FOR ALL USING (true);

-- 启用 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE ice_candidates;
