/* =====================================================================
   BROS Planbord — Yuki-mails lezen in archief@bros.be (v1.56.3)
   Dit kleine script draait in het Google-account archief@bros.be (NIET in brosburo). Elk uur:
   1. zoekt het in de mailbox van archief@bros.be de Yuki-factuurmails ("Factuur van BROS", laatste 60 dagen, nog niet verwerkt),
      controleert of Gmail bevestigt dat ze echt van Yuki komen (handtekening DKIM/SPF/DMARC) en stuurt ze — met de factuur-pdf —
      naar het Drive-script van het Planbord. Dat koppelt ze aan de juiste vordering (enkel bij een exact bedrag), zet de pdf in
      het klantenportaal en vult mededeling en vervaldag in. Daarna krijgt de mail hier het label Planbord/verwerkt of
      Planbord/te bekijken (label weghalen = opnieuw proberen). Mails met "Factuur van BROS" die niet van Yuki komen (bv. een
      antwoord van een klant) krijgen Planbord/overgeslagen. Is het Planbord niet bereikbaar, dan probeert het elk uur opnieuw;
      meldt het Planbord een fout bij een factuur (en mailt het info@ daarover), dan krijgt de mail na 3 keer Planbord/te bekijken.
   2. vraagt het Planbord welke verzonden facturen nog geen pdf hebben (laatste 120 dagen) en zoekt die op.
   Het leest enkel; het verstuurt geen mails en wijzigt niets anders in deze mailbox dan die drie labels.
   Zolang er nog geen echte Yuki-mail doorgestuurd is, blijft ook brosburo de Yuki-mails lezen (dubbel is onschadelijk).

   Installatie (eenmalig):
   0. In het Drive-script van het Planbord (brosburo): nieuwe versie plakken en online zetten, dan de functie archiefSecretMaken
      uitvoeren en de waarde uit het logboek kopiëren.
   1. Ga naar script.google.com, ingelogd als archief@bros.be → Nieuw project → noem het "BROS Yuki-mails" → plak deze code.
   2. Projectinstellingen (tandwiel) → Scripteigenschappen → toevoegen:
        PLANBORD_SCRIPT = de web-app-URL van het Drive-script van het Planbord (staat in config.js als driveScriptUrl,
                          https://script.google.com/macros/s/…/exec)
        ARCHIEF_SECRET  = de waarde uit stap 0
      (zelf invullen; nooit in de code. Het is bewust NIET het Drive-secret uit de Planbord-instellingen.)
   3. Kies bovenaan de functie archiefTest → Uitvoeren → toestemming geven (Gmail lezen/labelen, externe verbinding).
      Die verandert niets: ze toont de laatste Yuki-mails met of de handtekening bevestigd is, en test de verbinding.
   4. Ziet dat er goed uit: functie archiefInstall → Uitvoeren. Daarna draait het elk uur vanzelf.
   5. (eenmalig, 1.56.3) functie archiefInhalen → Uitvoeren: werkt 2 dagen lang ook de Yuki-mails en verzonden facturen van de
      voorbije ± 13 maanden af (pdf, mededeling, vervaldag en factuurnummer bij vorderingen die al op verzonden/betaald stonden).
   Stoppen: Triggers (wekker links) → de trigger archiefYuki verwijderen.
   ===================================================================== */
