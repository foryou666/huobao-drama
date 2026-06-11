/**
 * 版本更新记录
 *
 * 每次发版请：
 * 1. 在 CHANGELOG 数组最前面追加新版本条目
 * 2. 同步更新 frontend/package.json 的 version
 * 3. 运行 npm run generate:dist 重新打包
 */

export interface ChangelogEntry {
  version: string
  date: string
  title?: string
  changes: string[]
}

/** 按版本从新到旧排列 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.0.4',
    date: '2026-06-10',
    title: '版本更新记录',
    changes: [
      '新增版本更新记录：点击左下角版本号可查看完整更新日志',
      '制作助手角色/场景操作严格限定为当前集（批量生成、读取、音色分配等）',
      '批量生成时自动忽略非本集角色与场景 ID',
      '补全 2.0.0 以来主要历史版本的更新说明',
    ],
  },
  {
    version: '2.0.3',
    date: '2026-06-10',
    title: '版本标识与制作体验',
    changes: [
      '左下角显示前端版本号与构建时间',
      '团队统计修正：净消耗计入退款，活动页新增充值列与退款提示',
      '角色定妆照 / 场景设定图提示词模板（四视图定妆、真人实拍场景）',
      '重新提取角色/场景时自动升级旧版英文 image_prompt',
      '侧边栏文字加深、蓝色强调替代绿色、字号增大，去除模糊与抗锯齿导致的发虚',
    ],
  },
  {
    version: '2.0.2',
    date: '2026-06-06',
    title: '资产与视频参考',
    changes: [
      '增强视频生成中的资产引用与音色集成',
      '重构分镜与资产处理后端逻辑',
      '角色换装、参考图与分镜绑定体验优化',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-06-03',
    title: '视频工作台与制作修复',
    changes: [
      '新增独立视频生成页与积分流水记录',
      '视频提示词编辑对比、视频历史记录与切换当前视频',
      '支持手动增删角色/场景，修复多处生成流程问题',
      '修复弹窗在拖拽到遮罩外松开时误关闭',
      '修正特写裁脸与提示词构图相关问题',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-06-02',
    title: '团队协作与基础设施',
    changes: [
      '团队、登录鉴权、积分与协作制作能力',
      '剧集列表摘要、活动日志、手动创建镜头',
      '图片/视频生成任务耗时计时器',
      'OSS 图片上传与存储路径配置',
      '橙梦 / Seedance 视频宽高比与双提供商路由修复',
      'ChatFire 视频 aspectRatio 自适应',
      '剧集页导航与加载状态优化',
      '提交 SQLite 种子库便于开发同步',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-04-12',
    title: '部署与文档',
    changes: [
      '完善 README 与项目说明',
      '修复部署时 Agent Skills 加载失败',
      '调整公共样式与预设按钮交互',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-04-07',
    title: 'Docker 部署',
    changes: [
      '添加 Docker 部署支持',
      '配置相关优化与注册入口',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-04-01',
    title: '初始发布',
    changes: [
      'AI 剧本改写、角色场景提取、分镜拆解全流程',
      '角色/场景/分镜图片生成与宫格图切分',
      'TTS 配音、单镜合成、整集拼接导出',
      'Mastra Agent 制作助手与 Skills 技能体系',
      'Nuxt 3 前端 + Hono 后端 + SQLite 本地存储',
    ],
  },
]

export function findChangelogEntry(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find(entry => entry.version === version)
}
