export interface Env {
  DB: D1Database;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // DELETE /api/admin/clear-all - 清理所有房间（管理员）
      if (path === '/api/admin/clear-all' && request.method === 'DELETE') {
        await env.DB.prepare(`DELETE FROM signaling`).run();
        await env.DB.prepare(`DELETE FROM rooms`).run();
        return json({ success: true, message: '所有房间已清理' });
      }

      // GET /api/rooms - 获取房间列表
      if (path === '/api/rooms' && request.method === 'GET') {
        // 清理超过1分钟没有心跳的房间
        const heartbeatExpiry = new Date(Date.now() - 60 * 1000).toISOString();
        await env.DB.prepare(
          `DELETE FROM signaling WHERE room_id IN (SELECT room_id FROM rooms WHERE datetime(last_heartbeat) < datetime(?))`
        ).bind(heartbeatExpiry).run();
        await env.DB.prepare(
          `DELETE FROM rooms WHERE datetime(last_heartbeat) < datetime(?)`
        ).bind(heartbeatExpiry).run();

        const result = await env.DB.prepare(
          `SELECT * FROM rooms WHERE status IN ('waiting', 'playing') ORDER BY created_at DESC LIMIT 20`
        ).all();
        
        return json(result.results.map((r: any) => {
          const hasHost = !!r.host_id;
          const hasGuest = !!r.guest_id;
          return {
            roomId: r.room_id,
            hostId: r.host_id,
            hostName: r.host_name,
            hostRole: r.host_role,
            guestId: r.guest_id,
            guestName: r.guest_name,
            status: r.status,
            createdAt: r.created_at,
            playerCount: (hasHost ? 1 : 0) + (hasGuest ? 1 : 0),
            isFull: hasHost && hasGuest,
            needsHost: !r.host_id,
          };
        }));
      }

      // POST /api/rooms - 创建房间
      if (path === '/api/rooms' && request.method === 'POST') {
        const body = await request.json() as { hostId: string; hostName: string; hostRole: string };
        
        // 获取当前最大的房间号
        const maxRoom = await env.DB.prepare(
          `SELECT MAX(CAST(room_id AS INTEGER)) as max_id FROM rooms`
        ).first();
        
        // 顺序递增房间号
        const nextId = ((maxRoom?.max_id as number) || 0) + 1;
        const roomId = String(Math.min(nextId, 9999)).padStart(4, '0');
        
        await env.DB.prepare(
          `INSERT INTO rooms (room_id, host_id, host_name, host_role, status, last_heartbeat) VALUES (?, ?, ?, ?, 'waiting', CURRENT_TIMESTAMP)`
        ).bind(roomId, body.hostId, body.hostName, body.hostRole).run();
        
        return json({ roomId });
      }

