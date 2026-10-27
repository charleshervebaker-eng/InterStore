(() => {
  'use strict';

  const CATEGORIES = ['Tools', 'Games', 'Social', 'Productivity', 'Education', 'Media', 'Other'];
  const $ = (s) => document.querySelector(s);

  const grid = $('#grid');
  const empty = $('#empty');
  const chips = $('#chips');
  const search = $('#search');
  const modal = $('#modal');
  const form = $('#form');
  const apkInput = $('#apk');
  const drop = $('#drop');
  const errorEl = $('#error');
  const progress = $('#progress');
  const bar = $('#bar');
  const submitBtn = $('#submit');
  const toastEl = $('#toast');

  const appCache = {};
  let activeCategory = 'All';
  let query = '';
  let debounce;
  let toastTimer;

  $('#year').textContent = new Date().getFullYear();

  // ---------- helpers ----------
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtSize = (b) => {
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  };

  const hue = (str) => {
    let h = 0;
    for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  };

  const timeAgo = (ts) => {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  };

  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 3200);
  };

  // ---------- UI setup ----------
  const renderChips = () => {
    chips.innerHTML = ['All', ...CATEGORIES]
      .map((c) => `<button class="chip ${c === activeCategory ? 'active' : ''}" data-cat="${c}" type="button">${c}</button>`)
      .join('');
  };

  $('#category').innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join('');
  renderChips();

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activeCategory = btn.dataset.cat;
    renderChips();
    load();
  });

  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      query = search.value.trim();
      load();
    }, 250);
  });

  // ---------- data ----------
  const ratingLine = (a) =>
    a.reviewCount
      ? `<div class="rating"><span class="star">★</span> ${a.rating.toFixed(1)} <span class="muted">(${a.reviewCount})</span></div>`
      : '<div class="rating muted">No reviews yet</div>';

  const card = (a, i) => {
    const h = hue(a.name);
    const icon = a.icon
      ? `<img src="${esc(a.icon)}" alt="" loading="lazy" />`
      : esc(a.name.charAt(0).toUpperCase());
    const bg = a.icon ? '' : `style="background:linear-gradient(135deg,hsl(${h} 80% 60%),hsl(${(h + 50) % 360} 80% 50%))"`;
    return `
      <article class="card" data-id="${esc(a.id)}" style="animation-delay:${Math.min(i, 10) * 40}ms">
        <div class="card-top">
          <div class="icon" ${bg}>${icon}</div>
          <div>
            <h3>${esc(a.name)}</h3>
            <div class="dev">by ${esc(a.developer)}</div>
            ${ratingLine(a)}
          </div>
        </div>
        <p class="desc">${a.description ? esc(a.description) : 'No description provided.'}</p>
        <div class="meta">
          <span class="tag">${esc(a.category)}</span>
          <span class="tag">v${esc(a.version)}</span>
          <span class="tag">${fmtSize(a.size)}</span>
          <span class="tag">${timeAgo(a.createdAt)}</span>
        </div>
        <div class="card-foot">
          <span class="dl-count">${a.downloads} download${a.downloads === 1 ? '' : 's'}</span>
          <a class="btn btn-primary" href="/download/${esc(a.id)}" download>Download</a>
        </div>
      </article>`;
  };

  const skeletons = () => {
    grid.innerHTML = Array.from({ length: 3 }, () => '<div class="skeleton"></div>').join('');
  };

  const renderStats = (list) => {
    const dl = list.reduce((n, a) => n + a.downloads, 0);
    const devs = new Set(list.map((a) => a.developer.toLowerCase())).size;
    $('#stats').innerHTML = `
      <div><b>${list.length}</b>apps</div>
      <div><b>${devs}</b>developers</div>
      <div><b>${dl}</b>downloads</div>`;
  };

  let firstLoad = true;
  async function load() {
    if (firstLoad) skeletons();
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (activeCategory !== 'All') params.set('category', activeCategory);
      const res = await fetch('/api/apps?' + params);
      if (!res.ok) throw new Error();
      const list = await res.json();
      list.forEach((a) => { appCache[a.id] = a; });
      grid.innerHTML = list.map(card).join('');
      empty.hidden = list.length > 0;
      if (firstLoad || (!query && activeCategory === 'All')) renderStats(list);
    } catch {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('h3').textContent = 'Could not load apps';
      empty.querySelector('p').textContent = 'Please check your connection and try again.';
    }
    firstLoad = false;
  }

  // ---------- modal ----------
  const openModal = () => {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#name').focus();
  };
  const closeModal = () => {
    modal.hidden = true;
    document.body.style.overflow = '';
  };
  const resetForm = () => {
    form.reset();
    drop.classList.remove('has-file');
    $('#dropText').textContent = 'Drop your APK here or click to browse';
    $('#dropSub').textContent = 'Up to 200 MB';
    errorEl.hidden = true;
    progress.hidden = true;
    bar.style.width = '0';
  };

  // ---------- password gate ----------
  const gate = $('#gate');
  const gateForm = $('#gateForm');
  const gatePass = $('#gatePass');
  const gateError = $('#gateError');
  const gateSubmit = $('#gateSubmit');

  const getPass = () => { try { return sessionStorage.getItem('is_pw') || ''; } catch { return ''; } };
  const setPass = (v) => { try { v ? sessionStorage.setItem('is_pw', v) : sessionStorage.removeItem('is_pw'); } catch {} };

  const openGate = () => {
    gate.hidden = false;
    gateError.hidden = true;
    gatePass.value = '';
    document.body.style.overflow = 'hidden';
    gatePass.focus();
  };
  const closeGate = () => {
    gate.hidden = true;
    document.body.style.overflow = '';
  };

  const requestUpload = () => (getPass() ? openModal() : openGate());

  gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = gatePass.value;
    if (!pw) return;
    gateSubmit.disabled = true;
    gateError.hidden = true;
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPass(pw);
        closeGate();
        openModal();
      } else {
        gateError.textContent = data.error || 'Wrong password.';
        gateError.hidden = false;
      }
    } catch {
      gateError.textContent = 'Network error. Please try again.';
      gateError.hidden = false;
    }
    gateSubmit.disabled = false;
  });

  $('#openUpload').addEventListener('click', requestUpload);
  $('#openUpload2').addEventListener('click', requestUpload);
  gate.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeGate(); });
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modal.hidden) closeModal();
    if (!gate.hidden) closeGate();
  });

  // drag & drop
  const showFile = () => {
    const f = apkInput.files[0];
    if (!f) return;
    drop.classList.add('has-file');
    $('#dropText').textContent = f.name;
    $('#dropSub').textContent = fmtSize(f.size);
    const nameField = $('#name');
    if (!nameField.value) nameField.value = f.name.replace(/\.apk$/i, '').replace(/[-_]+/g, ' ');
  };
  apkInput.addEventListener('change', showFile);
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    apkInput.files = dt.files;
    showFile();
  });

  // ---------- upload ----------
  const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const apk = apkInput.files[0];
    if (!apk) return showError('Please choose an APK file.');
    if (!/\.apk$/i.test(apk.name)) return showError('Only .apk files are allowed. AAB files must be converted first.');
    if (!$('#name').value.trim() || !$('#developer').value.trim()) return showError('App name and developer are required.');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/apps');
    xhr.setRequestHeader('x-upload-password', getPass());
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading…';
    progress.hidden = false;

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) bar.style.width = (ev.loaded / ev.total) * 100 + '%';
    };
    xhr.onload = () => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish';
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        closeModal();
        resetForm();
        toast('Your app is live 🎉');
        load();
        document.getElementById('apps').scrollIntoView({ behavior: 'smooth' });
      } else if (xhr.status === 401) {
        setPass('');
        closeModal();
        openGate();
        gateError.textContent = 'Password rejected. Please enter it again.';
        gateError.hidden = false;
        progress.hidden = true;
      } else {
        showError(data.error || 'Upload failed. Please try again.');
        progress.hidden = true;
      }
    };
    xhr.onerror = () => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish';
      progress.hidden = true;
      showError('Network error. Please try again.');
    };
    xhr.send(new FormData(form));
  });

  // ---------- app details + reviews ----------
  const detail = $('#detail');
  const detailBody = $('#detailBody');
  let currentId = null;
  let pickedRating = 0;

  const starsText = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

  const closeDetail = () => {
    detail.hidden = true;
    currentId = null;
    document.body.style.overflow = '';
  };

  async function renderDetail() {
    const a = appCache[currentId];
    if (!a) return;

    let data = { avg: 0, count: 0, reviews: [] };
    try {
      const r = await fetch(`/api/apps/${encodeURIComponent(currentId)}/reviews`);
      if (r.ok) data = await r.json();
    } catch {}
    if (currentId !== a.id) return; // closed or switched while loading

    const h = hue(a.name);
    const iconBg = a.icon ? '' : `style="background:linear-gradient(135deg,hsl(${h} 80% 60%),hsl(${(h + 50) % 360} 80% 50%))"`;
    const iconInner = a.icon ? `<img src="${esc(a.icon)}" alt="" />` : esc(a.name.charAt(0).toUpperCase());
    const owner = !!getPass();

    const summary = data.count
      ? `<span class="d-stars">${starsText(data.avg)}</span> ${data.avg.toFixed(1)} <span class="muted">(${data.count} review${data.count === 1 ? '' : 's'})</span>`
      : '<span class="muted">No reviews yet</span>';

    const reviewsHtml = data.reviews.length
      ? data.reviews.map((r) => `
          <div class="review">
            <div class="review-top">
              <strong>${esc(r.name)}</strong>
              <span class="d-stars">${starsText(r.rating)}</span>
              <span class="muted small">${timeAgo(r.createdAt)}</span>
              ${owner ? `<button class="del-review" type="button" data-del="${esc(r.id)}">Delete</button>` : ''}
            </div>
            ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
          </div>`).join('')
      : '<p class="no-reviews">Be the first to review this app.</p>';

    detailBody.innerHTML = `
      <div class="d-head">
        <div class="icon" ${iconBg}>${iconInner}</div>
        <div>
          <h2>${esc(a.name)}</h2>
          <div class="dev muted small">by ${esc(a.developer)} · v${esc(a.version)} · ${fmtSize(a.size)}</div>
          <div class="rating">${summary}</div>
        </div>
      </div>
      <p class="d-desc">${a.description ? esc(a.description) : 'No description provided.'}</p>
      <a class="btn btn-primary btn-block" href="/download/${esc(a.id)}" download>Download</a>

      <h3 class="d-sub">Write a review</h3>
      <form id="reviewForm" novalidate>
        <div class="stars-input" id="starsInput" role="radiogroup" aria-label="Rating">
          ${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="star-btn ${v <= pickedRating ? 'on' : ''}" data-v="${v}" aria-label="${v} star${v > 1 ? 's' : ''}">★</button>`).join('')}
        </div>
        <div class="field"><input name="name" maxlength="40" placeholder="Your name (optional)" /></div>
        <div class="field"><textarea name="comment" maxlength="500" rows="3" placeholder="Share your experience"></textarea></div>
        <p class="error" id="reviewError" role="alert" hidden></p>
        <button class="btn btn-ghost btn-block" type="submit">Post review</button>
      </form>

      <h3 class="d-sub">Reviews</h3>
      <div class="reviews">${reviewsHtml}</div>`;
  }

  function openDetail(id) {
    if (!appCache[id]) return;
    currentId = id;
    pickedRating = 0;
    detail.hidden = false;
    document.body.style.overflow = 'hidden';
    detailBody.innerHTML = '<div class="skeleton"></div>';
    renderDetail();
  }

  grid.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // let the Download link work
    const c = e.target.closest('.card');
    if (c) openDetail(c.dataset.id);
  });

  detail.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeDetail();

    const star = e.target.closest('.star-btn');
    if (star) {
      pickedRating = Number(star.dataset.v);
      detailBody.querySelectorAll('.star-btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= pickedRating));
      return;
    }

    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('Delete this review?')) return;
      const res = await fetch(`/api/reviews/${encodeURIComponent(del.dataset.del)}`, {
        method: 'DELETE',
        headers: { 'x-upload-password': getPass() }
      });
      if (res.status === 401) { setPass(''); toast('Password rejected. Unlock again from Upload.'); }
      await renderDetail();
      load();
    }
  });

  detail.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#reviewError');
    err.hidden = true;
    if (!pickedRating) { err.textContent = 'Pick a star rating first.'; err.hidden = false; return; }

    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(currentId)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: pickedRating, name: f.name.value, comment: f.comment.value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = data.error || 'Could not post review.';
        err.hidden = false;
        btn.disabled = false;
        return;
      }
      pickedRating = 0;
      toast('Thanks for your review!');
      await renderDetail();
      load();
    } catch {
      err.textContent = 'Network error. Please try again.';
      err.hidden = false;
      btn.disabled = false;
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detail.hidden) closeDetail(); });

  load();
})();
