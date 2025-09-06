import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, migrate, run, all, get } from './db.js';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// Node 18+ has global fetch; if not, you can install node-fetch and import it

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOW_ORIGIN || true, credentials: true }));

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'please_change_me';
const WECHAT_APPID = process.env.WECHAT_APPID || '';
const WECHAT_SECRET = process.env.WECHAT_SECRET || '';
const WECHAT_REDIRECT = process.env.WECHAT_REDIRECT || '';
const WECHAT_PLATFORM = process.env.WECHAT_PLATFORM || 'qr'; // 'qr' (web, snsapi_login) or 'mp' (mp, snsapi_userinfo)
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || true;

function signToken(user){
  return jwt.sign({ id: user.id, role: user.role, email: user.email, sv: user.session_version || 0 }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req,res,next){
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if(!token) return res.status(401).json({ error: 'Unauthorized' });
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch{ return res.status(401).json({ error: 'Invalid token' }); }
}
async function enforceSingleDevice(req,res,next){
  try{
    const deviceId = String(req.headers['x-device-id'] || '').trim();
    if(!deviceId) return res.status(401).json({ error: 'Missing device id' });
    if(!req.user || !req.user.id) return res.status(401).json({ error: 'Unauthorized' });
    const u = await get('SELECT active_device_id, session_version FROM users WHERE id=?', [req.user.id]);
    if(!u) return res.status(401).json({ error: 'Unauthorized' });
    if(typeof req.user.sv === 'number' && Number(req.user.sv) !== Number(u.session_version||0)){
      return res.status(401).json({ error: 'Session expired' });
    }
    if(u.active_device_id && u.active_device_id !== deviceId){
      return res.status(401).json({ error: 'Logged in on another device' });
    }
    next();
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
}
function requireAdmin(req,res,next){
  if(!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Auth
app.post('/api/auth/register', async (req,res) => {
  try{
    const { email, password } = req.body || {};
    if(!email || !password) return res.status(400).json({ error: 'Missing email/password' });
    const exists = await get('SELECT id FROM users WHERE email=?', [email]);
    if(exists) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const { id } = await run('INSERT INTO users (email, password_hash, role, created_at, approved) VALUES (?,?,?,?,?)', [email, hash, 'normal', now, 0]);
    return res.json({ pendingApproval: true, message: '注册成功，等待管理员授权后才能登录' });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/login', async (req,res) => {
  try{
    const { email, password } = req.body || {};
    const deviceId = String(req.headers['x-device-id'] || '').trim();
    if(!deviceId) return res.status(400).json({ error: 'Missing device id' });
    const u = await get('SELECT * FROM users WHERE email=?', [email]);
    if(!u) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if(!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if(!u.approved){
      return res.status(403).json({ error: 'Not approved', pendingApproval: true });
    }
    const now = new Date().toISOString();
    await run('UPDATE users SET active_device_id=?, session_version=session_version+1 WHERE id=?', [deviceId, u.id]);
    const after = await get('SELECT id, email, role, session_version FROM users WHERE id=?', [u.id]);
    const user = { id: after.id, email: after.email, role: after.role, session_version: after.session_version };
    return res.json({ token: signToken(user), user: { id: after.id, email: after.email, role: after.role } });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/auth/me', auth, enforceSingleDevice, async (req,res) => {
  try{
    const u = await get('SELECT id, email, role, approved, wechat_nickname, wechat_avatar FROM users WHERE id=?', [req.user.id]);
    if(!u) return res.status(404).json({ error: 'Not found' });
    return res.json(u);
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Admin user management
app.get('/api/admin/users', auth, enforceSingleDevice, requireAdmin, async (req,res) => {
  try{
    const approved = req.query.approved;
    const rows = approved === undefined
      ? await all('SELECT id, email, role, approved, created_at, approved_at, wechat_nickname FROM users ORDER BY id DESC')
      : await all('SELECT id, email, role, approved, created_at, approved_at, wechat_nickname FROM users WHERE approved=? ORDER BY id DESC', [Number(approved) ? 1 : 0]);
    return res.json(rows);
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/users/:id/approve', auth, enforceSingleDevice, requireAdmin, async (req,res) => {
  try{
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ error: 'Invalid id' });
    const now = new Date().toISOString();
    const result = await run('UPDATE users SET approved=1, approved_at=?, approved_by=? WHERE id=?', [now, req.user.id, id]);
    if(result.changes === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ ok: true, id });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// WeChat OAuth
app.get('/api/auth/wechat/start', async (req,res) => {
  try{
    if(!WECHAT_APPID || !WECHAT_SECRET || !WECHAT_REDIRECT){
      return res.status(400).json({ error: 'WeChat not configured' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const redirectTo = String(req.query.redirect || '/');
    await run('INSERT INTO oauth_states (provider, state, redirect_to, created_at) VALUES (?,?,?,?)', ['wechat', state, redirectTo, now]);
    const scope = WECHAT_PLATFORM === 'mp' ? 'snsapi_userinfo' : 'snsapi_login';
    const base = WECHAT_PLATFORM === 'mp'
      ? 'https://open.weixin.qq.com/connect/oauth2/authorize'
      : 'https://open.weixin.qq.com/connect/qrconnect';
    const url = `${base}?appid=${encodeURIComponent(WECHAT_APPID)}&redirect_uri=${encodeURIComponent(WECHAT_REDIRECT)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}#wechat_redirect`;
    return res.json({ url, state });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/wechat/callback', async (req,res) => {
  try{
    const { code, state } = req.body || {};
    const deviceId = String(req.headers['x-device-id'] || '').trim();
    if(!deviceId) return res.status(400).json({ error: 'Missing device id' });
    if(!code || !state) return res.status(400).json({ error: 'Missing code/state' });
    const saved = await get('SELECT * FROM oauth_states WHERE provider=? AND state=?', ['wechat', state]);
    if(!saved) return res.status(400).json({ error: 'Invalid state' });
    // Cleanup used state
    await run('DELETE FROM oauth_states WHERE state=?', [state]);

    // Exchange code
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(WECHAT_APPID)}&secret=${encodeURIComponent(WECHAT_SECRET)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const tokenRes = await fetch(tokenUrl);
    const tokenJson = await tokenRes.json();
    if(!tokenJson || !tokenJson.access_token || !tokenJson.openid){
      return res.status(400).json({ error: 'WeChat token failed', detail: tokenJson });
    }
    const accessToken = tokenJson.access_token;
    const openid = tokenJson.openid;
    const unionid = tokenJson.unionid || null;

    // Fetch user info
    const uiRes = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(accessToken)}&openid=${encodeURIComponent(openid)}`);
    const ui = await uiRes.json();
    const nickname = ui && ui.nickname ? String(ui.nickname) : null;
    const avatar = ui && ui.headimgurl ? String(ui.headimgurl) : null;

    // Link or create user
    let u = await get('SELECT * FROM users WHERE wechat_openid=?', [openid]);
    if(!u && unionid){
      u = await get('SELECT * FROM users WHERE wechat_unionid=?', [unionid]);
    }
    const now = new Date().toISOString();
    if(!u){
      const pseudoEmail = `wx_${unionid || openid}@wx.local`;
      const existsEmail = await get('SELECT id FROM users WHERE email=?', [pseudoEmail]);
      const emailToUse = existsEmail ? `wx_${openid}_${Date.now()}@wx.local` : pseudoEmail;
      const randomPass = crypto.randomBytes(12).toString('hex');
      const hash = await bcrypt.hash(randomPass, 10);
      const result = await run('INSERT INTO users (email, password_hash, role, created_at, approved, wechat_openid, wechat_unionid, wechat_nickname, wechat_avatar) VALUES (?,?,?,?,?,?,?,?,?)', [emailToUse, hash, 'normal', now, 0, openid, unionid, nickname, avatar]);
      u = await get('SELECT * FROM users WHERE id=?', [result.id]);
    }else{
      // update profile data if changed
      await run('UPDATE users SET wechat_unionid=COALESCE(?, wechat_unionid), wechat_nickname=COALESCE(?, wechat_nickname), wechat_avatar=COALESCE(?, wechat_avatar) WHERE id=?', [unionid, nickname, avatar, u.id]);
      u = await get('SELECT * FROM users WHERE id=?', [u.id]);
    }

    if(!u.approved){
      return res.json({ pendingApproval: true, message: '已绑定微信，等待管理员授权' });
    }
    await run('UPDATE users SET active_device_id=?, session_version=session_version+1 WHERE id=?', [deviceId, u.id]);
    const after = await get('SELECT id, email, role, session_version FROM users WHERE id=?', [u.id]);
    const user = { id: after.id, email: after.email, role: after.role, session_version: after.session_version };
    return res.json({ token: signToken(user), user: { id: after.id, email: after.email, role: after.role } });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Resources
app.get('/api/resources', async (req,res) => {
  try{ const rows = await all('SELECT * FROM resources ORDER BY id DESC'); return res.json(rows); }
  catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Comments
app.get('/api/comments', async (req,res) => {
  try{
    const topic = String(req.query.topic || 'home');
    const rows = await all(`SELECT c.id, c.topic, c.content, c.created_at, u.email as user_email
                            FROM comments c JOIN users u ON u.id=c.user_id
                            WHERE c.topic=? ORDER BY c.id DESC LIMIT 200`, [topic]);
    return res.json(rows);
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/comments', auth, enforceSingleDevice, async (req,res) => {
  try{
    const { topic, content } = req.body || {};
    if(!topic || !content) return res.status(400).json({ error: 'Missing topic/content' });
    const now = new Date().toISOString();
    const { id } = await run('INSERT INTO comments (topic, user_id, content, created_at) VALUES (?,?,?,?)', [topic, req.user.id, content, now]);
    return res.json({ id, topic, content, created_at: now });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Orders (placeholder)
app.post('/api/orders', auth, enforceSingleDevice, async (req,res) => {
  try{
    const { resource_id, amount } = req.body || {};
    if(!resource_id) return res.status(400).json({ error: 'Missing resource_id' });
    const now = new Date().toISOString();
    const { id } = await run('INSERT INTO orders (user_id, resource_id, status, amount, created_at) VALUES (?,?,?,?,?)', [req.user.id, resource_id, 'pending', amount||0, now]);
    return res.json({ id, status: 'pending' });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Bookings
app.get('/api/bookings', auth, enforceSingleDevice, async (req,res) => {
  try{
    const date = String(req.query.date || '').trim();
    const rows = date
      ? await all('SELECT * FROM bookings WHERE user_id=? AND date=? ORDER BY id DESC', [req.user.id, date])
      : await all('SELECT * FROM bookings WHERE user_id=? ORDER BY id DESC', [req.user.id]);
    return res.json(rows);
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/bookings', auth, enforceSingleDevice, async (req,res) => {
  try{
    const { date, slotId, name, phone, action } = req.body || {};
    if(!date || !slotId) return res.status(400).json({ error: 'Missing date/slotId' });
    const now = new Date().toISOString();
    if(action === 'book' || action === 'queue'){
      const status = action === 'book' ? 'booked' : 'waitlist';
      // insert or update
      const existing = await get('SELECT * FROM bookings WHERE user_id=? AND date=? AND slot_id=?', [req.user.id, date, slotId]);
      if(existing){
        await run('UPDATE bookings SET status=?, name=?, phone=?, updated_at=? WHERE id=?', [status, name||existing.name, phone||existing.phone, now, existing.id]);
        return res.json({ id: existing.id, status });
      }
      const result = await run('INSERT INTO bookings (user_id, date, slot_id, status, name, phone, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [req.user.id, date, slotId, status, name||null, phone||null, now, now]);
      return res.json({ id: result.id, status });
    }
    if(action === 'cancel'){
      const existing = await get('SELECT * FROM bookings WHERE user_id=? AND date=? AND slot_id=?', [req.user.id, date, slotId]);
      if(!existing) return res.status(404).json({ error: 'Not found' });
      await run('UPDATE bookings SET status=?, updated_at=? WHERE id=?', ['cancelled', now, existing.id]);
      return res.json({ id: existing.id, status: 'cancelled' });
    }
    if(action === 'checkin'){
      const existing = await get('SELECT * FROM bookings WHERE user_id=? AND date=? AND slot_id=?', [req.user.id, date, slotId]);
      if(!existing || existing.status!=='booked') return res.status(400).json({ error: 'Not booked' });
      await run('UPDATE bookings SET status=?, updated_at=? WHERE id=?', ['checked_in', now, existing.id]);
      return res.json({ id: existing.id, status: 'checked_in' });
    }
    return res.status(400).json({ error: 'Invalid action' });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Health
app.get('/api/health', (req,res)=> res.json({ ok: true }));

// --- Anonymous boards ---
function getDeviceId(req){ return String(req.headers['x-device-id'] || '').trim(); }
function hashFp(s){ return crypto.createHash('sha256').update(String(s||'')).digest('hex').slice(0,24); }

// Simple file uploads (local storage). Use only for demo/dev. For prod use OSS.
const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'backend', 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function(req,file,cb){ cb(null, uploadDir); },
  filename: function(req,file,cb){
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).slice(0,40).replace(/[^\w\-\.]+/g,'_');
    cb(null, Date.now() + '_' + base + ext.toLowerCase());
  }
});
const upload = multer({ storage });

app.post('/api/upload', upload.array('files', 6), (req,res)=>{
  try{
    const files = (req.files||[]).map(f => ({ name: f.originalname, url: '/uploads/' + path.basename(f.path) }));
    return res.json({ files });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Upload failed' }); }
});
app.use('/uploads', express.static(uploadDir));

app.get('/api/anon/posts', async (req,res) => {
  try{
    const board = String(req.query.board||'').trim() || 'rant';
    const q = String(req.query.q||'').trim();
    const page = Math.max(1, parseInt(String(req.query.page||'1'),10));
    const pageSize = Math.max(1, Math.min(50, parseInt(String(req.query.pageSize||'10'),10)));
    const offset = (page-1)*pageSize;
    const where = ['board=?','status=?']; const params = [board, 'approved'];
    if(q){ where.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)'); params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
    const totalRow = await get(`SELECT COUNT(1) as n FROM anon_posts WHERE ${where.join(' AND ')}`, params);
    const rows = await all(`SELECT id, board, title, content, tags, media, likes_count, comments_count, created_at FROM anon_posts WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return res.json({ items: rows, total: totalRow ? totalRow.n : 0, page, pageSize });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/anon/posts', async (req,res) => {
  try{
    const deviceId = getDeviceId(req); if(!deviceId) return res.status(400).json({ error: 'Missing device id' });
    const { board, title, content, tags, media } = req.body || {};
    if(!board || !content) return res.status(400).json({ error: 'Missing board/content' });
    const now = new Date().toISOString();
    const fp = hashFp(deviceId);
    const result = await run('INSERT INTO anon_posts (board, title, content, tags, media, status, author_fp, created_at) VALUES (?,?,?,?,?,?,?,?)', [board, title||null, String(content).slice(0,5000), Array.isArray(tags)?tags.join(','):String(tags||''), media?JSON.stringify(media):null, 'approved', fp, now]);
    return res.json({ id: result.id, ok: true });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/anon/posts/:id/like', async (req,res) => {
  try{
    const id = Number(req.params.id);
    const deviceId = getDeviceId(req); if(!deviceId) return res.status(400).json({ error: 'Missing device id' });
    const now = new Date().toISOString();
    try{
      await run('INSERT INTO anon_likes (post_id, device_id, created_at) VALUES (?,?,?)', [id, deviceId, now]);
      await run('UPDATE anon_posts SET likes_count=likes_count+1 WHERE id=?', [id]);
    }catch(err){ /* duplicate like ignored */ }
    const row = await get('SELECT likes_count FROM anon_posts WHERE id=?', [id]);
    return res.json({ id, likes: row ? row.likes_count : 0 });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/anon/posts/:id/comments', async (req,res) => {
  try{
    const id = Number(req.params.id);
    const rows = await all('SELECT id, content, created_at FROM anon_comments WHERE post_id=? AND status=? ORDER BY id DESC LIMIT 100', [id, 'approved']);
    return res.json(rows);
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/anon/posts/:id/comments', async (req,res) => {
  try{
    const id = Number(req.params.id);
    const deviceId = getDeviceId(req); if(!deviceId) return res.status(400).json({ error: 'Missing device id' });
    const { content } = req.body || {};
    if(!content) return res.status(400).json({ error: 'Missing content' });
    const now = new Date().toISOString();
    await run('INSERT INTO anon_comments (post_id, content, status, author_fp, created_at) VALUES (?,?,?,?,?)', [id, String(content).slice(0,1000), 'approved', hashFp(deviceId), now]);
    await run('UPDATE anon_posts SET comments_count=comments_count+1 WHERE id=?', [id]);
    return res.json({ ok: true });
  }catch(e){ console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Bootstrap
await migrate();
app.listen(PORT, ()=> console.log(`API on :${PORT}`));


