/**
 * MySleepCoach - Interactive Web App Dashboard
 * Supports Google Health Hypnogram, Apple Health Multi-Period Trends,
 * Whoop Recovery Gauges, and Samsung Health Biorhythms
 */

document.addEventListener('DOMContentLoaded', () => {
  let appData = null;
  let currentPeriod = 14;
  let currentTargetHours = 8.0;
  let currentMetricMode = 'sleep';
  const DASHBOARD_CACHE_KEY = 'mysleepcoach.dashboard.v2';

  function saveDashboardSnapshot(data) {
    try {
      localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
        version: 3,
        saved_at: new Date().toISOString(),
        data
      }));
    } catch (_) {
      // Storage can be unavailable in private browsing or restricted contexts.
    }
  }

  function restoreCachedDashboard() {
    try {
      const cached = JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) || 'null');
      const data = cached?.data;
      if (!data?.today || !Array.isArray(data?.all_history) || !data.all_history.length) return false;
      if (cached.version !== 3 && window.MySleepCoachStatic?.recalculateDashboardScores(data)) {
        saveDashboardSnapshot(data);
      }
      appData = data;
      currentTargetHours = data.today.target_sleep_hours || 8.0;
      initApp(data);
      document.body.classList.remove('static-awaiting-sync');
      setSyncState('idle', `저장 데이터 ${data.today.date} · 동기화할 때만 Google 인증`);
      return true;
    } catch (_) {
      try { localStorage.removeItem(DASHBOARD_CACHE_KEY); } catch (_) {}
      return false;
    }
  }

  const syncButton = document.getElementById('sync-button');
  const syncStatus = document.getElementById('sync-status');

  function setSyncState(state, message) {
    syncStatus.textContent = message || '';
    syncButton.disabled = state === 'running';
    syncButton.textContent = state === 'running' ? '동기화 중' : '동기화';
    syncButton.dataset.state = state || 'idle';
  }

  function showStaticModeWaitingState() {
    document.body.classList.add('static-awaiting-sync');
    setSyncState('idle', 'Google 계정으로 동기화하세요.');
    const recoverySub = document.getElementById('recovery-subtitle');
    if (recoverySub) {
      recoverySub.textContent = '브라우저에 저장된 건강 데이터가 없습니다. 동기화 버튼을 눌러 현재 세션에서만 불러옵니다.';
    }
    const aiBriefingEl = document.getElementById('ai-briefing-text');
    if (aiBriefingEl) {
      aiBriefingEl.textContent = '동기화 후 이 카드에 기기 내 규칙으로 계산한 생활 조언이 표시됩니다. 생성형 AI를 사용하지 않고 건강 데이터를 외부로 보내지 않습니다.';
    }
  }

  async function syncFromGoogle() {
    if (!window.MySleepCoachStatic) {
      throw new Error('Google Health 모듈을 불러오지 못했습니다.');
    }
    setSyncState('running', 'Google Health 데이터를 동기화하는 중...');
    const data = await window.MySleepCoachStatic.sync(message => setSyncState('running', message));
    appData = data;
    currentTargetHours = data.today.target_sleep_hours || 8.0;
    saveDashboardSnapshot(data);
    initApp(data);
    document.body.classList.remove('static-awaiting-sync');
    setSyncState('success', data.metric_methodology?.health_metrics_warning
      ? `수면 동기화 완료 · ${data.metric_methodology.health_metrics_warning}`
      : `동기화 완료 · ${data.today.date}`);
  }

  if (!restoreCachedDashboard()) showStaticModeWaitingState();

  syncButton.addEventListener('click', async () => {
    try {
      await syncFromGoogle();
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      setSyncState('error', message);
    }
  });

  // Tab Navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetEl = document.getElementById(targetTab);
      if (targetEl) targetEl.classList.add('active');

      // Redraw charts if needed on tab switch
      if (targetTab === 'tab-hypnogram' && appData) {
        renderHypnogram(appData.today);
      } else if (targetTab === 'tab-trends' && appData) {
        renderTrends(appData.all_history, currentPeriod);
      }
    });
  });

  function initApp(data) {
    const today = data.today;

    // Header info
    document.getElementById('device-name').textContent = today.device_name || 'Google Health';
    document.getElementById('current-date').textContent = today.date;
    document.getElementById('total-days-badge').textContent = `${data.all_history.length}일 누적`;

    // 1. Tab 1: Today Recovery & Overview
    renderTodayOverview(data);

    // 2. Tab 2: Hypnogram
    renderHypnogram(today);

    // 3. Tab 3: Trends
    initTrends(data.all_history);

    // 4. Tab 4: Biorhythm & Simulator
    initBiorhythm(data);
  }

  /* --------------------------------------------------------------------------
     TAB 1: Today Overview & Recovery Gauge
     -------------------------------------------------------------------------- */
  function renderTodayOverview(data) {
    const today = data.today;
    const scoreValEl = document.getElementById('condition-score-val');
    const gaugePath = document.getElementById('condition-gauge-path');
    const recoveryPill = document.getElementById('recovery-pill');
    const recoverySub = document.getElementById('recovery-subtitle');

    const score = Number.isFinite(today.condition_score) ? today.condition_score : null;
    if (score !== null) {
      animateCount(scoreValEl, 0, score, 900);
      const maxDash = 490;
      gaugePath.style.strokeDashoffset = maxDash - (maxDash * (score / 100));
      if (score >= 80) {
        gaugePath.style.stroke = 'url(#emerald-grad)';
        recoveryPill.className = 'recovery-status-pill success';
        recoveryPill.textContent = '컨디션 추정치 높음';
      } else if (score >= 65) {
        gaugePath.style.stroke = 'url(#amber-grad)';
        recoveryPill.className = 'recovery-status-pill warning';
        recoveryPill.textContent = '컨디션 추정치 보통';
      } else {
        gaugePath.style.stroke = 'url(#purple-grad)';
        recoveryPill.className = 'recovery-status-pill danger';
        recoveryPill.textContent = '컨디션 추정치 낮음';
      }
    } else {
      scoreValEl.textContent = '-';
      gaugePath.style.strokeDashoffset = 490;
      recoveryPill.className = 'recovery-status-pill';
      recoveryPill.textContent = '컨디션 계산 자료 부족';
    }

    const hrvText = Number.isFinite(today.hrv_ms) ? `HRV ${today.hrv_ms.toFixed(1)} ms` : 'HRV 없음';
    const rhrText = Number.isFinite(today.resting_hr_bpm) ? `안정시 심박수 ${today.resting_hr_bpm.toFixed(0)} bpm` : '안정시 심박수 없음';
    const hrvChange = Number.isFinite(today.hrv_ms) && Number.isFinite(today.hrv_baseline_ms) && today.hrv_baseline_ms > 0
      ? `기준 대비 HRV ${Math.round((today.hrv_ms / today.hrv_baseline_ms - 1) * 100)}%` : null;
    const rhrChange = Number.isFinite(today.resting_hr_bpm) && Number.isFinite(today.resting_hr_baseline_bpm)
      ? `기준 대비 안정시 심박수 ${Math.round(today.resting_hr_bpm - today.resting_hr_baseline_bpm) >= 0 ? '+' : ''}${Math.round(today.resting_hr_bpm - today.resting_hr_baseline_bpm)} bpm` : null;
    const sleepContext = `깊은 잠 ${today.deep_hm || '-'} · REM ${today.rem_hm || '-'} · 깨어 있음 ${today.awake_hm || '-'}${Number.isFinite(today.awake_segments) ? ` (${today.awake_segments}회)` : ''}${Number.isFinite(today.restless_minutes) && today.restless_minutes > 0 ? ` · 뒤척임 ${Math.round(today.restless_minutes)}분` : ''}`;
    recoverySub.textContent = `${today.readiness_source || '생체 자료 부족'} · ${hrvText} · ${rhrText} · ${[hrvChange, rhrChange, sleepContext].filter(Boolean).join(' · ')}. Google/Fitbit 공식 Readiness 점수가 아닌 MySleepCoach 추정치입니다. ${data.metric_methodology?.health_metrics_warning || ''}`;

    document.getElementById('quick-debt-val').textContent = today.exponential_debt_hm || '-';
    document.getElementById('quick-debt-badge').className = `badge-tag ${today.debt_badge_class || 'info'}`;
    document.getElementById('quick-debt-badge').textContent = today.debt_status || '추정치';
    document.getElementById('quick-sleep-val').textContent = today.today_sleep_hm || '-';
    document.getElementById('quick-balance-val').textContent = `목표 대비 ${today.daily_balance_hm || '-'}`;
    document.getElementById('quick-eff-val').textContent = Number.isFinite(today.sleep_efficiency) ? `${today.sleep_efficiency}%` : '-';
    document.getElementById('quick-sleep-window').textContent = `${today.bed_time} ~ ${today.wake_time}`;

    const sleepScore = Number.isFinite(today.sleep_score_estimate) ? today.sleep_score_estimate : null;
    const quickScoreEl = document.getElementById('quick-strain-val');
    if (quickScoreEl) quickScoreEl.textContent = sleepScore === null ? '-' : String(sleepScore);
    const scoreBadge = document.getElementById('quick-strain-target-badge');
    if (scoreBadge) scoreBadge.textContent = 'MySleepCoach 추정 · 공식 점수 아님';

    const balanceBadge = document.getElementById('today-balance-status-badge');
    if (balanceBadge) {
      balanceBadge.className = `badge-tag ${score === null ? 'info' : score >= 80 ? 'success' : score >= 65 ? 'warning' : 'danger'}`;
      balanceBadge.textContent = score === null ? '자료 부족' : '추정치';
    }
    const recValEl = document.getElementById('balance-recovery-val');
    if (recValEl) recValEl.textContent = score === null ? '-' : `${score}%`;
    const recBarEl = document.getElementById('balance-recovery-bar');
    if (recBarEl) recBarEl.style.width = `${score ?? 0}%`;

    const sleepScoreValEl = document.getElementById('balance-strain-val');
    if (sleepScoreValEl) sleepScoreValEl.textContent = sleepScore === null ? '-' : `${sleepScore} / 100`;
    const sleepScoreBarEl = document.getElementById('balance-strain-bar');
    if (sleepScoreBarEl) sleepScoreBarEl.style.width = `${sleepScore ?? 0}%`;

    const adviceEl = document.getElementById('balance-advice-text');
    if (adviceEl) {
      adviceEl.textContent = `${today.metric_notice || '점수는 추정치입니다.'} ${hrvText}, ${rhrText}.`;
    }

    const stageTotal = [today.deep_hours, today.rem_hours, today.light_hours]
      .filter(Number.isFinite).reduce((sum, hours) => sum + hours, 0);
    const invalidStages = Boolean(today.stage_data_warning) || stageTotal > (today.today_sleep_hours || 0) * 1.05;
    const stageItems = [
      ['deep', today.deep_pct, today.deep_hm],
      ['rem', today.rem_pct, today.rem_hm],
      ['light', today.light_pct, today.light_hm],
      ['awake', today.awake_pct, today.awake_hm]
    ];
    stageItems.forEach(([name, pct, hm]) => {
      const seg = document.getElementById(`quick-seg-${name}`);
      if (seg) seg.style.width = `${!invalidStages && Number.isFinite(pct) ? pct : 0}%`;
      const text = document.getElementById(`quick-${name}-text`);
      if (text) text.textContent = invalidStages && name !== 'awake' ? '수면 단계 합계 불일치' : Number.isFinite(pct) ? `${hm} (${pct}%)` : '데이터 없음';
    });

    document.getElementById('circadian-wake-ref').textContent = `기상 ${today.wake_time} 기준`;
    renderCircadianTimeline(data.circadian_windows, today.wake_time);

    const aiBriefingEl = document.getElementById('ai-briefing-text');
    if (aiBriefingEl) {
      aiBriefingEl.textContent = data.local_advice ||
        '로컬 규칙 기반 조언을 계산할 데이터가 아직 부족합니다. 생성형 AI나 외부 건강 데이터 전송은 사용하지 않습니다.';
    }
  }

  function renderCircadianTimeline(windows, wakeTimeStr) {
    const listEl = document.getElementById('circadian-timeline-list');
    listEl.innerHTML = '';
    if (!windows || !windows.length) return;

    const now = new Date();
    const curMinutes = now.getHours() * 60 + now.getMinutes();

    windows.forEach(w => {
      const itemEl = document.createElement('div');
      itemEl.className = 'timeline-item';

      // Check if current time falls into this window
      const parts = w.time_range.split('~').map(s => s.trim());
      if (parts.length === 2) {
        const [sh, sm] = parts[0].split(':').map(Number);
        const [eh, em] = parts[1].split(':').map(Number);
        const sMin = sh * 60 + sm;
        const eMin = eh * 60 + em;

        let isActive = false;
        if (sMin <= eMin) {
          isActive = (curMinutes >= sMin && curMinutes <= eMin);
        } else {
          // Crosses midnight
          isActive = (curMinutes >= sMin || curMinutes <= eMin);
        }
        if (isActive) itemEl.classList.add('active');
      }

      itemEl.innerHTML = `
        <div class="timeline-icon">${w.icon}</div>
        <div class="timeline-content">
          <div class="timeline-top">
            <span class="timeline-name">${w.name}</span>
            <span class="timeline-time font-heading">${w.time_range}</span>
          </div>
          <div class="timeline-desc">${w.desc}</div>
        </div>
      `;
      listEl.appendChild(itemEl);
    });
  }

  /* --------------------------------------------------------------------------
     TAB 2: Google Health Style Sleep Hypnogram Chart
     -------------------------------------------------------------------------- */
  function renderHypnogram(today) {
    const container = document.getElementById('hypnogram-chart-wrapper');
    const tooltipDot = document.getElementById('tooltip-stage-dot');
    const tooltipName = document.getElementById('tooltip-stage-name');
    const tooltipTime = document.getElementById('tooltip-stage-time');

    document.getElementById('hypno-time-range').textContent = `${today.bed_time} ~ ${today.wake_time} (${today.today_sleep_hm})`;
    const stageTotal = [today.deep_hours, today.rem_hours, today.light_hours]
      .filter(Number.isFinite).reduce((sum, hours) => sum + hours, 0);
    const invalidStages = Boolean(today.stage_data_warning) || stageTotal > (today.today_sleep_hours || 0) * 1.05;
    document.getElementById('detail-deep-val').textContent = invalidStages ? '합계 불일치' : `${today.deep_hm} (${today.deep_pct ?? '-'}%)`;
    document.getElementById('detail-rem-val').textContent = invalidStages ? '합계 불일치' : `${today.rem_hm} (${today.rem_pct ?? '-'}%)`;
    document.getElementById('detail-light-val').textContent = invalidStages ? '합계 불일치' : `${today.light_hm} (${today.light_pct ?? '-'}%)`;
    document.getElementById('detail-awake-val').textContent = `${today.awake_hm} (${today.awake_pct ?? 0}%)`;

    const stages = today.hypnogram || [];
    if (!stages.length) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">수면 단계 세부 데이터가 없습니다.</div>';
      return;
    }

    const totalMin = stages.reduce((acc, s) => acc + s.dur_min, 0);
    const width = 420;
    const height = 180;
    const paddingLeft = 40;
    const paddingRight = 16;
    const paddingTop = 14;
    const paddingBottom = 26;

    const chartW = width - paddingLeft - paddingRight;
    const chartH = height - paddingTop - paddingBottom;

    // Y levels
    const levelMap = {
      'AWAKE': 0,
      'REM': 1,
      'LIGHT': 2,
      'DEEP': 3
    };
    const colorMap = {
      'AWAKE': 'var(--stage-awake)',
      'REM': 'var(--stage-rem)',
      'LIGHT': 'var(--stage-light)',
      'DEEP': 'var(--stage-deep)'
    };
    const nameMap = {
      'AWAKE': '각성 (Awake)',
      'REM': '렘 수면 (REM)',
      'LIGHT': '얕은 수면 (Light)',
      'DEEP': '깊은 수면 (Deep)'
    };

    const rowH = chartH / 3;

    // Build SVG
    let svgHtml = `
      <svg class="hypnogram-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    `;

    // Horizontal grid lines and stage labels
    const levels = ['AWAKE', 'REM', 'LIGHT', 'DEEP'];
    const shortLabels = ['각성', 'REM', '얕음', '깊음'];
    levels.forEach((lvl, i) => {
      const y = paddingTop + i * rowH;
      svgHtml += `
        <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" class="hypno-grid-line" />
        <text x="${paddingLeft - 8}" y="${y + 3}" class="hypno-label" text-anchor="end">${shortLabels[i]}</text>
      `;
    });

    // Time ticks (start, 2h, 4h, 6h, end)
    const tickIntervalMin = 60; // 1-hour ticks
    for (let m = 0; m <= totalMin; m += tickIntervalMin) {
      const x = paddingLeft + (m / totalMin) * chartW;
      svgHtml += `
        <line x1="${x}" y1="${paddingTop}" x2="${x}" y2="${height - paddingBottom}" class="hypno-grid-line" stroke-opacity="0.4" />
      `;
    }

    // Start & End time text labels at bottom
    svgHtml += `
      <text x="${paddingLeft}" y="${height - 8}" class="hypno-label" text-anchor="start">${today.bed_time}</text>
      <text x="${width - paddingRight}" y="${height - 8}" class="hypno-label" text-anchor="end">${today.wake_time}</text>
    `;

    // Draw Stepped Hypnogram Stage Blocks & Line Path
    let pathD = '';
    let currentX = paddingLeft;

    stages.forEach((stg, idx) => {
      const w = (stg.dur_min / totalMin) * chartW;
      const lvl = levelMap[stg.type] !== undefined ? levelMap[stg.type] : 2;
      const y = paddingTop + lvl * rowH;
      const color = colorMap[stg.type] || '#10B981';

      // Bar block
      svgHtml += `
        <rect class="hypno-block"
              x="${currentX}" y="${y - 4}" width="${Math.max(2, w)}" height="${height - paddingBottom - y + 4}"
              fill="${color}" fill-opacity="0.25" rx="2"
              data-index="${idx}" />
        <rect class="hypno-block-top"
              x="${currentX}" y="${y - 3}" width="${Math.max(2, w)}" height="6"
              fill="${color}" rx="2"
              data-index="${idx}" />
      `;

      // Path connecting steps
      if (idx === 0) {
        pathD += `M ${currentX} ${y}`;
      } else {
        pathD += ` V ${y} H ${currentX + w}`;
      }

      currentX += w;
    });

    svgHtml += `
        <path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linejoin="round" />
      </svg>
    `;

    container.innerHTML = svgHtml;

    // Interactive tooltip handling
    const blocks = container.querySelectorAll('.hypno-block, .hypno-block-top');
    blocks.forEach(b => {
      b.addEventListener('mouseenter', () => activateTooltip(b));
      b.addEventListener('click', () => activateTooltip(b));
    });

    function activateTooltip(target) {
      const idx = target.getAttribute('data-index');
      const stg = stages[idx];
      if (!stg) return;

      tooltipDot.className = `dot ${stg.type.toLowerCase()}`;
      tooltipName.textContent = nameMap[stg.type] || stg.type;
      tooltipTime.textContent = `${stg.start_time} ~ ${stg.end_time} (${Math.round(stg.dur_min)}분간 유지)`;
    }
  }

  /* --------------------------------------------------------------------------
     TAB 3: Apple Health & Whoop Trends Explorer
     -------------------------------------------------------------------------- */
  function initTrends(history) {
    const pills = document.querySelectorAll('.filter-pill');
    pills.forEach(pill => {
      pill.onclick = () => {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const periodStr = pill.getAttribute('data-period');
        currentPeriod = periodStr === 'all' ? 'all' : Number(periodStr);
        renderTrends(history, currentPeriod);
      };
    });

    const btnSleep = document.getElementById('btn-mode-sleep');
    const btnReadiness = document.getElementById('btn-mode-strain');
    if (btnSleep && btnReadiness) {
      btnSleep.onclick = () => {
        currentMetricMode = 'sleep';
        btnSleep.classList.add('active');
        btnReadiness.classList.remove('active');
        renderTrends(history, currentPeriod);
      };
      btnReadiness.onclick = () => {
        currentMetricMode = 'readiness';
        btnReadiness.classList.add('active');
        btnSleep.classList.remove('active');
        renderTrends(history, currentPeriod);
      };
    }

    const toggleBtn = document.getElementById('toggle-history-btn');
    const tableWrapper = document.getElementById('history-table-wrapper');
    const toggleIcon = document.getElementById('history-toggle-icon');
    toggleBtn.onclick = () => {
      const collapsed = tableWrapper.classList.toggle('collapsed');
      toggleIcon.textContent = collapsed ? '펼치기' : '접기';
    };

    renderTrends(history, currentPeriod);
    renderHistoryTable(history);
  }

  function renderTrends(history, period) {
    if (!history || !history.length) return;

    const slice = period === 'all' ? history : history.slice(-period);
    const periodLabel = period === 'all' ? `전체 (${history.length}일)` : `최근 ${period}일`;
    const totalDays = slice.length;
    const chartContainer = document.getElementById('trend-bar-chart');
    const guideWrapper = document.querySelector('.chart-target-guide');
    const guideSpan = document.querySelector('.chart-target-guide span');
    chartContainer.innerHTML = '';

    if (currentMetricMode === 'sleep') {
      document.getElementById('trend-chart-title').textContent = `${periodLabel} 수면시간 추이`;
      if (guideSpan) guideSpan.textContent = `목표 ${currentTargetHours.toFixed(1)}h`;
      if (guideWrapper) guideWrapper.style.top = `${Math.max(10, Math.min(85, 100 - (currentTargetHours / 11.5) * 100))}%`;

      const avgSleep = slice.reduce((sum, day) => sum + day.asleep_hours, 0) / totalDays;
      const targetMetCount = slice.filter(day => day.asleep_hours >= currentTargetHours).length;
      document.getElementById('agg-lbl-1').textContent = '기간 평균 수면';
      document.getElementById('agg-avg-sleep').textContent = toHm(avgSleep);
      document.getElementById('agg-lbl-2').textContent = `목표(${currentTargetHours.toFixed(1)}h) 달성`;
      document.getElementById('agg-target-met-pct').textContent = `${Math.round(targetMetCount / totalDays * 100)}% (${targetMetCount}/${totalDays}일)`;

      let totalBedM = 0;
      let totalWakeM = 0;
      slice.forEach(day => {
        const [bh, bm] = day.bed_time.split(':').map(Number);
        const [wh, wm] = day.wake_time.split(':').map(Number);
        totalBedM += (bh < 12 ? bh + 24 : bh) * 60 + bm;
        totalWakeM += wh * 60 + wm;
      });
      document.getElementById('agg-lbl-3').textContent = '평균 취침';
      document.getElementById('agg-avg-bedtime').textContent = formatMtoHM(Math.round(totalBedM / totalDays) % 1440);
      document.getElementById('agg-lbl-4').textContent = '평균 기상';
      document.getElementById('agg-avg-waketime').textContent = formatMtoHM(Math.round(totalWakeM / totalDays));

      slice.forEach((day, i) => {
        const col = document.createElement('div');
        col.className = 'chart-col';
        if (i === slice.length - 1) col.classList.add('selected');
        const heightPct = Math.min(100, Math.max(8, day.asleep_hours / 11.5 * 100));
        const fillClass = day.asleep_hours >= currentTargetHours ? '' :
          day.asleep_hours >= currentTargetHours - 1.5 ? 'short' : 'danger';
        const [, month, date] = day.date.split('-').map(Number);
        col.innerHTML = `<div class="chart-bar-fill ${fillClass}" style="height:${heightPct}%"></div><span class="chart-col-date">${month}/${date}</span>`;
        col.onclick = () => {
          chartContainer.querySelectorAll('.chart-col').forEach(c => c.classList.remove('selected'));
          col.classList.add('selected');
          updateSelectedDayCard(day, 'sleep');
        };
        chartContainer.appendChild(col);
      });
      updateSelectedDayCard(slice[slice.length - 1], 'sleep');
      return;
    }

    document.getElementById('trend-chart-title').textContent = `${periodLabel} 수면 점수(추정) vs 컨디션 점수(추정)`;
    if (guideSpan) guideSpan.textContent = '80점 참고선';
    if (guideWrapper) guideWrapper.style.top = '20%';

    const avgSleepScore = Math.round(slice.reduce((sum, day) => sum + (day.sleep_score_estimate ?? 0), 0) / totalDays);
    const readinessDays = slice.filter(day => Number.isFinite(day.condition_score));
    const avgReadiness = readinessDays.length
      ? Math.round(readinessDays.reduce((sum, day) => sum + day.condition_score, 0) / readinessDays.length)
      : null;
    const hrvDays = slice.filter(day => Number.isFinite(day.hrv_ms)).length;
    const rhrDays = slice.filter(day => Number.isFinite(day.resting_hr_bpm)).length;

    document.getElementById('agg-lbl-1').textContent = '평균 수면 점수 (추정)';
    document.getElementById('agg-avg-sleep').textContent = `${avgSleepScore}점`;
    document.getElementById('agg-lbl-2').textContent = '평균 컨디션 점수 (추정)';
    document.getElementById('agg-target-met-pct').textContent = avgReadiness === null ? '자료 부족' : `${avgReadiness}점 (${readinessDays.length}일)`;
    document.getElementById('agg-lbl-3').textContent = 'HRV 데이터';
    document.getElementById('agg-avg-bedtime').textContent = `${hrvDays}/${totalDays}일`;
    document.getElementById('agg-lbl-4').textContent = '안정시 심박수 데이터';
    document.getElementById('agg-avg-waketime').textContent = `${rhrDays}/${totalDays}일`;

    slice.forEach((day, i) => {
      const col = document.createElement('div');
      col.className = 'chart-col';
      if (i === slice.length - 1) col.classList.add('selected');
      const sleepScore = Number.isFinite(day.sleep_score_estimate) ? day.sleep_score_estimate : 0;
      const readiness = Number.isFinite(day.condition_score) ? day.condition_score : null;
      const dotClass = readiness !== null && readiness >= 80 ? 'recovery-high' : readiness !== null && readiness >= 65 ? 'recovery-mid' : 'recovery-low';
      const [, month, date] = day.date.split('-').map(Number);
      col.innerHTML = `
        <div class="chart-bar-fill strain-bar" style="height:${Math.max(8, sleepScore)}%" title="수면 점수(추정) ${sleepScore}"></div>
        ${readiness === null ? '' : `<div class="chart-col-dot ${dotClass}" style="bottom:${Math.max(8, Math.min(92, readiness))}%" title="컨디션 점수(추정) ${readiness}"></div>`}
        <span class="chart-col-date">${month}/${date}</span>`;
      col.onclick = () => {
        chartContainer.querySelectorAll('.chart-col').forEach(c => c.classList.remove('selected'));
        col.classList.add('selected');
        updateSelectedDayCard(day, 'readiness');
      };
      chartContainer.appendChild(col);
    });
    updateSelectedDayCard(slice[slice.length - 1], 'readiness');
  }

  function updateSelectedDayCard(day, mode = currentMetricMode) {
    if (!day) return;
    const badge = document.getElementById('sel-day-score');
    const readiness = Number.isFinite(day.condition_score) ? day.condition_score : null;
    badge.textContent = readiness === null ? '컨디션 자료 부족' : `컨디션(추정) ${readiness}점`;
    badge.className = `badge-tag ${readiness === null ? 'info' : readiness >= 80 ? 'success' : readiness >= 65 ? 'warning' : 'danger'}`;

    if (mode === 'readiness') {
      document.getElementById('sel-day-date').textContent = `${day.date} · ${day.readiness_source || '수면 기반'}`;
      document.getElementById('sel-day-sleep').textContent = `수면 점수 ${day.sleep_score_estimate ?? '-'}점`;
      document.getElementById('sel-day-debt').textContent = Number.isFinite(day.hrv_ms) ? `HRV ${day.hrv_ms.toFixed(1)} ms` : 'HRV 데이터 없음';
      document.getElementById('sel-day-window').textContent = Number.isFinite(day.resting_hr_bpm) ? `RHR ${day.resting_hr_bpm.toFixed(0)} bpm` : 'RHR 데이터 없음';
      document.getElementById('sel-day-eff').textContent = readiness === null ? '-' : `${readiness}점`;
      return;
    }

    document.getElementById('sel-day-date').textContent = `${day.date} (${day.asleep_hm})`;
    document.getElementById('sel-day-sleep').textContent = `${day.asleep_hm} (깊은 수면 ${day.deep_hm || '-'})`;
    document.getElementById('sel-day-debt').textContent = day.exponential_debt_hm || '-';
    document.getElementById('sel-day-window').textContent = `${day.bed_time} ~ ${day.wake_time}`;
    document.getElementById('sel-day-eff').textContent = Number.isFinite(day.efficiency) ? `${day.efficiency}%` : '-';
  }

  function renderHistoryTable(history) {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';
    document.getElementById('table-record-count').textContent = history.length;

    [...history].reverse().forEach(row => {
      const tr = document.createElement('tr');
      const efficiency = Number.isFinite(row.efficiency) ? `${row.efficiency}%` : '-';
      const hrv = Number.isFinite(row.hrv_ms) ? `${row.hrv_ms.toFixed(1)} ms` : '-';
      const rhr = Number.isFinite(row.resting_hr_bpm) ? `${row.resting_hr_bpm.toFixed(0)} bpm` : '-';
      const condition = Number.isFinite(row.condition_score) ? row.condition_score : null;
      tr.innerHTML = `
        <td style="font-weight:600">${row.date}</td>
        <td style="font-weight:700;color:#34D399">${row.asleep_hm}</td>
        <td>${row.bed_time}~${row.wake_time}</td>
        <td>${efficiency}</td>
        <td style="color:#FBBF24">${row.exponential_debt_hm}</td>
        <td>${row.sleep_score_estimate ?? '-'}</td>
        <td><span class="badge-tag ${condition === null ? 'info' : condition >= 80 ? 'success' : condition >= 65 ? 'warning' : 'danger'}">${condition === null ? '자료 부족' : `${condition}점`}</span></td>
        <td>${hrv}</td>
        <td>${rhr}</td>`;
      tbody.appendChild(tr);
    });
  }


  /* --------------------------------------------------------------------------
     TAB 4: Samsung Health Biorhythm & Simulator
     -------------------------------------------------------------------------- */
  function initBiorhythm(data) {
    if (data.chronotype) {
      document.getElementById('chrono-name').textContent = data.chronotype.name;
      document.getElementById('chrono-desc').textContent = data.chronotype.desc;
      if (data.chronotype.name.includes('사자')) {
        document.getElementById('chrono-icon').textContent = '🦁';
      } else if (data.chronotype.name.includes('곰')) {
        document.getElementById('chrono-icon').textContent = '🐻';
      } else {
        document.getElementById('chrono-icon').textContent = '🐺';
      }
    }

    if (data.consistency) {
      document.getElementById('consistency-score-val').textContent = data.consistency.score;
      document.getElementById('consistency-label-val').textContent = data.consistency.label;
      document.getElementById('consistency-std-val').textContent = `${data.consistency.std_minutes}분`;
    }

    // Whoop Sleep Need Slider
    const slider = document.getElementById('target-slider');
    const sliderVal = document.getElementById('target-slider-val');

    slider.value = currentTargetHours;
    sliderVal.textContent = `${currentTargetHours.toFixed(1)}시간`;

    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      currentTargetHours = val;
      sliderVal.textContent = `${val.toFixed(1)}시간`;

      // Dynamically recalculate debt across history
      recalculateDebtLocally(data.all_history, val);
      renderTrends(data.all_history, currentPeriod);
    };
  }

  function recalculateDebtLocally(history, targetH) {
    history.forEach((day, idx) => {
      const recentWindow = history.slice(Math.max(0, idx - 13), idx + 1);
      let weightedSum = 0;
      let weightSum = 0;
      [...recentWindow].reverse().forEach((past, d) => {
        const deficit = Math.max(0, targetH - past.asleep_hours);
        const weight = Math.exp(-0.15 * d);
        weightedSum += deficit * weight;
        weightSum += weight;
      });
      const debt = weightedSum / Math.max(0.001, weightSum);
      day.exponential_debt_hours = Math.round(debt * 100) / 100;
      day.exponential_debt_hm = toHm(day.exponential_debt_hours);
      day.sleep_score_estimate = window.MySleepCoachStatic.scoreSleep(day, targetH, history.slice(0, idx));
    });
  }

  /* Helper functions */
  function animateCount(el, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const current = Math.floor(progress * (end - start) + start);
      el.textContent = current;
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = end;
      }
    };
    window.requestAnimationFrame(step);
  }

  function toHm(hrs) {
    const absH = Math.abs(hrs);
    const h = Math.floor(absH);
    const m = Math.round((absH - h) * 60);
    return `${h}시간 ${m}분`;
  }

  function formatMtoHM(totalMinutes) {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
});
