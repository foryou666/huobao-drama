# VSR Local API

Wraps [video-subtitle-remover](https://github.com/foryou666/video-subtitle-remover) as an HTTP service for the online huobao-drama server.

## Quick start (Windows)

```powershell
cd tools/vsr-api
.\setup.ps1

# Full GPU processing needs VSR runtime + models (see below).
$env:VSR_ROOT = "C:\Users\zzyun\Projects\huobao-drama\tools\video-subtitle-remover"
$env:VSR_PYTHON = "C:\Users\zzyun\AppData\Local\Programs\Python\Python312\python.exe"
$env:VSR_API_KEY = "change-me"
.\start.ps1
```

`setup.ps1` uses `fetch_vsr_source.py` to pull code via GitHub API (skips large model/ffmpeg blobs). If git/curl zip fails on your network, this still works.

### VSR runtime (required for actual jobs)

Source code alone is not enough — you need **models + ffmpeg + Paddle/Torch**. Easiest on Windows:

1. Download official prebuilt package from [video-subtitle-remover releases](https://github.com/YaoFANGUK/video-subtitle-remover/releases) (e.g. `VSR_v1.4.0_windows_x64_cpu_Setup.exe`), **or** the CUDA 12.8 build for RTX 50-series (`vsr-windows-nvidia-cuda-12.8.7z` per upstream README).
2. Point `VSR_ROOT` at the installed directory (must contain `backend/main.py` + `backend/models/`).
3. Point `VSR_PYTHON` at the Python inside that package (prebuilt includes deps).

Your machine: **RTX 5060** → prefer CUDA 12.8 build when available.

Health: `GET http://127.0.0.1:7861/health`

## Expose to production server

The online server cannot reach your PC unless you expose the port:

- **cpolar / ngrok / frp** tunnel → `https://xxx.cpolar.cn` → local `:7861`
- Or same LAN IP if production runs locally

Set in huobao **设置 → AI 服务 → 去字幕 API**:
- Base URL: `https://your-tunnel-host` (no trailing slash)
- API Key: same as `VSR_API_KEY`

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | VSR path check |
| POST | `/v1/jobs` | multipart: `file`, optional `inpaint_mode`, `subtitle_areas` JSON |
| GET | `/v1/jobs/{id}` | job status |
| GET | `/v1/jobs/{id}/output` | download result video |
| DELETE | `/v1/jobs/{id}` | cleanup |

Auth: `Authorization: Bearer <VSR_API_KEY>` when key is set.
