/**
 * Spark Tasks — CRM-wide notifier.
 *
 * Paste ONE line into GHL Agency Settings -> Company -> Custom JavaScript:
 *   <script src="https://spark-tasks-sigma.vercel.app/crm-notify.js" defer></script>
 *
 * Runs on every CRM page (all subaccounts). Polls the Spark Tasks feed with
 * the long-lived identity cookie (set when the user opens the module once)
 * and shows a branded pop-up + chime for new task notifications — no
 * extension, works while the user is anywhere in the CRM.
 *
 * Optional: limit to specific subaccounts:
 *   <script src=".../crm-notify.js" data-locations="locId1,locId2" defer></script>
 */
(function () {
  "use strict";
  var SCRIPT = document.currentScript;
  var API =
    SCRIPT && SCRIPT.src
      ? new URL(SCRIPT.src).origin
      : "https://spark-tasks-sigma.vercel.app";
  var POLL_MS = 25000;
  var LS_SEEN = "sparkTasks.notify.seen";
  var LS_SINCE = "sparkTasks.notify.since";
  var only =
    SCRIPT && SCRIPT.getAttribute("data-locations")
      ? SCRIPT.getAttribute("data-locations").split(",").map(function (s) { return s.trim(); })
      : null;

  var unlocked = false;
  var audioCtx = null;
  function unlock() {
    unlocked = true;
    document.removeEventListener("click", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  }
  document.addEventListener("click", unlock, true);
  document.addEventListener("keydown", unlock, true);

  function chime() {
    if (!unlocked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t = audioCtx.currentTime;
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.type = "sine";
      o.frequency.setValueAtTime(880, t);
      o.frequency.setValueAtTime(1174.66, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.start(t);
      o.stop(t + 0.6);
    } catch (e) {
      /* audio not available */
    }
  }

  var CSS =
    "#spark-notify-wrap{position:fixed;top:16px;right:16px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;font-family:Inter,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".spark-notify{position:relative;width:330px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #e4e7ec;border-left:3px solid #155eef;border-radius:12px;box-shadow:0 12px 16px -4px rgba(16,24,40,.18);padding:12px 14px;animation:sn-in .25s cubic-bezier(.16,1,.3,1)}" +
    ".spark-notify .sn-k{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#155eef}" +
    ".spark-notify .sn-t{font-size:13.5px;font-weight:600;color:#101828;margin-top:3px;word-break:break-word}" +
    ".spark-notify .sn-b{font-size:12.5px;color:#475467;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
    ".spark-notify .sn-x{position:absolute;top:7px;right:9px;border:none;background:none;color:#98a2b3;font-size:15px;line-height:1;cursor:pointer;padding:2px}" +
    ".spark-notify .sn-x:hover{color:#101828}" +
    ".spark-notify.sn-out{opacity:0;transform:translateX(16px);transition:all .3s}" +
    "@keyframes sn-in{from{opacity:0;transform:translateX(24px)}}";

  function ensureStyles() {
    if (document.getElementById("spark-notify-css")) return;
    var s = document.createElement("style");
    s.id = "spark-notify-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function wrap() {
    var w = document.getElementById("spark-notify-wrap");
    if (!w) {
      w = document.createElement("div");
      w.id = "spark-notify-wrap";
      document.body.appendChild(w);
    }
    return w;
  }

  function esc(s) {
    return String(s == null ? "" : s);
  }

  function show(n) {
    ensureStyles();
    var el = document.createElement("div");
    el.className = "spark-notify";
    var x = document.createElement("button");
    x.className = "sn-x";
    x.setAttribute("aria-label", "Close");
    x.innerHTML = "&times;";
    x.onclick = function (e) {
      e.stopPropagation();
      el.remove();
    };
    var k = document.createElement("div");
    k.className = "sn-k";
    k.textContent = "Spark Tasks";
    var t = document.createElement("div");
    t.className = "sn-t";
    t.textContent = esc(n.title);
    var b = document.createElement("div");
    b.className = "sn-b";
    b.textContent = esc(n.body);
    el.appendChild(x);
    el.appendChild(k);
    el.appendChild(t);
    if (n.body) el.appendChild(b);
    wrap().appendChild(el);
    setTimeout(function () {
      el.classList.add("sn-out");
      setTimeout(function () {
        el.remove();
      }, 320);
    }, 10000);
  }

  function loadSeen() {
    try {
      return JSON.parse(localStorage.getItem(LS_SEEN) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveSeen(ids) {
    try {
      localStorage.setItem(LS_SEEN, JSON.stringify(ids.slice(-60)));
    } catch (e) {
      /* full */
    }
  }
  function currentLocation() {
    var m = window.location.pathname.match(/\/location\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  var failures = 0;
  function poll() {
    // TENANT GUARD (client side): only poll while inside a location's pages,
    // and always report WHICH location — the server only answers when it
    // matches the identity cookie's location, so reminders can never render
    // in an unrelated subaccount.
    var loc = currentLocation();
    if (!loc) return; // agency-level pages: stay silent
    if (only && only.indexOf(loc) === -1) return;
    if (failures > 8) return; // identity cookie missing/expired — stand down
    var since = "";
    try {
      since = localStorage.getItem(LS_SINCE) || "";
    } catch (e) {
      /* ignore */
    }
    var qs = "?loc=" + encodeURIComponent(loc) + (since ? "&since=" + encodeURIComponent(since) : "");
    fetch(API + "/api/crm-notify" + qs, {
      credentials: "include",
    })
      .then(function (r) {
        if (r.status === 401) {
          failures++;
          throw new Error("401");
        }
        if (!r.ok) throw new Error(String(r.status));
        failures = 0;
        return r.json();
      })
      .then(function (data) {
        try {
          localStorage.setItem(LS_SINCE, data.serverTime);
        } catch (e) {
          /* ignore */
        }
        var seen = loadSeen();
        var fresh = (data.notifications || []).filter(function (n) {
          return seen.indexOf(n.id) === -1;
        });
        if (fresh.length) {
          fresh.reverse().forEach(show);
          chime();
          saveSeen(
            seen.concat(
              fresh.map(function (n) {
                return n.id;
              }),
            ),
          );
        }
      })
      .catch(function () {
        /* transient */
      });
  }

  setTimeout(poll, 4000);
  setInterval(poll, POLL_MS);
})();
