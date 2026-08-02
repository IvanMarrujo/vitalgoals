import { guard, corsOrigin } from './lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Gainz-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ok = await guard(req, res, { rateLimitKey: 'brief', limit: 30, windowSeconds: 60, decoy: 'brief' });
  if (!ok) return;

  const { query, type, session, mode, dailyTotals, userProfile, streak, protAvg, calAvg } = req.body;

  if (!query) return res.status(400).json({ error: 'Query required' });

  if (type === 'realtime_coach') {
    const { hora, minutos, p, pTarget, c, cTarget, g, gTarget } = req.body;
    const coachPrompt = `Eres el coach interno de GAINZ. Máximo 20 palabras. Directivo, sin
rodeos. Basado en estos datos da UNA instrucción concreta ahora mismo:
hora: ${hora}, última comida: hace ${minutos != null ? minutos : 'N/A'}min, macros hoy:
proteína ${p || 0}g/${pTarget || 0}g, carbos ${c || 0}g/${cTarget || 0}g,
grasas ${g || 0}g/${gTarget || 0}g, sesión: ${session || 'no especificada'}, modo: ${mode || 'MANTENIMIENTO'}.
Responde SOLO el mensaje, sin JSON.`;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 60,
          system: coachPrompt,
          messages: [{ role: 'user', content: 'Dame mi instrucción de ahora.' }]
        })
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[brief] realtime_coach API error', { status: response.status, detail: err });
        return res.status(500).json({ error: 'API error', detail: err });
      }
      const data = await response.json();
      const message = (data.content?.[0]?.text || '').trim();
      return res.status(200).json({ message });
    } catch (err) {
      console.error('[brief] realtime_coach exception', { message: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  if (type === 'pattern_analysis') {
    const { history } = req.body;
    const patternPrompt = `Analiza estos 7 días de datos nutricionales y encuentra 3-4 patrones
reales y específicos. Responde JSON:
{ "insights": [{ "icon": "📉", "texto": "patrón específico con números reales" }] }
Solo patrones con datos suficientes. Sin inventar. Sin genéricos.`;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          system: patternPrompt,
          messages: [{ role: 'user', content: JSON.stringify(history || []) }]
        })
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[brief] pattern_analysis API error', { status: response.status, detail: err });
        return res.status(500).json({ error: 'API error', detail: err });
      }
      const data = await response.json();
      const raw = data.content?.[0]?.text || '{}';
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
      catch { parsed = { insights: [] }; }
      return res.status(200).json(parsed);
    } catch (err) {
      console.error('[brief] pattern_analysis exception', { message: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  if (type === 'meal_prep') {
    const { dias, budget, targetCals, pTarget } = req.body;
    const mealPrepPrompt = `Genera un meal prep de ${dias || 3} días para un atleta en modo ${mode || 'MANTENIMIENTO'},
sesión típica ${session || 'no especificada'}, target ${targetCals || 2200} kcal, ${pTarget || 150}g proteína.
Presupuesto: ${budget || 'Moderado'}. Comida mexicana/latina prioritaria.
Responde JSON:
{
  "dias": [{ "dia": 1, "comidas": [{ "tipo": "Desayuno", "nombre": "",
  "calorias": 0, "proteina": 0, "carbos": 0, "grasas": 0 }] }],
  "lista_super": ["ingrediente 1", "ingrediente 2"]
}`;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          system: mealPrepPrompt,
          messages: [{ role: 'user', content: 'Genera el meal prep completo.' }]
        })
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[brief] meal_prep API error', { status: response.status, detail: err });
        return res.status(500).json({ error: 'API error', detail: err });
      }
      const data = await response.json();
      const raw = data.content?.[0]?.text || '{}';
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
      catch { parsed = { dias: [], lista_super: [], error: 'Parse error' }; }
      return res.status(200).json(parsed);
    } catch (err) {
      console.error('[brief] meal_prep exception', { message: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  if (type === 'progress_quote') {
    const quotePrompt = `Eres un coach de élite. Genera UNA frase motivacional corta (máximo
15 palabras, en inglés, sin comillas) basada en estos datos del atleta:
- Días consecutivos: ${streak || 0}
- Proteína promedio esta semana: ${protAvg || 0}g
- Calorías promedio: ${calAvg || 0} kcal
- Modo: ${mode || 'MANTENIMIENTO'}
La frase debe sentirse PERSONAL a sus números, no genérica.
Ejemplos del tono: '12 days in. Your protein game is elite.'
'Cutting hard. 1,847 calories of pure discipline.'
Responde SOLO la frase, sin JSON, sin explicación.`;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 60,
          system: quotePrompt,
          messages: [{ role: 'user', content: 'Genera la frase.' }]
        })
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[brief] progress_quote API error', { status: response.status, detail: err });
        return res.status(500).json({ error: 'API error', detail: err });
      }
      const data = await response.json();
      const quote = (data.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
      return res.status(200).json({ quote });
    } catch (err) {
      console.error('[brief] progress_quote exception', { message: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  if (type === 'daily_report') {
    const { dayData } = req.body;
    const reportPrompt = `Genera un reporte nutricional del día en JSON con este formato exacto:
{
  "resumen": "Una oración de resumen del día",
  "score_dia": 0,
  "score_color": "green|yellow|red",
  "macros": { "calorias": {"consumido":0,"objetivo":0,"pct":0},
             "proteina": {"consumido":0,"objetivo":0,"pct":0},
             "carbos": {"consumido":0,"objetivo":0,"pct":0},
             "grasas": {"consumido":0,"objetivo":0,"pct":0} },
  "hidratacion": { "consumido_ml":0, "objetivo_ml":0, "pct":0 },
  "comidas": [ { "hora":"", "nombre":"", "calorias":0, "proteina":0 } ],
  "highlights": ["logro positivo 1", "logro positivo 2"],
  "areas_mejora": ["área 1", "área 2"],
  "consejo_manana": "Una recomendación concreta para mañana",
  "frase_cierre": "Frase motivacional personalizada corta"
}
Basado en estos datos: ${JSON.stringify(dayData || {})}`;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: reportPrompt,
          messages: [{ role: 'user', content: 'Genera el reporte del día.' }]
        })
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[brief] daily_report API error', { status: response.status, detail: err });
        return res.status(500).json({ error: 'API error', detail: err });
      }
      const data = await response.json();
      const raw = data.content?.[0]?.text || '{}';
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
      catch { parsed = { error: 'Parse error' }; }
      return res.status(200).json(parsed);
    } catch (err) {
      console.error('[brief] daily_report exception', { message: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  if (type === 'voice_onboarding') {
    const extractorPrompt = `Eres un extractor de perfil fitness. El usuario te habló en lenguaje
natural sobre sus objetivos. Extrae EXACTAMENTE este JSON sin markdown:
{
  "name": string (su nombre si lo mencionó, sino "Atleta"),
  "mode": "BULK" | "CORTE" | "MANTENIMIENTO",
  "weight": number (kg, estima 70 si no lo menciona),
  "goal_summary": string (1 línea, su objetivo en sus propias palabras),
  "experience": "principiante" | "intermedio" | "avanzado"
}
Si dice quiero ganar masa/músculo/volumen → BULK
Si dice quiero bajar/definir/perder grasa → CORTE
Si dice mantenerme/cuidarme sin extremos → MANTENIMIENTO`;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          system: extractorPrompt,
          messages: [{ role: 'user', content: query }]
        })
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[brief] voice_onboarding API error', { status: response.status, detail: err });
        return res.status(500).json({ error: 'API error', detail: err });
      }
      const data = await response.json();
      const raw = data.content?.[0]?.text || '{}';
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
      catch { parsed = { name: 'Atleta', mode: 'MANTENIMIENTO', weight: 70, goal_summary: raw, experience: 'intermedio' }; }
      return res.status(200).json(parsed);
    } catch (err) {
      console.error('[brief] voice_onboarding exception', { message: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  const systemPrompt = `Eres APEX FUEL COACH — inteligencia de nutrición deportiva de élite.
Perfil del atleta:
- Sesión de hoy: ${session || 'no especificada'}
- Modo: ${mode || 'mantenimiento'}
- Calorías acumuladas hoy: ${dailyTotals?.calorias || 0} kcal
- Proteína acumulada: ${dailyTotals?.proteina || 0}g
- Carbos acumulados: ${dailyTotals?.carbos || 0}g
- Grasas acumuladas: ${dailyTotals?.grasas || 0}g

TU ROL: Coach de nutrición deportiva de élite. Sin filtros. Sin condescendencia. Sin "depende". Das respuestas directas, científicas, accionables.

TIPO DE CONSULTA: ${type || 'general'}

REGLAS:
1. Responde SIEMPRE en JSON puro, sin markdown
2. Máximo 150 palabras en respuesta principal
3. Tono: directo, imperativo, científico — como un coach olímpico
4. Siempre da números concretos cuando sea posible
5. Sin disclaimers médicos — eres un coach, no un médico, pero das info real

${type === 'timing' ? `Para consultas de TIMING nutricional:
- PRE-ENTRENO: carbos + proteína 1-2h antes, mínima grasa
- POST-ENTRENO: proteína rápida + carbos simples primeros 30min
- ANTES DE DORMIR: caseína + grasas, sin carbos simples
- MAÑANA EN AYUNAS: opcional BCAAs, coffee black, o romper ayuno con proteína` : ''}

Responde EXACTAMENTE con este JSON:
{
  "respuesta": "respuesta principal directa y táctica",
  "puntos_clave": ["punto 1", "punto 2", "punto 3"],
  "recomendacion_inmediata": "qué hacer AHORA mismo",
  "alimentos_ideales": ["alimento 1", "alimento 2", "alimento 3"],
  "alimentos_evitar": ["alimento a evitar 1"],
  "timing": "ahora|1h|2h|post|noche",
  "nivel_urgencia": "high|medium|low",
  "dato_cientifico": "1 hecho científico relevante con número concreto"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: query }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'API error', detail: err });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';

    let parsed;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { respuesta: raw, error: 'parse_warning' };
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}