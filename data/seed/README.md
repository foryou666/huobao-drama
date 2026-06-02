# 开发数据库种子

本目录用于团队共享 SQLite 开发数据，不包含 `data/static/` 下的图片/视频文件。

## 其他开发者

```bash
cd backend && npm run db:import
```

## 维护者更新

```bash
cd backend && npm run db:export
git add data/seed/
git commit -m "chore: update dev database seed"
```

> 种子库导出时会自动脱敏 API Key；导入后请在「设置 → AI 服务」填入自己的 Key。
