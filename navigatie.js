/* =====================================================================
   BROS Planbord — navigatie (v1.71; 1.73: Mijn werk in de gsm-balk, Taken onder Meer)
   - Hoofdmenu: Overzicht, Projecten, Facturen, Taken, Planning, Uren + "Meer ▾" (Contacten, Notities, Voorstellen, Rapporten).
   - Gsm: een vaste balk onderaan (Overzicht, Projecten, Uren, Taken, Meer); de bovenbalk toont dan enkel logo, zoeken en account.
   - Projectpagina: 5 groepen (Werk, Ontwerp, Financieel, Werf, Dossier) met daaronder de tabbladen van die groep.
   - Uitleg in panelen (de grijze regels onder een titel) standaard ingeklapt achter een ⓘ; één klik toont ze, "altijd tonen" onthoudt dat.
   Geladen vóór app.js; app.js roept navMeer, gsmBalk, projGroepNav en uitlegInklappen aan (via typeof).
   ===================================================================== */
const MEER_TABS = ["contacten", "notities", "voorstellen", "naservice", "rapporten"];   // 1.77: naservice
const NAV = { meerOpen: false };
function navMeerItems() {
  const l = [["contacten", "Contacten"], ["notities", "Notities"], ["voorstellen", "Voorstellen"], ["naservice", "Naservice"], ["rapporten", "Rapporten"]].filter(([k]) => k !== "naservice" || (typeof nsKlaar === "function" && nsKlaar()));
  const n = (k) => k === "voorstellen" && typeof voorstellenOpen === "function" ? voorstellenOpen().length : k === "naservice" && typeof nsTeller === "function" ? nsTeller() : 0;
  return { l, n, tot: l.reduce((s, [k]) => s + n(k), 0) };
}
/** knop "Meer ▾" in de bovenbalk (het menu zelf komt uit navMenuHtml) */
function navMeer() {
  const { tot } = navMeerItems(); const actief = MEER_TABS.includes(S.view);
  return `<span class="nav-meer"><button type="button" data-act="nav-meer" aria-haspopup="menu" aria-expanded="${NAV.meerOpen}" ${actief ? 'aria-current="page"' : ""}>Meer${tot ? ` <span class="cnt" style="background:var(--crit);color:#fff">${tot}</span>` : ""} <span aria-hidden="true">▾</span></button>${NAV.meerOpen ? navMenuHtml(false) : ""}</span>`;
}
function navMenuHtml(gsm) {
  const { l, n } = navMeerItems();
  const extra = gsm ? [["aankoop", "Facturen", typeof factTeDoen === "function" ? factTeDoen() : 0, isBeheer() && typeof vAankoop === "function"], ["planning", "Planning", 0, true], ["taken", "Taken", 0, typeof vMijnWerk === "function"]].filter(x => x[3]) : [];
  return `<div class="nav-menu${gsm ? " gsm" : ""}" role="menu">${extra.concat(l.map(([k, t]) => [k, t, n(k), true])).map(([k, t, c]) => `<button type="button" role="menuitem" data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${t}${c ? ` <span class="cnt" style="background:var(--crit);color:#fff">${c}</span>` : ""}</button>`).join("")}</div>`;
}
/** vaste balk onderaan op een gsm */
function gsmBalk() {
  const k = (v, ic, t, cnt) => `<button type="button" data-nav="${v}" ${S.view === v ? 'aria-current="page"' : ""}><span class="gb-ic" aria-hidden="true">${ic}</span><span>${t}</span>${cnt ? `<span class="cnt" style="background:var(--crit);color:#fff">${cnt}</span>` : ""}</button>`;
  const meerN = navMeerItems().tot + (isBeheer() && typeof factTeDoen === "function" ? factTeDoen() : 0);
  const meerActief = MEER_TABS.includes(S.view) || S.view === "aankoop" || S.view === "planning" || (S.view === "taken" && typeof vMijnWerk === "function");
  return `<nav class="gsm-balk" aria-label="Hoofdnavigatie (gsm)">${k("overzicht", "⌂", "Overzicht")}${k("projecten", "▦", "Projecten")}${k("uren", "◷", "Uren")}${typeof vMijnWerk === "function" ? k("mijnwerk", "✓", "Mijn werk", typeof mwTeller === "function" ? mwTeller() : 0) : k("taken", "✓", "Taken")}
    <span class="gb-meer"><button type="button" data-act="nav-meer-gsm" aria-haspopup="menu" aria-expanded="${!!NAV.gsmOpen}" ${meerActief ? 'aria-current="page"' : ""}><span class="gb-ic" aria-hidden="true">≡</span><span>Meer</span>${meerN ? `<span class="cnt" style="background:var(--crit);color:#fff">${meerN}</span>` : ""}</button>${NAV.gsmOpen ? navMenuHtml(true) : ""}</span></nav>`;
}

