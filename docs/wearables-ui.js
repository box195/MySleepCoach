/**
 * Wearable catalog/details UI for MySleepCoach.
 * Depends only on the derived `data.wearables` object; raw health records are not rendered or cached.
 */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const STATUS = {
    ok: ["데이터 있음", "success"],
    no_data: ["기록 없음", "info"],
    permission: ["권한 없음", "warning"],
    unsupported: ["계정/기기 미지원", "info"],
    error: ["조회 오류", "danger"],
    partial: ["일부 데이터", "warning"]
  };
  const CATEGORY_LABELS = {
    sleep: "수면",
    vitals: "생체 지표",
    activity: "활동 · 운동 · 에너지",
    body: "신체 측정"
  };

  function injectStyle() {
    if (document.getElementById("wearable-ui-style")) return;
    const style = document.createElement("style");
    style.id = "wearable-ui-style";
    style.textContent = `
      .wearable-home-grid,.wearable-type-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
      .wearable-mini,.wearable-type-card{padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.025)}
      .wearable-mini-label,.wearable-type-name{font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700}
      .wearable-mini-value{font-size:21px;font-weight:800;margin:5px 0}
      .wearable-meta{font-size:11px;color:var(--text-muted,#94a3b8);line-height:1.5;overflow-wrap:anywhere}
      .wearable-category{margin-top:18px}
      .wearable-category h3{font-size:15px;margin:0 0 10px}
      .wearable-type-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
      .wearable-type-value{font-size:18px;font-weight:800;margin-bottom:4px}
      .wearable-history{margin-top:10px;max-height:240px;overflow:auto}
      .wearable-history table{width:100%;border-collapse:collapse;font-size:11px}
      .wearable-history td{padding:6px 4px;border-top:1px solid rgba(255,255,255,.06);vertical-align:top}
      .wearable-history td:first-child{white-space:nowrap}
      .wearable-summary-line{font-size:12px;color:var(--text-muted,#94a3b8);margin-top:7px}
      .wearable-method{font-size:11px;color:var(--text-muted,#94a3b8);margin-top:8px}
      .wearable-empty{padding:18px 0;color:var(--text-muted,#94a3b8);font-size:13px}
      @media(max-width:600px){.wearable-home-grid,.wearable-type-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  function ensureHomeSection() {
    if (document.getElementById("wearable-home-card")) return;
    const target = document.querySelector("#tab-today .metric-grid");
    if (!target) return;
    const section = document.createElement("section");
    section.className = "glass-card";
    section.id = "wearable-home-card";
    section.innerHTML = `
      <div class="section-title"><span>웨어러블 관측값</span><span class="badge-tag info" id="wearable-home-range">동기화 전</span></div>
      <div class="wearable-home-grid" id="wearable-home-grid">
        <div class="wearable-empty">Google Health 동기화 후 HRV, 심박수, SpO₂, 호흡수, 온도, 활동·신체 측정값을 표시합니다.</div>
      </div>`;
    target.insertAdjacentElement("afterend", section);
  }

  function ensureWearableTab() {
    if (document.getElementById("tab-wearables")) return;
    const science = document.getElementById("tab-science");
    const nav = document.querySelector(".tab-bar");
    if (!science || !nav) return;

    const main = document.createElement("main");
    main.id = "tab-wearables";
    main.className = "tab-content";
    main.innerHTML = `
      <section class="glass-card">
        <div class="section-title">
          <span>Google Health 웨어러블 데이터</span>
          <span class="badge-tag info" id="wearable-range-badge">동기화 전</span>
        </div>
        <div id="wearable-summary" class="wearable-summary-line">
          데이터 타입별로 권한·미지원·기록 없음·오류를 구분해 표시합니다.
        </div>
        <div id="wearable-categories"></div>
      </section>
      <section class="glass-card">
        <div class="section-title"><span>해석 기준</span></div>
        <div class="wearable-method" id="wearable-methodology">
          수면/컨디션 점수는 MySleepCoach 추정치이며 Google/Fitbit 공식 점수가 아닙니다.
        </div>
      </section>`;
    science.parentElement.appendChild(main);

    const button = document.createElement("button");
    button.className = "tab-btn";
    button.dataset.tab = "tab-wearables";
    button.innerHTML = `<span class="tab-icon">⌚</span><span class="tab-label">웨어러블</span>`;
    nav.appendChild(button);
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
      button.classList.add("active");
      main.classList.add("active");
    });
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderHome(data) {
    const grid = document.getElementById("wearable-home-grid");
    const badge = document.getElementById("wearable-home-range");
    if (!grid || !badge) return;
    const wearable = data?.wearables;
    const highlights = data?.today?.wearable_highlights || [];
    if (!wearable) {
      badge.textContent = "동기화 전";
      return;
    }
    badge.textContent = `${wearable.range.start} ~ ${wearable.range.end_exclusive} (미만)`;
    if (!highlights.length) {
      grid.innerHTML = `<div class="wearable-empty">현재 동기화 범위에서 표시할 관측값이 없습니다.</div>`;
      return;
    }
    grid.innerHTML = highlights.map(item => `
      <div class="wearable-mini">
        <div class="wearable-mini-label">${esc(item.label)}</div>
        <div class="wearable-mini-value">${esc(item.display)}</div>
        <div class="wearable-meta">${esc(item.date)}${item.detail ? ` · ${esc(item.detail)}` : ""}</div>
        <div class="wearable-meta">${esc(item.source)}</div>
      </div>`).join("");
  }

  function statusBadge(state) {
    const [label, klass] = STATUS[state?.status] || [state?.status || "알 수 없음", "info"];
    return `<span class="badge-tag ${klass}">${esc(label)}</span>`;
  }

  function renderType(state) {
    const latest = state.latest;
    const rows = Array.isArray(state.history) ? [...state.history].reverse() : [];
    const range = state.range || {};
    const history = rows.length ? `
      <div class="wearable-history"><table><tbody>${rows.map(row => `
        <tr>
          <td>${esc(row.date)}</td>
          <td><strong>${esc(row.display)}</strong>${row.detail ? `<div class="wearable-meta">${esc(row.detail)}</div>` : ""}</td>
          <td class="wearable-meta">${esc(row.source || "")}</td>
        </tr>`).join("")}</tbody></table></div>` : "";

    return `
      <article class="wearable-type-card">
        <div class="wearable-type-head">
          <div><div class="wearable-type-name">${esc(state.label)}</div><div class="wearable-meta">${esc(state.type)}</div></div>
          ${statusBadge(state)}
        </div>
        <div class="wearable-type-value">${latest ? esc(latest.display) : "-"}</div>
        <div class="wearable-meta">${latest ? `${esc(latest.date)} · ${esc(latest.source || "Google Health")}` : esc(state.message || "동기화 범위에 기록이 없습니다.")}</div>
        ${latest?.detail ? `<div class="wearable-meta">${esc(latest.detail)}</div>` : ""}
        <div class="wearable-summary-line">표시 ${esc(state.count)}일/건 · 원본 응답 ${esc(state.raw_count)}건 · ${esc(state.method)}</div>
        <div class="wearable-meta">${esc(range.start || "")} ~ ${esc(range.end_exclusive || "")} (미만)${state.page_count ? ` · ${esc(state.page_count)}페이지` : ""}</div>
        ${state.message && latest ? `<div class="wearable-meta">${esc(state.message)}</div>` : ""}
        ${history}
      </article>`;
  }

  function renderWearables(data) {
    renderHome(data);
    const wearable = data?.wearables;
    const holder = document.getElementById("wearable-categories");
    const rangeBadge = document.getElementById("wearable-range-badge");
    const summary = document.getElementById("wearable-summary");
    const method = document.getElementById("wearable-methodology");
    if (!holder || !rangeBadge || !summary || !method) return;
    if (!wearable) {
      holder.innerHTML = `<div class="wearable-empty">아직 웨어러블 데이터가 동기화되지 않았습니다.</div>`;
      return;
    }

    rangeBadge.textContent = `${wearable.range.days}일`;
    const counts = wearable.status_counts || {};
    summary.textContent =
      `${wearable.range.start} ~ ${wearable.range.end_exclusive} (미만) · ` +
      `데이터 ${counts.ok || 0} · 기록없음 ${counts.no_data || 0} · 권한없음 ${counts.permission || 0} · ` +
      `미지원 ${counts.unsupported || 0} · 오류 ${counts.error || 0}${counts.partial ? ` · 일부 ${counts.partial}` : ""}`;

    holder.innerHTML = Object.entries(wearable.categories || {}).map(([category, types]) => {
      const cards = types.map(type => wearable.types?.[type]).filter(Boolean).map(renderType).join("");
      return `<div class="wearable-category"><h3>${esc(CATEGORY_LABELS[category] || category)}</h3><div class="wearable-type-grid">${cards}</div></div>`;
    }).join("");

    const m = data.metric_methodology || {};
    method.innerHTML = [
      `<strong>효율:</strong> ${esc(m.sleep_efficiency || "앱 계산값")}`,
      `<strong>수면 점수:</strong> ${esc(m.google_sleep_score || m.sleep_score || "MySleepCoach 추정치")}`,
      `<strong>저장:</strong> 원본 Health 기록과 OAuth 토큰은 저장하지 않고 화면용 일별 요약만 이 기기 캐시에 저장합니다.`
    ].join("<br><br>");
  }

  function restore() {
    try {
      const cached = JSON.parse(localStorage.getItem("mysleepcoach.dashboard.v2") || "null");
      if (cached?.data) renderWearables(cached.data);
    } catch (_) {}
  }

  injectStyle();
  ensureHomeSection();
  ensureWearableTab();
  restore();
  window.addEventListener("mysleepcoach:wearables", event => renderWearables(event.detail));
});
