import { createClient, SupabaseClient } from '@supabase/supabase-js';

const API_BASE = import.meta.env.VITE_SIGNALING_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// 从 Edge Functions URL 提取 Supabase 项目 URL
// 例如: https://xxx.supabase.co/functions/v1/signaling -> https://xxx.supabase.co
function extractSupabaseUrl(url: string): string | null {
  const match = url.match(/^(https:\/\/[a-z]+\.supabase\.co)/);
  return match ? match[1] : null;
}

const SUPABASE_URL = extractSupabaseUrl(API_BASE);

let supabase: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  
  const headers: Record<string, string> = { 
    'Content-Type': 'application/json',
    ...((options?.headers || {}) as Record<string, string>),
  };
  
  if (SUPABASE_KEY) {
    headers['apikey'] = SUPABASE_KEY;
    headers['Authorization'] = `Bearer ${SUPABASE_KEY}`;
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[信令] ${options?.method || 'GET'} ${path} 失败 (${response.status}):`, errorText);
      throw new Error(`API 错误 ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (e) {
    console.error(`[信令] ${options?.method || 'GET'} ${path} 网络错误:`, e);
    throw e;
  }
}

export interface RoomInfo {
  roomId: string;
  hostId: string;
  hostName: string;
  hostRole: 'black' | 'white';
  guestId?: string;
  guestName?: string;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: string;
  needsHost?: boolean;
}

const ROOM_EXPIRY_MS = 4 * 60 * 60 * 1000;

export async function cleanupExpiredRooms(): Promise<void> {
  // 由服务端自动处理
}

export async function createRoom(
  hostId: string,
  hostName: string,
  hostRole: 'black' | 'white'
): Promise<{ roomId: string }> {
  const result = await api<{ roomId: string }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ hostId, hostName, hostRole }),
  });
  return result;
}

export interface RoomRecord {
  roomId: string;
  hostId: string;
  hostName: string;
  hostRole: 'black' | 'white';
  guestId?: string;
  guestName?: string;
  status: 'waiting' | 'playing' | 'finished';
  hostOffer?: string;
  guestAnswer?: string;
}

export async function getRoom(roomId: string): Promise<RoomRecord | null> {
  const result = await api<RoomRecord | null>(`/api/rooms/${roomId}`);
  return result;
}

export async function getRoomList(): Promise<RoomInfo[]> {
  const results = await api<RoomInfo[]>('/api/rooms');
  return results || [];
}

export function subscribeToRoomList(
  callback: (rooms: RoomInfo[]) => void
): { unsubscribe: () => void } {
  if (supabase) {
    const channel = supabase
      .channel('room-list')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
        },
        () => {
          getRoomList().then(callback);
        }
      )
      .subscribe();

    getRoomList().then(callback);

    return {
      unsubscribe: () => {
        supabase?.removeChannel(channel);
      },
    };
  }

  let unsubscribed = false;

  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;

    try {
      const rooms = await getRoomList();
      callback(rooms);
    } catch (e) {
      // 忽略轮询错误
    }
  }, 3000);

  getRoomList().then(callback);

  return {
    unsubscribe: () => {
      unsubscribed = true;
      clearInterval(pollInterval);
    },
  };
}

export async function joinRoom(
  roomId: string,
  guestId: string,
  guestName: string
): Promise<{ success: boolean; room?: RoomRecord; error?: string }> {
  const result = await api<{ success: boolean; room?: RoomRecord; error?: string }>(
    `/api/rooms/${roomId}/join`,
    {
      method: 'PUT',
      body: JSON.stringify({ guestId, guestName }),
    }
  );
  return result;
}

