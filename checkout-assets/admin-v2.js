/* =============================================================
   Spark Admin V2 — tab navigation + data loaders per tab
   ============================================================= */

import {
  countUp, attachRipple, attachRippleAll, backgroundPulse, toast,
  progressStart, progressDone, confetti, staggerReveal, moveNavIndicator,
} from "./admin-fx.js";

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
   Auth — chave em memória (primária) + cookie (persistência)
   ===================================================== */
let ADMIN_KEY = null;

function captureKey() {
  // 1) Prioridade: ?k= na URL → memória + cookie
  const p = new URLSearchParams(location.search);
  const fromUrl = p.get("k");
  if (fromUrl) {
    ADMIN_KEY = fromUrl;
    try {
      document.cookie = `${COOKIE_KEY}=${encodeURIComponent(fromUrl)}; max-age=86400; path=/; samesite=lax`;
    } catch {}
    return;
  }
  // 2) Fallback: cookie de sessão anterior
  ADMIN_KEY = getCookieKey();
}
function getCookieKey() {
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE_KEY + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function cleanUrl() {
  // Remove ?k= da URL só DEPOIS da auth confirmar (cosmético/segurança)
  try {
    const url = new URL(location.href);
    if (url.searchParams.has("k")) {
      url.searchParams.delete("k");
      history.replaceState(null, "", url.toString());
    }
  } catch {}
}
async function authCheck() {
  if (!ADMIN_KEY) return false;
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
  progressStart();
  try {
    return await fetch(API + qs, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        "x-spark-admin-key": ADMIN_KEY || "",
        ...(opts.body ? { "content-type": "application/json" } : {}),
      },
    });
  } finally {
    progressDone();
  }
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
  const nav = document.querySelector(".bottom-nav");
  $$(".nav-btn[data-go]").forEach((btn) => {
    attachRipple(btn);
    btn.addEventListener("click", () => switchTo(btn.dataset.go, btn));
  });
  // Posiciona o indicador deslizante no botão ativo inicial
  const active = document.querySelector(".nav-btn.is-active");
  if (nav && active) requestAnimationFrame(() => moveNavIndicator(nav, active));
  window.addEventListener("resize", () => {
    const a = document.querySelector(".nav-btn.is-active");
    if (nav && a) moveNavIndicator(nav, a);
  });
}
function switchTo(tab, originBtn) {
  if (currentTab === tab) return;
  currentTab = tab;
  const nav = document.querySelector(".bottom-nav");
  const btn = originBtn || document.querySelector(`.nav-btn[data-go="${tab}"]`);

  $$(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.go === tab));
  if (nav && btn) moveNavIndicator(nav, btn);

  // Background pulse a partir do botão clicado
  backgroundPulse(btn);

  $$(".tab[data-tab]").forEach((s) => { s.hidden = s.dataset.tab !== tab; });

  // Stagger reveal dos cards/itens do tab
  const panel = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (panel) {
    const targets = panel.querySelectorAll(".kpi-card, .card, .op-card, .lb-item");
    if (targets.length) staggerReveal(panel, ".kpi-card, .card, .op-card", 70);
  }

  if (TAB_LOADERS[tab]) TAB_LOADERS[tab]();
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
        toast(data.message || data.error || "Erro ao criar indicação", { type: "error", title: "Falha" });
        return;
      }
      setStatus("form-status", "", "");
      toast(`${data.referral.indicado_name} → ${data.indicador_name}`, {
        type: "success",
        title: "Indicação registrada",
      });
      confetti();
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
        <div class="kpi-card__value" data-count="${d.mrr_estimated_usd}" data-prefix="$" data-suffix="/mês">$0</div>
        <div class="kpi-card__detail">de ${d.referrals.qualified} indicações qualificadas</div>
      </div>
      <div class="kpi-card kpi-card--green">
        <div class="kpi-card__label">Indicações este mês</div>
        <div class="kpi-card__value" data-count="${d.referrals.this_month}">0</div>
        <div class="kpi-card__detail">${d.referrals.paid} paid · ${d.referrals.qualified} qualified</div>
      </div>
      <div class="kpi-card kpi-card--violet">
        <div class="kpi-card__label">Taxa de Conversão</div>
        <div class="kpi-card__value" data-count="${d.conversion_rate}" data-suffix="%">0%</div>
        <div class="kpi-card__detail">paid → qualified</div>
      </div>
      <div class="kpi-card kpi-card--amber">
        <div class="kpi-card__label">Locations Ativas</div>
        <div class="kpi-card__value" data-count="${d.locations_total}">0</div>
        <div class="kpi-card__detail">sub-accounts no GHL</div>
      </div>
    `;
    // Count-up em cada KPI
    $("kpi-grid").querySelectorAll("[data-count]").forEach((el) => {
      const small = el.dataset.suffix
        ? `<small>${el.dataset.suffix}</small>`
        : "";
      countUp(el, Number(el.dataset.count), {
        prefix: el.dataset.prefix || "",
        duration: 1000,
      });
      // re-append suffix visual após count
      if (el.dataset.suffix) {
        setTimeout(() => {
          el.innerHTML = `${el.dataset.prefix || ""}${Number(el.dataset.count).toLocaleString("en-US")}${small}`;
        }, 1050);
      }
    });
    staggerReveal($("kpi-grid"), ".kpi-card", 80);

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

const CUPOM_META = {
  INDICACAO_STARTER: { tier: "Starter", plan: "$79/mês", discount: "$40 off", duration: "por 3 meses", color: "iniciante" },
  INDICACAO_GROWTH: { tier: "Growth", plan: "$120/mês + $99 ativação", discount: "$50 off", duration: "1ª fatura", color: "intermediario" },
  INDICACAO_SCALE: { tier: "Scale", plan: "$250/mês + $199 ativação", discount: "$100 off", duration: "1ª fatura", color: "muito-avancado" },
};

async function loadCupons() {
  const root = $("cupons-global");
  root.innerHTML = '<div class="empty">Carregando…</div>';
  try {
    const r = await api("?action=cupons");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "erro");
    root.innerHTML = d.global
      .map((c) => {
        const m = CUPOM_META[c.code] || { tier: "—", plan: "", discount: "", duration: "", color: "none" };
        return `<div class="cupom-card cupom-card--${m.color}">
          <div class="cupom-card__head">
            <span class="cupom-card__tier">${tierBadge(m.color)}</span>
            <span class="cupom-card__uses">${c.times_used} ${c.times_used === 1 ? "uso" : "usos"}</span>
          </div>
          <div class="cupom-card__code">${escapeHtml(c.code)}</div>
          <div class="cupom-card__plan">${escapeHtml(m.plan)}</div>
          <div class="cupom-card__discount">
            <span class="cupom-card__off">${escapeHtml(m.discount)}</span>
            <span class="cupom-card__dur">${escapeHtml(m.duration)}</span>
          </div>
        </div>`;
      })
      .join("");
    staggerReveal(root, ".cupom-card", 90);
  } catch (err) {
    root.innerHTML = `<div class="empty">Erro: ${escapeHtml(err.message)}</div>`;
  }
}

/* =====================================================
   TAB: PLANOS (editar preços)
   ===================================================== */
TAB_LOADERS.planos = loadPlanos;
async function loadPlanos() {
  const root = $("plan-edit-grid");
  root.innerHTML = '<div class="empty">Carregando…</div>';
  try {
    const r = await api("?action=plans");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "erro");
    const plans = d.plans || [];
    root.innerHTML = plans.map(planCardHtml).join("");
    plans.forEach(wirePlanCard);
  } catch (err) {
    root.innerHTML = `<div class="empty">Erro: ${escapeHtml(err.message)}</div>`;
  }
}
function planCardHtml(p) {
  const isRepeating = p.indicacao_duration === "repeating";
  return `<div class="plan-edit" data-tier="${escapeHtml(p.tier)}">
    <div class="plan-edit__head">
      <h3>${escapeHtml(p.name)}</h3>
      <span class="plan-edit__tier">${escapeHtml(p.tier)}</span>
    </div>
    <label class="field"><span class="field__label">Mensalidade (USD)</span>
      <input class="input" type="number" min="0" step="1" data-f="monthly_usd" value="${Number(p.monthly_usd)}"/></label>
    <label class="field"><span class="field__label">Taxa de ativação (USD)</span>
      <input class="input" type="number" min="0" step="1" data-f="activation_usd" value="${Number(p.activation_usd)}"/></label>
    <div class="grid-2">
      <label class="field"><span class="field__label">Tipo de desconto</span>
        <select class="input" data-f="discount_type">
          <option value="amount" ${(p.discount_type||"amount")==="amount" ? "selected" : ""}>Valor ($)</option>
          <option value="percent" ${(p.discount_type)==="percent" ? "selected" : ""}>Percentual (%)</option>
        </select></label>
      <label class="field"><span class="field__label">Valor do desconto</span>
        <input class="input" type="number" min="0" step="1" data-f="indicacao_discount_usd" value="${Number(p.indicacao_discount_usd)}"/></label>
    </div>
    <div class="grid-2">
      <label class="field"><span class="field__label">Duração</span>
        <select class="input" data-f="indicacao_duration">
          <option value="once" ${!isRepeating ? "selected" : ""}>Uma vez (1ª fatura)</option>
          <option value="repeating" ${isRepeating ? "selected" : ""}>Recorrente (X meses)</option>
        </select></label>
      <label class="field"><span class="field__label">Meses (se recorrente)</span>
        <input class="input" type="number" min="1" max="36" step="1" data-f="indicacao_months" value="${p.indicacao_months ?? ""}"/></label>
    </div>
    <p class="plan-edit__tip">Dica: 100% + recorrente + 3 meses = 3 meses grátis.</p>
    <button class="btn btn--primary" data-save>Salvar ${escapeHtml(p.tier)}</button>
    <div class="field__hint" data-status></div>
  </div>`;
}
function wirePlanCard(p) {
  const card = document.querySelector(`.plan-edit[data-tier="${p.tier}"]`);
  if (!card) return;
  const btn = card.querySelector("[data-save]");
  const status = card.querySelector("[data-status]");
  btn.addEventListener("click", async () => {
    const body = { tier: p.tier };
    card.querySelectorAll("[data-f]").forEach((inp) => {
      let v = inp.value;
      const f = inp.dataset.f;
      if (f === "indicacao_duration" || f === "discount_type") body[f] = v;
      else if (f === "indicacao_months") body[f] = v === "" ? "" : Number(v);
      else body[f] = Number(v);
    });
    btn.disabled = true;
    status.textContent = "Salvando…"; status.dataset.state = "info";
    try {
      const r = await api("?action=update_plan", { method: "POST", body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { status.textContent = d.message || d.error || "erro"; status.dataset.state = "err"; }
      else {
        status.textContent = "✓ Salvo" + (d.coupon_recreated ? " (cupom recriado)" : "");
        status.dataset.state = "ok";
        toast(`Plano ${p.tier} atualizado`, { type: "success" });
      }
    } catch (err) {
      status.textContent = err.message; status.dataset.state = "err";
    }
    btn.disabled = false;
  });
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
  captureKey();
  if (!(await authCheck())) {
    showLocked();
    return;
  }
  cleanUrl();
  showApp();
  setupTabs();
  setupIndicacoes();
  setupOps();

  // Ripple em todos os botões primários/ghost
  attachRippleAll(".btn");

  // Initial tab from hash or default
  const hash = location.hash.replace("#", "");
  const validTabs = ["indicacoes", "inicio", "locations", "ranking", "atividade", "cupons", "planos", "ops"];
  const initial = validTabs.includes(hash) ? hash : "indicacoes";
  // força o switch (currentTab começa null)
  switchTo(initial, document.querySelector(`.nav-btn[data-go="${initial}"]`));

  toast("Bem-vindo ao painel Spark", { type: "info", duration: 2600 });
})();
