<template>
  <div class="page agreement-page">
    <div class="agreement-card card">
      <div class="agreement-head">
        <NuxtLink to="/music" class="agreement-back">← 返回配乐生成</NuxtLink>
        <h1 class="agreement-title">配乐权属声明</h1>
        <p class="dim agreement-meta">更新日期：2026年8月1日 · 生效日期：2026年8月1日</p>
      </div>

      <article class="agreement-body">
        <p>
          为明确影光工场 AI 配乐服务所涉音乐作品的权利归属与使用边界，特制定本声明。
          您使用配乐生成服务即视为知悉并同意本声明。
        </p>

        <h2>一、权利主体</h2>
        <p>
          1.1 通过本平台配乐功能生成的音乐作品，其相关知识产权与可授权权利，由<strong>影光工场（平台运营方）</strong>
          作为权利人或权利管理人进行管理与对外授权（具体以订单及授权证书记载为准）。
        </p>
        <p>
          1.2 上游模型服务商仅提供技术能力，不改变本平台与用户之间就生成结果所建立的授权安排。
        </p>

        <h2>二、用户获得的权利</h2>
        <p>
          2.1 在您成功生成并完成支付/扣费后，平台向您授予<strong>非独占、不可转让、有期限</strong>的使用许可，
          许可范围以《授权证书》载明的项目名称、使用场景、授权区域、授权渠道、授权期限为准。
        </p>
        <p>
          2.2 授权期限为<strong>永久</strong>（自授权证书出具之日起，无固定截止日）。用户等级有效期（默认 2026年1月1日 至 2027年1月1日）仅用于会员身份展示，不构成对授权期限的限制。
        </p>
        <p>
          2.3 您可将授权音乐用于短剧、影视及其他证书允许的网络传播场景；不得单独售卖音源或进行再许可。
        </p>

        <h2>三、订单与证书</h2>
        <p>
          3.1 每一次生成对应唯一<strong>订单编号</strong>（格式示例：YG-BGM-YYYYMMDD-XXXXXX），并与生成记录、扣费流水关联保存。
        </p>
        <p>
          3.2 对已完成的配乐，您可在作品卡片中查看并打印《授权证书》。证书含被授权方（用户名）、用户等级、
          订单编号、作品清单及签章信息，作为权属与授权证明文件。
        </p>
        <p>
          3.3 证书不得伪造、篡改；篡改无效，平台有权撤销授权并追究责任。
        </p>

        <h2>四、禁止事项</h2>
        <p>4.1 不得将生成音乐用于违法违规内容或侵害他人合法权益的用途。</p>
        <p>4.2 不得去除、遮挡平台权属标识（如有）或虚假宣称拥有完整著作权转让。</p>
        <p>4.3 不得利用技术手段批量爬取、盗用他人订单或证书信息。</p>

        <h2>五、侵权与责任</h2>
        <p>
          5.1 如第三方主张权利，平台有权要求您暂停使用、下架相关内容，并配合核查。
          因您违规使用导致的损失与责任由您承担。
        </p>
        <p>
          5.2 平台在法律法规允许范围内对 AI 生成结果不作特定用途的保证。
        </p>

        <h2>六、其他</h2>
        <p>
          6.1 本声明与《配乐服务用户协议》《充值协议》构成完整文件；冲突时以对权利归属与合规义务约定更明确者为准。
        </p>
        <p>
          6.2 平台可根据业务与合规需要更新本声明，更新后以页面公示版本为准。
        </p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.agreement-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 16px 48px;
  box-sizing: border-box;
}
.agreement-card { padding: 28px 24px; }
.agreement-back {
  display: inline-block;
  margin-bottom: 16px;
  color: var(--text-1);
  font-size: 14px;
  text-decoration: none;
}
.agreement-back:hover { color: var(--accent-text); }
.agreement-title { margin: 0 0 8px; font-size: 26px; }
.agreement-meta { margin: 0 0 24px; font-size: 13px; }
.agreement-body { line-height: 1.75; font-size: 15px; color: var(--text-1); }
.agreement-body h2 { margin: 28px 0 12px; font-size: 18px; }
.agreement-body p { margin: 0 0 12px; }
</style>
