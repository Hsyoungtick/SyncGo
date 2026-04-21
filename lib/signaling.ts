import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

function extractSupabaseUrl(url: string): string | null {
  const match = url.match(/^(https:\/\/[a-z]+\.supabase\.co)/);
  return match ? match[1] : null;
}

let supabase: SupabaseClient | null = null;

const supabaseUrl = extractSupabaseUrl(SIGNALING_URL);
if (supabaseUrl && SUPABASE_KEY) {
  supabase = createClient(supabaseUrl, SUPABASE_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  console.log('[Realtime] 已初始化, URL:', supabaseUrl);
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${SIGNALING_URL}${path}`;
  
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
  if (supabase) {
    console.log('[Realtime] 房间列表使用 Realtime 订阅');
    const channel = supabase
      .channel('room-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms' },
        () => getRoomList().then(callback)
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
  }, 5000);

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
  console.log('[Signaling] 保存 Answer, roomId:', roomId);
  await api(`/api/rooms/${roomId}/answer`, {
    method: 'PUT',
    body: JSON.stringify({ answer }),
  });
  console.log('[Signaling] Answer 已保存');
}

export async function getAnswer(roomId: string): Promise<RTCSessionDescriptionInit | null> {
  return api<RTCSessionDescriptionInit | null>(`/api/rooms/${roomId}/answer`);
}

export async function saveIceCandidate(
  roomId: string,
  peerId: string,
  candidate: RTCIceCandidateInit
): Promise<void> {
  console.log('[Signaling] 保存 ICE 候选, roomId:', roomId, 'peerId:', peerId);
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
    console.log('[Realtime] 订阅房间状态, roomId:', roomId);
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_id=eq.${roomId}` },
        (payload) => {
          console.log('[Realtime] 房间状态变化:', payload);
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
      .subscribe((status) => {
        console.log('[Realtime] 房间状态订阅状态:', status);
      });

    getRoom(roomId).then(callback);

    return { unsubscribe: () => supabase?.removeChannel(channel) };
  }

  console.warn('[Realtime] 房间状态回退到轮询模式');
  let unsubscribed = false;
  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;
    try { callback(await getRoom(roomId)); } catch {}
  }, 5000);

  getRoom(roomId).then(callback);

  return { unsubscribe: () => { unsubscribed = true; clearInterval(pollInterval); } };
}

export function subscribeToAnswer(
  roomId: string,
  callback: (answer: RTCSessionDescriptionInit) => void
): { unsubscribe: () => void } {
  if (supabase) {
    console.log('[Realtime] 订阅 Answer 变化');
    let lastAnswer: string | null = null;
    let callbackCalled = false;
    const channel = supabase
      .channel(`answer:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const data = payload.new as any;
          console.log('[Realtime] rooms 表 UPDATE 事件, guest_answer:', !!data.guest_answer);
          if (data.guest_answer && !callbackCalled && data.guest_answer !== lastAnswer) {
            try {
              const answer = JSON.parse(data.guest_answer);
              lastAnswer = data.guest_answer;
              callbackCalled = true;
              console.log('[Realtime] 收到 Answer');
              callback(answer);
            } catch {}
          }
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Answer 订阅状态:', status);
      });

    return { unsubscribe: () => supabase?.removeChannel(channel) };
  }

  let unsubscribed = false;
  let callbackCalled = false;
  const pollInterval = setInterval(async () => {
    if (unsubscribed || callbackCalled) return;
    try {
      const answer = await getAnswer(roomId);
      if (answer) {
        callbackCalled = true;
        clearInterval(pollInterval);
        callback(answer);
      }
    } catch {}
  }, 2000);

  return { unsubscribe: () => { unsubscribed = true; clearInterval(pollInterval); } };
}

export function subscribeToOffer(
  roomId: string,
  callback: (offer: RTCSessionDescriptionInit) => void
): { unsubscribe: () => void } {
  if (supabase) {
    console.log('[Realtime] 订阅 Offer 变化');
    let lastOffer: string | null = null;
    const channel = supabase
      .channel(`offer:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const data = payload.new as any;
          if (data.host_offer && data.host_offer !== lastOffer) {
            try {
              const offer = JSON.parse(data.host_offer);
              lastOffer = data.host_offer;
              console.log('[Realtime] 收到新 Offer');
              callback(offer);
            } catch {}
          }
        }
      )
      .subscribe();

    return { unsubscribe: () => supabase?.removeChannel(channel) };
  }

  let unsubscribed = false;
  let lastOffer: string | null = null;
  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;
    try {
      const offer = await getOffer(roomId);
      if (offer) {
        const offerStr = JSON.stringify(offer);
        if (lastOffer && offerStr !== lastOffer) {
          clearInterval(pollInterval);
          callback(offer);
        }
        lastOffer = offerStr;
      }
    } catch {}
  }, 2000);

  return { unsubscribe: () => { unsubscribed = true; clearInterval(pollInterval); } };
}

export function subscribeToIceCandidates(
  roomId: string,
  peerId: string,
  callback: (candidate: RTCIceCandidateInit) => void
): { unsubscribe: () => void } {
  if (supabase) {
    console.log('[Realtime] 订阅 ICE 候选');
    const channel = supabase
      .channel(`ice:${roomId}:${peerId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ice_candidates', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const data = payload.new as any;
          console.log('[Realtime] ICE 候选 INSERT 事件, peer_id:', data.peer_id);
          if (data.peer_id !== peerId && data.candidate) {
            console.log('[Realtime] 收到 ICE 候选');
            callback(data.candidate as RTCIceCandidateInit);
          }
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] ICE 订阅状态:', status);
      });

    getIceCandidates(roomId, peerId).then(candidates => {
      console.log('[Realtime] 初始 ICE 候选数量:', candidates.length);
      for (const candidate of candidates) callback(candidate);
    });

    return { unsubscribe: () => supabase?.removeChannel(channel) };
  }

  console.warn('[Realtime] ICE 候选回退到轮询模式');
  let unsubscribed = false;
  const pollInterval = setInterval(async () => {
    if (unsubscribed) return;
    try {
      const candidates = await getIceCandidates(roomId, peerId);
      for (const candidate of candidates) callback(candidate);
    } catch {}
  }, 3000);

  getIceCandidates(roomId, peerId).then(candidates => {
    for (const candidate of candidates) callback(candidate);
  });

  return { unsubscribe: () => { unsubscribed = true; clearInterval(pollInterval); } };
}
