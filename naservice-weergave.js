/* =====================================================================
   BROS — Naservice: gedeelde weergave (v1.77, script 069)
   Gebruikt door het Planbord, het klantenportaal en het aannemersportaal (zelfde beeld voor iedereen):
   - NSW.balk(...)     de oplevering in één oogopslag: voorlopig → vandaag → definitief, met de gemelde punten op de lijn
   - NSW.stappen(n)    de stappen van één punt: ontvangen → beoordeeld → ingepland → opgelost → afgesloten (met datums)
   - NSW.tijdlijn(evs) de volledige historiek: wie deed wat en wanneer (BROS, klant, aannemer, Planbord)
   Zet zelf zijn stijl in de pagina (één keer); kleuren volgen de variabelen van elke pagina (licht/donker).
   ===================================================================== */
(function () {
  const e = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAAND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const dag = (s) => { if (!s) return null; const x = String(s); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? new Date(x + "T12:00:00") : new Date(x); };
  const isoDag = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const vandaag = () => isoDag(new Date());
  const fmt = (s) => { const d = dag(s); return d && !isNaN(d) ? d.getDate() + " " + MAAND[d.getMonth()] + " " + d.getFullYear() : ""; };
  const fmtKort = (s) => { const d = dag(s); return d && !isNaN(d) ? String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear() : ""; };
  const fmtTijd = (s) => { const d = dag(s); return d && !isNaN(d) ? fmtKort(isoDag(d)) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : ""; };
  const dagenTussen = (a, b) => Math.round((dag(b) - dag(a)) / 864e5);
  /** zoals Postgres en het Drive-script: 31/01 + 1 maand = 28/02 */
  function plusMaanden(iso, n) {
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + Number(n), d = Number(iso.slice(8, 10));
    const jy = y + Math.floor(m / 12), jm = ((m % 12) + 12) % 12, max = new Date(jy, jm + 1, 0).getDate();
    return jy + "-" + String(jm + 1).padStart(2, "0") + "-" + String(Math.min(d, max)).padStart(2, "0");
  }
  const STATUS = { ontvangen: ["Ontvangen", "ontv"], aanvaard: ["Aanvaard", "aanv"], ingepland: ["Ingepland", "plan"], opgelost: ["Opgelost", "opg"], afgesloten: ["Afgesloten", "af"], geweigerd: ["Niet onder naservice", "weg"] };
  const ROL = { bros: "BROS", klant: "Klant", aannemer: "Aannemer", systeem: "Planbord" };
  const SOORT = { ontvangen: ["↓", "Melding ontvangen"], aanvaard: ["✓", "Aanvaard als naservice"], geweigerd: ["✕", "Valt niet onder de naservice"], toegewezen: ["→", "Vakman ingeschakeld"],
    ingepland: ["◷", "Herstelling ingepland"], opgelost: ["✔", "Gemeld als opgelost"], afgesloten: ["■", "Afgesloten"], heropend: ["↺", "Heropend"], bericht: ["✎", "Bericht"],
    registratie: ["✎", "Actie"], voorlopig: ["◐", "Voorlopig opgeleverd"], definitief: ["●", "Definitief opgeleverd"], voorbehoud: ["!", "Voorbehoud bij de definitieve oplevering"], termijn: ["⋯", "Oplevering aangepast"] };
  /** oplevering van een project: { voorlopig, termijn, definitief, gepland } */
  function oplevering(p) {
    if (!p || !p.voorlopig_opgeleverd_op) return null;
    const termijn = Number(p.oplevering_termijn_maanden) || 12;
    const gepland = plusMaanden(String(p.voorlopig_opgeleverd_op).slice(0, 10), termijn);
    const definitief = p.definitief_opgeleverd_op ? String(p.definitief_opgeleverd_op).slice(0, 10) : null;
    const einde = definitief || gepland;
    return { voorlopig: String(p.voorlopig_opgeleverd_op).slice(0, 10), termijn, gepland, definitief, einde, tienjaar: plusMaanden(einde, 120),
             dagenTot: dagenTussen(vandaag(), einde), loopt: !definitief };
  }
  function balk(p, punten, opt) {
    opt = opt || {}; const o = oplevering(p); if (!o) return ""; const nu = vandaag();
    const tot = Math.max(1, dagenTussen(o.voorlopig, o.einde)); const pos = (d) => Math.max(0, Math.min(100, dagenTussen(o.voorlopig, String(d).slice(0, 10)) / tot * 100));
    const nuPct = pos(nu); const binnen = (punten || []).filter(n => String(n.ontvangen_op).slice(0, 10) <= o.einde); const na = (punten || []).filter(n => String(n.ontvangen_op).slice(0, 10) > o.einde);
    const stip = (n) => { const [l, c] = STATUS[n.status] || [n.status, "ontv"]; return `<button type="button" class="ns-stip ns-st-${c}" style="left:${pos(n.ontvangen_op).toFixed(2)}%" ${opt.attr ? opt.attr(n) : ""} title="${e("NS-" + String(n.nr || 0).padStart(3, "0") + " · " + n.titel + " · " + l + " · gemeld " + fmtKort(n.ontvangen_op))}"><span class="sr">${e(n.titel)}</span></button>`; };
    const kop = !o.loopt ? `<b>Definitief opgeleverd</b> op ${e(fmt(o.definitief))}` : o.dagenTot > 0 ? `Nog <b>${o.dagenTot} ${o.dagenTot === 1 ? "dag" : "dagen"}</b> tot de definitieve oplevering` : `De termijn is verstreken — <b>definitieve oplevering volgt automatisch</b>`;
    return `<div class="ns-balk${o.loopt ? "" : " klaar"}">
      <div class="ns-balk-kop"><span>${kop}</span><span class="ns-balk-sub">termijn ${o.termijn} maanden${opt.uitleg === false ? "" : " · naservice = alles wat na de voorlopige oplevering gemeld wordt"}</span></div>
      <div class="ns-baan" role="img" aria-label="Van ${e(fmt(o.voorlopig))} tot ${e(fmt(o.einde))}">
        <div class="ns-baan-vol" style="width:${(o.loopt ? nuPct : 100).toFixed(2)}%"></div>
        <span class="ns-mijl ns-mijl-start" style="left:0"></span><span class="ns-mijl ns-mijl-eind${o.loopt ? "" : " klaar"}" style="left:100%"></span>
        ${o.loopt && nuPct > 0 && nuPct < 100 ? `<span class="ns-nu" style="left:${nuPct.toFixed(2)}%"><span>vandaag</span></span>` : ""}
        ${binnen.map(stip).join("")}
      </div>
      <div class="ns-baan-labels"><div><span class="ns-lbl-k">Voorlopige oplevering</span><b>${e(fmt(o.voorlopig))}</b></div>
        <div style="text-align:right"><span class="ns-lbl-k">Definitieve oplevering${o.loopt ? " (gepland)" : ""}</span><b>${e(fmt(o.einde))}</b></div></div>
      ${na.length ? `<div class="ns-na">${na.length} ${na.length === 1 ? "punt" : "punten"} gemeld na de definitieve oplevering</div>` : ""}
      ${opt.tienjaar === false ? "" : `<div class="ns-tienjaar">Na de definitieve oplevering: lichte verborgen gebreken snel melden · tienjarige aansprakelijkheid (stabiliteit) tot ${e(fmt(o.tienjaar))}</div>`}
    </div>`;
  }
  /** de stappen van één punt, met de datum waarop elke stap gezet werd */
  function stappen(n, evs) {
    const bij = (s) => (evs || []).filter(x => x.punt_id === n.id && x.soort === s).map(x => x.op).sort().pop();
    if (n.status === "geweigerd") return `<div class="ns-stappen"><div class="ns-stap klaar"><i>1</i><span>Ontvangen</span><small>${e(fmtKort(n.ontvangen_op))}</small></div><div class="ns-stap weg"><i>✕</i><span>Niet onder naservice</span><small>${e(fmtKort(bij("geweigerd") || n.afgesloten_op))}</small></div></div>`;
    const volg = ["ontvangen", "aanvaard", "ingepland", "opgelost", "afgesloten"]; const hier = volg.indexOf(n.status);
    const st = [["Ontvangen", n.ontvangen_op], ["Beoordeeld", bij("aanvaard") || bij("toegewezen")], ["Ingepland", n.gepland_op ? n.gepland_op : null], ["Opgelost", n.opgelost_op], ["Afgesloten", n.afgesloten_op]];
    return `<div class="ns-stappen">${st.map(([l, d], i) => `<div class="ns-stap${i < hier || (i === hier && i === 4) ? " klaar" : i === hier ? " nu" : ""}${i === 2 && !n.gepland_op && hier > 2 ? " over" : ""}"><i>${i < hier || (i === hier && i === 4) ? "✓" : i + 1}</i><span>${l}</span><small>${d ? e(fmtKort(d)) : i === 2 && hier > 2 ? "—" : ""}</small></div>`).join("")}</div>`;
  }
  /** historiek: opt.intern toont ook wie gemaild werd en wanneer iets geregistreerd werd; opt.leeg = tekst zonder regels */
  function tijdlijn(evs, opt) {
    opt = opt || {}; const l = (evs || []).slice().sort((a, b) => String(a.op).localeCompare(String(b.op)) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
    if (!l.length) return `<div class="ns-leeg">${e(opt.leeg || "Nog geen historiek.")}</div>`;
    const foto = typeof opt.foto === "function" ? opt.foto : (f) => /^https:\/\//.test(f.url || "") ? f.url : "";
    return `<ol class="ns-tl">${l.map(x => { const [ic, lbl] = SOORT[x.soort] || ["•", x.soort];
      const titel = x.soort === "ingepland" && x.datum ? "Herstelling ingepland op " + fmt(x.datum) : x.soort === "bericht" ? "Bericht" : x.soort === "registratie" ? "Actie" : lbl;
      const later = opt.intern && x.created_at && Math.abs(new Date(x.created_at) - new Date(x.op)) > 3600000;
      const fs = (x.fotos || []).map(f => foto(f)).filter(Boolean);
      return `<li class="ns-tl-r ns-rol-${e(x.door_rol)} ns-s-${e(x.soort)}"><span class="ns-tl-ic" aria-hidden="true">${ic}</span><div class="ns-tl-b">
        <div class="ns-tl-kop"><b>${e(titel)}</b><span class="ns-tl-wie"><span class="ns-rolchip">${e(ROL[x.door_rol] || x.door_rol)}</span>${e(x.door_naam || "")}</span><time datetime="${e(x.op)}">${e(fmtTijd(x.op))}</time></div>
        ${x.tekst ? `<div class="ns-tl-tekst">${e(x.tekst)}</div>` : ""}
        ${fs.length ? `<div class="ns-tl-fotos">${fs.map(u => `<a href="${e(u)}" target="_blank" rel="noopener"><img src="${e(u)}" alt="" loading="lazy"></a>`).join("")}</div>` : ""}
        ${opt.intern ? `<div class="ns-tl-meta">${later ? `geregistreerd op ${e(fmtTijd(x.created_at))} · ` : ""}${x.zichtbaar_klant === false ? "intern (klant ziet dit niet)" : "zichtbaar voor de klant"}${x.zichtbaar_aannemer ? " · en de aannemer" : ""}${x.gemeld_op ? ` · ✉ gemaild${x.gemeld_naar ? ": " + e(x.gemeld_naar) : ""}` : x.melden ? " · ✉ mail volgt" : ""}</div>` : ""}
      </div></li>`; }).join("")}</ol>`;
  }
  const pill = (status) => { const [l, c] = STATUS[status] || [status, "ontv"]; return `<span class="ns-pill ns-st-${c}">${e(l)}</span>`; };
  const nr = (n) => "NS-" + String(n.nr || 0).padStart(3, "0");
  const bronTekst = (b) => ({ klant: "via het klantenportaal", mail: "per mail", telefoon: "telefonisch", werfbezoek: "tijdens een bezoek", bros: "door BROS", aannemer: "door de aannemer" })[b] || b;
  const leeftijd = (n) => { const einde = n.afgesloten_op || null; const d = dagenTussen(String(n.ontvangen_op).slice(0, 10), einde ? String(einde).slice(0, 10) : vandaag()); return d; };

  const CSS = `
.ns-balk{border:1px solid var(--line);border-radius:16px;padding:18px 22px 16px;background:var(--surface);box-shadow:var(--card)}
.ns-balk-kop{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline;margin-bottom:22px;font-size:15px}
.ns-balk-sub{color:var(--muted);font-size:12px}
.ns-baan{position:relative;height:10px;border-radius:99px;background:var(--surface-2);margin:0 8px}
.ns-baan-vol{position:absolute;inset:0 auto 0 0;border-radius:99px;background:linear-gradient(90deg,var(--blue,var(--accent)),color-mix(in srgb,var(--blue,var(--accent)) 60%,var(--ok)))}
.ns-balk.klaar .ns-baan-vol{background:var(--ok)}
.ns-mijl{position:absolute;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:var(--surface);border:3px solid var(--blue,var(--accent));z-index:1}
.ns-mijl-eind{border-color:var(--line-2,var(--muted))}.ns-mijl-eind.klaar{border-color:var(--ok);background:var(--ok)}
.ns-nu{position:absolute;top:-8px;bottom:-8px;width:2px;margin-left:-1px;background:var(--today,var(--crit));z-index:2}
.ns-nu span{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);font-size:11px;font-weight:600;color:var(--today,var(--crit));white-space:nowrap;margin-bottom:2px}
.ns-stip{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid var(--surface);padding:0;cursor:pointer;z-index:3;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.ns-stip:hover{transform:scale(1.35)}
.ns-stip .sr,.ns-balk .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.ns-baan-labels{display:flex;justify-content:space-between;gap:12px;margin-top:14px;font-size:14px}
.ns-baan-labels .ns-lbl-k{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.ns-na{margin-top:10px;font-size:12px;color:var(--warn)}
.ns-tienjaar{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);font-size:12px;color:var(--muted)}
.ns-st-ontv{background:var(--warn)}.ns-st-aanv{background:var(--blue,var(--accent))}.ns-st-plan{background:#7A5AF8}.ns-st-opg{background:var(--ok)}.ns-st-af{background:var(--muted)}.ns-st-weg{background:var(--crit)}
.ns-pill{display:inline-block;align-self:flex-start;height:fit-content;line-height:1.5;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600;color:#fff;white-space:nowrap}
.ns-pill.ns-st-af{background:var(--surface-2);color:var(--ink-2,var(--ink))}
.ns-stappen{display:flex;gap:0;margin:6px 0 4px;overflow-x:auto}
.ns-stap{flex:1;min-width:84px;text-align:center;position:relative;font-size:12px;color:var(--muted)}
.ns-stap:not(:first-child)::before{content:"";position:absolute;top:13px;left:-50%;width:100%;height:2px;background:var(--line-2,var(--line));z-index:0}
.ns-stap.klaar:not(:first-child)::before,.ns-stap.nu:not(:first-child)::before,.ns-stap.weg::before{background:var(--ok)}
.ns-stap i{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--surface-2);border:2px solid var(--line-2,var(--line));font-style:normal;font-weight:700;font-size:12px;color:var(--muted)}
.ns-stap.klaar i{background:var(--ok);border-color:var(--ok);color:#fff}
.ns-stap.nu i{background:var(--surface);border-color:var(--blue,var(--accent));color:var(--blue,var(--accent));box-shadow:0 0 0 4px color-mix(in srgb,var(--blue,var(--accent)) 18%,transparent)}
.ns-stap.nu span{color:var(--ink);font-weight:700}.ns-stap.klaar span{color:var(--ink)}
.ns-stap.weg i{background:var(--crit);border-color:var(--crit);color:#fff}.ns-stap.weg span{color:var(--crit);font-weight:700}
.ns-stap span,.ns-stap small{display:block;margin-top:4px}.ns-stap small{font-variant-numeric:tabular-nums;min-height:14px}
.ns-tl{list-style:none;margin:8px 0 0;padding:0;position:relative}
.ns-tl::before{content:"";position:absolute;left:15px;top:6px;bottom:6px;width:2px;background:var(--line)}
.ns-tl-r{display:flex;gap:12px;position:relative;padding:0 0 16px}
.ns-tl-ic{flex:0 0 32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;background:var(--muted);position:relative;z-index:1;border:3px solid var(--surface)}
.ns-rol-bros .ns-tl-ic{background:var(--ink)}.ns-rol-klant .ns-tl-ic{background:var(--blue,var(--accent))}.ns-rol-aannemer .ns-tl-ic{background:var(--warn)}.ns-rol-systeem .ns-tl-ic{background:var(--muted)}
.ns-s-geweigerd .ns-tl-ic{background:var(--crit)}.ns-s-afgesloten .ns-tl-ic,.ns-s-definitief .ns-tl-ic{background:var(--ok)}.ns-s-voorbehoud .ns-tl-ic{background:var(--warn)}
.ns-tl-b{flex:1;min-width:0;padding-top:4px}
.ns-tl-kop{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.ns-tl-kop time{margin-left:auto;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ns-tl-wie{font-size:13px;color:var(--ink-2,var(--ink))}
.ns-rolchip{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:5px;margin-right:6px;background:var(--surface-2);color:var(--muted)}
.ns-rol-klant .ns-rolchip{background:color-mix(in srgb,var(--blue,var(--accent)) 15%,transparent);color:var(--blue,var(--accent))}
.ns-rol-aannemer .ns-rolchip{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.ns-tl-tekst{white-space:pre-line;font-size:14px;margin-top:4px;padding:8px 10px;background:var(--surface-2);border-radius:8px}
.ns-tl-fotos{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.ns-tl-fotos img{width:72px;height:72px;object-fit:cover;border-radius:8px;display:block}
.ns-tl-meta{font-size:11px;color:var(--muted);margin-top:4px}
.ns-leeg{color:var(--muted);font-size:13px;padding:8px 0}
.ns-kaart{display:block;width:100%;text-align:left;border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:12px;padding:10px 12px;background:var(--surface);cursor:pointer;font:inherit;color:inherit;margin-bottom:8px}
.ns-kaart:hover{box-shadow:var(--card)}
.ns-kaart.ns-k-ontv{border-left-color:var(--warn)}.ns-kaart.ns-k-aanv{border-left-color:var(--blue,var(--accent))}.ns-kaart.ns-k-plan{border-left-color:#7A5AF8}.ns-kaart.ns-k-opg{border-left-color:var(--ok)}.ns-kaart.ns-k-weg{border-left-color:var(--crit)}
.ns-kaart-t{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}
.ns-kaart-t b{font-size:14px}.ns-kaart small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.ns-kaart img{width:44px;height:44px;object-fit:cover;border-radius:6px;flex:0 0 44px}
.ns-leeftijd{font-size:11px;font-weight:700;padding:1px 6px;border-radius:5px;background:var(--surface-2);color:var(--muted);white-space:nowrap}
.ns-leeftijd.lang{background:var(--crit-soft);color:var(--crit)}
.ns-bord{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
.ns-kol{background:var(--surface-2);border-radius:14px;padding:10px;min-height:120px}
.ns-kol h4{margin:2px 4px 10px;font-size:13px;display:flex;justify-content:space-between;align-items:center}
.ns-kol h4 span{font-weight:600;color:var(--muted)}
.ns-tellers{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
.ns-teller{border:1px solid var(--line);border-radius:12px;padding:8px 12px;background:var(--surface);min-width:110px}
.ns-teller b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.ns-teller span{font-size:12px;color:var(--muted)}
@media (max-width:900px){.ns-bord{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.ns-bord{grid-template-columns:1fr}.ns-balk{padding:14px}.ns-stap{min-width:64px;font-size:11px}}`;
  function stijl() { if (document.getElementById("ns-stijl")) return; const s = document.createElement("style"); s.id = "ns-stijl"; s.textContent = CSS; document.head.appendChild(s); }
  if (document.head) stijl(); else document.addEventListener("DOMContentLoaded", stijl);
  window.NSW = { oplevering, balk, stappen, tijdlijn, pill, nr, bronTekst, leeftijd, plusMaanden, fmt, fmtKort, fmtTijd, STATUS, SOORT, ROL, stijl };
})();
