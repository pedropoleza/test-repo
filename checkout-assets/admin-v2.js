/* =============================================================
   Spark Admin V2 — tab navigation + data loaders per tab
   ============================================================= */

const COOKIE_KEY = "spark_admin_key";
const API = "/api/admin/referrals";
const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const TIER_LABEL = {
  none: "Sem nível",
  iniciante: "Iniciante",
  basico: "Básico",
  intermediario: "Intermediário",
  avancado: "Avançado",
  "muito-avancado": "Muito Avançado",
};

/* =====================================================
   Auth via URL param + cookie
   ===================================================== */
function captureKeyFromUrl() {
  const p = new URLSearchParams(location.search);
  const k = p.get("k");
  if (k) {
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(k)}; max-age=86400; path=/; samesite=lax`;
    try {
      const url = new URL(location.href);
      url.searchParams.delete("k");
      history.replaceState(null, "", url.toString());
    } catch {}
  }
}
function getKey() {
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE_KEY + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
async function authCheck() {
  if (!getKey()) return false;
  try {
    const r = await api("?limit=1");
    return r.ok;
  } catch {
    return false;
  }
}

/* =====================================================
   API helper
   ===================================================== */
async function api(qs = "", opts = {}) {
  const key = getKey();
  return fetch(API + qs, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      "x-spark-admin-key": key,
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
  });
}

/* =====================================================
   Utilities
   ===================================================== */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmtUsd(n) { return `$${(Number(n) || 0).toLocaleString("en-US")}`; }
function fmtRelativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d atrás`;
  const mo = Math.floor(d / 30);
  return `${mo}mês atrás`;
}
function fmtDateBR(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function tierBadge(tierId) {
  const label = TIER_LABEL[tierId] || tierId || "—";
  const cls = tierId || "none";
  return `<span class="tier-badge tier-badge--${escapeHtml(cls)}">${escapeHtml(label)}</span>`;
}

/* =====================================================
   Tab switching + lazy load
   ===================================================== */
const TAB_LOADERS = {};
let currentTab = null;
function setupTabs() {
  $$(".nav-btn[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => switchTo(btn.dataset.go));
  });
}
function switchTo(tab) {
  if (currentTab === tab) return;
  currentTab = tab;
  $$(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.go === tab));
  $$(".tab[data-tab]").forEach((s) => { s.hidden = s.dataset.tab !== tab; });
  // Lazy load
  if (TAB_LOADERS[tab]) TAB_LOADERS[tab]();
  // Update URL
  try { history.replaceState(null, "", `#${tab}`); } catch {}
}

/* =====================================================
   TAB: INDICACOES (manual create form + recent)
   ===================================================== */
function setupIndicacoes() {
  let selectedIndicador = null;
  const input = $("indicador-search");
  const results = $("search-results");
  let timer = null;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => doSearch(input.value.trim()), 200);
  });
  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.hidden = true;
    }
  });

  async function doSearch(q) {
    if (!q || q.length < 2) { results.hidden = true; return; }
    try {
      const r = await api(`?action=search_locations&q=${encodeURIComponent(q)}`);
      const data = await r.json();
      const list = data.locations || [];
      if (!list.length) {
        results.innerHTML = '<div class="autocomplete__empty">Nada encontrado</div>';
      } else {
        results.innerHTML = list
          .map(
            (l) => `<div class="autocomplete__item" data-id="${escapeHtml(l.location_id)}">
              <div class="autocomplete__name">${escapeHtml(l.location_name || "(sem nome)")}</div>
              <div class="autocomplete__id">${escapeHtml(l.location_id)}</div>
            </div>`,
          )
          .join("");
        results.querySelectorAll(".autocomplete__item").forEach((el) => {
          el.addEventListener("click", () => {
            const id = el.dataset.id;
            const name = el.querySelector(".autocomplete__name").textContent;
            input.value = `${name} (${id.slice(0, 6)}…)`;
            selectedIndicador = id;
            $("indicador-status").textContent = `✓ Selecionado: ${name}`;
            $("indicador-status").dataset.state = "ok";
            results.hidden = true;
          });
        });
      }
      results.hidden = false;
    } catch {
      results.hidden = true;
    }
  }
  // Allow pasting raw id
  input.addEventListener("blur", () => {
    setTimeout(() => {
      const v = input.value.trim();
      if (/^[A-Za-z0-9]{15,30}$/.test(v)) {
        selectedIndicador = v;
        $("indicador-status").textContent = `✓ ID válido: ${v}`;
        $("indicador-status").dataset.state = "ok";
      }
    }, 250);
  });

  $("ref-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!selectedIndicador) {
      setStatus("form-status", "Selecione o indicador.", "err");
      return;
    }
    const body = {
      indicador_location: selectedIndicador,
      indicado_email: $("indicado-email").value.trim().toLowerCase(),
      indicado_name: $("indicado-name").value.trim(),
      tier_purchased: $("tier-purchased").value || null,
      cupom_code: $("cupom-code").value.trim() || null,
      activation_paid: $("activation-paid").checked,
      status: $("status").value,
    };
    setStatus("form-status", "Salvando…", "info");
    try {
      const r = await api("", { method: "POST", body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) {
        setStatus("form-status", data.message || data.error || "erro", "err");
        return;
      }
      setStatus(
        "form-status",
        `✓ Criada: ${data.referral.indicado_name} → ${data.indicador_name}`,
        "ok",
      );
      $("ref-form").reset();
      selectedIndicador = null;
      input.value = "";
      $("indicador-status").textContent = "";
      loadRecent();
    } catch (err) {
      setStatus("form-status", err.message, "err");
    }
  });

  $("refresh-recent").addEventListener("click", loadRecent);
  loadRecent();
}

