#!/usr/bin/env python3
import sqlite3
c = sqlite3.connect('/opt/hongguoduanju/data/huobao_drama.db')
rows = c.execute("""
  SELECT id, status, error_msg, remote_job_id, created_at, updated_at
  FROM subtitle_removal_jobs ORDER BY id DESC LIMIT 3
""").fetchall()
for row in rows:
    print(row)
