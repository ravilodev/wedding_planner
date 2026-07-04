# Wedding Budget AI Planner — Supabase + Vercel Edition

Versi ini beda arsitektur dari versi PHP:

```
wedding-budget-ai-vercel/
├── index.html, style.css        <- sama seperti versi PHP
├── config.js                    <- URL & anon key Supabase (PUBLIC, aman diexpose)
├── script.js                    <- hitung alokasi/checklist di client, simpan ke Supabase
├── api/
│   └── ai-ask.js                <- Vercel serverless function (Node.js), manggil Gemini
└── supabase/
    └── schema.sql                <- struktur tabel + RLS policy
```

Kenapa begini: Vercel tidak menjalankan PHP. Yang jalan di Vercel cuma dua jenis file —
file statis (html/css/js) dan **serverless function** (apa pun di folder `/api`, otomatis
jadi endpoint, tanpa config tambahan). Jadi:

- Perhitungan budget/checklist/timeline pindah balik ke `script.js` (client-side)
- Penyimpanan data pindah ke **Supabase** (bukan file JSON, karena Vercel filesystem-nya
  read-only & sementara)
- Panggilan ke Gemini tetap di server (`api/ai-ask.js`) — supaya API key Gemini tidak
  kelihatan di browser

## 1. Setup Supabase

1. Buat project baru di https://supabase.com/dashboard (gratis)
2. Buka **SQL Editor** → New query → paste isi `supabase/schema.sql` → **Run**
3. Buka **Authentication → Sign In / Providers → Anonymous** → **Enable**
   (ini yang bikin tiap browser dapat identitas unik tanpa perlu bikin form login —
   sekaligus yang membuat RLS di step 2 bisa membatasi akses per-pemilik data)
4. Buka **Settings → API** → salin **Project URL** dan **anon public key**
5. Paste ke `config.js`:
   ```js
   const SUPABASE_URL = 'https://xxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   Ini **bukan rahasia** — anon key memang didesain untuk ada di browser, keamanannya
   dijaga oleh RLS policy di `schema.sql`, bukan dengan menyembunyikan key ini.

## 2. Setup Gemini (tetap server-side, tetap rahasia)

Ambil API key gratis di https://aistudio.google.com/apikey — **jangan** ditaruh di
`config.js`. Key ini nanti diisi sebagai Environment Variable di Vercel (langkah 4).

## 3. Push ke GitHub

```bash
cd wedding-budget-ai-vercel
git init
git add .
git commit -m "Initial commit: Wedding Budget AI Planner (Supabase + Vercel)"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```

Tidak ada file rahasia di project ini yang perlu di-gitignore — `config.js` isinya
anon key yang memang publik, dan Gemini key tidak pernah ditulis ke file sama sekali.

## 4. Deploy ke Vercel

1. https://vercel.com/new → import repo GitHub kamu
2. Framework preset: pilih **"Other"** (project ini tidak pakai framework/build step)
3. Sebelum klik Deploy, buka **Environment Variables**, tambahkan:
   - `GEMINI_API_KEY` = key Gemini kamu (`AQ....` atau `AIzaSy...`)
4. Klik **Deploy**

Setelah deploy selesai, Vercel otomatis:
- Serve `index.html`, `style.css`, `script.js`, `config.js` sebagai static files
- Deploy `api/ai-ask.js` sebagai serverless function di `https://domain-kamu.vercel.app/api/ai-ask`

## 5. Test

Buka domain Vercel kamu → isi wizard → Generate Wedding Plan → cek dashboard muncul.
Buka Supabase Dashboard → Table Editor → tabel `plans` → harus ada baris baru.
Coba tanya sesuatu di AI Assistant panel → kalau `GEMINI_API_KEY` benar, jawabannya
akan lebih natural (bukan template).

## Kalau nanti mau ganti API key Gemini

Vercel Dashboard → Project kamu → Settings → Environment Variables → edit `GEMINI_API_KEY`
→ **Redeploy** (env var baru cuma kepakai di deployment berikutnya, bukan otomatis live).

## Catatan privasi

Setiap plan disimpan dengan `owner_id` = ID sesi anonim browser yang membuatnya. RLS di
`schema.sql` memastikan hanya sesi itu yang bisa baca/edit datanya sendiri — orang lain
yang punya `SUPABASE_ANON_KEY` kamu (memang publik) tetap tidak bisa lihat data pernikahan
orang lain. Catatan: karena sesi anonim disimpan di localStorage browser, ganti browser/
clear cache/mode incognito = dianggap "pengguna baru" (rencana lama tidak akan muncul lagi
di device itu). Kalau kamu mau plan bisa diakses lintas device, perlu ditambah fitur
login/email — di luar cakupan versi ini.
