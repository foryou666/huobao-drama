<template>
  <div class="page agreement-page">
    <div class="agreement-card card">
      <div class="agreement-head">
        <NuxtLink to="/music" class="agreement-back">← 返回配乐生成</NuxtLink>
        <h1 class="agreement-title">配乐服务用户协议</h1>
        <p class="dim agreement-meta">更新日期：2026年8月1日 · 生效日期：2026年8月1日</p>
      </div>

      <article class="agreement-body">
        <p>
          欢迎使用影光工场（以下简称「本平台」）提供的 AI 配乐生成服务。请您在使用前仔细阅读本协议。
          一旦点击同意并提交生成，即视为您已充分理解并接受本协议全部内容。
        </p>

        <h2>一、服务内容</h2>
        <p>1.1 本平台通过接入合规上游模型（含 MiniMax 官方音乐生成能力）为您提供背景音乐/歌曲生成、试听、下载及授权证书出具等服务。</p>
        <p>1.2 每次成功提交生成请求，系统将创建唯一<strong>订单编号</strong>，并保留完整生成记录，作为权属与授权凭证的一部分。</p>
        <p>1.3 服务以积分或其他平台规则约定的方式计费，具体扣费以提交时页面展示及账户流水为准。</p>

        <h2>二、账户与会员等级</h2>
        <p>2.1 您应使用真实、合法的账户信息。用户名、显示名将作为授权证书中的「被授权方」信息展示。</p>
        <p>2.2 用户等级有效期默认自 <strong>2026年1月1日</strong> 至 <strong>2027年1月1日</strong>（仅会员身份展示）。配乐<strong>授权期限为永久</strong>，自授权证书出具之日起生效，无固定截止日。</p>
        <p>2.3 管理员账户与标准会员在功能权限上可能不同，但不影响本协议对权属与合规义务的适用。</p>

        <h2>三、生成内容与使用</h2>
        <p>3.1 AI 生成内容具有不确定性，可能与您的预期不完全一致。您应在商业使用前自行审核。</p>
        <p>3.2 您不得利用本服务生成、传播违法违规、侵权或违背公序良俗的内容。</p>
        <p>3.3 您应确保输入的提示词、歌词不侵犯第三方权利；因输入内容引发的争议由您自行承担。</p>

        <h2>四、授权与证书</h2>
        <p>4.1 对状态为「已完成」的配乐，平台可为您出具《授权证书》，载明订单编号、被授权方、授权期限、使用场景与作品清单。</p>
        <p>4.2 授权范围为证书载明的项目与期限；超出范围的使用须另行取得授权。</p>
        <p>4.3 证书为非独占、不可转让许可，详见《权属声明》。</p>

        <h2>五、费用与退款</h2>
        <p>5.1 生成任务提交后，积分按规则扣除。因平台可识别的系统故障导致失败且未产生有效结果的，平台将退回当次扣费。</p>
        <p>5.2 因您自身输入、账户或网络原因导致的失败，是否退费由平台依据规则判断。</p>

        <h2>六、协议变更与争议</h2>
        <p>6.1 平台有权修订本协议，修订后通过页面公告。继续使用视为接受修订。</p>
        <p>6.2 争议应友好协商；协商不成的，提交平台运营主体所在地有管辖权的人民法院解决。</p>
        <p>6.3 本协议与《权属声明》《充值协议》共同适用；未尽事宜适用中华人民共和国法律法规。</p>
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
