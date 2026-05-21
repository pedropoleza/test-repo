/* =============================================================
   Spark Checkout — frontend logic
   3 steps: pick plan → fill form + apply coupon → pay (Stripe Elements)
   ============================================================= */

const STRIPE_PUBLISHABLE_KEY = "pk_live_REPLACEME"; // populated at runtime via /api endpoint

const TIERS = {
  starter: {
    name: "Spark Starter",
    monthlyUsd: 79,
    activationUsd: 0,
    cupom: "INDICACAO_STARTER",
    recurringNote: "$79/mês a partir do 4º mês",
  },
  growth: {
    name: "Spark Growth",
    monthlyUsd: 120,
    activationUsd: 99,
    cupom: "INDICACAO_GROWTH",
    recurringNote: "$120/mês recorrente",
  },
  scale: {
    name: "Spark Scale",
    monthlyUsd: 250,
    activationUsd: 199,
    cupom: "INDICACAO_SCALE",
    recurringNote: "$250/mês recorrente",
  },
};

let state = {
  step: 1,
  tier: null,
  coupon: null,
  couponValid: false,
  ref: null,
  stripe: null,
  elements: null,
  cardElement: null,
  clientSecret: null,
};

/* --------- Helpers --------- */
const $ = (id) => document.getElementById(id);
function showStep(n) {
  state.step = n;
  document.querySelectorAll(".step").forEach((s) => {
    s.hidden = Number(s.dataset.step) !== n;
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function fmtUsd(cents) {
  const v = (cents / 100).toFixed(2);
  return `$${v.replace(/\.00$/, "")}`;
}
function captureRef() {
  const p = new URLSearchParams(window.location.search);
  state.ref = p.get("ref") || p.get("referrer") || null;
}

/* --------- Stripe boot --------- */
async function bootStripe() {
  // Carrega a publishable key do servidor (sem hardcode no repo).
  // Resiliente: se falhar, não derruba o resto do init (parallax etc).
  try {
    const r = await fetch("/api/checkout/intent?action=pubkey");
    if (r.ok) {
      const j = await r.json();
      if (j.publishableKey && window.Stripe) {
        state.stripe = Stripe(j.publishableKey);
        return;
      }
    }
  } catch {}
  // Sem key válida (ex: preview local) → checkout de pagamento fica
  // indisponível, mas a UI/parallax renderiza normalmente.
  state.stripe = null;
}

/* --------- Plan selector (pills compactos) --------- */
function setupPlanSelector() {
  // Tier inicial: ?tier= da URL ou growth
  const p = new URLSearchParams(window.location.search);
  const urlTier = (p.get("tier") || p.get("plan") || "").toLowerCase();
  state.tier = TIERS[urlTier] ? urlTier : "growth";

  const pills = document.querySelectorAll(".plan-pill[data-tier]");
  pills.forEach((pill) => {
    pill.classList.toggle("is-active", pill.dataset.tier === state.tier);
    pill.addEventListener("click", () => {
      if (state.tier === pill.dataset.tier) return;
      state.tier = pill.dataset.tier;
      pills.forEach((x) => x.classList.toggle("is-active", x === pill));
      // Cupom aplicado pode não valer mais pro novo tier — revalida
      revalidateCoupon();
      renderSummary();
    });
  });

  renderSummary();
  mountCardElement();
}

function revalidateCoupon() {
  if (!state.coupon) return;
  const cfg = TIERS[state.tier];
  if (state.coupon !== cfg.cupom) {
    state.couponValid = false;
    setCouponStatus(
      `Cupom não vale pra ${cfg.name}. Use ${cfg.cupom}.`,
      "err",
    );
  } else {
    state.couponValid = true;
    setCouponStatus(`✓ Cupom ${state.coupon} aplicado`, "ok");
  }
}

/* --------- Card element mount --------- */
function mountCardElement() {
  if (state.cardElement || !state.stripe) return;
  state.elements = state.stripe.elements({
    fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500" }],
  });
  state.cardElement = state.elements.create("card", {
    style: {
      base: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "15px",
        color: "#e6ecf7",
        "::placeholder": { color: "#6b7691" },
        iconColor: "#fbbf24",
      },
      invalid: { color: "#ef4444", iconColor: "#ef4444" },
    },
  });
  state.cardElement.mount("#card-element");
  state.cardElement.on("change", (ev) => {
    $("card-error").textContent = ev.error?.message || "";
  });
}
function teardownCardElement() {
  if (state.cardElement) {
    state.cardElement.unmount();
    state.cardElement = null;
    state.elements = null;
  }
}

/* --------- Coupon validation --------- */
function setupCouponApply() {
  $("apply-coupon").addEventListener("click", () => {
    const code = $("f-coupon").value.trim().toUpperCase();
    if (!code) {
      state.coupon = null;
      state.couponValid = false;
      setCouponStatus("", "");
      renderSummary();
      return;
    }
    const cfg = TIERS[state.tier];
    if (code !== cfg.cupom) {
      state.coupon = code;
      state.couponValid = false;
      setCouponStatus(
        `Esse cupom não é válido pra ${cfg.name}. Cupom correto: ${cfg.cupom}`,
        "err",
      );
      renderSummary();
      return;
    }
    state.coupon = code;
    state.couponValid = true;
    setCouponStatus(`✓ Cupom ${code} aplicado`, "ok");
    renderSummary();
  });
}
function setCouponStatus(text, state) {
  const el = $("coupon-status");
  el.textContent = text;
  el.dataset.state = state || "";
}

/* --------- Summary --------- */
function renderSummary() {
  if (!state.tier) return;
  const cfg = TIERS[state.tier];
  $("summary-plan-name").textContent = cfg.name;
  $("summary-plan-tag").textContent =
    state.tier === "starter" ? "Sem taxa de ativação" : "Plano com taxa de ativação";

  const lines = [];
  lines.push({
    label: `${cfg.name} — mensalidade`,
    value: `$${cfg.monthlyUsd}.00`,
  });
  if (cfg.activationUsd > 0) {
    lines.push({
      label: "Taxa de ativação (única)",
      value: `$${cfg.activationUsd}.00`,
    });
  }

  let discountCents = 0;
  if (state.couponValid) {
    if (state.tier === "starter") {
      discountCents = 4000;
      lines.push({
        label: "Cupom INDICACAO_STARTER (×3 meses)",
        value: `−$40.00`,
        discount: true,
      });
    } else if (state.tier === "growth") {
      discountCents = 5000;
      lines.push({
        label: "Cupom INDICACAO_GROWTH",
        value: `−$50.00`,
        discount: true,
      });
    } else if (state.tier === "scale") {
      discountCents = 10000;
      lines.push({
        label: "Cupom INDICACAO_SCALE",
        value: `−$100.00`,
        discount: true,
      });
    }
  }

  const totalCents = (cfg.monthlyUsd + cfg.activationUsd) * 100 - discountCents;
  $("summary-total").textContent = fmtUsd(totalCents);
  $("summary-lines").innerHTML = lines
    .map(
      (l) =>
        `<div class="summary__line ${l.discount ? "summary__line--discount" : ""}">
           <span>${l.label}</span><strong>${l.value}</strong>
         </div>`,
    )
    .join("");

  // Recurring note
  let recurringHtml = "";
  if (state.tier === "starter") {
    if (state.couponValid) {
      recurringHtml = `<strong>Próximos 2 meses:</strong> $39/mês. Depois disso, $79/mês recorrente.`;
    } else {
      recurringHtml = `<strong>Recorrência:</strong> $79/mês todos os meses.`;
    }
  } else if (state.tier === "growth") {
    recurringHtml = `<strong>Recorrência:</strong> $120/mês a partir do 2º mês.`;
  } else if (state.tier === "scale") {
    recurringHtml = `<strong>Recorrência:</strong> $250/mês a partir do 2º mês.`;
  }
  $("summary-recurring").innerHTML = recurringHtml;
}

/* --------- Form validation / submit --------- */
// Botão sempre disponível; validação acontece no submit.
// Required: nome, email, telefone. Opcional: empresa, cupom.
function validateRequired() {
  const name = $("f-name").value.trim();
  const email = $("f-email").value.trim();
  const phone = $("f-phone").value.trim();
  const missing = [];
  if (name.length < 2) missing.push("nome");
  if (!/^\S+@\S+\.\S+$/.test(email)) missing.push("email");
  if (phone.replace(/\D/g, "").length < 8) missing.push("telefone");
  return missing;
}

function setupForm() {
  $("checkout-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await submitPayment();
  });
}

// Desktop = pointer fino + hover real (sem isso, sem overlay full-screen)
const isDesktopPointer =
  window.matchMedia &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

function setLoading(on) {
  const btn = $("submit-pay");
  const overlay = $("pay-overlay");
  if (on) {
    btn.classList.add("is-loading");
    btn.disabled = true;
    // Overlay full-screen só no desktop (mobile: só a logo no botão gira)
    if (isDesktopPointer && !prefersReduced) {
      overlay.hidden = false;
      requestAnimationFrame(() => overlay.classList.add("is-in"));
    }
  } else {
    btn.classList.remove("is-loading");
    btn.disabled = false;
    overlay.classList.remove("is-in");
    setTimeout(() => { overlay.hidden = true; }, 380);
  }
}

async function submitPayment() {
  $("card-error").textContent = "";
  // Valida campos base (nome/email/telefone)
  const missing = validateRequired();
  if (missing.length) {
    $("card-error").textContent = `Preencha: ${missing.join(", ")}.`;
    const focusId = { nome: "f-name", email: "f-email", telefone: "f-phone" }[missing[0]];
    $(focusId)?.focus();
    return;
  }
  if (!state.stripe || !state.cardElement) {
    $("card-error").textContent = "Pagamento indisponível. Recarregue a página.";
    return;
  }
  setLoading(true);

  try {
    const intentBody = {
      tier: state.tier,
      email: $("f-email").value.trim().toLowerCase(),
      name: $("f-name").value.trim(),
      phone: $("f-phone").value.trim(),
      company: $("f-company").value.trim(),
      cupomCode: state.couponValid ? state.coupon : null,
      ref: state.ref || null,
    };
    const r = await fetch("/api/checkout/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intentBody),
    });
    const data = await r.json();
    if (!r.ok || !data.clientSecret) {
      throw new Error(data.message || data.error || "Erro ao iniciar pagamento");
    }
    state.clientSecret = data.clientSecret;

    const result = await state.stripe.confirmCardPayment(state.clientSecret, {
      payment_method: {
        card: state.cardElement,
        billing_details: {
          name: $("f-name").value.trim(),
          email: $("f-email").value.trim().toLowerCase(),
          phone: $("f-phone").value.trim(),
        },
      },
    });
    if (result.error) {
      throw new Error(result.error.message || "Falha no pagamento");
    }

    // Sucesso — mantém a logo girando um instante e revela
    $("success-email").textContent = $("f-email").value.trim().toLowerCase();
    setTimeout(() => { setLoading(false); showStep(2); }, isDesktopPointer ? 500 : 0);
  } catch (err) {
    console.error("[checkout] error:", err);
    $("card-error").textContent = err.message || "Erro inesperado";
    setLoading(false);
  }
}

