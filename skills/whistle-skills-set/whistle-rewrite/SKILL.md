---
name: whistle-rewrite
description: Whistle 请求/响应改写——修改 Headers、Body、StatusCode、Cookie、CORS、HTML/CSS/JS 注入、限速、重定向等。当用户需要修改 HTTP 请求或响应内容时触发。
---

# Whistle 请求与响应改写

本 skill 依赖 `whistle-rules` 中定义的规则语法、pattern 和 filter 系统。覆盖所有 req* 和 res* 操作指令。

## 1. 请求改写（Request）

### 请求头

```
# 添加/修改
www.example.com reqHeaders://x-proxy=Whistle
www.example.com reqHeaders://{"X-Custom":"value","X-Another":"val2"}

# 删除
www.example.com delete://reqHeaders.x-custom-header

# 从文件/URL 加载
www.example.com reqHeaders:///User/xxx/headers.json
www.example.com reqHeaders://https://config.example.com/headers.json
```

### HTTP 方法

```
www.example.com/path method://post
www.example.com/api method://put includeFilter://b:cmdname=test
```

### User-Agent

```
www.example.com ua://Mozilla/5.0...
```

### 请求体

```
# 全部替换
www.example.com/api reqBody://({"new":"data"}) method://post

# 合并 JSON（只覆盖指定字段）
www.example.com/api reqMerge://({"extraField":"value"}) method://post

# 搜索替换
www.example.com/api reqReplace://({"/oldText/g":"newText"})

# 在前面插入 / 在后面追加
www.example.com/api reqPrepend://("prefix_data") method://post
www.example.com/api reqAppend://("suffix_data") method://post

# 删除字段或整个 Body
www.example.com/api delete://reqBody.fieldName
www.example.com/api delete://reqBody
```

### 查询参数

```
# 添加/修改
www.example.com/api urlParams://({"token":"abc123"})

# 删除
www.example.com/api delete://urlParams.oldParam
```

### 路径替换

```
www.example.com/api/v1 pathReplace://({"/v1/":"/v2/","/old/ig":"/new/"})
```

### 其他请求操作

```
www.example.com auth://basic_user_pass        # 添加 Authorization
www.example.com cache://3600                  # 设置缓存（秒）
www.example.com referer://https://new-ref.com # 修改 Referer
www.example.com reqType://application/json    # 修改 Content-Type
www.example.com reqCookies://{"token":"abc"}  # 修改 Cookie
www.example.com reqCors://*                   # 添加 CORS 请求头
www.example.com forwardedFor://1.1.1.1        # 修改 X-Forwarded-For
www.example.com disable://h2                  # 禁用 HTTP/2
```

## 2. 响应改写（Response）

### 状态码

```
www.example.com/api statusCode://500              # 直接返回 500（不请求服务器）
www.example.com/api replaceStatus://200           # 替换服务器返回的状态码
www.example.com/api replaceStatus://200 includeFilter://s:500  # 只在服务器返回500时替换
```

**statusCode vs replaceStatus：**
- `statusCode`：不请求服务器，直接返回指定状态码
- `replaceStatus`：请求服务器，收到响应后替换状态码

### 响应头

```
www.example.com resHeaders://x-proxy=Whistle
www.example.com resHeaders://{"Access-Control-Allow-Origin":"*"}
www.example.com resCors://*              # CORS 快捷方式
www.example.com resType://text/plain     # 修改 Content-Type
www.example.com resCharset://utf-8       # 修改编码
www.example.com attachment://report.pdf  # 添加下载头
www.example.com delete://resHeaders.x-powered-by
```

### 重定向

```
www.example.com/old-path redirect://https://www.example.com/new-path
www.example.com redirect://https://www.example.com/new includeFilter://s:301
```

### 响应体

```
# 全部替换（请求仍发到服务器）
www.example.com/api resBody://({"status":"custom","data":"modified"})

# 合并 JSON
www.example.com/api resMerge://({"extraField":"val"})

# 搜索替换
www.example.com/api resReplace://({"/http:/ig":"https:"})

# 在前面插入 / 在后面追加
www.example.com resPrepend://("===START===")
www.example.com resAppend://("===END===")

# 删除字段或清空 Body
www.example.com/api delete://resBody.errorDetails
www.example.com/api delete://resBody
```

