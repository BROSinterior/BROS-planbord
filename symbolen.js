/* =====================================================================
   BROS Planbord — symbolenbibliotheek (tekenmodule)
   Nagebouwd op de legende elektriciteit van de UV-plannen (Hens Didier, 07/2026)
   en de sanitair-/HVAC-aanduidingen op dezelfde bladen.

   Elk symbool is een lijst tekeninstructies in papier-mm (op afdruk), y naar boven,
   met de oorsprong op het invoegpunt (voor wandsymbolen: op de wand, symbool naar de ruimte toe).
     ["l", x1, y1, x2, y2]            lijn
     ["p", [x,y, x,y, …], gesloten?]  polylijn
     ["c", x, y, r, vul]              cirkel   (vul: 0 = geen, 1 = kleur, 2 = wit)
     ["a", x, y, r, van°, tot°]       boog, tegen de klok in
     ["r", x, y, b, h, vul]           rechthoek vanaf linksonder
     ["t", x, y, tekst, hoogte, uitl] tekst (uitl: "l" | "c" | "r"), blijft altijd rechtop
   Een instructie kan als laatste element een kleur krijgen: "g" (groen), "r" (rood), "b" (blauw), "w" (wit);
   zonder kleur tekent ze in de kleur van het symbool (standaard: de kleur van de laag).
   ===================================================================== */
const SYM_KLEUR = { g: "#2E9E4F", r: "#D42A20", b: "#1F5FD6", w: "#FFFFFF" };
const X_IN = (x, y, r) => [["l", x - r * .7071, y - r * .7071, x + r * .7071, y + r * .7071], ["l", x - r * .7071, y + r * .7071, x + r * .7071, y - r * .7071]];
const STOP = (kl) => [["l", 0, 0, 1.4, 0, kl], ["l", 1.4, -1.1, 1.4, 1.1, kl], ["a", 2.6, 0, 1.1, 90, 270, kl]];      // —|(  stopcontact
const ARROW = (x, y, kl) => [["l", x, y, x - 1.4, y - 1.4, kl], ["p", [x - 1.4, y - 1.4, x - 0.5, y - 1.5, x - 1.3, y - 0.6], true, kl]];

