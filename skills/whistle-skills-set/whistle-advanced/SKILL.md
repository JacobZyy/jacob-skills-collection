---
name: whistle-advanced
description: Whistle 进阶功能——插件开发与使用、命令行操作、FAQ 故障排查、Values/Composer/Weinre 工具。当用户需要插件开发、命令行管理、排查 Whistle 问题、使用高级工具时触发。
---

# Whistle 进阶：插件、CLI、工具与故障排查

## 1. 插件系统

### 插件使用

插件是 npm 包，前缀 `whistle.`。安装后自动注册。

```bash
w2 install whistle.script      # 安装插件
w2 uninstall whistle.script    # 卸载插件
w2 install whistle.xxx --registry=https://custom-registry  # 指定 registry
```

通过 Whistle 界面 **Plugins** 面板管理插件（启用/禁用/配置）。

**规则中使用插件协议：**
```
# 长格式
pattern whistle.plugin-name://value
# 短格式（如果没被 hideShortProtocol 隐藏）
pattern plugin-name://value
```

### 插件开发

**脚手架：**
```bash
npm i -g lack    # >= 1.4.0
lack init <type> # 生成插件项目
lack watch       # 开发模式挂载（自动重载）
```

**插件文件类型与 Hook：**

| 文件 | 触发时机 | 用途 |
|------|----------|------|
| `rules.txt` | 全局自动加载 | 对所有请求默认生效的静态规则 |
| `_rules.txt` | 匹配 `whistle.xxx://` 协议 | 请求阶段规则 |
| `resRules.txt` | 匹配 `whistle.xxx://` 协议 | 响应阶段规则 |
| `src/auth.ts` | 请求认证 | 决定放行还是拦截 |
| `src/sniCallback.ts` | TLS 握手 | 动态选择 TLS 证书 |
| `src/rulesServer.ts` | 匹配协议 | 动态生成规则（可同时设置 Values） |
| `src/tunnelRulesServer.ts` | 匹配协议（Tunnel） | Tunnel 请求动态规则 |
| `src/resRulesServer.ts` | 匹配协议（响应阶段） | 响应阶段动态规则 |
| `src/statsServer.ts` | 匹配协议（只读） | 读取请求 URL、Method、Headers、Body |
| `src/resStatsServer.ts` | 匹配协议（只读） | 读取响应 StatusCode、Headers、Body、ServerIP |
| `src/server.ts` | 匹配协议 | 完整代理处理器（可自定义转发） |
| `src/pipe.ts` | 匹配 `pipe://` 协议 | 数据流管道（加密/解密/转换） |

**认证 Hook（auth）：**
```ts
export default async (req: Whistle.PluginAuthRequest, options: Whistle.PluginOptions): Promise<boolean> => {
  // true = 放行，false = 返回 403
  // 可用 req.setHtml() 设置 403 页
  // 可用 req.setLogin(true) 弹出浏览器登录框
  // 可用 req.setRedirect(url) 做 302
  // 可用 req.setHeader('x-whistle-xxx', 'val') 添加自定义头
}
```

**TLS 证书 Hook（sniCallback）：**
```ts
export default async (req, options) => {
  // true = 用 Whistle 内置证书
  // false = 不解密（保持 TUNNEL）
  // { key, cert } = 使用自定义证书
}
```

**动态规则示例（rulesServer）：**
```ts
export default (server, options) => {
  server.on('request', (req, res) => {
    res.end(JSON.stringify({
      values: { 'my-plugin/data.json': '{"key":"val"}' },
      rules: '* file://{my-plugin/data.json}',
    }));
  });
};
```

### UI 扩展

通过 `package.json` 的 `whistleConfig` 配置：

```json
{
  "whistleConfig": {
    "networkColumn": {
      "name": "自定义列",
      "key": "req.headers.referer",
      "width": 120
    },
    "inspectorsTab": {
      "name": "自定义 Tab",
      "action": "/public/tab.html"
    },
    "networkMenus": [{
      "name": "自定义菜单",
      "action": "/public/menu.html"
    }]
  }
}
```

支持的扩展点：
- **networkColumn** — Network 列表自定义列（key 支持点路径如 `req.headers.referer`、`customData.xxx`）
- **inspectorsTab** / **composerTab** / **toolsTab** — 详情面板自定义标签页
- **networkMenus** / **rulesMenus** / **valuesMenus** / **pluginsMenus** — 自定义右键菜单
- **WebWorker** — 自定义列数据计算（`/public/webWorker.js`）

### 插件变量

使用 `%` 语法配置插件：
```
%myplugin=value
%myplugin.key=value
```

### 路径规范

| 格式 | 说明 |
|------|------|
| `path/to` | 在 Whistle UI 或插件页面内使用 |
| `/.whistle-path.xxx./whistle.plugin/path` | 外部/未被代理的页面使用 |
| `/_WHISTLE_xxx_/path/to` | 环境自适应路径前缀 |

**最佳实践：** 使用相对路径（以 `./` 开头），不要硬编码 `/` 绝对路径。Vite 构建设置 `base: './'`。

## 2. CLI 命令参考

### w2 start 参数速查

**网络与端口：**
```
-p, --port [port]       代理端口（默认 8899）
-P, --uiport [port]     Web UI 端口（与代理分离）
--httpPort [port]       HTTP 服务端口
--httpsPort [port]      HTTPS 代理端口
--socksPort [port]      SOCKSv5 端口
-H, --host [host]       绑定 IP（默认 INADDR_ANY）
-l, --localUIHost [host] Web UI 域名
```

