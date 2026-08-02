import { guard, corsOrigin } from './lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Gainz-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ok = await guard(req, res, { rateLimitKey: 'analyze', limit: 20, windowSeconds: 60, decoy: 'analyze' });
  if (!ok) return;

  const { image, context, session, mode, textOnly } = req.body;
  if (!image && !textOnly) return res.status(400).json({ error: 'Image or text required' });

  const sessionLabels = {
    PESAS: 'entrenamiento de fuerza / hipertrofia',
    CARDIO: 'cardio de alta intensidad / resistencia',
    DEPORTE: 'deporte de equipo / rendimiento atlético',
    HIBRIDO: 'entrenamiento híbrido fuerza + cardio',
    DESCANSO: 'día de descanso / recuperación activa'
  };

  const modeLabels = {
    BULK: 'volumen (superávit calórico ~300-500 kcal)',
    CORTE: 'definición (déficit calórico ~300-500 kcal)',
    MANTENIMIENTO: 'mantenimiento calórico'
  };

  const systemPrompt = `Eres GAINZ Vision AI — sistema de análisis nutricional de élite con computer vision deportiva.
Sesión del atleta: ${sessionLabels[session] || 'no especificada'}. Modo: ${modeLabels[mode] || 'mantenimiento'}.
Contexto adicional: "${context || 'ninguno'}"
${textOnly ? 'MODO TEXTO: El usuario describió los alimentos en texto. Estima macros con precisión basándote en porciones estándar.' : ''}

REGLAS:
1. Responde SIEMPRE en JSON puro, sin markdown
2. Si detectas MÚLTIPLES alimentos en el plato (más de 1 componente), llena el array "alimentos" con cada uno
3. Si detectas un código de barras, marca barcode_detectado: true
4. Siempre incluye "confianza" (0-100) basado en qué tan claro es el alimento
5. Si es texto libre, confianza puede ser 75-90% según el detalle dado

MATCH SCORE para ${session}:
${session === 'PESAS' ? 'Proteína >25g=+40pts, carbos complejos >40g=+30pts, grasas <15g=+20pts, cafeína=+10pts. Penaliza azúcar simple >20g -20pts' : ''}
${session === 'CARDIO' ? 'Carbos simples >40g=+40pts, bajo en grasa <10g=+25pts, hidratación=+20pts, electrolitos=+15pts' : ''}
${session === 'DEPORTE' ? 'Carbos mixtos >50g=+35pts, proteína 20-30g=+30pts, bajo en grasa=+20pts, digestión rápida=+15pts' : ''}
${session === 'HIBRIDO' ? 'Balance proteína 20-30g=+30pts, carbos 40-60g=+30pts, grasas saludables <20g=+25pts, fibra=+15pts' : ''}
${session === 'DESCANSO' ? 'Proteína alta >30g=+40pts, grasas saludables omega3=+25pts, antiinflamatorios=+20pts, carbos bajos=+15pts' : ''}

COMIDAS LATINAS FRECUENTES — identifica con alta confianza:
tacos (de pastor, carnitas, barbacoa, canasta), tortas, burritos,
quesadillas, enchiladas, pozole, tamales, chilaquiles, huevos
rancheros, caldo de res, sopa de lima, arroz rojo, frijoles de
olla/refritos, elote, esquites, agua de fruta, horchata, Jamaica.
Para estas comidas estima porciones por número de piezas o tamaño
del recipiente visible.

REFERENCIA DE PORCIONES: si hay cubiertos, manos, o recipientes
estándar visibles úsalos como referencia de tamaño.

ILUMINACIÓN BAJA: si la imagen es oscura, baja la confianza a
máximo 60 e indica 'iluminación insuficiente' en alerta.

IMAGEN BORROSA O POCO CLARA: confianza máximo 50, indica
'imagen poco clara' en alerta.

Responde con EXACTAMENTE este JSON:
{
  "nombre": "nombre principal del plato",
  "descripcion": "descripción táctica 1 línea",
  "porcion": "tamaño estimado",
  "calorias": 000,
  "proteina": 00,
  "carbohidratos": 00,
  "grasas": 00,
  "fibra": 0,
  "azucar": 0,
  "confianza": 85,
  "barcode_detectado": false,
  "match_score": 00,
  "match_color": "green|yellow|red",
  "match_explicacion": "explicación táctica 2-3 líneas",
  "puntos_fuertes": ["ventaja 1", "ventaja 2"],
  "puntos_debiles": ["desventaja 1"],
  "recomendacion_coach": "recomendación táctica directa",
  "timing_ideal": "pre|post|manana|noche|cualquier",
  "alimentos": [
    {
      "nombre": "componente 1",
      "calorias": 000,
      "proteina": 00,
      "carbohidratos": 00,
      "grasas": 00,
      "match_score": 00,
      "confianza": 85
    }
  ],
  "alerta": null
}
Si solo hay UN alimento, el array "alimentos" tiene 1 elemento. Si hay múltiples, lista cada uno.`;

  try {
    let messages;
    if (textOnly) {
      messages = [{ role: 'user', content: `Analiza estos alimentos descritos por el atleta: "${context}". Dame el JSON completo.` }];
    } else {
      const mediaType = image.startsWith('/9j/') || image.startsWith('iVBOR') ? 
        (image.startsWith('/9j/') ? 'image/jpeg' : 'image/png') : 'image/jpeg';
      messages = [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: `Analiza este alimento/plato. Contexto: "${context || 'ninguno'}". Sesión: ${session}. Modo: ${mode}. Dame el JSON completo con todos los campos.` }
        ]
      }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: systemPrompt, messages })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[analyze] Anthropic API error', {
        status: response.status,
        statusText: response.statusText,
        detail: err,
        reqContext: { session, mode, textOnly: !!textOnly, hasImage: !!image, imageLen: image ? image.length : 0, contextLen: (context || '').length }
      });
      return res.status(500).json({ error: 'API error', detail: err });
    }
    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch { parsed = { error: 'Parse error', raw }; }

    if (parsed.match_score >= 80) parsed.match_color = 'green';
    else if (parsed.match_score >= 50) parsed.match_color = 'yellow';
    else parsed.match_color = 'red';

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('[analyze] Handler exception', {
      message: err.message,
      stack: err.stack,
      reqContext: { session, mode, textOnly: !!textOnly, hasImage: !!image, imageLen: image ? image.length : 0, contextLen: (context || '').length }
    });
    return res.status(500).json({ error: err.message });
  }
}
