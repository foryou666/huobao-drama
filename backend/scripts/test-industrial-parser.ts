import { parseIndustrialScript, parseIndustrialScriptDetailed, validateParsedImport } from '../src/utils/industrial-script-parser.js'

const templateSample = `【场景：S01 场景名 日内/外】

【镜头 001 - 动作描述/角色标签】
时长：1-3秒
景别与角度：（从速查表选择）
运镜方式：（从运镜关键词库选择）
打光细化：严格继承场景基准，主光源打亮面部
表演与微表情：眼睛/嘴角/眉头/手部具体动作
台词/音效："对话" 或 【音效】描述
AI补充提示词：英文描述，包含景别+角度+运镜+光影+动作+氛围
AI补充提示词（中文版）：中文描述，包含景别+角度+运镜+光影+动作+氛围
【镜头 002 - 动作描述/角色标签】
（格式同上，严格1:1对应原剧本）`

const deepseekSample = `### 【场景：S01 御书房 夜内】

【镜头 001 - 户部尚书跪地/为难】
时长：2秒
景别与角度：中景(MS)，45度侧角
运镜方式：快速横移(fast whip pan)
打光细化：严格继承场景基准
表演与微表情：户部尚书跪在暗处
台词/音效：户部尚书（为难）：国库空虚
AI补充提示词：medium shot minister kneeling 8K
AI补充提示词（中文版）：中景大臣跪地

【镜头 002 - 萧初渊敲桌/压迫】
时长：1.5秒
景别与角度：特写(CU)，45度侧角
运镜方式：极速推镜(extreme fast push-in)
打光细化：烛光从下方打亮
表演与微表情：手指敲桌
台词/音效：【音效】敲桌三声
AI补充提示词：close-up fingers tapping desk
AI补充提示词（中文版）：特写敲桌

【镜头 003 - 众官低头】
时长：2秒
景别与角度：中景(MS)，侧面平视
运镜方式：微推(slow push-in)
打光细化：严格继承场景基准
表演与微表情：众官低眉
台词/音效：无
AI补充提示词：medium shot officials bowing
AI补充提示词（中文版）：中景众官低头`

console.log('template only:', parseIndustrialScript(templateSample).length, validateParsedImport(parseIndustrialScriptDetailed(templateSample)))
console.log('deepseek:', parseIndustrialScript(deepseekSample).map(s => `${s.shotNumber}:${s.title}`))
console.log('mixed:', parseIndustrialScript(`${templateSample}\n\n${deepseekSample}`).map(s => `${s.shotNumber}:${s.title}`))

const hookSample = `【镜头 030 - 悬念钩子 猫爪心声】
时长：2秒
景别与角度：极端特写(ECU)，正面平视
运镜方式：极速推镜(extreme fast push-in)
打光细化：严格继承场景基准
表演与微表情：猫眼放大
台词/音效：岑柚（VO）："test"
AI补充提示词：extreme close-up cat eyes 8K
AI补充提示词（中文版）：猫眼极端特写`

const hookResult = parseIndustrialScriptDetailed(hookSample)
console.log('hook shot kept:', hookResult.shots.length === 1, hookResult.shots[0]?.title)
console.log('template hook skipped:', parseIndustrialScriptDetailed(`【镜头 XXX - 悬念钩子】\n时长：1-2秒\n景别与角度：极端特写(ECU)，正面平视\n运镜方式：极速推镜\n打光细化：严格继承场景基准\n表演与微表情：眼睛猛地睁大\n台词/音效：【音效】震撼音效\nAI补充提示词：extreme close-up of eyes\nAI补充提示词（中文版）：眼睛的极限特写`).skipped_template_count === 1)
