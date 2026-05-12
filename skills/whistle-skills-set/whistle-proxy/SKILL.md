---
name: whistle-proxy
description: Whistle 代理与流量映射——Map Local（本地文件替换）、Map Remote（URL 转发）、DNS 劫持（host/proxy/socks）。当用户需要配置代理映射、本地文件替换、URL 转发、DNS 劫持时触发。
---

# Whistle 代理与流量映射

本 skill 依赖 `whistle-rules` 中定义的规则语法和 pattern 系统。

## 1. Map Local（本地文件替换）

### file —— 直接返回本地文件

```
pattern file://value [filters...]
```

**不请求服务器**，直接返回本地/内联内容。用于本地开发、API Mock。

```
# 目录映射
www.example.com/static file:///Users/xxx/project
# 请求 /static/js/app.js → /Users/xxx/project/static/js/app.js

# 单文件（禁用自动路径追加）
www.example.com file://</Users/xxx/index.html>

# 多目录回退（| 分隔，找不到就找下一个）
www.example.com/static file:///path/a|/path/b|/path/c

# 内联 JSON Mock
www.example.com/api/users file://({"users":[]})
www.example.com/api/data file://({"status":"ok","data":[]})

# 正则捕获组动态路径
^www.example.com/user/*/profile file:///mock/profiles/user-$1.json
```

**文件不存在处理：404**

### xfile —— 文件不存在则请求服务器

```
www.example.com xfile:///Users/xxx/static
```
本地有文件就用本地，没有就请求服务器（适合部分本地化的开发场景）。

### tpl / xtpl —— 模板替换

```
# tpl: 用本地文件做模板（支持模板字符串 ${variable}）
www.example.com/api tpl:///User/xxx/template.json

# xtpl: tpl + 文件不存在时请求服务器
www.example.com/api xtpl:///User/xxx/template.json
```

### rawfile / xrawfile —— 不做 Content-Type 推断

与 file/xfile 相同，但不自动设置 Content-Type。

### file vs resBody

| | file | resBody |
|------|------|------|
| 请求服务器 | 否 | 是（先请求再替换） |
| 状态码 | 200 | 保持原始状态码 |
| 用途 | 完全接管响应 | 修改服务器响应 |

## 2. Map Remote（URL 转发）

```
# 基础 URL 转发
www.example.com/path/to www.test.com/test
# 请求 /path/to/x/y → www.test.com/test/x/y（自动路径追加）

# 指定协议
www.example.com/api https://api.test.com
www.example.com/ws wss://ws.test.com
```

通过写另一个域名/IP:端口来转发请求。支持 HTTP/HTTPS/WebSocket。

## 3. DNS 劫持

### host —— 修改 DNS 解析

```
pattern host://ipOrDomain[:port] [filters...]
```

不写 `host://` 时可直接写 IP：
```
www.example.com 127.0.0.1           # 保留原端口
www.example.com 127.0.0.1:5173      # 指定端口
www.example.com host://www.test.com # CNAME 效果
```

### proxy —— HTTP 代理转发

```
pattern proxy://ipOrDomain[:port] [filters...]
```

```
www.example.com proxy://127.0.0.1:8080
www.example.com proxy://test.proxy.com:8080

# 上游代理指定目标 IP（?host= 参数）
www.example.com proxy://127.0.0.1:8080?host=1.1.1.1:8080
```

### host 与 proxy 优先级

默认只生效一个。规则同时包含 host 和 proxy 时：

| 模式 | 效果 |
|------|------|
| 默认 | 只有 host 生效 |
| `enable://proxyFirst` / `lineProps://proxyFirst` | 只有 proxy 生效 |
| `enable://proxyHost` / `lineProps://proxyHost` | 两者同时生效 |

### 其他代理协议

```
www.example.com socks://127.0.0.1:1080     # SOCKS 代理
www.example.com xsocks://127.0.0.1:1080    # SOCKS + 失败回退
www.example.com https-proxy://ip:port      # HTTPS 代理
www.example.com pac://proxy.pac            # PAC 脚本
```

## 4. 实战场景

### 场景一：前端本地开发（Vite/Webpack Dev Server）

```bash
# 所有页面请求转发到本地 dev server
# 排除静态资源和 API，让它们走原始服务器或本地文件
www.example.com http://localhost:5173 excludeFilter://*/static excludeFilter://*/api

# 静态资源从本地项目目录加载
www.example.com/static file:///Users/xxx/project/static

# API 转发到测试环境
www.example.com/api 10.1.0.1:8080
```

### 场景二：Mock API

```
# 全量接管
www.example.com/api/users file://({"users":[{"id":1,"name":"Alice"}]})

# 状态码过滤（只在后端 500 时返回 mock）
www.example.com/api/orders file://({"orders":[]}) includeFilter://s:500

# 按方法区分
www.example.com/api/user file://({"id":1}) includeFilter://m:GET
www.example.com/api/user file://({"created":true}) includeFilter://m:POST

# JSONP Mock
www.example.com/jsonp file://`(${query.callback}({"status":"ok"}))`
```

### 场景三：跨域调试（生产环境配 CORS）

```bash
# 代理整个站点到本地，配合 host 指向 127.0.0.1
www.example.com proxy://127.0.0.1:5173

# 或者在 rewrite 中处理 CORS（见 whistle-rewrite skill）
```

### 场景四：移动端 H5 调试

```bash
# 手机配置代理指向 Whistle 端口
# 将目标域名所有请求代理到本地 dev server
m.example.com http://192.168.1.100:5173 excludeFilter://*/api
```

## 5. 注意事项

- `host` 和 `proxy` 都作用于 **Final URL**（可在 Overview 面板查看）
- 如果规则中有 URL 改写后又需要 host/proxy，需拆成两条规则
- 多目录回退 `file://` 只在本地文件不存在时尝试下一个路径
- `file://` 返回 200 状态码，如果需要保持原始状态码用 `resBody://`
- 使用 `enable://proxyHost` 时，host 用于 DNS 解析，proxy 用于实际连接
