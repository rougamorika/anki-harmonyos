# Anki 模板渲染引擎详解与鸿蒙移植方案

> 基于 rslib/src/template.rs 源码分析

---

## 一、模板引擎架构

### 1.1 三阶段渲染流程

```
阶段1: Lexing (词法分析)
  输入: "Hello {{Field}} {{#Cond}}text{{/Cond}}"
  输出: Token 流 → [Text("Hello "), Replacement("Field"), Text(" "), OpenConditional("Cond"), Text("text"), CloseConditional("Cond")]

阶段2: Parsing (语法分析)
  输入: Token 流
  输出: ParsedNode 树 → [Text("Hello "), Replacement{key:"Field"}, Conditional{key:"Cond", children:[Text("text")]}]

阶段3: Rendering (渲染)
  输入: ParsedNode 树 + 字段值
  输出: RenderedNode 列表 → [Text("Hello world"), Text("text")]
```

### 1.2 Token 类型

```rust
enum Token {
    Text(&str),                    // 普通文本
    Comment(&str),                 // <!--{{ ... }}-->
    Replacement(&str),             // {{field:filter1:filter2}}
    OpenConditional(&str),         // {{#field}}
    OpenNegated(&str),             // {{^field}}
    CloseConditional(&str),        // {{/field}}
}
```

### 1.3 ParsedNode 类型

```rust
enum ParsedNode {
    Text(String),                              // 纯文本
    Comment(String),                           // 注释
    Replacement { key: String, filters: Vec<String> },  // 字段替换
    Conditional { key: String, children: Vec<ParsedNode> },       // 条件块
    NegatedConditional { key: String, children: Vec<ParsedNode> }, // 否定条件块
}
```

### 1.4 RenderedNode 类型

```rust
enum RenderedNode {
    Text { text: String },
    Replacement {
        field_name: String,
        current_text: String,
        filters: Vec<String>,    // 未处理完的过滤器
    },
}
```

---

## 二、Lexing 词法分析算法

### 2.1 核心逻辑

```
function next_token(input):
    // 扫描到下一个 {{ 或 <!--
    for i in 0..input.len():
        remaining = input[i..]
        
        // 尝试匹配 handlebar {{...}}
        if remaining 匹配 "{{...}}":
            if i == 0:
                return token  // 起始就是标签
            else:
                return Text(input[..i])  // 之前的文本作为 Text
        
        // 尝试匹配 comment <!--...-->
        if remaining 匹配 "<!--...-->":
            if i == 0:
                return Comment
            else:
                return Text(input[..i])
    
    // 没有更多标签，返回剩余文本
    return Text(input)
```

### 2.2 标签分类

```
function classify_handle(s):
    // s = 去掉 {{ 和 }} 后的内容
    if s 以 '#' 开头 → OpenConditional
    if s 以 '/' 开头 → CloseConditional
    if s 以 '^' 开头 → OpenNegated
    else → Replacement
    
    // Replacement 中可能包含过滤器: "field:filter1:filter2"
    // filters 从右向左解析，最后一个为 key
```

### 2.3 词法特点

- `}}` 单独出现时被当作普通文本（不在 `{{...}}` 中的 `}}` 被忽略）
- HTML 注释 `<!--{{...}}-->` 可以隐藏模板标签
- 支持 `\s` 前后空格（如 `{{ tag }}`）
- 不识别嵌套标签

---

## 三、Parsing 语法分析算法

### 3.1 递归下降解析

```
function parse_inner(tokens, open_tag = None) → Vec<ParsedNode>:
    nodes = []
    
    while token = tokens.next():
        match token:
            Text(t) → nodes.push(ParsedNode::Text(t))
            Comment(t) → nodes.push(ParsedNode::Comment(t))
            
            Replacement(t):
                it = t.rsplit(':')           // 从右向左拆分
                key = it.next()              // 最右边的是字段名
                filters = it.collect()       // 其余是过滤器(逆序)
                nodes.push(ParsedNode::Replacement { key, filters })
            
            OpenConditional(t):
                children = parse_inner(tokens, open_tag=t)  // 递归!
                nodes.push(ParsedNode::Conditional { key:t, children })
            
            OpenNegated(t):
                children = parse_inner(tokens, open_tag=t)
                nodes.push(ParsedNode::NegatedConditional { key:t, children })
            
            CloseConditional(t):
                if open_tag == Some(t):
                    return nodes  // 匹配成功，返回父级
                else:
                    ERROR: 条件不匹配
    
    if open_tag != None:
        ERROR: 条件未闭合
    return nodes
```

### 3.2 闭合标签匹配规则