/* ---------- projectpagina: groepen ---------- */
const PROJ_GROEPEN = [["werk", "Werk", ["intern", "taken", "planning", "uren"]], ["ontwerp", "Ontwerp", ["ontwerp", "tekenen", "renders", "keuzes"]], ["geld", "Financieel", ["meetstaat", "facturatie"]], ["werf", "Werf", ["werf", "naservice", "vragen"]], ["dossier", "Dossier", ["dossier", "vergaderingen", "notities"]]];
const projGroepVan = (k) => (PROJ_GROEPEN.find(g => g[2].includes(k)) || PROJ_GROEPEN[0])[0];
/** tabs = [[sleutel, label met teller]] zoals app.js ze opbouwt → groepen + tabbladen van de actieve groep */
function projGroepNav(tabs) {
  const bekend = new Set(PROJ_GROEPEN.flatMap(g => g[2]));
  const per = PROJ_GROEPEN.map(([k, l, ks]) => ({ k, l, tabs: ks.map(x => tabs.find(t => t[0] === x)).filter(Boolean).concat(k === "dossier" ? tabs.filter(t => !bekend.has(t[0])) : []) })).filter(g => g.tabs.length);
  const actief = projGroepVan(S.ptab); NAV.laatste = NAV.laatste || {}; NAV.laatste[actief] = S.ptab;
  const teller = (g) => g.tabs.reduce((s, [, l]) => { const m = /class="cnt"[^>]*>(\d+)</.exec(l); return s + (m ? Number(m[1]) : 0); }, 0);
  const rood = (g) => g.tabs.some(([, l]) => /var\(--crit\)/.test(l));
  const groep = per.find(g => g.k === actief) || per[0];
  return `<div class="pgroepen" role="tablist" aria-label="Onderdelen van het project">${per.map(g => { const n = teller(g); const doel = (NAV.laatste[g.k] && g.tabs.some(t => t[0] === NAV.laatste[g.k])) ? NAV.laatste[g.k] : g.tabs[0][0];
      return `<button role="tab" data-ptab="${doel}" aria-selected="${g.k === groep.k}" aria-current="${g.k === groep.k}">${g.l}${n ? ` <span class="cnt"${rood(g) ? ' style="background:var(--crit);color:#fff"' : ""}>${n}</span>` : ""}</button>`; }).join("")}</div>
    ${groep.tabs.length > 1 ? `<div class="subtabs">${groep.tabs.map(([k, l]) => `<button data-ptab="${k}" aria-current="${S.ptab === k}">${l}</button>`).join("")}</div>` : `<div class="pgroep-ruimte"></div>`}`;
}

/* ---------- uitleg inklappen ---------- */
const uitlegAltijd = () => { try { return localStorage.getItem("bros.uitleg") === "1"; } catch (e) { return false; } };
/** na elke render: lange grijze uitlegregels onder een paneeltitel achter een ⓘ zetten */
function uitlegInklappen() {
  if (uitlegAltijd()) return;
  document.querySelectorAll("#app .panel-head > div > .muted").forEach(el => {
    if (el.dataset.uitleg || (el.textContent || "").trim().length < 110 || el.querySelector("button, input, select, a.btn")) return;
    el.dataset.uitleg = "1"; el.classList.add("uitleg-dicht");
    const kop = el.parentElement.querySelector("h3"); if (!kop || kop.querySelector(".uitleg-knop")) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "uitleg-knop"; b.title = "Uitleg tonen"; b.setAttribute("aria-label", "Uitleg tonen"); b.setAttribute("aria-expanded", "false"); b.textContent = "i";
    kop.appendChild(b);
  });
}
document.addEventListener("click", (e) => {
  const u = e.target.closest && e.target.closest(".uitleg-knop");
  if (u) { e.preventDefault(); e.stopPropagation(); const el = u.closest(".panel-head").querySelector("[data-uitleg]"); if (!el) return;
    const open = el.classList.toggle("uitleg-dicht") === false; u.setAttribute("aria-expanded", String(open));
    if (open && !el.querySelector(".uitleg-altijd")) { const a = document.createElement("button"); a.type = "button"; a.className = "uitleg-altijd"; a.textContent = "altijd tonen"; el.appendChild(document.createTextNode(" ")); el.appendChild(a); }
    return; }
  const alt = e.target.closest && e.target.closest(".uitleg-altijd");
  if (alt) { e.preventDefault(); try { localStorage.setItem("bros.uitleg", "1"); } catch (x) { } document.querySelectorAll(".uitleg-dicht").forEach(x => x.classList.remove("uitleg-dicht")); document.querySelectorAll(".uitleg-knop, .uitleg-altijd").forEach(x => x.remove()); toast("Uitleg blijft open (terug te zetten bij Instellingen › Weergave)"); return; }
  const m = e.target.closest && e.target.closest("[data-act='nav-meer'],[data-act='nav-meer-gsm']");
  if (m) { e.preventDefault(); e.stopPropagation(); if (m.dataset.act === "nav-meer") { NAV.meerOpen = !NAV.meerOpen; NAV.gsmOpen = false; } else { NAV.gsmOpen = !NAV.gsmOpen; NAV.meerOpen = false; } render(); return; }
  if ((NAV.meerOpen || NAV.gsmOpen) && !(e.target.closest && e.target.closest(".nav-menu"))) { NAV.meerOpen = false; NAV.gsmOpen = false; render(); }
  else if ((NAV.meerOpen || NAV.gsmOpen) && e.target.closest && e.target.closest(".nav-menu [data-nav]")) { NAV.meerOpen = false; NAV.gsmOpen = false; }
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (NAV.meerOpen || NAV.gsmOpen)) { NAV.meerOpen = false; NAV.gsmOpen = false; render(); } });
