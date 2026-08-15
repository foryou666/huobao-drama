<template>
  <div class="cert-root" :class="{ 'is-print': printMode }">
    <div class="cert-toolbar no-print">
      <button type="button" class="btn" @click="$emit('close')">关闭</button>
      <button type="button" class="btn primary" @click="printCert">打印 / 另存 PDF</button>
    </div>

    <div class="cert-pages">
      <!-- 第1页 -->
      <section class="cert-page">
        <div class="cert-watermark" aria-hidden="true">第1页</div>
        <header class="cert-header">
          <p class="cert-brand">{{ cert.issuer || '影光工场' }}</p>
          <h1 class="cert-title">授权证书</h1>
          <p class="cert-title-en">AUTHORIZATION CERTIFICATE</p>
        </header>

        <p class="cert-lead">
          {{ cert.issuer_legal || '影光工场（平台运营方）' }}系相关音乐作品在中国大陆地区的合法权利人或权利管理人。
          兹证明向以下被授权方授予本证书载明范围内的音乐使用授权：
        </p>

        <div class="cert-parties">
          <div><span>授权方</span><strong>{{ cert.issuer_legal || '影光工场（平台运营方）' }}</strong></div>
          <div><span>被授权方</span><strong>{{ cert.licensee }}</strong></div>
          <div><span>用户等级</span><strong>付费会员</strong></div>
        </div>

        <h2 class="cert-section">一、项目信息</h2>
        <dl class="cert-dl">
          <div><dt>项目名称</dt><dd>{{ cert.project_name }}</dd></div>
          <div><dt>客户名称</dt><dd>{{ cert.client_name }}</dd></div>
          <div><dt>项目编号 / 订单编号</dt><dd class="mono">{{ cert.order_no }}</dd></div>
          <div><dt>作品名称</dt><dd>{{ cert.work_name }}</dd></div>
          <div><dt>使用场景</dt><dd>{{ cert.usage_scene }}</dd></div>
          <div><dt>授权区域</dt><dd>{{ cert.region }}</dd></div>
          <div><dt>授权日期</dt><dd>{{ cert.issued_at_label || cert.period_label || cert.issued_at }}</dd></div>
          <div><dt>授权渠道</dt><dd>{{ cert.channel }}</dd></div>
          <div><dt>授权权利</dt><dd>{{ cert.rights }}</dd></div>
        </dl>

        <h2 class="cert-section">二、授权说明</h2>
        <p class="cert-clause">
          被授权方有权在上述项目信息所限定的创作项目中，将本证书附件所列音乐作品用于配乐、剪辑、发布与传播。
          超出项目范围的使用，须另行取得书面授权。
        </p>

        <h2 class="cert-section">三、权属声明</h2>
        <p class="cert-clause">
          授权方确认其对附件所列音乐作品享有合法权利或管理权。被授权方依据本证书使用音乐，不视为取得对作品的所有权转让；
          作品权属关系以《权属声明》及平台用户协议为准。
        </p>
      </section>

      <!-- 第2页 -->
      <section class="cert-page">
        <div class="cert-watermark" aria-hidden="true">第2页</div>
        <h2 class="cert-section">四、使用限制</h2>
        <p class="cert-clause">
          被授权方不得将本授权音乐单独出售、转授权、出租或以任何方式允许第三方脱离本项目使用；
          不得宣称对作品拥有完整著作权；不得用于违法违规内容。
        </p>

        <h2 class="cert-section">五、非独占与不可转让</h2>
        <p class="cert-clause">
          本授权为非独占、不可转让许可。授权方仍可向其他用户授予同类权利。
          被授权方不得将本证书项下权利全部或部分转让、质押或再许可。
        </p>

        <h2 class="cert-section">六、传播与维权</h2>
        <p class="cert-clause">
          被授权方可在抖音、快手、视频号、B 站等网络平台发布含本授权音乐的成片内容（限于本证书项目）。
          如发生第三方侵权，授权方有权依法维权；被授权方应予以合理配合。
        </p>

        <h2 class="cert-section">七、其他</h2>
        <p class="cert-clause">
          本证书与平台《用户协议》《权属声明》共同构成完整授权安排。若条款冲突，以对权利人保护更充分者为准。
          本证书自出具之日起生效；授权期限为永久，无固定截止日。
        </p>

        <div class="cert-sign">
          <div class="cert-sign-block">
            <p class="cert-sign-name">{{ cert.issuer_legal || '影光工场（平台运营方）' }}</p>
            <p class="cert-sign-date">{{ cert.issued_at_label || cert.issued_at }}</p>
            <div class="cert-seal" aria-hidden="true">
              <span>影光工场</span>
              <small>授权专用章</small>
            </div>
          </div>
        </div>
      </section>

      <!-- 第3页 -->
      <section class="cert-page">
        <div class="cert-watermark" aria-hidden="true">第3页</div>
        <header class="cert-header cert-header-sm">
          <h1 class="cert-title cert-title-sm">授权音乐作品清单</h1>
          <p class="cert-sub">《{{ cert.issuer || '影光工场' }}》授权音乐作品清单</p>
        </header>

        <div class="cert-parties cert-parties-compact">
          <div><span>授权方</span><strong>{{ cert.issuer_legal }}</strong></div>
          <div><span>被授权方</span><strong>{{ cert.licensee }}</strong></div>
          <div><span>订单编号</span><strong class="mono">{{ cert.order_no }}</strong></div>
        </div>

        <table class="cert-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>歌曲名称</th>
              <th>专辑名称</th>
              <th>词曲作者</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>{{ cert.work_name }}</td>
              <td>{{ cert.album_name }}</td>
              <td>{{ cert.authors }}</td>
            </tr>
          </tbody>
        </table>

        <p class="cert-footnote">
          说明：本清单与授权证书正文具有同等效力。生成模型：{{ cert.model || '—' }}；
          {{ cert.instrumental ? '纯音乐（器乐）' : '含人声/歌词作品' }}。
        </p>

        <div class="cert-sign">
          <div class="cert-sign-block">
            <p class="cert-sign-name">{{ cert.issuer_legal || '影光工场（平台运营方）' }}</p>
            <p class="cert-sign-date">{{ cert.issued_at_label || cert.issued_at }}</p>
            <div class="cert-seal" aria-hidden="true">
              <span>影光工场</span>
              <small>授权专用章</small>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
