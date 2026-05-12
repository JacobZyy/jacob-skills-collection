---
name: whistle-rules
description: Whistle 规则系统核心——规则语法、匹配模式（pattern）、操作指令（operation）、过滤器（filters）。所有 whistle-* skill 的前置知识。当用户需要编写或理解 Whistle 规则时触发。
---

# Whistle 规则系统

本 skill 是 Whistle 规则系统的基础，为 `whistle-proxy` 和 `whistle-rewrite` 提供前置知识。

## 1. 规则语法结构

```
pattern operation [lineProps...] [filters...]
```

| 组件 | 必须 | 说明 |
|------|------|------|
| **pattern** | 是 | URL 匹配表达式 |
| **operation** | 是 | 操作指令，格式 `协议名://操作值` |
| **lineProps** | 否 | 行属性（仅对当前规则生效） |
| **filters** | 否 | 过滤条件（OR 关系） |

**示例：**
```
www.example.com reqHeaders://x-proxy=Whistle
www.example.com file:///User/xxx/project includeFilter://m:GET
```

### 组合配置

单条规则可以包含多个操作指令，按顺序执行：
```
www.example.com file:///static-files cache://3600 resCors://*
```

### 位置调换

operation 可以放在 pattern 前面（为多个域名应用相同操作）：
```
proxy://127.0.0.1:8080 www.example.com api.example.com
```
限制：operation 和第一个 pattern 不能同时为 URL/域名格式。

### 多行配置

使用 `line`` 提高可读性：
```
line`
proxy://127.0.0.1:8080
www.example.com
api.example.com
includeFilter://m:GET
`
```

### 注释和优先级

- `#` 开头为注释行
- 规则从上到下执行，后面可能覆盖前面
- `lineProps://important` 提升当前规则优先级

## 2. 匹配模式（Pattern）

Whistle 匹配三种请求 URL：
- Tunnel：`tunnel://domain[:port]`
- WebSocket：`ws[s]://domain[:port]/path?query`
- HTTP/HTTPS：`http[s]://domain[:port]/path?query`

### 域名匹配：`[[schema]://]domain[:port]`

| 通配符 | 等价正则 | 范围 |
|--------|----------|------|
| `*` | `/[^/?.]*/` | 单级子域名内（不跨 `.`） |
| `**` | `/[^/?]*/` | 跨多级子域名 |
| `*`（端口） | `/\d*/` | 零或多个数字 |
| `*`（协议） | `/[a-z]*/` | 零或多个字母 |

```
www.example.com           # 精确域名
*.example.com             # www.example.com ✓，x.www.example.com ✗
**.example.com            # x.y.www.example.com ✓
http*://www.example.com   # 同时匹配 http 和 https
www.example.com:8*8      # 88, 8888 ✓，8080 ✗
//www.example.com         # 使用当前请求协议
```

### 路径匹配

```
www.example.com/path            # 前缀匹配：/path, /path/, /path/sub
www.example.com/path?name=      # 精确路径 + name= 参数必须存在
```

### 路径通配符（`^` 前缀，显式通配符模式）

```
^https://**.example.com/data/*/result?q=*23
```

| 通配符 | 等价正则 | 范围 |
|--------|----------|------|
| `*` | `/[^?/]*/` | 单路径段 |
| `**` | `/[^?]*/` | 多级路径 |
| `***` | `/.*/` | 任意（含 `/` 和 `?`） |
| `*`（query） | `/[^&]*/` | 单个参数值 |
| `**`（query） | `/.*/` | 跨参数值 |

### 正则匹配

```
/pattern/[flags]
```
flags 可选 `i`（忽略大小写）、`u`（Unicode）。

```
/\.test\./
/key=value/i
/\/api\/v1\/data/i
```

### 子匹配捕获（$0-$9）

```
^http://*.example.com/users/** file:///User/xxx/$1/$2
/regexp\/(user|admin)\/(\d+)/ reqHeaders://X-Type=$1&X-ID=$2
```
- `$0` = 完整匹配，`$1`-$9 = 捕获组

