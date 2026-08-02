const ALLOWED_ORIGINS = [
  'https://vitalgoals.com.mx',
  'https://vitalgoals.vercel.app',
  'https://vitalgoals-ivan-marrujo-s-projects.vercel.app',
  'https://vitalgoals-git-main-ivan-marrujo-s-projects.vercel.app',
  'https://gainz-green.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
];

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkOrigin(req) {
  const origin = req.headers.origin || '';
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(a => origin === a);
}

function checkAppSecret(req) {
  const key = req.headers['x-gainz-key'];
  return !!key && !!process.env.APP_SECRET && key === process.env.APP_SECRET;
}

const UA_BLOCKLIST = [
  'curl','wget','python-requests','python-urllib','scrapy','go-http-client',
  'okhttp','postman','insomnia','node-fetch','axios','httpclient',
  'libwww-perl','php','java/','ruby','aiohttp','headlesschrome',
];

function isSuspiciousUA(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (!ua) return true;
  return UA_BLOCKLIST.some(b => ua.includes(b));
}

function tarpitDelay(minMs = 2500, maxMs = 5000) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, ms));
}

const DECOYS = {
  analyze: () => ({
    nombre: 'Ensalada mixta',
    descripcion: 'Plato balanceado con vegetales frescos',
    porcion: '1 porción estándar',
    calorias: 320, proteina: 14, carbohidratos: 28, grasas: 12,
    fibra: 6, azucar: 4, confianza: 82, barcode_detectado: false,
    match_score: 68, match_color: 'yellow',
    match_explicacion: 'Opción balanceada, considera aumentar la proteína.',
    puntos_fuertes: ['Buena fibra','Bajo en grasas saturadas'],
    puntos_debiles: ['Proteína moderada'],
    recomendacion_coach: 'Agrega una fuente de proteína magra.',
    timing_ideal: 'cualquier',
    alimentos: [{ nombre: 'Ensalada mixta', calorias: 320, proteina: 14,
      carbohidratos: 28, grasas: 12, match_score: 68, confianza: 82 }],
    alerta: null,
  }),
  brief: () => ({
    respuesta: 'Mantén tu ingesta balanceada y prioriza proteína magra a lo largo del día.',
    puntos_clave: ['Hidratación constante','Proteína en cada comida','Evita azúcares simples'],
    recomendacion_inmediata: 'Toma agua y planea tu próxima comida con proteína.',
    alimentos_ideales: ['Pechuga de pollo','Avena','Vegetales verdes'],
    alimentos_evitar: ['Refrescos azucarados'],
    timing: 'ahora', nivel_urgencia: 'low',
    dato_cientifico: 'El cuerpo absorbe mejor la proteína distribuida en varias comidas.',
  }),
};

function decoyResponse(kind) {
  return (DECOYS[kind] || DECOYS.analyze)();
}

async function rateLimit(key, limit, windowSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('[security] Upstash no configurado — rate limit desactivado');
    return { allowed: true };
  }
  try {
    const incrRes = await fetch(`${url}/incr/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const { result: count } = await incrRes.json();
    if (count === 1) await fetch(`${url}/expire/${encodeURIComponent(key)}/${windowSeconds}`,
      { headers: { Authorization: `Bearer ${token}` } });
    return { allowed: count <= limit };
  } catch (err) {
    console.error('[security] rate limit falló:', err.message);
    return { allowed: true };
  }
}

async function guard(req, res, { rateLimitKey, limit = 20, windowSeconds = 60, decoy = 'analyze' } = {}) {
  const ip = getClientIp(req);
  if (!checkOrigin(req) || !checkAppSecret(req)) {
    console.warn('[security] 403 forbidden', { ip, path: req.url });
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  if (isSuspiciousUA(req)) {
    console.warn('[security] decoy — UA sospechoso', { ip });
    await tarpitDelay();
    res.status(200).json(decoyResponse(decoy));
    return false;
  }
  const { allowed } = await rateLimit(`gainz:${rateLimitKey}:${ip}`, limit, windowSeconds);
  if (!allowed) {
    console.warn('[security] decoy — rate limit', { ip });
    await tarpitDelay();
    res.status(200).json(decoyResponse(decoy));
    return false;
  }
  return true;
}

function corsOrigin(req) {
  const origin = req.headers.origin;
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

export { guard, corsOrigin, isSuspiciousUA, tarpitDelay, decoyResponse,
         checkOrigin, checkAppSecret, rateLimit, getClientIp, ALLOWED_ORIGINS };