const ARCHIEF = {
  QUERY: 'subject:"Factuur van BROS" newer_than:60d -label:planbord-verwerkt -label:planbord-te-bekijken -label:planbord-overgeslagen',
  INHAAL_DAGEN: 400,           // archiefInhalen: eenmalig ook oudere Yuki-mails en facturen (tot ± 13 maanden terug), 2 dagen lang
  LABEL: "Planbord/verwerkt", LABEL_CHECK: "Planbord/te bekijken", LABEL_SKIP: "Planbord/overgeslagen",
  PER_KEER: 2,                 // mails per doorstuurbericht (met pdf; het Planbord leest de pdf — binnen de wachttijd blijven)
  MAX_PDF: 5 * 1048576,        // grotere pdf's niet meesturen
  POGINGEN: 3,                 // daarna label "te bekijken"
};
const YUKI_DOM_A = "(?:[\\w-]+\\.)*yukiworks\\.(?:be|nl)(?![\\w.-])";
/* 1.56.3: inhaalmodus — na archiefInhalen() werkt het script 2 dagen lang ook de oudere mails en facturen af (elk uur een deel) */
function archiefInhaal() { return Number(PropertiesService.getScriptProperties().getProperty("INHALEN_TOT") || 0) > Date.now(); }
function archiefQuery() { return archiefInhaal() ? ARCHIEF.QUERY.replace("newer_than:60d", "newer_than:" + ARCHIEF.INHAAL_DAGEN + "d") : ARCHIEF.QUERY; }
/** Eenmalig na de installatie: ook de Yuki-mails en verzonden facturen van de voorbije ± 13 maanden afwerken (2 dagen lang, elk uur een deel). */
function archiefInhalen() {
  PropertiesService.getScriptProperties().setProperty("INHALEN_TOT", String(Date.now() + 48 * 3600000));
  const n = GmailApp.search('subject:"Factuur van BROS" newer_than:' + ARCHIEF.INHAAL_DAGEN + 'd -label:planbord-verwerkt -label:planbord-te-bekijken -label:planbord-overgeslagen', 0, 500).length;
  Logger.log("Inhaalmodus aan voor 48 uur: " + n + " Yuki-conversatie(s) van de voorbije " + ARCHIEF.INHAAL_DAGEN + " dagen worden elk uur per 20 afgewerkt. Eerste ronde start nu.");
  archiefYuki();
}
function archiefLabel(naam) { return GmailApp.getUserLabelByName(naam) || GmailApp.createLabel(naam); }
function archiefInstall() {
  [ARCHIEF.LABEL, ARCHIEF.LABEL_CHECK, ARCHIEF.LABEL_SKIP].forEach(archiefLabel);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "archiefYuki").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("archiefYuki").timeBased().everyHours(1).create();
  const r = archiefPost({ action: "yukizoeklijst" });
  Logger.log("OK — labels en uurlijkse trigger aangemaakt in " + Session.getActiveUser().getEmail() + ". Verbinding met het Planbord: in orde (" + ((r && r.nummers) || []).length + " factu(u)r(en) zonder pdf om op te zoeken). Brosburo stopt met lezen zodra de eerste echte Yuki-mail doorgestuurd is.");
}
/** Droogloop: verandert niets, stuurt niets door. Toont de laatste Yuki-mails en test de verbinding met het Planbord. */
function archiefTest() {
  const lijnen = [];
  GmailApp.search('subject:"Factuur van BROS" newer_than:60d', 0, 10).forEach(t => t.getMessages().forEach(m => {
    if (lijnen.length >= 8 || !archiefIsYuki(m)) return;
    const pdf = m.getAttachments().find(a => /\.pdf$/i.test(a.getName()) && /factuur/i.test(a.getName()));
    lijnen.push(Utilities.formatDate(m.getDate(), "Europe/Brussels", "dd/MM/yyyy HH:mm") + " · " + m.getSubject() + " · handtekening Yuki " + (archiefEcht(m) ? "BEVESTIGD" : "NIET bevestigd (zou niet automatisch verwerkt worden)") + " · pdf " + (pdf ? "ja" : "nee"));
  }));
  Logger.log(lijnen.length ? "Laatste Yuki-mails in " + Session.getActiveUser().getEmail() + ":\n" + lijnen.join("\n") : "Geen Yuki-mails (Factuur van BROS, verstuurd via yukiworks) gevonden in de laatste 60 dagen (alle mappen) van " + Session.getActiveUser().getEmail() + ".");
  const r = archiefPost({ action: "yukizoeklijst" });
  Logger.log("Verbinding met het Planbord: in orde (" + ((r && r.nummers) || []).length + " factu(u)r(en) zonder pdf). Er is niets gewijzigd. Klopt dit, voer dan archiefInstall uit.");
}
function archiefPost(body) {
  const p = PropertiesService.getScriptProperties(); const url = String(p.getProperty("PLANBORD_SCRIPT") || "").trim(), secret = String(p.getProperty("ARCHIEF_SECRET") || "").trim();
  if (!url || !secret) throw new Error("Zet eerst de scripteigenschappen PLANBORD_SCRIPT en ARCHIEF_SECRET (Projectinstellingen → Scripteigenschappen).");
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error("PLANBORD_SCRIPT is geen geldige web-app-URL (https://script.google.com/macros/s/…/exec).");
  const r = UrlFetchApp.fetch(url, { method: "post", contentType: "text/plain;charset=utf-8", payload: JSON.stringify(Object.assign({}, body, { archief_secret: secret })), muteHttpExceptions: true, followRedirects: true });
  let j = null; try { j = JSON.parse(r.getContentText()); } catch (e) { throw new Error("Planbord-script gaf geen geldig antwoord (HTTP " + r.getResponseCode() + ")"); }
  if (j && j.ok === false) throw new Error("Planbord-script: " + (j.error || "fout"));
  return j;
}
/** Kopregels van de mail in volgorde (bovenaan = laatst toegevoegd, door Gmail zelf). null als de ruwe mail niet leesbaar is. */
function archiefKoppen(m) {
  try {
    const blok = String(m.getRawContent() || "").split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
    return blok.split(/\r?\n/).map(l => { const i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()] : null; }).filter(Boolean);
  } catch (e) { return null; }
}
/** Gmail bevestigde dat de mail echt van Yuki komt. Enkel de bovenste resultaten (door Gmail zelf toegevoegd):
 *  - DKIM of SPF geslaagd voor (een subdomein van) yukiworks.be/.nl, of
 *  - 1.56.3: via de Google-groep info@bros.be — Yuki mailt naar info@, de groep stuurt door naar archief@. Dan bevestigt Gmail
 *    "arc=pass (i=N … dkim=pass dkdomain=yukiworks.be)", en die ARC-stap N moet door Google zelf verzegeld zijn (d=google.com) met
 *    een eigen controle van mx.google.com: DKIM geslaagd voor yukiworks. De afzender moet een bros.be-adres zijn (accounting@bros.be). */