- `{{#Foo}}...{{/Foo}}` → 必须 `open_tag == close_tag`
- `{{/Bar}}` 但没有 `{{#Bar}}` → 错误: ConditionalNotOpen
- `{{#Foo}}` 但没有 `{{/Foo}}` → 错误: ConditionalNotClosed
- HTML 注释中的标签不参与解析: `<!--{{#Foo}}-->` 被当作 Comment 而非条件开始

---

## 四、Rendering 渲染算法

### 4.1 渲染流程

```
function render(nodes, context):
    for node in nodes:
        match node:
            Text(text):
                append_to_output(text)
            
            Comment(comment):
                // 保留 HTML 注释原样输出
                append_to_output("<!--" + comment + "-->")
            
            Replacement { key, filters }:
                if key == "FrontSide":
                    if partial_for_python:
                        push Replacement(field="FrontSide")  // 延迟渲染
                    else:
                        append_to_output(context.frontside)
                
                else if key 在 context.fields 中:
                    text = context.fields[key]
                    (text, remaining_filters) = apply_filters(text, filters, key, context)
                    
                    if remaining_filters 为空:
                        append_to_output(text)     // 完全处理
                    else:
                        push Replacement(key, remaining_filters, text)  // 部分处理
                
                else:
                    ERROR: FieldNotFound
            
            Conditional { key, children }:
                if key 在 nonempty_fields 中:
                    render(children, context)     // 渲染子节点
                else:
                    render_into_empty(children, context)  // 仅检查错误
            
            NegatedConditional { key, children }:
                if key 不在 nonempty_fields 中:
                    render(children, context)
                else:
                    render_into_empty(children, context)
```

### 4.2 条件判断规则

条件判断基于 `nonempty_fields`（非空字段集合）：
- `{{#Field}}` → 如果 Field 非空，渲染内容
- `{{^Field}}` → 如果 Field 为空，渲染内容
- 特殊：`{{#cN}}` / `{{^cN}}` → 检查第 N 个挖空是否存在（cloze conditional）

### 4.3 {{FrontSide}} 处理

- 正面模板中 `{{FrontSide}}` → 空字符串
- 背面模板中 `{{FrontSide}}` → 正面渲染结果
- Python 模式下延迟渲染 (`partial_for_python = true`)

---

## 五、现有 MVP 与标准引擎的差异

### 5.1 功能对比

| 功能 | Rust 模板引擎 | 现有 MVP | 差距 |
|------|-------------|---------|------|
| 字段替换 `{{Field}}` | ✅ | ✅ | 无 |
| 过滤器 `{{Field:text:...}}` | ✅ | ❌ | 需实现 |
| 正面引用 `{{FrontSide}}` | ✅ | ✅ | 无 |
| 条件 `{{#Field}}...{{/Field}}` | ✅ | ❌ | **核心缺失** |
| 否定条件 `{{^Field}}...{{/Field}}` | ✅ | ❌ | **核心缺失** |
| 完形填空 `{{cloze:Field}}` | ✅ | ✅ (基础) | 待完善 |
| 完形填空条件 `{{#c1}}...{{/c1}}` | ✅ | ❌ | 需实现 |
| 打字输入 `{{type:Field}}` | ✅ | ✅ | 无 |
| HTML注释隐藏 `<!--{{}}-->` | ✅ | ❌ | 需实现 |
| 模板语法错误检测 | ✅ | ❌ | 需实现 |
| 空白检查 (空字段 = 空HTML) | ✅ | ❌ | 需实现 |
| 替代语法 `{{=<% %>=}}` | ✅ | ❌ | 低优先级 |

### 5.2 现有实现的关键Bug

1. **正则替换脆弱**: 
   ```typescript
   // 当前实现 (TemplateRenderer.ts:56)
   rendered.replace(/{{([^#:}/][^}]*)}}/g, (_match, fieldName) => ...)
   ```
   这个正则：
   - 不识别 `{{#Condition}}` (被排除)
   - 不识别 `{{Text:Filter}}` (包含 `:` 被排除)
   - 可能误匹配 `}}` 在 JavaScript 代码中

2. **{{FrontSide}} 在所有上下文中替换**，而不是仅在背面模板中

3. **无词法分析** → 无法区分 `{{}}` 内外的 `}}`，例如：
   `var x = "{{Field}}";` → 正则可能错误匹配

---

## 六、完整模板引擎 TypeScript 实现方案

### 6.1 词法分析器

