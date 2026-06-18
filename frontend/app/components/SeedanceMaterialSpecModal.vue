<template>
  <div v-if="open" class="seedance-spec-overlay" @click.self="close">
    <div class="seedance-spec-modal card" role="dialog" aria-labelledby="seedance-spec-title">
      <header class="seedance-spec-head">
        <h2 id="seedance-spec-title" class="seedance-spec-title">Seedance2.0 · 官方素材输入规范</h2>
        <p class="seedance-spec-lead dim">
          为减少生成失败或内容缺失，请在提交前确认提示词及参考素材符合以下要求。
        </p>
      </header>

      <div class="seedance-spec-grid">
        <section class="seedance-spec-card seedance-spec-card--text">
          <h3>文本 · 提示词建议</h3>
          <ul>
            <li>建议提示词控制在 <strong>2000 字</strong>以内。</li>
            <li>文本过长会导致信息分散，模型可能忽略部分细节，仅关注重点内容，从而使生成视频缺少预期元素。</li>
          </ul>
        </section>

        <section class="seedance-spec-card seedance-spec-card--image">
          <h3>图片 · 单张图片上传要求</h3>
          <ul>
            <li><strong>格式：</strong>支持 .jpeg、.png、.webp、.bmp、.tiff、.gif</li>
            <li><strong>宽高比：</strong>(0.4, 2.5)</li>
            <li><strong>宽度和高度：</strong>均需在 (300, 6000) 像素范围内</li>
            <li><strong>文件大小：</strong>单张图片必须小于 30 MB；请求体总大小不得超过 64 MB；大文件请勿使用 Base64 编码</li>
            <li><strong>图片数量：</strong>首尾帧模式为 2 张；多模态参考视频支持 1–9 张</li>
          </ul>
        </section>

        <section class="seedance-spec-card seedance-spec-card--video">
          <h3>视频 · 视频输入要求</h3>
          <ul>
            <li><strong>格式：</strong>支持 mp4、mov；具体编码格式以接口支持列表为准</li>
            <li><strong>分辨率：</strong>支持 480P、720P、1080P</li>
            <li><strong>时长：</strong>单个视频须为 2–15 秒；最多提交 3 个参考视频，所有视频总时长不得超过 15 秒</li>
            <li><strong>尺寸：</strong>宽高比 (宽/高) 为 [0.4, 2.5]；宽度和高度均为 [300, 6000] 像素</li>
            <li><strong>总像素：</strong>宽 × 高须在 [409600, 2086876] 范围内（约 640×640 至 2206×946）</li>
            <li><strong>大小与帧率：</strong>单个视频不得超过 100 MB；帧率须为 24–60 FPS</li>
          </ul>
        </section>

        <section class="seedance-spec-card seedance-spec-card--audio">
          <h3>音频 · 音频输入要求</h3>
          <ul>
            <li><strong>格式：</strong>支持 wav、mp3</li>
            <li><strong>时长：</strong>单段音频须为 2–15 秒；最多提供 3 段参考音频，所有音频总时长不得超过 15 秒</li>
            <li><strong>文件大小：</strong>单个音频文件不得超过 15 MB</li>
            <li><strong>总大小：</strong>请求体总大小不得超过 64 MB；大文件请勿使用 Base64 编码</li>
          </ul>
        </section>
      </div>

      <footer class="seedance-spec-foot">
        <button type="button" class="btn btn-primary seedance-spec-confirm" @click="close">我知道了</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['update:open'])

function close() {
  emit('update:open', false)
}
</script>

<style scoped>
.seedance-spec-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.78);
}

.seedance-spec-modal {
  width: min(920px, 100%);
  max-height: min(92vh, 880px);
  overflow: auto;
  padding: 22px 24px 20px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.seedance-spec-head {
  margin-bottom: 18px;
}

.seedance-spec-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.seedance-spec-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
}

.seedance-spec-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.seedance-spec-card {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.seedance-spec-card h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}

.seedance-spec-card ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
}

.seedance-spec-card li + li {
  margin-top: 6px;
}

.seedance-spec-card--text {
  border-color: rgba(168, 85, 247, 0.35);
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(168, 85, 247, 0.03));
}

.seedance-spec-card--image {
  border-color: rgba(59, 130, 246, 0.35);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.03));
}

.seedance-spec-card--video {
  border-color: rgba(34, 197, 94, 0.35);
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.03));
}

.seedance-spec-card--audio {
  border-color: rgba(249, 115, 22, 0.35);
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(249, 115, 22, 0.03));
}

.seedance-spec-foot {
  display: flex;
  justify-content: center;
  margin-top: 18px;
  padding-top: 4px;
}

.seedance-spec-confirm {
  min-width: 160px;
  padding: 10px 28px;
  font-size: 14px;
}

@media (max-width: 720px) {
  .seedance-spec-grid {
    grid-template-columns: 1fr;
  }

  .seedance-spec-modal {
    padding: 18px 16px 16px;
  }
}
</style>
