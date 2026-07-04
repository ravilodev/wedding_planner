/**
 * api/ai-ask.js
 * Vercel Serverless Function (Node.js runtime, zero-config — any file
 * under /api is auto-deployed as a function, no extra setup needed).
 *
 * Why this has to live server-side: the Gemini API key must NEVER be
 * shipped in browser JS (script.js) — anyone could read it from the
 * page source and burn your free-tier quota. This function is the one
 * place that holds GEMINI_API_KEY, read from a Vercel Environment
 * Variable, never from client code.
 *
 * POST body: { plan: {...}, question: "..." }
 * Response:  { success: true, answer: "...", source: "gemini"|"fallback" }
 */

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed.' });
    return;
  }

  const { plan, question } = req.body || {};

  if (!plan || !question || typeof question !== 'string' || !question.trim()) {
    res.status(422).json({ success: false, error: 'plan dan question wajib diisi.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  let answer = null;

  if (apiKey) {
    try {
      answer = await callGemini(plan, question, apiKey);
    } catch (err) {
      console.error('Gemini call failed:', err.message);
      answer = null; // fall through to rule-based answer below
    }
  }

  if (answer) {
    res.status(200).json({ success: true, answer, source: 'gemini' });
    return;
  }

  res.status(200).json({
    success: true,
    answer: generateFallbackAnswer(plan, classifyQuestion(question)),
    source: 'fallback',
  });
};

/* ------------------------------------------------------------------
   Gemini client
------------------------------------------------------------------ */
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(plan, question, apiKey) {
  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt(plan) }] },
    contents: [{ role: 'user', parts: [{ text: question }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey, // required header for both AIza... and AQ.... key formats
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function formatRupiah(n) {
  return 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
}

function daysUntil(dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function buildSystemPrompt(plan) {
  const days = daysUntil(plan.weddingDate);
  const allocationLines = (plan.allocation || [])
    .map(
      (c) =>
        `- ${c.name}: alokasi ${formatRupiah(c.amount)} (${c.pct}%), estimasi pasar ${formatRupiah(c.market)}, status ${c.status}${c.selected ? ', sudah dipilih vendornya' : ''}`
    )
    .join('\n');
  const done = (plan.checklist || []).filter((c) => c.checked);
  const checklistLine = `${done.length} dari ${(plan.checklist || []).length} item checklist sudah selesai${done.length ? ': ' + done.map((c) => c.label).join(', ') : ''}.`;

  return (
    'Anda adalah konsultan AI di dalam aplikasi Wedding Budget AI Planner bernama Nikara. ' +
    'Anda BUKAN chatbot umum — jawab HANYA berdasarkan data rencana pernikahan di bawah ini. ' +
    'Jawab dalam Bahasa Indonesia, singkat (maksimal 4-5 kalimat), konkret, dan gunakan angka Rupiah dari data yang diberikan. ' +
    'Jangan mengarang vendor, harga, atau fakta yang tidak ada di data.\n\n' +
    'DATA RENCANA:\n' +
    `- Mempelai: ${plan.groom} & ${plan.bride}\n` +
    `- Kota: ${plan.city}\n` +
    `- Tanggal pernikahan: ${plan.weddingDate} (sisa ${days} hari)\n` +
    `- Total budget: ${formatRupiah(plan.budget)}\n` +
    `- Jumlah tamu: ${plan.guests}\n` +
    `- Konsep: ${plan.concept}\n` +
    `- Wedding Readiness Score: ${plan.readinessScore}%\n` +
    `- Alokasi budget per kategori:\n${allocationLines}\n` +
    `- Checklist: ${checklistLine}\n`
  );
}

/* ------------------------------------------------------------------
   Rule-based fallback (used when GEMINI_API_KEY is missing, Gemini
   errors out, or the free-tier quota is exhausted) — the AI Assistant
   panel should never show a dead end.
------------------------------------------------------------------ */
function classifyQuestion(text) {
  const t = text.toLowerCase();
  if (t.includes('cukup')) return 'cukup';
  if (t.includes('hemat') || t.includes('catering')) return 'hemat-catering';
  if (t.includes('prioritas')) return 'prioritas';
  if (t.includes('turun') || t.includes('80 juta') || t.includes('80juta')) return 'turun-budget';
  return 'default';
}

function getPriorityActions(days) {
  if (days > 60) return ['Booking Venue', 'Survey Catering'];
  if (days > 30) return ['Pilih Dekorasi', 'Booking MUA', 'Undangan'];
  if (days > 7) return ['Cetak Undangan', 'Konfirmasi Vendor', 'Fitting Busana'];
  return ['Konfirmasi Final ke Semua Vendor', 'Siapkan Runsheet Hari-H'];
}

function generateFallbackAnswer(plan, intent) {
  const days = daysUntil(plan.weddingDate);
  const tight = (plan.allocation || []).filter((a) => a.status === 'tight');

  switch (intent) {
    case 'cukup': {
      if (tight.length === 0) {
        return `Berdasarkan alokasi saat ini, budget ${formatRupiah(plan.budget)} Anda untuk ${plan.guests} tamu di ${plan.city} sudah realistis — seluruh kategori berada dalam rentang harga pasar yang wajar.`;
      }
      const names = tight.map((c) => c.name).join(', ');
      return `Budget Anda cukup ketat pada ${tight.length} kategori (${names}). Saran saya, geser 5–10% dari kategori yang surplus untuk menutup selisihnya.`;
    }
    case 'hemat-catering': {
      const catering = (plan.allocation || []).find((c) => c.key === 'catering');
      const amount = catering ? formatRupiah(catering.amount) : '-';
      return `Untuk catering dengan alokasi ${amount}, Anda bisa menghemat dengan sistem prasmanan dibanding standing party, dan kunci jumlah tamu final sebelum DP agar tidak ada biaya tambahan per pax.`;
    }
    case 'prioritas': {
      return `Dengan sisa waktu ${days} hari menuju hari-H, prioritas utama Anda minggu ini adalah: ${getPriorityActions(days).join(', ')}.`;
    }
    case 'turun-budget': {
      const newBudget = 80000000;
      const diff = plan.budget - newBudget;
      const direction = diff > 0 ? 'penurunan' : 'kenaikan';
      return `Jika budget turun menjadi Rp80.000.000 (${direction} ${formatRupiah(Math.abs(diff))} dari saat ini), saya sarankan menurunkan alokasi dekorasi dan entertainment terlebih dahulu, karena venue dan catering paling sulit dikompromikan untuk ${plan.guests} tamu.`;
    }
    default:
      return `Saya menganalisis rencana Anda untuk ${plan.guests} tamu di ${plan.city} dengan budget ${formatRupiah(plan.budget)}. Coba tanyakan hal spesifik seperti alokasi kategori tertentu atau skenario perubahan budget agar saya bisa memberi rekomendasi yang lebih tajam.`;
  }
}
