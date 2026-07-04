/* ==========================================================================
   NIKARA.AI — WEDDING BUDGET AI PLANNER
   Application logic (vanilla JS, no frameworks)
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1. "DATABASE" — replace with JSON / API responses later
  ------------------------------------------------------------------ */

  // Percentage allocation template per category (sums to 100)
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

  // Extra qualitative info per category, used in the detail accordion / modal
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

  // City multiplier applied to market price baseline (relative cost of living / vendor pricing)
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
  const state = {
    groom: '', bride: '', city: '', weddingDate: '', budget: 0,
    guests: 200, concept: '',
    allocation: [],       // computed from ALLOCATION_TEMPLATE * budget
    checklist: [],        // [{ label, checked }]
    currentStep: 1,
    totalSteps: 6,
  };

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
    const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    return diff;
  }

  function animateCounter(el, endValue, opts) {
    opts = opts || {};
    const duration = opts.duration || 900;
    const format = opts.format || (v => Math.round(v).toLocaleString('id-ID'));
    const start = 0;
    const startTime = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = start + (endValue - start) * eased;
      el.textContent = format(value);
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

    // Budget input auto-format
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

    // Guest slider <-> number sync
    const slider = $('#input-guests-slider');
    const number = $('#input-guests-number');
    slider.addEventListener('input', () => { number.value = slider.value; });
    number.addEventListener('input', () => {
      let v = parseInt(number.value, 10) || 0;
      if (v > 1000) slider.value = 1000; else slider.value = v;
    });

    // Concept selection
    $$('.concept-card').forEach(card => {
      card.addEventListener('click', () => {
        $$('.concept-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.concept = card.dataset.concept;
      });
    });

    // Date input: prevent past dates
    const today = new Date().toISOString().split('T')[0];
    $('#input-date').setAttribute('min', today);
  }

  function resetWizardState() {
    state.currentStep = 1;
    $('#wizard-form').reset();
    $$('.concept-card').forEach(c => c.classList.remove('active'));
    $$('.chip').forEach(c => c.classList.remove('active'));
    state.concept = '';
  }

  function renderWizardStep() {
    $$('.wizard-step').forEach(p => p.classList.toggle('active', parseInt(p.dataset.stepPanel, 10) === state.currentStep));
    $$('.wp-step').forEach(s => {
      const n = parseInt(s.dataset.step, 10);
      s.classList.toggle('active', n === state.currentStep);
      s.classList.toggle('done', n < state.currentStep);
    });
    $('#wizard-progress-fill').style.width = ((state.currentStep - 1) / (state.totalSteps - 1) * 100) + '%';
    $('#wizard-back').style.visibility = state.currentStep === 1 ? 'hidden' : 'visible';
    $('#wizard-next').classList.toggle('hidden', state.currentStep === state.totalSteps);
    $('#wizard-submit').classList.toggle('hidden', state.currentStep !== state.totalSteps);
  }

  function validateStep(step) {
    const errorEl = $('#error-step' + step);
    errorEl.textContent = '';
    switch (step) {
      case 1: {
        const groom = $('#input-name-groom').value.trim();
        const bride = $('#input-name-bride').value.trim();
        if (!groom || !bride) { errorEl.textContent = 'Mohon isi kedua nama mempelai.'; return false; }
        state.groom = groom; state.bride = bride;
        return true;
      }
      case 2: {
        const city = $('#input-city').value;
        if (!city) { errorEl.textContent = 'Mohon pilih kota acara.'; return false; }
        state.city = city;
        return true;
      }
      case 3: {
        const date = $('#input-date').value;
        if (!date) { errorEl.textContent = 'Mohon pilih tanggal pernikahan.'; return false; }
        if (daysUntil(date) < 0) { errorEl.textContent = 'Tanggal tidak boleh di masa lalu.'; return false; }
        state.weddingDate = date;
        return true;
      }
      case 4: {
        const raw = parseRupiahInput($('#input-budget').value);
        if (!raw || raw < 5000000) { errorEl.textContent = 'Mohon masukkan budget minimal Rp5.000.000.'; return false; }
        state.budget = raw;
        return true;
      }
      case 5: {
        const guests = parseInt($('#input-guests-number').value, 10);
        if (!guests || guests < 10) { errorEl.textContent = 'Mohon masukkan jumlah tamu yang valid.'; return false; }
        state.guests = guests;
        return true;
      }
      case 6: {
        if (!state.concept) { errorEl.textContent = 'Mohon pilih satu konsep pernikahan.'; return false; }
        return true;
      }
      default: return true;
    }
  }

  function onWizardNext() {
    if (!validateStep(state.currentStep)) return;
    if (state.currentStep < state.totalSteps) {
      state.currentStep++;
      renderWizardStep();
    }
  }
  function onWizardBack() {
    if (state.currentStep > 1) {
      state.currentStep--;
      renderWizardStep();
    }
  }

  function onWizardSubmit() {
    if (!validateStep(6)) return;
    runGeneratingSequence();
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
    const interval = setInterval(() => {
      i++;
      bar.style.width = Math.min(100, (i / messages.length) * 100) + '%';
      if (i < messages.length) {
        stepText.textContent = messages[i];
      } else {
        clearInterval(interval);
        setTimeout(() => {
          overlay.classList.add('hidden');
          buildPlan();
          showView('dashboard');
          showToast('Rencana pernikahan Anda berhasil dibuat.', 'success');
        }, 350);
      }
    }, 480);
  }

  /* ------------------------------------------------------------------
     6. PLAN GENERATION (computes derived data from wizard inputs)
  ------------------------------------------------------------------ */
  function buildPlan() {
    state.allocation = ALLOCATION_TEMPLATE.map(cat => {
      const amount = Math.round(state.budget * (cat.pct / 100));
      const multiplier = CITY_MULTIPLIER[state.city] || 1;
      const baselinePerGuest = { venue: 90000, catering: 120000 }[cat.key] || null;
      let market;
      if (baselinePerGuest) {
        market = Math.round(baselinePerGuest * state.guests * multiplier);
      } else {
        market = Math.round(amount * (0.9 + Math.random() * 0.25));
      }
      let status = 'balanced';
      if (amount < market * 0.85) status = 'tight';
      else if (amount > market * 1.15) status = 'surplus';
      return {
        ...cat, amount, market,
        status,
        selected: false,
        ...CATEGORY_INFO[cat.key],
      };
    });

    state.checklist = CHECKLIST_TEMPLATE.map(label => ({ label, checked: false }));

    renderDashboard();
  }

  /* ------------------------------------------------------------------
     7. DASHBOARD RENDER
  ------------------------------------------------------------------ */
  let allocationChartInstance = null;

  function renderDashboard() {
    $('#dash-title').textContent = `${state.groom} & ${state.bride}`;
    $('#dash-eyebrow').textContent = `Rencana Pernikahan — ${state.concept}`;

    // Summary cards
    animateCounter($('#summary-budget'), state.budget, { format: v => formatRupiah(v) });
    $('#summary-city').textContent = state.city;
    animateCounter($('#summary-guests'), state.guests, { format: v => Math.round(v).toLocaleString('id-ID') + ' tamu' });
    $('#summary-concept').textContent = state.concept;
    const days = daysUntil(state.weddingDate);
    animateCounter($('#summary-days'), Math.max(days, 0), { format: v => Math.round(v).toLocaleString('id-ID') + ' hari' });
    $('#summary-date').textContent = new Date(state.weddingDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    // Readiness score
    const score = computeReadinessScore();
    renderReadinessRing(score);

    renderAllocation();
    renderAIRecommendation();
    renderTimeline(days);
    renderChecklist();
    renderAccordion();
  }

  function computeReadinessScore() {
    const checkedCount = state.checklist.filter(c => c.checked).length;
    const checklistScore = (checkedCount / state.checklist.length) * 50;
    const balanced = state.allocation.filter(a => a.status !== 'tight').length;
    const budgetScore = (balanced / state.allocation.length) * 50;
    return Math.round(checklistScore + budgetScore);
  }

  function renderReadinessRing(score) {
    const circumference = 2 * Math.PI * 52;
    const ring = $('#readiness-ring');
    ring.style.strokeDasharray = circumference;
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = circumference - (circumference * score / 100);
    });
    animateCounter($('#readiness-number'), score, { format: v => Math.round(v) + '%' });
  }

  function renderAllocation() {
    animateCounter($('#allocation-total'), state.budget, { format: v => formatRupiah(v) });

    const list = $('#allocation-list');
    list.innerHTML = state.allocation.map(cat => `
      <li class="allocation-item">
        <span class="allocation-swatch" style="background:${cat.color}"></span>
        <span class="allocation-item-name">${cat.name}</span>
        <span class="allocation-item-pct">${cat.pct}%</span>
        <span class="allocation-item-value">${formatRupiah(cat.amount)}</span>
      </li>
    `).join('');

    const ctx = $('#allocation-chart').getContext('2d');
    if (allocationChartInstance) allocationChartInstance.destroy();
    allocationChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: state.allocation.map(c => c.name),
        datasets: [{
          data: state.allocation.map(c => c.amount),
          backgroundColor: state.allocation.map(c => c.color),
          borderWidth: 3,
          borderColor: '#ffffff',
          hoverOffset: 6,
        }],
      },
      options: {
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${formatRupiah(item.parsed)}`,
            },
          },
        },
        animation: { animateRotate: true, duration: 900 },
      },
    });
  }

  function renderAIRecommendation() {
    const tightCats = state.allocation.filter(a => a.status === 'tight');
    const days = daysUntil(state.weddingDate);
    const budgetStr = formatRupiah(state.budget);

    let verdict;
    if (tightCats.length === 0) {
      verdict = `Dengan budget ${budgetStr} untuk ${state.guests} tamu di ${state.city} dan waktu persiapan ${days} hari, alokasi budget Anda masih realistis dibandingkan harga pasar setempat.`;
    } else {
      const names = tightCats.map(c => c.name).join(', ');
      verdict = `Dengan budget ${budgetStr} untuk ${state.guests} tamu di ${state.city} dan waktu persiapan ${days} hari, alokasi Anda cukup ketat pada kategori ${names}. Pertimbangkan menggeser dana dari kategori yang surplus.`;
    }
    $('#ai-reco-text').textContent = verdict;

    const priorities = getPriorityActions();
    $('#ai-reco-priorities').innerHTML = priorities.map(p => `<span>${p}</span>`).join('');
  }

  function getPriorityActions() {
    const days = daysUntil(state.weddingDate);
    if (days > 60) return ['Booking Venue', 'Survey Catering'];
    if (days > 30) return ['Pilih Dekorasi', 'Booking MUA', 'Undangan'];
    if (days > 7) return ['Cetak Undangan', 'Konfirmasi Vendor', 'Fitting Busana'];
    return ['Konfirmasi Final ke Semua Vendor', 'Siapkan Runsheet Hari-H'];
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
    list.innerHTML = milestones.map(m => {
      const isDone = days < m.threshold;
      const isActive = !isDone && (days <= m.threshold + (milestones[milestones.indexOf(m) - 1]?.threshold - m.threshold || 30));
      let cls = '';
      if (days <= m.threshold) cls = 'is-done';
      else cls = '';
      // Determine current stage: first milestone whose threshold <= days is "active" (next up)
      return { m, cls };
    }).map(({ m }, idx, arr) => {
      let stateCls = '';
      if (days <= m.threshold) stateCls = 'is-done';
      return `
      <li class="timeline-item" data-threshold="${m.threshold}">
        <span class="timeline-dot"></span>
        <div>
          <span class="timeline-label">${m.label}</span>
          <div class="timeline-title">${m.title}</div>
          <div class="timeline-desc">${m.desc}</div>
        </div>
      </li>`;
    }).join('');

    // Mark done / active based on days remaining
    const items = $$('.timeline-item', list);
    let activeMarked = false;
    milestones.forEach((m, idx) => {
      const el = items[idx];
      if (days <= m.threshold) {
        el.classList.add('is-done');
      } else if (!activeMarked) {
        el.classList.add('is-active');
        activeMarked = true;
      }
    });
  }

  function renderChecklist() {
    const list = $('#checklist-list');
    list.innerHTML = state.checklist.map((item, idx) => `
      <li class="checklist-item ${item.checked ? 'checked' : ''}" data-index="${idx}">
        <button class="checklist-check" aria-label="Tandai ${item.label}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 12l6 6L20 6" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="checklist-label">${item.label}</span>
      </li>
    `).join('');

    $$('.checklist-item', list).forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        state.checklist[idx].checked = !state.checklist[idx].checked;
        el.classList.toggle('checked');
        updateChecklistProgress();
        renderReadinessRing(computeReadinessScore());
        if (state.checklist[idx].checked) showToast(`"${state.checklist[idx].label}" ditandai selesai.`, 'success');
      });
    });

    updateChecklistProgress();
  }

  function updateChecklistProgress() {
    const done = state.checklist.filter(c => c.checked).length;
    const total = state.checklist.length;
    $('#checklist-progress-label').textContent = `${done}/${total} selesai`;
    $('#checklist-progress-fill').style.width = (done / total * 100) + '%';
  }

  function renderAccordion() {
    const wrap = $('#budget-accordion');
    wrap.innerHTML = state.allocation.map((cat, idx) => `
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
      </div>
    `).join('');

    $$('.accordion-trigger', wrap).forEach(trigger => {
      trigger.addEventListener('click', () => {
        const item = trigger.closest('.accordion-item');
        const idx = parseInt(item.dataset.index, 10);
        openCategoryModal(idx);
      });
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
    const cat = state.allocation[idx];
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
    $('#modal-select-btn').addEventListener('click', () => {
      if (activeModalIndex === null) return;
      const cat = state.allocation[activeModalIndex];
      cat.selected = !cat.selected;
      showToast(cat.selected ? `${cat.name} ditandai sebagai sudah dipilih.` : `${cat.name} dibatalkan.`, cat.selected ? 'success' : undefined);
      closeCategoryModal();
      renderAccordion();
    });
  }

  /* ------------------------------------------------------------------
     9. AI ASSISTANT PANEL
  ------------------------------------------------------------------ */
  function initAIPanel() {
    const panel = $('#ai-panel');
    const backdrop = $('#ai-panel-backdrop');
    $('#ai-fab').addEventListener('click', () => {
      panel.classList.add('open');
      backdrop.classList.add('open');
    });
    $('#ai-panel-close').addEventListener('click', closeAIPanel);
    backdrop.addEventListener('click', closeAIPanel);
    function closeAIPanel() {
      panel.classList.remove('open');
      backdrop.classList.remove('open');
    }

    $$('.ai-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        askAI(btn.textContent, btn.dataset.q);
      });
    });

    $('#ai-panel-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#ai-panel-text');
      const text = input.value.trim();
      if (!text) return;
      askAI(text, classifyQuestion(text));
      input.value = '';
    });
  }

  function classifyQuestion(text) {
    const t = text.toLowerCase();
    if (t.includes('cukup')) return 'cukup';
    if (t.includes('hemat') || t.includes('catering')) return 'hemat-catering';
    if (t.includes('prioritas')) return 'prioritas';
    if (t.includes('turun') || t.includes('80 juta') || t.includes('80juta')) return 'turun-budget';
    return 'default';
  }

  function askAI(displayText, key) {
    const body = $('#ai-panel-body');
    body.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-user">${escapeHTML(displayText)}</div>`);
    body.scrollTop = body.scrollHeight;

    const typingEl = document.createElement('div');
    typingEl.className = 'ai-msg ai-msg-bot';
    typingEl.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    body.appendChild(typingEl);
    body.scrollTop = body.scrollHeight;

    setTimeout(() => {
      typingEl.textContent = generateAIAnswer(key);
      body.scrollTop = body.scrollHeight;
    }, 700 + Math.random() * 500);
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function generateAIAnswer(key) {
    const days = daysUntil(state.weddingDate);
    const tight = state.allocation.filter(a => a.status === 'tight');
    switch (key) {
      case 'cukup': {
        if (tight.length === 0) {
          return `Berdasarkan alokasi saat ini, budget ${formatRupiah(state.budget)} Anda untuk ${state.guests} tamu di ${state.city} sudah realistis — seluruh kategori berada dalam rentang harga pasar yang wajar.`;
        }
        return `Budget Anda cukup ketat pada ${tight.length} kategori (${tight.map(c => c.name).join(', ')}). Saran saya, geser 5–10% dari kategori yang surplus untuk menutup selisihnya.`;
      }
      case 'hemat-catering': {
        const catering = state.allocation.find(c => c.key === 'catering');
        return `Untuk catering dengan alokasi ${formatRupiah(catering.amount)}, Anda bisa menghemat dengan sistem prasmanan dibanding standing party, dan kunci jumlah tamu final sebelum DP agar tidak ada biaya tambahan per pax.`;
      }
      case 'prioritas': {
        const priorities = getPriorityActions();
        return `Dengan sisa waktu ${days} hari menuju hari-H, prioritas utama Anda minggu ini adalah: ${priorities.join(', ')}.`;
      }
      case 'turun-budget': {
        const newBudget = 80000000;
        const diff = state.budget - newBudget;
        const direction = diff > 0 ? 'penurunan' : 'kenaikan';
        return `Jika budget turun menjadi Rp80.000.000 (${direction} ${formatRupiah(Math.abs(diff))} dari saat ini), saya sarankan menurunkan alokasi dekorasi dan entertainment terlebih dahulu, karena venue dan catering paling sulit dikompromikan untuk ${state.guests} tamu.`;
      }
      default:
        return `Saya menganalisis rencana Anda untuk ${state.guests} tamu di ${state.city} dengan budget ${formatRupiah(state.budget)}. Coba tanyakan hal spesifik seperti alokasi kategori tertentu atau skenario perubahan budget agar saya bisa memberi rekomendasi yang lebih tajam.`;
    }
  }

  /* ------------------------------------------------------------------
     10. NAVIGATION / HEADER / MISC
  ------------------------------------------------------------------ */
  function initNavigation() {
    $('#hero-cta').addEventListener('click', () => showView('wizard'));
    $('#cta-band-btn').addEventListener('click', () => showView('wizard'));
    $('#header-cta').addEventListener('click', () => {
      if ($('#view-dashboard').classList.contains('hidden')) {
        showView('wizard');
      } else {
        confirmRestart();
      }
    });
    $('#restart-btn').addEventListener('click', confirmRestart);
    $('#nav-dashboard').addEventListener('click', (e) => { e.preventDefault(); showView('dashboard'); });
    $$('.brand, [data-nav="landing"]').forEach(el => {
      el.addEventListener('click', (e) => { e.preventDefault(); showView('landing'); });
    });

    // Header shadow on scroll
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
  function init() {
    initWizard();
    initModal();
    initAIPanel();
    initNavigation();

    setTimeout(() => {
      $('#app-loader').classList.add('is-hidden');
    }, 500);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
