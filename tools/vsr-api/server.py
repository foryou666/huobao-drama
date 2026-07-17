"""
Local HTTP API for video-subtitle-remover (VSR).

Run on your GPU machine; online huobao-drama server calls this via SUBTITLE_REMOVER_API_URL.

Env:
  VSR_ROOT          Path to cloned video-subtitle-remover repo
  VSR_PYTHON        Python executable with VSR deps (default: python)
  VSR_API_KEY       Optional bearer token
  VSR_API_PORT      Default 7861
  VSR_JOBS_DIR      Job workspace (default: ./data/jobs)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

APP = FastAPI(title="VSR API", version="1.0.0")
APP.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parent
JOBS_DIR = Path(os.environ.get("VSR_JOBS_DIR", ROOT / "data" / "jobs"))
VSR_ROOT = Path(os.environ.get("VSR_ROOT", ROOT.parent / "video-subtitle-remover"))
VSR_PYTHON = os.environ.get("VSR_PYTHON", "python")
API_KEY = os.environ.get("VSR_API_KEY", "").strip()

JOBS: dict[str, dict[str, Any]] = {}
LOCK = threading.Lock()


def parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return authorization.strip() or None


def auth(token: str | None = None) -> None:
    if not API_KEY:
        return
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def parse_subtitle_areas(raw: str | None) -> list[list[int]]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"subtitle_areas JSON invalid: {exc}") from exc
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="subtitle_areas must be a JSON array")
    out: list[list[int]] = []
    for item in data:
        if not isinstance(item, list) or len(item) != 4:
            raise HTTPException(status_code=400, detail="Each subtitle area needs [ymin, ymax, xmin, xmax]")
        out.append([int(v) for v in item])
    return out


def run_vsr_job(job_id: str) -> None:
    with LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["status"] = "processing"
        job["progress"] = 5
        job["updated_at"] = time.time()

    job_dir = JOBS_DIR / job_id
    input_path = job_dir / job["input_name"]
    output_path = job_dir / job["output_name"]
    main_py = VSR_ROOT / "backend" / "main.py"
    if not main_py.exists():
        with LOCK:
            job = JOBS[job_id]
            job["status"] = "failed"
            job["error"] = f"VSR not found at {VSR_ROOT}. Set VSR_ROOT env."
            job["updated_at"] = time.time()
        return

    cmd = [VSR_PYTHON, str(main_py), "-i", str(input_path), "-o", str(output_path)]
    for area in job.get("subtitle_areas") or []:
        cmd.extend(["-c", *[str(v) for v in area]])
    mode = job.get("inpaint_mode") or "sttn-auto"
    cmd.extend(["--inpaint-mode", mode])

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(VSR_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        with LOCK:
            JOBS[job_id]["pid"] = proc.pid
        stdout, _ = proc.communicate(timeout=int(os.environ.get("VSR_JOB_TIMEOUT_SEC", "7200")))
        with LOCK:
            job = JOBS[job_id]
            job["log_tail"] = (stdout or "")[-4000:]
            job["updated_at"] = time.time()
        if proc.returncode != 0:
            with LOCK:
                job = JOBS[job_id]
                job["status"] = "failed"
                job["error"] = f"VSR exited {proc.returncode}"
            return
        if not output_path.exists():
            with LOCK:
                job = JOBS[job_id]
                job["status"] = "failed"
                job["error"] = "Output file missing after VSR run"
            return
        output_size = output_path.stat().st_size
        if output_size < 1024:
            with LOCK:
                job = JOBS[job_id]
                job["status"] = "failed"
                job["error"] = (
                    f"Output file too small ({output_size} bytes). "
                    "VSR/ffmpeg may have failed — check log_tail and set VSR_FFMPEG_PATH."
                )
                job["output_size"] = output_size
                job["updated_at"] = time.time()
            return
        with LOCK:
            job = JOBS[job_id]
            job["status"] = "completed"
            job["progress"] = 100
            job["output_size"] = output_size
            job["updated_at"] = time.time()
    except subprocess.TimeoutExpired:
        with LOCK:
            job = JOBS[job_id]
            job["status"] = "failed"
            job["error"] = "VSR job timed out"
            job["updated_at"] = time.time()
    except Exception as exc:  # noqa: BLE001
        with LOCK:
            job = JOBS[job_id]
            job["status"] = "failed"
            job["error"] = str(exc)
            job["updated_at"] = time.time()


@APP.get("/health")
def health() -> dict[str, Any]:
    main_py = VSR_ROOT / "backend" / "main.py"
    return {
        "ok": True,
        "vsr_root": str(VSR_ROOT),
        "vsr_ready": main_py.exists(),
        "jobs_dir": str(JOBS_DIR),
        "python": VSR_PYTHON,
        "auth_required": bool(API_KEY),
    }


@APP.post("/v1/jobs")
async def create_job(
    file: UploadFile = File(...),
    inpaint_mode: str = Form("sttn-auto"),
    subtitle_areas: str | None = Form(None),
    authorization: str | None = Header(None, alias="Authorization"),
) -> dict[str, Any]:
    auth(parse_bearer_token(authorization))

    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    areas = parse_subtitle_areas(subtitle_areas)
    allowed_modes = {"sttn-auto", "sttn-det", "lama", "propainter", "opencv"}
    if inpaint_mode not in allowed_modes:
        raise HTTPException(status_code=400, detail=f"inpaint_mode must be one of {sorted(allowed_modes)}")

    job_id = uuid.uuid4().hex
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename).suffix.lower() or ".mp4"
    input_name = f"input{ext}"
    output_name = f"output{ext}"
    input_path = job_dir / input_name

    content = await file.read()
    if len(content) < 1024:
        raise HTTPException(status_code=400, detail="File too small")
    input_path.write_bytes(content)

    now = time.time()
    job = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "input_name": input_name,
        "output_name": output_name,
        "inpaint_mode": inpaint_mode,
        "subtitle_areas": areas,
        "error": None,
        "log_tail": "",
        "created_at": now,
        "updated_at": now,
    }
    with LOCK:
        JOBS[job_id] = job

    thread = threading.Thread(target=run_vsr_job, args=(job_id,), daemon=True)
    thread.start()

    return {"job_id": job_id, "status": "queued"}


@APP.get("/v1/jobs/{job_id}")
def get_job(
    job_id: str,
    authorization: str | None = Header(None, alias="Authorization"),
) -> dict[str, Any]:
    auth(parse_bearer_token(authorization))

    with LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        payload = dict(job)
    payload.pop("input_name", None)
    output_path = JOBS_DIR / job_id / job["output_name"]
    payload["has_output"] = output_path.exists() and output_path.stat().st_size >= 1024
    if output_path.exists():
        payload["output_size"] = output_path.stat().st_size
    return payload


@APP.get("/v1/jobs/{job_id}/output")
def download_output(
    job_id: str,
    authorization: str | None = Header(None, alias="Authorization"),
):
    auth(parse_bearer_token(authorization))

    with LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if job["status"] != "completed":
            raise HTTPException(status_code=409, detail=f"Job status is {job['status']}")
        output_name = job["output_name"]
    output_path = JOBS_DIR / job_id / output_name
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing")
    if output_path.stat().st_size < 1024:
        raise HTTPException(status_code=409, detail="Output file invalid (empty or too small)")
    media = "video/mp4" if output_name.endswith(".mp4") else "application/octet-stream"
    return FileResponse(output_path, media_type=media, filename=output_name)


@APP.delete("/v1/jobs/{job_id}")
def delete_job(
    job_id: str,
    authorization: str | None = Header(None, alias="Authorization"),
) -> dict[str, bool]:
    auth(parse_bearer_token(authorization))

    with LOCK:
        JOBS.pop(job_id, None)
    job_dir = JOBS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    return {"deleted": True}


if __name__ == "__main__":
    import uvicorn

    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("VSR_API_PORT", "7861"))
    uvicorn.run(APP, host="0.0.0.0", port=port)
