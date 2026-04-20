import React from 'react';
import { Users, Wifi, Copy, LogOut, List } from 'lucide-react';
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
}) => {
  // 计算字符串的显示宽度（汉字算2，英文算1）
  const getDisplayWidth = (str: string) => {
    let width = 0;
    for (const char of str) {
      width += char.charCodeAt(0) > 127 ? 2 : 1;
    }
    return width;
  };

  const handleUserNameChange = (value: string) => {
    // 限制显示宽度最多4（汉字算2，英文算1）
    if (getDisplayWidth(value) <= 4) {
      onUserNameChange(value);
    }
  };

  const renderUserNameCard = () => (
    <div className={`${cardClass} w-full`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={18} className={`flex-shrink-0 ${darkMode ? 'text-stone-200' : 'text-stone-600'}`} />
          <span className="text-sm font-medium">ID</span>
        </div>
        <input
          type="text"
          value={userName}
          onChange={(e) => handleUserNameChange(e.target.value)}
          className={`${isMobile ? 'w-16' : 'w-20'} px-2 py-1 text-sm rounded border text-center font-mono font-bold ${
            darkMode 
              ? 'bg-stone-900 border-stone-600 text-stone-100 focus:border-blue-500' 
              : 'bg-white border-stone-300 text-stone-900 focus:border-blue-500'
          } outline-none`}
          placeholder="名称"
        />
      </div>
    </div>
  );

  const renderNetworkStatusCard = () => {
    if (netRole === NetworkRole.None) return null;
    
    const isBlackOccupied = roomPlayerInfo?.blackUserName;
    const isWhiteOccupied = roomPlayerInfo?.whiteUserName;
    
    // 截取名称，最多显示2个中文字（4个字符宽度）
    const truncateName = (name: string | undefined) => {
      if (!name) return '空位';
      if (name.length <= 2) return name;
      return name.slice(0, 2);
    };
    
    return (
      <div className={`${cardClass} w-full`}>
        {/* 第一行：wifi图标、状态和退出按钮 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Wifi size={18} className={`flex-shrink-0 ${darkMode ? 'text-stone-200' : (
              connStatus === 'CONNECTED' ? 'text-green-600' :
                connStatus === 'WAITING' ? 'text-amber-600' : 'text-red-600'
            )}`} />
            <span className={`text-sm px-2 py-0.5 rounded border leading-tight ${darkMode ? 'bg-stone-900 text-stone-100 border-stone-700' : (
                connStatus === 'CONNECTED' ? 'bg-green-100 text-green-700 border-green-200' :
                connStatus === 'WAITING' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-red-100 text-red-700 border-red-200'
              )}`}>
              {connStatus === 'CONNECTED' ? '已连接' :
                connStatus === 'WAITING' ? '等待对手' : '断开连接'}
            </span>
          </div>
          <button
            onClick={onExitRoom}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-red-500 hover:bg-red-100"
            title="退出房间"
          >
            <LogOut size={16} />
          </button>
        </div>
        
        {/* 第二行：黑白图标和名称 */}
        <div className="flex gap-2 mb-2">
          <div className={`flex-1 py-2 px-2 text-sm rounded-lg border flex items-center justify-center gap-2 ${
            darkMode ? 'bg-stone-800 border-stone-700' : 'bg-white border-stone-200'
          }`}>
            <div className={`w-4 h-4 rounded-full ${darkMode ? 'bg-stone-900 border border-stone-100' : 'bg-stone-900'}`}></div>
            <span className={`font-mono text-xs truncate max-w-[2em] ${isBlackOccupied ? (darkMode ? 'text-stone-100' : 'text-stone-900') : mutedTextClass}`}>
              {truncateName(roomPlayerInfo?.blackUserName)}
            </span>
          </div>
          <div className={`flex-1 py-2 px-2 text-sm rounded-lg border flex items-center justify-center gap-2 ${
            darkMode ? 'bg-stone-800 border-stone-700' : 'bg-white border-stone-200'
          }`}>
            <div className={`w-4 h-4 rounded-full ${darkMode ? 'bg-white border border-stone-500' : 'bg-white border border-stone-300'}`}></div>
            <span className={`font-mono text-xs truncate max-w-[2em] ${isWhiteOccupied ? (darkMode ? 'text-stone-100' : 'text-stone-900') : mutedTextClass}`}>
              {truncateName(roomPlayerInfo?.whiteUserName)}
            </span>
          </div>
        </div>
        
        {/* 第三行：房间号 */}
        {roomId && (
          <div className={`text-lg ${mutedTextClass} flex items-center justify-center gap-1`}>
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
            maxLength={4}
          />
        </div>
      </div>
    );
  };

  const renderRoomListCard = () => (
    <div className={`${cardClass} w-full`}>
      <div className="flex items-center gap-2 mb-2">
        <List size={18} className={`flex-shrink-0 ${darkMode ? 'text-stone-200' : 'text-stone-600'}`} />
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
                <span className={`font-mono font-medium ${mutedTextClass}`}>{room.roomId}</span>
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
                  <span className={`flex items-center gap-0.5 ${mutedTextClass}`}>
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
