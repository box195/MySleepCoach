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

  let csrfToken = null;

  async function loadData() {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error('data fetch failed: ' + res.status);
    const data = await res.json();
    appData = data;
    currentTargetHours = data.today.target_sleep_hours || 8.0;
    initApp(data);
  }

  async function initializeSession() {
    const res = await fetch('/api/session', { cache: 'no-store' });
    if (!res.ok) throw new Error('session fetch failed: ' + res.status);
    const info = await res.json();
    csrfToken = info.csrf_token;
    await loadData();
  }

  initializeSession().catch(err => {
    console.error('Data load error:', err);
    document.getElementById('recovery-subtitle').textContent = '데이터를 불러오지 못했습니다. 동기화를 눌러 다시 시도하세요.';
  });

  const syncButton = document.getElementById('sync-button');
  const syncStatus = document.getElementById('sync-status');

  function setSyncState(state, message) {
    syncStatus.textContent = message || '';
    syncButton.disabled = state === 'running';
    syncButton.textContent = state === 'running' ? '동기화 중' : '동기화';
    syncButton.dataset.state = state || 'idle';
  }

  async function pollSyncStatus() {
    while (true) {
      const res = await fetch('/api/sync/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('sync status failed: ' + res.status);
      const status = await res.json();
      setSyncState(status.state, status.message);
      if (status.state !== 'running') {
        if (status.state === 'success') await loadData();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  syncButton.addEventListener('click', async () => {
    if (!csrfToken) return;
    setSyncState('running', '최신 수면 데이터를 가져오는 중...');
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken }
      });
      if (!res.ok && res.status !== 409) throw new Error('sync start failed: ' + res.status);
      await pollSyncStatus();
    } catch (err) {
      console.error('Sync error:', err);
      setSyncState('error', '동기화에 실패했습니다. 잠시 후 다시 시도하세요.');
    }
  });

  // Tab Navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

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
    document.getElementById('device-name').textContent = today.device_name || 'Google Fitbit Air';
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

    // Recovery Score Gauge Animation
    const scoreValEl = document.getElementById('condition-score-val');
    const gaugePath = document.getElementById('condition-gauge-path');
    const recoveryPill = document.getElementById('recovery-pill');
    const recoverySub = document.getElementById('recovery-subtitle');

    const score = today.condition_score || 85;
    animateCount(scoreValEl, 0, score, 1200);

    // Circumference 2 * PI * 78 = ~490
    const maxDash = 490;
    const offset = maxDash - (maxDash * (score / 100));
    gaugePath.style.strokeDashoffset = offset;

    if (score >= 80) {
      gaugePath.style.stroke = 'url(#emerald-grad)';
      recoveryPill.className = 'recovery-status-pill success';
      recoveryPill.textContent = '🟢 최상 회복 (Optimal Recovery)';
      recoverySub.textContent = '깊은 수면과 렘 수면이 충분하여 뇌와 근육이 훌륭하게 회복되었습니다. 고강도 트레이닝에 최적입니다.';
    } else if (score >= 65) {
      gaugePath.style.stroke = 'url(#amber-grad)';
      recoveryPill.className = 'recovery-status-pill warning';
      recoveryPill.textContent = '🟡 회복 양호 (Moderate Recovery)';
      recoverySub.textContent = '일반적인 활동에는 무리가 없으나 잔여 수면부채로 오후 집중력 저하가 발생할 수 있습니다.';
    } else {
      gaugePath.style.stroke = 'url(#purple-grad)';
      recoveryPill.className = 'recovery-status-pill danger';
      recoveryPill.textContent = '🔴 피로 누적 (High Fatigue)';
      recoverySub.textContent = '누적된 수면 부채가 큽니다. 가벼운 스트레칭과 능동적 휴식을 권장합니다.';
    }

    // Quick Tiles
    document.getElementById('quick-debt-val').textContent = today.exponential_debt_hm;
    document.getElementById('quick-debt-badge').className = `badge-tag ${today.debt_badge_class}`;
    document.getElementById('quick-debt-badge').textContent = today.debt_status.split(' ')[0] + ' ' + today.debt_status.split(' ')[1];

    document.getElementById('quick-sleep-val').textContent = today.today_sleep_hm;
    document.getElementById('quick-balance-val').textContent = `기준 대비 ${today.daily_balance_hm}`;

    document.getElementById('quick-eff-val').textContent = `${today.sleep_efficiency}%`;
    document.getElementById('quick-sleep-window').textContent = `${today.bed_time} ~ ${today.wake_time}`;

    // Day Strain & Whoop Balance Card
    const strainVal = (today.day_strain !== undefined) ? today.day_strain : 15.8;
    const targetStr = today.strain_target || '14.0~17.5';
    const balanceState = today.balance_state || '최적 훈련 밸런스';
    const balanceClass = today.balance_class || 'success';
    const strainRec = today.strain_rec || '신체 회복도와 부하 밸런스가 조화롭습니다.';

    const quickStrainValEl = document.getElementById('quick-strain-val');
    if (quickStrainValEl) quickStrainValEl.textContent = strainVal.toFixed(1);
    const quickStrainTargetBadge = document.getElementById('quick-strain-target-badge');
    if (quickStrainTargetBadge) quickStrainTargetBadge.textContent = `타깃 ${targetStr}`;

    const balanceBadge = document.getElementById('today-balance-status-badge');
    if (balanceBadge) {
      balanceBadge.className = `badge-tag ${balanceClass}`;
      balanceBadge.textContent = balanceState.split(' (')[0];
    }
    const recValEl = document.getElementById('balance-recovery-val');
    if (recValEl) recValEl.textContent = `${score}%`;
    const recBarEl = document.getElementById('balance-recovery-bar');
    if (recBarEl) recBarEl.style.width = `${score}%`;

    const strainValEl = document.getElementById('balance-strain-val');
    if (strainValEl) strainValEl.textContent = `${strainVal.toFixed(1)} / 21`;
    const strainBarEl = document.getElementById('balance-strain-bar');
    if (strainBarEl) strainBarEl.style.width = `${Math.min(100, (strainVal / 21) * 100)}%`;

    const adviceEl = document.getElementById('balance-advice-text');
    if (adviceEl) adviceEl.textContent = strainRec;

    // Sleep Stage Bar
    document.getElementById('quick-seg-deep').style.width = `${today.deep_pct}%`;
    document.getElementById('quick-seg-rem').style.width = `${today.rem_pct}%`;
    document.getElementById('quick-seg-light').style.width = `${today.light_pct}%`;
    document.getElementById('quick-seg-awake').style.width = `${today.awake_pct || 4}%`;

    document.getElementById('quick-deep-text').textContent = `${today.deep_hm} (${today.deep_pct}%)`;
    document.getElementById('quick-rem-text').textContent = `${today.rem_hm} (${today.rem_pct}%)`;
    document.getElementById('quick-light-text').textContent = `${today.light_hm} (${today.light_pct}%)`;
    document.getElementById('quick-awake-text').textContent = `${today.awake_hm} (${today.awake_pct || 4}%)`;

    // Circadian Timeline
    document.getElementById('circadian-wake-ref').textContent = `기상 ${today.wake_time} 기준`;
    renderCircadianTimeline(data.circadian_windows, today.wake_time);

    // AI Coaching Text
    const aiBriefingEl = document.getElementById('ai-briefing-text');
    if (data.ai_briefing) {
      aiBriefingEl.textContent = data.ai_briefing;
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
    document.getElementById('detail-deep-val').textContent = `${today.deep_hm} (${today.deep_pct}%)`;
    document.getElementById('detail-rem-val').textContent = `${today.rem_hm} (${today.rem_pct}%)`;
    document.getElementById('detail-light-val').textContent = `${today.light_hm} (${today.light_pct}%)`;
    document.getElementById('detail-awake-val').textContent = `${today.awake_hm} (${today.awake_pct || 4}%)`;

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
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const periodStr = pill.getAttribute('data-period');
        currentPeriod = periodStr === 'all' ? 'all' : Number(periodStr);
        renderTrends(history, currentPeriod);
      });
    });

    // Metric Mode Buttons (Sleep vs Strain)
    const btnSleep = document.getElementById('btn-mode-sleep');
    const btnStrain = document.getElementById('btn-mode-strain');
    if (btnSleep && btnStrain) {
      btnSleep.addEventListener('click', () => {
        currentMetricMode = 'sleep';
        btnSleep.classList.add('active');
        btnStrain.classList.remove('active');
        renderTrends(history, currentPeriod);
      });
      btnStrain.addEventListener('click', () => {
        currentMetricMode = 'strain';
        btnStrain.classList.add('active');
        btnSleep.classList.remove('active');
        renderTrends(history, currentPeriod);
      });
    }

    // History table accordion toggle
    const toggleBtn = document.getElementById('toggle-history-btn');
    const tableWrapper = document.getElementById('history-table-wrapper');
    const toggleIcon = document.getElementById('history-toggle-icon');

    toggleBtn.addEventListener('click', () => {
      const isCollapsed = tableWrapper.classList.contains('collapsed');
      if (isCollapsed) {
        tableWrapper.classList.remove('collapsed');
        toggleIcon.textContent = '▲ 닫기';
      } else {
        tableWrapper.classList.add('collapsed');
        toggleIcon.textContent = '▼ 열기';
      }
    });

    renderTrends(history, currentPeriod);
    renderHistoryTable(history);
  }

  function renderTrends(history, period) {
    if (!history || !history.length) return;

    let slice = [];
    let periodLabel = '';
    if (period === 'all') {
      slice = history;
      periodLabel = `전체 (${history.length}일)`;
    } else {
      slice = history.slice(-period);
      periodLabel = `최근 ${period}일`;
    }

    const totalDays = slice.length;
    const chartContainer = document.getElementById('trend-bar-chart');
    const guideWrapper = document.querySelector('.chart-target-guide');
    const guideSpan = document.querySelector('.chart-target-guide span');
    chartContainer.innerHTML = '';

    if (currentMetricMode === 'sleep') {
      // 💤 1. SLEEP & DEBT MODE
      document.getElementById('trend-chart-title').textContent = `${periodLabel} 수면 트렌드 & 부채 추이`;
      if (guideSpan) guideSpan.textContent = `목표선 ${currentTargetHours.toFixed(1)}h`;
      if (guideWrapper) guideWrapper.style.top = `${Math.max(10, Math.min(85, 100 - (currentTargetHours / 11.5) * 100))}%`;

      const avgSleep = slice.reduce((acc, d) => acc + d.asleep_hours, 0) / totalDays;
      const targetMetCount = slice.filter(d => d.asleep_hours >= currentTargetHours).length;
      const targetMetPct = Math.round((targetMetCount / totalDays) * 100);

      document.getElementById('agg-lbl-1').textContent = '선택 기간 일평균 수면';
      const agg1 = document.getElementById('agg-avg-sleep');
      agg1.textContent = toHm(avgSleep);
      agg1.style.color = '#FFF';

      document.getElementById('agg-lbl-2').textContent = `목표(${currentTargetHours.toFixed(1)}h) 충족일 비율`;
      document.getElementById('agg-target-met-pct').textContent = `${targetMetPct}% (${targetMetCount}/${totalDays}일)`;

      // Average bedtime & waketime
      let totalBedM = 0;
      let totalWakeM = 0;
      slice.forEach(d => {
        const [bh, bm] = d.bed_time.split(':').map(Number);
        const [wh, wm] = d.wake_time.split(':').map(Number);
        const bMin = (bh < 12 ? bh + 24 : bh) * 60 + bm;
        totalBedM += bMin;
        totalWakeM += (wh * 60 + wm);
      });
      const avgBedM = Math.round(totalBedM / totalDays) % (24 * 60);
      const avgWakeM = Math.round(totalWakeM / totalDays);

      document.getElementById('agg-lbl-3').textContent = '평균 취침 시각';
      document.getElementById('agg-avg-bedtime').textContent = formatMtoHM(avgBedM);
      document.getElementById('agg-lbl-4').textContent = '평균 기상 시각';
      document.getElementById('agg-avg-waketime').textContent = formatMtoHM(avgWakeM);

      const maxChartHours = 11.5;

      slice.forEach((day, i) => {
        const col = document.createElement('div');
        col.className = 'chart-col';
        if (i === slice.length - 1) col.classList.add('selected');

        const heightPct = Math.min(100, Math.max(8, (day.asleep_hours / maxChartHours) * 100));

        let fillClass = '';
        if (day.asleep_hours >= currentTargetHours) {
          fillClass = '';
        } else if (day.asleep_hours >= currentTargetHours - 1.5) {
          fillClass = 'short';
        } else {
          fillClass = 'danger';
        }

        const dateParts = day.date.split('-');
        const shortDate = `${Number(dateParts[1])}/${Number(dateParts[2])}`;

        col.innerHTML = `
          <div class="chart-bar-fill ${fillClass}" style="height: ${heightPct}%;"></div>
          <span class="chart-col-date">${shortDate}</span>
        `;

        col.addEventListener('click', () => {
          chartContainer.querySelectorAll('.chart-col').forEach(c => c.classList.remove('selected'));
          col.classList.add('selected');
          updateSelectedDayCard(day, 'sleep');
        });

        chartContainer.appendChild(col);
      });

      updateSelectedDayCard(slice[slice.length - 1], 'sleep');

    } else {
      // 🔥 2. RECOVERY vs DAY STRAIN (WHOOP) MODE
      document.getElementById('trend-chart-title').textContent = `${periodLabel} 신체 회복도 vs 부하(Strain) 밸런스 추이`;
      if (guideSpan) guideSpan.textContent = `고강도 권장 기준 (14.0/21)`;
      if (guideWrapper) guideWrapper.style.top = `${Math.round((1 - 14.0 / 21.0) * 100)}%`;

      const avgStrain = slice.reduce((acc, d) => acc + (d.day_strain || 14.0), 0) / totalDays;
      const optimalCount = slice.filter(d => (d.balance_class === 'success') || (d.balance_state && d.balance_state.includes('최적'))).length;
      const optimalPct = Math.round((optimalCount / totalDays) * 100);

      // Find max strain day
      let maxDay = slice[0];
      slice.forEach(d => {
        if ((d.day_strain || 0) > (maxDay.day_strain || 0)) maxDay = d;
      });

      const avgRecovery = Math.round(slice.reduce((acc, d) => acc + (d.condition_score || 70), 0) / totalDays);

      document.getElementById('agg-lbl-1').textContent = '선택 기간 평균 신체부하';
      const agg1 = document.getElementById('agg-avg-sleep');
      agg1.textContent = `${avgStrain.toFixed(1)} / 21.0`;
      agg1.style.color = '#C084FC';

      document.getElementById('agg-lbl-2').textContent = '최적 밸런스 달성률';
      document.getElementById('agg-target-met-pct').textContent = `${optimalPct}% (${optimalCount}/${totalDays}일)`;

      document.getElementById('agg-lbl-3').textContent = '기간 최고 부하일';
      const maxDateParts = maxDay.date.split('-');
      document.getElementById('agg-avg-bedtime').textContent = `${Number(maxDateParts[1])}/${Number(maxDateParts[2])} (${(maxDay.day_strain || 14).toFixed(1)})`;

      document.getElementById('agg-lbl-4').textContent = '평균 회복도 점수';
      document.getElementById('agg-avg-waketime').textContent = `${avgRecovery}점`;

      slice.forEach((day, i) => {
        const col = document.createElement('div');
        col.className = 'chart-col';
        if (i === slice.length - 1) col.classList.add('selected');

        const strainVal = day.day_strain || 14.0;
        const heightPct = Math.min(100, Math.max(10, (strainVal / 21.0) * 100));

        // Recovery dot position (bottom % based on condition_score 0~100)
        const recScore = day.condition_score || 75;
        const dotBottom = Math.max(8, Math.min(92, recScore));
        const dotClass = recScore >= 80 ? 'recovery-high' : (recScore >= 65 ? 'recovery-mid' : 'recovery-low');

        const dateParts = day.date.split('-');
        const shortDate = `${Number(dateParts[1])}/${Number(dateParts[2])}`;

        col.innerHTML = `
          <div class="chart-bar-fill strain-bar" style="height: ${heightPct}%;"></div>
          <div class="chart-col-dot ${dotClass}" style="bottom: ${dotBottom}%;" title="회복도 ${recScore}점"></div>
          <span class="chart-col-date">${shortDate}</span>
        `;

        col.addEventListener('click', () => {
          chartContainer.querySelectorAll('.chart-col').forEach(c => c.classList.remove('selected'));
          col.classList.add('selected');
          updateSelectedDayCard(day, 'strain');
        });

        chartContainer.appendChild(col);
      });

      updateSelectedDayCard(slice[slice.length - 1], 'strain');
    }
  }

  function updateSelectedDayCard(day, mode = currentMetricMode) {
    if (!day) return;
    const scoreBadge = document.getElementById('sel-day-score');

    if (mode === 'strain') {
      const strainVal = day.day_strain ? day.day_strain.toFixed(1) : '14.0';
      const balState = day.balance_state ? day.balance_state.split(' (')[0] : '최적 훈련 밸런스';
      const balClass = day.balance_class || 'success';

      document.getElementById('sel-day-date').textContent = `${day.date} · ${balState}`;
      scoreBadge.textContent = `회복도 ${day.condition_score}점`;
      scoreBadge.className = `badge-tag ${balClass}`;

      document.getElementById('sel-day-sleep').innerHTML = `<span style="color: var(--accent-purple); font-weight: 700;">${strainVal}</span> / 21.0`;
      document.getElementById('sel-day-debt').innerHTML = `<span style="color: var(--accent-cyan); font-weight: 700;">${day.strain_target || '14.0~17.5'}</span>`;
      document.getElementById('sel-day-window').textContent = day.strain_zone ? day.strain_zone.split(' (')[0] : '고강도 최적';
      document.getElementById('sel-day-eff').innerHTML = `<span class="badge-tag ${balClass}">${balState}</span>`;
    } else {
      document.getElementById('sel-day-date').textContent = `${day.date} (${day.asleep_hm})`;
      scoreBadge.textContent = `회복도 ${day.condition_score}점`;

      if (day.condition_score >= 80) scoreBadge.className = 'badge-tag success';
      else if (day.condition_score >= 65) scoreBadge.className = 'badge-tag warning';
      else scoreBadge.className = 'badge-tag danger';

      document.getElementById('sel-day-sleep').textContent = `${day.asleep_hm} (깊은수면 ${day.deep_hm || '-'})`;
      document.getElementById('sel-day-debt').textContent = day.exponential_debt_hm || '0시간';
      document.getElementById('sel-day-window').textContent = `${day.bed_time} ~ ${day.wake_time}`;
      document.getElementById('sel-day-eff').textContent = `${day.efficiency}%`;
    }
  }

  function renderHistoryTable(history) {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';
    document.getElementById('table-record-count').textContent = history.length;

    // Show newest first
    const reversed = [...history].reverse();
    reversed.forEach(row => {
      const tr = document.createElement('tr');
      const strainVal = row.day_strain ? row.day_strain.toFixed(1) : '-';
      tr.innerHTML = `
        <td style="font-weight: 600;">${row.date}</td>
        <td style="font-weight: 700; color: #34D399;">${row.asleep_hm}</td>
        <td>${row.bed_time}~${row.wake_time}</td>
        <td>${row.efficiency}%</td>
        <td style="color: #FBBF24;">${row.exponential_debt_hm}</td>
        <td><span class="badge-tag ${row.condition_score >= 80 ? 'success' : row.condition_score >= 65 ? 'warning' : 'danger'}">${row.condition_score}점</span></td>
        <td><span style="font-weight: 700; color: #C084FC;">${strainVal}</span> <small style="color: var(--text-muted);">/21</small></td>
      `;
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

    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      currentTargetHours = val;
      sliderVal.textContent = `${val.toFixed(1)}시간`;

      // Dynamically recalculate debt across history
      recalculateDebtLocally(data.all_history, val);
      renderTrends(data.all_history, currentPeriod);
    });
  }

  function recalculateDebtLocally(history, targetH) {
    history.forEach((day, idx) => {
      const startIdx = Math.max(0, idx - 13);
      const window = history.slice(startIdx, idx + 1);
      const reversed = [...window].reverse();

      let weightedSum = 0;
      let weightSum = 0;
      reversed.forEach((past, d) => {
        const deficit = Math.max(0, targetH - past.asleep_hours);
        const w = Math.exp(-0.15 * d);
        weightedSum += deficit * w;
        weightSum += w;
      });

      const expDebt = (weightedSum / Math.max(0.001, weightSum)) * (1.0 + Math.min(13, idx) * 0.15);
      day.exponential_debt_hours = Math.round(expDebt * 100) / 100;
      day.exponential_debt_hm = toHm(day.exponential_debt_hours);

      // Recompute condition score
      const timeScore = Math.min(40, (day.asleep_hours / targetH) * 40);
      const effScore = Math.min(30, (day.efficiency / 100) * 30);
      const qualityScore = 20;
      const debtPenalty = Math.min(20, expDebt * 2.2);
      day.condition_score = Math.round(Math.max(40, Math.min(100, timeScore + effScore + qualityScore - debtPenalty)));

      // Update strain target based on updated condition score
      if (day.condition_score >= 80) {
        day.strain_target = "14.0 ~ 17.5";
        day.strain_zone = "고강도 운동 최적 (Optimal)";
      } else if (day.condition_score >= 65) {
        day.strain_target = "10.0 ~ 14.0";
        day.strain_zone = "중강도 유지 (Maintenance)";
      } else {
        day.strain_target = "6.0 ~ 10.0";
        day.strain_zone = "능동적 회복 (Active Recovery)";
      }
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
