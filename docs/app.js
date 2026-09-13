// ==========================================================================
// MySleepCoach - Interactive Dashboard Application Logic
// ==========================================================================

let globalData = null;
let currentTargetHours = 8.0;

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  loadData();
  initTargetSlider();
});

// 1. Tab Switching
function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const contents = document.querySelectorAll(".tab-content");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      buttons.forEach(b => b.classList.remove("active"));
      contents.forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      const targetContent = document.getElementById(targetTab);
      if (targetContent) {
        targetContent.classList.add("active");
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}

// 2. Fetch and render data
async function loadData() {
  try {
    const res = await fetch("data.json?t=" + new Date().getTime());
    if (!res.ok) throw new Error("Local data not found");
    globalData = await res.json();
    renderDashboard(globalData);
  } catch (err) {
    console.warn("Using fallback mock data (e.g. running from local file):", err);
    // Graceful fallback for offline / local viewing
    globalData = getFallbackData();
    renderDashboard(globalData);
  }
}

function renderDashboard(data) {
  if (!data || !data.today) return;

  const today = data.today;
  currentTargetHours = today.target_sleep_hours || 8.0;

  // Header info
  document.getElementById("device-name").textContent = today.device_name || "Google Fitbit Air";
  document.getElementById("current-date").textContent = today.date;

  // Recovery Condition Gauge Animation
  const score = today.condition_score;
  const scoreEl = document.getElementById("condition-score-val");
  animateValue(scoreEl, 0, score, 1000);

  const gaugePath = document.getElementById("condition-gauge-path");
  if (gaugePath) {
    // Circumference: 2 * PI * 70 = 439.82
    const totalLen = 440;
    const offset = totalLen - (totalLen * (score / 100));
    setTimeout(() => {
      gaugePath.style.strokeDashoffset = offset;
    }, 100);
  }

  // Recovery status pill
  const pillEl = document.getElementById("recovery-pill");
  const subtitleEl = document.getElementById("recovery-subtitle");
  if (score >= 80) {
    pillEl.textContent = "최적 회복 상태 ⚡";
    pillEl.style.color = "#34D399";
    pillEl.style.background = "rgba(16, 185, 129, 0.15)";
    pillEl.style.borderColor = "rgba(16, 185, 129, 0.3)";
    subtitleEl.textContent = "어젯밤 충분한 수면으로 신체 에너지가 완벽하게 충전되었습니다. 오늘 고강도 운동과 집중 업무를 추천합니다.";
  } else if (score >= 65) {
    pillEl.textContent = "적정 회복 상태 🔋";
    pillEl.style.color = "#FBBF24";
    pillEl.style.background = "rgba(245, 158, 11, 0.15)";
    pillEl.style.borderColor = "rgba(245, 158, 11, 0.3)";
    subtitleEl.textContent = "수면 시간은 양호하나 누적 부채가 일부 존재합니다. 오후 슬럼프 시간대에 가벼운 휴식을 취해주세요.";
  } else {
    pillEl.textContent = "피로 누적 주의 🪫";
    pillEl.style.color = "#F87171";
    pillEl.style.background = "rgba(239, 68, 68, 0.15)";
    pillEl.style.borderColor = "rgba(239, 68, 68, 0.3)";
    subtitleEl.textContent = "누적된 수면 부채로 인해 인지력과 체력이 저하될 수 있습니다. 오늘 밤 조기 취침을 권장합니다.";
  }

  // Quick 4 Tiles
  document.getElementById("quick-debt-val").textContent = today.exponential_debt_hm;
  const debtBadge = document.getElementById("quick-debt-badge");
  debtBadge.className = "badge-tag " + today.debt_badge_class;
  debtBadge.textContent = today.debt_status.split(" ")[0] + " " + today.debt_status.split(" ")[1];

  document.getElementById("quick-sleep-val").textContent = today.today_sleep_hm;
  document.getElementById("quick-balance-val").textContent = `목표 대비 ${today.daily_balance_hm}`;

  document.getElementById("quick-eff-val").textContent = today.sleep_efficiency + "%";
  document.getElementById("quick-stages-ratio").textContent = `깊은+렘 ${Math.round(((today.deep_hours + today.rem_hours) / today.today_sleep_hours) * 100)}%`;

  const activity = data.activity || {};
  document.getElementById("quick-strain-val").textContent = (activity.strain_score || 15.8) + " / 21";
  document.getElementById("quick-steps-val").textContent = (activity.steps || 7850).toLocaleString() + " 걸음";

  // Circadian Timeline
  renderCircadianTimeline(data.circadian_windows || []);

  // AI Coaching Box
  document.getElementById("ai-briefing-text").textContent = data.ai_briefing || "최신 분석 브리핑이 준비 중입니다.";

  // Sleep Detail Tab
  renderSleepStages(today);
  render14DayChart(data.recent_14_days || [], currentTargetHours);

  document.getElementById("detail-exp-debt").textContent = today.exponential_debt_hm;
  document.getElementById("detail-simple-debt").textContent = today.simple_debt_hm;
  document.getElementById("detail-avg-7d").textContent = today.avg_7d_sleep_hm;

  // Activity Tab
  renderActivityTab(activity, score);
}

