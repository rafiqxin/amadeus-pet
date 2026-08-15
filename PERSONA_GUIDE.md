# 人格注入完整教程（以你的 prompt 文件为案例）

> 本教程手把手带你完成人格注入。案例素材：项目根目录下的
> `Prompts/SG_Dialogues_EN.md`（与 `Dialogues/SG_Dialogues_EN.md` 内容相同）。
> 使用前请自行确认你对该内容拥有使用权、且用途合规。内置代码与台词均为原创。

---

## 0. 先理解架构：三层大脑

| 层 | 文件 | 什么时候用 | 你在这层能做什么 |
|---|---|---|---|
| ① 台词拦截层 | `src/pet/dialog-bank.js` | 用户输入命中关键词/句式时**优先**回答（LLM 根本看不到这类输入） | 填固定台词：外号、夸奖、科学话题等"人设关键反应" |
| ② LLM 人格层 | `src/pet/llm.js` 的 `SYSTEM_PROMPT` | 开放话题自由对话（本地 7B 模型） | 写性格描述、说话风格、背景关系、示例对话 |
| ③ 内置闲聊层 | `src/pet/dialogue.js` | 报时/笑话/状态等兜底 | 改实用回复 |

**生效流程**：`think(输入) → ①命中？返回 → ②LLM 在线？流式回复 → ③兜底闲聊`。

---

## 1. 案例文件的结构（先读懂素材）

打开 `Prompts/SG_Dialogues_EN.md`，它的格式是**剧本体**：

```
Nakabachi: Who the hell are you?

Okabe: 
Unhand me, you... huh?

Kurisu: Could you come with me for a moment?
```

规律：
- `角色名: 台词` —— 一行一个人一句话；空行分隔场景；同一人连续说话用多行。
- 你要注入的是 **Kurisu: 开头的行**（共 741 句）。

---

## 2. 第一步：提取台词到本地文件

```bash
python3 tools/extract-dialogue.py Prompts/SG_Dialogues_EN.md Kurisu --out /tmp/kurisu-lines.json
```

输出 `/tmp/kurisu-lines.json`：一个 JSON 数组，含 741 行台词。**这是给你自己审阅用的**，接下来由你决定怎么用。

## 3. 第二步：把台词变成"关键词 → 回复"

打开 `src/pet/dialog-bank.js`，按现有格式添加条目。格式：

```js
{
  pattern: '(正则表达式)',     // 对用户输入做匹配，不区分大小写
  mood: 'annoyed',             // 可选：normal | flustered | annoyed | curious
  replies: [                   // 命中后随机取一条
    '（你选定的台词 1）',
    '（你选定的台词 2）',
  ],
},
```

**实操示范**（以你文件里的题材为例，示范台词用占位写法，你替换成自己选定的内容）：

- 想要"被问是谁"的固定回答：
```js
{ pattern: '(你是谁|你叫什么|自我介绍)', mood: 'normal',
  replies: ['（填入你选定的台词）', '（再填一条）'] },
```
- 想要"被夸可爱"的反应（人设关键，必须拦截，否则小模型会答成热情寒暄）：
```js
{ pattern: '(可爱|卡哇伊|cute)', mood: 'flustered',
  replies: ['（填入傲娇否认的台词）'] },
```
- 想加"聊时间机器"的固定回答：
```js
{ pattern: '(时间机器|time machine)', mood: 'curious',
  replies: ['（填入科学吐槽台词）'] },
```

**排序注意**：bank 从上到下匹配，第一个命中的生效。把更具体、更想优先的条目放在上面。

改完执行：`npm run build:render && ./run.sh`

## 4. 第三步：把"说话风格"教给 LLM

打开 `src/pet/llm.js`，找到 `SYSTEM_PROMPT` 数组。它是一串会被拼接成一段话的字符串。你可以在里面：

1. **加性格描述**（你自己的措辞）：
```js
'被关心时会别扭地说"别管我"；生气时话更短、更冷；',
```
2. **加对话示例**（few-shot，小模型最吃这一套）：
```js
'【对话示例】',
'用户：你今天很可爱。',
'你：（填入你选定的示例回答）',
'用户：时间机器真的存在吗？',
'你：（填入你选定的示例回答）',
```
3. **加背景关系**（替换现有 `【你身处的世界背景】` 段落里的条目）。

4. **风格数据参考**（来自对素材的统计，不是台词）：她的句子中位 33 字符、
约三成以问句结尾、大量 12 字内的短促反应语、高频开头 No/Don't/What/You/Hey。
写 prompt 时照着这个画像描述即可。

改完执行：`npm run build:render && ./run.sh`

## 5. 第四步：测试

启动后（确认 `./scripts/llm.sh status` 显示运行中），在角色下方的聊天框输入：

- `你是谁？` → 应命中 bank（固定台词）
- `红莉栖，你真可爱` → 应命中 bank（傲娇反应）
- `你觉得这个世界线的未来会怎样` → 应走 LLM（思考后流式回复）

没有命中 bank 也没有 LLM 在线时，回落到内置闲聊层。

## 6. 常见问题

| 问题 | 处理 |
|---|---|
| bank 改了没生效 | 确认执行了 `npm run build:render` 并重启了应用（`./run.sh`） |
| LLM 回复不像她 | 加强 `SYSTEM_PROMPT` 的示例对话（few-shot），或把更多关键意图移到 bank |
| LLM 离线 | `./scripts/llm.sh start`；日志在 `/tmp/amadeus-llm.log` |
| 正则不匹配 | 在 node 控制台测试：`new RegExp('你的pattern','i').test('测试句')` |
