import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/industrial/hongguo_shot_list.txt')

let cachedPrompt = ''
let cachedMtime = 0

export function getIndustrialShotPrompt(): string {
  if (!fs.existsSync(PROMPT_PATH)) return ''
  const mtime = fs.statSync(PROMPT_PATH).mtimeMs
  if (cachedPrompt && cachedMtime === mtime) return cachedPrompt
  cachedPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8').trim()
  cachedMtime = mtime
  return cachedPrompt
}

export const SHOT_PLAN_GENERATION_SUFFIX = `
## 生成任务说明

你正在为本集生成**完整可导入的工业分镜脚本**，输出格式必须与上述规范第六节「工业级分镜脚本模板」一致。

硬性要求：
1. 覆盖格式化剧本中的**全部情节**，不得遗漏场景或关键对白
2. 每个镜头 1-3 秒，单镜头禁止超过 3 秒
3. 镜头编号从 001 连续递增，按场景分组输出【场景：Sxx ...】
4. 角色使用 R01/R02… 标签，场景使用 S01/S02… 标签（与下方素材库一致）
5. 每个镜头必须填写：时长、景别与角度、运镜方式、打光细化、表演与微表情、台词/音效、AI补充提示词（中英各一）
6. 集末必须有 ECU 悬念钩子镜头 + 【字幕】下集预告
7. **禁止**输出模板占位符（如「动作描述/角色标签」「从速查表选择」）
8. 只输出分镜正文，不要解释步骤，不要用 markdown 代码块包裹全文
`.trim()
