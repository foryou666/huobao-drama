import { ref } from 'vue'

/**
 * 遮罩层关闭：仅当按下与松开都在遮罩上时才触发，避免框内拖选文字时误关。
 */
export function useOverlayDismiss(onDismiss: () => void) {
  const overlayMouseDown = ref(false)

  function onOverlayMouseDown(event: MouseEvent) {
    overlayMouseDown.value = event.target === event.currentTarget
  }

  function onOverlayClick(event: MouseEvent) {
    if (overlayMouseDown.value && event.target === event.currentTarget) {
      onDismiss()
    }
    overlayMouseDown.value = false
  }

  return {
    onOverlayMouseDown,
    onOverlayClick,
  }
}
