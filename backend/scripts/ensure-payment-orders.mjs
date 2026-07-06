import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dbPath = process.env.DB_PATH || path.join(root, 'data/huobao_drama.db')
const db = new Database(dbPath)

db.exec(`
CREATE TABLE IF NOT EXISTS payment_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'wechat',
  package_id TEXT,
  amount_yuan INTEGER NOT NULL,
  amount_fen INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  code_url TEXT,
  wx_prepay_id TEXT,
  wx_transaction_id TEXT,
  credit_transaction_id INTEGER,
  error_msg TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
`)

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_orders'").all()
console.log('db:', dbPath)
console.log('payment_orders:', tables.length ? 'ok' : 'missing')
