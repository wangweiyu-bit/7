import fs from 'fs';
import path from 'path';
import sqlite3pkg from 'sqlite3';

const sqlite3 = sqlite3pkg.verbose();

const DEFAULT_DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'backend', 'data', 'app.db');
const dbDir = path.dirname(DEFAULT_DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new sqlite3.Database(DEFAULT_DB_PATH);

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export async function migrate() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL
  )`);

  // Add new columns safely if they don't exist
  async function hasColumn(table, name){
    const cols = await all(`PRAGMA table_info(${table})`);
    return Array.isArray(cols) && cols.some(c => c.name === name);
  }
  if(!(await hasColumn('users', 'approved'))){
    await run(`ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 0`);
  }
  if(!(await hasColumn('users', 'approved_at'))){
    await run(`ALTER TABLE users ADD COLUMN approved_at TEXT`);
  }
  if(!(await hasColumn('users', 'approved_by'))){
    await run(`ALTER TABLE users ADD COLUMN approved_by INTEGER`);
  }
  if(!(await hasColumn('users', 'wechat_openid'))){
    await run(`ALTER TABLE users ADD COLUMN wechat_openid TEXT UNIQUE`);
  }
  if(!(await hasColumn('users', 'wechat_unionid'))){
    await run(`ALTER TABLE users ADD COLUMN wechat_unionid TEXT`);
  }
  if(!(await hasColumn('users', 'wechat_nickname'))){
    await run(`ALTER TABLE users ADD COLUMN wechat_nickname TEXT`);
  }
  if(!(await hasColumn('users', 'wechat_avatar'))){
    await run(`ALTER TABLE users ADD COLUMN wechat_avatar TEXT`);
  }
  if(!(await hasColumn('users', 'session_version'))){
    await run(`ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`);
  }
  if(!(await hasColumn('users', 'active_device_id'))){
    await run(`ALTER TABLE users ADD COLUMN active_device_id TEXT`);
  }

  await run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    is_paid INTEGER NOT NULL DEFAULT 0,
    link TEXT,
    docs TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    resource_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(resource_id) REFERENCES resources(id)
  )`);

  // Bookings (class consultation/appointment)
  await run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    status TEXT NOT NULL, -- booked | waitlist | cancelled | checked_in
    name TEXT,
    phone TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, date, slot_id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Anonymous boards
  await run(`CREATE TABLE IF NOT EXISTS anon_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL, -- dating | protocol | jobs | rant | trade | exchange
    title TEXT,
    content TEXT NOT NULL,
    tags TEXT, -- comma separated
    media TEXT, -- JSON array of URLs
    status TEXT NOT NULL DEFAULT 'approved', -- pending | approved | removed
    likes_count INTEGER NOT NULL DEFAULT 0,
    comments_count INTEGER NOT NULL DEFAULT 0,
    author_fp TEXT, -- anonymous fingerprint (hashed)
    created_at TEXT NOT NULL
  )`);

  // Safe add columns for anon_posts
  async function tableHasColumn(table, name){
    const cols = await all(`PRAGMA table_info(${table})`);
    return Array.isArray(cols) && cols.some(c => c.name === name);
  }
  if(!(await tableHasColumn('anon_posts','media'))){
    await run(`ALTER TABLE anon_posts ADD COLUMN media TEXT`);
  }

  await run(`CREATE TABLE IF NOT EXISTS anon_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved',
    author_fp TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(post_id) REFERENCES anon_posts(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS anon_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, device_id),
    FOREIGN KEY(post_id) REFERENCES anon_posts(id)
  )`);

  // Store OAuth states for CSRF protection in WeChat login
  await run(`CREATE TABLE IF NOT EXISTS oauth_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    state TEXT UNIQUE NOT NULL,
    redirect_to TEXT,
    created_at TEXT NOT NULL
  )`);

  // Seed minimal resources if table is empty
  const count = await get('SELECT COUNT(1) as n FROM resources');
  if (!count || count.n === 0) {
    await run(
      `INSERT INTO resources (title, category, description, is_paid, link, docs) VALUES
      ('ImageJ 批量阈值宏', '图像分析宏', '对图片批量阈值分割与ROI输出。', 0, '/assets/downloads/ij-batch-threshold.ijm', 'https://example.com/docs/ij-batch'),
      ('ImageJ 多通道分离插件', 'ImageJ 插件', 'czi/lif多通道分离与命名。', 1, '#', 'https://example.com/docs/ij-split'),
      ('CSV 清洗脚本', '数据处理脚本', '缺失值处理、列重命名与统计输出。', 0, '/assets/downloads/csv-cleaner.py', NULL)`
    );
  }

  // Seed default admin if not exists
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@local';
  const admin = await get('SELECT id FROM users WHERE email=?', [adminEmail]);
  if(!admin){
    // Lazy import to avoid circular deps
    const bcryptjs = await import('bcryptjs');
    const hash = await bcryptjs.default.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
    const now = new Date().toISOString();
    await run('INSERT INTO users (email, password_hash, role, created_at, approved, approved_at) VALUES (?,?,?,?,?,?)', [adminEmail, hash, 'admin', now, 1, now]);
  }
}


