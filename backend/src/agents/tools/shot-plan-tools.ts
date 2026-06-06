import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { logTaskSuccess } from '../../utils/task-logger.js'
import { buildShotPlanContext } from '../../services/shot-plan-context.js'
import { importIndustrialScript } from '../../services/shot-plans.js'

export function createShotPlanTools(episodeId: number, dramaId: number) {
  const readShotPlanContext = createTool({
    id: 'read_shot_plan_context',
    description: 'Read screenplay, character library (R01…), scene library (S01…), and existing shot plans for industrial shot list generation.',
    inputSchema: z.object({}),
    execute: async () => {
      const result = buildShotPlanContext(episodeId, dramaId)
      if ('error' in result) return { error: result.error }
      return result
    },
  })

  const importIndustrialScriptTool = createTool({
    id: 'import_industrial_script',
    description: 'Import the generated industrial shot list markdown into the database. Parses shots, auto-groups clips, and sets video_prompt on each clip.',
    inputSchema: z.object({
      text: z.string().describe('Complete industrial shot list markdown (【场景：...】 + 【镜头 001 - ...】 blocks)'),
    }),
    execute: async ({ text }) => {
      const trimmed = String(text || '').trim()
      if (!trimmed) return { error: 'text 不能为空' }
      try {
        const result = importIndustrialScript(episodeId, dramaId, trimmed)
        logTaskSuccess('ShotPlanTools', 'import_industrial_script', { episodeId, ...result })
        return result
      } catch (err) {
        return { error: (err as Error).message }
      }
    },
  })

  return {
    readShotPlanContext,
    importIndustrialScript: importIndustrialScriptTool,
  }
}
