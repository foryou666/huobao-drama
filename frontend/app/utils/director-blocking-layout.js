import {
  mannequinColorCss,
  resolveBlockingLayout,
} from '~/utils/blocking-layout.js'

/** 3D 导演台站位区域 → 世界坐标（相机在 +Z 看向原点） */
export const DIRECTOR_BLOCKING_ZONE_POSITIONS = {
  left_front: [-1.6, 0, 1.2],
  center: [0, 0, 0],
  right_front: [1.6, 0, 1.2],
  left_back: [-1.6, 0, -1.4],
  right_back: [1.6, 0, -1.4],
}

/** 朝向 → Y 轴旋转（弧度，默认面向相机） */
export const DIRECTOR_BLOCKING_FACING_ROTATIONS = {
  camera: 0,
  front: 0,
  left: Math.PI / 2,
  right: -Math.PI / 2,
  back: Math.PI,
}

export function buildDirectorBlockingLayoutPayload(layout, nameById) {
  const resolved = resolveBlockingLayout(layout, (layout?.characters || []).map(item => item.character_id))
  const characters = (resolved.characters || []).map((entry, index) => {
    const zone = entry.zone || 'center'
    const facing = entry.facing || 'camera'
    const position = DIRECTOR_BLOCKING_ZONE_POSITIONS[zone] || DIRECTOR_BLOCKING_ZONE_POSITIONS.center
    const rotationY = DIRECTOR_BLOCKING_FACING_ROTATIONS[facing] ?? 0
    const name = typeof nameById === 'function'
      ? nameById(entry.character_id)
      : (nameById?.[entry.character_id] || `角色${index + 1}`)

    return {
      characterId: entry.character_id,
      name,
      zone,
      facing,
      color: mannequinColorCss(index),
      position,
      rotationY,
    }
  })

  return {
    characters,
    notes: resolved.notes || '',
  }
}
