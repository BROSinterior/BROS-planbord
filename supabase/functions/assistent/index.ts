// BROS Planbord — Edge Function "assistent": de AI-assistent van het klantenportaal.
// De klant stuurt een vraag (met zijn login-token); deze functie leest het dossier via de klant-views (dus onder de
// rechten van de klant: verkoopprijzen, geen kostprijs of marge), vraagt een klein model om een antwoord én — als er
// actie van BROS nodig is — één taakvoorstel, en bewaart alles. De API-sleutel staat enkel hier als secret.
//
// Installatie (Supabase → Edge Functions → Deploy a new function → via editor): naam "assistent", deze code plakken,
// "Verify JWT" UIT (we controleren het token zelf, ook voor klantlogins), secrets: OPENAI_API_KEY (en optioneel ANTHROPIC_API_KEY).
// SUPABASE_URL, SUPABASE_ANON_KEY en SUPABASE_SERVICE_ROLE_KEY zijn standaard aanwezig.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const PRIJS: Record<string, [number, number]> = { "gpt-4o-mini": [0.15, 0.60], "gpt-4.1-mini": [0.40, 1.60], "gpt-4.1-nano": [0.10, 0.40], "claude-3-5-haiku-latest": [0.80, 4.00], "claude-haiku-4-5": [1.00, 5.00] }; // USD per 1M tokens (in, uit)
const fmtD = (s?: string | null) => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "";
const eur = (n: unknown) => "€ " + Math.round(Number(n) || 0).toLocaleString("nl-BE");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST verwacht" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Niet aangemeld." }, 401);
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.project_id || ""); const vraag = String(body.vraag || "").trim().slice(0, 1500);
    if (!projectId || !vraag) return json({ error: "Geen project of vraag." }, 400);

    // 1. wie vraagt? (token van de klant) — alle dossierdata via de klant-views, onder zijn rechten
    const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user: u }, error: ue } = await user.auth.getUser(); if (ue || !u) return json({ error: "Login ongeldig of verlopen." }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: prof } = await admin.from("profiles").select("role,active,name").eq("id", u.id).maybeSingle();
    if (!prof || prof.active === false) return json({ error: "Geen actief profiel." }, 403);
    const isKlant = prof.role === "klant";
    // intern mag testen op elk project; klant enkel op zijn projecten (view klant_project is leeg voor anderen)
    const { data: pRows } = await (isKlant ? user.from("klant_project").select("*").eq("id", projectId) : admin.from("projecten").select("id,nummer,klant,naam,adres,postcode,gemeente,status,fase_nr,start,eind,projecttype,btw_tarief,offerte_datum,contract_datum,opgeleverd_op,lead,assistent").eq("id", projectId));
    const p = pRows && pRows[0]; if (!p) return json({ error: "Geen toegang tot dit project." }, 403);

    // 2. instellingen, plafond
    const { data: instRows } = await admin.from("instellingen").select("key,value").in("key", ["assistent", "portaal", "drive"]);
    const inst: Record<string, any> = {}; (instRows || []).forEach((r: any) => inst[r.key] = r.value || {});
    const cfg = inst.assistent || {};
    if (cfg.actief === false || p.assistent === false) return json({ error: "De assistent staat uit voor dit project." }, 403);
    const maand = new Date(); maand.setDate(1); maand.setHours(0, 0, 0, 0);
    const { count: nProj } = await admin.from("assistent_berichten").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("rol", "klant").gte("created_at", maand.toISOString());
    const { count: nAlles } = await admin.from("assistent_berichten").select("id", { count: "exact", head: true }).eq("rol", "klant").gte("created_at", maand.toISOString());
    const plafondP = Number(cfg.plafond_project) || 0, plafondG = Number(cfg.plafond_globaal) || 0;
    const overPlafond = (plafondP && (nProj || 0) >= plafondP) || (plafondG && (nAlles || 0) >= plafondG);

    // 3. gesprek (één per klant en project)
    let { data: g } = await admin.from("assistent_gesprekken").select("id").eq("project_id", projectId).eq("user_id", u.id).maybeSingle();
    if (!g) { const { data: c } = await admin.from("contacten").select("id").eq("user_id", u.id).limit(1).maybeSingle(); const ins = await admin.from("assistent_gesprekken").insert({ project_id: projectId, user_id: u.id, contact_id: c?.id || null }).select("id").single(); g = ins.data; }
    if (!g) return json({ error: "Gesprek kon niet aangemaakt worden." }, 500);
    const { data: vorige } = await admin.from("assistent_berichten").select("rol,tekst").eq("gesprek_id", g.id).order("created_at", { ascending: false }).limit(10);
    const { data: bk } = await admin.from("assistent_berichten").insert({ gesprek_id: g.id, project_id: projectId, rol: "klant", tekst: vraag }).select("id").single();

    const routering = cfg.routering || {};
    const { data: beheer } = await admin.from("profiles").select("id,name,email").eq("role", "beheer").eq("active", true).order("created_at").limit(1).maybeSingle();
    const naar = (onderwerp: string) => routering[onderwerp] || routering.overig || beheer?.id || null;
    const dagen = (n: number) => { const d = new Date(); d.setDate(d.getDate() + Math.max(1, Math.min(30, n || 7))); return d.toISOString().slice(0, 10); };

    // 4. over het plafond: vriendelijk antwoord + voorstel, zonder modeloproep
    if (overPlafond) {
      const antwoord = "Ik geef je vraag door aan het team van BROS; iemand neemt contact met je op. (Het maandelijkse aantal vragen voor de assistent is bereikt.)";
      const { data: ba } = await admin.from("assistent_berichten").insert({ gesprek_id: g.id, project_id: projectId, rol: "assistent", tekst: antwoord }).select("id").single();
      const vs = { project_id: projectId, bericht_id: ba?.id || bk?.id, titel: "Vraag van de klant beantwoorden: " + vraag.slice(0, 80), onderwerp: "overig", omschrijving: "De assistent stond boven zijn plafond; de klant wacht op een antwoord.", vraag, antwoord, voorgestelde_user: naar("overig"), eind: dagen(3), urgentie: "normaal" };
      const { data: v } = await admin.from("taak_voorstellen").insert(vs).select("id").single();
      mail(inst.drive, v?.id).catch(() => { });
      await admin.from("assistent_gesprekken").update({ laatste_op: new Date().toISOString() }).eq("id", g.id);
      return json({ antwoord, voorstel: true });
    }

    // 5. dossier samenstellen (klant-views onder het token van de klant; intern via de tabellen)
    const q = async (view: string, cols = "*") => { const r = await (isKlant ? user : admin).from(view).select(cols).eq("project_id", projectId); return r.data || []; };
    const [fasen, planning, planTaken, meetstaat, vorderingen, docs, notities, taken, gks, verslagen, team, loten] = await Promise.all([
      admin.from("fasen").select("nr,naam").order("nr").then(r => r.data || []),
      isKlant ? q("klant_planning") : admin.from("klant_planning").select("*").eq("project_id", projectId).then(r => r.data || []),
      isKlant ? q("klant_planning_taken") : admin.from("taken").select("id,project_id,fase_nr,titel,start,eind,status").eq("project_id", projectId).eq("timing_klant", true).then(r => r.data || []),
      isKlant ? q("klant_meetstaat") : admin.from("meetstaat_posten_v").select("id,project_id,lot,code,omschrijving,eenheid,hoeveelheid,verkoop_ep,status").eq("project_id", projectId).then(r => (r.data || []).map((x: any) => ({ ...x, prijs: x.verkoop_ep, totaal: (Number(x.hoeveelheid) || 0) * (Number(x.verkoop_ep) || 0) }))),
      isKlant ? q("klant_vorderingen") : admin.from("vorderingen").select("id,project_id,nr,soort,omschrijving,datum,factuurnummer,bedrag_excl,status").eq("project_id", projectId).then(r => r.data || []),
      isKlant ? q("klant_documenten") : admin.from("documenten").select("naam,pad,gewijzigd").eq("project_id", projectId).eq("gedeeld", true).then(r => r.data || []),
      isKlant ? q("klant_notities") : admin.from("notities").select("titel,soort,datum,inhoud").eq("project_id", projectId).eq("klant_zichtbaar", true).then(r => r.data || []),
      isKlant ? q("klant_taken") : admin.from("taken").select("titel,eind,status").eq("project_id", projectId).not("contact_id", "is", null).then(r => r.data || []),
      isKlant ? q("klant_goedkeuringen") : admin.from("goedkeuringen").select("titel,soort,status,geldig_tot,voorgelegd_op").eq("project_id", projectId).then(r => r.data || []),
      isKlant ? q("klant_werfverslagen") : admin.from("werfverslagen").select("nr,datum,punten").eq("project_id", projectId).eq("klant_zichtbaar", true).then(r => r.data || []),
      admin.from("profiles").select("id,name,functie").eq("active", true).neq("role", "klant").then(r => r.data || []),
      admin.from("loten").select("nr,naam").then(r => r.data || []),
    ]);
    const faseNaam = (nr: number) => { const f = (fasen as any[]).find(x => x.nr === nr); return f ? `${nr}. ${f.naam}` : String(nr || ""); };
    const lotNaam = (nr: number) => { const l = (loten as any[]).find(x => x.nr === nr); return l ? `${nr}. ${l.naam}` : String(nr); };
    const lead = (team as any[]).find(t => t.id === p.lead);
    const toonDatums = cfg.datums !== false;
    const perLot: Record<string, { n: number; som: number; open: number }> = {};
    (meetstaat as any[]).forEach(m => { if (m.status === "vervallen") return; const k = String(m.lot); perLot[k] = perLot[k] || { n: 0, som: 0, open: 0 }; perLot[k].n++; perLot[k].som += Number(m.totaal) || 0; if (m.status === "offerte") perLot[k].open++; });
    const msTot = Object.values(perLot).reduce((s, x) => s + x.som, 0);
    const gefact = (vorderingen as any[]).filter(v => v.status === "verzonden" || v.status === "betaald").reduce((s, v) => s + (Number(v.bedrag_excl) || 0), 0);
    const betaald = (vorderingen as any[]).filter(v => v.status === "betaald").reduce((s, v) => s + (Number(v.bedrag_excl) || 0), 0);
    const dossier = [
      `PROJECT: ${p.klant}${p.naam && p.naam !== p.klant ? " · " + p.naam : ""} (nr ${p.nummer || "?"}), werf: ${[p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "onbekend"}`,
      `Status: ${p.status}; huidige fase: ${p.fase_nr ? faseNaam(p.fase_nr) : "onbekend"}; type: ${p.projecttype || "-"}`,
      `Sleuteldata: offerte ${fmtD(p.offerte_datum) || "-"}, contract ${fmtD(p.contract_datum) || "-"}, oplevering ${fmtD(p.opgeleverd_op) || "-"}`,
      `Aanspreekpunt bij BROS: ${lead ? lead.name + (lead.functie ? " (" + lead.functie + ")" : "") : "het team"}. Team: ${(team as any[]).map(t => t.name + (t.functie ? " – " + t.functie : "")).join(", ")}`,
      "",
      "PLANNING PER FASE" + (toonDatums ? " (planning, kan schuiven):" : " (alleen fasen; data niet meedelen):"),
      ...(planning as any[]).sort((a, b) => a.fase_nr - b.fase_nr).map(x => `- ${faseNaam(x.fase_nr)}: ${toonDatums ? `${fmtD(x.start) || "?"} → ${fmtD(x.eind) || "?"}` : ""}${x.opmerking ? " · " + x.opmerking : ""}${x.taken ? ` · ${x.klaar}/${x.taken} taken klaar` : ""}`),
      ...(toonDatums ? (planTaken as any[]).map(t => `  · taak "${t.titel}" (${faseNaam(t.fase_nr)}): ${fmtD(t.start)} → ${fmtD(t.eind)}, ${t.status === "done" ? "klaar" : t.status === "busy" ? "bezig" : "gepland"}`) : []),
      "",
      `MEETSTAAT (verkoopprijzen excl. btw, totaal ${eur(msTot)}):`,
      ...Object.keys(perLot).sort((a, b) => Number(a) - Number(b)).map(k => `- ${lotNaam(Number(k))}: ${perLot[k].n} posten, ${eur(perLot[k].som)}${perLot[k].open ? ` (${perLot[k].open} nog in offerte, niet goedgekeurd)` : ""}`),
      ...(meetstaat as any[]).filter(m => m.status === "meerwerk" || m.status === "minwerk").slice(0, 30).map(m => `  · ${m.status}: ${m.omschrijving} — ${eur(m.totaal)}`),
      "",
      `FACTURATIE: ${(vorderingen as any[]).length} facturen/vorderingen; gefactureerd ${eur(gefact)} excl. btw, waarvan betaald ${eur(betaald)}; nog te factureren ca. ${eur(Math.max(0, msTot - gefact))}`,
      ...(vorderingen as any[]).slice(0, 20).map(v => `- ${v.omschrijving || v.soort || "vordering"}${v.nr ? " (" + v.nr + ")" : ""}: ${v.status}${v.factuurnummer ? " · factuur " + v.factuurnummer : ""}${v.datum ? " · " + fmtD(v.datum) : ""} · ${eur(v.bedrag_excl)} excl. btw`),
      "",
      "OPEN GOEDKEURINGEN (wachten op de klant): " + ((gks as any[]).filter(g => g.status === "open").map(g => `${g.titel} (reageren vóór ${fmtD(g.geldig_tot) || "-"})`).join("; ") || "geen"),
      "GEDEELDE DOCUMENTEN: " + ((docs as any[]).map(d => d.naam).slice(0, 40).join(", ") || "geen"),
      "WERFVERSLAGEN (pdf in het portaal): " + ((verslagen as any[]).map(w => `nr ${w.nr} van ${fmtD(w.datum)} (${w.punten} punten)`).join("; ") || "geen"),
      "ACTIEPUNTEN VOOR DE KLANT: " + ((taken as any[]).map(t => `${t.titel}${t.eind ? " tegen " + fmtD(t.eind) : ""} (${t.status === "done" ? "klaar" : "open"})`).join("; ") || "geen"),
      "",
      "GEDEELDE VERSLAGEN:",
      ...(notities as any[]).slice(0, 8).map(n => `- ${fmtD(n.datum)} ${n.titel || n.soort}: ${String(n.inhoud || "").replace(/\s+/g, " ").slice(0, 600)}`),
      inst.portaal?.werkwijze ? "\nHOE HET BIJ BROS WERKT: " + String(inst.portaal.werkwijze).slice(0, 1500) : "",
    ].join("\n");

    // 6. het model
    const model = String(cfg.model || "gpt-4o-mini");
    const systeem = `Je bent de assistent van BROS, een interieur- en aannemingsbureau uit Antwerpen, in het klantenportaal. Je antwoordt de klant (aanspreken met "je") over ZIJN dossier, in het Nederlands (Vlaams), kort en warm, zonder opsommingen tenzij nodig.
REGELS:
- Antwoord uitsluitend op basis van het DOSSIER hieronder. Staat iets er niet in, zeg dat dan en geef het door aan BROS; verzin nooit data, bedragen of beloften.
- ${toonDatums ? "Data uit de planning mag je noemen, altijd met de nuance dat het een planning is die kan schuiven." : "Noem geen concrete data; verwijs voor timing naar BROS en zeg in welke fase het project zit."}
- Prijzen: enkel de verkoopprijzen uit het dossier; nooit iets zeggen over kostprijzen, marges of interne uren.
- Over prijzen die nog niet definitief zijn (status offerte) en beslissingen: BROS beslist, jij niet.
- Als de vraag iets vereist dat BROS moet doen (iets bevestigen, plannen, aanpassen, opsturen, bellen, een klacht of ontevredenheid), maak dan een taakvoorstel: titel (kort, voor het team), onderwerp (planning|facturatie|ontwerp|documenten|klacht|overig), omschrijving (wat BROS moet doen), urgentie (normaal|hoog; klacht = hoog), eind_dagen (binnen hoeveel dagen; standaard 5). Een pure informatievraag die je uit het dossier kan beantwoorden heeft GEEN voorstel nodig.
- Zeg de klant kort dat je iets doorgeeft als je een voorstel maakt ("ik geef dit door aan Thomas van BROS").
Antwoord ALTIJD als JSON: {"antwoord": "...", "voorstel": null | {"titel": "...", "onderwerp": "...", "omschrijving": "...", "urgentie": "normaal", "eind_dagen": 5}}

DOSSIER:
${dossier}`;
    const history = (vorige || []).reverse().map((m: any) => ({ role: m.rol === "klant" ? "user" : "assistant", content: m.tekst }));
    const messages = [{ role: "system", content: systeem }, ...history, { role: "user", content: vraag }];
    let out: any = null, tin = 0, tuit = 0;
    if (/^claude/i.test(model)) {
      const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return json({ error: "ANTHROPIC_API_KEY ontbreekt als secret." }, 500);
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 700, system: systeem, messages: messages.slice(1) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || "Anthropic " + r.status);
      tin = j.usage?.input_tokens || 0; tuit = j.usage?.output_tokens || 0; out = parseJson(j.content?.[0]?.text || "");
    } else {
      const key = Deno.env.get("OPENAI_API_KEY"); if (!key) return json({ error: "OPENAI_API_KEY ontbreekt als secret." }, 500);
      const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 700, response_format: { type: "json_object" } }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || "OpenAI " + r.status);
      tin = j.usage?.prompt_tokens || 0; tuit = j.usage?.completion_tokens || 0; out = parseJson(j.choices?.[0]?.message?.content || "");
    }
    const antwoord = String(out?.antwoord || "Ik kon je vraag niet beantwoorden; ik geef ze door aan BROS.").trim();
    const [pi, po] = PRIJS[model] || [0.5, 2]; const kost = (tin * pi + tuit * po) / 1e6 * 0.92;   // ≈ euro
    const { data: ba } = await admin.from("assistent_berichten").insert({ gesprek_id: g.id, project_id: projectId, rol: "assistent", tekst: antwoord, tokens_in: tin, tokens_uit: tuit, kost, model }).select("id").single();
    await admin.from("assistent_gesprekken").update({ laatste_op: new Date().toISOString() }).eq("id", g.id);

    // 7. taakvoorstel
    let voorstel = false;
    const v = out?.voorstel;
    if (v && typeof v === "object" && (v.titel || v.omschrijving)) {
      const onderwerp = ["planning", "facturatie", "ontwerp", "documenten", "klacht", "overig"].includes(v.onderwerp) ? v.onderwerp : "overig";
      const rij = { project_id: projectId, bericht_id: ba?.id || null, titel: String(v.titel || "Vraag van de klant").slice(0, 160), onderwerp, omschrijving: String(v.omschrijving || "").slice(0, 1000), vraag, antwoord, voorgestelde_user: naar(onderwerp), eind: dagen(Number(v.eind_dagen) || 5), urgentie: onderwerp === "klacht" || v.urgentie === "hoog" ? "hoog" : "normaal" };
      const { data: tv } = await admin.from("taak_voorstellen").insert(rij).select("id").single();
      voorstel = !!tv; mail(inst.drive, tv?.id).catch(() => { });
    }
    return json({ antwoord, voorstel, over_plafond: false, resterend: plafondP ? Math.max(0, plafondP - (nProj || 0) - 1) : null });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function parseJson(s: string) { try { return JSON.parse(s); } catch (_) { const m = s.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (_2) { /* leeg */ } } return { antwoord: s.trim() }; } }
/** melding naar de verantwoordelijke via het Drive-script (actie assistentmail); mislukt stil */
async function mail(drive: any, voorstelId?: string) {
  if (!voorstelId || !drive?.url || !drive?.secret) return;
  await fetch(drive.url, { method: "POST", body: JSON.stringify({ action: "assistentmail", secret: drive.secret, id: voorstelId }), redirect: "follow" });
}