```typescript
// shared/anki/templateEngine/lexer.ts

export enum TokenType {
  Text = "Text",
  Comment = "Comment",
  Replacement = "Replacement",
  OpenConditional = "OpenConditional",
  OpenNegated = "OpenNegated",
  CloseConditional = "CloseConditional",
}

export interface Token {
  type: TokenType;
  content: string;
}

export function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let remaining = template;
  const START = "{{";
  const END = "}}";
  const COMMENT_START = "<!--";
  const COMMENT_END = "-->";

  while (remaining.length > 0) {
    // 查找下一个 {{ 或 <!-- 的位置
    let handlebarIdx = remaining.indexOf(START);
    let commentIdx = remaining.indexOf(COMMENT_START);
    
    // 跳过纯 }} (不在 {{}} 中的)
    if (handlebarIdx >= 0) {
      let endIdx = remaining.indexOf(END, handlebarIdx + START.length);
      if (endIdx < 0) {
        handlebarIdx = -1; // 没有闭合，不是合法标签
      }
    }
    
    if (handlebarIdx < 0 && commentIdx < 0) {
      // 没有更多标签
      tokens.push({ type: TokenType.Text, content: remaining });
      break;
    }
    
    // 选择最近的标签
    let nextIdx: number, isComment: boolean;
    if (handlebarIdx < 0) {
      nextIdx = commentIdx; isComment = true;
    } else if (commentIdx < 0) {
      nextIdx = handlebarIdx; isComment = false;
    } else {
      isComment = commentIdx < handlebarIdx;
      nextIdx = Math.min(commentIdx, handlebarIdx);
    }
    
    // 文本在标签之前
    if (nextIdx > 0) {
      tokens.push({ type: TokenType.Text, content: remaining.substring(0, nextIdx) });
      remaining = remaining.substring(nextIdx);
      continue;
    }
    
    if (isComment) {
      let endIdx = remaining.indexOf(COMMENT_END, COMMENT_START.length);
      if (endIdx < 0) {
        tokens.push({ type: TokenType.Text, content: remaining });
        break;
      }
      let commentContent = remaining.substring(COMMENT_START.length, endIdx);
      tokens.push({ type: TokenType.Comment, content: commentContent });
      remaining = remaining.substring(endIdx + COMMENT_END.length);
    } else {
      let endIdx = remaining.indexOf(END, START.length);
      let tagContent = remaining.substring(START.length, endIdx).trim();
      
      if (tagContent.startsWith("#")) {
        tokens.push({ type: TokenType.OpenConditional, content: tagContent.substring(1).trim() });
      } else if (tagContent.startsWith("/")) {
        tokens.push({ type: TokenType.CloseConditional, content: tagContent.substring(1).trim() });
      } else if (tagContent.startsWith("^")) {
        tokens.push({ type: TokenType.OpenNegated, content: tagContent.substring(1).trim() });
      } else {
        tokens.push({ type: TokenType.Replacement, content: tagContent });
      }
      remaining = remaining.substring(endIdx + END.length);
    }
  }
  
  return tokens;
}
```

### 6.2 语法分析器

```typescript
// shared/anki/templateEngine/parser.ts

export interface ParsedNode {
  type: "Text" | "Comment" | "Replacement" | "Conditional" | "NegatedConditional";
  text?: string;
  key?: string;
  filters?: string[];
  children?: ParsedNode[];
}

export function parse(tokens: Token[], startTag?: string): [ParsedNode[], number] {
  const nodes: ParsedNode[] = [];
  let i = 0;
  
  while (i < tokens.length) {
    const token = tokens[i];
    
    switch (token.type) {
      case TokenType.Text:
        nodes.push({ type: "Text", text: token.content });
        i++;
        break;
        
      case TokenType.Comment:
        nodes.push({ type: "Comment", text: token.content });
        i++;
        break;
        
      case TokenType.Replacement: {
        const parts = token.content.split(":").reverse();
        const key = parts[0];
        const filters = parts.slice(1);
        nodes.push({ type: "Replacement", key, filters });
        i++;
        break;
      }
      
      case TokenType.OpenConditional: {
        i++;
        const [children, consumed] = parse(tokens.slice(i), token.content);
        nodes.push({ type: "Conditional", key: token.content, children });
        i += consumed;
        break;
      }
      
      case TokenType.OpenNegated: {
        i++;
        const [children, consumed] = parse(tokens.slice(i), token.content);
        nodes.push({ type: "NegatedConditional", key: token.content, children });
        i += consumed;
        break;
      }
      
      case TokenType.CloseConditional:
        if (startTag === token.content) {
          return [nodes, i + 1];  // 匹配成功，返回
        }
        throw new Error(`条件标签不匹配: 期望 /${startTag}, 得到 /${token.content}`);
    }
  }
  
  if (startTag) {
    throw new Error(`条件标签未闭合: #${startTag}`);
  }
  
  return [nodes, -1];
}
```

### 6.3 渲染器

```typescript
// shared/anki/templateEngine/renderer.ts

