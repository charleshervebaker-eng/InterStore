const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX_APK_MB = Number(process.env.MAX_APK_MB || 200);
// Set UPLOAD_PASSWORD as an environment variable (on Render: Environment tab).
// If it is missing, uploads stay disabled.
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || '';
const authOk = (given) => !!UPLOAD_PASSWORD && safeEqual(given, UPLOAD_PASSWORD);

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'apps.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(REVIEWS_FILE)) fs.writeFileSync(REVIEWS_FILE, '[]');

const readDB = () => {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
};
const writeDB = (data) => {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
};

const readReviews = () => {
  try { return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8')); }
  catch { return []; }
};
const writeReviews = (data) => {
  const tmp = REVIEWS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, REVIEWS_FILE);
};

// { appId: { count, avg } }
const statsFor = (reviews) => {
  const map = {};
  reviews.forEach((r) => {
    const s = map[r.appId] || (map[r.appId] = { sum: 0, count: 0 });
    s.sum += r.rating;
    s.count += 1;
  });
  Object.values(map).forEach((s) => { s.avg = Math.round((s.sum / s.count) * 10) / 10; });
  return map;
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_APK_MB * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'apk') {
      if (ext !== '.apk') return cb(new Error('Only .apk files are allowed. AAB files must be converted first (see README).'));
    } else if (file.fieldname === 'icon') {
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return cb(new Error('Icon must be PNG, JPG or WEBP.'));
    } else {
      return cb(new Error('Unexpected file field.'));
    }
    cb(null, true);
  }
});

// An APK is a ZIP archive, so it must start with "PK".
const looksLikeZip = (file) => {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b;
  } catch { return false; }
};

const cleanup = (files) => {
  (files || []).forEach((f) => fs.unlink(f.path, () => {}));
};

const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// Tiny in-memory rate limit for uploads (per IP).
const hits = new Map();
const uploadLimiter = (req, res, next) => {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 10;
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Too many uploads. Try again in a few minutes.' });
  arr.push(now);
  hits.set(req.ip, arr);
  next();
};