      // PUT /api/rooms/:id/heartbeat - 更新心跳
      const heartbeatMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/heartbeat$/);
      if (heartbeatMatch && request.method === 'PUT') {
        await env.DB.prepare(
          `UPDATE rooms SET last_heartbeat = CURRENT_TIMESTAMP WHERE room_id = ?`
        ).bind(heartbeatMatch[1]).run();
        return json({ success: true });
      }

      // GET /api/rooms/:id - 获取房间
      const roomMatch = path.match(/^\/api\/rooms\/([0-9]{4})$/);
      if (roomMatch && request.method === 'GET') {
        const room = await env.DB.prepare(
          `SELECT * FROM rooms WHERE room_id = ?`
        ).bind(roomMatch[1]).first();
        
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

      // PUT /api/rooms/:id/join - 加入房间
      const joinMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/join$/);
      if (joinMatch && request.method === 'PUT') {
        const body = await request.json() as { guestId: string; guestName: string };
        const roomId = joinMatch[1];
        
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE room_id = ?`).bind(roomId).first();
        
        if (!room) return json({ success: false, error: '房间不存在' });
        
        // 允许原来的 guest 重连
        if (room.guest_id === body.guestId) {
          return json({ success: true, room });
        }
        
        // 新 guest 加入
        if (room.status !== 'waiting') return json({ success: false, error: '房间已满或已开始游戏' });
        if (room.guest_id) return json({ success: false, error: '房间已满' });
        
        await env.DB.prepare(
          `UPDATE rooms SET guest_id = ?, guest_name = ?, status = 'playing' WHERE room_id = ?`
        ).bind(body.guestId, body.guestName, roomId).run();
        
        const updated = await env.DB.prepare(`SELECT * FROM rooms WHERE room_id = ?`).bind(roomId).first();
        return json({ success: true, room: updated });
      }

      // PUT /api/rooms/:id/status - 更新状态
      const statusMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/status$/);
      if (statusMatch && request.method === 'PUT') {
        const body = await request.json() as { status: string };
        await env.DB.prepare(`UPDATE rooms SET status = ? WHERE room_id = ?`).bind(body.status, statusMatch[1]).run();
        return json({ success: true });
      }

      // DELETE /api/rooms/:id - 删除房间
      if (roomMatch && request.method === 'DELETE') {
        await env.DB.prepare(`DELETE FROM signaling WHERE room_id = ?`).bind(roomMatch[1]).run();
        await env.DB.prepare(`DELETE FROM rooms WHERE room_id = ?`).bind(roomMatch[1]).run();
        return json({ success: true });
      }

      // PUT /api/rooms/:id/leave - 离开房间（支持HOST转移）
      const leaveMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/leave$/);
      if (leaveMatch && request.method === 'PUT') {
        const body = await request.json() as { userId: string; userName: string };
        const roomId = leaveMatch[1];
        
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE room_id = ?`).bind(roomId).first();
        
        if (!room) return json({ success: false, error: '房间不存在' });
        
        // 如果是 Host 离开
        if (room.host_id === body.userId) {
          // 检查是否有 Guest
          if (room.guest_id) {
            // Guest 变成 Host
            await env.DB.prepare(
              `UPDATE rooms SET 
                host_id = ?, 
                host_name = ?, 
                host_role = CASE WHEN host_role = 'black' THEN 'white' ELSE 'black' END,
                guest_id = NULL,
                guest_name = NULL,
                host_offer = NULL,
                guest_answer = NULL,
                status = 'waiting'
              WHERE room_id = ?`
            ).bind(room.guest_id, room.guest_name, roomId).run();
            
            // 清除信令数据
            await env.DB.prepare(`DELETE FROM signaling WHERE room_id = ?`).bind(roomId).run();
            
            return json({ success: true, hostTransferred: true, newHostId: room.guest_id });
          } else {
            // 没有 Guest，直接删除房间
            await env.DB.prepare(`DELETE FROM signaling WHERE room_id = ?`).bind(roomId).run();
            await env.DB.prepare(`DELETE FROM rooms WHERE room_id = ?`).bind(roomId).run();
            
            return json({ success: true, hostTransferred: false });
          }
        }
        
        // 如果是 Guest 离开
        if (room.guest_id === body.userId) {
          // 检查是否有 Host
          if (room.host_id) {
            // Host 仍在，只清除 Guest
            await env.DB.prepare(
              `UPDATE rooms SET 
                guest_id = NULL,
                guest_name = NULL,
                status = 'waiting'
              WHERE room_id = ?`
            ).bind(roomId).run();
            
            return json({ success: true, hostTransferred: false });
          } else {
            // 没有 Host，直接删除房间
            await env.DB.prepare(`DELETE FROM signaling WHERE room_id = ?`).bind(roomId).run();
            await env.DB.prepare(`DELETE FROM rooms WHERE room_id = ?`).bind(roomId).run();
            
            return json({ success: true, hostTransferred: false });
          }
        }
        
        return json({ success: false, error: '用户不在此房间' });
      }

      // PUT /api/rooms/:id/claim-host - 接管空Host位置
      const claimHostMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/claim-host$/);
      if (claimHostMatch && request.method === 'PUT') {
        const body = await request.json() as { userId: string; userName: string; hostRole: string };
        const roomId = claimHostMatch[1];
        
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE room_id = ?`).bind(roomId).first();
        
        if (!room) return json({ success: false, error: '房间不存在' });
        if (room.host_id) return json({ success: false, error: '房间已有Host' });
        
        // 成为新的 Host
        await env.DB.prepare(
          `UPDATE rooms SET 
            host_id = ?, 
            host_name = ?, 
            host_role = ?,
            status = 'waiting'
          WHERE room_id = ?`
        ).bind(body.userId, body.userName, body.hostRole, roomId).run();
        
        return json({ success: true });
      }

      // PUT /api/rooms/:id/takeover - Guest 接管成为 Host
      const takeoverMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/takeover$/);
      if (takeoverMatch && request.method === 'PUT') {
        const body = await request.json() as { newHostId: string; newHostName: string };
        const roomId = takeoverMatch[1];
        
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE room_id = ?`).bind(roomId).first();
        
        if (!room) return json({ success: false, error: '房间不存在' });
        if (room.guest_id !== body.newHostId) return json({ success: false, error: '只有当前 Guest 可以接管' });
        
        // 将 Guest 升级为 Host，清除旧的 Host 信息
        await env.DB.prepare(
          `UPDATE rooms SET 
            host_id = ?, 
            host_name = ?, 
            host_role = CASE WHEN host_role = 'black' THEN 'white' ELSE 'black' END,
            guest_id = NULL,
            guest_name = NULL,
            host_offer = NULL,
            guest_answer = NULL,
            status = 'waiting'
          WHERE room_id = ?`
        ).bind(body.newHostId, body.newHostName, roomId).run();
        
        // 清除旧的信令数据
        await env.DB.prepare(`DELETE FROM signaling WHERE room_id = ?`).bind(roomId).run();
        
        return json({ success: true });
      }

      // GET/PUT /api/rooms/:id/offer
      const offerMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/offer$/);
      if (offerMatch) {
        if (request.method === 'GET') {
          const room = await env.DB.prepare(`SELECT host_offer FROM rooms WHERE room_id = ?`).bind(offerMatch[1]).first();
          if (!room?.host_offer) return json(null);
          try { return json(JSON.parse(room.host_offer as string)); } catch { return json(null); }
        }
        if (request.method === 'PUT') {
          const body = await request.json() as { offer: RTCSessionDescriptionInit };
          await env.DB.prepare(`UPDATE rooms SET host_offer = ?, guest_answer = NULL WHERE room_id = ?`).bind(JSON.stringify(body.offer), offerMatch[1]).run();
          return json({ success: true });
        }
      }

      // GET/PUT /api/rooms/:id/answer
      const answerMatch = path.match(/^\/api\/rooms\/([0-9]{4})\/answer$/);
      if (answerMatch) {
        if (request.method === 'GET') {
          const room = await env.DB.prepare(`SELECT guest_answer FROM rooms WHERE room_id = ?`).bind(answerMatch[1]).first();
          if (!room?.guest_answer) return json(null);
          try { return json(JSON.parse(room.guest_answer as string)); } catch { return json(null); }
        }
        if (request.method === 'PUT') {
          const body = await request.json() as { answer: RTCSessionDescriptionInit };
          await env.DB.prepare(`UPDATE rooms SET guest_answer = ? WHERE room_id = ?`).bind(JSON.stringify(body.answer), answerMatch[1]).run();
          return json({ success: true });
        }
      }

      // POST/GET /api/signaling/:roomId
      const sigMatch = path.match(/^\/api\/signaling\/([0-9]{4})$/);
      if (sigMatch) {
        if (request.method === 'POST') {
          const body = await request.json() as { peerId: string; candidate: RTCIceCandidateInit };
          await env.DB.prepare(
            `INSERT INTO signaling (room_id, peer_id, type, data) VALUES (?, ?, 'ice-candidate', ?)`
          ).bind(sigMatch[1], body.peerId, JSON.stringify(body.candidate)).run();
          return json({ success: true });
        }
        if (request.method === 'GET') {
          const excludePeerId = url.searchParams.get('excludePeerId');
          let query = `SELECT * FROM signaling WHERE room_id = ? AND type = 'ice-candidate'`;
          const params: string[] = [sigMatch[1]];
          if (excludePeerId) {
            query += ` AND peer_id != ?`;
            params.push(excludePeerId);
          }
          query += ` ORDER BY created_at ASC`;
          
          const result = await env.DB.prepare(query).bind(...params).all();
          return json(result.results.map((r: any) => {
            try { return JSON.parse(r.data); } catch { return null; }
          }).filter((c: any) => c !== null));
        }
        if (request.method === 'DELETE') {
          await env.DB.prepare(`DELETE FROM signaling WHERE room_id = ?`).bind(sigMatch[1]).run();
          return json({ success: true });
        }
      }

      return json({ error: 'Not Found' }, 404);
    } catch (e) {
      console.error('Worker error:', e);
      return json({ error: String(e) }, 500);
    }
  },
};