async function loadRecent() {
  const root = $("recent-list");
  root.innerHTML = '<div class="empty">Carregando…</div>';
  try {
    const r = await api("?limit=25");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "erro");
    const list = data.referrals || [];
    if (!list.length) {
      root.innerHTML = '<div class="empty">Nenhuma indicação ainda.</div>';
      return;
    }
    root.innerHTML = list
      .map((r) => `<div class="recent__item">
        <div class="recent__row">
          <span class="recent__name">${escapeHtml(r.indicado_name || r.indicado_email || "—")}</span>
          <span class="pill pill--${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>
        </div>
        <div class="recent__meta">
          <span>${fmtDateBR(r.created_at)}</span>
          <span>•</span>
          <span>${escapeHtml(r.tier_purchased || "—")}</span>
        </div>
      </div>`)
      .join("");
  } catch (err) {
    root.innerHTML = `<div class="empty">Erro: ${escapeHtml(err.message)}</div>`;
  }
}

function setStatus(id, text, state) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state || "";
}

/* =====================================================
   TAB: INICIO (dashboard)
   ===================================================== */
TAB_LOADERS.inicio = loadDashboard;
async function loadDashboard() {
  try {
    const r = await api("?action=dashboard");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "erro");

    $("kpi-grid").innerHTML = `
      <div class="kpi-card">
        <div class="kpi-card__label">MRR Estimado</div>
        <div class="kpi-card__value">${fmtUsd(d.mrr_estimated_usd)}<small>/mês</small></div>
        <div class="kpi-card__detail">de ${d.referrals.qualified} indicações qualificadas</div>
      </div>
      <div class="kpi-card kpi-card--green">
        <div class="kpi-card__label">Indicações este mês</div>
        <div class="kpi-card__value">${d.referrals.this_month}</div>
        <div class="kpi-card__detail">${d.referrals.paid} paid · ${d.referrals.qualified} qualified</div>
      </div>
      <div class="kpi-card kpi-card--violet">
        <div class="kpi-card__label">Taxa de Conversão</div>
        <div class="kpi-card__value">${d.conversion_rate}<small>%</small></div>
        <div class="kpi-card__detail">paid → qualified</div>
      </div>
      <div class="kpi-card kpi-card--amber">
        <div class="kpi-card__label">Locations Ativas</div>
        <div class="kpi-card__value">${d.locations_total}</div>
        <div class="kpi-card__detail">sub-accounts no GHL</div>
      </div>
    `;

    // Próximos a qualificar
    const qsRoot = $("qualifying-soon");
    if (!d.qualifying_soon.length) {
      qsRoot.innerHTML = '<div class="empty">Nenhuma indicação nos próximos 7 dias.</div>';
    } else {
      qsRoot.innerHTML = d.qualifying_soon
        .map((r) => {
          const daysLeft = Math.max(
            0,
            30 - Math.floor((Date.now() - new Date(r.first_payment_at).getTime()) / 86400000),
          );
          return `<div class="list__item">
            <div class="list__item-info">
              <div class="list__item-name">${escapeHtml(r.indicado_name || r.indicado_email)}</div>
              <div class="list__item-meta">indicador ${escapeHtml(r.indicador_location.slice(0, 6))}…</div>
            </div>
            <div class="list__item-value">${daysLeft}d</div>
          </div>`;
        })
        .join("");
    }

    // Top 3 do mês
    const tmRoot = $("top-month");
    if (!d.top_indicators_month.length) {
      tmRoot.innerHTML = '<div class="empty">Nenhuma qualificação este mês.</div>';
    } else {
      tmRoot.innerHTML = d.top_indicators_month
        .map(
          (t, i) =>
            `<div class="list__item">
              <div class="list__item-info">
                <div class="list__item-name">#${i + 1} ${escapeHtml(t.location_name || t.location_id)}</div>
                <div class="list__item-meta">${escapeHtml(t.location_id)}</div>
              </div>
              <div class="list__item-value">${t.qualified_count} ✓</div>
            </div>`,
        )
        .join("");
    }
  } catch (err) {
    $("kpi-grid").innerHTML = `<div class="empty">Erro: ${escapeHtml(err.message)}</div>`;
  }
}
$("refresh-dashboard")?.addEventListener("click", loadDashboard);