function archiefEcht(m) {
  const k = archiefKoppen(m);
  const eerste = (n) => k ? ((k.find(x => x[0] === n.toLowerCase()) || [])[1] || "") : (() => { try { return String(m.getHeader(n) || ""); } catch (e) { return ""; } })();
  const ar = eerste("Authentication-Results"); if (!/^mx\.google\.com\s*;/i.test(ar)) return false;
  const yuki = (re) => new RegExp(re.replace("YUKI", YUKI_DOM_A), "i");
  const direct = yuki("dkim=pass[^;]*header\\.[di]=@?YUKI").test(ar) || yuki("spf=pass[^;]*smtp\\.mailfrom=(?:[^;\\s@]*@)?YUKI").test(ar) || yuki("dmarc=pass[^;]*header\\.from=YUKI").test(ar);
  if (direct) return true;
  const a = ar.match(/\barc=pass \(i=(\d{1,2})\s([^)]*)\)/i);
  if (!k || !a || !yuki("(?:^|\\s)dkim=pass dkdomain=YUKI").test(a[2])) return false;
  const seal = k.find(x => x[0] === "arc-seal" && new RegExp("(?:^|;)\\s*i=" + a[1] + "\\s*(?:;|$)").test(x[1]));
  const aar = k.find(x => x[0] === "arc-authentication-results" && new RegExp("^i=" + a[1] + "\\s*;\\s*mx\\.google\\.com\\s*;").test(x[1]));
  const doorGoogle = !!seal && /(?:^|;)\s*d=google\.com\s*(?:;|$)/i.test(seal[1]) && /(?:^|;)\s*cv=(?:pass|none)\s*(?:;|$)/i.test(seal[1]);
  const vanBros = /@bros\.be>?\s*$/i.test(String(m.getFrom() || "").trim());
  return doorGoogle && !!aar && yuki("dkim=pass header\\.[di]=@?YUKI").test(aar[1]) && vanBros;
}
/** Komt de mail (volgens afzender, antwoordadres, Sender, Return-Path of Message-ID) van Yuki en gaat ze over een BROS-factuur?
 *  Enkel een voorselectie; of ze echt van Yuki komt, beslist archiefEcht. (Via de groep info@ staat yukiworks enkel nog in de Message-ID.) */