// 3. Circadian Timeline Active Highlighting
function renderCircadianTimeline(windows) {
  const container = document.getElementById("circadian-timeline-list");
  container.innerHTML = "";

  const now = new Date();
  const currentHourMin = now.getHours() * 60 + now.getMinutes();

  windows.forEach((win) => {
    const item = document.createElement("div");
    item.className = "timeline-item";

    // Parse time range e.g. "11:11 ~ 12:41"
    const parts = win.time_range.split("~").map(s => s.trim());
    if (parts.length === 2) {
      const [sh, sm] = parts[0].split(":").map(Number);
      const [eh, em] = parts[1].split(":").map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;

      if (startMinutes <= currentHourMin && currentHourMin <= endMinutes) {
        item.classList.add("active");
        win.name += " 📍 [현재 구간]";
      }
    }

    item.innerHTML = `
      <div class="timeline-icon">${win.icon}</div>
      <div class="timeline-content">
        <div class="timeline-top">
          <span class="timeline-name">${win.name}</span>
          <span class="timeline-time">${win.time_range}</span>
        </div>
        <div class="timeline-desc">${win.desc}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

// 4. Sleep Stages Stack Bar
function renderSleepStages(today) {
  const total = today.today_sleep_hours + today.awake_hours;
  const deepPct = Math.round((today.deep_hours / total) * 100);
  const remPct = Math.round((today.rem_hours / total) * 100);
  const lightPct = Math.round((today.light_hours / total) * 100);
  const awakePct = 100 - (deepPct + remPct + lightPct);

  document.getElementById("seg-deep").style.width = deepPct + "%";
  document.getElementById("seg-rem").style.width = remPct + "%";
  document.getElementById("seg-light").style.width = lightPct + "%";
  document.getElementById("seg-awake").style.width = awakePct + "%";

  document.getElementById("val-deep").textContent = `${today.deep_hm} (${deepPct}%)`;
  document.getElementById("val-rem").textContent = `${today.rem_hm} (${remPct}%)`;
  document.getElementById("val-light").textContent = `${today.light_hm} (${lightPct}%)`;
  document.getElementById("val-awake").textContent = `${today.awake_hm} (${awakePct}%)`;
}

// 5. 14-Day Sleep Bar Chart
function render14DayChart(days, targetHours) {
  const container = document.getElementById("chart-bars");
  container.innerHTML = "";

  const maxHours = Math.max(12, ...days.map(d => Math.max(d.asleep_hours, targetHours)));

  days.forEach((d, idx) => {
    const col = document.createElement("div");
    col.className = "bar-col";
    if (idx === days.length - 1) col.classList.add("today");

    const heightPct = Math.min(100, Math.round((d.asleep_hours / maxHours) * 100));
    const isDeficit = d.asleep_hours < targetHours;
    if (isDeficit && idx !== days.length - 1) col.classList.add("deficit");

    const shortDate = d.date.slice(5).replace("-", "/");

    col.innerHTML = `
      <div class="bar-pillar" style="height: ${heightPct}%" title="${d.date}: ${d.asleep_hours}시간 (효율 ${d.efficiency}%)"></div>
      <span class="bar-date">${shortDate}</span>
    `;
    container.appendChild(col);
  });
}

// 6. Target Sleep Slider Interactivity
function initTargetSlider() {
  const slider = document.getElementById("target-slider");
  const display = document.getElementById("target-slider-val");

  slider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    display.textContent = val.toFixed(1) + "시간";
    currentTargetHours = val;

    if (globalData) {
      // Recalculate dynamic values in UI
      const todaySleep = globalData.today.today_sleep_hours;
      const diff = todaySleep - currentTargetHours;
      const sign = diff >= 0 ? "+" : "";
      document.getElementById("quick-balance-val").textContent = `목표 대비 ${sign}${diff.toFixed(1)}h`;

      // Update 14 day chart target visualization
      render14DayChart(globalData.recent_14_days || [], currentTargetHours);
    }
  });
}

// 7. Activity Tab
function renderActivityTab(activity, recoveryScore) {
  const steps = activity.steps || 7850;
  const goal = activity.step_goal || 10000;
  const pct = Math.min(100, Math.round((steps / goal) * 100));

  document.getElementById("act-steps-val").textContent = steps.toLocaleString();
  document.getElementById("act-steps-pct").textContent = pct + "% 달성";
  document.getElementById("act-steps-bar").style.width = pct + "%";

  document.getElementById("act-cal-val").textContent = (activity.calories || 2140).toLocaleString() + " kcal";
  document.getElementById("act-min-val").textContent = (activity.active_minutes || 45) + " 분";

  const strain = activity.strain_score || 15.8;
  document.getElementById("strain-score-val").textContent = strain;
  document.getElementById("strain-target-val").textContent = activity.strain_target || "14.0 ~ 17.0";
  document.getElementById("strain-rec-val").textContent = activity.strain_rec || "오늘 회복도에 맞춘 최적 훈련을 진행하세요.";

  // Animate strain ring (circumference = 2 * PI * 34 = 213.6)
  const ring = document.getElementById("strain-ring-circle");
  if (ring) {
    const total = 214;
    const offset = total - (total * (strain / 21));
    setTimeout(() => {
      ring.style.strokeDashoffset = offset;
    }, 200);
  }
}

// Number Counter Animation
function animateValue(el, start, end, duration) {
  if (!el) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    el.textContent = Math.floor(progress * (end - start) + start);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

// Fallback data if viewed directly via file://
function getFallbackData() {
  return {
    "today": {
      "date": "2026-09-13",
      "wake_time": "11:11",
      "today_sleep_hm": "10시간 27분",
      "today_sleep_hours": 10.45,
      "daily_balance_hm": "+2시간 27분",
      "target_sleep_hm": "8시간 0분",
      "target_sleep_hours": 8.0,
      "avg_7d_sleep_hm": "7시간 16분",
      "exponential_debt_hm": "4시간 50분",
      "exponential_debt_hours": 4.83,
      "simple_debt_hm": "12시간 47분",
      "debt_status": "🟡 주의 (오후 슬럼프 주의)",
      "debt_badge_class": "warning",
      "deep_hm": "1시간 39분",
      "deep_hours": 1.65,
      "rem_hm": "3시간 23분",
      "rem_hours": 3.38,
      "light_hm": "5시간 25분",
      "light_hours": 5.42,
      "awake_hm": "0시간 9분",
      "awake_hours": 0.15,
      "sleep_efficiency": 98,
      "condition_score": 88,
      "device_name": "Google Fitbit Air"
    },
    "circadian_windows": [
      { "id": "inertia", "name": "수면 관성 해소기", "time_range": "11:11 ~ 12:41", "icon": "☕", "desc": "미지근한 물 한 잔과 자연광 햇빛을 쬐세요." },
      { "id": "peak_1", "name": "오전 인지 피크 (골든아워)", "time_range": "13:41 ~ 16:41", "icon": "⚡", "desc": "코르티솔 활성도가 최고조에 달합니다." },
      { "id": "dip", "name": "서카디안 오후 슬럼프", "time_range": "18:11 ~ 20:11", "icon": "💤", "desc": "누적 부채로 나른함이 옵니다. 15분 파워냅 추천." },
      { "id": "peak_2", "name": "2차 신체 활력 피크", "time_range": "22:11 ~ 00:41", "icon": "🔥", "desc": "체온과 심폐 효율이 가장 높은 운동 타이밍입니다." }
    ],
    "activity": {
      "steps": 7850,
      "step_goal": 10000,
      "calories": 2140,
      "active_minutes": 45,
      "strain_score": 15.8,
      "strain_target": "14.0 ~ 17.0",
      "strain_rec": "회복도가 우수하므로 고강도 인터벌 러닝이나 웨이트 트레이닝을 추천합니다."
    },
    "ai_briefing": "☀️ 좋은 아침입니다!\n10시간 27분의 깊은 수면으로 신체 에너지는 충분히 회복되었습니다. 오후 슬럼프만 주의하시면 완벽한 하루가 될 것입니다."
  };
}
