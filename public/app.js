/* ============================================================
   ApplyIQ — App Logic
   Features: Auto-save · PDF Export · Dark Mode · Tone Variants · LinkedIn Outreach
   ============================================================ */
;(function () {
  'use strict';

  let currentResults = null;
  let isRunning = false;

  const $ = (sel) => document.querySelector(sel);

  const els = {
    company: $('#input-company'), role: $('#input-role'), resume: $('#input-resume'), description: $('#input-description'),
    btnRun: $('#btn-run'), btnRunText: $('.btn-run__text'),
    resultsSection: $('#results-section'), actionsBar: $('#actions-bar'),
    researchContent: $('#research-content'),
    coverLetterText: $('#cover-letter-text'),
    matchScoreRing: $('#match-score-ring'), matchScoreValue: $('#match-score-value'),
    keyMatches: $('#key-matches'), interviewTipText: $('#interview-tip-text'),
    btnCopy: $('#btn-copy'), btnCopyText: $('#btn-copy-text'), btnCopyIcon: $('#btn-copy-icon'),
    btnPdf: $('#btn-pdf'),
    btnNotion: $('#btn-notion'), btnSlack: $('#btn-slack'), btnEmail: $('#btn-email'),
    btnPrep: $('#btn-prep'), btnLinkedin: $('#btn-linkedin'), btnOptimize: $('#btn-optimize'),
    btnRefresh: $('#btn-refresh'), dashboardContent: $('#dashboard-content'),
    emailModal: $('#email-modal'), emailTo: $('#email-to'), emailSubject: $('#email-subject'), emailBody: $('#email-body'),
    modalClose: $('#modal-close'), modalCancel: $('#modal-cancel'), modalSend: $('#modal-send'),
    prepModal: $('#prep-modal'), prepContent: $('#prep-content'), prepClose: $('#prep-close'),
    toastContainer: $('#toast-container'),
  };

  const PIPELINE_STEPS = 5;
  const STATUS_OPTIONS = ['Applied','Researching','Interview','Offer','Rejected'];

  /* ══════════════════════════════════════════════════════════
     FEATURE 1 — AUTO-SAVE DRAFTS (localStorage)
     ══════════════════════════════════════════════════════════ */
  const DRAFT_KEY = 'applyiq_draft';
  const DRAFT_FIELDS = ['company', 'role', 'resume', 'description'];

  function saveDraft() {
    const draft = {};
    DRAFT_FIELDS.forEach(k => { draft[k] = els[k] ? els[k].value : ''; });
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      let loaded = false;
      DRAFT_FIELDS.forEach(k => {
        if (draft[k] && els[k]) { els[k].value = draft[k]; loaded = true; }
      });
      if (loaded) showToast('Draft restored from last session.', 'info');
    } catch {}
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }

  let draftTimer = null;
  function onDraftInput() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 800);
  }

  DRAFT_FIELDS.forEach(k => {
    if (els[k]) els[k].addEventListener('input', onDraftInput);
  });

  /* ══════════════════════════════════════════════════════════
     FEATURE 3 — DARK / LIGHT MODE TOGGLE
     ══════════════════════════════════════════════════════════ */
  const THEME_KEY = 'applyiq_theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-toggle-icon');
    if (icon) icon.textContent = theme === 'light' ? '☀️' : '🌙';
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Load saved theme immediately (before DOMContentLoaded to avoid flash)
  (function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch {}
    applyTheme(saved);
  })();

  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

  /* ══════════════════════════════════════════════════════════
     FEATURE 4 — TONE SELECTOR helper
     ══════════════════════════════════════════════════════════ */
  function getSelectedTone() {
    const checked = document.querySelector('input[name="tone"]:checked');
    return checked ? checked.value : 'formal';
  }

  /* ── TOAST ── */
  function showToast(message, type='info') {
    const icons = { success:'✅', error:'❌', info:'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<span class="toast__icon">${icons[type]||icons.info}</span><span class="toast__message">${escapeHTML(message)}</span>`;
    els.toastContainer.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast--removing'); toast.addEventListener('animationend', () => toast.remove()); }, 4000);
  }

  /* ── RESUME UPLOAD ── */
  const resumeFileInput = document.getElementById('resume-file');
  const resumeFileName = document.getElementById('resume-file-name');
  if (resumeFileInput) {
    resumeFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      resumeFileName.textContent = `⏳ Reading ${file.name}...`;
      try {
        let text = '';
        if (file.type === 'text/plain' || file.name.endsWith('.txt')) text = await file.text();
        else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
          if (typeof mammoth === 'undefined') throw new Error('DOCX reader not loaded.');
          const ab = await file.arrayBuffer();
          text = (await mammoth.extractRawText({ arrayBuffer: ab })).value;
        } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
          if (typeof pdfjsLib === 'undefined') throw new Error('PDF reader not loaded.');
          const ab = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
          const pages = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map(item => item.str).join(' '));
          }
          text = pages.join('\n');
        } else throw new Error('Unsupported file type.');
        if (text.trim()) {
          els.resume.value = text.trim();
          resumeFileName.textContent = `✅ ${file.name} — loaded`;
          showToast('Resume loaded!', 'success');
          saveDraft(); // save after file load too
        } else throw new Error('Could not extract text.');
      } catch (err) {
        resumeFileName.textContent = `❌ Failed — paste text below`;
        showToast(err.message, 'error');
      }
    });
  }

  /* ── PIPELINE ── */
  function updatePipelineStep(i, status) {
    const chip = $(`#pipeline-step-${i}`); if (!chip) return;
    chip.classList.remove('pipeline__chip--inactive','pipeline__chip--active','pipeline__chip--complete','pipeline__chip--error');
    chip.classList.add(`pipeline__chip--${status}`);
    const iconEl = chip.querySelector('.pipeline__chip-icon');
    const icons = ['🔍','✍️','📋','💬','📧'];
    iconEl.textContent = status === 'complete' ? '✅' : status === 'error' ? '❌' : icons[i];
    if (i > 0) {
      const conn = $(`#pipeline-conn-${i-1}`);
      if (conn) {
        conn.classList.remove('pipeline__connector--active','pipeline__connector--complete');
        if (status === 'active') conn.classList.add('pipeline__connector--active');
        else if (status === 'complete') conn.classList.add('pipeline__connector--complete');
      }
    }
  }

  function resetPipeline() {
    for (let i = 0; i < PIPELINE_STEPS; i++) {
      updatePipelineStep(i, 'inactive');
      const conn = $(`#pipeline-conn-${i}`);
      if (conn) conn.classList.remove('pipeline__connector--active','pipeline__connector--complete');
    }
  }

  /* ── RUN AGENT ── */
  async function runAgent() {
    if (isRunning) return;
    const company = els.company.value.trim();
    const role = els.role.value.trim();
    const resume = els.resume.value.trim();
    const description = els.description.value.trim();
    const tone = getSelectedTone(); // Feature 4
    if (!company || !role || !resume || !description) {
      showToast('Please fill in all fields including your resume.', 'error');
      if (!company) flashBorder(els.company);
      if (!role) flashBorder(els.role);
      if (!resume) flashBorder(els.resume);
      if (!description) flashBorder(els.description);
      return;
    }
    isRunning = true;
    setFormDisabled(true);
    els.resultsSection.classList.remove('visible');
    els.actionsBar.classList.remove('visible');
    resetPipeline();
    updatePipelineStep(0, 'active');
    try {
      const delay = setTimeout(() => { updatePipelineStep(0,'complete'); updatePipelineStep(1,'active'); }, 600);
      const res = await fetch('/api/agent/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, role, resume, description, tone }), // Feature 4: tone included
      });
      if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.message || err.error || `Server error (${res.status})`); }
      const data = await res.json();
      currentResults = { ...data, company, role, description, resume, tone }; // Feature 4: tone stored
      clearTimeout(delay);
      for (let i = 0; i < PIPELINE_STEPS; i++) { await sleep(150); updatePipelineStep(i, 'complete'); }
      renderResults(data);
      els.resultsSection.classList.add('visible');
      els.actionsBar.classList.add('visible');
      setTimeout(() => els.resultsSection.scrollIntoView({ behavior:'smooth', block:'start' }), 200);
      showToast('Agent completed successfully!', 'success');
      clearDraft(); // Feature 1: clear draft on successful run
    } catch (err) {
      for (let i = 0; i < PIPELINE_STEPS; i++) { const c = $(`#pipeline-step-${i}`); if (c && c.classList.contains('pipeline__chip--active')) { updatePipelineStep(i,'error'); break; } }
      showToast(err.message || 'Failed.', 'error');
    } finally { isRunning = false; setFormDisabled(false); }
  }

  function setFormDisabled(disabled) {
    ['company','role','resume','description'].forEach(k => els[k].disabled = disabled);
    els.btnRun.disabled = disabled;
    if (disabled) { els.btnRun.classList.add('btn-run--loading'); els.btnRunText.textContent = 'Agent Running…'; }
    else { els.btnRun.classList.remove('btn-run--loading'); els.btnRunText.textContent = '🚀 Run Agent'; }
  }

  function flashBorder(el) {
    if (!el) return;
    el.style.borderColor = 'rgba(239,68,68,0.6)';
    el.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.1)';
    setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 2000);
  }

  /* ── RENDER ── */
  function renderResults(data) {
    renderResearch(data.research || {});
    renderCoverLetter(data);
    if (data.ats) renderATS(data.ats, data.skillsGap || []);
  }

  function renderResearch(r) {
    let html = '';
    if (r.companySummary) html += `<p class="research-summary">${escapeHTML(r.companySummary)}</p>`;
    if (r.culture) html += `<div class="research-section"><p class="research-section__label">Culture & Values</p><div class="research-culture">${escapeHTML(r.culture)}</div></div>`;
    if (r.techStack && r.techStack.length) html += `<div class="research-section"><p class="research-section__label">Tech Stack</p><div class="tech-stack-tags">${r.techStack.map(t=>`<span class="tech-tag">${escapeHTML(t)}</span>`).join('')}</div></div>`;
    if (r.recentHighlights) {
      const h = Array.isArray(r.recentHighlights) ? r.recentHighlights : [r.recentHighlights];
      if (h.length) html += `<div class="research-section"><p class="research-section__label">Recent Highlights</p><ul class="highlights-list">${h.map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul></div>`;
    }
    els.researchContent.innerHTML = html;
  }

  function renderCoverLetter(data) {
    els.coverLetterText.textContent = data.coverLetter || '';
    animateRing('match-score-ring', 'match-score-value', parseInt(data.matchScore,10)||0);
    els.keyMatches.innerHTML = (data.keyMatches||[]).map(m=>`<span class="match-badge">${escapeHTML(m)}</span>`).join('');
    els.interviewTipText.textContent = data.interviewTip || '';
    els.btnCopyText.textContent = 'Copy';
    els.btnCopyIcon.textContent = '📋';
    els.btnCopy.classList.remove('btn-copy--copied');
    // Feature 4: show tone badge
    const toneLabels = { formal: '🎩 Formal', conversational: '💬 Conversational', bold: '⚡ Bold' };
    const toneTag = document.getElementById('cover-letter-tone-tag');
    if (toneTag) toneTag.textContent = toneLabels[currentResults?.tone] || '';
  }

  function renderATS(ats, skillsGap) {
    const score = ats.totalScore || 0;
    const rec = ats.recommendation || {};
    const bd = ats.breakdown || {};
    animateRing('ats-score-ring', 'ats-score-value', score);

    const badge = document.getElementById('ats-pass-badge');
    if (badge) {
      if (ats.passThreshold) { badge.textContent = '✓ Likely to Pass ATS'; badge.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;background:rgba(16,185,129,0.12);color:#6ee7b7;border:1px solid rgba(16,185,129,0.2);'; }
      else { badge.textContent = '✗ At Risk of Rejection'; badge.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;background:rgba(239,68,68,0.12);color:#fca5a5;border:1px solid rgba(239,68,68,0.2);'; }
    }
    const recEl = document.getElementById('ats-recommendation');
    if (recEl) recEl.textContent = `${rec.level || ''}: ${rec.message || ''}`;

    const barsEl = document.getElementById('ats-bars');
    if (barsEl) {
      const prefNotInJD = !!(bd.preferred && bd.preferred.notInJD);
      const cats = [
        { key:'required', label:'Required Skills', color:'#ef4444' },
        { key:'preferred', label:'Preferred Skills', color:'#f59e0b' },
        { key:'format',   label:'Format & Parse',   color:'#6366f1' },
        { key:'content',  label:'Content Quality',  color:'#8b5cf6' },
      ];
      barsEl.innerHTML = cats.map(cat => {
        const d = bd[cat.key] || {};
        if (cat.key === 'preferred' && prefNotInJD) {
          return '<div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);margin-bottom:3px;"><span>Preferred Skills <span style="color:var(--text-muted);font-size:10px;">(not in this JD — included in Required)</span></span><span style="font-weight:600;color:var(--text-muted);">N/A</span></div><div style="height:7px;background:rgba(255,255,255,0.04);border-radius:99px;overflow:hidden;"><div style="height:100%;width:100%;background:repeating-linear-gradient(90deg,rgba(255,255,255,0.05) 0px,rgba(255,255,255,0.05) 6px,transparent 6px,transparent 12px);border-radius:99px;"></div></div></div>';
        }
        const maxScore = d.maxScore || 1;
        const pct = Math.round(((d.score||0) / maxScore) * 100);
        return '<div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);margin-bottom:3px;"><span>' + cat.label + ' <span style="color:var(--text-muted);font-size:10px;">(' + maxScore + ' pts)</span></span><span style="font-weight:600;color:var(--text-primary);">' + (d.score||0) + '/' + maxScore + '</span></div><div style="height:7px;background:rgba(255,255,255,0.06);border-radius:99px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + cat.color + ';border-radius:99px;transition:width 1.2s ease;"></div></div></div>';
      }).join('');
    }

    const expEl = document.getElementById('ats-experience');
    if (expEl && ats.experienceMatch) {
      const exp = ats.experienceMatch;
      expEl.style.display = 'block';
      expEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:${exp.meets?'rgba(16,185,129,0.06)':'rgba(239,68,68,0.06)'};border:1px solid ${exp.meets?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)'};"><span style="font-size:18px;">${exp.meets?'✅':'⚠️'}</span><div><div style="font-size:12px;font-weight:600;color:var(--text-primary);">Experience: ${exp.found}+ yrs found / ${exp.required}+ yrs required</div><div style="font-size:11px;color:var(--text-secondary);">${exp.meets?'Meets requirement':'May not meet minimum requirement'}</div></div></div>`;
    } else if (expEl) expEl.style.display = 'none';

    const reqMatched = document.getElementById('ats-required-matched');
    if (reqMatched) {
      const m = (bd.required && bd.required.matched) || [];
      reqMatched.innerHTML = m.length ? m.map(k=>`<span style="padding:3px 10px;border-radius:20px;font-size:11px;background:rgba(16,185,129,0.12);color:#6ee7b7;border:1px solid rgba(16,185,129,0.2);">${escapeHTML(k)}</span>`).join('') : '<span style="font-size:12px;color:var(--text-muted);">None matched</span>';
    }
    const reqMissing = document.getElementById('ats-required-missing');
    if (reqMissing) {
      const m = (bd.required && bd.required.missing) || [];
      reqMissing.innerHTML = m.length ? m.map(k=>`<span style="padding:3px 10px;border-radius:20px;font-size:11px;background:rgba(239,68,68,0.12);color:#fca5a5;border:1px solid rgba(239,68,68,0.2);">${escapeHTML(k)}</span>`).join('') : '<span style="font-size:12px;color:var(--text-muted);">All covered!</span>';
    }
    const prefSection = document.getElementById('ats-preferred-section');
    const prefMatched = document.getElementById('ats-preferred-matched');
    const prefMissing = document.getElementById('ats-preferred-missing');
    const prefNotInJD = !!(bd.preferred && bd.preferred.notInJD);
    if (prefSection) prefSection.style.display = prefNotInJD ? 'none' : 'block';
    if (!prefNotInJD) {
      if (prefMatched) {
        const m = (bd.preferred && bd.preferred.matched) || [];
        prefMatched.innerHTML = m.length ? m.map(k=>`<span style="padding:3px 10px;border-radius:20px;font-size:11px;background:rgba(245,158,11,0.1);color:#fcd34d;border:1px solid rgba(245,158,11,0.2);">${escapeHTML(k)}</span>`).join('') : '<span style="font-size:12px;color:var(--text-muted);">None matched</span>';
      }
      if (prefMissing) {
        const m = (bd.preferred && bd.preferred.missing) || [];
        prefMissing.innerHTML = m.length ? m.map(k=>`<span style="padding:3px 10px;border-radius:20px;font-size:11px;background:rgba(100,116,139,0.1);color:#94a3b8;border:1px solid rgba(100,116,139,0.2);">${escapeHTML(k)}</span>`).join('') : '<span style="font-size:12px;color:var(--text-muted);">All covered!</span>';
      }
    }
    const checklist = document.getElementById('ats-checklist');
    if (checklist) {
      const all = [...((bd.format && bd.format.checks)||[]), ...((bd.content && bd.content.checks)||[])];
      checklist.innerHTML = all.map(c=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-radius:8px;background:${c.passed?'rgba(16,185,129,0.04)':'rgba(239,68,68,0.04)'};border:1px solid ${c.passed?'rgba(16,185,129,0.12)':'rgba(239,68,68,0.12)'};"><span style="font-size:14px;flex-shrink:0;">${c.passed?'✅':'❌'}</span><div style="flex:1;"><div style="font-size:12px;font-weight:500;color:var(--text-primary);">${escapeHTML(c.label)}</div><div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${escapeHTML(c.detail)}</div></div><span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${c.score}/${c.maxScore}</span></div>`).join('');
    }
    const gapEl = document.getElementById('ats-skills-gap-section');
    if (gapEl) {
      if (skillsGap && skillsGap.length) {
        gapEl.style.display = 'block';
        document.getElementById('ats-skills-gap').innerHTML = skillsGap.map(s=>`<span style="padding:4px 12px;border-radius:20px;font-size:12px;background:rgba(139,92,246,0.1);color:#c4b5fd;border:1px solid rgba(139,92,246,0.2);">${escapeHTML(s)}</span>`).join('');
      } else gapEl.style.display = 'none';
    }
  }

  function animateRing(ringId, valueId, score) {
    const ring = document.getElementById(ringId);
    const valueEl = document.getElementById(valueId);
    if (!ring || !valueEl) return;
    ring.style.setProperty('--score-color', score >= 80 ? 'var(--color-success)' : score >= 60 ? 'var(--color-warning)' : 'var(--color-error)');
    let current = 0;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start)/1200, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      current = Math.round(eased * score);
      valueEl.textContent = current;
      ring.style.setProperty('--score-pct', current);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ── COPY ── */
  async function copyToClipboard() {
    if (!currentResults?.coverLetter) return;
    try {
      await navigator.clipboard.writeText(currentResults.coverLetter);
      els.btnCopyText.textContent = 'Copied!'; els.btnCopyIcon.textContent = '✅';
      els.btnCopy.classList.add('btn-copy--copied');
      showToast('Copied!', 'success');
      setTimeout(() => { els.btnCopyText.textContent='Copy'; els.btnCopyIcon.textContent='📋'; els.btnCopy.classList.remove('btn-copy--copied'); }, 3000);
    } catch { showToast('Failed to copy.', 'error'); }
  }

  /* ══════════════════════════════════════════════════════════
     FEATURE 2 — EXPORT COVER LETTER AS PDF
     ══════════════════════════════════════════════════════════ */
  function exportCoverLetterPDF() {
    if (!currentResults?.coverLetter) {
      showToast('No cover letter to export.', 'error');
      return;
    }
    if (typeof window.jspdf === 'undefined') {
      showToast('PDF library not loaded. Check your index.html scripts.', 'error');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const company = currentResults.company || 'Company';
    const role = currentResults.role || 'Role';
    const text = currentResults.coverLetter;

    const marginL = 20, marginR = 20, marginTop = 28;
    const pageW = doc.internal.pageSize.getWidth();
    const usableW = pageW - marginL - marginR;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(40, 40, 40);
    doc.text(`${role} — ${company}`, marginL, marginTop);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(dateStr, marginL, marginTop + 7);

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(marginL, marginTop + 11, pageW - marginR, marginTop + 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(50, 50, 50);

    const lines = doc.splitTextToSize(text, usableW);
    const lineHeight = 6;
    let y = marginTop + 20;
    const pageH = doc.internal.pageSize.getHeight();
    const bottomMargin = 20;

    lines.forEach(line => {
      if (y + lineHeight > pageH - bottomMargin) { doc.addPage(); y = marginTop; }
      doc.text(line, marginL, y);
      y += lineHeight;
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(160, 160, 160);
      doc.text('Generated by ApplyIQ', marginL, pageH - 10);
      doc.text(`Page ${i} of ${totalPages}`, pageW - marginR, pageH - 10, { align: 'right' });
    }

    const filename = `cover-letter-${company.toLowerCase().replace(/\s+/g, '-')}-${role.toLowerCase().replace(/\s+/g, '-')}.pdf`;
    doc.save(filename);
    showToast('Cover letter exported!', 'success');
  }

  /* ── NOTION ── */
  async function saveToNotion() {
    if (!currentResults) return;
    els.btnNotion.disabled = true;
    try {
      const res = await fetch('/api/notion/save', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ company: currentResults.company, role: currentResults.role, status: 'Applied', matchScore: currentResults.matchScore, coverLetter: currentResults.coverLetter, notes: currentResults.interviewTip || '', dateApplied: new Date().toISOString().split('T')[0] }),
      });
      if (!res.ok) throw new Error('Failed');
      showToast('Saved to Notion!', 'success');
      loadApplications();
    } catch (err) { showToast(err.message || 'Failed.', 'error'); }
    finally { els.btnNotion.disabled = false; }
  }

  /* ── Update Status ── */
  async function updateStatus(pageId, newStatus) {
    try {
      const res = await fetch('/api/notion/update-status', {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pageId, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      showToast(`Status updated to "${newStatus}"`, 'success');
      loadApplications();
    } catch (err) { showToast(err.message || 'Failed to update.', 'error'); }
  }

  /* ── Delete Application ── */
  async function deleteApplication(pageId) {
    if (!confirm('Delete this application? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/notion/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) throw new Error('Failed');
      showToast('Application deleted.', 'success');
      loadApplications();
    } catch (err) { showToast(err.message || 'Failed to delete.', 'error'); }
  }

  /* ── SLACK ── */
  async function notifySlack() {
    if (!currentResults) return;
    els.btnSlack.disabled = true;
    try {
      const res = await fetch('/api/slack/notify', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ company: currentResults.company, role: currentResults.role, matchScore: currentResults.matchScore, status: 'Applied' }),
      });
      if (!res.ok) throw new Error('Failed');
      showToast('Slack notified!', 'success');
    } catch (err) { showToast(err.message || 'Failed.', 'error'); }
    finally { els.btnSlack.disabled = false; }
  }

  /* ── EMAIL ── */
  function openEmailModal() {
    if (!currentResults) return;
    const company = currentResults.company || '';
    const role = currentResults.role || '';
    els.emailTo.value = ''; els.emailSubject.value = ''; els.emailBody.value = '';
    setTimeout(() => {
      els.emailSubject.value = `Application Follow-up: ${role} at ${company}`;
      els.emailBody.value = `Dear Hiring Team,\n\nI recently submitted my application for the ${role} position at ${company} and wanted to follow up.\n\nI believe my skills align well with this role and would welcome the opportunity to discuss further.\n\nThank you for your time.\n\nBest regards`;
    }, 50);
    els.emailModal.classList.add('visible');
  }
  function closeEmailModal() { els.emailModal.classList.remove('visible'); }

  function sendEmail() {
    const to = els.emailTo.value.trim();
    const subject = els.emailSubject.value.trim();
    const body = els.emailBody.value.trim();
    if (!to) { showToast('Please enter a recipient email.', 'error'); return; }
    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const a = document.createElement('a');
    a.href = mailtoUrl; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Email opened!', 'success'); closeEmailModal();
  }

  /* ── INTERVIEW PREP ── */
  async function generateInterviewPrep() {
    if (!currentResults) { showToast('Run the agent first!', 'error'); return; }
    els.btnPrep.disabled = true;
    els.btnPrep.querySelector('.btn-action__text').textContent = '⏳ Generating...';
    try {
      const res = await fetch('/api/interview/prep', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ company: currentResults.company, role: currentResults.role, description: currentResults.description, resume: currentResults.resume }),
      });
      if (!res.ok) throw new Error('Failed to generate');
      const data = await res.json();
      showInterviewPrepModal(data.questions || []);
      showToast('Interview prep ready!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed.', 'error');
    } finally {
      els.btnPrep.disabled = false;
      els.btnPrep.querySelector('.btn-action__text').textContent = 'Interview Prep';
    }
  }

  function showInterviewPrepModal(questions) {
    const categoryColors = {
      'BEHAVIORAL': { bg:'rgba(99,102,241,0.12)', color:'#a5b4fc', border:'rgba(99,102,241,0.2)' },
      'TECHNICAL': { bg:'rgba(139,92,246,0.12)', color:'#c4b5fd', border:'rgba(139,92,246,0.2)' },
      'COMPANY-SPECIFIC': { bg:'rgba(236,72,153,0.12)', color:'#f9a8d4', border:'rgba(236,72,153,0.2)' },
      'CURVEBALL': { bg:'rgba(245,158,11,0.12)', color:'#fcd34d', border:'rgba(245,158,11,0.2)' },
    };
    const html = questions.map((q, i) => {
      const cat = categoryColors[q.category] || categoryColors['TECHNICAL'];
      return `<div style="padding:18px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:${cat.bg};color:${cat.color};border:1px solid ${cat.border};">${escapeHTML(q.category || 'GENERAL')}</span>
          <span style="font-size:11px;color:var(--text-muted);">Question ${i+1}</span>
        </div>
        <p style="font-size:0.95rem;font-weight:600;color:var(--text-primary);margin-bottom:14px;line-height:1.5;">${escapeHTML(q.question)}</p>
        ${q.outline && q.outline.length ? `<div style="margin-bottom:12px;"><p style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">📝 Sample Answer Outline</p><ul style="list-style:none;padding:0;margin:0;">${q.outline.map(p => `<li style="font-size:0.85rem;color:var(--text-secondary);padding:4px 0 4px 18px;position:relative;line-height:1.5;"><span style="position:absolute;left:0;color:#8b5cf6;">▸</span> ${escapeHTML(p)}</li>`).join('')}</ul></div>` : ''}
        ${q.tip ? `<div style="padding:10px 14px;background:rgba(139,92,246,0.06);border-left:3px solid #8b5cf6;border-radius:6px;"><p style="font-size:0.8rem;color:var(--text-secondary);margin:0;line-height:1.5;"><strong style="color:#c4b5fd;">💡 Why this matters:</strong> ${escapeHTML(q.tip)}</p></div>` : ''}
      </div>`;
    }).join('');
    els.prepContent.innerHTML = `<div style="margin-bottom:18px;padding:14px 18px;background:rgba(139,92,246,0.06);border-radius:10px;border:1px solid rgba(139,92,246,0.15);"><p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0;">🎯 <strong style="color:#c4b5fd;">Pro tip:</strong> Practice each question out loud. Use the STAR method (Situation, Task, Action, Result) for behavioral questions.</p></div>${html}`;
    els.prepModal.classList.add('visible');
  }
  function closePrepModal() { els.prepModal.classList.remove('visible'); }

  /* ══════════════════════════════════════════════════════════
     FEATURE 5 — LINKEDIN OUTREACH GENERATOR
     ══════════════════════════════════════════════════════════ */
  async function generateLinkedInOutreach() {
    if (!currentResults) { showToast('Run the agent first!', 'error'); return; }
    const btn = els.btnLinkedin;
    const btnText = btn?.querySelector('.btn-action__text');
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = '⏳ Generating...';
    try {
      const res = await fetch('/api/linkedin/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: currentResults.company, role: currentResults.role, resume: currentResults.resume }),
      });
      if (!res.ok) throw new Error('Failed to generate');
      const data = await res.json();
      showLinkedInModal(data.messages || []);
      showToast('LinkedIn messages ready!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to generate.', 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (btnText) btnText.textContent = 'LinkedIn Message';
    }
  }

  function showLinkedInModal(messages) {
    const content = document.getElementById('linkedin-content');
    const modal = document.getElementById('linkedin-modal');
    if (!content || !modal) return;

    const charStyle = (chars) => {
      if (chars <= 250) return { color:'#6ee7b7', bg:'rgba(16,185,129,0.1)', border:'rgba(16,185,129,0.2)' };
      if (chars <= 290) return { color:'#fcd34d', bg:'rgba(245,158,11,0.1)', border:'rgba(245,158,11,0.2)' };
      return { color:'#fca5a5', bg:'rgba(239,68,68,0.1)', border:'rgba(239,68,68,0.2)' };
    };
    const labelStyles = {
      'Direct':      { bg:'rgba(99,102,241,0.12)', color:'#a5b4fc', border:'rgba(99,102,241,0.2)' },
      'Curious':     { bg:'rgba(139,92,246,0.12)', color:'#c4b5fd', border:'rgba(139,92,246,0.2)' },
      'Value-first': { bg:'rgba(16,185,129,0.12)', color:'#6ee7b7', border:'rgba(16,185,129,0.2)' },
    };

    content.innerHTML = `
      <div style="padding:12px 16px;border-radius:10px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);margin-bottom:18px;">
        <p style="font-size:11px;color:var(--text-secondary);margin:0;line-height:1.6;">💡 <strong style="color:#a5b4fc;">Tip:</strong> LinkedIn connection notes have a 300-character limit. Click <strong style="color:#a5b4fc;">Copy</strong> and paste into the "Add a note" field. Personalise with the recipient's name for best results.</p>
      </div>
      ${messages.map((m, i) => {
        const chars = m.text?.length || 0;
        const cs = charStyle(chars);
        const ls = labelStyles[m.label] || labelStyles['Direct'];
        return `<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:${ls.bg};color:${ls.color};border:1px solid ${ls.border};">${escapeHTML(m.label)}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600;background:${cs.bg};color:${cs.color};border:1px solid ${cs.border};">${chars}/300 chars</span>
          </div>
          <p id="linkedin-msg-${i}" style="font-size:0.88rem;color:var(--text-primary);line-height:1.6;margin:0 0 12px;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border-subtle);">${escapeHTML(m.text)}</p>
          <button onclick="copyLinkedInMessage('linkedin-msg-${i}', this)" style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#c4b5fd;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(139,92,246,0.2)'" onmouseout="this.style.background='rgba(139,92,246,0.1)'">📋 Copy</button>
        </div>`;
      }).join('')}`;
    modal.classList.add('visible');
  }

  // Exposed globally so inline onclick can reach it
  window.copyLinkedInMessage = function(elId, btn) {
    const el = document.getElementById(elId);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      showToast('Message copied!', 'success');
      setTimeout(() => { btn.textContent = orig; }, 2500);
    }).catch(() => showToast('Copy failed.', 'error'));
  };

  function closeLinkedInModal() {
    const modal = document.getElementById('linkedin-modal');
    if (modal) modal.classList.remove('visible');
  }

  /* ══════════════════════════════════════════════════════════
     RESUME OPTIMIZER
     ══════════════════════════════════════════════════════════ */
  async function generateResumeOptimizer() {
    if (!currentResults) { showToast('Run the agent first!', 'error'); return; }

    const missingKeywords = [
      ...((currentResults.ats?.breakdown?.required?.missing) || []),
      ...((currentResults.ats?.breakdown?.preferred?.missing) || []),
    ];

    if (!missingKeywords.length) {
      showToast('No missing keywords — your resume already covers the JD well!', 'success');
      return;
    }

    const btn = els.btnOptimize;
    const btnText = btn?.querySelector('.btn-action__text');
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = '⏳ Optimizing...';

    // Show modal immediately with loading state
    const content = document.getElementById('optimize-content');
    const modal = document.getElementById('optimize-modal');
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:16px;">
        <div style="width:40px;height:40px;border:3px solid rgba(139,92,246,0.2);border-top-color:#8b5cf6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <p style="font-size:0.9rem;color:var(--text-secondary);">Analysing your resume against ${missingKeywords.length} missing keywords…</p>
      </div>`;
    modal.classList.add('visible');

    try {
      const res = await fetch('/api/resume/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: currentResults.resume,
          missingKeywords,
          role: currentResults.role,
          company: currentResults.company,
        }),
      });
      if (!res.ok) throw new Error('Failed to optimize');
      const data = await res.json();
      renderOptimizerModal(data, missingKeywords);
      showToast('Resume optimized!', 'success');
    } catch (err) {
      content.innerHTML = `<div style="text-align:center;padding:40px;"><p style="color:var(--color-error);">❌ ${escapeHTML(err.message)}</p></div>`;
      showToast(err.message || 'Failed.', 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (btnText) btnText.textContent = 'Optimize Resume';
    }
  }

  // Store bullet texts by ID to avoid HTML attribute escaping issues
  const optimizerBulletTexts = {};

  function renderOptimizerModal(data, missingKeywords) {
    const content = document.getElementById('optimize-content');
    const { optimizedBullets = [], suggestedNewBullets = [], keywordsStillMissing = [], summary = '' } = data;

    // Clear stored texts
    Object.keys(optimizerBulletTexts).forEach(k => delete optimizerBulletTexts[k]);

    // ── Summary banner ──
    let html = `
      <div style="padding:14px 18px;border-radius:12px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);margin-bottom:22px;display:flex;gap:12px;align-items:flex-start;">
        <span style="font-size:1.4rem;flex-shrink:0;">✨</span>
        <div>
          <p style="font-size:0.9rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Optimization Complete</p>
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.6;margin:0;">${escapeHTML(summary)}</p>
        </div>
      </div>`;

    // ── Keywords still missing ──
    if (keywordsStillMissing.length) {
      html += `
        <div style="padding:12px 16px;border-radius:10px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);margin-bottom:22px;">
          <p style="font-size:0.78rem;font-weight:600;color:var(--color-warning);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">⚠️ Still Missing — Add to Skills Section</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${keywordsStillMissing.map(k => `<span style="padding:3px 10px;border-radius:20px;font-size:12px;background:rgba(245,158,11,0.1);color:#fcd34d;border:1px solid rgba(245,158,11,0.2);">${escapeHTML(k)}</span>`).join('')}
          </div>
        </div>`;
    }

    // ── Optimized bullets ──
    if (optimizedBullets.length) {
      html += `<h4 style="font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:14px;">📝 Rewritten Bullets (${optimizedBullets.length})</h4>`;
      html += optimizedBullets.map((b, i) => {
        const key = 'opt-' + i;
        optimizerBulletTexts[key] = b.optimized;
        return `
        <div style="border:1px solid var(--border-subtle);border-radius:14px;overflow:hidden;margin-bottom:14px;">
          <div style="padding:14px 18px;background:rgba(239,68,68,0.04);border-bottom:1px solid var(--border-subtle);">
            <p style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-error);margin-bottom:6px;">❌ Before</p>
            <p style="font-size:0.88rem;color:var(--text-secondary);line-height:1.6;margin:0;">${escapeHTML(b.original)}</p>
          </div>
          <div style="padding:14px 18px;background:rgba(16,185,129,0.04);">
            <p style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-success);margin-bottom:6px;">✅ After</p>
            <p style="font-size:0.88rem;color:var(--text-primary);line-height:1.6;margin-bottom:10px;">${escapeHTML(b.optimized)}</p>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">
              ${(b.keywordsAdded||[]).map(k => `<span style="padding:2px 9px;border-radius:20px;font-size:11px;background:rgba(16,185,129,0.1);color:#6ee7b7;border:1px solid rgba(16,185,129,0.2);">+${escapeHTML(k)}</span>`).join('')}
            </div>
            <button onclick="copyOptimizedBullet('${key}', this)"
              style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#c4b5fd;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s;"
              onmouseover="this.style.background='rgba(139,92,246,0.2)'"
              onmouseout="this.style.background='rgba(139,92,246,0.1)'">📋 Copy bullet</button>
          </div>
        </div>`;
      }).join('');
    }

    // ── Suggested new bullets ──
    if (suggestedNewBullets.length) {
      html += `<h4 style="font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:22px 0 14px;">💡 Suggested New Bullets</h4>`;
      html += suggestedNewBullets.map((b, i) => {
        const key = 'sug-' + i;
        optimizerBulletTexts[key] = b.bullet;
        return `
        <div style="padding:16px 18px;border-radius:12px;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.15);margin-bottom:12px;">
          <p style="font-size:0.88rem;color:var(--text-primary);line-height:1.6;margin-bottom:10px;">${escapeHTML(b.bullet)}</p>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">
            ${(b.keywordsAdded||[]).map(k => `<span style="padding:2px 9px;border-radius:20px;font-size:11px;background:rgba(99,102,241,0.1);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2);">+${escapeHTML(k)}</span>`).join('')}
          </div>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;font-style:italic;">💬 ${escapeHTML(b.note||'')}</p>
          <button onclick="copyOptimizedBullet('${key}', this)"
            style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);color:#a5b4fc;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s;"
            onmouseover="this.style.background='rgba(99,102,241,0.2)'"
            onmouseout="this.style.background='rgba(99,102,241,0.1)'">📋 Copy bullet</button>
        </div>`;
      }).join('');
    }

    content.innerHTML = html;
  }

  // Global — uses the text map, not data attributes
  window.copyOptimizedBullet = function(key, btn) {
    const text = optimizerBulletTexts[key];
    if (!text) { showToast('Nothing to copy.', 'error'); return; }
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      showToast('Bullet copied!', 'success');
      setTimeout(() => { btn.textContent = orig; }, 2500);
    }).catch(() => showToast('Copy failed.', 'error'));
  };

  function closeOptimizerModal() {
    const modal = document.getElementById('optimize-modal');
    if (modal) modal.classList.remove('visible');
  }

  /* ── DASHBOARD ── */
  async function loadApplications() {
    try {
      const res = await fetch('/api/notion/applications');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const apps = Array.isArray(data) ? data : (data.applications || []);
      if (!apps.length) {
        els.dashboardContent.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📭</div><p class="empty-state__text">No applications tracked yet.</p></div>`;
        return;
      }
      els.dashboardContent.innerHTML = `
        <table class="applications-table">
          <thead><tr><th>Company</th><th>Role</th><th>Score</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>${apps.map(app=>`
            <tr>
              <td style="font-weight:500;color:var(--text-primary);">${escapeHTML(app.company||'')}</td>
              <td>${escapeHTML(app.role||'')}</td>
              <td>${renderScoreBadge(app.matchScore)}</td>
              <td>${renderStatusDropdown(app.id, app.status)}</td>
              <td>${escapeHTML(app.dateApplied||'—')}</td>
              <td><button class="delete-btn" data-page-id="${app.id}" style="background:none;border:none;cursor:pointer;font-size:14px;opacity:0.5;padding:4px 6px;border-radius:6px;transition:all 0.2s;" onmouseover="this.style.opacity='1';this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.opacity='0.5';this.style.background='none'" title="Delete">🗑️</button></td>
            </tr>`).join('')}
          </tbody>
        </table>`;

      document.querySelectorAll('.status-dropdown').forEach(sel => {
        sel.addEventListener('change', (e) => updateStatus(e.target.dataset.pageId, e.target.value));
      });
      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => deleteApplication(e.currentTarget.dataset.pageId));
      });
    } catch {
      els.dashboardContent.innerHTML = `<div class="empty-state"><div class="empty-state__icon">⚠️</div><p class="empty-state__text">Unable to load applications.</p></div>`;
    }
  }

  function renderScoreBadge(score) {
    const s = parseInt(score, 10);
    if (isNaN(s)) return '<span class="score-badge score-badge--mid">—</span>';
    return `<span class="score-badge score-badge--${s>=80?'high':s>=60?'mid':'low'}">${s}%</span>`;
  }

  function renderStatusDropdown(pageId, currentStatus) {
    const status = currentStatus || 'Applied';
    return `<select class="status-dropdown" data-page-id="${pageId}">
      ${STATUS_OPTIONS.map(opt => `<option value="${opt}" ${opt===status?'selected':''}>${opt}</option>`).join('')}
    </select>`;
  }

  function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ── EVENTS ── */
  els.btnRun.addEventListener('click', runAgent);
  els.btnCopy.addEventListener('click', copyToClipboard);
  if (els.btnPdf) els.btnPdf.addEventListener('click', exportCoverLetterPDF);
  els.btnNotion.addEventListener('click', saveToNotion);
  els.btnSlack.addEventListener('click', notifySlack);
  els.btnEmail.addEventListener('click', openEmailModal);
  if (els.btnPrep) els.btnPrep.addEventListener('click', generateInterviewPrep);
  if (els.btnLinkedin) els.btnLinkedin.addEventListener('click', generateLinkedInOutreach);
  if (els.btnOptimize) els.btnOptimize.addEventListener('click', generateResumeOptimizer);

  const optimizeModalEl = document.getElementById('optimize-modal');
  const optimizeCloseEl = document.getElementById('optimize-modal-close');
  if (optimizeCloseEl) optimizeCloseEl.addEventListener('click', closeOptimizerModal);
  if (optimizeModalEl) optimizeModalEl.addEventListener('click', e => { if (e.target === optimizeModalEl) closeOptimizerModal(); });
  els.btnRefresh.addEventListener('click', loadApplications);
  els.modalClose.addEventListener('click', closeEmailModal);
  els.modalCancel.addEventListener('click', closeEmailModal);
  els.modalSend.addEventListener('click', sendEmail);
  els.emailModal.addEventListener('click', e => { if (e.target === els.emailModal) closeEmailModal(); });
  if (els.prepClose) els.prepClose.addEventListener('click', closePrepModal);
  if (els.prepModal) els.prepModal.addEventListener('click', e => { if (e.target === els.prepModal) closePrepModal(); });

  const linkedinModalEl = document.getElementById('linkedin-modal');
  const linkedinCloseEl = document.getElementById('linkedin-modal-close');
  if (linkedinCloseEl) linkedinCloseEl.addEventListener('click', closeLinkedInModal);
  if (linkedinModalEl) linkedinModalEl.addEventListener('click', e => { if (e.target === linkedinModalEl) closeLinkedInModal(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeEmailModal(); closePrepModal(); closeLinkedInModal(); closeOptimizerModal(); }
    if (e.key === 'Enter' && e.ctrlKey && !isRunning) runAgent();
  });

  document.addEventListener('DOMContentLoaded', () => {
    loadApplications();
    loadDraft(); // Feature 1: restore draft on load
  });

})();