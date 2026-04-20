import { Point, BoardState, MoveRecord } from '../types';
import {
  saveOffer,
  saveAnswer,
  getOffer,
  getAnswer,
  saveIceCandidate,
  getIceCandidates,
  clearSignaling,
  subscribeToSignaling,
  getRoom
} from './signaling';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

export interface GameState {
  board: BoardState;
  captures: { black: number; white: number };
  turn: number;
  history: MoveRecord[];
  lastClash: Point | null;
}

export interface WebRTCMessage {
  type: 'commit-move' | 'cancel-move' | 'resolve-turn' | 'full-sync' | 
        'restart-game' | 'opponent-disconnected' | 'opponent-reconnected' |
        'request-end-game' | 'cancel-end-game' | 'agree-end-game' | 'load-game';
  payload?: unknown;
}

export type MessageHandler = (message: WebRTCMessage) => void;
export type ConnectionHandler = (status: ConnectionStatus) => void | Promise<void>;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.stunprotocol.org:3478' }
  ]
};

const DATA_CHANNEL_LABEL = 'syncgo-game';

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private roomId: string = '';
  private peerId: string = '';
  private isHost: boolean = false;
  private messageHandler: MessageHandler | null = null;
  private connectionHandler: ConnectionHandler | null = null;
  private signalingSubscription: { unsubscribe: () => void } | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private lastReceivedTime: number = 0;
  private isReconnecting: boolean = false;
  private waitAnswerId: number = 0;

  constructor() {
    this.handleMessage = this.handleMessage.bind(this);
    this.handleConnectionStateChange = this.handleConnectionStateChange.bind(this);
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  setConnectionHandler(handler: ConnectionHandler): void {
    this.connectionHandler = handler;
  }

  private updateStatus(status: ConnectionStatus): void {
    if (this.connectionHandler) {
      this.connectionHandler(status);
    }
  }

  private handleMessage(event: MessageEvent): void {
    this.lastReceivedTime = Date.now();
    try {
      const message: WebRTCMessage = JSON.parse(event.data);
      
      if (this.messageHandler) {
        this.messageHandler(message);
      }
    } catch (error) {
      console.error('[WebRTC] 解析消息失败:', error);
    }
  }

  private handleConnectionStateChange(): void {
    if (!this.peerConnection) return;

    const state = this.peerConnection.connectionState;
    console.log('[WebRTC] 连接状态:', state);

    switch (state) {
      case 'connected':
        this.updateStatus('connected');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        break;
      case 'disconnected':
        this.updateStatus('disconnected');
        break;
      case 'failed':
        this.updateStatus('failed');
        break;
      case 'closed':
        this.updateStatus('disconnected');
        break;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting) return;
    
    this.isReconnecting = true;
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.log('[WebRTC] 重连失败，超过最大尝试次数');
      this.updateStatus('failed');
      this.isReconnecting = false;
      return;
    }

    console.log(`[WebRTC] 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    try {
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      await this.createPeerConnection();

      if (this.isHost) {
        this.dataChannel = this.peerConnection!.createDataChannel(DATA_CHANNEL_LABEL);
        this.setupDataChannel();
        await this.createOffer();
        this.waitForAnswerInBackground();
      } else {
        const offer = await getOffer(this.roomId);
        if (!offer) {
          throw new Error('无法获取 offer');
        }
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));
        
        const existingCandidates = await getIceCandidates(this.roomId, this.peerId);
        for (const candidate of existingCandidates) {
          await this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
        }
        
        await this.createAnswer();
        
        this.signalingSubscription = subscribeToSignaling(
          this.roomId,
          this.peerId,
          async (candidate) => {
            if (this.peerConnection) {
              await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
          }
        );
      }
    } catch (error) {
      console.error('[WebRTC] 重连失败:', error);
      this.isReconnecting = false;
    }
  }

  private async createPeerConnection(): Promise<void> {
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    this.peerConnection.onconnectionstatechange = this.handleConnectionStateChange;

    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate && this.roomId && this.peerId) {
        await saveIceCandidate(this.roomId, this.peerId, event.candidate.toJSON());
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel();
    };
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('[WebRTC] 数据通道已打开');
      this.updateStatus('connected');
    };

    this.dataChannel.onclose = () => {
      console.log('[WebRTC] 数据通道已关闭');
      if (!this.isHost || this.peerConnection?.connectionState !== 'connected') {
        this.updateStatus('disconnected');
      }
    };

    this.dataChannel.onmessage = this.handleMessage;

    this.dataChannel.onerror = (error) => {
      console.error('[WebRTC] 数据通道错误:', error);
      this.updateStatus('disconnected');
    };
  }

  async createRoom(
    roomId: string,
    peerId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.roomId = roomId;
    this.peerId = peerId;
    this.isHost = true;
    this.waitAnswerId++;
    const currentWaitId = this.waitAnswerId;

    try {
      this.updateStatus('connecting');
      
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      if (this.dataChannel) {
        this.dataChannel.close();
        this.dataChannel = null;
      }
      
      await this.createPeerConnection();

      this.dataChannel = this.peerConnection!.createDataChannel(DATA_CHANNEL_LABEL);
      this.setupDataChannel();

      await this.createOffer();

      this.signalingSubscription = subscribeToSignaling(
        this.roomId,
        this.peerId,
        async (candidate) => {
          if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          }
        }
      );

      this.waitForAnswerInBackground(currentWaitId);

      return { success: true };
    } catch (error) {
      console.error('[WebRTC] 创建房间失败:', error);
      return { success: false, error: String(error) };
    }
  }

  private async createOffer(): Promise<void> {
    if (!this.peerConnection) return;
    
    await clearSignaling(this.roomId);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    await saveOffer(this.roomId, offer);

    await this.waitForIceGathering();
  }

  private async waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.peerConnection) {
        resolve();
        return;
      }

      if (this.peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (this.peerConnection?.iceGatheringState === 'complete') {
          this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.peerConnection.addEventListener('icegatheringstatechange', checkState);
      
      setTimeout(resolve, 3000);
    });
  }

  private async waitForAnswer(waitId: number): Promise<void> {
    const maxAttempts = 60;
    const interval = 1000;

    for (let i = 0; i < maxAttempts; i++) {
      if (waitId !== this.waitAnswerId) {
        console.log('[WebRTC] 等待被取消（新的 offer 已创建）');
        return;
      }
      
      const answer = await getAnswer(this.roomId);
      if (answer) {
        await this.peerConnection?.setRemoteDescription(new RTCSessionDescription(answer));
        
        const candidates = await getIceCandidates(this.roomId, this.peerId);
        for (const candidate of candidates) {
          await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error('等待对方连接超时');
  }

  private async waitForAnswerInBackground(waitId: number): Promise<void> {
    console.log('[WebRTC] 开始后台等待对方加入...');
    try {
      await this.waitForAnswer(waitId);
      console.log('[WebRTC] 对方已加入，P2P 连接建立');
    } catch (e) {
      console.log('[WebRTC] 等待对方超时，继续等待中...');
    }
  }

  async joinRoom(
    roomId: string,
    peerId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.roomId = roomId;
    this.peerId = peerId;
    this.isHost = false;

    try {
      this.updateStatus('connecting');

      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      const room = await getRoom(roomId);
      if (!room) {
        return { success: false, error: '房间不存在' };
      }

      await this.createPeerConnection();

      const offer = await getOffer(roomId);
      if (!offer) {
        return { success: false, error: '房间信令数据不存在' };
      }

      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));

      const existingCandidates = await getIceCandidates(roomId, this.peerId);
      for (const candidate of existingCandidates) {
        await this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
      }

      await this.createAnswer();

      this.signalingSubscription = subscribeToSignaling(
        this.roomId,
        this.peerId,
        async (candidate) => {
          if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('[WebRTC] 加入房间失败:', error);
      return { success: false, error: String(error) };
    }
  }

  private async createAnswer(): Promise<void> {
    if (!this.peerConnection) return;

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    await saveAnswer(this.roomId, answer);

    await this.waitForIceGathering();
  }

  send(message: WebRTCMessage): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('[WebRTC] 数据通道未打开，无法发送消息');
      return false;
    }

    try {
      this.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WebRTC] 发送消息失败:', error);
      return false;
    }
  }

  sendMove(move: Point | null): void {
    this.send({ type: 'commit-move', payload: move });
  }

  sendCancelMove(): void {
    this.send({ type: 'cancel-move' });
  }

  sendResolveTurn(blackMove: Point | null, whiteMove: Point | null): void {
    this.send({ type: 'resolve-turn', payload: { blackMove, whiteMove } });
  }

  sendFullSync(gameState: GameState): void {
    this.send({ type: 'full-sync', payload: gameState });
  }

  sendRestartGame(): void {
    this.send({ type: 'restart-game' });
  }

  sendDisconnected(): void {
    this.send({ type: 'opponent-disconnected' });
  }

  sendRequestEndGame(gameState: GameState): void {
    this.send({ type: 'request-end-game', payload: gameState });
  }

  sendCancelEndGame(): void {
    this.send({ type: 'cancel-end-game' });
  }

  sendAgreeEndGame(): void {
    this.send({ type: 'agree-end-game' });
  }

  sendLoadGame(gameState: GameState): void {
    this.send({ type: 'load-game', payload: gameState });
  }

  async disconnect(): Promise<void> {
    if (this.signalingSubscription) {
      this.signalingSubscription.unsubscribe();
      this.signalingSubscription = null;
    }

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.roomId) {
      await clearSignaling(this.roomId);
    }

    this.roomId = '';
    this.peerId = '';
    this.isHost = false;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    
    this.updateStatus('disconnected');
  }

  isConnected(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  getRoomId(): string {
    return this.roomId;
  }

  isHostPlayer(): boolean {
    return this.isHost;
  }
}

export const webrtcManager = new WebRTCManager();