const SYMBOLEN = {
  stopcontact:        { naam: "Stopcontact", laag: "elektro", wand: true, d: STOP() },
  stopcontact_gesch:  { naam: "Geschakeld stopcontact", laag: "elektro", wand: true, kleur: "g", d: STOP() },
  vloerstopcontact:   { naam: "Vloerstopcontact", laag: "elektro", d: [["r", -1.3, -1.3, 2.6, 2.6, 0], ...STOP().map(o => o[0] === "l" ? ["l", o[1] + 1.3, o[2], o[3] + 1.3, o[4]] : ["a", o[1] + 1.3, o[2], o[3], o[4], o[5]])] },
  data:               { naam: "Telefoon-/datastopcontact", laag: "elektro", wand: true, d: [...STOP(), ["t", 4.1, -0.6, "DATA", 1.2, "l"]] },
  tv:                 { naam: "Tv-aansluiting", laag: "elektro", wand: true, d: [...STOP(), ["t", 4.1, -0.6, "DISTR", 1.2, "l"]] },
  schakelaar:         { naam: "Schakelaar", laag: "elektro", wand: true, d: [["c", 0.5, 0, 0.5, 0], ["l", 1, 0, 3.2, 0], ["l", 3.2, 0, 3.2, -0.9]] },
  schakelaar_gesch:   { naam: "Schakelaar geschakelde stopcontacten", laag: "elektro", wand: true, kleur: "g", d: [["c", 0.5, 0, 0.5, 0], ["l", 1, 0, 3.2, 0], ["l", 3.2, 0, 3.2, -0.9]] },
  voeding:            { naam: "Voeding", laag: "elektro", d: [["c", 0, 0, 1.6, 0], ["p", [-0.7, -0.9, 0.1, 0.1, -0.2, 0.3, 0.7, 1.0], false], ["p", [0.2, 1.0, 0.7, 1.0, 0.7, 0.5], false]] },
  lichtpunt:          { naam: "Centraal lichtpunt", laag: "verlichting", d: [["c", 0, 0, 1.6, 0], ...X_IN(0, 0, 1.6)] },
  hanglamp:           { naam: "Hanglamp", laag: "verlichting", d: [["c", 0, 0, 2, 0], ["c", 0, 0, 1.35, 0], ...X_IN(0, 0, 1.35)] },
  spot:               { naam: "In- of opbouwspot", laag: "verlichting", d: [["c", 0, 0, 1.1, 1], ["l", -0.55, -0.55, 0.55, 0.55, "w"], ["l", -0.55, 0.55, 0.55, -0.55, "w"]] },
  spot_richtbaar:     { naam: "Richtbare in- of opbouwspot", laag: "verlichting", d: [["c", 0, 0, 1.1, 1], ["l", -0.55, -0.55, 0.55, 0.55, "w"], ["l", -0.55, 0.55, 0.55, -0.55, "w"], ...ARROW(-0.9, -0.9)] },
  applique:           { naam: "Wandapplique (opbouw)", laag: "verlichting", wand: true, d: [["c", 1.2, 0, 1.2, 0], ["p", [1.2, 1.2, 1.2, -1.2], false], ["a", 1.2, 0, 1.2, 270, 90], ["p", [1.2, 1.2, 1.55, 1.15, 1.9, 1, 2.2, 0.75, 2.35, 0.4, 2.4, 0, 2.35, -0.4, 2.2, -0.75, 1.9, -1, 1.55, -1.15, 1.2, -1.2], true, "fill"]] },
  applique_richtbaar: { naam: "Richtbare wandapplique (opbouw)", laag: "verlichting", wand: true, d: [["c", 1.2, 0, 1.2, 0], ["p", [1.2, 1.2, 1.55, 1.15, 1.9, 1, 2.2, 0.75, 2.35, 0.4, 2.4, 0, 2.35, -0.4, 2.2, -0.75, 1.9, -1, 1.55, -1.15, 1.2, -1.2], true, "fill"], ...ARROW(1.9, -1.3)] },
  applique_inbouw:    { naam: "Wandapplique (inbouw – Brick in the Wall)", laag: "verlichting", wand: true, d: [["r", 0, -1.3, 3.6, 2.6, 0], ["l", 0, -1.3, 3.6, 1.3], ["l", 0, 1.3, 1.8, 0], ["l", 1.8, 0, 3.6, 1.3]] },
  tl:                 { naam: "TL-lamp", laag: "verlichting", d: [["l", -3, 0.35, 3, 0.35], ["l", -3, -0.35, 3, -0.35], ["l", -3, -0.8, -3, 0.8], ["l", 3, -0.8, 3, 0.8]] },
  ledstrip:           { naam: "LED-strip + transfo", laag: "verlichting", lijn: true, d: [["l", -3, 0, 3, 0], ["l", -3, 0.12, 3, 0.12], ["l", -3, -0.12, 3, -0.12]] },
  ventiel:            { naam: "Ventilatieventiel", laag: "hvac", kleur: "g", d: [["c", 0, 0, 1.8, 0], ["p", [-0.75, 0.85, 0, -0.85, 0.75, 0.85], false]] },
  prado:              { naam: "Prado-spot inclusief ventilatie", laag: "hvac", d: [["c", 0, 0, 1.8, 0, "g"], ["c", 0, 0, 1.05, 1, "r"], ["l", -0.5, -0.5, 0.5, 0.5, "w"], ["l", -0.5, 0.5, 0.5, -0.5, "w"]] },
  muziekbox:          { naam: "Muziekbox (inbouw plafond / wand)", laag: "elektro", d: [["c", 0, 0, 1.5, 0], ["t", 0, -0.6, "B", 1.6, "c"]] },
  rookmelder:         { naam: "Rookmelder", laag: "elektro", d: [["c", 0, 0, 1.5, 0], ["t", 0, -0.6, "R", 1.6, "c"]] },
  gas:                { naam: "Gastoevoer", laag: "hvac", d: [["c", 0, 0, 1.5, 0], ["t", 0, -0.6, "G", 1.6, "c"]] },
  wifi_versterker:    { naam: "Wifi-versterker", laag: "elektro", d: [["c", 0, 0, 1.6, 1], ["a", 0, -0.9, 0.7, 45, 135, "w"], ["a", 0, -0.9, 1.3, 45, 135, "w"], ["c", 0, -0.9, 0.22, 1, "w"]] },
  wifi_ap:            { naam: "Wifi-access point", laag: "elektro", d: [["a", 0, -1.1, 0.8, 40, 140], ["a", 0, -1.1, 1.5, 40, 140], ["a", 0, -1.1, 2.2, 40, 140], ["c", 0, -1.1, 0.35, 1]] },
  alarmdetector:      { naam: "Alarmdetector", laag: "elektro", d: [["p", [0, 0, 2.4, 1.1, 2.4, -1.1], true], ["c", 2.9, 0, 0.5, 0], ["t", -0.4, -0.5, "AL", 1.1, "r"]] },
  alarmcontact:       { naam: "Alarmcontact (raam / deur)", laag: "elektro", d: [["r", -1.3, -1.3, 2.6, 2.6, 0], ["t", 0, -0.5, "AL", 1.1, "c"]] },
  camera:             { naam: "Camera", laag: "elektro", d: [["p", [0, 0.8, 2.4, 1.5, 2.4, -0.5, 0, -0.8], true], ["p", [2.4, 0.7, 3.2, 1.2, 3.2, -0.2, 2.4, 0.3], true], ["t", -0.4, -0.5, "CA", 1.1, "r"]] },
  bewegingssensor:    { naam: "Bewegingssensor", laag: "elektro", d: [["a", 0, 0, 1, 90, 270], ["l", 0, 1, 0, -1], ["l", 0.6, 0.6, 1.8, 1.2], ["l", 0.6, -0.6, 1.8, -1.2], ["l", 0.8, 0, 2.1, 0]] },
  thermostaat:        { naam: "Thermostaat", laag: "hvac", wand: true, d: [["l", 0, 0, 1.6, 0], ["c", 1.6, 0, 0.18, 1], ["t", 2.1, -0.6, "°T", 1.4, "l"]] },
  parlofoon:          { naam: "Parlofoon / videofoon", laag: "elektro", wand: true, d: [["l", 0, 0, 1.6, 0], ["c", 1.6, 0, 0.18, 1], ["t", 2.1, -0.6, "P", 1.4, "l"]] },
  alarmbediening:     { naam: "Alarmbediening", laag: "elektro", wand: true, d: [["l", 0, 0, 1.6, 0], ["c", 1.6, 0, 0.18, 1], ["t", 2.1, -0.6, "A", 1.4, "l"]] },
  deurbel:            { naam: "Deurbel", laag: "elektro", wand: true, d: [["l", 0, 0, 1.6, 0], ["c", 1.6, 0, 0.18, 1], ["t", 2.1, -0.6, "B", 1.4, "l"]] },
  aircobediening:     { naam: "Aircobediening", laag: "hvac", wand: true, d: [["l", 0, 0, 1.6, 0], ["c", 1.6, 0, 0.18, 1], ["t", 2.1, -0.5, "AIRCO", 1.1, "l"]] },
  kw:                 { naam: "Koud water (KW)", laag: "sanitair", d: [["c", 0, 0, 0.55, 1, "b"], ["t", 0.9, -0.5, "KW", 1.2, "l", "b"]] },
  ww:                 { naam: "Warm water (WW)", laag: "sanitair", d: [["c", 0, 0, 0.55, 1, "r"], ["t", 0.9, -0.5, "WW", 1.2, "l", "r"]] },
  afvoer:             { naam: "Afvoer", laag: "sanitair", d: [["c", 0, 0, 0.9, 0], ["l", -1.5, 0, 1.5, 0], ["l", 0, -1.5, 0, 1.5], ["t", 0, -2.6, "afvoer", 1, "c"]] },
  airco_unit:         { naam: "Airco binnenunit", laag: "hvac", d: [["r", -4, -1.2, 8, 2.4, 0], ["t", 0, -0.45, "airco", 1.1, "c"]] },
  radiator:           { naam: "Radiator", laag: "hvac", wand: true, d: [["r", 0, -3, 1, 6, 0], ["l", 0, -1.5, 1, -1.5], ["l", 0, 0, 1, 0], ["l", 0, 1.5, 1, 1.5]] },
};

