import { onMounted, onUnmounted, ref, type Ref } from 'vue'

type ViewportCallback = (visible: boolean) => void

export function useInViewport(
  target: Ref<HTMLElement | null | undefined>,
  onChange?: ViewportCallback,
  rootMargin = '160px 0px',
) {
  const inView = ref(false)
  let observer: IntersectionObserver | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  onMounted(() => {
    if (!target.value) return
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (hideTimer) {
            clearTimeout(hideTimer)
            hideTimer = null
          }
          inView.value = true
          onChange?.(true)
          return
        }
        hideTimer = setTimeout(() => {
          inView.value = false
          onChange?.(false)
          hideTimer = null
        }, 280)
      },
      { rootMargin, threshold: 0.01 },
    )
    observer.observe(target.value)
  })

  onUnmounted(() => {
    if (hideTimer) clearTimeout(hideTimer)
    observer?.disconnect()
    observer = null
  })

  return { inView }
}

export const vInViewport = {
  mounted(el: HTMLElement, binding: { value?: ViewportCallback }) {
    const callback = binding.value
    const observer = new IntersectionObserver(
      ([entry]) => callback?.(entry.isIntersecting),
      { rootMargin: '160px 0px', threshold: 0.01 },
    )
    observer.observe(el)
    ;(el as HTMLElement & { __viewportObserver?: IntersectionObserver }).__viewportObserver = observer
  },
  unmounted(el: HTMLElement) {
    const target = el as HTMLElement & { __viewportObserver?: IntersectionObserver }
    target.__viewportObserver?.disconnect()
    delete target.__viewportObserver
  },
}
