# 微信支付配置（服务商模式）

子商户：鲸灵科技 `1114942867`（郑州灵鲸科技有限公司）  
服务商代收款：在 `backend/.env` 配置下列变量（勿提交 Git）。

```env
PUBLIC_BASE_URL=https://ai.weikuaiche.cn

# 服务商模式
WECHATPAY_MODE=partner
WECHATPAY_SP_APP_ID=wx4b898410a5563c0f
WECHATPAY_SP_MCH_ID=1680763001
WECHATPAY_SUB_MCH_ID=1114942867
WECHATPAY_API_V3_KEY=你的APIv3密钥
WECHATPAY_SERIAL_NO=证书序列号（可留空，自动从 apiclient_cert.pem 读取）
WECHATPAY_PRIVATE_KEY_PATH=./certs/apiclient_key.pem
WECHATPAY_CERT_PATH=./certs/apiclient_cert.pem
WECHATPAY_PLATFORM_CERT_PATH=./certs/wechatpay_platform.pem
WECHATPAY_NOTIFY_URL=https://ai.weikuaiche.cn/api/v1/payments/wechat/notify
WECHATPAY_MERCHANT_NAME=鲸灵科技
```

证书文件放 `backend/certs/`（已 gitignore）。平台公钥证书可在首次回调时自动拉取。

回调地址：`https://ai.weikuaiche.cn/api/v1/payments/wechat/notify`

充值页：`/recharge`
