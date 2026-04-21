import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isLocalDev = !SIGNALING_URL;

function extractSupabaseUrl(url: string): string | null {
  const match = url.match(/^(https:\/\/[a-z]+\.supabase\.co)/);
  return match ? match[1] : null;
}

let supabase: SupabaseClient | null = null;

if (isLocalDev) {
  console.log('[信令] 本地开发模式，使用代理');
} else {
  const supabaseUrl = extractSupabaseUrl(SIGNALING_URL);
  if (supabaseUrl && SUPABASE_KEY) {
    supabase = createClient(supabaseUrl, SUPABASE_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
    console.log('[Realtime] 已初始化, URL:', supabaseUrl);
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = isLocalDev ? path : `${SIGNALING_URL}${path}`;
  
  const headers: Record<string, string> = { 
    'Content-Type': 'application/json',
    ...((options?.headers || {}) as Record<string, string>),
  };
  
  if (SUPABASE_KEY) {
    headers['apikey'] = SUPABASE_KEY;
    headers['Authorization'] = `Bearer ${SUPABASE_KEY}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 错误 ${response.status}: ${errorText}`);
  }

  return await response.json();
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

export async function createRoom(
  hostId: string,
  hostName: string,
  hostRole: 'black' | 'white'
): Promise<{ roomId: string }> {
  return api<{ roomId: string }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ hostId, hostName, hostRole }),
  });
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
  return api<RoomRecord | null>(`/api/rooms/${roomId}`);
}

export async function getRoomList(): Promise<RoomInfo[]> {
  const results = await api<RoomInfo[]>('/api/rooms');
  return results || [];
}

export function subscribeToRoomList(
  callback: (rooms: RoomInfo[]) => void
): { unsubscribe: () => void } {
  console.log('[Realtime] subscribeToRoomList 调用, supabase:', !!supabase);
  
  if (supabase) {
    console.log('[Realtime] 房间列表使用 Realtime 订阅');
    const channel = supabase
      .channel('room-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms' },
        (payload) => {
          console.log('[Realtime] 房间列表变化:', payload);
          getRoomList().then(callback);
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] 房间列表订阅状态:', status);
      });

    getRoomList().then(callback);

    return { unsubscribe: () => supabase?.removeChannel(channel) };
  }

  console.warn('[Realtime] 房间列表回退到轮询模式');
  let unsubscribed = false;
  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;
    try { callback(await getRoomList()); } catch {}
  }, 3000);

  getRoomList().then(callback);

  return { unsubscribe: () => { unsubscribed = true; clearInterval(pollInterval); } };
}

export async function joinRoom(
  roomId: string,
  guestId: string,
  guestName: string
): Promise<{ success: boolean; room?: RoomRecord; error?: string }> {
  return api(`/api/rooms/${roomId}/join`, {
    method: 'PUT',
    body: JSON.stringify({ guestId, guestName }),
  });
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
  return api<RTCSessionDescriptionInit | null>(`/api/rooms/${roomId}/offer`);
}

export async function saveAnswer(roomId: string, answer: RTCSessionDescriptionInit): Promise<void> {
  await api(`/api/rooms/${roomId}/answer`, {
    method: 'PUT',
    body: JSON.stringify({ answer }),
  });
}

export async function getAnswer(roomId: string): Promise<RTCSessionDescriptionInit | null> {
  return api<RTCSessionDescriptionInit | null>(`/api/rooms/${roomId}/answer`);
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
  return api(`/api/rooms/${roomId}/takeover`, {
    method: 'PUT',
    body: JSON.stringify({ newHostId, newHostName }),
  });
}

export async function leaveRoomApi(
  roomId: string,
  userId: string,
  userName: string
): Promise<{ success: boolean; hostTransferred?: boolean; newHostId?: string; error?: string }> {
  return api(`/api/rooms/${roomId}/leave`, {
    method: 'PUT',
    body: JSON.stringify({ userId, userName }),
  });
}

export async function claimHost(
  roomId: string,
  userId: string,
  userName: string,
  hostRole: 'black' | 'white'
): Promise<{ success: boolean; error?: string }> {
  return api(`/api/rooms/${roomId}/claim-host`, {
    method: 'PUT',
    body: JSON.stringify({ userId, userName, hostRole }),
  });
}

export async function sendHeartbeat(roomId: string): Promise<void> {
  await api(`/api/rooms/${roomId}/heartbeat`, { method: 'PUT' });
}

export function subscribeToRoom(
  roomId: string,
  callback: (room: RoomRecord | null) => void
): { unsubscribe: () => void } {
  if (supabase) {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_id=eq.${roomId}` },
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

    getRoom(roomId).then(callback);

    return { unsubscribe: () => supabase?.removeChannel(channel) };
  }

  let unsubscribed = false;
  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;
    try { callback(await getRoom(roomId)); } catch {}
  }, 3000);

  getRoom(roomId).then(callback);

  return { unsubscribe: () => { unsubscribed = true; clearInterval(pollInterval); } };
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
      for (const candidate of candidates) callback(candidate);
    } catch {}
  }, 2000);

  return { unsubscribe: () => { unsubscribed = true; clearInterval(pollInterval); } };
}
