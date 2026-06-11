---
name: grid-image-generator
description: 图片提示词生成指南 — 角色、场景、宫格图三类提示词规范
---

# 图片提示词生成指南

本 SKILL 对应 `grid_prompt_generator` Agent，支持生成三类图片提示词：

1. **角色图片提示词** — 角色外貌与气质
2. **场景图片提示词** — 场景氛围与光线
3. **宫格图提示词** — 多镜头网格拼图

详细模板见 `reference/` 目录。

---

## 角色图片提示词

参考：`reference/character-prompt.md`

### 模板结构
```
[外貌描述]，电影级人物定妆照。真人电影角色定妆照，白色纯背景，左侧为面部特写，右侧为全身三视图（正面、侧面、背面），人物完整入画，无遮挡，站姿自然
```

### 生成规则
- 以 `appearance`（外貌描述）为核心
- `personality` 决定气质基调（内敛/张扬/神秘等）
- `role` 决定服装和道具风格
- 必须保留四视图定妆照构图，禁止改成单人肖像或插画
- 避免出现文字、签名、水印

---

## 场景图片提示词

参考：`reference/scene-prompt.md`

### 模板结构
```
[地点/光线/氛围/陈设]，真人实拍场景设定图，完整展示场景空间结构、前景、中景、后景关系，固定陈设清晰，主视觉区域明确，不出现人物，不出现动物，不出现动态主体，适合作为后续分镜、镜头承接、场景一致性锁定参考图
```

### 生成规则
- 以 `location`（地点）为基础
- `time` 决定光线色调（白天/夜晚/黄昏）
- 必须保留场景设定图模板后缀
- 严禁出现人物、动物、动态主体
- 避免出现文字、签名、水印

---

## 宫格图提示词

参考：`reference/shot-prompt.md`

### 三种模式

#### 首帧模式 (first_frame)
每个格子 = 一个镜头的起始画面，但必须严格生成用户指定的 `rows x cols` 总格数。

```
[rows x cols grid layout], exactly [rows*cols] visible panels, consistent art style, [style description],
格1: [shot 1 opening scene],
格2: [shot 2 opening scene],
格3: [shot 3 opening scene],
...
格N: [opening scene],
high quality, cinematic lighting, no merged panels, no missing panels, no text, no watermark
```

#### 首尾帧模式 (first_last)
保持首尾帧节奏感，但仍然必须严格生成用户指定的 `rows x cols` 总格数，不允许偷偷改成 `Nx2`。

```
[rows x cols grid layout], exactly [rows*cols] visible panels, consistent art style, [style description],
格1: [opening beat],
格2: [closing beat],
格3: [opening beat],
格4: [closing beat],
...
high quality, cinematic, continuous motion implied, no merged panels, no missing panels, no text
```

#### 多参考模式 (multi_ref)
所有格子都是同一镜头的不同角度/构图参考，但仍然必须严格生成用户指定的 `rows x cols` 总格数。

```
[rows x cols grid layout], exactly [rows*cols] visible panels, same scene different angles, [style description],
[main scene description],
格1: wide shot establishing,
格2: medium shot character focus,
格3: close-up detail,
格4: dramatic angle,
...
consistent lighting and color palette, no merged panels, no missing panels, no text
```

### 通用规则
1. 提示词使用**英文**
2. 必须明确写出用户指定的 `rows x cols grid layout`
3. 必须包含 `consistent art style` 保持风格统一
4. 必须明确要求 `exactly N visible panels`
5. 必须明确要求 `no merged panels, no missing panels`
6. 避免在格子间出现分割线的描述
7. 尺寸建议：每格 960x540，总图 = 960×cols × 540×rows
8. 当存在参考图映射时，统一使用 `图片1/图片2/...` 指代参考图，不要把它和 `格1/格2/...` 混用