/* Fallback: se a logo do botão não carregar, mantém o texto */
function setupLogoFallback() {
  const img = $("pay-btn-logo-img");
  if (!img) return;
  img.addEventListener("error", () => {
    $("submit-pay").classList.add("no-logo");
  });
}

/* --------- 3D Parallax + tilt --------- */
const prefersReduced =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setupParallax() {
  if (prefersReduced) return;
  const layers = Array.from(document.querySelectorAll(".scene [data-depth]"));
  const content = Array.from(document.querySelectorAll("[data-parallax-content]"));
  let raf = null;
  let tx = 0, ty = 0;

  function onMove(e) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    tx = (e.clientX - cx) / cx; // -1..1
    ty = (e.clientY - cy) / cy;
    if (!raf) raf = requestAnimationFrame(apply);
  }
  function apply() {
    raf = null;
    // usa a propriedade `translate` (não `transform`) pra compor com as
    // animações CSS contínuas (auroraDrift/floatY/halftoneSway no transform)
    for (const el of layers) {
      const d = parseFloat(el.dataset.depth) || 0;
      el.style.translate = `${-tx * d * 60}px ${-ty * d * 60}px`;
    }
    for (const el of content) {
      const d = parseFloat(el.dataset.depth) || 0;
      el.style.translate = `${tx * d * 40}px ${ty * d * 40}px`;
    }
  }
  window.addEventListener("mousemove", onMove, { passive: true });
}

