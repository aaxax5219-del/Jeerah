const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new sqlite3.Database(path.join(__dirname, "jeerah.db"));
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL = 7 * 24 * 60 * 60;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) reject(err); else resolve(this);
  }));
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Math.floor(Date.now()/1000) + TOKEN_TTL })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return res.status(401).json({ error: "جلسة الدخول غير صالحة" });
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return res.status(401).json({ error: "جلسة الدخول غير صالحة" }); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.status(401).json({ error: "جلسة الدخول غير صالحة" });
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return res.status(401).json({ error: "جلسة الدخول غير صالحة" }); }
  if (!data.id || data.exp < Math.floor(Date.now()/1000)) return res.status(401).json({ error: "انتهت جلسة الدخول، سجلي الدخول مجدداً" });
  get("SELECT id, name, email FROM users WHERE id = ?", [data.id]).then(user => {
    if (!user) return res.status(401).json({ error: "الحساب غير موجود" });
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: "حدث خطأ في التحقق من الحساب" }));
}

async function initializeDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    author TEXT NOT NULL,
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  const columns = await all("PRAGMA table_info(posts)");
  if (!columns.some(c => c.name === "user_id")) await run("ALTER TABLE posts ADD COLUMN user_id INTEGER");
  await run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT
  )`);
  const postCount = await get("SELECT COUNT(*) AS count FROM posts");
  if (postCount.count === 0) {
    const seed = [
      ["مشاركة مثقاب كهربائي", "أحتاج إلى مثقاب كهربائي لمدة يومين. من لديه واحد يمكن استعارته؟", "أدوات", "أم محمد"],
      ["خدمة تنظيف المنزل", "أقدم خدمة تنظيف منازل بأسعار مناسبة لجيران الحي.", "خدمات", "سارة "],
      ["مهرجان الحي السنوي", "ندعوكم للمشاركة في مهرجان الحي السنوي والأنشطة العائلية.", "فعاليات", "لجنة الحي"]
    ];
    for (const p of seed) await run("INSERT INTO posts (title, description, category, author) VALUES (?, ?, ?, ?)", p);
  }
  const eventCount = await get("SELECT COUNT(*) AS count FROM events");
  if (eventCount.count === 0) {
    const seed = [
      ["معرض المنتجات المحلية", "2026-10-25", "ساحة الحي", "معرض للمنتجات والمشاريع المحلية."],
      ["بطولة كرة القدم للأطفال", "2026-11-02", "ملعب الحي", "فعالية رياضية للأطفال."]
    ];
    for (const e of seed) await run("INSERT INTO events (title, date, location, description) VALUES (?, ?, ?, ?)", e);
  }
}

app.post("/api/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!name || !email || password.length < 8) return res.status(400).json({ error: "أدخلي الاسم والبريد، واجعلي كلمة المرور 8 أحرف على الأقل" });
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
    const result = await run("INSERT INTO users (name, email, password_hash, salt) VALUES (?, ?, ?, ?)", [name, email, passwordHash, salt]);
    const user = { id: result.lastID, name, email };
    res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "هذا البريد مسجل مسبقاً، سجلي الدخول بدلاً من ذلك" });
    res.status(500).json({ error: "تعذر إنشاء الحساب" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    const actual = crypto.scryptSync(password, user.salt, 64);
    const expected = Buffer.from(user.password_hash, "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    const safeUser = { id: user.id, name: user.name, email: user.email };
    res.json({ token: makeToken(safeUser), user: safeUser });
  } catch { res.status(500).json({ error: "تعذر تسجيل الدخول" }); }
});

app.get("/api/me", authenticate, (req, res) => res.json({ user: req.user }));

app.get("/api/posts", async (req, res) => {
  try { res.json(await all("SELECT id, title, description, category, author, user_id, created_at FROM posts ORDER BY id DESC")); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/posts", authenticate, async (req, res) => {
  try {
    const { title, description, category } = req.body;
    if (!title || !description || !category) return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    const result = await run("INSERT INTO posts (title, description, category, author, user_id) VALUES (?, ?, ?, ?, ?)", [String(title).trim(), String(description).trim(), String(category), req.user.name, req.user.id]);
    res.status(201).json(await get("SELECT id, title, description, category, author, user_id, created_at FROM posts WHERE id = ?", [result.lastID]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/posts/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "رقم المنشور غير صحيح" });
    const result = await run("DELETE FROM posts WHERE id = ? AND user_id = ?", [id, req.user.id]);
    if (!result.changes) return res.status(404).json({ error: "لا يمكنك حذف هذا المنشور لأنه ليس تابعاً لحسابك" });
    res.json({ message: "تم حذف منشورك بنجاح" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/events", async (req, res) => {
  try { res.json(await all("SELECT * FROM events ORDER BY date ASC")); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

initializeDatabase().then(() => {
  app.listen(PORT, () => console.log(`Jeerah running on port ${PORT}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});