/* Tekent een symbool op een 2D-canvas.
   x, y  = invoegpunt in schermpixels (y naar beneden)
   k     = schermpixels per papier-mm  (zoom × schaalfactor)
   rot   = rotatie in graden (tegen de klok in)
   kleur = kleur van de laag (of een eigen kleur)  */
function symTeken(ctx, code, x, y, k, rot = 0, kleur = "#D42A20", opt = {}) {
  const s = SYMBOLEN[code]; if (!s) return;
  const a = rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), sp = opt.spiegel ? -1 : 1;
  const P = (px, py) => [x + (px * sp * ca - py * sa) * k, y - (px * sp * sa + py * ca) * k];
  const basis = s.kleur ? SYM_KLEUR[s.kleur] : kleur;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = Math.max(0.6, 0.18 * k);
  for (const o of s.d) {
    const t = o[0]; const last = o[o.length - 1];
    const kl = typeof last === "string" && SYM_KLEUR[last] ? SYM_KLEUR[last] : basis;
    ctx.strokeStyle = kl; ctx.fillStyle = kl;
    if (t === "l") { const p1 = P(o[1], o[2]), p2 = P(o[3], o[4]); ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke(); }
    else if (t === "p") { const pts = o[1]; ctx.beginPath(); for (let i = 0; i < pts.length; i += 2) { const p = P(pts[i], pts[i + 1]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } if (o[2]) ctx.closePath(); if (o[3] === "fill") ctx.fill(); else ctx.stroke(); }
    else if (t === "c") { const p = P(o[1], o[2]); ctx.beginPath(); ctx.arc(p[0], p[1], o[3] * k, 0, Math.PI * 2); if (o[4] === 1) ctx.fill(); else if (o[4] === 2) { ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke(); } else ctx.stroke(); }
    else if (t === "a") { const p = P(o[1], o[2]); const r0 = -(o[4] * Math.PI / 180 + a * sp), r1 = -(o[5] * Math.PI / 180 + a * sp); ctx.beginPath(); if (sp < 0) ctx.arc(p[0], p[1], o[3] * k, Math.PI - r0, Math.PI - r1, false); else ctx.arc(p[0], p[1], o[3] * k, r0, r1, true); ctx.stroke(); }
    else if (t === "r") { const c = [P(o[1], o[2]), P(o[1] + o[3], o[2]), P(o[1] + o[3], o[2] + o[4]), P(o[1], o[2] + o[4])]; ctx.beginPath(); c.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); if (o[5] === 1) ctx.fill(); else ctx.stroke(); }
    else if (t === "t") { const p = P(o[1], o[2]); ctx.font = `600 ${Math.max(1, o[4] * k)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; ctx.textAlign = o[5] === "c" ? "center" : o[5] === "r" ? "right" : "left"; ctx.textBaseline = "alphabetic";
      // tekst blijft leesbaar: de plaats draait mee, de tekst zelf niet
      ctx.fillText(o[3], p[0], p[1]); }
  }
  ctx.restore();
}
const symLijst = () => Object.entries(SYMBOLEN).map(([code, s]) => ({ code, ...s }));
