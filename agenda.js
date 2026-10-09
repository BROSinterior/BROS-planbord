/* =====================================================================
   BROS — agendabestanden voor afspraken (script 041)
   Gedeeld door het Planbord, het klantenportaal en het aannemersportaal (window.BROS_AGENDA).
   - ics(a, opties): een .ics-bestand (Apple Agenda, Outlook, Google, …) in Brusselse tijd
   - googleUrl(a): link "toevoegen aan Google Agenda"
   - download(a, opties): het .ics-bestand downloaden
   a = { id, onderwerp, datum (yyyy-mm-dd), van (hh:mm[:ss]), tot, adres, met, volgnr, project }
   (Het Drive-script maakt hetzelfde bestand voor de mail: zelfde UID → een nieuwe versie vervangt de oude.)
   ===================================================================== */
(function () {
  const BROS_ADRES = "BROS, Kloosterstraat 165, 2000 Antwerpen";
  const VTZ = ["BEGIN:VTIMEZONE", "TZID:Europe/Brussels",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"];
  const esc = (s) => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  // regels van max. 75 tekens (RFC 5545), vervolgregels beginnen met een spatie
  const vouw = (l) => { const o = []; let cur = "", n = 0; for (const ch of l) { const c = ch.codePointAt(0); const b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; if (n + b > 74) { o.push(cur); cur = " "; n = 1; } cur += ch; n += b; } o.push(cur); return o.join("\r\n"); };   // max. 75 bytes (UTF-8)
  const hhmm = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? [Number(m[1]), Number(m[2])] : null; };
  const pad = (n) => String(n).padStart(2, "0");
  /* begin en einde als "yyyymmddThhmmss" (lokale Brusselse tijd); zonder einduur = 1 uur, nooit voorbij middernacht */
  function tijden(a) {
    const d = String(a.datum || "").replace(/-/g, ""); const v = hhmm(a.van) || [9, 0]; let t = hhmm(a.tot);
    if (!t || t[0] * 60 + t[1] <= v[0] * 60 + v[1]) { const m = Math.min(v[0] * 60 + v[1] + 60, 23 * 60 + 59); t = [Math.floor(m / 60), m % 60]; }
    return [`${d}T${pad(v[0])}${pad(v[1])}00`, `${d}T${pad(t[0])}${pad(t[1])}00`];
  }
  function stamp() { const n = new Date(); return `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}T${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`; }
  function titel(a, o) { return (o && o.titel) || ("BROS: " + (a.onderwerp || "afspraak")); }
  function omschrijving(a, o) {
    if (o && o.omschrijving != null) return o.omschrijving;
    return [a.met ? `Afspraak met ${a.met} (BROS)` : "Afspraak met BROS", a.project || "", "Vragen? info@bros.be"].filter(Boolean).join("\n");
  }
  function ics(a, o) {
    o = o || {}; const [s, e] = tijden(a); const weg = !!o.geannuleerd;
    const r = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BROS//Planbord//NL", "CALSCALE:GREGORIAN", "METHOD:" + (weg ? "CANCEL" : "PUBLISH"), ...VTZ,
      "BEGIN:VEVENT", "UID:taak-" + a.id + "@bros.be", "DTSTAMP:" + stamp(), "SEQUENCE:" + (Number(a.volgnr) || 0),
      "DTSTART;TZID=Europe/Brussels:" + s, "DTEND;TZID=Europe/Brussels:" + e,
      "SUMMARY:" + esc(titel(a, o)), "LOCATION:" + esc(a.adres || ""), "DESCRIPTION:" + esc(omschrijving(a, o)),
      "STATUS:" + (weg ? "CANCELLED" : "CONFIRMED"), "TRANSP:OPAQUE",
      ...(weg ? [] : ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(titel(a, o)), "TRIGGER:-PT1H", "END:VALARM"]),
      "END:VEVENT", "END:VCALENDAR"];
    return r.map(vouw).join("\r\n") + "\r\n";
  }
  function googleUrl(a, o) {
    const [s, e] = tijden(a);
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(titel(a, o)) + "&dates=" + s + "/" + e +
      "&ctz=Europe%2FBrussels&location=" + encodeURIComponent(a.adres || "") + "&details=" + encodeURIComponent(omschrijving(a, o));
  }
  function bestandsnaam(a) { return ("BROS " + (a.datum || "") + " " + (a.onderwerp || "afspraak")).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) + ".ics"; }
  function download(a, o) {
    const blob = new Blob([ics(a, o)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob); const l = document.createElement("a"); l.href = url; l.download = bestandsnaam(a);
    document.body.appendChild(l); l.click(); setTimeout(() => { URL.revokeObjectURL(url); l.remove(); }, 1500);
  }
  /* paneel "Je afspraken met BROS" voor de portalen (o.esc, o.datum = datumopmaak, o.project(a) = optioneel projectlabel, o.opties(a) = titel/omschrijving voor de agenda) */
  const DAG = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
  const PLAATS = { werf: "Op de werf", kantoor: "Op kantoor bij BROS", elders: "" };
  const vandaag = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
  const komend = (lijst) => (lijst || []).filter(a => a.datum >= vandaag()).sort((a, b) => (a.datum + (a.van || "")).localeCompare(b.datum + (b.van || "")));
  function paneel(lijst, o) {
    const l = komend(lijst); if (!l.length) return "";
    const e = o.esc, kort = (t) => String(t || "").slice(0, 5);
    return `<div class="panel" id="afspraken" style="border-color:var(--blue);margin-bottom:16px"><div class="panel-head"><h2>Je afspraken met BROS</h2></div><div class="panel-body" style="display:grid;gap:14px">` + l.map(a => {
      const dag = DAG[new Date(a.datum + "T12:00:00").getDay()]; const pr = o.project ? o.project(a) : "";
      return `<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:12px"><div style="min-width:220px;flex:1">
        <b>${e(a.onderwerp)}</b><div style="font-size:14px;margin-top:2px"><span>${dag}</span> <span>${e(o.datum(a.datum))}</span> · <span>${e(kort(a.van))}${a.tot ? "–" + e(kort(a.tot)) : ""}</span></div>
        <div class="muted" style="font-size:13px">${PLAATS[a.plaats] ? `<span>${PLAATS[a.plaats]}</span> · ` : ""}${e(a.adres || "")}</div>
        <div class="muted" style="font-size:12px"><span>Met</span> ${e(a.met || "BROS")}${pr ? " · " + e(pr) : ""}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm primary" data-act="afs-ics" data-id="${e(a.id)}"><span>In mijn agenda</span></button><a class="btn sm" href="${e(googleUrl(a, o.opties ? o.opties(a) : undefined))}" target="_blank" rel="noopener"><span>Google Agenda</span></a></div></div>`; }).join("")
      + `<p class="muted" style="font-size:12px;margin:0"><span>Met "In mijn agenda" download je een agendabestand voor Apple Agenda, Outlook en andere agenda's.</span></p></div></div>`;
  }
  window.BROS_AGENDA = { BROS_ADRES, ics, googleUrl, download, tijden, bestandsnaam, paneel, komend };
})();
