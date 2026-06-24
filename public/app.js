/* ============================================================
   JobFlow AI — Application Logic
   ============================================================ */
;(function () {
  'use strict';

  /* ---------- State ---------- */
  let currentResults = null;
  let isRunning = false;

  /* ---------- DOM Refs ---------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    company: $('#input-company'),
    role: $('#input-role'),
    description: $('#input-description'),
    btnRun: $('#btn-run'),
    btnRunText: $('.btn-run__text'),
    resultsSection: $('#results-section'),
    actionsBar: $('#actions-bar'),
    researchContent: $('#research-content'),
    coverLetterText: $('#cover-letter-text'),
    matchScoreRing: $('#match-score-ring'),
    matchScoreValue: $('#match-score-value'),
    keyMatches: $('#key-matches'),
    interviewTipText: $('#interview-tip-text'),
    btnCopy: $('#btn-copy'),
    btnCopyText: $('#btn-copy-text'),
    btnCopyIcon: $('#btn-copy-icon'),
    btnNotion: $('#btn-notion'),
    btnSlack: $('#btn-slack'),
    btnEmail: $('#btn-email'),
    btnRefresh: $('#btn-refresh'),
    dashboardContent: $('#dashboard-content'),
    emailModal: $('#email-modal'),
    emailTo: $('#email-to'),
    emailSubject: $('#email-subject'),
    emailBody: $('#email-body'),
    modalClose: $('#modal-close'),
    modalCancel: $('#modal-cancel'),
    modalSend: $('#modal-send'),
    toastContainer: $('#toast-container'),
  };

  const PIPELINE_STEPS = 5;

  /* ============================================================
     TOAST SYSTEM
     ============================================================ */
  function showToast(message, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span class="toast__message">${escapeHTML(message)}</span>
    `;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast--removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }

  /* ============================================================
     PIPELINE VISUALIZER
     ============================================================ */
  function updatePipelineStep(stepIndex, status) {
    const chip = $(`#pipeline-step-${stepIndex}`);
    if (!chip) return;

    chip.classList.remove(
      'pipeline__chip--inactive',
      'pipeline__chip--active',
      'pipeline__chip--complete',
      'pipeline__chip--error'
    );
    chip.classList.add(`pipeline__chip--${status}`);

    const iconEl = chip.querySelector('.pipeline__chip-icon');
    const originalIcons = ['🔍', '✍️', '📋', '💬', '📧'];
    if (status === 'complete') {
      iconEl.textContent = '✅';
    } else if (status === 'error') {
      iconEl.textContent = '❌';
    } else {
      iconEl.textContent = originalIcons[stepIndex];
    }

    if (stepIndex > 0) {
      const conn = $(`#pipeline-conn-${stepIndex - 1}`);
      if (conn) {
        conn.classList.remove('pipeline__connector--active', 'pipeline__connector--complete');
        if (status === 'active') {
          conn.classList.add('pipeline__connector--active');
        } else if (status === 'complete') {
          conn.classList.add('pipeline__connector--complete');
        }
      }
    }
  }

  function resetPipeline() {
    for (let i = 0; i < PIPELINE_STEPS; i++) {
      updatePipelineStep(i, 'inactive');
      const conn = $(`#pipeline-conn-${i}`);
      if (conn) {
        conn.classList.remove('pipeline__connector--active', 'pipeline__connector--complete');
      }
    }
  }

  /* ============================================================
     RUN AGENT
     ============================================================ */
  async function runAgent() {
    if (isRunning) return;

    const company = els.company.value.trim();
    const role = els.role.value.trim();
    const description = els.description.value.trim();

    if (!company || !role || !description) {
      showToast('Please fill in all fields before running the agent.', 'error');
      highlightEmptyFields(company, role, description);
      return;
    }

    isRunning = true;
    setFormDisabled(true);
    els.resultsSection.classList.remove('visible');
    els.actionsBar.classList.remove('visible');
    resetPipeline();

    updatePipelineStep(0, 'active');

    try {
      const researchDelay = simulatePipelineProgress(1, 600);

      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, role, description }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `Server error (${res.status})`);
      }

      const data = await res.json();
      currentResults = { ...data, company, role, description };

      clearTimeout(researchDelay);
      await animatePipelineCompletion();

      renderResults(data);
      els.resultsSection.classList.add('visible');
      els.actionsBar.classList.add('visible');

      setTimeout(() => {
        els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);

      showToast('Agent completed successfully!', 'success');

    } catch (err) {
      markPipelineError();
      showToast(err.message || 'Failed to run agent. Please try again.', 'error');
    } finally {
      isRunning = false;
      setFormDisabled(false);
    }
  }

  function simulatePipelineProgress(startStep, delay) {
    return setTimeout(() => {
      updatePipelineStep(0, 'complete');
      updatePipelineStep(startStep, 'active');
    }, delay);
  }

  async function animatePipelineCompletion() {
    for (let i = 0; i < PIPELINE_STEPS; i++) {
      await sleep(150);
      updatePipelineStep(i, 'complete');
    }
  }

  function markPipelineError() {
    for (let i = 0; i < PIPELINE_STEPS; i++) {
      const chip = $(`#pipeline-step-${i}`);
      if (chip && chip.classList.contains('pipeline__chip--active')) {
        updatePipelineStep(i, 'error');
        return;
      }
    }
    updatePipelineStep(0, 'error');
  }

  function setFormDisabled(disabled) {
    els.company.disabled = disabled;
    els.role.disabled = disabled;
    els.description.disabled = disabled;
    els.btnRun.disabled = disabled;

    if (disabled) {
      els.btnRun.classList.add('btn-run--loading');
      els.btnRunText.textContent = 'Agent Running…';
    } else {
      els.btnRun.classList.remove('btn-run--loading');
      els.btnRunText.textContent = '🚀 Run Agent';
    }
  }

  function highlightEmptyFields(company, role, description) {
    if (!company) flashBorder(els.company);
    if (!role) flashBorder(els.role);
    if (!description) flashBorder(els.description);
  }

  function flashBorder(el) {
    el.style.borderColor = 'rgba(239, 68, 68, 0.6)';
    el.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.1)';
    setTimeout(() => {
      el.style.borderColor = '';
      el.style.boxShadow = '';
    }, 2000);
  }

  /* ============================================================
     RENDER RESULTS
     ============================================================ */
  function renderResults(data) {
    const r = data.research || {};
    let researchHTML = '';

    if (r.companySummary) {
      researchHTML += `<p class="research-summary">${escapeHTML(r.companySummary)}</p>`;
    }

    if (r.culture) {
      researchHTML += `
        <div class="research-section">
          <p class="research-section__label">Culture & Values</p>
          <div class="research-culture">${escapeHTML(r.culture)}</div>
        </div>`;
    }

    if (r.techStack && r.techStack.length) {
      researchHTML += `
        <div class="research-section">
          <p class="research-section__label">Tech Stack</p>
          <div class="tech-stack-tags">
            ${r.techStack.map((t) => `<span class="tech-tag">${escapeHTML(t)}</span>`).join('')}
          </div>
        </div>`;
    }

    if (r.recentHighlights) {
      const highlights = Array.isArray(r.recentHighlights)
        ? r.recentHighlights
        : [r.recentHighlights];

      if (highlights.length) {
        researchHTML += `
          <div class="research-section">
            <p class="research-section__label">Recent Highlights</p>
            <ul class="highlights-list">
              ${highlights.map((h) => `<li>${escapeHTML(h)}</li>`).join('')}
            </ul>
          </div>`;
      }
    }

    els.researchContent.innerHTML = researchHTML;

    // Cover Letter
    els.coverLetterText.textContent = data.coverLetter || '';

    // Match Score
    const score = parseInt(data.matchScore, 10) || 0;
    animateMatchScore(score);

    // Key Matches
    const matches = data.keyMatches || [];
    els.keyMatches.innerHTML = matches
      .map((m) => `<span class="match-badge">${escapeHTML(m)}</span>`)
      .join('');

    // Interview Tip
    els.interviewTipText.textContent = data.interviewTip || '';

    // Reset copy button
    els.btnCopyText.textContent = 'Copy';
    els.btnCopyIcon.textContent = '📋';
    els.btnCopy.classList.remove('btn-copy--copied');
  }

  /* ============================================================
     MATCH SCORE ANIMATION
     ============================================================ */
  function animateMatchScore(score) {
    let color;
    if (score >= 80) color = 'var(--color-success)';
    else if (score >= 60) color = 'var(--color-warning)';
    else color = 'var(--color-error)';

    els.matchScoreRing.style.setProperty('--score-color', color);

    let current = 0;
    const duration = 1200;
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      current = Math.round(eased * score);

      els.matchScoreValue.textContent = current;
      els.matchScoreRing.style.setProperty('--score-pct', current);

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* ============================================================
     COPY TO CLIPBOARD
     ============================================================ */
  async function copyToClipboard() {
    if (!currentResults?.coverLetter) return;

    try {
      await navigator.clipboard.writeText(currentResults.coverLetter);
      els.btnCopyText.textContent = 'Copied!';
      els.btnCopyIcon.textContent = '✅';
      els.btnCopy.classList.add('btn-copy--copied');
      showToast('Cover letter copied to clipboard.', 'success');

      setTimeout(() => {
        els.btnCopyText.textContent = 'Copy';
        els.btnCopyIcon.textContent = '📋';
        els.btnCopy.classList.remove('btn-copy--copied');
      }, 3000);
    } catch {
      showToast('Failed to copy. Please select and copy manually.', 'error');
    }
  }

  /* ============================================================
     SAVE TO NOTION
     ============================================================ */
  async function saveToNotion() {
    if (!currentResults) return;

    els.btnNotion.disabled = true;

    try {
      const res = await fetch('/api/notion/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: currentResults.company,
          role: currentResults.role,
          status: 'Applied',
          matchScore: currentResults.matchScore,
          coverLetter: currentResults.coverLetter,
          notes: currentResults.interviewTip || '',
          dateApplied: new Date().toISOString().split('T')[0],
        }),
      });

      if (!res.ok) throw new Error('Failed to save');

      showToast('Application saved to Notion!', 'success');
      loadApplications();
    } catch (err) {
      showToast(err.message || 'Failed to save to Notion.', 'error');
    } finally {
      els.btnNotion.disabled = false;
    }
  }

  /* ============================================================
     NOTIFY SLACK
     ============================================================ */
  async function notifySlack() {
    if (!currentResults) return;

    els.btnSlack.disabled = true;

    try {
      const res = await fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: currentResults.company,
          role: currentResults.role,
          matchScore: currentResults.matchScore,
          status: 'Applied',
        }),
      });

      if (!res.ok) throw new Error('Failed to notify');

      showToast('Slack notification sent!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to send Slack notification.', 'error');
    } finally {
      els.btnSlack.disabled = false;
    }
  }

  /* ============================================================
     DRAFT EMAIL
     ============================================================ */
  function openEmailModal() {
    if (!currentResults) return;

    const company = currentResults.company || '';
    const role = currentResults.role || '';

    els.emailTo.value = '';
    els.emailSubject.value = `Application Follow-up: ${role} at ${company}`;
    els.emailBody.value = `Dear Hiring Team,\n\nI recently submitted my application for the ${role} position at ${company} and wanted to follow up to express my continued interest.\n\nI believe my skills and experience align well with this role, and I would welcome the opportunity to discuss how I can contribute to your team.\n\nThank you for your time and consideration.\n\nBest regards,\nArpita Oberoi`;

    els.emailModal.classList.add('visible');
  }

  function closeEmailModal() {
    els.emailModal.classList.remove('visible');
  }

  async function sendEmail() {
    const to = els.emailTo.value.trim();
    const subject = els.emailSubject.value.trim();
    const body = els.emailBody.value.trim();

    if (!to) {
      showToast('Please enter a recipient email address.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/gmail/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to, subject, body,
          company: currentResults?.company || '',
        }),
      });

      const data = await res.json().catch(() => ({}));
      const mailtoUrl = data.mailtoUrl || `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(mailtoUrl, '_blank');

      showToast('Email draft opened in your email client.', 'success');
      closeEmailModal();
    } catch (err) {
      const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(mailtoUrl, '_blank');
      showToast('Opened in email client.', 'info');
      closeEmailModal();
    }
  }

  /* ============================================================
     APPLICATIONS DASHBOARD
     ============================================================ */
  async function loadApplications() {
    try {
      const res = await fetch('/api/notion/applications');
      if (!res.ok) throw new Error('Failed to fetch');

      const data = await res.json();

      // FIX: server returns array directly, not { applications: [] }
      const apps = Array.isArray(data) ? data : (data.applications || []);

      if (!apps.length) {
        els.dashboardContent.innerHTML = `
          <div class="empty-state">
            <div class="empty-state__icon">📭</div>
            <p class="empty-state__text">No applications tracked yet. Run the agent and save to Notion to start building your pipeline.</p>
          </div>`;
        return;
      }

      const rows = apps.map((app) => `
        <tr>
          <td style="font-weight:500;color:var(--text-primary);">${escapeHTML(app.company || '')}</td>
          <td>${escapeHTML(app.role || '')}</td>
          <td>${renderScoreBadge(app.matchScore)}</td>
          <td>${renderStatusBadge(app.status)}</td>
          <td>${escapeHTML(app.dateApplied || '—')}</td>
        </tr>`
      ).join('');

      els.dashboardContent.innerHTML = `
        <table class="applications-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Score</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    } catch {
      els.dashboardContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">⚠️</div>
          <p class="empty-state__text">Unable to load applications. Make sure the server is running and Notion is connected.</p>
        </div>`;
    }
  }

  function renderScoreBadge(score) {
    const s = parseInt(score, 10);
    if (isNaN(s)) return '<span class="score-badge score-badge--mid">—</span>';
    let cls = 'low';
    if (s >= 80) cls = 'high';
    else if (s >= 60) cls = 'mid';
    return `<span class="score-badge score-badge--${cls}">${s}%</span>`;
  }

  function renderStatusBadge(status) {
    const s = (status || 'Applied').toLowerCase();
    const classMap = { applied: 'applied', interview: 'interview', offer: 'offer', rejected: 'rejected' };
    const cls = classMap[s] || 'applied';
    return `<span class="status-badge status-badge--${cls}">${escapeHTML(status || 'Applied')}</span>`;
  }

  /* ============================================================
     UTILITIES
     ============================================================ */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ============================================================
     EVENT LISTENERS
     ============================================================ */
  els.btnRun.addEventListener('click', runAgent);
  els.btnCopy.addEventListener('click', copyToClipboard);
  els.btnNotion.addEventListener('click', saveToNotion);
  els.btnSlack.addEventListener('click', notifySlack);
  els.btnEmail.addEventListener('click', openEmailModal);
  els.btnRefresh.addEventListener('click', loadApplications);

  els.modalClose.addEventListener('click', closeEmailModal);
  els.modalCancel.addEventListener('click', closeEmailModal);
  els.modalSend.addEventListener('click', sendEmail);
  els.emailModal.addEventListener('click', (e) => {
    if (e.target === els.emailModal) closeEmailModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEmailModal();
    if (e.key === 'Enter' && e.ctrlKey && !isRunning) runAgent();
  });

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    loadApplications();
  });

})();