function setupTilt() {
  if (prefersReduced) return;
  document.querySelectorAll(".tilt, .tilt-soft").forEach((card) => {
    const soft = card.classList.contains("tilt-soft");
    const max = soft ? 5 : 10;
    let raf = null;
    let rx = 0, ry = 0, gx = 50, gy = 0;

    function onMove(e) {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width; // 0..1
      const py = (e.clientY - r.top) / r.height;
      ry = (px - 0.5) * max * 2;
      rx = -(py - 0.5) * max * 2;
      gx = px * 100;
      gy = py * 100;
      if (!raf) raf = requestAnimationFrame(apply);
    }
    function apply() {
      raf = null;
      card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.02)`;
      card.style.setProperty("--gx", `${gx}%`);
      card.style.setProperty("--gy", `${gy}%`);
    }
    function reset() {
      card.style.transform = "";
      card.style.setProperty("--gx", "50%");
      card.style.setProperty("--gy", "0%");
    }
    card.addEventListener("mousemove", onMove, { passive: true });
    card.addEventListener("mouseleave", reset);
  });
}

/* --------- Boot --------- */
(async function init() {
  captureRef();
  await bootStripe();
  setupPlanSelector();
  setupCouponApply();
  setupForm();
  setupParallax();
  setupTilt();
  setupLogoFallback();
})();