/* =====================================================
   TAB: LOCATIONS
   ===================================================== */
TAB_LOADERS.locations = loadLocations;
let locDebounce = null;
$("loc-search")?.addEventListener("input", () => {
  clearTimeout(locDebounce);
  locDebounce = setTimeout(loadLocations, 250);
});
$("loc-tier-filter")?.addEventListener("change", loadLocations);

async function loadLocations() {
  const tbody = $("locs-tbody");
  const foot = $("locs-foot");
  tbody.innerHTML = '<tr><td colspan="6"><div class="empty">Carregando…</div></td></tr>';
  const q = $("loc-search").value.trim();
  const tier = $("loc-tier-filter").value;
  const qs = new URLSearchParams({ action: "locations", limit: "100" });
  if (q) qs.set("q", q);
  if (tier) qs.set("tier", tier);
  try {
    const r = await api("?" + qs.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "erro");
    if (!d.locations.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty">Nenhuma location encontrada.</div></td></tr>';
      foot.textContent = "";
      return;
    }
    tbody.innerHTML = d.locations
      .map(
        (l) => `<tr>
          <td>
            <div style="font-weight:600;color:var(--text)">${escapeHtml(l.location_name || "—")}</div>
            <div style="font-size:11px;color:var(--text-faint);font-family:ui-monospace,monospace">${escapeHtml(l.location_id)}</div>
          </td>
          <td>${tierBadge(l.current_tier_id || "none")}</td>
          <td><strong>${l.qualified_count}</strong></td>
          <td style="font-family:ui-monospace,monospace;font-size:12px;color:var(--text-muted)">${escapeHtml(l.coupon_code || "—")}</td>
          <td><span class="pill pill--${l.status === "active" ? "qualified" : "pending"}">${escapeHtml(l.status)}</span></td>
          <td style="text-align:right"><button class="btn btn--ghost btn--icon" data-loc-recompute="${escapeHtml(l.location_id)}" title="Recompute tier">↻</button></td>
        </tr>`,
      )
      .join("");
    foot.textContent = `Mostrando ${d.locations.length} de ${d.total} locations`;
    // Wire recompute buttons
    tbody.querySelectorAll("[data-loc-recompute]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api(`?action=recompute_tier&locationId=${encodeURIComponent(btn.dataset.locRecompute)}`, { method: "POST" });
          loadLocations();
        } catch {} finally { btn.disabled = false; }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty">Erro: ${escapeHtml(err.message)}</div></td></tr>`;
  }
}

/* =====================================================
   TAB: RANKING
   ===================================================== */
