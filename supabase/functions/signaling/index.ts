const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function dbFetch(table: string, opts: { method?: string; body?: object; query?: string } = {}) {
  const { method = 'GET', body, query = '' } = opts;
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!res.ok) return null;
  
  const text = await res.text();
  if (!text || text === '') return [];
  return JSON.parse(text);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  // Supabase 路径格式: /functions/v1/signaling/xxx -> pathname 是 /signaling/xxx
  const path = url.pathname.replace(/^\/signaling/, '') || '/';

  if (path === '/' || path === '') {
    return json({ status: 'ok', service: 'syncgo-signaling' });
  }

  try {
    // GET /api/rooms - 获取房间列表
    if (path === '/api/rooms' && req.method === 'GET') {
      const rooms = await dbFetch('rooms', { query: '?select=*&order=created_at.desc&limit=20' });
      return json((rooms || []).map((r: any) => ({
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
    }

    // POST /api/rooms - 创建房间
    if (path === '/api/rooms' && req.method === 'POST') {
      let body: { hostId: string; hostName: string; hostRole: string };
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: `无效的JSON: ${String(e)}` }, 400);
      }
      
      try {
        const maxRoom = await dbFetch('rooms', { query: '?select=room_id&order=room_id.desc&limit=1' });
        const maxId = (maxRoom?.[0]?.room_id) ? parseInt(maxRoom[0].room_id) : 0;
        const nextId = String(Math.min(maxId + 1, 9999)).padStart(4, '0');
        
        await dbFetch('rooms', {
          method: 'POST',
          body: {
            room_id: nextId,
            host_id: body.hostId,
            host_name: body.hostName,
            host_role: body.hostRole,
            status: 'waiting',
          },
        });
        
        return json({ roomId: nextId });
      } catch (e) {
        return json({ error: `创建房间失败: ${String(e)}` }, 500);
      }
    }

    // GET /api/rooms/:id
    const roomMatch = path.match(/^\/api\/rooms\/([0-9]{4})$/);
    if (roomMatch && req.method === 'GET') {
      const rooms = await dbFetch('rooms', { query: `?room_id=eq.${roomMatch[1]}&select=*` });
      const room = rooms?.[0] || null;
      if (!room) return json(null);
      return json({
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
    }

    // PUT /api/rooms/:id/join
    const joinMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/join$/);
    if (joinMatch && req.method === 'PUT') {
      const body = await req.json() as { guestId: string; guestName: string };
      const roomId = joinMatch[1];
      
      const rooms = await dbFetch('rooms', { query: `?room_id=eq.${roomId}&select=*` });
      const room = rooms?.[0];
      if (!room) return json({ success: false, error: '房间不存在' });
      if (room.status !== 'waiting') return json({ success: false, error: '房间已满或已开始游戏' });
      if (room.guest_id) return json({ success: false, error: '房间已满' });
      
      await dbFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${roomId}`,
        body: { guest_id: body.guestId, guest_name: body.guestName, status: 'playing' },
      });
      
      const updated = await dbFetch('rooms', { query: `?room_id=eq.${roomId}&select=*` });
      return json({ success: true, room: updated?.[0] || null });
    }

    // PUT /api/rooms/:id/status
    const statusMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/status$/);
    if (statusMatch && req.method === 'PUT') {
      const body = await req.json() as { status: string };
      await dbFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${statusMatch[1]}`,
        body: { status: body.status },
      });
      return json({ success: true });
    }

    // PUT /api/rooms/:id/heartbeat
    const heartbeatMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/heartbeat$/);
    if (heartbeatMatch && req.method === 'PUT') {
      await dbFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${heartbeatMatch[1]}`,
        body: { last_heartbeat: new Date().toISOString() },
      });
      return json({ success: true });
    }

    // DELETE /api/rooms/:id
    if (roomMatch && req.method === 'DELETE') {
      await dbFetch('signaling', { method: 'DELETE', query: `?room_id=eq.${roomMatch[1]}` });
      await dbFetch('rooms', { method: 'DELETE', query: `?room_id=eq.${roomMatch[1]}` });
      return json({ success: true });
    }

    // PUT /api/rooms/:id/leave
    const leaveMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/leave$/);
    if (leaveMatch && req.method === 'PUT') {
      const body = await req.json() as { userId: string; userName: string };
      const roomId = leaveMatch[1];
      
      const rooms = await dbFetch('rooms', { query: `?room_id=eq.${roomId}&select=*` });
      const room = rooms?.[0];
      if (!room) return json({ success: false, error: '房间不存在' });
      
      if (room.host_id === body.userId) {
        if (room.guest_id) {
          const newRole = room.host_role === 'black' ? 'white' : 'black';
          await dbFetch('rooms', {
            method: 'PATCH',
            query: `?room_id=eq.${roomId}`,
            body: {
              host_id: room.guest_id,
              host_name: room.guest_name,
              host_role: newRole,
              guest_id: null,
              guest_name: null,
              host_offer: null,
              guest_answer: null,
              status: 'waiting',
            },
          });
          await dbFetch('signaling', { method: 'DELETE', query: `?room_id=eq.${roomId}` });
          return json({ success: true, hostTransferred: true, newHostId: room.guest_id });
        }
        await dbFetch('signaling', { method: 'DELETE', query: `?room_id=eq.${roomId}` });
        await dbFetch('rooms', { method: 'DELETE', query: `?room_id=eq.${roomId}` });
        return json({ success: true, hostTransferred: false });
      }
      
      if (room.guest_id === body.userId) {
        if (room.host_id) {
          await dbFetch('rooms', {
            method: 'PATCH',
            query: `?room_id=eq.${roomId}`,
            body: { guest_id: null, guest_name: null, status: 'waiting' },
          });
          return json({ success: true, hostTransferred: false });
        }
        await dbFetch('signaling', { method: 'DELETE', query: `?room_id=eq.${roomId}` });
        await dbFetch('rooms', { method: 'DELETE', query: `?room_id=eq.${roomId}` });
        return json({ success: true, hostTransferred: false });
      }
      
      return json({ success: false, error: '用户不在此房间' });
    }

    // GET/PUT /api/rooms/:id/offer
    const offerMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/offer$/);
    if (offerMatch) {
      if (req.method === 'GET') {
        const rooms = await dbFetch('rooms', { query: `?room_id=eq.${offerMatch[1]}&select=host_offer` });
        const offer = rooms?.[0]?.host_offer;
        if (!offer) return json(null);
        try { return json(JSON.parse(offer)); } catch { return json(null); }
      }
      if (req.method === 'PUT') {
        const body = await req.json() as { offer: unknown };
        await dbFetch('rooms', {
          method: 'PATCH',
          query: `?room_id=eq.${offerMatch[1]}`,
          body: { host_offer: JSON.stringify(body.offer), guest_answer: null },
        });
        return json({ success: true });
      }
    }

    // GET/PUT /api/rooms/:id/answer
    const answerMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/answer$/);
    if (answerMatch) {
      if (req.method === 'GET') {
        const rooms = await dbFetch('rooms', { query: `?room_id=eq.${answerMatch[1]}&select=guest_answer` });
        const answer = rooms?.[0]?.guest_answer;
        if (!answer) return json(null);
        try { return json(JSON.parse(answer)); } catch { return json(null); }
      }
      if (req.method === 'PUT') {
        const body = await req.json() as { answer: unknown };
        await dbFetch('rooms', {
          method: 'PATCH',
          query: `?room_id=eq.${answerMatch[1]}`,
          body: { guest_answer: JSON.stringify(body.answer) },
        });
        return json({ success: true });
      }
    }

    // POST/GET/DELETE /api/signaling/:roomId
    const sigMatch = path.match(/^\/api\/signaling\/([0-9]{4})$/);
    if (sigMatch) {
      if (req.method === 'POST') {
        const body = await req.json() as { peerId: string; candidate: unknown };
        await dbFetch('signaling', {
          method: 'POST',
          body: {
            room_id: sigMatch[1],
            peer_id: body.peerId,
            type: 'ice-candidate',
            data: JSON.stringify(body.candidate),
          },
        });
        return json({ success: true });
      }
      if (req.method === 'GET') {
        const excludePeerId = url.searchParams.get('excludePeerId');
        let q = `?room_id=eq.${sigMatch[1]}&type=eq.ice-candidate&order=created_at.asc`;
        if (excludePeerId) q += `&peer_id=neq.${excludePeerId}`;
        const results = await dbFetch('signaling', { query: q });
        return json((results || []).map((r: any) => {
          try { return JSON.parse(r.data); } catch { return null; }
        }).filter(Boolean));
      }
      if (req.method === 'DELETE') {
        await dbFetch('signaling', { method: 'DELETE', query: `?room_id=eq.${sigMatch[1]}` });
        return json({ success: true });
      }
    }

    return json({ error: 'Not Found' }, 404);
  } catch (e: unknown) {
    console.error('Error:', e);
    return json({ error: String(e) }, 500);
  }
});
