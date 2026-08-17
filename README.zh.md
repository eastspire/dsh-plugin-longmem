# `dsh-plugin-longmem`

> 一个 DSH (DeepSeek Harness) 插件,为 agent 提供持久化、**按用户** 的
> **长期记忆** 配置段。它通过官方的
> [`@deepseek-ai/dsh-settings`](https://www.npmjs.com/package/@deepseek-ai/dsh-settings)
> 接缝进行持久化,自带 schema 校验、热重载和版本号冲突检测。

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node: >=22.18](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](https://nodejs.org)
[![type: ESM](https://img.shields.io/badge/type-ESM-blue.svg)](https://nodejs.org/api/esm.html)

[English version](./README.md)

---

## 这个插件要解决什么问题

Agent 需要在多次会话之间记住一些事:用户偏好的语言、他们常用的系统
prompt 槽位、API key 的友好别名、他们希望 agent 怎么表现的零散笔记。
把这些信息塞进 `CLAUDE.md` 或 profile 字符串里既脆弱又难维护——
不能运行时编辑,不能监听变化,没有 schema 约束,出错时也不告诉你。

`dsh-plugin-longmem` 给出**最小可用的答案**:一个带 Schemastery schema
的结构化用户配置段,落到你装上的任何
`@deepseek-ai/dsh-settings` provider 后面(`file` 是默认推荐),在你
插件的任何地方通过 `readLongmem(ctx)` 一行就能读。Agent 拿到的是
frozen、只读视图;用户拿到的是一个 yaml 文件可以手动编辑;seam 自动
处理文件锁、写盘防抖和版本号不一致。

这**不是**一个向量库、embedding 索引或 RAG 流水线。它是**配置层**,
你的长期记忆系统应该建在它上面。

---

## 安装

```bash
pnpm add dsh-plugin-longmem
```

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-settings`、
`@deepseek-ai/schemastery` 是**对等依赖**。如果你的项目里没有,记得
一起装。

---

## 接入 `cordis.yml`

这个插件是**二级**插件:它依赖一个 settings provider 必须先组合
好。把它的条目放到你 profile 的 `plugins:` 列表里,放在 settings
provider **之后**。

### 最简形态

```yaml
plugins:
  - id: settings
    name: '@deepseek-ai/dsh-settings-file' # 组合 ctx.settings
  - id: longmem
    name: dsh-plugin-longmem # 挂上 longmem 配置段
```

### 用 composition `base` (推荐给团队)

`base` 是一个**部分覆盖**,用户文档仍然能再覆盖一层:

```yaml
plugins:
  - id: settings
    name: '@deepseek-ai/dsh-settings-file'
  - id: longmem
    name: dsh-plugin-longmem
    config:
      base:
        language: en
        theme: dark
        defaultModel: deepseek-v4-pro
```

### 自包含 profile (不带用户文档)

`config` 是完整配置段,会**整体**覆盖下面所有层,适合 CI agent 或
嵌入式 profile:

```yaml
plugins:
  - id: settings
    name: '@deepseek-ai/dsh-settings-file'
  - id: longmem
    name: dsh-plugin-longmem
    config:
      config:
        language: en
        theme: dark
        defaultModel: deepseek-v4-pro
        customPrompts:
          - name: persona
            content: '你是一个严谨的助手,始终用用户的语言回答。'
        apiKeyAliases:
          deepseek: DEEPSEEK_API_KEY
        notes:
          preferredChannel: cli
          reasoningDepth: standard
```

### 覆盖优先级

schema 是最底层;`base` 在 schema 上面覆盖一部分;用户文档在 `base`
上面再覆盖;`config`(如果给了)整体赢:

```
config  >  用户文档  >  base  >  schema 默认值
```

---

## Schema 长什么样

`longmem` 配置段是一个严格的、经过校验的对象。每个字段都有默认值,
所以即便配置段缺失,解析出来的也是一个完整、合理的值。

| 字段            | 类型                                                   | 默认值                  | 说明                                                       |
| --------------- | ------------------------------------------------------ | ----------------------- | ---------------------------------------------------------- |
| `language`      | `'en' \| 'zh' \| 'ja' \| 'ko' \| 'fr' \| 'de' \| 'es'` | `'en'`                  | Web 客户端的界面语言                                       |
| `theme`         | `'light' \| 'dark' \| 'system'`                        | `'system'`              | `'system'` 跟随系统                                        |
| `defaultModel`  | `string`                                               | `''`                    | 跨 provider 的 LLM 标识                                    |
| `customPrompts` | `Array<{ name, content }>`                             | 三个 seed 槽位,内容为空 | 长期挂载的系统 prompt 槽位                                 |
| `apiKeyAliases` | `Record<string, string>`                               | `{}`                    | 友好别名 → 凭据引用 id(真正的 key 存在凭据文档里,不在这里) |
| `notes`         | `Record<string, unknown>`                              | `{}`                    | 还没给它专门开字段的零散配置都先丢这里,JSON 兼容即可       |

用户文档(比如 `~/.dsh/settings.yaml`)长这样:

```yaml
longmem:
  language: zh
  theme: dark
  defaultModel: deepseek-v4-pro
  customPrompts:
    - name: persona
      content: |
        你是一个严谨、注重方法的助手。任何外部事实都要标注来源。
    - name: domain-rules
      content: '推理时优先使用 DeepSeek 官方 API。'
  apiKeyAliases:
    work: DEEPSEEK_API_KEY_WORK
  notes:
    timezone: Asia/Shanghai
    preferredEditor: neovim
```

---

## 公开 API

插件从包根目录导出三个读函数和一个 cordis 入口:

```ts
import {
  readLongmem, // (ctx) => frozen 的 LongmemReadonly 快照
  getLongmem, // (ctx) => 活的 SettingsScope(或 frozen 默认值)
  watchLongmem, // (ctx, cb) => 取消订阅函数
  apply, // cordis 插件入口,被 cordis.yml 引用
  LONGMEM_NAMESPACE,
  LONGMEM_DEFAULTS,
} from 'dsh-plugin-longmem'
```

### `readLongmem(ctx): LongmemReadonly`

读当前已解析的配置段。**总是**返回 frozen 的纯对象——不是
`SettingsScope`——所以可以放心地传给那些不该写配置的地方(比如组装
LLM prompt 的代码)。

```ts
const section = readLongmem(ctx)
console.log(section.language) // 'zh'
console.log(section.customPrompts) // [ { name, content }, ... ]
console.log(section.apiKeyAliases) // { work: 'DEEPSEEK_API_KEY_WORK' }
```

如果 settings provider 还没组合好,返回的是 schema 默认值的 frozen
快照——启动期的调用也是安全的。

### `getLongmem(ctx): SettingsScope<LongmemSection> | LongmemReadonly`

如果 settings seam 已经组合好,返回活的 `SettingsScope`(调用方可以
`update` / `replace` / `watch`);否则返回 frozen 的默认快照。建议优先
用这个,而不是直接动 `ctx.settings`:它统一了 namespace 选择和启动
期 fallback 两条路径。

```ts
const scope = getLongmem(ctx) as SettingsScope<LongmemSection>
scope.update({ language: 'ja', theme: 'light' })
// -> 下一次 readLongmem(ctx) 看到 { language: 'ja', theme: 'light', ... }
```

### `watchLongmem(ctx, cb): () => void`

监听配置段的提交。每次写入成功后 `cb` 收到 `(next, prev)`;落盘是
provider 的事(file backend 自动防抖加锁)。

```ts
const stop = watchLongmem(ctx, (next, prev) => {
  console.log(`language: ${prev.language} -> ${next.language}`)
})

// 之后,插件卸载时:
stop()
```

如果 settings seam 还没组合好,返回的是一个 no-op 取消订阅函数——
插件初始化时直接挂就行,不用先判 settings 是否就绪。

### `apply`(cordis 入口)

`apply` 是 `cordis.yml` 里 `name: dsh-plugin-longmem` 指向的对象。
你不需要手动调它,cordis 运行时会处理。它依赖 `ctx.settings` 必须
就绪——函数上的 `inject: ['settings']` 声明让 cordis 自动校验这个
顺序。

---

## 引用稳定的读

`readLongmem(ctx)` 在两次调用之间返回**同一个 frozen 引用**,直到
发生一次写入。写入之后,内部缓存会被替换成一个新的 frozen 对象;
后续读看到的是新引用。所以:

```ts
const a = readLongmem(ctx)
const b = readLongmem(ctx)
a === b // true
getLongmem(ctx).update({ language: 'fr' })
const c = readLongmem(ctx)
a === c // false
c.language // 'fr'
```

也就是说在热路径上你可以安全地 memoize 读结果,测试里也能直接用
`toBe` 判等。

---

## 卸载

插件把 `SettingsScope` 和 watcher 注册在 cordis 的**插件 fiber**(就是
`ctx.plugin(apply, ...)` 返回的那个)上。fiber 一旦卸载——通常是
host 关机或 profile 重载——两者都会被清理。卸载之后的读会 fallback
到 schema 默认值的 frozen 快照,所以哪怕在关停过程中的滞后读
`readLongmem(ctx)`,也不会让 host 崩。

---

## 环境要求

- **Node** `>=22.18` (cordis 4 需要 `WeakRef` / `FinalizationRegistry`
  的保证)。
- **TypeScript** `>=5.6` (用到了 `verbatimModuleSyntax` /
  `allowImportingTsExtensions` 这套现代配置)。
- **cordis** `^4.0.1` 和 **dsh-settings** `^0.1.0` 是对等依赖,
  看一下你的 lockfile。

---

## 构建 & 测试

```bash
pnpm install
pnpm test          # vitest run,11 个测试
pnpm typecheck     # tsc --noEmit
pnpm build         # tsdown -> lib/
```

---

## 许可证

[MIT](./LICENSE) —— 完整文本见 `LICENSE`。
