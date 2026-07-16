# HiFi Box

HiFi Box 是一款完全离线的 Windows 耳机引导式体检工具。它通过标准化声音与复核流程，帮助用户记录声道路由、中心声像、佩戴密封和扫频中的可感知现象。

> 结果反映用户、佩戴、播放链路与耳机的共同作用，不是实验室频响、失真或医疗听力结论。

## 开发

前置条件：Node.js 22+、Rust stable、Windows WebView2 与 Tauri Windows 构建依赖。

```powershell
npm install
npm run tauri:dev
```

常用命令：

```powershell
npm run check
npm run build
npm run build:installer
```

## 结构

- `apps/desktop`：React + Tauri 桌面应用
- `packages/core`：平台无关的数据、协议、状态机与判定规则
- `packages/content`：简体中文界面文案与术语说明
