# SyncGo

试玩：[https://syncgo.pages.dev](https://syncgo.pages.dev)

![预览](assets/preview.png)

## 游戏规则

- 每手棋双方首先各自选择落子点（允许自尽）并同时亮出
- 若双方选择了相同的点，则该手无效，该点成为禁入点
- 若双方选择了不同的点，则该手有效，先将这两子落下，结算所有没有气的棋子标记为提子，然后提掉所有提子
- 若提子包含本回合所有落子，则落子点变为禁入点
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
- **实时通信**: WebRTC P2P + Supabase Realtime
- **部署**: Cloudflare Pages（前端）+ Supabase（信令服务器）
- **图标**: Lucide React

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装与启动

```bash
# 安装依赖
npm install

# 创建 .env 文件（参考 .env.example）
cp .env.example .env

# 启动开发服务器
npm run dev
```

访问 <http://localhost:3000> 开始游戏

### 构建生产版本

```bash
npm run build
```

## 项目结构

```
SyncGo/
├── App.tsx              # 主应用组件
├── components/
│   ├── Goban.tsx        # 棋盘组件
│   └── LeftPanel.tsx    # 左侧面板组件
├── hooks/
│   └── useNetwork.ts    # 网络对战 Hook
├── lib/
│   ├── signaling.ts     # 信令服务器 API 客户端
│   └── webrtc.ts        # WebRTC 连接管理
├── supabase/            # Supabase Edge Functions 信令服务器
├── utils/
│   └── gameLogic.ts     # 游戏逻辑
├── public/
│   └── favicon.svg      # 网站图标
├── types.ts             # TypeScript 类型定义
├── constants.ts         # 常量配置
└── .env.example         # 环境变量示例
```

## 部署方案

### 1. 部署信令服务器（Supabase）

#### 创建 Supabase 项目

1. 访问 [Supabase](https://supabase.com) 创建新项目
2. 记录项目 URL 和 Anon Key

#### 创建数据库表

在 Supabase Dashboard 的 SQL Editor 中执行：

```sql
-- 见 supabase/migrations/001_initial.sql
```

#### 启用 Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
```

#### 部署 Edge Function

```bash
# 登录 Supabase
npx supabase login

# 链接项目
npx supabase link --project-ref your-project-ref

# 部署函数
npx supabase functions deploy signaling

# 设置环境变量
npx supabase secrets set SUPABASE_URL=https://your-project.supabase.co
npx supabase secrets set SUPABASE_ANON_KEY=your-anon-key
```

### 2. 部署前端（Cloudflare Pages）

**GitHub 自动部署（推荐）**

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages
2. 点击 "Create a project" → "Connect to Git"
3. 选择你的 GitHub 仓库
4. 配置构建：
   - **构建命令**: `npm run build`
   - **输出目录**: `dist`
5. 添加环境变量：
   - `VITE_SIGNALING_URL` = `https://your-project.supabase.co/functions/v1/signaling`
   - `VITE_SUPABASE_ANON_KEY` = 你的 Anon Key
6. 点击 "Save and Deploy"

之后每次推送到 GitHub，Cloudflare 会自动重新部署。

## 架构说明

```
┌─────────────┐                    ┌─────────────┐
│   Player A  │◄──── WebRTC P2P ───►│   Player B  │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ Supabase Realtime（房间状态）    │
       │ HTTP（SDP/ICE 交换）            │
       ▼                                  ▼
┌─────────────────────────────────────────────────┐
│              Supabase Edge Functions             │
│         信令服务器 + Realtime 推送               │
└─────────────────────────────────────────────────┘
```

- **WebRTC P2P**: 游戏数据直接在玩家之间传输，低延迟
- **Supabase Realtime**: 房间列表和房间状态实时推送，无需轮询
- **HTTP API**: 用于交换 SDP Offer/Answer 和 ICE Candidates

## 许可证

[MIT](LICENSE)
