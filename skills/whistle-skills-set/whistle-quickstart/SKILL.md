---
name: whistle-quickstart
description: Whistle 代理调试工具——安装配置、HTTPS 证书、移动端抓包、快速上手。适用于：帮用户安装配置 Whistle、配置 HTTPS 抓包、设置移动端代理、解决证书信任问题。
---

# Whistle 快速入门

## 概述

Whistle 是基于 Node.js 的 Web 调试代理工具。本 skill 覆盖安装、启动、HTTPS 配置和移动端抓包。

## 工作流程

### 1. 确认用户环境和需求

- 操作系统（macOS / Windows / Linux）
- 客户端版还是命令行版？
- 需要抓取哪些设备的请求？（本机 / 手机 / 两者）

### 2. 安装

```bash
npm i -g whistle
```

安装后验证：`w2 -V`

### 3. 启动

**基础启动：**
```bash
w2 start              # 默认端口 8899
w2 start -p 8100      # 指定端口
```

**带认证启动：**
```bash
w2 start -n 用户名 -w 密码
```

**启用 HTTPS / SOCKS 端口：**
```bash
w2 start --httpsPort 8001 --socksPort 1080
```

**多实例（端口和存储目录必须唯一）：**
```bash
w2 start -p 8010 -S 8010
w2 start -p 8011 -S 8011
```

**其他常用命令：**
```bash
w2 restart            # 重启
w2 stop               # 停止
w2 status             # 查看状态（含 URL、代理配置说明）
w2 run                # 前台调试模式（实时日志）
```

启动后访问：`http://local.whistlejs.com`

### 4. 配置 HTTPS 抓包

**本机：**
1. 打开 `http://local.whistlejs.com`
2. 点击顶部 **HTTPS** 按钮
3. 勾选 **Enable HTTPS**
4. 按提示下载并安装根证书

**证书安装路径：**
- **macOS**：钥匙串访问 → 系统 → 将 Whistle Root CA 设为"始终信任"
- **Windows**：双击 `.crt` 文件 → 安装到"受信任的根证书颁发机构"
- **Linux**：参考各发行版文档

**Firefox 特殊处理：**
- 方法一：Firefox 单独安装证书（设置 → 隐私与安全 → 证书 → 查看证书 → 导入）
- 方法二：`about:config` 中设置 `security.enterprise_roots.enabled = true`

### 5. 移动端抓包

**前置条件：**
- 手机和电脑在同一局域网
- 电脑防火墙允许 Whistle 端口

**步骤一：安装根证书**
1. 在 Whistle 界面点击 **HTTPS** 按钮查看 QR 码
2. 手机扫描 QR 码下载证书（多扫几个直到成功）
3. 记住 QR 码上的 IP 地址和端口

**iOS 安装证书：**
- 设置 → 通用 → VPN 与设备管理 → 安装配置描述文件
- **关键步骤**：设置 → 通用 → 关于本机 → 证书信任设置 → 找到 Whistle Root CA → 启用完全信任
- 少这一步 HTTPS 页面会无法打开

**Android 安装证书：**
- 设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书
- 输入锁屏密码确认
- Android 12+ 路径为"更多安全设置"
- 华为 EMUI 需先关闭"纯净模式"

**步骤二：配置 Wi-Fi 代理**
1. 手机 Wi-Fi 设置 → 当前网络 → 代理 → 手动
2. 服务器：QR 码上的 IP 地址
3. 端口：QR 码上的端口（默认 8899）

**验证成功（三个条件都要满足）：**
- 手机能正常访问网页
- Whistle 能捕获 HTTPS 请求
- 无安全警告提示

### 6. 故障排查

**抓包列表出现 "Tunnel to"：**
- 确认已启用 HTTPS（安装根证书 + 勾选 Enable HTTPS）
- 如果是 IP 地址请求（非域名），配置规则：`ip[:port] enable://capture`

**手机无法打开 HTTPS 页面：**
- iOS：检查"证书信任设置"是否完全信任
- Android：检查证书是否安装到 CA 证书（非 VPN/应用证书）

**特定 App 无法抓包：**
- App 可能使用 SSL Pinning
- Android 可配置 `network_security_config.xml` 允许用户证书
- iOS 需要越狱或使用其他方案

**Firefox 提示不安全：**
- 安装证书到 Firefox 或启用 `security.enterprise_roots.enabled`

**证书下载失败：**
- 检查设备和 Whistle 主机是否在同一局域网
- 检查防火墙是否拦截了代理端口

## 关键端口和地址

- 默认代理端口：`8899`
- Web UI 地址：`http://local.whistlejs.com`
- 根证书下载地址：`http://[PC-IP]:[端口]/cgi-bin/rootca`
- Online 面板可查看当前 IP 和端口

## 系统代理配置

```bash
w2 proxy              # 设置系统代理到 127.0.0.1:8899
w2 proxy 8100         # 设置系统代理到 127.0.0.1:8100
w2 proxy 0            # 关闭系统代理
```

## 参考

- 规则系统详细文档：触发 `whistle-rules` skill
- 代理映射（Map Local/Map Remote）：触发 `whistle-proxy` skill
- 请求/响应修改：触发 `whistle-rewrite` skill
- 插件开发、CLI、工具类：触发 `whistle-advanced` skill
- 官方文档：https://wproxy.org/docs/
