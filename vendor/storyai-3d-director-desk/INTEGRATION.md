# storyai-3d-director-desk (vendor)

上游开源：[jiguang132/storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk)（MIT）

## 在本项目中的位置

- 源码：`vendor/storyai-3d-director-desk/`
- 构建产物：`frontend/public/director-3d/`（由 `scripts/build-director-3d.mjs` 生成）
- 宿主页面：`frontend/app/pages/director/index.vue`（路由 `/director`）
- 通信桥：`frontend/app/composables/useDirectorDeskHost.ts` ↔ `src/editor/io/hostBridge.ts`

## 构建

```bash
node scripts/build-director-3d.mjs
```

前端生产构建会自动执行（`npm run generate:dist`）。

## 开发

1. 先构建一次导演台静态资源（或 `cd vendor/storyai-3d-director-desk && npm run dev` 单独调试）
2. 启动红果前端 `cd frontend && npm run dev`
3. 打开 `http://localhost:3013/director`

带项目上下文：`/director?drama_id=1&episode_id=2&storyboard_id=3`
