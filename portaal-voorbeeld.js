/* =====================================================================
   BROS — testmodus voor de portalen (script 038)
   Een beheerder met testmodus opent vanuit het Planbord het klanten- of aannemersportaal met ?voorbeeld=klant|aannemer
   en ziet het zoals het gekozen contact het ziet. Alleen bekijken:
   - de databank geeft de gegevens van het contact enkel bij lezen (read-only + header X-Client-Info = bros-voorbeeld=<rol>);
   - hier worden bovendien alle schrijfacties (RPC's, opladen, mails via het Drive-script, de assistent) tegengehouden;
   - 'Uitloggen' stopt de testmodus (de login is dezelfde als die van het Planbord).
   Geladen vóór portaal.js / aannemer.js.
   ===================================================================== */
(function () {
  let param = null, cid = ""; try { const q = new URLSearchParams(location.search); param = q.get("voorbeeld"); cid = (q.get("c") || "").replace(/[^0-9a-f-]/gi, ""); } catch (e) { }
  const VB = { rol: null, info: null, echtRpc: null };
  const NEE = { data: null, error: { message: "Testmodus: alleen bekijken — er wordt niets bewaard of verstuurd." } };
  /* opties voor createClient: de header waaraan de databank de testmodus herkent */
  VB.start = function (eigenRol) {
    VB.rol = param === eigenRol ? eigenRol : null;
    return VB.rol ? { global: { headers: { "X-Client-Info": "bros-voorbeeld=" + VB.rol + ":" + cid } } } : undefined;   // het contact zit mee in de header: een ander tabblad met een vorig contact toont niets
  };
  VB.installeer = function (sb, cfg) {
    if (!VB.rol) return;
    const rpc = sb.rpc.bind(sb); VB.echtRpc = rpc;
    sb.rpc = async (fn, args) => fn === "voorbeeld_stop" ? rpc(fn, args) : NEE;
    const echteOpslag = sb.storage;
    const opslag = { from: (b) => { const o = echteOpslag.from(b); return { upload: async () => NEE, remove: async () => NEE, update: async () => NEE,
      getPublicUrl: (...x) => o.getPublicUrl(...x), createSignedUrl: (...x) => o.createSignedUrl(...x), download: (...x) => o.download(...x) }; } };
    try { Object.defineProperty(sb, "storage", { get: () => opslag, configurable: true }); } catch (e) { }
    const f = window.fetch.bind(window);
    window.fetch = (u, o) => {
      const s = String((u && u.url) || u || "");
      if ((cfg.driveScriptUrl && s.indexOf(cfg.driveScriptUrl) === 0) || s.indexOf("/functions/v1/") >= 0)
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: NEE.error.message }), { status: 200, headers: { "Content-Type": "application/json" } }));
      return f(u, o);
    };
    // uitloggen = testmodus stoppen (anders log je ook uit het Planbord: het is dezelfde login)
    document.addEventListener("click", (e) => { const el = e.target.closest('[data-act="logout"],[data-vb="stop"]'); if (!el) return; e.preventDefault(); e.stopImmediatePropagation(); VB.stop(); }, true);
  };
  /* is de testmodus actief voor deze login en dit portaal? */
  VB.laad = async function (sb) {
    try { const { data, error } = await sb.from("mijn_voorbeeld").select("*").maybeSingle(); VB.info = !error && data && data.actief && data.rol === VB.rol && data.contact_id === cid ? data : null; }
    catch (e) { VB.info = null; }
    return VB.info;
  };
  VB.stop = async function () { try { if (VB.echtRpc) await VB.echtRpc("voorbeeld_stop"); } catch (e) { } location.href = "../"; };
  VB.balk = function () {
    if (!VB.rol || !VB.info) return;
    const oud = document.getElementById("vb-bar"); if (oud) oud.remove();
    const d = document.createElement("div"); d.id = "vb-bar"; d.setAttribute("data-nt", "");
    d.style.cssText = "position:sticky;top:0;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 16px;background:#B7791F;color:#fff;font:600 13px/1.4 system-ui,-apple-system,sans-serif";
    const t = document.createElement("span");
    t.textContent = `TESTMODUS — het ${VB.rol === "klant" ? "klantenportaal" : "aannemersportaal"} zoals ${VB.info.naam || "dit contact"} het ziet · alleen bekijken, er wordt niets bewaard of gemaild`;
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("data-vb", "stop"); b.textContent = "Testmodus stoppen";
    b.style.cssText = "background:#fff;color:#7A4E0E;border:0;border-radius:6px;padding:4px 10px;font:600 12px system-ui,sans-serif;cursor:pointer";
    d.appendChild(t); d.appendChild(b); document.body.prepend(d);
  };
  VB.foutHtml = function (portaal) {
    return `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">${portaal}</span></div><h1>Testmodus niet actief</h1><p>Start de testmodus opnieuw vanuit het Planbord (knop Testmodus bovenaan). Ze vervalt na 12 uur, en een nieuw gekozen contact vervangt het vorige (dit tabblad hoort bij een vorig contact).</p><p><a class="btn primary" href="../">Naar het Planbord</a></p></div></div>`;
  };
  window.BROS_VOORBEELD = VB;
})();
