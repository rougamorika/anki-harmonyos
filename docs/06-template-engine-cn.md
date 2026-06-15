# Anki 模板引擎 — 鸿蒙移植实现文档

> 实现: `shared/anki/template/` (5文件)
> 测试: `harmony/tests/template.test.ts` (43 cases)
> 对应 Rust: `rslib/src/template.rs` (1377行)

---

## 一、架构

```
模板文本 (qfmt/afmt)
  │
  ▼
Lexer (lexer.ts)        ─── 词法分析
  │  template → Token[]
  ▼
Parser (parser.ts)      ─── 递归下降语法分析
  │  Token[] → ParsedNode[]
  ▼
Renderer (renderer.ts)  ─── 字段替换+条件判断+过滤器
  │  ParsedNode[] + fields → HTML string
  ▼
renderCard (mod.ts)     ─── 正反面协调+空白检测+CSS注入
  │
  ▼
HTML 字符串 → ReviewPage WebView
```

## 二、文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `template/types.ts` | 109 | Token/ParsedNode/RenderContext 类型 + 错误类 |
| `template/lexer.ts` | 142 | `tokenize()` — 标准{{}}+替代<%>%>语法 |
| `template/parser.ts` | 119 | `parse()` — 递归下降(条件嵌套/过滤器解析) |
| `template/renderer.ts` | 193 | `render()` + `fieldIsEmpty()` + `computeNonemptyFields()` |
| `template/mod.ts` | 192 | `renderCard()` 主入口 + CSS注入 + 媒体路径重写 |

## 三、支持的功能

| 语法 | 示例 | 状态 |
|------|------|------|
| 字段替换 | `{{Field}}` | ✅ |
| 带过滤器字段 | `{{Field:text:furigana}}` | ✅ (导入 filters.ts) |
| 正面引用 | `{{FrontSide}}` | ✅ |
| 条件判断 | `{{#Field}}...{{/Field}}` | ✅ |
| 否定条件 | `{{^Field}}...{{/Field}}` | ✅ |
| 嵌套条件 | `{{#A}}{{#B}}...{{/B}}{{/A}}` | ✅ |
| Cloze 条件 | `{{#c1}}...{{/c1}}` | ✅ |
| HTML 注释隐藏 | `<!--{{Hidden}}-->` | ✅ |
| 替代语法 | `{{=<% %>=}}` | ✅ |
| 模板注释 | `{{!comment}}` | ✅ (Lexer 阶段剥离) |
| 空卡片检测 | 无任何非空字段 → isBlank | ✅ |
| 模板错误报告 | 字段缺失/条件不匹配 | ✅ |

## 四、与 Rust 实现的差异

| 项目 | Rust | TS 实现 |
|------|------|---------|
| 过滤器处理 | 内置 filter 管道，未知 filter 返回 RenderedNode | 导入 `filters.ts`，全部直接应用 |
| partial_for_python | 支持分步渲染 | ❌ (鸿蒙无 Python 层) |
| 字段重命名/删除 | `rename_and_remove_fields()` | ❌ (后续需要时添加) |
| FieldRequirements | `Any/All/None` 用于卡片生成 | ❌ (后续添加) |
| 模板序列化 | `template_to_string()` | ❌ |

## 五、测试覆盖 (43 用例)

| 类别 | 用例数 |
|------|--------|
| Lexer | 12 |
| Parser | 9 |
| Renderer | 10 |
| fieldIsEmpty | 2 |
| renderCard | 6 |
| 错误处理 | 4 |

## 六、使用示例

```typescript
import { renderCard } from './shared/anki/template/mod';

const output = renderCard({
  questionTemplate: '{{#Hint}}<div>{{Hint}}</div>{{/Hint}}{{Word}}',
  answerTemplate: '{{FrontSide}}<hr id=answer>{{Meaning}}',
  fields: { Word: 'hello', Meaning: '你好', Hint: 'Greeting' },
  cardOrdinal: 0,
  css: '.card { font-size: 20px; }',
  mediaBaseUrl: 'file://media/',
});

// output.questionHtml → 正面 HTML (含 CSS + 媒体路径)
// output.answerHtml   → 背面 HTML (含 FrontSide 引用)
// output.isEmpty      → false (Word 非空)
```

---

*实现时间：2026-06-14 | 取代了 regex-based TemplateRenderer.ts*
