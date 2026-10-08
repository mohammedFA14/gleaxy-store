import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { scrypt as scryptCallback, timingSafeEqual as compareHash } from 'node:crypto';
import { promisify } from 'node:util';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const storeFile = path.join(dataDir, 'store.json');
const accountsFile = path.join(dataDir, 'accounts.json');
const reviewsFile = path.join(dataDir, 'reviews.json');
const ticketsFile = path.join(dataDir, 'tickets.json');
const scrypt = promisify(scryptCallback);
const sessions = new Map();
const userSessions = new Map();
const loginAttempts = new Map();
const maxUploadBytes = 5 * 1024 * 1024;

function loadEnv() {
  try {
    const source = readFileSync(path.join(root, '.env'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trimStart().startsWith('#') || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch { /* .env is optional outside local development. */ }
}
loadEnv();

const defaultCategories = [
  { id: 'discord', name: 'ديسكورد', icon: '', color: 'from-indigo-500 to-purple-500', description: 'اشتراكات وخدمات ديسكورد', image: '/images/discord.png' },
  { id: 'roblox', name: 'روبلوكس', icon: '', color: 'from-red-500 to-orange-500', description: 'روبوكس وبطاقات روبلوكس', image: '/images/roblox.png' },
  { id: 'pubg', name: 'ببجي', icon: '', color: 'from-yellow-500 to-orange-500', description: 'شدات ببجي وخدمات ببجي', image: '/images/pubg.jfif' },
  { id: 'free-fire', name: 'فري فاير', icon: '', color: 'from-orange-500 to-red-500', description: 'دايموند وعروض فري فاير', image: '/images/freefire.png' },
  { id: 'fortnite', name: 'فورتنايت', icon: '', color: 'from-purple-500 to-pink-500', description: 'في بوكس ومحتوى فورتنايت', image: '/images/fortnite.jpg' },
  { id: 'steam', name: 'ستيم', icon: '', color: 'from-blue-500 to-cyan-500', description: 'ألعاب وبطاقات ستيم', image: '/images/steam.svg' },
];
const defaultProducts = [
  { id: 'discord-nitro-month', name: 'نترو ديسكورد - شهر', price: 5000, category: 'ديسكورد', description: 'اشتراك نترو لمدة شهر كامل', active: true },
  { id: 'discord-nitro-year', name: 'نترو ديسكورد - سنة', price: 45000, category: 'ديسكورد', description: 'اشتراك نترو لمدة سنة كاملة', active: true },
  { id: 'roblox-1000', name: 'روبلوكس 1000', price: 8000, category: 'روبلوكس', description: '1000 روبوكس', active: true },
  { id: 'roblox-5000', name: 'روبلوكس 5000', price: 35000, category: 'روبلوكس', description: '5000 روبوكس', active: true },
  { id: 'pubg-660', name: 'شدات ببجي 660', price: 12000, category: 'ببجي', description: '660 شدة ببجي', active: true },
  { id: 'pubg-1800', name: 'شدات ببجي 1800', price: 30000, category: 'ببجي', description: '1800 شدة ببجي', active: true },
  { id: 'freefire-100', name: 'دايموند فري فاير 100', price: 6000, category: 'فري فاير', description: '100 دايموند', active: true },
  { id: 'freefire-520', name: 'دايموند فري فاير 520', price: 28000, category: 'فري فاير', description: '520 دايموند', active: true },
  { id: 'fortnite-1000', name: 'في بوكس فورتنايت 1000', price: 15000, category: 'فورتنايت', description: '1000 في بوكس', active: true },
  { id: 'steam-10', name: 'بطاقة ستيم 10$', price: 25000, category: 'ستيم', description: 'بطاقة ستيم بقيمة 10 دولار', active: true },
];
const defaultSettings = {
  storeName: process.env.STORE_NAME || process.env.VITE_STORE_NAME || 'Galaxy Store',
  tagline: 'عالمك الرقمي بمكان واحد',
  heroTitle: 'كل اللي تحتاجه',
  heroAccent: 'لعالمك الرقمي',
  heroDescription: 'بطاقات، اشتراكات وشحن ألعاب بمكان واحد. اختار منتجك، رتّب طلبك، وكمل بالطريقة اللي تناسبك.',
  logo: '',
  contacts: {
    whatsapp: process.env.STORE_WHATSAPP || process.env.VITE_STORE_WHATSAPP || '',
    telegram: process.env.STORE_TELEGRAM || process.env.VITE_STORE_TELEGRAM || '',
    discord: process.env.STORE_DISCORD || process.env.VITE_STORE_DISCORD || '',
  },
  payments: [
    { id: 'binance', name: 'باينانس', icon: '', info: process.env.BINANCE_ID || process.env.VITE_BINANCE_ID || '', active: true },
    { id: 'mastercard', name: 'ماستر كارد', icon: '', info: process.env.MASTERCARD || process.env.VITE_MASTERCARD || '', active: true },
    { id: 'zain', name: 'زين كاش', icon: '', info: process.env.ZAIN_CASH || process.env.VITE_ZAIN_CASH || '', active: true },
    { id: 'asiacell', name: 'آسياسيل', icon: '', info: process.env.ASIACELL_CASH || process.env.VITE_ASIACELL_CASH || '', active: true },
  ],
  announcement: '',
  policies: `# 🛒 سياسات الشراء — Galaxy Store

أهلاً وسهلاً بك في **Galaxy Store** 🌌
يرجى قراءة السياسات التالية بعناية قبل إتمام أي عملية شراء.

### 1・تأكيد الطلب
* تأكيد الطلب وإتمام عملية الدفع يعني أنك قرأت جميع السياسات ووافقت عليها بالكامل.
* يتحمل العميل مسؤولية التأكد من صحة جميع معلومات الطلب قبل الدفع.

### 2・معلومات الحساب والدفع
* العميل مسؤول بشكل كامل عن صحة بيانات الحساب ومعلومات الدفع التي يقدمها.
* لا يتحمل **Galaxy Store** مسؤولية أي خطأ ناتج عن إدخال معلومات غير صحيحة من قبل العميل.

### 3・الدفع والاسترجاع
* بعد تثبيت الطلب وإتمام الدفع، لا يمكن استرداد المبلغ بالكامل.
* في حال قبول الاسترجاع، يتم إعادة **50% من قيمة الطلب فقط**.
* بعد تسليم المنتج أو إكمال الخدمة، لا يمكن إرجاع الطلب أو المطالبة باسترداد المبلغ.

### 4・مدة التسليم
* مدة تنفيذ وتسليم الطلبات تتراوح بين **3 إلى 24 ساعة** حسب نوع المنتج أو الخدمة.
* قد تختلف مدة التسليم بحسب طبيعة الطلب والظروف المتعلقة بالخدمة.

### 5・الضمان
* المنتجات التي تتضمن ضماناً تخضع لشروط الضمان المحددة لكل منتج.
* يجب على العميل الالتزام بشروط الضمان للاستفادة منه.
* لا يشمل الضمان أي استخدام مخالف للشروط أو أي خطأ ناتج عن العميل.

### 6・مسؤولية العميل
* يجب التأكد من جميع تفاصيل الطلب قبل الدفع.
* يتحمل العميل مسؤولية أي خطأ في البيانات أو المعلومات التي يقدمها.
* لا يمكن تعديل أو إلغاء الطلب بعد بدء تنفيذه إلا حسب حالة الطلب وسياسة المتجر.

### 7・التواصل والدعم
* يرجى استخدام قنوات الدعم الرسمية في الموقع عند وجود أي مشكلة أو استفسار.
* يجب التعامل باحترام مع فريق **Galaxy Store** لضمان تقديم أفضل خدمة ممكنة.

### 8・الموافقة على السياسات
إتمام عملية الشراء أو تأكيد الطلب يعني أنك قرأت السياسات وفهمتها ووافقت على جميع البنود وتتحمل مسؤولية صحة البيانات التي قدمتها.

**شكراً لثقتكم بـ Galaxy Store 🌌💜**`,
  usdExchangeRate: 1300,
  invoiceTitle: 'فاتورة Galaxy Store',
  invoiceNote: 'شكراً لثقتك بمتجرنا. احتفظ برقم الطلب للمتابعة.',
  aboutUs: `# 🌌 من نحن؟

مرحباً بك في **Galaxy Store**، وجهتك المتكاملة لعالم الألعاب والتقنية والخدمات الرقمية.

نسعى إلى توفير تجربة شراء سهلة، سريعة وموثوقة، من خلال جمع مختلف المنتجات والخدمات التي يحتاجها اللاعب والمستخدم في مكان واحد.

### 🎮 ماذا نوفر؟
نوفر مجموعة واسعة من المنتجات والخدمات، منها:
* 🖱️ ماوسات وملحقات الكمبيوتر
* ⌨️ كيبوردات وملحقات الجيمينغ
* 🎧 سماعات ومستلزمات الألعاب
* 🖥️ إكسسوارات وقطع الكمبيوتر
* 🎮 أجهزة وملحقات الألعاب
* 💳 شحن الألعاب والبطاقات الرقمية
* 🔐 الحسابات والمنتجات الرقمية
* ⭐ الاشتراكات والخدمات الرقمية
* 💻 البرمجة والتطوير
* 🛠️ خدمات الجيمينغ والتقنية
* 🌐 منتجات وخدمات متنوعة حسب الطلب

### 🚀 رؤيتنا
نسعى لأن يكون **Galaxy Store** مكاناً واحداً يوفر لك كل ما تحتاجه في عالم الألعاب والتقنية، من المنتجات والمستلزمات إلى الخدمات الرقمية والبرمجية. نركز على تقديم **الجودة، السرعة، الأمان والأسعار المناسبة** مع الاهتمام بتجربة كل عميل.

### 💜 لماذا Galaxy Store؟
لأننا نعمل على توفير خيارات متنوعة للعميل، سواء كنت تبحث عن منتج Gaming، إكسسوار للكمبيوتر، خدمة رقمية، أو أي شيء متعلق بالألعاب والتقنية.

**Galaxy Store — كل ما تحتاجه، في مكان واحد. 🌌**`,
};

async function ensureStore() {
  await mkdir(uploadDir, { recursive: true });
  try { await stat(storeFile); }
  catch {
    await writeFile(storeFile, JSON.stringify({ version: 1, settings: defaultSettings, categories: defaultCategories, products: defaultProducts, orders: [], activity: [] }, null, 2), 'utf8');
  }
  for (const [file, seed] of [[accountsFile, []], [reviewsFile, []], [ticketsFile, []]]) {
    try { await stat(file); }
    catch { await writeFile(file, JSON.stringify(seed, null, 2), 'utf8'); }
  }
}
async function readStore() {
  await ensureStore();
  return JSON.parse(await readFile(storeFile, 'utf8'));
}
let writeQueue = Promise.resolve();
async function mutateStore(mutator) {
  const operation = writeQueue.then(async () => {
    const data = await readStore();
    const result = await mutator(data);
    const tempFile = `${storeFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
    await rename(tempFile, storeFile);
    return result;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
const fileQueues = new Map();
async function mutateJsonFile(file, seed, mutator) {
  const previous = fileQueues.get(file) || Promise.resolve();
  const operation = previous.then(async () => {
    await ensureStore();
    const data = JSON.parse(await readFile(file, 'utf8'));
    const result = await mutator(data);
    const tempFile = `${file}.${randomUUID()}.tmp`;
    await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
    await rename(tempFile, file);
    return result;
  });
  fileQueues.set(file, operation.catch(() => undefined));
  return operation;
}
async function readJsonFile(file, seed = []) {
  await ensureStore();
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; await writeFile(file, JSON.stringify(seed, null, 2)); return seed; }
}
function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}
async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('حجم البيانات أكبر من المسموح.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('البيانات المرسلة غير صالحة.'), { status: 400 }); }
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  const entry = raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function adminSession(req) {
  const token = cookieValue(req, 'galaxy_admin');
  const session = sessions.get(token);
  if (session && session.expiresAt > Date.now()) return { token, session };
  if (token) sessions.delete(token);
  return null;
}
function userSession(req) {
  const token = cookieValue(req, 'galaxy_user');
  const session = userSessions.get(token);
  if (session && session.expiresAt > Date.now()) return { token, session };
  if (token) userSessions.delete(token);
  return null;
}
function publicAccount(account) {
  return { id: account.id, name: account.name, email: account.email, phone: account.phone || '', provider: account.provider || 'email', createdAt: account.createdAt };
}
async function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(hash).toString('hex') };
}
async function validPassword(password, account) {
  if (!account.passwordHash || !account.passwordSalt) return false;
  const hash = Buffer.from(await scrypt(password, account.passwordSalt, 64));
  const expected = Buffer.from(account.passwordHash, 'hex');
  return hash.length === expected.length && compareHash(hash, expected);
}
function setUserCookie(res, account) {
  const token = randomBytes(32).toString('hex');
  userSessions.set(token, { accountId: account.id, expiresAt: Date.now() + 30 * 24 * 60 * 60_000 });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `galaxy_user=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
}
async function currentAccount(req) {
  const auth = userSession(req);
  if (!auth) return null;
  return (await readJsonFile(accountsFile)).find(row => row.id === auth.session.accountId) || null;
}
function reviewPublic(review) {
  return { id: review.id, accountId: review.accountId || '', userName: review.userName || 'زبون', targetType: review.targetType, targetId: review.targetId || '', rating: review.rating, text: review.text, createdAt: review.createdAt };
}
function safeAccountList(accounts) { return accounts.map(publicAccount); }
function safeCompare(left = '', right = '') {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
function addActivity(data, text) {
  data.activity.unshift({ id: randomUUID(), text, createdAt: new Date().toISOString() });
  data.activity = data.activity.slice(0, 150);
}
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
function slugId() { return randomUUID(); }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';
    if (method === 'GET' && url.pathname === '/api/store') {
      const data = await readStore();
      return send(res, 200, { settings: { ...defaultSettings, ...data.settings }, categories: data.categories, products: data.products });
    }
    if (method === 'GET' && url.pathname === '/api/auth') return send(res, 200, { authenticated: Boolean(adminSession(req)) });
    if (method === 'GET' && url.pathname === '/api/auth/config') return send(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
    if (method === 'GET' && url.pathname === '/api/auth/me') {
      const account = await currentAccount(req);
      return send(res, 200, { account: account ? publicAccount(account) : null });
    }
    if (method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await readBody(req, 32 * 1024);
      const name = String(body.name || '').trim().slice(0, 80);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return send(res, 400, { error: 'أدخل اسماً وإيميلاً صحيحاً وكلمة مرور من 8 أحرف على الأقل.' });
      const account = await mutateJsonFile(accountsFile, [], async accounts => {
        if (accounts.some(item => item.email === email)) throw Object.assign(new Error('هذا الإيميل مسجل مسبقاً.'), { status: 409 });
        const record = await passwordRecord(password);
        const created = { id: randomUUID(), name, email, phone: String(body.phone || '').trim().slice(0, 30), provider: 'email', passwordSalt: record.salt, passwordHash: record.hash, createdAt: new Date().toISOString() };
        accounts.push(created);
        return created;
      });
      setUserCookie(res, account);
      return send(res, 201, { account: publicAccount(account) });
    }
    if (method === 'POST' && url.pathname === '/api/auth/user-login') {
      const ip = `customer:${req.socket.remoteAddress || 'unknown'}`;
      const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 10 * 60_000 };
      if (attempts.resetAt < Date.now()) { attempts.count = 0; attempts.resetAt = Date.now() + 10 * 60_000; }
      if (attempts.count >= 10) return send(res, 429, { error: 'محاولات كثيرة. انتظر قليلاً وحاول مرة ثانية.' });
      const body = await readBody(req, 32 * 1024);
      const email = String(body.email || '').trim().toLowerCase();
      const account = (await readJsonFile(accountsFile)).find(row => row.email === email);
      if (!account || !(await validPassword(String(body.password || ''), account))) { attempts.count += 1; loginAttempts.set(ip, attempts); return send(res, 401, { error: 'الإيميل أو كلمة المرور غير صحيحة.' }); }
      loginAttempts.delete(ip);
      setUserCookie(res, account);
      return send(res, 200, { account: publicAccount(account) });
    }
    if (method === 'POST' && url.pathname === '/api/auth/google') {
      if (!process.env.GOOGLE_CLIENT_ID) return send(res, 503, { error: 'تسجيل Google غير مفعّل بعد.' });
      const body = await readBody(req, 32 * 1024);
      try {
        const ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken: String(body.credential || ''), audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        if (!payload?.email || !payload.email_verified || !payload.sub) return send(res, 401, { error: 'تعذر التحقق من حساب Google.' });
        const account = await mutateJsonFile(accountsFile, [], accounts => {
          let found = accounts.find(row => row.googleId === payload.sub || row.email === payload.email.toLowerCase());
          if (found) {
            found.googleId = payload.sub;
            found.provider = found.passwordHash ? 'email+google' : 'google';
          } else {
            found = { id: randomUUID(), name: String(payload.name || payload.email.split('@')[0]).slice(0, 80), email: payload.email.toLowerCase(), phone: '', provider: 'google', googleId: payload.sub, createdAt: new Date().toISOString() };
            accounts.push(found);
          }
          return found;
        });
        setUserCookie(res, account);
        return send(res, 200, { account: publicAccount(account) });
      } catch { return send(res, 401, { error: 'تعذر التحقق من تسجيل Google.' }); }
    }
    if (method === 'POST' && url.pathname === '/api/auth/user-logout') {
      const auth = userSession(req);
      if (auth) userSessions.delete(auth.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'galaxy_user=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    if (method === 'GET' && url.pathname === '/api/reviews') {
      const targetType = url.searchParams.get('targetType');
      const targetId = url.searchParams.get('targetId') || '';
      let reviews = await readJsonFile(reviewsFile);
      if (targetType === 'store' || targetType === 'product') reviews = reviews.filter(review => review.targetType === targetType && (targetType === 'store' || review.targetId === targetId));
      return send(res, 200, reviews.map(reviewPublic));
    }
    if (method === 'POST' && url.pathname === '/api/reviews') {
      const account = await currentAccount(req);
      if (!account) return send(res, 401, { error: 'سجل دخولك حتى تكتب تقييماً.' });
      const body = await readBody(req, 16 * 1024);
      const targetType = body.targetType === 'product' ? 'product' : body.targetType === 'store' ? 'store' : '';
      const targetId = targetType === 'product' ? String(body.targetId || '').slice(0, 100) : '';
      const rating = Number(body.rating);
      const text = String(body.text || '').trim().slice(0, 1200);
      if (!targetType || (targetType === 'product' && !targetId) || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 3) return send(res, 400, { error: 'أدخل تقييماً من نجمة إلى خمس نجوم واكتب رأيك.' });
      const review = await mutateJsonFile(reviewsFile, [], reviews => {
        const found = reviews.find(row => row.accountId === account.id && row.targetType === targetType && row.targetId === targetId);
        const next = { id: found?.id || randomUUID(), accountId: account.id, userName: account.name, targetType, targetId, rating, text, createdAt: new Date().toISOString() };
        if (found) Object.assign(found, next); else reviews.unshift(next);
        return next;
      });
      return send(res, 201, reviewPublic(review));
    }
    if (method === 'GET' && url.pathname === '/api/tickets/mine') {
      const account = await currentAccount(req);
      if (!account) return send(res, 401, { error: 'سجل دخولك حتى تتابع تذاكرك.' });
      const tickets = (await readJsonFile(ticketsFile)).filter(ticket => ticket.accountId === account.id).map(({ id, name, contact, subject, message, reply, status, createdAt }) => ({ id, name, contact, subject, message, reply, status, createdAt }));
      return send(res, 200, tickets);
    }
    if (method === 'POST' && url.pathname === '/api/tickets') {
      const account = await currentAccount(req);
      if (!account) return send(res, 401, { error: 'سجل دخولك حتى تفتح تذكرة دعم.' });
      const body = await readBody(req, 16 * 1024);
      const name = account.name;
      const contact = String(body.contact || '').trim().slice(0, 120);
      const subject = String(body.subject || '').trim().slice(0, 120);
      const message = String(body.message || '').trim().slice(0, 2000);
      if (name.length < 2 || contact.length < 5 || subject.length < 3 || message.length < 10) return send(res, 400, { error: 'أكمل الاسم ووسيلة التواصل والعنوان واكتب تفاصيل أكثر.' });
      const ticket = await mutateJsonFile(ticketsFile, [], tickets => {
        if (tickets.filter(row => row.accountId === account.id && row.status === 'open').length >= 5) throw Object.assign(new Error('عندك خمس تذاكر مفتوحة. انتظر رد الدعم قبل فتح تذكرة جديدة.'), { status: 429 });
        const row = { id: `GS-S-${Date.now().toString(36).toUpperCase()}`, accountId: account.id, name, contact, subject, message, reply: '', status: 'open', createdAt: new Date().toISOString() };
        tickets.unshift(row); return row;
      });
      await mutateStore(data => addActivity(data, `وصلت تذكرة دعم جديدة من ${name} — ${ticket.id}`));
      return send(res, 201, ticket);
    }
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 10 * 60_000 };
      if (attempts.resetAt < Date.now()) { attempts.count = 0; attempts.resetAt = Date.now() + 10 * 60_000; }
      if (attempts.count >= 10) return send(res, 429, { error: 'محاولات كثيرة. انتظر قليلاً وحاول مرة ثانية.' });
      const body = await readBody(req, 32 * 1024);
      const email = String(body.email || '').trim().toLowerCase();
      const expectedEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      const correct = expectedEmail && process.env.ADMIN_PASSWORD && safeCompare(email, expectedEmail) && safeCompare(body.password, process.env.ADMIN_PASSWORD);
      if (!correct) {
        attempts.count += 1;
        loginAttempts.set(ip, attempts);
        return send(res, 401, { error: 'الإيميل أو كلمة المرور غير صحيحة.' });
      }
      loginAttempts.delete(ip);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { email, expiresAt: Date.now() + 12 * 60 * 60_000 });
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      return send(res, 200, { authenticated: true }, { 'Set-Cookie': `galaxy_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
    }
    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      const session = adminSession(req);
      if (session) sessions.delete(session.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'galaxy_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (method === 'GET' && url.pathname === '/api/orders/mine') {
      const account = await currentAccount(req);
      if (!account) return send(res, 401, { error: 'سجل دخولك لمتابعة طلباتك.' });
      const data = await readStore();
      const orders = data.orders.filter(order => order.customerAccountId === account.id);
      return send(res, 200, orders);
    }
    if (method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(req, 256 * 1024);
      if (!String(body.customerName || '').trim() || String(body.phone || '').replace(/\D/g, '').length < 10 || !Array.isArray(body.items) || !body.items.length || !Number.isFinite(Number(body.total)) || Number(body.total) <= 0) {
        return send(res, 400, { error: 'تأكد من معلومات الطلب وحاول مرة ثانية.' });
      }
      const customer = await currentAccount(req);
      const order = await mutateStore(data => {
        const checkedItems = body.items.slice(0, 30).map(item => {
          const product = data.products.find(row => row.id === String(item.id));
          const quantity = Math.floor(Number(item.quantity));
          if (!product || product.active === false || quantity < 1 || quantity > 100) throw Object.assign(new Error('تأكد من المنتجات والكميات المطلوبة.'), { status: 400 });
          const stock = Number.isFinite(Number(product.stock)) ? Math.max(0, Number(product.stock)) : 99;
          if (quantity > stock) throw Object.assign(new Error(`المخزون المتوفر من «${product.name}» هو ${stock} فقط.`), { status: 409 });
          const discount = Math.min(100, Math.max(0, Number(product.discountPercent) || 0));
          const price = Math.round(Number(product.price) * (1 - discount / 100));
          product.stock = stock - quantity;
          return { id: product.id, name: product.name, category: product.category, price, quantity };
        });
        const total = checkedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const created = { id: `GAL-${String(Date.now()).slice(-5)}`, customerName: String(body.customerName).trim().slice(0, 100), phone: String(body.phone).trim().slice(0, 30), items: checkedItems, total, exchangeRate: Math.max(1, Number(data.settings.usdExchangeRate) || 1300), paymentMethod: String(body.paymentMethod || '').slice(0, 80), completionMethod: String(body.completionMethod || '').slice(0, 80), status: 'pending', statusMessage: 'استلمنا طلبك وراح نراجعه قريباً.', ...(customer ? { customerAccountId: customer.id } : {}), createdAt: new Date().toISOString() };
        data.orders.unshift(created);
        addActivity(data, `وصل طلب جديد من ${created.customerName} — ${created.id}`);
        return created;
      });
      return send(res, 201, order);
    }
    if (url.pathname.startsWith('/api/admin/')) {
      const session = adminSession(req);
      if (!session) return send(res, 401, { error: 'سجل دخول الإدارة أولاً.' });
      if (method === 'GET' && url.pathname === '/api/admin/tickets') return send(res, 200, await readJsonFile(ticketsFile));
      const ticketMatch = url.pathname.match(/^\/api\/admin\/tickets\/([^/]+)$/);
      if (method === 'PATCH' && ticketMatch) {
        const body = await readBody(req, 16 * 1024);
        const id = decodeURIComponent(ticketMatch[1]);
        const updated = await mutateJsonFile(ticketsFile, [], tickets => { const ticket = tickets.find(item => item.id === id); if (!ticket) throw Object.assign(new Error('التذكرة غير موجودة.'), { status: 404 }); if (typeof body.reply === 'string') ticket.reply = body.reply.trim().slice(0, 2000); if (['open', 'answered', 'closed'].includes(body.status)) ticket.status = body.status; return ticket; });
        return send(res, 200, updated);
      }
      if (method === 'GET' && url.pathname === '/api/admin/accounts') return send(res, 200, safeAccountList(await readJsonFile(accountsFile)));
      if (method === 'POST' && url.pathname === '/api/admin/accounts') {
        const body = await readBody(req, 32 * 1024);
        const name = String(body.name || '').trim().slice(0, 80);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return send(res, 400, { error: 'أدخل اسماً وإيميلاً صحيحاً وكلمة مرور من 8 أحرف على الأقل.' });
        const account = await mutateJsonFile(accountsFile, [], async accounts => {
          if (accounts.some(item => item.email === email)) throw Object.assign(new Error('هذا الإيميل مسجل مسبقاً.'), { status: 409 });
          const record = await passwordRecord(password);
          const created = { id: randomUUID(), name, email, phone: String(body.phone || '').trim().slice(0, 30), provider: 'email', passwordSalt: record.salt, passwordHash: record.hash, createdAt: new Date().toISOString() };
          accounts.push(created); return created;
        });
        return send(res, 201, publicAccount(account));
      }
      const accountDelete = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/);
      if (method === 'DELETE' && accountDelete) {
        const id = decodeURIComponent(accountDelete[1]);
        await mutateJsonFile(accountsFile, [], accounts => { const index = accounts.findIndex(row => row.id === id); if (index >= 0) accounts.splice(index, 1); });
        for (const [token, session] of userSessions) if (session.accountId === id) userSessions.delete(token);
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && url.pathname === '/api/admin/reviews') return send(res, 200, (await readJsonFile(reviewsFile)).map(reviewPublic));
      if (method === 'POST' && url.pathname === '/api/admin/reviews') {
        const body = await readBody(req, 16 * 1024);
        const targetType = body.targetType === 'product' ? 'product' : body.targetType === 'store' ? 'store' : '';
        const rating = Number(body.rating);
        const text = String(body.text || '').trim().slice(0, 1200);
        const userName = String(body.userName || '').trim().slice(0, 80);
        const targetId = targetType === 'product' ? String(body.targetId || '').slice(0, 100) : '';
        if (!targetType || (targetType === 'product' && !targetId) || !userName || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 3) return send(res, 400, { error: 'أكمل الاسم والمنتج والتقييم والتعليق.' });
        const review = await mutateJsonFile(reviewsFile, [], reviews => { const created = { id: randomUUID(), accountId: '', userName, targetType, targetId, rating, text, createdAt: new Date().toISOString() }; reviews.unshift(created); return created; });
        return send(res, 201, reviewPublic(review));
      }
      const reviewDelete = url.pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
      if (method === 'DELETE' && reviewDelete) {
        const id = decodeURIComponent(reviewDelete[1]);
        await mutateJsonFile(reviewsFile, [], reviews => { const index = reviews.findIndex(row => row.id === id); if (index >= 0) reviews.splice(index, 1); });
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && url.pathname === '/api/admin/data') return send(res, 200, await readStore());
      if (method === 'GET' && url.pathname === '/api/admin/backup') {
        const data = await readStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="galaxy-store-backup.json"', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(data, null, 2));
      }
      if (method === 'PUT' && url.pathname === '/api/admin/data') {
        const body = await readBody(req);
        await mutateStore(data => {
          const events = [];
          if (Array.isArray(body.categories)) {
            const before = new Map(data.categories.map(item => [item.id, item]));
            const after = new Map(body.categories.map(item => [item.id, item]));
            for (const [id, item] of after) if (!before.has(id)) events.push(`تمت إضافة قسم «${item.name}».`); else if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) events.push(`تم تعديل قسم «${item.name}».`);
            for (const [id, item] of before) if (!after.has(id)) events.push(`تم حذف قسم «${item.name}».`);
            data.categories = body.categories;
          }
          if (Array.isArray(body.products)) {
            const before = new Map(data.products.map(item => [item.id, item]));
            const after = new Map(body.products.map(item => [item.id, item]));
            for (const [id, item] of after) if (!before.has(id)) events.push(`تمت إضافة منتج «${item.name}».`); else if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) events.push(`تم تعديل منتج «${item.name}».`);
            for (const [id, item] of before) if (!after.has(id)) events.push(`تم حذف منتج «${item.name}».`);
            data.products = body.products;
          }
          if (Array.isArray(body.orders)) {
            const before = new Map(data.orders.map(item => [item.id, item]));
            for (const item of body.orders) if (before.has(item.id)) {
              const previous = before.get(item.id);
              if (previous.status !== item.status) {
                events.push(`تغيّرت حالة الطلب ${item.id} إلى ${item.status}.`);
                if (item.status === 'cancelled' && previous.status !== 'cancelled') for (const line of previous.items || []) { const product = data.products.find(row => row.id === line.id); if (product) product.stock = (Number(product.stock) || 0) + line.quantity; }
                if (previous.status === 'cancelled' && item.status !== 'cancelled') for (const line of item.items || []) { const product = data.products.find(row => row.id === line.id); if (product) { const available = Number(product.stock) || 0; if (available < line.quantity) throw Object.assign(new Error(`مخزون «${product.name}» غير كافٍ لإعادة الطلب.`), { status: 409 }); product.stock = available - line.quantity; } }
              }
              if (before.get(item.id).statusMessage !== item.statusMessage && item.statusMessage) events.push(`تم إرسال تحديث إلى زبون الطلب ${item.id}.`);
            }
            data.orders = body.orders;
          }
          if (Array.isArray(body.activity)) data.activity = body.activity.slice(0, 150);
          if (body.settings && typeof body.settings === 'object') {
            const changed = JSON.stringify(data.settings) !== JSON.stringify({ ...data.settings, ...body.settings });
            data.settings = { ...data.settings, ...body.settings };
            if (changed) events.push('تم تحديث إعدادات المتجر.');
          }
          events.slice(0, 25).forEach(text => addActivity(data, text));
        });
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && url.pathname === '/api/admin/upload') {
        const body = await readBody(req);
        const match = String(body.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return send(res, 400, { error: 'اختار صورة PNG أو JPG أو WebP أو GIF أو SVG.' });
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > maxUploadBytes) return send(res, 413, { error: 'حجم الصورة لازم يكون أقل من 5 ميغابايت.' });
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[match[1]];
        const fileName = `${slugId()}.${extension}`;
        await writeFile(path.join(uploadDir, fileName), bytes, { flag: 'wx' });
        return send(res, 201, { url: `/uploads/${fileName}` });
      }
      return send(res, 404, { error: 'المسار غير موجود.' });
    }
    if (method === 'GET' && url.pathname.startsWith('/uploads/')) {
      const fileName = path.basename(decodeURIComponent(url.pathname.slice('/uploads/'.length)));
      if (!fileName || fileName.includes('..')) return send(res, 400, { error: 'مسار غير صالح.' });
      const filePath = path.join(uploadDir, fileName);
      const content = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(fileName).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      return res.end(content);
    }
    const dist = path.join(root, 'dist');
    const requested = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let filePath = path.resolve(dist, requested);
    if (filePath !== dist && !filePath.startsWith(`${dist}${path.sep}`)) return send(res, 400, { error: 'مسار غير صالح.' });
    try { if (!(await stat(filePath)).isFile()) filePath = path.join(dist, 'index.html'); }
    catch { filePath = path.join(dist, 'index.html'); }
    const content = await readFile(filePath);
    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : filePath.endsWith('.js') ? 'text/javascript; charset=utf-8' : filePath.endsWith('.css') ? 'text/css; charset=utf-8' : filePath.endsWith('.svg') ? 'image/svg+xml' : filePath.endsWith('.png') ? 'image/png' : filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.jfif') ? 'image/jpeg' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' });
    return res.end(content);
  } catch (error) {
    const status = error?.status || (error?.code === 'ENOENT' ? 404 : 500);
    if (status === 500) console.error('Request failed:', error);
    if (res.headersSent) return res.end();
    return send(res, status, { error: status === 404 ? 'الملف غير موجود.' : error?.message || 'صار خطأ غير متوقع.' });
  }
});

const port = Number(process.env.PORT || 3001);
await ensureStore();
server.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Galaxy Store data server is ready on http://127.0.0.1:${port}`);
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) console.warn('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before using /admin.');
});
