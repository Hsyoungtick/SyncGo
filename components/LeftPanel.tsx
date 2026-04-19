import React, { useState } from 'react';
import { Users, Wifi, Copy, DoorOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { NetworkRole, RoomInfo, RoomPlayerInfo } from '../types';

interface LeftPanelProps {
  darkMode: boolean;
  cardClass: string;
  mutedTextClass: string;
  smallButtonClass: string;
  inputClass: string;
  userName: string;
  onUserNameChange: (name: string) => void;
  netRole: NetworkRole;
  connStatus: string;
  roomId: string;
  copyRoomId: (id: string) => void;
  createRoom: (role: 'black' | 'white') => void;
  joinInputId: string;
  setJoinInputId: (v: string) => void;
  roomList: RoomInfo[];
  onExitRoom: () => void;
  isMobile?: boolean;
  roomPlayerInfo?: RoomPlayerInfo;
  currentUserId?: string;
  onTakeSeat?: (role: 'black' | 'white') => void;
  onLeaveSeat?: () => void;
}

const LeftPanel: React.FC<LeftPanelProps> = ({
  darkMode,
  cardClass,
  mutedTextClass,
  smallButtonClass,
  inputClass,
  userName,
  onUserNameChange,
  netRole,
  connStatus,
  roomId,
  copyRoomId,
  createRoom,
  joinInputId,
  setJoinInputId,
  roomList,
  onExitRoom,
  isMobile = false,
  roomPlayerInfo,
  currentUserId,
  onTakeSeat,
  onLeaveSeat,
}) => {
  const [spectatorsExpanded, setSpectatorsExpanded] = useState(false);
  const renderUserNameCard = () => (
    <div className={`${cardClass} w-full`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={18} className={darkMode ? 'text-stone-200' : 'text-stone-600'} />
          <span className="text-sm font-medium">ID</span>
        </div>
        <input
          type="text"
          value={userName}
          onChange={(e) => onUserNameChange(e.target.value)}
          className={`${isMobile ? 'w-20' : 'w-24'} px-2 py-1 text-sm rounded border text-center font-mono font-bold ${
            darkMode 
              ? 'bg-stone-900 border-stone-600 text-stone-100 focus:border-blue-500' 
              : 'bg-white border-stone-300 text-stone-900 focus:border-blue-500'
          } outline-none`}
          maxLength={8}
        />
      </div>
    </div>
  );

  const renderNetworkStatusCard = () => {
    if (netRole === NetworkRole.None) return null;
    
    const isBlackOccupied = roomPlayerInfo?.blackUserName;
    const isWhiteOccupied = roomPlayerInfo?.whiteUserName;
    const isCurrentBlack = roomPlayerInfo?.blackUserId === currentUserId;
    const isCurrentWhite = roomPlayerInfo?.whiteUserId === currentUserId;
    const spectatorCount = roomPlayerInfo?.spectators?.length || 0;
    
    return (
      <div className={`${cardClass} w-full`}>
        <div className="flex items-center justify-start gap-2 mb-2">
          <Wifi size={18} className={darkMode ? 'text-stone-200' : (
            connStatus === 'CONNECTED' ? 'text-green-600' :
              connStatus === 'WAITING' ? 'text-amber-600' : 'text-red-600'
          )} />
          <span className={`text-sm px-2 py-0.5 rounded border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700' : (
              connStatus === 'CONNECTED' ? 'bg-green-100 text-green-700 border-green-200' :
              connStatus === 'WAITING' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-red-100 text-red-700 border-red-200'
            )}`}>
            {connStatus === 'CONNECTED' ? '已连接' :
              connStatus === 'WAITING' ? '等待对手' : '断开连接'}
          </span>
        </div>
        
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => onTakeSeat?.('black')}
            disabled={isBlackOccupied && !isCurrentBlack}
            className={`flex-1 py-2 px-2 text-sm rounded-lg transition-colors border flex flex-col items-center ${
              darkMode ? 'bg-stone-800' : 'bg-white'
            } ${
              isCurrentBlack 
                ? (darkMode ? 'text-stone-100 border-stone-500' : 'text-stone-900 border-stone-400')
                : isBlackOccupied 
                  ? (darkMode ? 'text-stone-500 border-stone-700 cursor-not-allowed' : 'text-stone-400 border-stone-200 cursor-not-allowed')
                  : (darkMode ? 'text-stone-100 border-stone-600 hover:bg-stone-700' : 'text-stone-900 border-stone-300 hover:bg-stone-50')
            }`}
          >
            <div className={`w-4 h-4 rounded-full mb-1 ${darkMode ? 'bg-stone-900 border border-stone-100' : 'bg-stone-900'}`}></div>
            <span className="font-mono text-xs truncate w-full text-center">
              {isBlackOccupied ? roomPlayerInfo?.blackUserName : '空位'}
            </span>
          </button>
          <button
            onClick={() => onTakeSeat?.('white')}
            disabled={isWhiteOccupied && !isCurrentWhite}
            className={`flex-1 py-2 px-2 text-sm rounded-lg transition-colors border flex flex-col items-center ${
              darkMode ? 'bg-stone-800' : 'bg-white'
            } ${
              isCurrentWhite 
                ? (darkMode ? 'text-stone-100 border-stone-500' : 'text-stone-900 border-stone-400')
                : isWhiteOccupied 
                  ? (darkMode ? 'text-stone-500 border-stone-700 cursor-not-allowed' : 'text-stone-400 border-stone-200 cursor-not-allowed')
                  : (darkMode ? 'text-stone-100 border-stone-600 hover:bg-stone-700' : 'text-stone-900 border-stone-300 hover:bg-stone-50')
            }`}
          >
            <div className={`w-4 h-4 rounded-full mb-1 ${darkMode ? 'bg-white border border-stone-500' : 'bg-white border border-stone-300'}`}></div>
            <span className="font-mono text-xs truncate w-full text-center">
              {isWhiteOccupied ? roomPlayerInfo?.whiteUserName : '空位'}
            </span>
          </button>
        </div>
        
        {spectatorCount > 0 && (
          <div className={`${darkMode ? 'bg-stone-900 border-stone-700' : 'bg-stone-50 border-stone-200'} border rounded-lg mb-2`}>
            <button
              onClick={() => setSpectatorsExpanded(!spectatorsExpanded)}
              className={`w-full py-1.5 px-2 text-sm flex items-center justify-between ${mutedTextClass}`}
            >
              <span className="flex items-center gap-1">
                <Users size={14} />
                观战者 ({spectatorCount})
              </span>
              {spectatorsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {spectatorsExpanded && (
              <div className={`px-2 pb-2 space-y-1 ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>
                {roomPlayerInfo?.spectators?.map((s, i) => (
                  <div key={i} className="text-xs font-mono py-0.5">
                    {s.userName}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {roomId && (
          <div className={`text-lg ${mutedTextClass} flex items-center justify-center gap-1 mb-2`}>
            <span className="font-mono font-bold">{roomId}</span>
            <button
              onClick={() => copyRoomId(roomId)}
              className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-200'}`}
              title="复制房间号"
            >
              <Copy size={16} />
            </button>
          </div>
        )}
        
        <button
          onClick={onExitRoom}
          className={`w-full py-1.5 text-sm rounded-lg transition-colors border ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700 hover:bg-stone-800' : 'text-red-600 bg-red-50 hover:bg-red-100 border-red-100'}`}
        >
          退出房间
        </button>
      </div>
    );
  };

  const renderCreateRoomCard = () => {
    if (netRole !== NetworkRole.None) return null;
    
    return (
      <div className={`${cardClass} w-full`}>
        <div className="flex items-center gap-2 mb-3">
          <Wifi size={18} className={darkMode ? 'text-stone-200' : 'text-blue-600'} />
          <span className="text-sm font-medium">创建房间</span>
        </div>
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => createRoom('black')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 ${smallButtonClass}`}
            >
              <div className={`w-4 h-4 rounded-full bg-stone-900 ${darkMode ? 'border border-white' : ''}`}></div>
              <span className="text-sm">执黑</span>
            </button>
            <button
              onClick={() => createRoom('white')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 ${smallButtonClass}`}
            >
              <div className="w-4 h-4 rounded-full bg-white border-2 border-stone-300"></div>
              <span className="text-sm">执白</span>
            </button>
          </div>
          <input
            type="text"
            value={joinInputId}
            onChange={(e) => setJoinInputId(e.target.value.toUpperCase())}
            placeholder="输入房间号加入"
            className={inputClass}
            maxLength={6}
          />
        </div>
      </div>
    );
  };

  const renderRoomListCard = () => (
    <div className={`${cardClass} w-full`}>
      <div className="flex items-center gap-2 mb-2">
        <DoorOpen size={18} className={darkMode ? 'text-stone-200' : 'text-stone-600'} />
        <span className="text-sm font-medium">房间列表</span>
        <span className={`text-xs ${mutedTextClass}`}>({roomList.length})</span>
      </div>
      {roomList.length > 0 ? (
        <div className="max-h-[108px] overflow-y-auto space-y-1 pr-1 scrollbar-thin">
          {roomList.map((room) => {
            const isInThisRoom = netRole !== NetworkRole.None && roomId === room.roomId;
            return (
              <div
                key={room.roomId}
                onClick={() => !room.isFull && !isInThisRoom && setJoinInputId(room.roomId)}
                className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors ${
                  (room.isFull && !room.wasInRoom) || isInThisRoom
                    ? 'opacity-50 cursor-not-allowed' 
                    : 'cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800'
                } ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'}`}
              >
                <span className="font-mono font-medium">{room.roomId}</span>
                <div className="flex items-center gap-1">
                  {room.wasInRoom && !isInThisRoom && (
                    <span className={`text-xs px-1 rounded ${darkMode ? 'bg-yellow-900 text-yellow-200' : 'bg-yellow-100 text-yellow-700'}`}>
                      重连
                    </span>
                  )}
                  {room.hasDisconnected && !room.wasInRoom && !isInThisRoom && (
                    <span className={`text-xs px-1 rounded ${darkMode ? 'bg-amber-900 text-amber-200' : 'bg-amber-100 text-amber-700'}`}>
                      断线
                    </span>
                  )}
                  <span className={`flex items-center gap-0.5 ${room.isFull ? 'text-green-600' : mutedTextClass}`}>
                    <Users size={12} />
                    {room.playerCount}/2
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`text-sm ${mutedTextClass} text-center py-2`}>
          暂无房间
        </div>
      )}
    </div>
  );

  return (
    <>
      {renderUserNameCard()}
      {renderNetworkStatusCard()}
      {renderCreateRoomCard()}
      {renderRoomListCard()}
    </>
  );
};

export default LeftPanel;
