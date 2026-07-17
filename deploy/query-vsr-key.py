#!/usr/bin/env python3
import sqlite3
c = sqlite3.connect('/opt/hongguoduanju/data/huobao_drama.db')
row = c.execute("""
  SELECT base_url, is_active,
    CASE WHEN api_key IS NOT NULL AND length(trim(api_key)) > 0 THEN api_key ELSE '' END
  FROM ai_service_configs WHERE lower(provider)='subtitle_remover' LIMIT 1
""").fetchone()
print('online_base_url=', row[0] if row else None)
print('online_is_active=', row[1] if row else None)
print('online_api_key_set=', bool(row and row[2]))
print('online_api_key_len=', len(row[2]) if row and row[2] else 0)