TAB_LOADERS.ranking = loadRanking;
let lbPeriod = "all";
document.querySelectorAll(".seg__btn[data-period]").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".seg__btn").forEach((x) => x.classList.remove("is-active"));
    b.classList.add("is-active");
    lbPeriod = b.dataset.period;
    loadRanking();
  });
});

async function loadRanking() {
  const root = $("leaderboard");
  root.innerHTML = '<li class="lb-skel"></li><li class="lb-skel"></li><li class="lb-skel"></li>';
  try {
    const r = await api(`?action=leaderboard&period=${lbPeriod}&limit=20`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "erro");
    if (!d.leaderboard.length) {
      root.innerHTML = '<li class="empty">Nenhum indicador qualificou ainda.</li>';
      return;
    }
    root.innerHTML = d.leaderboard
      .map(
        (l) => `<li class="lb-item ${l.rank <= 3 ? `lb-item--top${l.rank}` : ""}">
          <div class="lb-item__rank">${l.rank}</div>
          <div>
            <div class="lb-item__name">${escapeHtml(l.location_name || "(sem nome)")}</div>
            <div class="lb-item__sub">${escapeHtml(l.location_id)}</div>
          </div>
          <div class="lb-item__count">${l.qualified_count}</div>
          <div class="lb-item__mrr">${fmtUsd(l.mrr_contribution_usd)}<br/><small style="color:var(--text-faint)">MRR</small></div>
        </li>`,
      )
      .join("");
  } catch (err) {
    root.innerHTML = `<li class="empty">Erro: ${escapeHtml(err.message)}</li>`;
  }
}

/* =====================================================
   TAB: ATIVIDADE
   ===================================================== */
TAB_LOADERS.atividade = loadActivity;
$("refresh-activity")?.addEventListener("click", loadActivity);

const ACTIVITY_ICONS = {
  "admin.referral_created": { icon: "+", cls: "green" },
  "admin.referral_updated": { icon: "✎", cls: "blue" },
  "admin.referral_deleted": { icon: "−", cls: "red" },
  "admin.bulk_recompute": { icon: "↻", cls: "violet" },
  "admin.bulk_sync": { icon: "⇄", cls: "violet" },
  "tier.transition": { icon: "↑", cls: "amber" },
  default: { icon: "•", cls: "blue" },
};

async function loadActivity() {
  const root = $("activity");
  root.innerHTML = '<li class="empty">Carregando…</li>';
  try {
    const r = await api("?action=activity&limit=100");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "erro");
    if (!d.activity.length) {
      root.innerHTML = '<li class="empty">Nenhum evento registrado ainda.</li>';
      return;
    }
    root.innerHTML = d.activity
      .map((a) => {
        const iconCfg = ACTIVITY_ICONS[a.event_type] || ACTIVITY_ICONS.default;
        return `<li class="activity__item">
          <div class="activity__icon activity__icon--${iconCfg.cls}">${iconCfg.icon}</div>
          <div class="activity__body">
            <div class="activity__summary">${escapeHtml(a.summary || a.event_type)}</div>
            <div class="activity__meta">${escapeHtml(a.event_type)} · ${escapeHtml(a.actor || "system")}${a.resource_id ? ` · ${escapeHtml(String(a.resource_id).slice(0, 8))}…` : ""}</div>
          </div>
          <div class="activity__time">${fmtRelativeTime(a.created_at)}</div>
        </li>`;
      })
      .join("");
  } catch (err) {
    root.innerHTML = `<li class="empty">Erro: ${escapeHtml(err.message)}</li>`;
  }
}

/* =====================================================
   TAB: CUPONS
   ===================================================== */
TAB_LOADERS.cupons = loadCupons;
let cuponsCache = null;
$("cupons-search")?.addEventListener("input", () => renderCupons());

async function loadCupons() {
  try {
    const r = await api("?action=cupons");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "erro");
    cuponsCache = d;
    // Global
    $("cupons-global").innerHTML = d.global
      .map((c) => {
        const tier = c.code.split("_")[1]?.toLowerCase() || "none";
        return `<div class="list__item">
          <div class="list__item-info">
            <div class="list__item-name" style="font-family:ui-monospace,monospace">${escapeHtml(c.code)}</div>
            <div class="list__item-meta">${tierBadge(tier === "starter" ? "iniciante" : tier)} cupom global</div>
          </div>
          <div class="list__item-value">${c.times_used} ${c.times_used === 1 ? "uso" : "usos"}</div>
        </div>`;
      })
      .join("");
    $("cupons-total").textContent = `(${d.total_per_location})`;
    renderCupons();
  } catch (err) {
    $("cupons-tbody").innerHTML = `<tr><td colspan="4"><div class="empty">Erro: ${escapeHtml(err.message)}</div></td></tr>`;
  }
}

