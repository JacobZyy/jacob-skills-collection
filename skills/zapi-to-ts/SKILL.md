---
name: zapi-to-ts
description: 解析 ZAPI 接口文档，自动生成 TypeScript 类型定义和接口实现代码。当用户提供 zapi.zhuanspirit.com 的接口 URL 时触发。
---

# ZAPI to TypeScript Skill

将 ZAPI 接口文档自动转换为 TypeScript 类型定义 + 接口调用实现。

## 触发条件

满足以下任一条件即使用本技能：
- 用户提供了 `zapi.zhuanspirit.com` 的接口 URL
- 用户要求根据 ZAPI 接口生成 TypeScript 类型或接口实现
- 用户提到"zapi 接口"、"接口类型生成"等关键词

## 执行流程

### Step 1：获取 ZAPI Token

在调用接口文档之前，必须先确保有可用的 token：

1. 在当前工作目录（项目根目录）查找 `.env.local` 文件，尝试读取 `ZAPI_READ_TOKEN=` 这一行的值
2. 如果文件不存在或该变量未设置/为空，使用 **AskUserQuestion 工具**向用户询问 token（提示语：「请输入 ZAPI Read Token，可在 https://zapi.zhuanspirit.com 个人设置中获取」）
3. 拿到 token 后，将其写入当前工作目录的 `.env.local` 文件（追加或更新 `ZAPI_READ_TOKEN=<token>` 这一行），以便下次复用

### Step 2：解析接口文档

1. 从用户提供的 ZAPI URL 中提取接口 ID（URL 最后一段数字）
2. 找到本 skill 所在目录下的 `scripts/zapi_fetch.py`（路径格式：`<skill_dir>/scripts/zapi_fetch.py`），通过 Bash 运行：
   ```bash
   python3 <skill_dir>/scripts/zapi_fetch.py --token <ZAPI_READ_TOKEN> --interface-id <接口ID>
   ```
3. 从返回的 JSON 中提取：
   - 接口名称、请求方法（GET/POST）、接口路径
   - 请求参数（`req_body_other` 或 `req_params`/`req_query`）的 JSON Schema
   - 响应数据（`res_body`）的 JSON Schema，**只取 respData 部分**
4. 如果脚本返回 `error` 字段，提示用户检查 token 是否正确，或接口 ID 是否有效

### Step 3：确定文件位置

根据当前页面文件夹和项目类型确定输出位置：

**类型文件位置**：始终放在当前页面文件夹下的 `type.ts`
- 例：页面在 `@src/views/xxxPages/handler/` → 类型放 `@src/views/xxxPages/handler/type.ts`

**接口实现文件位置**：
- **Vue 项目**：放在 `@src/api/{页面文件夹名}.ts`
  - 例：页面文件夹为 `cabinetPriceHandler` → `@src/api/cabinetPriceHandler.ts`
- **React 项目**：放在当前页面文件夹下的 `service.ts`
  - 例：`@src/views/xxxPages/handler/service.ts`

**判断项目类型**：检查 `package.json` 的 dependencies 中是否有 `vue` 或 `react`。

### Step 4：生成类型定义

规则：
1. **扁平化类型**：尽量不用嵌套类型（内联对象），如果嵌套对象有明确语义，提取为独立 interface/type
2. **只解析 respData**：返回值类型不包含通用结构（`errorMsg`、`respCode`、`respData` 包装层），直接定义 `respData` 内部的结构
3. **命名规范**：
   - 请求参数：`{接口名}Req`（如 `GetRecallGoodsPricePopInfoReq`）
   - 响应数据：`{接口名}Res`（如 `GetRecallGoodsPricePopInfoRes`）
4. **注释**：每个字段加 JSDoc 注释，来源于接口文档的字段描述
5. **枚举**：如果字段有明确的枚举值说明，考虑提取为 `enum`
6. **追加写入**：如果 `type.ts` 已存在，追加新类型到文件末尾，不覆盖已有内容

### Step 5：生成接口实现

规则：
1. **请求工具**：优先使用项目 `@src/utils/` 下的 `http` 或 `request` 文件导出的请求方法
   - 检查 `@src/utils/http.*` 或 `@src/utils/request.*` 是否存在
   - 使用其导出的 `post`/`get` 等方法
2. **apis 对象**：在文件顶层维护一个 `apis` 对象，集中管理所有接口路径
   ```typescript
   const apis = {
     interfaceName: `${zzHost}/api/path/to/endpoint`,
   }
   ```
3. **Host 变量**：优先复用项目中已有的 host 配置（如 `@/conf/api` 中的 `zzHost`）
4. **追加写入**：如果接口实现文件已存在，追加新接口到 `apis` 对象和文件末尾
5. **接口函数**：
   - 函数名与接口名一致（camelCase）
   - 参数类型引用 `type.ts` 中定义的 Req 类型
   - 返回值类型引用 `type.ts` 中定义的 Res 类型
   - 添加 JSDoc 注释，包含 ZAPI 链接
   ```typescript
   /**
    * 接口描述
    * @link https://zapi.zhuanspirit.com/project/xxx/interface/api/xxx
    */
   export const getXxx = (params: XxxReq): Promise<XxxRes> => {
     return http.post(apis.getXxx, params, { format: 'application/json' })
   }
   ```

## 输出示例

### type.ts（追加内容）
```typescript
/**
 * 获取价格弹窗请求参数
 */
export interface GetPricePopInfoReq {
  /** 寄卖单ID */
  omsSkuId: string
}

/**
 * 获取价格弹窗响应数据
 */
export interface GetPricePopInfoRes {
  /** 推荐价金额 */
  recommendPrice: number
  /** 在售最低价 */
  minSalePrice: number
}
```

### api 文件（追加内容）
```typescript
import type { GetPricePopInfoReq, GetPricePopInfoRes } from '@/views/xxxPages/handler/type'

const apis = {
  getPricePopInfo: `${zzHost}/api/n_lab_supply/getPricePopInfo`,
}

/**
 * 获取价格弹窗
 * @link https://zapi.zhuanspirit.com/project/12116/interface/api/13003969
 */
export const getPricePopInfo = (params: GetPricePopInfoReq): Promise<GetPricePopInfoRes> => {
  return http.post(apis.getPricePopInfo, params, { format: 'application/json' })
}
```

## 注意事项

- 如果 `.env.local` 中已有 `ZAPI_READ_TOKEN`，直接使用，无需再次询问用户
- 如果接口文档中字段描述缺失，使用字段名作为注释
- 数组类型使用 `T[]` 而非 `Array<T>`
- 可选字段使用 `?` 标记
- 金额字段注意单位说明（分/元）