// Limit wrong-password guesses (per IP).
const failed = new Map();
const authLimiter = (req, res, next) => {
  const now = Date.now();
  const arr = (failed.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  failed.set(req.ip, arr);
  if (arr.length >= 5) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 10 minutes.' });
  req.recordFail = () => arr.push(now);
  next();
};

const requirePassword = (req, res, next) => {
  if (!authOk(req.get('x-upload-password'))) {
    if (req.recordFail) req.recordFail();
    return res.status(401).json({ error: 'Upload locked. Wrong or missing password.' });
  }
  next();
};

const publicApp = (a, stats = {}) => ({
  id: a.id,
  name: a.name,
  developer: a.developer,
  description: a.description,
  version: a.version,
  category: a.category,
  size: a.size,
  downloads: a.downloads,
  createdAt: a.createdAt,
  icon: a.icon ? `/files/${a.icon}` : null,
  rating: stats.avg || 0,
  reviewCount: stats.count || 0
});

const app = express();
app.disable('x-powered-by');
// On Render (or any reverse proxy) rate limits need the real client IP.
if (process.env.RENDER || process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.static(path.join(ROOT, 'public')));

// Icons only; APKs are served through the download route.
app.get('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  if (!/\.(png|jpe?g|webp)$/i.test(name)) return res.status(404).end();
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.get('/api/apps', (req, res) => {
  const q = clean(req.query.q, 60).toLowerCase();
  const category = clean(req.query.category, 30);
  let list = readDB();
  if (q) list = list.filter((a) => [a.name, a.developer, a.description].join(' ').toLowerCase().includes(q));
  if (category && category !== 'All') list = list.filter((a) => a.category === category);
  list.sort((a, b) => b.createdAt - a.createdAt);
  const stats = statsFor(readReviews());
  res.json(list.map((a) => publicApp(a, stats[a.id])));
});

app.post('/api/auth', express.json({ limit: '1kb' }), authLimiter, (req, res) => {
  if (!UPLOAD_PASSWORD) return res.status(503).json({ error: 'Uploads are disabled: UPLOAD_PASSWORD is not set on the server.' });
  if (authOk(req.body && req.body.password)) return res.json({ ok: true });
  req.recordFail();
  res.status(401).json({ error: 'Wrong password.' });
});

app.post(
  '/api/apps',
  authLimiter,
  requirePassword,
  uploadLimiter,
  (req, res, next) => {
    upload.fields([{ name: 'apk', maxCount: 1 }, { name: 'icon', maxCount: 1 }])(req, res, (err) => {
      if (err) {
        cleanup([].concat(...Object.values(req.files || {})));
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${MAX_APK_MB} MB).` : err.message;
        return res.status(400).json({ error: msg });
      }
      next();
    });
  },
  (req, res) => {
    const apk = req.files && req.files.apk && req.files.apk[0];
    const icon = req.files && req.files.icon && req.files.icon[0];
    const all = [apk, icon].filter(Boolean);

    if (!apk) { cleanup(all); return res.status(400).json({ error: 'Please attach an APK file.' }); }
    if (!looksLikeZip(apk.path)) { cleanup(all); return res.status(400).json({ error: 'That file is not a valid APK.' }); }

    const name = clean(req.body.name, 60);
    const developer = clean(req.body.developer, 60);
    if (!name || !developer) { cleanup(all); return res.status(400).json({ error: 'App name and developer are required.' }); }

    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      name,
      developer,
      description: clean(req.body.description, 600),
      version: clean(req.body.version, 20) || '1.0',
      category: clean(req.body.category, 30) || 'Other',
      size: apk.size,
      downloads: 0,
      createdAt: Date.now(),
      apk: apk.filename,
      apkOriginal: clean(path.basename(apk.originalname, '.apk'), 60) || 'app',
      icon: icon ? icon.filename : null
    };

    const db = readDB();
    db.push(entry);
    writeDB(db);
    res.status(201).json(publicApp(entry));
  }
);

// ---------- reviews ----------
const reviewHits = new Map();
const reviewLimiter = (req, res, next) => {
  const now = Date.now();
  const arr = (reviewHits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 5) return res.status(429).json({ error: 'Too many reviews. Try again in a few minutes.' });
  arr.push(now);
  reviewHits.set(req.ip, arr);
  next();
};

const appExists = (id) => readDB().some((a) => a.id === id);

app.get('/api/apps/:id/reviews', (req, res) => {
  const id = req.params.id;
  if (!appExists(id)) return res.status(404).json({ error: 'App not found.' });
  const list = readReviews().filter((r) => r.appId === id).sort((a, b) => b.createdAt - a.createdAt);
  const st = statsFor(list)[id] || {};
  res.json({
    avg: st.avg || 0,
    count: st.count || 0,
    reviews: list.map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.createdAt }))
  });
});

app.post('/api/apps/:id/reviews', express.json({ limit: '4kb' }), reviewLimiter, (req, res) => {
  const id = req.params.id;
  if (!appExists(id)) return res.status(404).json({ error: 'App not found.' });
  const body = req.body || {};
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Pick a rating from 1 to 5 stars.' });
  }
  const review = {
    id: crypto.randomBytes(6).toString('hex'),
    appId: id,
    name: clean(body.name, 40) || 'Anonymous',
    rating,
    comment: clean(body.comment, 500),
    createdAt: Date.now()
  };
  const all = readReviews();
  all.push(review);
  writeReviews(all);
  res.status(201).json({ ok: true });
});

// Owner-only: remove a review (spam, abuse).
app.delete('/api/reviews/:id', authLimiter, requirePassword, (req, res) => {
  const all = readReviews();
  const next = all.filter((r) => r.id !== req.params.id);
  if (next.length === all.length) return res.status(404).json({ error: 'Review not found.' });
  writeReviews(next);
  res.json({ ok: true });
});

app.get('/download/:id', (req, res) => {
  const db = readDB();
  const entry = db.find((a) => a.id === req.params.id);
  if (!entry) return res.status(404).send('Not found');
  const file = path.join(UPLOAD_DIR, entry.apk);
  if (!fs.existsSync(file)) return res.status(404).send('File missing');
  entry.downloads += 1;
  writeDB(db);
  const safe = (entry.name + '-' + entry.version).replace(/[^a-z0-9._-]+/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.download(file, `${safe}.apk`);
});

app.listen(PORT, () => {
  console.log(`InterStore running on http://localhost:${PORT}`);
  if (!UPLOAD_PASSWORD) console.warn('WARNING: UPLOAD_PASSWORD is not set. Uploads are disabled.');
});