function archiefIsYuki(m) {
  const h = (n) => { try { return m.getHeader(n) || ""; } catch (e) { return ""; } };
  const kop = [m.getFrom(), m.getReplyTo(), h("Sender"), h("Return-Path"), h("Message-ID")].join(" ");
  return /yukiworks\./i.test(kop) && m.getSubject().indexOf("Factuur van BROS") >= 0;
}
/** Wat naar het Planbord gaat (de pdf pas hier ingepakt, per doorstuurbericht). */
function archiefBericht(m) {
  const pdf = m.getAttachments().find(a => /\.pdf$/i.test(a.getName()) && /factuur/i.test(a.getName()));
  return { id: m.getId(), onderwerp: m.getSubject(), van: m.getFrom(), tekst: m.getPlainBody() || "", echt: archiefEcht(m),
    pdf: pdf && pdf.getSize() <= ARCHIEF.MAX_PDF ? { naam: pdf.getName(), b64: Utilities.base64Encode(pdf.getBytes()) } : null };
}
function archiefYuki() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) return;
  const props = PropertiesService.getScriptProperties(); const t0 = Date.now(); let verstuurd = false; const fouten = [];
  try {
    const label = archiefLabel(ARCHIEF.LABEL), labelCheck = archiefLabel(ARCHIEF.LABEL_CHECK), labelSkip = archiefLabel(ARCHIEF.LABEL_SKIP);
    // 1. nieuwe Yuki-mails
    const items = [];
    GmailApp.search(archiefQuery(), 0, 20).forEach(t => {
      const ms = t.getMessages().filter(archiefIsYuki);
      if (!ms.length) { t.addLabel(labelSkip); return; }   // "Factuur van BROS" maar niet van Yuki (bv. antwoord van een klant): niet telkens opnieuw bekijken
      ms.forEach(m => items.push({ m: m, t: t }));
    });
    let n = 0;
    for (let i = 0; i < items.length && Date.now() - t0 < 240000; i += ARCHIEF.PER_KEER) {
      const deel = items.slice(i, i + ARCHIEF.PER_KEER); let res = null;
      try { const r = archiefPost({ action: "yukimails", mails: deel.map(x => archiefBericht(x.m)) }); res = (r && r.resultaten) || {}; verstuurd = true; }
      catch (e) { fouten.push(String(e.message || e)); }
      if (!res) continue;   // het Planbord was niet bereikbaar: niets tellen, gewoon volgend uur opnieuw (blijft het stil, dan meldt het Planbord dat na 2 dagen)
      deel.forEach(x => {
        const id = x.m.getId(), uit = res[id];
        if (uit && !/^fout/.test(uit)) { x.st = uit === "gekoppeld" || uit === "al gekoppeld" ? "ok" : "check"; props.deleteProperty("F_" + id); n++; return; }
        if (!uit) return;   // geen antwoord voor deze mail: volgend uur opnieuw
        // het Planbord meldde een fout bij deze factuur (en mailde info@ daarover): opnieuw proberen, na ARCHIEF.POGINGEN keer "te bekijken"
        const k = "F_" + id; const p = Number(String(props.getProperty(k) || "0").split("|")[0]) + 1;
        if (p >= ARCHIEF.POGINGEN) { x.st = "check"; props.deleteProperty(k); } else props.setProperty(k, p + "|" + Date.now());
      });
    }
    // label per thread, pas als elke Yuki-mail erin een definitief resultaat heeft (anders volgend uur opnieuw)
    const perThread = new Map(); items.forEach(x => { if (!perThread.has(x.t)) perThread.set(x.t, []); perThread.get(x.t).push(x.st); });
    perThread.forEach((st, t) => { if (st.every(Boolean)) t.addLabel(st.indexOf("check") >= 0 ? labelCheck : label); });
    if (items.length) Logger.log(n + " van " + items.length + " Yuki-mail(s) verwerkt door het Planbord.");
    // 2. verzonden facturen zonder pdf opzoeken (per factuur hooguit om de 6 uur)
    const inhaal = archiefInhaal();
    let lijst = []; try { lijst = (archiefPost({ action: "yukizoeklijst", dagen: inhaal ? ARCHIEF.INHAAL_DAGEN : 120 }) || {}).nummers || []; } catch (e) { fouten.push(String(e.message || e)); }
    lijst.forEach(nr => {
      if (Date.now() - t0 > 270000) return; nr = String(nr); const sleutel = "Z_" + nr; const vorig = Number(props.getProperty(sleutel) || 0); if (Date.now() - vorig < 6 * 3600000) return;
      props.setProperty(sleutel, String(Date.now()));
      try {
        const re = new RegExp("Factuurnummer\\s*:\\s*" + nr.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&") + "(?![0-9A-Za-z\\-\\/])");
        const gevonden = []; GmailApp.search('subject:"Factuur van BROS" "' + nr.replace(/"/g, "") + '" newer_than:' + (inhaal ? ARCHIEF.INHAAL_DAGEN + 60 : 180) + 'd', 0, 5).forEach(t => t.getMessages().forEach(m => { if (gevonden.length < 2 && archiefIsYuki(m) && re.test(m.getPlainBody() || "")) gevonden.push(m); }));
        if (gevonden.length) { const r = archiefPost({ action: "yukimails", zoek: true, mails: gevonden.map(archiefBericht) }); verstuurd = true; Logger.log("Factuur " + nr + ": " + JSON.stringify((r && r.resultaten) || {})); }
      } catch (e) { fouten.push("factuur " + nr + ": " + String(e.message || e)); }
    });
    // 3. opruimen: oude zoek- en pogingsleutels
    const alle = props.getProperties(); Object.keys(alle).forEach(k => { const ts = Number(String(alle[k]).split("|").pop()); if ((k.indexOf("Z_") === 0 && Date.now() - ts > 7 * 86400000) || (k.indexOf("F_") === 0 && Date.now() - ts > 30 * 86400000)) props.deleteProperty(k); });
    // 4. één rapportmail voor deze run (vanuit het Planbord-script)
    if (verstuurd) { try { archiefPost({ action: "yukimails", einde: true }); } catch (e) { fouten.push("afsluiten: " + String(e.message || e)); } }
  } finally { lock.releaseLock(); }
  if (fouten.length) throw new Error("Niet alles gelukt (wordt het volgende uur opnieuw geprobeerd): " + fouten.slice(0, 3).join(" | "));   // zichtbaar in Uitvoeringen; Google mailt archief@ bij een herhaalde fout
}