function renderCupons() {
  if (!cuponsCache) return;
  const q = ($("cupons-search").value || "").trim().toLowerCase();
  const filtered = cuponsCache.per_location.filter(
    (c) =>
      !q ||
      c.code?.toLowerCase().includes(q) ||
      (c.location_name || "").toLowerCase().includes(q),
  );
  $("cupons-tbody").innerHTML = filtered
    .slice(0, 100)
    .map(
      (c) => `<tr>
        <td style="font-family:ui-monospace,monospace;font-size:12px;font-weight:600">${escapeHtml(c.code)}</td>
        <td>${escapeHtml(c.location_name || "—")}</td>
        <td><strong>${c.times_used}</strong></td>
        <td style="font-family:ui-monospace,monospace;font-size:11px;color:var(--text-faint)">${escapeHtml(c.stripe_promotion_id || "—")}</td>
      </tr>`,
    )
    .join("") || '<tr><td colspan="4"><div class="empty">Nada encontrado.</div></td></tr>';
}

/* =====================================================
   TAB: OPS
   ===================================================== */
function setupOps() {
  $("op-recompute").addEventListener("click", async () => {
    const btn = $("op-recompute");
    const status = $("op-recompute-status");
    btn.disabled = true;
    status.textContent = "Rodando…";
    try {
      const r = await api("?action=bulk_recompute", { method: "POST" });
      const d = await r.json();
      status.textContent = `✓ Recomputou ${d.summary?.recomputed}/${d.summary?.total} (${d.summary?.errors?.length || 0} erros)`;
    } catch (err) {
      status.textContent = `Erro: ${err.message}`;
    }
    btn.disabled = false;
  });

  $("op-sync").addEventListener("click", async () => {
    const btn = $("op-sync");
    const status = $("op-sync-status");
    btn.disabled = true;
    status.textContent = "Rodando…";
    try {
      const r = await api("?action=bulk_sync", { method: "POST" });
      const d = await r.json();
      status.textContent = `✓ ${d.summary?.processed} provisionadas. ${d.summary?.missing_total} ainda faltam.`;
    } catch (err) {
      status.textContent = `Erro: ${err.message}`;
    }
    btn.disabled = false;
  });

  $("op-export").addEventListener("click", async () => {
    const btn = $("op-export");
    const status = $("op-export-status");
    btn.disabled = true;
    status.textContent = "Preparando CSV…";
    try {
      const r = await api("?limit=500");
      const d = await r.json();
      const rows = d.referrals || [];
      if (!rows.length) {
        status.textContent = "Nenhuma indicação pra exportar.";
        btn.disabled = false;
        return;
      }
      const headers = [
        "id", "indicador_location", "indicado_name", "indicado_email",
        "tier_purchased", "cupom_code", "activation_paid", "status",
        "first_payment_at", "qualified_at", "disqualified_at", "created_at",
      ];
      const csv = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `indicacoes-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = `✓ ${rows.length} indicações exportadas`;
    } catch (err) {
      status.textContent = `Erro: ${err.message}`;
    }
    btn.disabled = false;
  });
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* =====================================================
   BOOT
   ===================================================== */
function showLocked() { $("locked").hidden = false; $("app").hidden = true; }
function showApp() { $("locked").hidden = true; $("app").hidden = false; }

(async function init() {
  captureKeyFromUrl();
  if (!(await authCheck())) {
    showLocked();
    return;
  }
  showApp();
  setupTabs();
  setupIndicacoes();
  setupOps();

  // Initial tab from hash or default
  const hash = location.hash.replace("#", "");
  const validTabs = ["indicacoes", "inicio", "locations", "ranking", "atividade", "cupons", "ops"];
  switchTo(validTabs.includes(hash) ? hash : "indicacoes");
})();