### HTML/CSS/JS 注入

**HTML 插入：**
```
www.example.com htmlPrepend://<script>console.log('top')</script>
www.example.com htmlBody://<div id="injected">Content</div>
www.example.com htmlAppend://<script src="//debug.com/tool.js"></script>
```

**CSS 注入：**
```
www.example.com cssPrepend://body { margin-top: 50px; }
www.example.com cssBody://.debug-outline * { outline: 1px solid red; }
www.example.com cssAppend://.custom-widget { display: none; }
```

**JS 注入：**
```
www.example.com jsPrepend://window.__DEBUG__ = true;
www.example.com jsBody://console.log('Injected by Whistle');
www.example.com jsAppend://document.title = 'DEBUG MODE';
```

### 响应 Cookie

```
www.example.com resCookies://{"token":"abc","path":"/","maxAge":3600}
```

## 3. 通用工具

### 限速

```
www.example.com/api reqDelay://1000                 # 请求延迟 1 秒
www.example.com/api resDelay://2000                 # 响应延迟 2 秒
www.example.com/static reqSpeed://100               # 请求速度限制 100KB/s
www.example.com/static resSpeed://50                # 响应速度限制 50KB/s
```

### 调试工具

```
www.example.com weinre://session-name               # 远程 DOM 调试
www.example.com log://session-name                  # 远程日志捕获

# 组合使用
https://www.example.com weinre://debug log://
```

## 4. 实战场景

### 场景一：Mock API 返回

```
# 全接管（不请求服务器）
www.example.com/api/user file://({"id":1,"name":"Alice","role":"admin"})

# 修改服务器响应（请求仍发出）
www.example.com/api/user resBody://({"id":1,"name":"Alice","role":"admin"})

# 只在服务器出错时 mock
www.example.com/api/orders resBody://({"orders":[]}) includeFilter://s:500

# 按方法 mock
www.example.com/api/items file://({"items":[]}) includeFilter://m:GET
www.example.com/api/items file://({"created":true}) includeFilter://m:POST
```

### 场景二：前后端联调注入调试工具

```
# 注入 vConsole / Eruda 移动端调试
www.example.com htmlAppend://<script src="//cdn.jsdelivr.net/npm/vconsole"></script>
www.example.com htmlAppend://<script>new VConsole();</script>

# 注入调试信息面板
www.example.com jsBody://
window.onerror = function(m,s,l,c,e) {
  alert('Error: ' + m + ' at ' + s + ':' + l);
};
```

### 场景三：API 版本切换 / 路径替换

```
# API v1 改 v2
www.example.com/api/v1 pathReplace://({"/v1/":"/v2/"})

# 同时修改请求头和路径
www.example.com/api/v1 pathReplace://({"/v1/":"/v2/"}) reqHeaders://{"X-Version":"v2"}
```

### 场景四：跨域问题临时修复

```
# 添加 CORS 响应头
www.example.com/api resHeaders://{"Access-Control-Allow-Origin":"*"}
www.example.com/api resHeaders://{"Access-Control-Allow-Methods":"GET,POST,PUT,DELETE"}
www.example.com/api resHeaders://{"Access-Control-Allow-Headers":"Content-Type"}

# 快捷方式
www.example.com/api resCors://*
```

### 场景五：弱网测试

```
# 模拟 3G 网络
www.example.com resDelay://300 resSpeed://50
```

## 5. 注意事项

- `resBody` 替换后 Content-Type 可能不匹配，需要用 `resType://` 修正
- HTML/CSS/JS 注入只在 HTML 响应上生效（非 JSON/图片等）
- `statusCode://` 不请求服务器（相当于 `file://` + 自定义状态码）
- 多个操作指令按书写顺序执行
- 使用 `resReplace://` 做文本替换时注意正则转义
- `resMerge://` 只对 JSON/JSONP 响应生效