export interface RenderContext {
  fields: Record<string, string>;
  nonemptyFields: Set<string>;
  cardOrdinal: number;
  frontSide?: string;
}

export function render(nodes: ParsedNode[], ctx: RenderContext): string {
  let output = "";
  
  for (const node of nodes) {
    switch (node.type) {
      case "Text":
        output += node.text;
        break;
        
      case "Comment":
        output += `<!--${node.text}-->`;
        break;
        
      case "Replacement":
        if (node.key === "FrontSide") {
          output += ctx.frontSide ?? "";
        } else if (node.key && ctx.fields[node.key] !== undefined) {
          let text = ctx.fields[node.key!];
          // 应用过滤器
          if (node.filters) {
            for (const filter of node.filters) {
              text = applyFilter(text, filter, ctx);
            }
          }
          output += text;
        } else {
          throw new Error(`字段未找到: ${node.key}`);
        }
        break;
        
      case "Conditional":
        if (node.key && ctx.nonemptyFields.has(node.key)) {
          output += render(node.children!, ctx);
        }
        break;
        
      case "NegatedConditional":
        if (node.key && !ctx.nonemptyFields.has(node.key)) {
          output += render(node.children!, ctx);
        }
        break;
    }
  }
  
  return output;
}
```

---

## 七、过滤器系统

### 7.1 内置过滤器 (来自 rslib/src/template_filters.rs)

| 过滤器 | 说明 | 示例 |
|--------|------|------|
| `text` | 去除 HTML 标签 | `{{Field:text}}` |
| `hint` | 生成提示链接 | `{{Field:hint:MyField}}` |
| `furigana` | 处理日文注音 | `{{Field:furigana}}` |
| `kanji` | 只保留汉字 | `{{Field:kanji}}` |
| `kana` | 只保留假名 | `{{Field:kana}}` |
| `type` | 类型答案输入 | `{{type:Field}}` |
| `cloze` | 完形填空处理 | `{{cloze:Field}}` |

### 7.2 过滤器实现位置

- Rust: `rslib/src/template_filters.rs` — 标准过滤器
- Python: `pylib/anki/template_filters.py` — Python 端扩展过滤器
- 鸿蒙: 至少需要实现 `text`, `hint`, `furigana`, `cloze`, `type`

---

## 八、迁移对照表

### 从现有 MVP 到新引擎的 API 变更

```typescript
// === 旧 API (TemplateRenderer.ts) ===

export function renderReviewSides(input: TemplateRenderInput): RenderedReviewSides {
  // 正则直接替换
  rendered.replace(/{{([^#:}/][^}]*)}}/g, ...)
}

// === 新 API (templateEngine/) ===

import { tokenize } from './lexer';
import { parse } from './parser';
import { render, RenderContext } from './renderer';

export function renderCardTemplate(
  template: string,
  fields: Record<string, string>,
  options: { cardOrdinal?: number; frontSide?: string; css?: string }
): string {
  const tokens = tokenize(template);
  const [nodes] = parse(tokens);
  const nonempty = computeNonemptyFields(fields);
  return render(nodes, { ...options, fields, nonemptyFields: nonempty });
}
```

---

## 九、测试策略

### 9.1 词法分析器测试

```typescript
// 测试标签识别
assert.deepEqual(
  tokenize("Hello {{Field}}"),
  [Text("Hello "), Replacement("Field")]
);

// 测试条件
assert.deepEqual(
  tokenize("{{#Cond}}text{{/Cond}}"),
  [OpenCond("Cond"), Text("text"), CloseCond("Cond")]
);

// 测试 HTML 注释
assert.deepEqual(
  tokenize("<!--{{Hidden}}-->"),
  [Comment("{{Hidden}}")]
);

// 测试 JavaScript 中的 }}
assert.equal(
  render("{{Field}}") + "var x = {a:1}}",
  "field_valuevar x = {a:1}}"
); // }} 在模板外应该保留
```

### 9.2 条件测试

```typescript
const fields = { A: "hello", B: "" };
const nonempty = new Set(["A"]);

// # 条件：字段非空
assert.equal(render("{{#A}}YES{{/A}}", fields, nonempty), "YES");
assert.equal(render("{{#B}}YES{{/B}}", fields, nonempty), "");

// ^ 条件：字段为空  
assert.equal(render("{{^A}}EMPTY{{/A}}", fields, nonempty), "");
assert.equal(render("{{^B}}EMPTY{{/B}}", fields, nonempty), "EMPTY");
```

---

*文档生成时间：2026-06-14 | 下一步：实现 lexer + parser + renderer 三件套*
