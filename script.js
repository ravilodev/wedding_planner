/* ==========================================================================
   NIKARA.AI — WEDDING BUDGET AI PLANNER (Supabase + Vercel edition)
   - Allocation/checklist/timeline computed client-side (same rules as
     the reference data used to live in a PHP backend).
   - Persistence via Supabase (Postgres + RLS), scoped to an anonymous
     Supabase Auth identity per browser — no login screen needed.
   - AI Assistant calls /api/ai-ask (Vercel serverless function) so the
     Gemini API key never ships to the browser.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     0. SUPABASE CLIENT
  ------------------------------------------------------------------ */
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function ensureSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) return session;
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) throw new Error('Gagal membuat sesi anonim: ' + error.message);
    return data.session;
  }

  /* ------------------------------------------------------------------
     1. "DATABASE" — reference data for computing a plan client-side.
     (Moves to a Supabase table too if you want it admin-editable later;
     kept as constants here since it rarely changes.)
  ------------------------------------------------------------------ */
  const ALLOCATION_TEMPLATE = [
    { key: 'venue',        name: 'Venue',            pct: 30, color: '#B76E79' },
    { key: 'catering',     name: 'Catering',         pct: 25, color: '#C89FA5' },
    { key: 'decoration',   name: 'Decoration',       pct: 10, color: '#D9B6BC' },
    { key: 'mua',          name: 'MUA',              pct: 6,  color: '#E8CDD1' },
    { key: 'photography',  name: 'Photography',      pct: 8,  color: '#9C5761' },
    { key: 'invitation',   name: 'Invitation',       pct: 3,  color: '#F0DEE1' },
    { key: 'entertainment',name: 'Entertainment',    pct: 6,  color: '#CFA3AA' },
    { key: 'dress',        name: 'Wedding Dress',    pct: 5,  color: '#BC8790' },
    { key: 'documentation',name: 'Documentation',    pct: 4,  color: '#A97078' },
    { key: 'emergency',    name: 'Emergency Fund',   pct: 3,  color: '#EADCDE' },
  ];

  const CATEGORY_INFO = {
    venue:        { tips: 'Pilih venue di hari kerja (weekday) untuk potongan harga 15–25%, dan cek paket all-in yang sudah termasuk dekorasi dasar.', notes: 'Booking minimal H-60 untuk tanggal favorit (akhir pekan, high season).' },
    catering:     { tips: 'Gunakan sistem prasmanan dibanding standing party untuk menekan biaya per pax pada tamu di atas 300 orang.', notes: 'Minta food tasting sebelum DP untuk memastikan porsi dan rasa sesuai budget.' },
    decoration:   { tips: 'Manfaatkan bunga lokal musiman dan sewa backdrop modular alih-alih custom build dari nol.', notes: 'Konsep minimalis-elegan biasanya 20% lebih hemat dibanding tema maximalist.' },
    mua:          { tips: 'Booking MUA langganan venue sering memberi harga paket lebih murah dibanding MUA independen.', notes: 'Sertakan trial makeup H-14 di dalam kontrak agar tidak ada biaya tambahan.' },
    photography:  { tips: 'Pilih paket foto + video bundling dibanding vendor terpisah untuk efisiensi hingga 15%.', notes: 'Pastikan jumlah jam liputan sesuai durasi acara aktual, bukan estimasi kasar.' },
    invitation:   { tips: 'Gunakan undangan digital untuk 60–70% tamu dan cetak fisik hanya untuk keluarga inti.', notes: 'Cetak undangan fisik H-30 setelah jumlah tamu final terkonfirmasi.' },
    entertainment:{ tips: 'MC + akustik duo lebih hemat dibanding full band untuk acara di bawah 300 tamu.', notes: 'Konfirmasi playlist dan durasi tampil agar tidak kena biaya overtime.' },
    dress:        { tips: 'Sewa gaun dari desainer lokal alih-alih custom made dapat menghemat hingga 40%.', notes: 'Fitting terakhir idealnya H-7 untuk mengantisipasi perubahan ukuran.' },
    documentation:{ tips: 'Gabungkan dokumentasi akad dan resepsi dalam satu tim untuk tarif paket, bukan per sesi.', notes: 'Tanyakan estimasi waktu pengerjaan album dan raw file setelah acara.' },
    emergency:    { tips: 'Jangan gunakan dana darurat untuk upgrade non-esensial — simpan untuk kebutuhan mendadak H-7 hingga hari-H.', notes: 'Idealnya dana ini tidak disentuh sampai 2 minggu terakhir sebelum acara.' },
  };

  const CITY_MULTIPLIER = {
    'Jakarta': 1.25, 'Bandung': 1.0, 'Surabaya': 1.05, 'Yogyakarta': 0.85,
    'Semarang': 0.9, 'Medan': 0.95, 'Denpasar': 1.15, 'Makassar': 0.95,
  };

  const CHECKLIST_TEMPLATE = [
    'Booking Venue', 'Survey Catering', 'Pilih Dekorasi', 'Booking MUA',
    'Foto Pre Wedding', 'Undangan', 'MC', 'Band', 'Souvenir', 'Transportasi',
  ];

  /* ------------------------------------------------------------------
     2. APPLICATION STATE
  ------------------------------------------------------------------ */
  const wizard = {
    groom: '', bride: '', city: '', weddingDate: '', budget: 0,
    guests: 200, concept: '',
    currentStep: 1,
    totalSteps: 6,
  };

  let plan = null; // camelCase in-memory shape; mapped to/from snake_case DB rows

  /* ------------------------------------------------------------------
     3. UTILITIES
  ------------------------------------------------------------------ */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function formatRupiah(num) {
    num = Math.round(num || 0);
    return 'Rp' + num.toLocaleString('id-ID');
  }
  function parseRupiahInput(str) {
    return parseInt(String(str).replace(/[^0-9]/g, ''), 10) || 0;
  }
  function daysUntil(dateStr) {
    if (!dateStr) return 0;
    const target = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  }
  function animateCounter(el, endValue, opts) {
    opts = opts || {};
    const duration = opts.duration || 900;
    const format = opts.format || (v => Math.round(v).toLocaleString('id-ID'));
    const startTime = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(0 + (endValue - 0) * eased);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function showToast(message, type) {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' toast-' + type : '');
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ------------------------------------------------------------------
     4. VIEW ROUTING
  ------------------------------------------------------------------ */
  function showView(name) {
    $$('[data-view]').forEach(v => v.classList.add('hidden'));
    $('#view-' + name).classList.remove('hidden');
    $$('[data-nav-link]').forEach(l => l.classList.toggle('active', l.dataset.target === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'dashboard') {
      $('#nav-dashboard').style.display = 'inline-block';
      $('#header-cta').textContent = 'Susun Ulang';
    }
  }

  /* ------------------------------------------------------------------
     5. WIZARD LOGIC
  ------------------------------------------------------------------ */
  function initWizard() {
    resetWizardState();
    renderWizardStep();

    $('#wizard-next').addEventListener('click', onWizardNext);
    $('#wizard-back').addEventListener('click', onWizardBack);
    $('#wizard-submit').addEventListener('click', onWizardSubmit);

    const budgetInput = $('#input-budget');
    budgetInput.addEventListener('input', () => {
      const raw = parseRupiahInput(budgetInput.value);
      budgetInput.value = raw ? raw.toLocaleString('id-ID') : '';
      $$('.chip').forEach(c => c.classList.toggle('active', parseInt(c.dataset.budget, 10) === raw));
    });
    $$('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        budgetInput.value = parseInt(chip.dataset.budget, 10).toLocaleString('id-ID');
        $$('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    const slider = $('#input-guests-slider');
    const number = $('#input-guests-number');
    slider.addEventListener('input', () => { number.value = slider.value; });
    number.addEventListener('input', () => {
      let v = parseInt(number.value, 10) || 0;
      slider.value = v > 1000 ? 1000 : v;
    });

    $$('.concept-card').forEach(card => {
      card.addEventListener('click', () => {
        $$('.concept-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        wizard.concept = card.dataset.concept;
      });
    });

    const today = new Date().toISOString().split('T')[0];
    $('#input-date').setAttribute('min', today);
  }

  function resetWizardState() {
    wizard.currentStep = 1;
    $('#wizard-form').reset();
    $$('.concept-card').forEach(c => c.classList.remove('active'));
    $$('.chip').forEach(c => c.classList.remove('active'));
    wizard.concept = '';
    plan = null;
  }

  function renderWizardStep() {
    $$('.wizard-step').forEach(p => p.classList.toggle('active', parseInt(p.dataset.stepPanel, 10) === wizard.currentStep));
    $$('.wp-step').forEach(s => {
      const n = parseInt(s.dataset.step, 10);
      s.classList.toggle('active', n === wizard.currentStep);
      s.classList.toggle('done', n < wizard.currentStep);
    });
    $('#wizard-progress-fill').style.width = ((wizard.currentStep - 1) / (wizard.totalSteps - 1) * 100) + '%';
    $('#wizard-back').style.visibility = wizard.currentStep === 1 ? 'hidden' : 'visible';
    $('#wizard-next').classList.toggle('hidden', wizard.currentStep === wizard.totalSteps);
    $('#wizard-submit').classList.toggle('hidden', wizard.currentStep !== wizard.totalSteps);
  }

  function validateStep(step) {
    const errorEl = $('#error-step' + step);
    errorEl.textContent = '';
    switch (step) {
      case 1: {
        const groom = $('#input-name-groom').value.trim();
        const bride = $('#input-name-bride').value.trim();
        if (!groom || !bride) { errorEl.textContent = 'Mohon isi kedua nama mempelai.'; return false; }
        wizard.groom = groom; wizard.bride = bride;
        return true;
      }
      case 2: {
        const city = $('#input-city').value;
        if (!city) { errorEl.textContent = 'Mohon pilih kota acara.'; return false; }
        wizard.city = city;
        return true;
      }
      case 3: {
        const date = $('#input-date').value;
        if (!date) { errorEl.textContent = 'Mohon pilih tanggal pernikahan.'; return false; }
        if (daysUntil(date) < 0) { errorEl.textContent = 'Tanggal tidak boleh di masa lalu.'; return false; }
        wizard.weddingDate = date;
        return true;
      }
      case 4: {
        const raw = parseRupiahInput($('#input-budget').value);
        if (!raw || raw < 5000000) { errorEl.textContent = 'Mohon masukkan budget minimal Rp5.000.000.'; return false; }
        wizard.budget = raw;
        return true;
      }
      case 5: {
        const guests = parseInt($('#input-guests-number').value, 10);
        if (!guests || guests < 10) { errorEl.textContent = 'Mohon masukkan jumlah tamu yang valid.'; return false; }
        wizard.guests = guests;
        return true;
      }
      case 6: {
        if (!wizard.concept) { errorEl.textContent = 'Mohon pilih satu konsep pernikahan.'; return false; }
        return true;
      }
      default: return true;
    }
  }

  function onWizardNext() {
    if (!validateStep(wizard.currentStep)) return;
    if (wizard.currentStep < wizard.totalSteps) { wizard.currentStep++; renderWizardStep(); }
  }
  function onWizardBack() {
    if (wizard.currentStep > 1) { wizard.currentStep--; renderWizardStep(); }
  }
  function onWizardSubmit() {
    if (!validateStep(6)) return;
    runGeneratingSequence();
  }

  /* ------------------------------------------------------------------
     6. PLAN COMPUTATION (client-side) + SUPABASE PERSISTENCE
  ------------------------------------------------------------------ */
  function computeAllocation(budget, city, guests) {
    const multiplier = CITY_MULTIPLIER[city] || 1;
    const baselinePerGuest = { venue: 90000, catering: 120000 };
    return ALLOCATION_TEMPLATE.map(cat => {
      const amount = Math.round(budget * (cat.pct / 100));
      let market;
      if (baselinePerGuest[cat.key]) {
        market = Math.round(baselinePerGuest[cat.key] * guests * multiplier);
      } else {
        market = Math.round(amount * (0.9 + Math.random() * 0.25));
      }
      let status = 'balanced';
      if (amount < market * 0.85) status = 'tight';
      else if (amount > market * 1.15) status = 'surplus';
      return { ...cat, amount, market, status, selected: false, ...CATEGORY_INFO[cat.key] };
    });
  }

  function computeReadinessScore(allocation, checklist) {
    const checkedCount = checklist.filter(c => c.checked).length;
    const checklistScore = (checkedCount / checklist.length) * 50;
    const balanced = allocation.filter(a => a.status !== 'tight').length;
    const budgetScore = (balanced / allocation.length) * 50;
    return Math.round(checklistScore + budgetScore);
  }

  function getPriorityActions(days) {
    if (days > 60) return ['Booking Venue', 'Survey Catering'];
    if (days > 30) return ['Pilih Dekorasi', 'Booking MUA', 'Undangan'];
    if (days > 7) return ['Cetak Undangan', 'Konfirmasi Vendor', 'Fitting Busana'];
    return ['Konfirmasi Final ke Semua Vendor', 'Siapkan Runsheet Hari-H'];
  }

  function buildAIRecommendation(planData) {
    const tight = planData.allocation.filter(a => a.status === 'tight');
    const days = daysUntil(planData.weddingDate);
    const budgetStr = formatRupiah(planData.budget);
    let text;
    if (tight.length === 0) {
      text = `Dengan budget ${budgetStr} untuk ${planData.guests} tamu di ${planData.city} dan waktu persiapan ${days} hari, alokasi budget Anda masih realistis dibandingkan harga pasar setempat.`;
    } else {
      const names = tight.map(c => c.name).join(', ');
      text = `Dengan budget ${budgetStr} untuk ${planData.guests} tamu di ${planData.city} dan waktu persiapan ${days} hari, alokasi Anda cukup ketat pada kategori ${names}. Pertimbangkan menggeser dana dari kategori yang surplus.`;
    }
    return { text, priorities: getPriorityActions(days) };
  }

  // camelCase (app) <-> snake_case (Supabase row)
  function toDbRow(p) {
    return {
      groom: p.groom, bride: p.bride, city: p.city,
      wedding_date: p.weddingDate, budget: p.budget, guests: p.guests,
      concept: p.concept, allocation: p.allocation, checklist: p.checklist,
      readiness_score: p.readinessScore,
    };
  }
  function fromDbRow(row) {
    return {
      id: row.id, groom: row.groom, bride: row.bride, city: row.city,
      weddingDate: row.wedding_date, budget: row.budget, guests: row.guests,
      concept: row.concept, allocation: row.allocation, checklist: row.checklist,
      readinessScore: row.readiness_score,
    };
  }

  async function createPlan() {
    const allocation = computeAllocation(wizard.budget, wizard.city, wizard.guests);
    const checklist = CHECKLIST_TEMPLATE.map(label => ({ label, checked: false }));
    const readinessScore = computeReadinessScore(allocation, checklist);

    const draft = {
      groom: wizard.groom, bride: wizard.bride, city: wizard.city,
      weddingDate: wizard.weddingDate, budget: wizard.budget, guests: wizard.guests,
      concept: wizard.concept, allocation, checklist, readinessScore,
    };

    await ensureSession();
    const { data, error } = await supabaseClient
      .from('plans')
      .insert(toDbRow(draft))
      .select()
      .single();

    if (error) throw new Error('Gagal menyimpan rencana ke Supabase: ' + error.message);
    return fromDbRow(data);
  }

  async function persistChecklist(planId, checklist, readinessScore) {
    const { error } = await supabaseClient
      .from('plans')
      .update({ checklist, readiness_score: readinessScore })
      .eq('id', planId);
    if (error) throw new Error(error.message);
  }

  async function persistAllocation(planId, allocation) {
    const { error } = await supabaseClient
      .from('plans')
      .update({ allocation })
      .eq('id', planId);
    if (error) throw new Error(error.message);
  }

  function runGeneratingSequence() {
    const overlay = $('#generating-overlay');
    const stepText = $('#generating-step');
    const bar = $('#generating-bar-fill');
    const messages = [
      'Menganalisis budget dan lokasi…',
      'Menghitung estimasi harga pasar…',
      'Menyusun alokasi budget per kategori…',
      'Membuat linimasa persiapan…',
      'Menyelesaikan rekomendasi AI…',
    ];
    overlay.classList.remove('hidden');
    let i = 0;
    bar.style.width = '0%';
    stepText.textContent = messages[0];

    const animation = new Promise(resolve => {
      const interval = setInterval(() => {
        i++;
        bar.style.width = Math.min(100, (i / messages.length) * 100) + '%';
        if (i < messages.length) stepText.textContent = messages[i];
        else { clearInterval(interval); resolve(); }
      }, 480);
    });

    Promise.all([animation, createPlan()])
      .then(([, createdPlan]) => {
        plan = createdPlan;
        setTimeout(() => {
          overlay.classList.add('hidden');
          try {
            renderDashboard();
            showView('dashboard');
            showToast('Rencana pernikahan Anda berhasil dibuat & disimpan.', 'success');
          } catch (renderErr) {
            console.error('renderDashboard failed:', renderErr);
            showToast('Data tersimpan, tapi gagal menampilkan dashboard: ' + renderErr.message, 'warning');
          }
        }, 300);
      })
      .catch(err => {
        overlay.classList.add('hidden');
        console.error('createPlan failed:', err);
        showToast(err.message || 'Gagal membuat rencana. Cek koneksi Supabase kamu.', 'warning');
      });
  }

  /* ------------------------------------------------------------------
     7. DASHBOARD RENDER
  ------------------------------------------------------------------ */
  let allocationChartInstance = null;

  function renderDashboard() {
    if (!plan) return;
    const days = daysUntil(plan.weddingDate);

    $('#dash-title').textContent = `${plan.groom} & ${plan.bride}`;
    $('#dash-eyebrow').textContent = `Rencana Pernikahan — ${plan.concept}`;

    animateCounter($('#summary-budget'), plan.budget, { format: v => formatRupiah(v) });
    $('#summary-city').textContent = plan.city;
    animateCounter($('#summary-guests'), plan.guests, { format: v => Math.round(v).toLocaleString('id-ID') + ' tamu' });
    $('#summary-concept').textContent = plan.concept;
    animateCounter($('#summary-days'), Math.max(days, 0), { format: v => Math.round(v).toLocaleString('id-ID') + ' hari' });
    $('#summary-date').textContent = new Date(plan.weddingDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    renderReadinessRing(plan.readinessScore);
    renderAllocation();
    renderAIRecommendation();
    renderTimeline(days);
    renderChecklist();
    renderAccordion();
  }

  function renderReadinessRing(score) {
    const circumference = 2 * Math.PI * 52;
    const ring = $('#readiness-ring');
    ring.style.strokeDasharray = String(circumference);
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = String(circumference - (circumference * score / 100));
    });
    animateCounter($('#readiness-number'), score, { format: v => Math.round(v) + '%' });
  }

  function renderAllocation() {
    animateCounter($('#allocation-total'), plan.budget, { format: v => formatRupiah(v) });
    $('#allocation-list').innerHTML = plan.allocation.map(cat => `
      <li class="allocation-item">
        <span class="allocation-swatch" style="background:${cat.color}"></span>
        <span class="allocation-item-name">${cat.name}</span>
        <span class="allocation-item-pct">${cat.pct}%</span>
        <span class="allocation-item-value">${formatRupiah(cat.amount)}</span>
      </li>`).join('');

    const ctx = $('#allocation-chart').getContext('2d');
    if (allocationChartInstance) allocationChartInstance.destroy();
    allocationChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: plan.allocation.map(c => c.name),
        datasets: [{
          data: plan.allocation.map(c => c.amount),
          backgroundColor: plan.allocation.map(c => c.color),
          borderWidth: 3, borderColor: '#ffffff', hoverOffset: 6,
        }],
      },
      options: {
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => ` ${item.label}: ${formatRupiah(item.parsed)}` } },
        },
        animation: { animateRotate: true, duration: 900 },
      },
    });
  }

  function renderAIRecommendation() {
    const reco = buildAIRecommendation(plan);
    $('#ai-reco-text').textContent = reco.text;
    $('#ai-reco-priorities').innerHTML = reco.priorities.map(p => `<span>${p}</span>`).join('');
  }

  function renderTimeline(days) {
    const milestones = [
      { label: '3 Bulan', threshold: 90, title: 'Riset & booking vendor utama', desc: 'Venue, catering, dan fotografer sebaiknya sudah di-booking.' },
      { label: '2 Bulan', threshold: 60, title: 'Finalisasi konsep & dekorasi', desc: 'Kunci tema dekorasi, MUA, dan mulai pre-wedding.' },
      { label: '1 Bulan', threshold: 30, title: 'Cetak & sebar undangan', desc: 'Pastikan jumlah tamu final untuk kebutuhan catering.' },
      { label: '2 Minggu', threshold: 14, title: 'Konfirmasi seluruh vendor', desc: 'Cross-check detail teknis dan jadwal hari-H dengan semua vendor.' },
      { label: 'H-7', threshold: 7, title: 'Fitting akhir & briefing tim', desc: 'Gladi bersih kecil dan briefing MC serta among tamu.' },
      { label: 'H-1', threshold: 1, title: 'Persiapan akhir', desc: 'Cek ulang seluruh perlengkapan dan istirahat cukup.' },
      { label: 'Hari H', threshold: 0, title: 'Selamat menikah!', desc: 'Nikmati momen — tim vendor menjalankan runsheet yang sudah disepakati.' },
    ];
    const list = $('#timeline-list');
    list.innerHTML = milestones.map(m => `
      <li class="timeline-item" data-threshold="${m.threshold}">
        <span class="timeline-dot"></span>
        <div>
          <span class="timeline-label">${m.label}</span>
          <div class="timeline-title">${m.title}</div>
          <div class="timeline-desc">${m.desc}</div>
        </div>
      </li>`).join('');
    const items = $$('.timeline-item', list);
    let activeMarked = false;
    milestones.forEach((m, idx) => {
      if (days <= m.threshold) items[idx].classList.add('is-done');
      else if (!activeMarked) { items[idx].classList.add('is-active'); activeMarked = true; }
    });
  }

  function renderChecklist() {
    const list = $('#checklist-list');
    list.innerHTML = plan.checklist.map((item, idx) => `
      <li class="checklist-item ${item.checked ? 'checked' : ''}" data-index="${idx}">
        <button class="checklist-check" aria-label="Tandai ${item.label}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 12l6 6L20 6" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="checklist-label">${item.label}</span>
      </li>`).join('');
    $$('.checklist-item', list).forEach(el => el.addEventListener('click', () => onChecklistToggle(el)));
    updateChecklistProgress();
  }

  async function onChecklistToggle(el) {
    const idx = parseInt(el.dataset.index, 10);
    const nextChecked = !plan.checklist[idx].checked;
    plan.checklist[idx].checked = nextChecked;
    el.classList.toggle('checked', nextChecked);
    updateChecklistProgress();
    plan.readinessScore = computeReadinessScore(plan.allocation, plan.checklist);
    renderReadinessRing(plan.readinessScore);

    try {
      await persistChecklist(plan.id, plan.checklist, plan.readinessScore);
      if (nextChecked) showToast(`"${plan.checklist[idx].label}" ditandai selesai.`, 'success');
    } catch (err) {
      plan.checklist[idx].checked = !nextChecked;
      el.classList.toggle('checked', !nextChecked);
      updateChecklistProgress();
      plan.readinessScore = computeReadinessScore(plan.allocation, plan.checklist);
      renderReadinessRing(plan.readinessScore);
      showToast(err.message || 'Gagal menyimpan checklist.', 'warning');
    }
  }

  function updateChecklistProgress() {
    const done = plan.checklist.filter(c => c.checked).length;
    const total = plan.checklist.length;
    $('#checklist-progress-label').textContent = `${done}/${total} selesai`;
    $('#checklist-progress-fill').style.width = (done / total * 100) + '%';
  }

  function renderAccordion() {
    const wrap = $('#budget-accordion');
    wrap.innerHTML = plan.allocation.map((cat, idx) => `
      <div class="accordion-item" data-index="${idx}">
        <button class="accordion-trigger" type="button">
          <div class="accordion-trigger-left">
            <span class="accordion-icon"><span class="allocation-swatch" style="background:${cat.color};width:12px;height:12px;"></span></span>
            <div>
              <div class="accordion-name">${cat.name}</div>
              <div class="accordion-meta">${formatRupiah(cat.amount)} · ${cat.pct}%</div>
            </div>
          </div>
          <div class="accordion-right">
            <span class="status-badge ${cat.selected ? 'is-selected' : ''}">${cat.selected ? 'Sudah Dipilih' : statusLabel(cat.status)}</span>
            <svg class="accordion-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </button>
        <div class="accordion-panel">
          <div class="accordion-panel-inner">
            <div class="accordion-stat"><span>Rekomendasi Budget</span><strong>${formatRupiah(cat.amount)}</strong></div>
            <div class="accordion-stat"><span>Estimasi Harga Pasar</span><strong>${formatRupiah(cat.market)}</strong></div>
            <p class="accordion-tip"><strong>Tips:</strong> ${cat.tips}</p>
          </div>
        </div>
      </div>`).join('');
    $$('.accordion-trigger', wrap).forEach(trigger => {
      trigger.addEventListener('click', () => openCategoryModal(parseInt(trigger.closest('.accordion-item').dataset.index, 10)));
    });
  }

  function statusLabel(status) {
    return { balanced: 'Sesuai', tight: 'Ketat', surplus: 'Surplus' }[status] || 'Sesuai';
  }

  /* ------------------------------------------------------------------
     8. CATEGORY DETAIL MODAL
  ------------------------------------------------------------------ */
  let activeModalIndex = null;

  function openCategoryModal(idx) {
    activeModalIndex = idx;
    const cat = plan.allocation[idx];
    $('#modal-category-name').textContent = 'Kategori Budget';
    $('#modal-category-title').textContent = cat.name;
    $('#modal-recommended').textContent = formatRupiah(cat.amount);
    $('#modal-market').textContent = formatRupiah(cat.market);
    $('#modal-tips').textContent = cat.tips;
    $('#modal-notes').textContent = cat.notes;
    $('#modal-status').textContent = cat.selected ? 'Sudah Dipilih' : statusLabel(cat.status);
    $('#modal-status').className = 'status-badge' + (cat.selected ? ' is-selected' : '');
    $('#modal-select-btn').textContent = cat.selected ? 'Batalkan Pilihan' : 'Sudah Dipilih';
    $('#modal-backdrop').classList.remove('hidden');
  }
  function closeCategoryModal() {
    $('#modal-backdrop').classList.add('hidden');
    activeModalIndex = null;
  }

  function initModal() {
    $('#modal-close').addEventListener('click', closeCategoryModal);
    $('#modal-backdrop').addEventListener('click', (e) => { if (e.target === $('#modal-backdrop')) closeCategoryModal(); });
    $('#modal-select-btn').addEventListener('click', async () => {
      if (activeModalIndex === null) return;
      const cat = plan.allocation[activeModalIndex];
      const nextSelected = !cat.selected;
      const prevAllocation = JSON.parse(JSON.stringify(plan.allocation));
      cat.selected = nextSelected;
      try {
        await persistAllocation(plan.id, plan.allocation);
        showToast(nextSelected ? `${cat.name} ditandai sebagai sudah dipilih.` : `${cat.name} dibatalkan.`, nextSelected ? 'success' : undefined);
        closeCategoryModal();
        renderAccordion();
      } catch (err) {
        plan.allocation = prevAllocation;
        showToast(err.message || 'Gagal menyimpan pilihan.', 'warning');
      }
    });
  }

  /* ------------------------------------------------------------------
     9. AI ASSISTANT PANEL — calls /api/ai-ask (Vercel serverless fn)
  ------------------------------------------------------------------ */
  function initAIPanel() {
    const panel = $('#ai-panel');
    const backdrop = $('#ai-panel-backdrop');
    $('#ai-fab').addEventListener('click', () => { panel.classList.add('open'); backdrop.classList.add('open'); });
    $('#ai-panel-close').addEventListener('click', closeAIPanel);
    backdrop.addEventListener('click', closeAIPanel);
    function closeAIPanel() { panel.classList.remove('open'); backdrop.classList.remove('open'); }

    $$('.ai-suggestion').forEach(btn => btn.addEventListener('click', () => askAI(btn.textContent)));

    $('#ai-panel-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#ai-panel-text');
      const text = input.value.trim();
      if (!text) return;
      askAI(text);
      input.value = '';
    });
  }

  async function askAI(displayText) {
    if (!plan) return;
    const body = $('#ai-panel-body');
    body.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-user">${escapeHTML(displayText)}</div>`);
    body.scrollTop = body.scrollHeight;

    const typingEl = document.createElement('div');
    typingEl.className = 'ai-msg ai-msg-bot';
    typingEl.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    body.appendChild(typingEl);
    body.scrollTop = body.scrollHeight;

    try {
      const res = await fetch('/api/ai-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, question: displayText }),
      });
      const data = await res.json();
      typingEl.textContent = data.success ? data.answer : (data.error || 'Maaf, terjadi kesalahan.');
    } catch (err) {
      typingEl.textContent = 'Maaf, saya tidak bisa menjawab saat ini. Cek koneksi internet kamu.';
    }
    body.scrollTop = body.scrollHeight;
  }

  /* ------------------------------------------------------------------
     10. NAVIGATION / HEADER
  ------------------------------------------------------------------ */
  function initNavigation() {
    $('#hero-cta').addEventListener('click', () => showView('wizard'));
    $('#cta-band-btn').addEventListener('click', () => showView('wizard'));
    $('#header-cta').addEventListener('click', () => {
      if ($('#view-dashboard').classList.contains('hidden')) showView('wizard');
      else confirmRestart();
    });
    $('#restart-btn').addEventListener('click', confirmRestart);
    $('#nav-dashboard').addEventListener('click', (e) => { e.preventDefault(); showView('dashboard'); });
    $$('.brand, [data-nav="landing"]').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); showView('landing'); }));
    window.addEventListener('scroll', () => {
      $('#site-header').style.boxShadow = window.scrollY > 8 ? 'var(--shadow-sm)' : 'none';
    });
  }

  function confirmRestart() {
    resetWizardState();
    renderWizardStep();
    showView('wizard');
    showToast('Menyusun ulang rencana baru.');
  }

  /* ------------------------------------------------------------------
     11. INIT
  ------------------------------------------------------------------ */
  window.addEventListener('error', (e) => {
    console.error('Uncaught error:', e.error || e.message);
    showToast('Terjadi error: ' + (e.error ? e.error.message : e.message), 'warning');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    showToast('Terjadi error: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)), 'warning');
  });

  async function init() {
    initWizard();
    initModal();
    initAIPanel();
    initNavigation();

    try {
      await ensureSession(); // warm up the anonymous identity early
    } catch (err) {
      showToast('Gagal terhubung ke Supabase. Cek config.js kamu.', 'warning');
    }

    setTimeout(() => { $('#app-loader').classList.add('is-hidden'); }, 500);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
