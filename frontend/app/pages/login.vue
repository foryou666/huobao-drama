<template>
  <div class="login-page">
    <div class="login-card card">
      <div class="login-brand">
        <div class="login-mark">红</div>
        <div>
          <h1 class="login-title">红果短剧</h1>
          <p class="login-desc">登录后继续制作</p>
        </div>
      </div>
      <form class="login-form" @submit.prevent="submit">
        <label class="field">
          <span class="field-label">用户名</span>
          <input v-model="username" class="input" autocomplete="username" required autofocus />
        </label>
        <label class="field">
          <span class="field-label">密码</span>
          <input v-model="password" class="input" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit" class="btn btn-primary login-btn" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'

definePageMeta({ layout: false })

const { login } = useAuth()
const username = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await login(username.value.trim(), password.value)
    toast.success('登录成功')
    navigateTo('/')
  } catch (e) {
    toast.error(e.message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-base);
}
.login-card {
  width: 100%;
  max-width: 400px;
  padding: 32px;
}
.login-brand {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 28px;
}
.login-mark {
  width: 48px;
  height: 48px;
  border-radius: var(--radius);
  background: var(--bg-2);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--accent-text);
}
.login-title {
  font-family: var(--font-display);
  font-size: 20px;
  margin: 0;
}
.login-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-3);
}
.login-form { display: flex; flex-direction: column; gap: 16px; }
.login-btn { width: 100%; margin-top: 4px; }
</style>