export async function updateRoomStatus(
  roomId: string,
  status: 'waiting' | 'playing' | 'finished'
): Promise<void> {
  await api(`/api/rooms/${roomId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function deleteRoom(roomId: string): Promise<void> {
  await api(`/api/rooms/${roomId}`, { method: 'DELETE' });
}

export async function saveOffer(roomId: string, offer: RTCSessionDescriptionInit): Promise<void> {
  await api(`/api/rooms/${roomId}/offer`, {
    method: 'PUT',
    body: JSON.stringify({ offer }),
  });
}

export async function getOffer(roomId: string): Promise<RTCSessionDescriptionInit | null> {
  const result = await api<RTCSessionDescriptionInit | null>(`/api/rooms/${roomId}/offer`);
  return result;
}

export async function saveAnswer(roomId: string, answer: RTCSessionDescriptionInit): Promise<void> {
  await api(`/api/rooms/${roomId}/answer`, {
    method: 'PUT',
    body: JSON.stringify({ answer }),
  });
}

export async function getAnswer(roomId: string): Promise<RTCSessionDescriptionInit | null> {
  const result = await api<RTCSessionDescriptionInit | null>(`/api/rooms/${roomId}/answer`);
  return result;
}

export async function saveIceCandidate(
  roomId: string,
  peerId: string,
  candidate: RTCIceCandidateInit
): Promise<void> {
  await api(`/api/signaling/${roomId}`, {
    method: 'POST',
    body: JSON.stringify({ peerId, candidate }),
  });
}

export async function getIceCandidates(
  roomId: string,
  excludePeerId?: string
): Promise<RTCIceCandidateInit[]> {
  const params = excludePeerId ? `?excludePeerId=${excludePeerId}` : '';
  const results = await api<RTCIceCandidateInit[]>(`/api/signaling/${roomId}${params}`);
  return results || [];
}

export async function clearSignaling(roomId: string): Promise<void> {
  await api(`/api/signaling/${roomId}`, { method: 'DELETE' });
}

export async function takeOverAsHost(
  roomId: string,
  newHostId: string,
  newHostName: string
): Promise<{ success: boolean; error?: string }> {
  const result = await api<{ success: boolean; error?: string }>(
    `/api/rooms/${roomId}/takeover`,
    {
      method: 'PUT',
      body: JSON.stringify({ newHostId, newHostName }),
    }
  );
  return result;
}

export async function leaveRoomApi(
  roomId: string,
  userId: string,
  userName: string
): Promise<{ success: boolean; hostTransferred?: boolean; newHostId?: string; error?: string }> {
  const result = await api<{ success: boolean; hostTransferred?: boolean; newHostId?: string; error?: string }>(
    `/api/rooms/${roomId}/leave`,
    {
      method: 'PUT',
      body: JSON.stringify({ userId, userName }),
    }
  );
  return result;
}

export async function claimHost(
  roomId: string,
  userId: string,
  userName: string,
  hostRole: 'black' | 'white'
): Promise<{ success: boolean; error?: string }> {
  const result = await api<{ success: boolean; error?: string }>(
    `/api/rooms/${roomId}/claim-host`,
    {
      method: 'PUT',
      body: JSON.stringify({ userId, userName, hostRole }),
    }
  );
  return result;
}

export async function sendHeartbeat(roomId: string): Promise<void> {
  await api(`/api/rooms/${roomId}/heartbeat`, { method: 'PUT' });
}

// 使用 Supabase Realtime 订阅房间变化
export function subscribeToRoom(
  roomId: string,
  callback: (room: RoomRecord | null) => void
): { unsubscribe: () => void } {
  // 如果 Supabase 客户端可用，使用 Realtime
  if (supabase) {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const data = payload.new as any;
          callback({
            roomId: data.room_id,
            hostId: data.host_id,
            hostName: data.host_name,
            hostRole: data.host_role,
            guestId: data.guest_id,
            guestName: data.guest_name,
            status: data.status,
          });
        }
      )
      .subscribe();

    // 立即获取一次当前状态
    getRoom(roomId).then(callback);

    return {
      unsubscribe: () => {
        supabase?.removeChannel(channel);
      },
    };
  }

  // 回退到轮询模式
  let unsubscribed = false;

  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;

    try {
      const room = await getRoom(roomId);
      callback(room);
    } catch (e) {
      // 忽略轮询错误
    }
  }, 3000);

  // 立即获取一次当前状态
  getRoom(roomId).then(callback);

  return {
    unsubscribe: () => {
      unsubscribed = true;
      clearInterval(pollInterval);
    },
  };
}

export function subscribeToSignaling(
  roomId: string,
  peerId: string,
  callback: (candidate: RTCIceCandidateInit) => void
): { unsubscribe: () => void } {
  let unsubscribed = false;

  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;

    try {
      const candidates = await getIceCandidates(roomId, peerId);
      for (const candidate of candidates) {
        callback(candidate);
      }
    } catch (e) {
      // 忽略轮询错误
    }
  }, 2000);

  return {
    unsubscribe: () => {
      unsubscribed = true;
      clearInterval(pollInterval);
    },
  };
}
