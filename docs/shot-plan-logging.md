# 分镜生成日志说明

内部分镜生成、粘贴导入工业脚本时，系统会把**发送给模型的消息**和**模型回复**写入本地日志，方便对照检查镜头数为何波动、是否被 `max_tokens` 截断。

## 日志存放位置

```
data/logs/shot-plans/
```

每次操作生成一对文件（同名不同后缀）：

| 文件 | 内容 |
| --- | --- |
| `20260605143022_ep11_generate.md` | 人类可读的 Markdown（推荐查看） |
| `20260605143022_ep11_generate.json` | 完整结构化数据（程序读取） |

文件名格式：`{时间}_{集数}_{来源}.md`

- **来源 `generate`**：点击「内部分镜生成 / 重新生成」
- **来源 `import`**：点击「粘贴导入」
- **来源 `agent`**：制作助手 `shot_plan_generator` 调用 `import_industrial_script`（若后续接入）

## 日志里有什么

### 内部分镜生成（generate）

1. **元信息**：模型、provider、temperature、max_tokens、finish_reason、Token 用量、耗时
2. **发送 · System**：工业分镜规范 + 生成任务说明（完整 system prompt）
3. **发送 · User**：本集剧本、角色库 R01…、场景库 S01…
4. **回复 · Assistant**：模型返回的完整工业分镜 markdown
5. **导入结果**：`plan_count`、`clip_count` 等

### 粘贴导入（import）

1. **发送 · User**：你粘贴的全文（即「发送」内容）
2. **导入结果**：解析出多少镜头、多少片段
3. 无 System / Assistant（未经过 LLM）

## 如何查看

### 方式 1：直接打开文件

用编辑器打开 `data/logs/shot-plans/` 下最新的 `.md` 文件即可。

### 方式 2：API

```http
# 列出某集最近 20 条日志
GET /api/episodes/{episode_id}/shot-plans/logs?limit=20

# 读取指定日志（Markdown）
GET /api/episodes/{episode_id}/shot-plans/logs/{basename}?format=md

# 读取最新一条（Markdown）
GET /api/episodes/{episode_id}/shot-plans/logs/latest?format=md
```

### 方式 3：后端控制台

终端仍会输出简要进度，例如：

```
[ShotPlanGenerate] request | model=deepseek-v4-pro maxTokens=32768
[ShotPlanGenerate] DONE done | episodeId=... plan_count=31 clip_count=6
```

详细正文以 `data/logs/shot-plans/*.md` 为准。

## 如何判断「镜头变少」

对照同集多次生成的日志：

| 现象 | 可能原因 |
| --- | --- |
| `finish_reason: length` | 输出被 max_tokens 截断，后面镜头丢失 |
| `回复` 里最后一个镜头编号 < 预期 | 模型提前结束或未写全 |
| `plan_count` < 回复中 `【镜头 NNN】` 数量 | 解析过滤了模板占位镜头 |
| 三次 `回复` 结构不同、但总时长也变了 | 模型随机性（temperature），覆盖情节不同 |

## 隐私说明

- 日志保存在本机 `data/` 目录，默认随 `.gitignore` 规则不提交 Git
- JSON 中不含 API Key
- 日志含完整剧本与分镜，请勿上传到公开仓库

## 环境变量（可选）

```bash
# 自定义日志目录
SHOT_PLAN_LOG_DIR=D:/logs/shot-plans
```
