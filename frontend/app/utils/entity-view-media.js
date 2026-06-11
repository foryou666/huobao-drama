import { listSceneImages } from './scene-image-variants.js'
import { listPropImages } from './prop-image-variants.js'

export function resolveViewPreviewsFromMedia(media) {
  if (!media) return []
  const direct = media.view_previews || media.viewPreviews
  if (direct?.length) return direct

  const images = media.preview_images || media.previewImages || []
  const groups = new Map()
  for (const img of images) {
    const viewId = img.view_id || img.viewId || img.angle_id || img.angleId || img.url
    if (!viewId) continue
    if (!groups.has(viewId)) {
      groups.set(viewId, {
        view_id: viewId,
        label: img.label || img.tag || viewId,
        url: img.url,
      })
    }
  }
  return [...groups.values()]
}

export function summarizeSceneMedia(scene) {
  const views = listSceneImages(scene)
  const primaryUrl = views.find(v => v.angle_id === 'hero')?.url || views[0]?.url || null
  return {
    view_count: views.length,
    image_count: views.length,
    primary_url: primaryUrl,
    view_previews: views.map(view => ({
      view_id: view.angle_id,
      label: view.label,
      url: view.url,
    })),
    preview_images: views.map(view => ({
      url: view.url,
      label: view.label,
      tag: view.angle_id === 'hero' ? '主视角' : view.label,
      view_id: view.angle_id,
      is_primary: view.angle_id === 'hero',
    })),
  }
}

export function buildSceneMediaFromImages(images) {
  const views = (images || []).filter(img => img?.angle_id || img?.view_id)
  return {
    view_count: views.length,
    image_count: views.filter(img => img.url).length,
    view_previews: views.map(img => ({
      view_id: img.angle_id || img.view_id,
      label: img.label || img.angle_id || '视角',
      url: img.url || '',
      readonly: !!img.readonly,
    })),
    preview_images: views.map(img => ({
      url: img.url || '',
      label: img.label,
      tag: img.label,
      view_id: img.angle_id || img.view_id,
      is_primary: (img.angle_id || img.view_id) === 'hero',
    })),
  }
}

export function summarizePropMedia(prop) {
  const views = listPropImages(prop)
  const primaryUrl = views.find(v => v.view_id === 'hero')?.url || views[0]?.url || null
  return {
    view_count: views.length,
    image_count: views.length,
    primary_url: primaryUrl,
    view_previews: views.map(view => ({
      view_id: view.view_id,
      label: view.label,
      url: view.url,
    })),
    preview_images: views.map(view => ({
      url: view.url,
      label: view.label,
      tag: view.view_id === 'hero' ? '主图' : view.label,
      view_id: view.view_id,
      is_primary: view.view_id === 'hero',
    })),
  }
}
