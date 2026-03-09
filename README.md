# 同步围棋

双方同时落子的围棋，支持本地双人和局域网对战。

## 游戏规则

- 每手棋双方首先各自选择落子点（允许自尽）并同时亮出。
- 若双方选择了相同的点，则该手无效，该点成为禁入点
- 若双方选择了不同的点，则该手有效，先将这两子落下，结算所有没有气的棋子标记为提子，然后提掉所有提子
- 如果提子只包含这回合下的子，则这两个位置都成为禁入点
- 禁入点可以作为棋子的气，双方之后不能再下在该点，直到选择了不同的点
- 无贴目

## 功能特性

- 🎮 本地双人对战
- 🌐 网络实时对战
- 📊 形势判断
- 💾 棋谱保存/加载
- ⚡ 快速模式
- 📱 响应式设计

## 技术栈

- **前端**: React 19 + TypeScript + Tailwind CSS v4
- **构建工具**: Vite 6
- **实时通信**: Socket.io
- **图标**: Lucide React

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装依赖

```bash
# 前端依赖
npm install

# 服务端依赖
cd server && npm install
```

### 启动游戏

```powershell
# Windows: 使用启动脚本
./start.ps1

# 或手动启动
# 终端1 - 启动服务端
cd server && node index.js

# 终端2 - 启动前端
npm run dev
```

访问 http://localhost:3000 开始游戏

### 构建生产版本

```bash
npm run build
```

## 项目结构

```
同步围棋/
├── App.tsx           # 主应用组件
├── components/
│   └── Goban.tsx     # 棋盘组件
├── utils/
│   └── gameLogic.ts  # 游戏逻辑
├── server/
│   └── index.js      # Socket.io 服务端
├── types.ts          # TypeScript 类型定义
└── constants.ts      # 常量配置
```
