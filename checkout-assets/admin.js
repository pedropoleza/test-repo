/* =============================================================
   Spark Admin — manual referral creation
   ============================================================= */

const COOKIE_KEY = "spark_admin_key";

const $ = (id) => document.getElementById(id);

/* --------- Auth via URL param + cookie --------- */
function captureKeyFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const key = p.get("k");
  if (key) {
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(key)}; max-age=86400; path=/; samesite=lax`;
    // Limpa da URL
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("k");
      history.replaceState(null, "", url.toString());
    } catch {}
  }
}
function getCookieKey() {
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE_KEY + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

async function authCheck() {
  const key = getCookieKey();
  if (!key) return false;
  // Sanity check: ping endpoint admin
  try {
    const r = await fetch("/api/admin/referrals?limit=1", {
      headers: { "x-spark-admin-key": key },
    });
    return r.ok;
  } catch {
    return false;
  }
}

function showLocked() {
  $("locked").hidden = false;
  $("admin").hidden = true;
}
function showAdmin() {
  $("locked").hidden = true;
  $("admin").hidden = false;
}

/* --------- Locations cache for autocomplete --------- */
let locationsCache = null;
async function fetchLocations() {
  if (locationsCache) return locationsCache;
  const key = getCookieKey();
  try {
    const r = await fetch("/api/admin/referrals?action=list_locations", {
      headers: { "x-spark-admin-key": key },
    });
    // Backend não tem essa action — vou usar uma estratégia diferente:
    // chamamos via /api/cupom como source. Mas /api/cupom precisa de
    // locationId... então fazemos lookup via Supabase diretamente seria
    // o ideal. Por simplicidade, vou listar locations via /api/admin/referrals
    // que retorna referrals (não locations).
  } catch {}
  // Fallback: tenta carregar via outro endpoint
  return null;
}

/* Indicator autocomplete (busca por nome ou ID em installations) */
function setupIndicadorSearch() {
  const input = $("indicador-search");
  const results = $("search-results");
  let timer = null;
  let selectedId = null;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => doSearch(input.value.trim()), 200);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) doSearch(input.value.trim());
  });
  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.hidden = true;
    }
  });

  async function doSearch(q) {
    if (!q || q.length < 2) {
      results.hidden = true;
      return;
    }
    // Backend search endpoint — usamos /api/admin/referrals com modo location_search
    const key = getCookieKey();
    try {
      const r = await fetch(
        `/api/admin/referrals?action=search_locations&q=${encodeURIComponent(q)}`,
        { headers: { "x-spark-admin-key": key } },
      );
      const data = await r.json();
      renderResults(data.locations || []);
    } catch {
      renderResults([]);
    }
  }

  function renderResults(list) {
    if (!list.length) {
      results.innerHTML = '<div class="search-results__empty">Nada encontrado</div>';
      results.hidden = false;
      return;
    }
    results.innerHTML = list
      .map(
        (l) =>
          `<div class="search-results__item" data-id="${escapeAttr(l.location_id)}">
             <span class="search-results__name">${escapeHtml(l.location_name || "(sem nome)")}</span>
             <span class="search-results__id">${escapeHtml(l.location_id)}</span>
           </div>`,
      )
      .join("");
    results.hidden = false;
    results.querySelectorAll(".search-results__item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        const name = el.querySelector(".search-results__name").textContent;
        input.value = `${name} (${id.slice(0, 6)}…)`;
        selectedId = id;
        $("indicador-status").textContent = `✓ Selecionado: ${name}`;
        $("indicador-status").dataset.state = "ok";
        results.hidden = true;
      });
    });
  }

  // Permite colar locationId direto
  input.addEventListener("blur", () => {
    setTimeout(() => {
      const v = input.value.trim();
      if (/^[A-Za-z0-9]{15,30}$/.test(v)) {
        selectedId = v;
        $("indicador-status").textContent = `✓ ID válido: ${v}`;
        $("indicador-status").dataset.state = "ok";
      }
    }, 250);
  });

  return {
    getSelectedId: () => selectedId,
    clear: () => {
      selectedId = null;
      input.value = "";
      $("indicador-status").textContent = "";
      $("indicador-status").dataset.state = "";
    },
  };
}

/* --------- Recent referrals list --------- */
async function loadRecent() {
  const key = getCookieKey();
  const root = $("recent-list");
  root.innerHTML = '<div class="recent__loading">Carregando…</div>';
  try {
    const r = await fetch("/api/admin/referrals?limit=50", {
      headers: { "x-spark-admin-key": key },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "erro");
    renderRecent(data.referrals || []);
  } catch (err) {
    root.innerHTML = `<div class="recent__loading">Erro: ${escapeHtml(err.message)}</div>`;
  }
}
function renderRecent(list) {
  const root = $("recent-list");
  if (!list.length) {
    root.innerHTML = '<div class="recent__loading">Nenhuma indicação ainda.</div>';
    return;
  }
  root.innerHTML = list
    .map((r) => {
      const date = new Date(r.created_at);
      const dateStr = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      });
      const tierLabel = r.tier_purchased
        ? r.tier_purchased.charAt(0).toUpperCase() + r.tier_purchased.slice(1)
        : "—";
      return `<div class="recent__item">
        <div class="recent__item-row">
          <span class="recent__item-name">${escapeHtml(r.indicado_name || r.indicado_email || "(sem nome)")}</span>
          <span class="recent__item-status recent__item-status--${r.status}">${escapeHtml(r.status)}</span>
        </div>
        <div class="recent__item-meta">
          <span>${dateStr}</span>
          <span>•</span>
          <span>${tierLabel}</span>
          <span>•</span>
          <span title="${escapeAttr(r.indicador_location)}">indicador ${escapeHtml(r.indicador_location.slice(0, 6))}…</span>
        </div>
      </div>`;
    })
    .join("");
}

/* --------- Form submit --------- */
function setupForm(search) {
  $("ref-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const key = getCookieKey();
    const indicadorId = search.getSelectedId();
    if (!indicadorId) {
      setFormStatus("Selecione o indicador.", "err");
      return;
    }
    const body = {
      indicador_location: indicadorId,
      indicado_email: $("indicado-email").value.trim().toLowerCase(),
      indicado_name: $("indicado-name").value.trim(),
      tier_purchased: $("tier-purchased").value || null,
      cupom_code: $("cupom-code").value.trim() || null,
      activation_paid: $("activation-paid").checked,
      status: $("status").value,
    };
    setFormStatus("Salvando…", "info");
    try {
      const r = await fetch("/api/admin/referrals", {
        method: "POST",
        headers: {
          "x-spark-admin-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setFormStatus(data.message || data.error || "erro", "err");
        return;
      }
      setFormStatus(
        `✓ Indicação criada — ${data.referral.indicado_name} (${data.indicador_name})`,
        "ok",
      );
      // Reset form
      $("ref-form").reset();
      search.clear();
      // Reload list
      loadRecent();
    } catch (err) {
      setFormStatus(err.message, "err");
    }
  });

  $("refresh-list").addEventListener("click", () => loadRecent());
}
function setFormStatus(text, state) {
  const el = $("form-status");
  el.textContent = text;
  el.dataset.state = state || "";
}

/* --------- Utils --------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) { return escapeHtml(s); }

/* --------- Boot --------- */
(async function init() {
  captureKeyFromUrl();
  const authed = await authCheck();
  if (!authed) {
    showLocked();
    return;
  }
  showAdmin();
  const search = setupIndicadorSearch();
  setupForm(search);
  loadRecent();
})();