defineProps({
  cert: { type: Object, required: true },
  printMode: { type: Boolean, default: false },
})

defineEmits(['close'])

function printCert() {
  window.print()
}
</script>

<style scoped>
.cert-root {
  --cert-ink: #1a2433;
  --cert-muted: #5a6a7e;
  --cert-line: #c9b28a;
  --cert-bg: #fffcf7;
  color: var(--cert-ink);
}

.cert-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 12px;
}

/* 三页横向并排，方便一次截屏 */
.cert-pages {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 12px;
  width: max-content;
  max-width: none;
}

.cert-page {
  position: relative;
  flex: 0 0 340px;
  width: 340px;
  background: var(--cert-bg);
  border: 2px solid var(--cert-line);
  box-shadow:
    inset 0 0 0 4px rgba(201, 178, 138, 0.18),
    0 10px 28px rgba(40, 30, 10, 0.12);
  padding: 22px 18px 26px;
  min-height: 520px;
  overflow: hidden;
}

.cert-watermark {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 64px;
  font-weight: 700;
  color: rgba(80, 90, 110, 0.06);
  pointer-events: none;
  letter-spacing: 0.2em;
}

.cert-header { text-align: center; margin-bottom: 14px; }
.cert-header-sm { margin-bottom: 10px; }
.cert-brand {
  margin: 0 0 4px;
  letter-spacing: 0.2em;
  font-size: 10px;
  color: var(--cert-muted);
}
.cert-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.14em;
}
.cert-title-sm { font-size: 16px; letter-spacing: 0.08em; }
.cert-title-en {
  margin: 4px 0 0;
  letter-spacing: 0.12em;
  font-size: 9px;
  color: var(--cert-muted);
}
.cert-sub { margin: 4px 0 0; color: var(--cert-muted); font-size: 11px; }

.cert-lead, .cert-clause {
  line-height: 1.55;
  font-size: 11px;
  margin: 0 0 10px;
  text-align: justify;
}

.cert-parties {
  display: grid;
  gap: 6px;
  margin: 0 0 12px;
  padding: 8px 10px;
  background: rgba(201, 178, 138, 0.1);
  border: 1px solid rgba(201, 178, 138, 0.35);
}
.cert-parties-compact { margin-bottom: 10px; }
.cert-parties div {
  display: grid;
  grid-template-columns: 5.5em 1fr;
  gap: 6px;
  font-size: 11px;
}
.cert-parties span { color: var(--cert-muted); }
.cert-parties strong { font-weight: 600; word-break: break-all; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; }

.cert-section {
  margin: 12px 0 6px;
  font-size: 12px;
  font-weight: 700;
}

.cert-dl {
  margin: 0;
  display: grid;
  gap: 4px;
}
.cert-dl > div {
  display: grid;
  grid-template-columns: 6.5em 1fr;
  gap: 6px;
  padding: 5px 0;
  border-bottom: 1px dashed rgba(120, 100, 70, 0.22);
  font-size: 11px;
}
.cert-dl dt { margin: 0; color: var(--cert-muted); }
.cert-dl dd { margin: 0; font-weight: 560; word-break: break-word; }

.cert-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
  margin: 8px 0 10px;
}
.cert-table th,
.cert-table td {
  border: 1px solid rgba(120, 100, 70, 0.28);
  padding: 6px 7px;
  text-align: left;
  vertical-align: top;
}
.cert-table th {
  background: rgba(201, 178, 138, 0.2);
  font-weight: 650;
}

.cert-footnote {
  font-size: 10px;
  color: var(--cert-muted);
  line-height: 1.45;
}

.cert-sign {
  display: flex;
  justify-content: flex-end;
  margin-top: 28px;
}
.cert-sign-block {
  position: relative;
  min-width: 140px;
  text-align: right;
  padding-right: 6px;
}
.cert-sign-name { margin: 0 0 4px; font-weight: 650; font-size: 12px; }
.cert-sign-date { margin: 0; color: var(--cert-muted); font-size: 11px; }

.cert-seal {
  position: absolute;
  right: 0;
  top: -14px;
  width: 72px;
  height: 72px;
  border: 2px solid #c0392b;
  border-radius: 50%;
  color: #c0392b;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0.88;
  transform: rotate(-12deg);
  background: rgba(192, 57, 43, 0.04);
  pointer-events: none;
}
.cert-seal span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.cert-seal small {
  margin-top: 2px;
  font-size: 8px;
  letter-spacing: 0.06em;
}

/* 打印仍按纵向分页 */
@media print {
  .no-print { display: none !important; }
  .cert-pages {
    flex-direction: column;
    width: auto;
    gap: 0;
  }
  .cert-page {
    flex: none;
    width: auto;
    box-shadow: none;
    break-after: page;
    page-break-after: always;
    min-height: auto;
    padding: 36px 40px;
  }
  .cert-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .cert-title { font-size: 36px; }
  .cert-lead, .cert-clause, .cert-parties div, .cert-dl > div { font-size: 13px; }
}

@media (max-width: 1100px) {
  .cert-page {
    flex-basis: 300px;
    width: 300px;
    min-height: 480px;
  }
}
</style>