### 自动路径追加

匹配的路径会自动追加到目标 URL/文件路径：
```
www.example.com/path file:///mock
# 请求 /path/a/b → /mock/path/a/b
```

禁用自动追加：`file://</abs/path/to/file>`（尖括号）

## 3. 操作指令通用规范

### 值的数据源

| 方式 | 格式 | 示例 |
|------|------|------|
| 内联值 | `(value)` | `reqHeaders://x-key=val` |
| 代码块引用 | `{key}` | `file://{data.json}` |
| Values 引用 | `{key}` | `reqHeaders://{saved-value}` |
| 本地文件 | 绝对路径 | `file:///User/xxx/data.json` |
| 远程 URL | `https://...` | `resBody://https://example.com/mock.json` |
| 临时文件 | Cmd/Ctrl+点击 | `resBody://temp/data.txt` |
| 括号字面值 | `(path)` | `reqHeaders://(/abs/path)` 把路径当字符串 |

### 模板字符串

```js
`...${variable}...`
```

**常用变量：**
| 变量 | 值 |
|------|-----|
| `${now}` / `${random}` / `${randomUUID}` | 时间戳/随机数/UUID |
| `${url}` / `${url.hostname}` / `${url.path}` / `${url.search}` | URL 各部分 |
| `${method}` | HTTP 方法 |
| `${query.xxx}` | 查询参数 |
| `${reqHeaders.xxx}` / `${resHeaders.xxx}` | 请求/响应头 |
| `${statusCode}` | 响应状态码 |
| `${clientIp}` / `${serverIp}` | IP 地址 |

### 数据对象格式

三种等价写法：
```
# JSON
{"key1": "value1", "key2": "value2"}

# 行格式
key1: value1
key2: value2

# 查询格式
key1=value1&key2=value2
```

## 4. 过滤器（Filters）

```
pattern operation includeFilter://condition1 excludeFilter://conditionN ...
```

多个过滤器间为 **OR** 关系。

### 所有过滤器类型

| 前缀 | 匹配对象 | 示例 |
|------|----------|------|
| `b:` | 请求体 | `includeFilter://b:/"cmd":"test"/` |
| `m:` | HTTP 方法 | `includeFilter://m:GET` / `excludeFilter://m:POST` |
| `i:` | 客户端或服务端 IP | `includeFilter://i:192.168` |
| `clientIp:` | 客户端 IP 专用 | `excludeFilter://clientIp:10.0.0.1` |
| `serverIp:` | 服务端 IP 专用 | `includeFilter://serverIp:/^10\./` |
| `s:` | 响应状态码 | `includeFilter://s:/^20/` / `excludeFilter://s:500` |
| `reqH.header:` | 指定请求头 | `includeFilter://reqH.content-type:json` |
| `resH.header:` | 指定响应头 | `excludeFilter://resH.x-custom:test` |
| `chance:` | 概率匹配（0-1） | `includeFilter://chance:0.5` |
| 其他 | URL 匹配 | `includeFilter://*/api/*` |

值格式：关键字（子串匹配）或 `/regexp/[i]`（正则）。

### 实战模式

**按方法过滤：**
```
www.example.com/api file://({"ok":true}) includeFilter://m:GET
www.example.com/api file://({"created":true}) includeFilter://m:POST
```

**按请求体内容：**
```
www.example.com/api/handler resBody://(default) includeFilter://b:/cmdname=test/ includeFilter://b:/cmdname=test2/
```

**按状态码替换：**
```
www.example.com/api resBody://({"error":"ServerError"}) includeFilter://s:500
www.example.com/api resBody://({"error":"NotModified"}) includeFilter://s:304
```

## 5. 调试技巧

1. 从简单规则开始，逐步添加复杂条件
2. 使用 Network → Overview 面板查看规则匹配情况（Final URL、匹配的规则）
3. 配合浏览器 DevTools 验证
4. 使用 `#` 注释暂时禁用规则
5. 规则不生效时检查：pattern 是否正确、高优先级规则是否覆盖、过滤器条件是否满足
