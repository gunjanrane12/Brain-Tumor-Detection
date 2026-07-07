/* jshint esversion: 6 */
(function () {
  'use strict';

  // ── DOM refs ────────────────────────────────────────────────
  const dropZone       = document.getElementById('drop-zone');
  const fileInput      = document.getElementById('file-input');
  const browseBtn      = document.getElementById('browse-btn');
  const dropContent    = document.getElementById('drop-content');
  const previewContent = document.getElementById('preview-content');
  const previewImg     = document.getElementById('preview-img');
  const previewName    = document.getElementById('preview-name');
  const removeBtn      = document.getElementById('remove-btn');
  const analyzeBtn     = document.getElementById('analyze-btn');
  const btnText        = analyzeBtn.querySelector('.btn-text');
  const btnSpinner     = analyzeBtn.querySelector('.btn-spinner');
  const btnArrow       = analyzeBtn.querySelector('.btn-arrow');
  const uploadForm     = document.getElementById('upload-form');

  const resultPanel    = document.getElementById('result-panel');
  const resultEmpty    = document.getElementById('result-empty');
  const resultLoading  = document.getElementById('result-loading');
  const resultContent  = document.getElementById('result-content');
  const resultError    = document.getElementById('result-error');

  const resultIcon     = document.getElementById('result-icon');
  const resultName     = document.getElementById('result-name');
  const confValue      = document.getElementById('confidence-value');
  const confBar        = document.getElementById('confidence-bar');
  const allScoresEl    = document.getElementById('all-scores');
  const infoDesc       = document.getElementById('info-description');
  const infoRec        = document.getElementById('info-recommendation');
  const resetBtn       = document.getElementById('reset-btn');
  const retryBtn       = document.getElementById('retry-btn');
  const errorMsg       = document.getElementById('error-message');

  // ── Sample refs ─────────────────────────────────────────────
  const sampleGoBtn      = document.getElementById('sample-go-btn');
  const sampleNotice     = document.getElementById('sample-notice');
  const sampleNoticeText = document.getElementById('sample-notice-text');
  const trueLabelTag     = document.getElementById('true-label-tag');
  const trueLabelText    = document.getElementById('true-label-text');
  const samplePills      = document.querySelectorAll('.sample-pill');

  let currentFile      = null;
  let currentTrueLabel = null;  // set when a dataset sample is loaded
  let selectedLabel    = '';    // filter label for /random-sample

  // ── Colour map ───────────────────────────────────────────────
  const CLASS_COLORS = {
    glioma:     '#ef4444',
    meningioma: '#f97316',
    no_tumor:   '#22c55e',
    pituitary:  '#a855f7',
  };

  // ── Pill selection ───────────────────────────────────────────
  samplePills.forEach(pill => {
    pill.addEventListener('click', () => {
      samplePills.forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
      pill.classList.add('active');
      pill.setAttribute('aria-pressed', 'true');
      selectedLabel = pill.dataset.label;
    });
  });

  // ── Load Sample button ───────────────────────────────────────
  sampleGoBtn.addEventListener('click', loadSample);

  async function loadSample() {
    sampleGoBtn.disabled = true;
    sampleGoBtn.classList.add('loading');
    sampleNotice.hidden = true;

    const url = '/random-sample' + (selectedLabel ? `?label=${encodeURIComponent(selectedLabel)}` : '');

    try {
      const res  = await fetch(url);
      const data = await res.json();

      if (!res.ok || !data.success) {
        sampleNoticeText.innerHTML = data.error || 'Could not load sample.';
        sampleNotice.hidden = false;
        return;
      }

      // Convert base64 → Blob → File
      const byteStr = atob(data.image_b64);
      const buf = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) buf[i] = byteStr.charCodeAt(i);
      const blob = new Blob([buf], { type: data.mime });
      const file = new File([blob], data.filename, { type: data.mime });

      // Store true label
      currentTrueLabel = data.display_label;

      // Show in drop zone
      handleFile(file);

      // Scroll to upload zone
      document.getElementById('upload-section').scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Auto-predict after a short delay (let scroll/preview settle)
      setTimeout(() => {
        uploadForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }, 400);

    } catch (err) {
      sampleNoticeText.textContent = 'Network error: ' + err.message;
      sampleNotice.hidden = false;
    } finally {
      sampleGoBtn.disabled = false;
      sampleGoBtn.classList.remove('loading');
    }
  }

  // ── File selection ───────────────────────────────────────────
  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showError('Please select a valid image file.');
      return;
    }
    currentFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewName.textContent = file.name;
      dropContent.hidden = true;
      previewContent.hidden = false;
      analyzeBtn.disabled = false;
      showEmpty();
    };
    reader.readAsDataURL(file);
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      currentTrueLabel = null;  // manual upload — no true label
      handleFile(fileInput.files[0]);
    }
  });

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  // Drag-and-drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      currentTrueLabel = null;
      fileInput.files = e.dataTransfer.files;
      handleFile(file);
    }
  });

  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  removeBtn.addEventListener('click', resetUpload);

  function resetUpload() {
    currentFile = null;
    currentTrueLabel = null;
    fileInput.value = '';
    previewImg.src = '';
    previewContent.hidden = true;
    dropContent.hidden = false;
    analyzeBtn.disabled = true;
    showEmpty();
    resultPanel.className = 'result-panel';
  }

  // ── UI state helpers ─────────────────────────────────────────
  function showEmpty()   { setState(resultEmpty, resultLoading, resultContent, resultError); }
  function showLoading() { setState(resultLoading, resultEmpty, resultContent, resultError); }
  function showResult()  { setState(resultContent, resultEmpty, resultLoading, resultError); }
  function showErr()     { setState(resultError, resultEmpty, resultLoading, resultContent); }

  function setState(show, ...hide) {
    show.hidden = false;
    hide.forEach(el => el.hidden = true);
    resultPanel.style.alignItems = (show === resultContent) ? 'flex-start' : 'center';
  }

  function setAnalyzing(loading) {
    analyzeBtn.disabled = loading;
    btnText.textContent = loading ? 'Analyzing…' : 'Analyze Scan';
    btnSpinner.hidden = !loading;
    btnArrow.hidden = loading;
  }

  // ── Submit ───────────────────────────────────────────────────
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentFile) return;

    showLoading();
    setAnalyzing(true);

    const formData = new FormData();
    formData.append('file', currentFile);

    try {
      const res  = await fetch('/predict', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Prediction failed');
      renderResult(data);
    } catch (err) {
      showError(err.message || 'Network error. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  });

  // ── Render Result ────────────────────────────────────────────
  function renderResult(data) {
    // True-label tag (dataset samples only)
    if (currentTrueLabel) {
      trueLabelText.textContent = currentTrueLabel;
      trueLabelTag.hidden = false;
    } else {
      trueLabelTag.hidden = true;
    }

    // Header
    resultIcon.textContent = data.icon;
    resultName.textContent = data.display_name;
    resultName.style.color = data.color;

    // Confidence bar
    confValue.textContent = data.confidence.toFixed(1) + '%';
    confValue.style.color = data.color;
    confBar.style.width = '0%';
    setTimeout(() => {
      confBar.style.width = data.confidence + '%';
      confBar.style.background = `linear-gradient(90deg, ${data.color}99, ${data.color})`;
      const track = confBar.parentElement;
      track.setAttribute('aria-valuenow', Math.round(data.confidence));
    }, 60);

    // All scores
    allScoresEl.innerHTML = '';
    const sortedScores = Object.entries(data.all_scores).sort((a, b) => b[1] - a[1]);
    sortedScores.forEach(([cls, pct]) => {
      const color       = CLASS_COLORS[cls] || '#6366f1';
      const displayName = cls.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `
        <span class="score-label">${displayName}</span>
        <div class="score-track">
          <div class="score-fill" style="width:0%; background:${color};" data-target="${pct}"></div>
        </div>
        <span class="score-pct">${pct.toFixed(1)}%</span>`;
      allScoresEl.appendChild(row);
    });
    setTimeout(() => {
      allScoresEl.querySelectorAll('.score-fill').forEach(el => {
        el.style.width = el.dataset.target + '%';
      });
    }, 100);

    // Info
    infoDesc.textContent = data.description;
    infoRec.textContent  = data.recommendation;

    // Severity border
    resultPanel.className = 'result-panel';
    const sevMap = { high: 'severity-high', medium: 'severity-medium', none: 'severity-none' };
    if (data.prediction === 'pituitary') resultPanel.classList.add('severity-purple');
    else if (sevMap[data.severity])      resultPanel.classList.add(sevMap[data.severity]);

    showResult();
  }

  // ── Show Error ───────────────────────────────────────────────
  function showError(msg) {
    errorMsg.textContent = msg;
    showErr();
  }

  // ── Reset / Retry buttons ────────────────────────────────────
  resetBtn.addEventListener('click', resetUpload);
  retryBtn.addEventListener('click', () => { showEmpty(); });

})();
