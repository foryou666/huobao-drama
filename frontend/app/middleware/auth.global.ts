export default defineNuxtRouteMiddleware(async (to) => {
  const { ready, isLoggedIn, isAdmin, init } = useAuth()
  const { canManageTeam } = useTeam()

  if (!ready.value) await init()

  if (to.path === '/login') {
    if (isLoggedIn.value) return navigateTo('/')
    return
  }

  if (!isLoggedIn.value) {
    return navigateTo('/login')
  }

  if (to.path === '/settings' && !isAdmin.value && !canManageTeam.value) {
    return navigateTo('/')
  }

  if (to.path.startsWith('/videos/repaint') && !isAdmin.value) {
    return navigateTo('/')
  }

  if (to.path.startsWith('/subtitle-remover') && !isAdmin.value) {
    return navigateTo('/')
  }
})