**存储：**
```
-D, --baseDir [dir]     自定义根目录
-S, --storage [name]    配置存储名（多实例用）
--rcPath [path]        配置文件路径（默认 ~/.whistlerc）
```

**认证：**
```
-n, --username [name] / -w, --password [pass]   Web UI 访问凭据
-N, --guestName [name] / -W, --guestPassword [pass]  只读访客
```

**性能：**
```
-s, --sockets [n]      每域名最大连接数（默认 256）
-c, --dnsCache [ms]    DNS 缓存（默认 60000ms）
-t, --timeout [ms]     请求超时（默认 360000ms）
-R, --reqCacheSize [n] 请求数据缓存（默认 600）
```

**模式：**
```
-M, --mode [mode]      pureProxy/debug/multiEnv/capture/disableH2/network/rules/plugins/prod
--no-global-plugins    禁用全局插件
--cluster [workers]    集群模式
```

### w2 add 规则注入

从 JS 文件动态添加规则：
```bash
w2 add                  # 执行当前目录 .whistle.js
w2 add filepath         # 指定文件
w2 add --force          # 覆盖已有规则
```

`.whistle.js` 示例：
```js
exports.name = 'API Mock Rules';
exports.rules = `
  www.example.com/api file://({"status":"mocked"})
  www.example.com/api resHeaders://{"X-Mock":"true"}
`;
// 也可导出异步函数
module.exports = (cb, util) => {
  cb({
    name: 'Dynamic Rules',
    rules: '* reqHeaders://x-time=' + Date.now(),
  });
};
```

### w2 proxy 系统代理

```bash
w2 proxy           # 设置系统代理到 127.0.0.1:8899
w2 proxy 8100      # 指定端口
w2 proxy 0         # 关闭
```

### w2 ca 证书管理

```bash
w2 ca              # 安装本地 Whistle Root CA
w2 ca 8080         # 从 127.0.0.1:8080 下载安装
w2 ca certUrl      # 从指定 URL
w2 ca localPath    # 从本地文件
```

## 3. 工具面板

| 面板 | 功能 |
|------|------|
| **Network** | 抓包列表、请求重放/编辑、Overview（规则匹配详情含 Final URL） |
| **Rules** | 规则编辑器（支持多规则集切换） |
| **Values** | 数据存储（Key-Value，被规则引用如 `{key}`） |
| **Composer** | 构造/编辑请求（相当于 Postman） |
| **Plugins** | 插件管理（安装、启用/禁用、访问插件 UI） |
| **HTTPS** | 证书管理、启用/禁用 HTTPS、上传自定义证书 |
| **Weinre** | 远程 DOM/CSS 调试（需配置 `weinre://` 规则） |
| **Console** | JavaScript 错误和 console 日志实时显示 |

**自定义证书：**
- HTTPS 面板 → View Custom Certs → Upload
- 命名约定：`domain.crt` ↔ `domain.key`，根证书为 `root.crt` ↔ `root.key`

## 4. FAQ 故障排查

### 抓包列表出现 "Tunnel to"
| 原因 | 解决 |
|------|------|
| 纯 TCP 连接 | 正常现象，无法解析为 HTTP |
| 未启用 HTTPS | 安装根证书 + 勾选 Enable HTTPS |
| captureError | SSL 解密失败，检查证书、SSL Pinning |
| 请求直接使用 IP | 配置规则 `ip[:port] enable://capture` |

### 手机 HTTPS 页面打不开
- **iOS**：确认"证书信任设置"中完全信任已启用
- **Android**：确认证书安装在 CA 证书（非 VPN/应用证书）
- **SSL Pinning**：配置 `域名 disable://capture` 跳过抓包，或用模拟器

### Firefox 抓包失败
- 手动安装证书到 Firefox
- 或 `about:config` → `security.enterprise_roots.enabled = true`

### 多选规则
- Rules 界面 → Settings → 勾选 "Use multiple rules"

### 过滤轮询请求
- 右键请求 → Settings → Exclude All Matching Hosts/URLs

### 查看日志
- 运行时错误：Network → Tools → Server
- 崩溃日志：`~/.WhistleAppData/whistle.log`

### 更新
```bash
npm i -g whistle && w2 restart
# 国内加速
npm i -g whistle --registry=https://registry.npmmirror.com && w2 restart
```
如果版本号不更新：`w2 -V` 检查、`which w2` 定位路径、删除旧版本重新安装。

### 多实例
```bash
w2 start -p 8010 -S 8010
w2 start -p 8011 -S 8011
```
每个实例需要唯一端口和唯一存储目录。

### mTLS（双向认证）
使用 `@clientCert://` 规则，参考官方文档。

## 5. 对应关系

| 用户需求 | 触发 Skill |
|----------|-----------|
| 安装 Whistle、手机抓包、HTTPS 配置 | `whistle-quickstart` |
| 规则语法、pattern、filter 怎么写 | `whistle-rules` |
| 本地文件替换、URL 转发、DNS 代理 | `whistle-proxy` |
| 修改请求头/体、修改响应、注入 HTML/CSS/JS | `whistle-rewrite` |
| 插件开发、命令行、故障排查 | `whistle-advanced` |
