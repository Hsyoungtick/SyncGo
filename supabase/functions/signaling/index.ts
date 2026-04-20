import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

async function supabaseFetch(table: string, options: {
  method?: string;
  body?: object;
  query?: string;
  headers?: Record<string, string>;
} = {}) {
  const { method = 'GET', body, query = '', headers = {} } = options;
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!res.ok) {
    const text = await res.text();
    console.error('Supabase error:', text);
    return null;
  }
  
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    // DELETE /api/admin/clear-all
    if (path === '/api/admin/clear-all' && req.method === 'DELETE') {
      await supabaseFetch('signaling', { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      await supabaseFetch('rooms', { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      return json({ success: true, message: '所有房间已清理' });
    }

    // GET /api/rooms
    if (path === '/api/rooms' && req.method === 'GET') {
      const heartbeatExpiry = new Date(Date.now() - 60 * 1000).toISOString();
      await supabaseFetch('signaling', { 
        method: 'DELETE', 
        query: `?room_id=in.(select room_id from rooms where last_heartbeat.lt.${heartbeatExpiry})`,
        headers: { 'Prefer': 'return=minimal' }
      });
      await supabaseFetch('rooms', { 
        method: 'DELETE', 
        query: `?last_heartbeat=lt.${heartbeatExpiry}`,
        headers: { 'Prefer': 'return=minimal' }
      });

      const rooms = await supabaseFetch('rooms', {
        query: `?select=*&or=(status.eq.waiting,status.eq.playing)&order=created_at.desc&limit=20`
      });
      
      return json((rooms || []).map((r: any) => ({
        roomId: r.room_id,
        hostId: r.host_id,
        hostName: r.host_name,
        hostRole: r.host_role,
        guestId: r.guest_id,
        guestName: r.guest_name,
        status: r.status,
        createdAt: r.created_at,
        playerCount: (r.host_id ? 1 : 0) + (r.guest_id ? 1 : 0),
        isFull: !!(r.host_id && r.guest_id),
        needsHost: !r.host_id,
      })));
    }

    // POST /api/rooms
    if (path === '/api/rooms' && req.method === 'POST') {
      const body = await req.json() as { hostId: string; hostName: string; hostRole: string };
      
      const maxRoom = await supabaseFetch('rooms', {
        query: `?select=room_id&order=room_id.desc&limit=1`
      });
      
      const maxId = maxRoom && maxRoom.length > 0 ? parseInt(maxRoom[0].room_id) : 0;
      const nextId = Math.min(maxId + 1, 9999);
      const roomId = String(nextId).padStart(4, '0');
      
      await supabaseFetch('rooms', {
        method: 'POST',
        body: {
          room_id: roomId,
          host_id: body.hostId,
          host_name: body.hostName,
          host_role: body.hostRole,
          status: 'waiting',
        },
        headers: { 'Prefer': 'return=minimal' }
      });
      
      return json({ roomId });
    }

    // PUT /api/rooms/:id/heartbeat
    const heartbeatMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/heartbeat$/);
    if (heartbeatMatch && req.method === 'PUT') {
      await supabaseFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${heartbeatMatch[1]}`,
        body: { last_heartbeat: new Date().toISOString() },
        headers: { 'Prefer': 'return=minimal' }
      });
      return json({ success: true });
    }

    // GET /api/rooms/:id
    const roomMatch = path.match(/^\/api\/rooms\/([0-9]{4})$/);
    if (roomMatch && req.method === 'GET') {
      const rooms = await supabaseFetch('rooms', {
        query: `?room_id=eq.${roomMatch[1]}&select=*`
      });
      const room = rooms && rooms.length > 0 ? rooms[0] : null;
      
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
      
      const rooms = await supabaseFetch('rooms', {
        query: `?room_id=eq.${roomId}&select=*`
      });
      const room = rooms && rooms.length > 0 ? rooms[0] : null;
      
      if (!room) return json({ success: false, error: '房间不存在' });
      if (room.guest_id === body.guestId) return json({ success: true, room });
      if (room.status !== 'waiting') return json({ success: false, error: '房间已满或已开始游戏' });
      if (room.guest_id) return json({ success: false, error: '房间已满' });
      
      await supabaseFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${roomId}`,
        body: { guest_id: body.guestId, guest_name: body.guestName, status: 'playing' },
        headers: { 'Prefer': 'return=minimal' }
      });
      
      const updated = await supabaseFetch('rooms', {
        query: `?room_id=eq.${roomId}&select=*`
      });
      return json({ success: true, room: updated && updated.length > 0 ? updated[0] : null });
    }

    // PUT /api/rooms/:id/status
    const statusMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/status$/);
    if (statusMatch && req.method === 'PUT') {
      const body = await req.json() as { status: string };
      await supabaseFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${statusMatch[1]}`,
        body: { status: body.status },
        headers: { 'Prefer': 'return=minimal' }
      });
      return json({ success: true });
    }

    // DELETE /api/rooms/:id
    if (roomMatch && req.method === 'DELETE') {
      await supabaseFetch('signaling', { 
        method: 'DELETE', 
        query: `?room_id=eq.${roomMatch[1]}`,
        headers: { 'Prefer': 'return=minimal' }
      });
      await supabaseFetch('rooms', { 
        method: 'DELETE', 
        query: `?room_id=eq.${roomMatch[1]}`,
        headers: { 'Prefer': 'return=minimal' }
      });
      return json({ success: true });
    }

    // PUT /api/rooms/:id/leave
    const leaveMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/leave$/);
    if (leaveMatch && req.method === 'PUT') {
      const body = await req.json() as { userId: string; userName: string };
      const roomId = leaveMatch[1];
      
      const rooms = await supabaseFetch('rooms', {
        query: `?room_id=eq.${roomId}&select=*`
      });
      const room = rooms && rooms.length > 0 ? rooms[0] : null;
      
      if (!room) return json({ success: false, error: '房间不存在' });
      
      if (room.host_id === body.userId) {
        if (room.guest_id) {
          const newRole = room.host_role === 'black' ? 'white' : 'black';
          await supabaseFetch('rooms', {
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
            headers: { 'Prefer': 'return=minimal' }
          });
          await supabaseFetch('signaling', { 
            method: 'DELETE', 
            query: `?room_id=eq.${roomId}`,
            headers: { 'Prefer': 'return=minimal' }
          });
          return json({ success: true, hostTransferred: true, newHostId: room.guest_id });
        } else {
          await supabaseFetch('signaling', { 
            method: 'DELETE', 
            query: `?room_id=eq.${roomId}`,
            headers: { 'Prefer': 'return=minimal' }
          });
          await supabaseFetch('rooms', { 
            method: 'DELETE', 
            query: `?room_id=eq.${roomId}`,
            headers: { 'Prefer': 'return=minimal' }
          });
          return json({ success: true, hostTransferred: false });
        }
      }
      
      if (room.guest_id === body.userId) {
        if (room.host_id) {
          await supabaseFetch('rooms', {
            method: 'PATCH',
            query: `?room_id=eq.${roomId}`,
            body: { guest_id: null, guest_name: null, status: 'waiting' },
            headers: { 'Prefer': 'return=minimal' }
          });
          return json({ success: true, hostTransferred: false });
        } else {
          await supabaseFetch('signaling', { 
            method: 'DELETE', 
            query: `?room_id=eq.${roomId}`,
            headers: { 'Prefer': 'return=minimal' }
          });
          await supabaseFetch('rooms', { 
            method: 'DELETE', 
            query: `?room_id=eq.${roomId}`,
            headers: { 'Prefer': 'return=minimal' }
          });
          return json({ success: true, hostTransferred: false });
        }
      }
      
      return json({ success: false, error: '用户不在此房间' });
    }

    // PUT /api/rooms/:id/claim-host
    const claimHostMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/claim-host$/);
    if (claimHostMatch && req.method === 'PUT') {
      const body = await req.json() as { userId: string; userName: string; hostRole: string };
      const roomId = claimHostMatch[1];
      
      const rooms = await supabaseFetch('rooms', {
        query: `?room_id=eq.${roomId}&select=*`
      });
      const room = rooms && rooms.length > 0 ? rooms[0] : null;
      
      if (!room) return json({ success: false, error: '房间不存在' });
      if (room.host_id) return json({ success: false, error: '房间已有Host' });
      
      await supabaseFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${roomId}`,
        body: { host_id: body.userId, host_name: body.userName, host_role: body.hostRole, status: 'waiting' },
        headers: { 'Prefer': 'return=minimal' }
      });
      
      return json({ success: true });
    }

    // PUT /api/rooms/:id/takeover
    const takeoverMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/takeover$/);
    if (takeoverMatch && req.method === 'PUT') {
      const body = await req.json() as { newHostId: string; newHostName: string };
      const roomId = takeoverMatch[1];
      
      const rooms = await supabaseFetch('rooms', {
        query: `?room_id=eq.${roomId}&select=*`
      });
      const room = rooms && rooms.length > 0 ? rooms[0] : null;
      
      if (!room) return json({ success: false, error: '房间不存在' });
      if (room.guest_id !== body.newHostId) return json({ success: false, error: '只有当前 Guest 可以接管' });
      
      const newRole = room.host_role === 'black' ? 'white' : 'black';
      await supabaseFetch('rooms', {
        method: 'PATCH',
        query: `?room_id=eq.${roomId}`,
        body: {
          host_id: body.newHostId,
          host_name: body.newHostName,
          host_role: newRole,
          guest_id: null,
          guest_name: null,
          host_offer: null,
          guest_answer: null,
          status: 'waiting',
        },
        headers: { 'Prefer': 'return=minimal' }
      });
      await supabaseFetch('signaling', { 
        method: 'DELETE', 
        query: `?room_id=eq.${roomId}`,
        headers: { 'Prefer': 'return=minimal' }
      });
      
      return json({ success: true });
    }

    // GET/PUT /api/rooms/:id/offer
    const offerMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/offer$/);
    if (offerMatch) {
      if (req.method === 'GET') {
        const rooms = await supabaseFetch('rooms', {
          query: `?room_id=eq.${offerMatch[1]}&select=host_offer`
        });
        const room = rooms && rooms.length > 0 ? rooms[0] : null;
        if (!room?.host_offer) return json(null);
        try { return json(JSON.parse(room.host_offer)); } catch { return json(null); }
      }
      if (req.method === 'PUT') {
        const body = await req.json() as { offer: RTCSessionDescriptionInit };
        await supabaseFetch('rooms', {
          method: 'PATCH',
          query: `?room_id=eq.${offerMatch[1]}`,
          body: { host_offer: JSON.stringify(body.offer), guest_answer: null },
          headers: { 'Prefer': 'return=minimal' }
        });
        return json({ success: true });
      }
    }

    // GET/PUT /api/rooms/:id/answer
    const answerMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/answer$/);
    if (answerMatch) {
      if (req.method === 'GET') {
        const rooms = await supabaseFetch('rooms', {
          query: `?room_id=eq.${answerMatch[1]}&select=guest_answer`
        });
        const room = rooms && rooms.length > 0 ? rooms[0] : null;
        if (!room?.guest_answer) return json(null);
        try { return json(JSON.parse(room.guest_answer)); } catch { return json(null); }
      }
      if (req.method === 'PUT') {
        const body = await req.json() as { answer: RTCSessionDescriptionInit };
        await supabaseFetch('rooms', {
          method: 'PATCH',
          query: `?room_id=eq.${answerMatch[1]}`,
          body: { guest_answer: JSON.stringify(body.answer) },
          headers: { 'Prefer': 'return=minimal' }
        });
        return json({ success: true });
      }
    }

    // POST/GET/DELETE /api/signaling/:roomId
    const sigMatch = path.match(/^\/api\/signaling\/([0-9]{4})$/);
    if (sigMatch) {
      if (req.method === 'POST') {
        const body = await req.json() as { peerId: string; candidate: RTCIceCandidateInit };
        await supabaseFetch('signaling', {
          method: 'POST',
          body: {
            room_id: sigMatch[1],
            peer_id: body.peerId,
            type: 'ice-candidate',
            data: JSON.stringify(body.candidate),
          },
          headers: { 'Prefer': 'return=minimal' }
        });
        return json({ success: true });
      }
      if (req.method === 'GET') {
        const excludePeerId = url.searchParams.get('excludePeerId');
        let query = `?room_id=eq.${sigMatch[1]}&type=eq.ice-candidate&order=created_at.asc`;
        if (excludePeerId) {
          query += `&peer_id=neq.${excludePeerId}`;
        }
        const results = await supabaseFetch('signaling', { query });
        return json((results || []).map((r: any) => {
          try { return JSON.parse(r.data); } catch { return null; }
        }).filter((c: any) => c !== null));
      }
      if (req.method === 'DELETE') {
        await supabaseFetch('signaling', {
          method: 'DELETE',
          query: `?room_id=eq.${sigMatch[1]}`,
          headers: { 'Prefer': 'return=minimal' }
        });
        return json({ success: true });
      }
    }

    return json({ error: 'Not Found' }, 404);
  } catch (e) {
    console.error('Supabase Edge Function error:', e);
    return json({ error: String(e) }, 500);
  }
});
