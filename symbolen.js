/* =====================================================================
   BROS Planbord — symbolenbibliotheek (tekenmodule)
   Bron: de legende elektriciteit uit de Vectorworks-export 011026_UV_Hens.dwg (01/10/2026) — die symbolen
   hebben bron: "dwg" en zijn 1-op-1 overgenomen (wereld-mm / 50). TL-lamp, gastoevoer, vloerstopcontact en de
   sanitair-/HVAC-symbolen zijn nagetekend (in de dwg onvolledig of niet aanwezig).
   v1.32: bij de (richtbare) spot is de volle cirkel uit de dwg-arcering vervangen door de twee rode wiggen
   (boven en onder) zoals op de plannen en in de legende van Hens Didier.

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
const SYM_KLEUR = { g: "#2E9E4F", r: "#D42A20", b: "#1F5FD6", w: "#FFFFFF", k: "#1D1D1F", grijs: "#8E8E93" };
const SYM_BASIS = { l: 5, c: 5, a: 6, r: 6, t: 6 };   // aantal velden zonder kleur; een extra laatste veld = kleur
const X_IN = (x, y, r) => [["l", x - r * .7071, y - r * .7071, x + r * .7071, y + r * .7071], ["l", x - r * .7071, y + r * .7071, x + r * .7071, y - r * .7071]];
const STOP = (kl) => [["l", 0, 0, 1.4, 0, kl], ["l", 1.4, -1.1, 1.4, 1.1, kl], ["a", 2.6, 0, 1.1, 90, 270, kl]];      // —|(  stopcontact
const ARROW = (x, y, kl) => [["l", x, y, x - 1.4, y - 1.4, kl], ["p", [x - 1.4, y - 1.4, x - 0.5, y - 1.5, x - 1.3, y - 0.6], true, kl]];

const SYMBOLEN = {
  stopcontact: { naam: "Stopcontact", laag: "elektro", wand: true, bron: "dwg", d: [["p",[4.5,1.0,4.16,0.94,3.86,0.77,3.63,0.5,3.56,0.34,3.5,0.0,3.56,-0.34,3.73,-0.64,4.0,-0.87,4.16,-0.94,4.5,-1.0],false],["l",3.5,0.0,1.5,0.0],["l",3.5,1.0,3.5,-1.0]] },
  stopcontact_gesch: { naam: "Geschakeld stopcontact", laag: "elektro", wand: true, bron: "dwg", d: [["p",[4.5,1.0,4.16,0.94,3.86,0.77,3.63,0.5,3.56,0.34,3.5,0.0,3.56,-0.34,3.73,-0.64,4.0,-0.87,4.16,-0.94,4.5,-1.0],false,"g"],["l",3.5,0.0,1.5,0.0,"g"],["l",3.5,1.0,3.5,-1.0,"g"]] },
  vloerstopcontact:   { naam: "Vloerstopcontact", laag: "elektro", d: [["r", 1.1, -1.4, 3.8, 2.8, 0], ...[["p",[4.5,1.0,4.16,0.94,3.86,0.77,3.63,0.5,3.56,0.34,3.5,0.0,3.56,-0.34,3.73,-0.64,4.0,-0.87,4.16,-0.94,4.5,-1.0],false],["l",3.5,0.0,1.5,0.0],["l",3.5,1.0,3.5,-1.0]]] },
  data: { naam: "Telefoon-/datastopcontact", laag: "elektro", wand: true, bron: "dwg", d: [["p",[4.5,-1.0,4.16,-0.94,3.86,-0.77,3.63,-0.5,3.56,-0.34,3.5,0.0,3.56,0.34,3.73,0.64,4.0,0.87,4.16,0.94,4.5,1.0],false],["l",3.5,0.0,1.5,0.0],["l",3.5,-1.0,3.5,1.0],["t",5.03,-0.59,"DATA",1.01,"l"]] },
  tv: { naam: "Tv-aansluiting", laag: "elektro", wand: true, bron: "dwg", d: [["p",[4.5,-1.0,4.16,-0.94,3.86,-0.77,3.63,-0.5,3.56,-0.34,3.5,0.0,3.56,0.34,3.73,0.64,4.0,0.87,4.16,0.94,4.5,1.0],false],["l",3.5,0.0,1.5,0.0],["l",3.5,-1.0,3.5,1.0],["t",5.03,-0.59,"DISTR",1.01,"l"]] },
  schakelaar: { naam: "Schakelaar", laag: "elektro", wand: true, bron: "dwg", d: [["c",0.0,0.0,0.5,0],["l",3.0,0.5,0.0,0.5],["l",3.0,0.5,3.0,-0.5]] },
  schakelaar_gesch: { naam: "Schakelaar geschakelde stopcontacten", laag: "elektro", wand: true, bron: "dwg", d: [["c",0.0,0.0,0.5,0,"g"],["l",3.0,0.5,0.0,0.5,"g"],["l",3.0,0.5,3.0,-0.5,"g"]] },
  voeding: { naam: "Voeding", laag: "elektro", bron: "dwg", d: [["p",[-1.14,-0.85,-0.32,1.14,-0.32,-1.14,1.14,0.54,0.42,0.25,0.95,-0.28,1.14,0.54],false],["p",[0.42,0.25,0.95,-0.28,1.14,0.54],true,"fill"],["p",[0.42,0.25,0.95,-0.28,1.14,0.54],true]] },
  lichtpunt: { naam: "Centraal lichtpunt", laag: "verlichting", bron: "dwg", d: [["p",[1.19,0.0,1.16,0.32,1.08,0.52,0.84,0.85,0.6,1.04,0.3,1.16,-0.09,1.19,-0.26,1.17,-0.57,1.05,-0.88,0.81,-1.01,0.64,-1.14,0.36,-1.19,0.1,-1.19,-0.13,-1.12,-0.41,-1.04,-0.58,-0.93,-0.75,-0.71,-0.96,-0.42,-1.12,-0.18,-1.18,0.09,-1.19,0.51,-1.08,0.84,-0.85,0.97,-0.7,1.1,-0.47,1.17,-0.25],true],["l",-0.84,0.84,0.84,-0.84],["l",0.84,0.84,-0.84,-0.84]] },
  hanglamp: { naam: "Hanglamp", laag: "verlichting", bron: "dwg", d: [["p",[1.19,0.0,1.16,0.32,1.08,0.52,0.93,0.75,0.75,0.93,0.54,1.07,0.3,1.16,-0.09,1.19,-0.26,1.17,-0.57,1.05,-0.88,0.81,-1.08,0.52,-1.14,0.36,-1.2,-0.05,-1.1,-0.47,-0.97,-0.7,-0.77,-0.91,-0.42,-1.12,-0.18,-1.18,0.09,-1.19,0.51,-1.08,0.71,-0.96,0.93,-0.75,1.1,-0.47,1.17,-0.25],true],["l",-0.84,0.84,0.84,-0.84],["l",0.84,0.84,-0.84,-0.84],["c",0.0,0.0,1.9,0]] },
  spot: { naam: "In- of opbouwspot", laag: "verlichting", bron: "dwg", d: [["p",[0,0,0.74,0.74,0.44,0.95,0.09,1.05,-0.09,1.05,-0.44,0.95,-0.74,0.74],true,"fill"],["p",[0,0,-0.74,-0.74,-0.44,-0.95,-0.09,-1.05,0.09,-1.05,0.44,-0.95,0.74,-0.74],true,"fill"],["c",0.0,0.0,1.05,0],["p",[-0.75,0.73,-0.98,0.39,-1.05,-0.02,-1.03,-0.22,-0.96,-0.42,-0.86,-0.6,-0.73,-0.75],false],["p",[0.75,-0.73,0.98,-0.39,1.05,0.02,1.03,0.22,0.96,0.42,0.86,0.6,0.73,0.75],false]] },
  spot_richtbaar: { naam: "Richtbare in- of opbouwspot", laag: "verlichting", bron: "dwg", d: [["p",[0.52,0.55,1.26,1.29,0.96,1.5,0.61,1.6,0.43,1.6,0.08,1.5,-0.22,1.29],true,"fill"],["p",[0.52,0.55,-0.22,-0.19,0.08,-0.4,0.43,-0.5,0.61,-0.5,0.96,-0.4,1.26,-0.19],true,"fill"],["c",0.52,0.55,1.05,0],["p",[-0.24,1.28,-0.37,1.12,-0.46,0.94,-0.52,0.74,-0.53,0.53,-0.45,0.13,-0.35,-0.05,-0.21,-0.21],false],["p",[1.27,-0.18,1.4,-0.02,1.49,0.16,1.57,0.56,1.48,0.97,1.38,1.15,1.25,1.3],false],["l",0.52,0.55,-1.57,-1.6],["p",[-1.01,-0.61,-1.57,-1.6,-0.59,-1.02],true]] },
  applique: { naam: "Wandapplique (opbouw)", laag: "verlichting", wand: true, bron: "dwg", d: [["l",0.0,1.2,0.0,-1.2],["p",[0.9,-0.85,1.15,-0.51,1.26,-0.11,1.26,0.11,1.15,0.51,0.9,0.85,0.0,0.0],true,"fill"]] },
  applique_richtbaar: { naam: "Richtbare wandapplique (opbouw)", laag: "verlichting", wand: true, bron: "dwg", d: [["l",0.0,1.61,0.0,-0.79],["p",[0.9,-0.44,1.04,-0.29,1.15,-0.1,1.26,0.3,1.26,0.51,1.15,0.92,1.04,1.1,0.9,1.25,0.0,0.41],true,"fill"],["l",0.0,0.41,2.13,-1.61],["p",[1.45,-0.48,2.13,-1.61,0.98,-0.97],true,"fill"]] },
  applique_inbouw: { naam: "Wandapplique (inbouw – Brick in the Wall)", laag: "verlichting", wand: true, bron: "dwg", d: [["l",2.33,1.2,-2.33,-1.2],["l",2.33,-1.2,-2.33,1.2]] },
  tl:                 { naam: "TL-lamp", laag: "verlichting", d: [["l", -3, 0.35, 3, 0.35], ["l", -3, -0.35, 3, -0.35], ["l", -3, -0.8, -3, 0.8], ["l", 3, -0.8, 3, 0.8]] },
  ledstrip: { naam: "LED-strip + transfo", laag: "verlichting", lijn: true, bron: "dwg", d: [["p",[-3.0,0.1,3.0,0.1,3.0,-0.1,-3.0,-0.1],true,"fill"],["p",[-3.0,0.1,3.0,0.1,3.0,-0.1,-3.0,-0.1],true]] },
  ventiel: { naam: "Ventilatieventiel", laag: "hvac", bron: "dwg", d: [["c",0.0,0.0,1.8,0,"g"],["t",0,-0.55,"V",1.5,"c","g"]] },
  prado: { naam: "Prado-spot inclusief ventilatie", laag: "hvac", bron: "dwg", d: [["c",0.0,0.0,1.8,0,"g"],["t",0,-0.55,"V",1.5,"c","g"],["p",[0.74,-0.74,0.0,0.0,-0.74,-0.74,-0.44,-0.95,-0.09,-1.05,0.09,-1.05,0.44,-0.95],true,"fill"],["p",[0.74,-0.74,0.0,0.0,-0.74,-0.74,-0.44,-0.95,-0.09,-1.05,0.09,-1.05,0.44,-0.95],true],["p",[0.74,0.74,0.44,0.95,0.09,1.05,-0.09,1.05,-0.44,0.95,-0.74,0.74,0.0,0.0],true,"fill"],["p",[0.74,0.74,0.44,0.95,0.09,1.05,-0.09,1.05,-0.44,0.95,-0.74,0.74,0.0,0.0],true],["p",[0.74,-0.74,0.97,-0.4,1.05,0.0,0.97,0.4,0.74,0.74],false],["p",[-0.74,0.74,-0.97,0.4,-1.05,0.0,-0.97,-0.4,-0.74,-0.74],false]] },
  muziekbox: { naam: "Muziekbox (inbouw plafond / wand)", laag: "elektro", bron: "dwg", d: [["t",-0.68,-0.68,"B",1.41,"l"],["c",0.0,0.0,1.3,0]] },
  rookmelder: { naam: "Rookmelder", laag: "elektro", bron: "dwg", d: [["t",-0.68,-0.68,"R",1.41,"l"],["c",0.0,0.0,1.3,0]] },
  gas:                { naam: "Gastoevoer", laag: "hvac", d: [["c", 0, 0, 1.5, 0], ["t", 0, -0.6, "G", 1.6, "c"]] },
  wifi_versterker: { naam: "Wifi-versterker", laag: "elektro", bron: "dwg", d: [["c",0.0,0.0,1.5,0],["p",[0.1,0.0,0.09,0.05,0.02,0.1,-0.05,0.09,-0.1,0.02,-0.09,-0.05,-0.02,-0.1,0.05,-0.09],true,"fill"],["c",0.0,0.0,0.1,0],["p",[0.9,0.0,0.87,0.23,0.81,0.4,0.73,0.53,0.54,0.72,0.41,0.54,0.52,0.44,0.61,0.3,0.68,0.08,0.68,-0.08,0.57,-0.37,0.41,-0.54,0.54,-0.72,0.67,-0.6,0.81,-0.4,0.87,-0.23],true,"fill"],["p",[-0.9,0.0,-0.87,-0.23,-0.81,-0.4,-0.73,-0.53,-0.54,-0.72,-0.41,-0.54,-0.52,-0.44,-0.61,-0.3,-0.68,-0.08,-0.68,0.08,-0.57,0.37,-0.41,0.54,-0.54,0.72,-0.67,0.6,-0.81,0.4,-0.87,0.23],true,"fill"],["p",[-0.18,0.24,-0.3,0.4,-0.47,0.18,-0.49,0.09,-0.47,-0.18,-0.3,-0.4,-0.18,-0.24,-0.18,0.24,-0.28,0.11,-0.3,0.0,-0.28,-0.11,-0.18,-0.24],true,"fill"],["p",[-0.18,0.24,-0.3,0.4,-0.47,0.18,-0.49,0.09,-0.47,-0.18,-0.3,-0.4,-0.18,-0.24,-0.28,-0.11,-0.3,0.0,-0.28,0.11],true],["p",[0.18,-0.24,0.3,-0.4,0.47,-0.18,0.49,-0.09,0.47,0.18,0.3,0.4,0.18,0.24,0.18,-0.24,0.28,-0.11,0.3,0.0,0.28,0.11,0.18,0.24],true,"fill"],["p",[0.18,-0.24,0.3,-0.4,0.47,-0.18,0.49,-0.09,0.47,0.18,0.3,0.4,0.18,0.24,0.28,0.11,0.3,0.0,0.28,-0.11],true],["p",[1.3,0.0,1.26,0.34,1.13,0.65,0.93,0.91,0.78,1.04,0.65,0.86,0.83,0.69,1.02,0.37,1.07,0.12,1.07,-0.12,0.97,-0.48,0.83,-0.69,0.65,-0.86,0.78,-1.04,0.93,-0.91,1.09,-0.71,1.26,-0.34],true,"fill"],["p",[-1.3,0.0,-1.26,-0.34,-1.13,-0.65,-0.93,-0.91,-0.78,-1.04,-0.65,-0.86,-0.83,-0.69,-1.02,-0.37,-1.07,-0.12,-1.07,0.12,-0.97,0.48,-0.83,0.69,-0.65,0.86,-0.78,1.04,-0.93,0.91,-1.09,0.71,-1.26,0.34],true,"fill"],["p",[-0.5,-1.3,0.5,-1.3,0.09,-0.24,-0.09,-0.24],true]] },
  wifi_ap: { naam: "Wifi-access point", laag: "elektro", bron: "dwg", d: [["p",[0.1,0.13,0.09,0.18,0.02,0.23,-0.05,0.22,-0.1,0.15,-0.09,0.08,-0.02,0.03,0.05,0.04],true,"fill"],["c",0.0,0.13,0.1,0],["p",[0.9,0.13,0.87,0.36,0.81,0.53,0.73,0.66,0.54,0.85,0.41,0.67,0.52,0.57,0.61,0.43,0.68,0.21,0.68,0.05,0.57,-0.24,0.41,-0.41,0.54,-0.59,0.67,-0.47,0.81,-0.27,0.87,-0.1],true,"fill"],["p",[-0.9,0.13,-0.87,-0.1,-0.81,-0.27,-0.73,-0.4,-0.54,-0.59,-0.41,-0.41,-0.52,-0.31,-0.61,-0.17,-0.68,0.05,-0.68,0.21,-0.57,0.5,-0.41,0.67,-0.54,0.85,-0.67,0.73,-0.81,0.53,-0.87,0.36],true,"fill"],["p",[-0.18,0.37,-0.3,0.53,-0.47,0.31,-0.49,0.22,-0.47,-0.05,-0.3,-0.27,-0.18,-0.11,-0.18,0.37,-0.28,0.24,-0.3,0.13,-0.28,0.02,-0.18,-0.11],true,"fill"],["p",[-0.18,0.37,-0.3,0.53,-0.47,0.31,-0.49,0.22,-0.47,-0.05,-0.3,-0.27,-0.18,-0.11,-0.28,0.02,-0.3,0.13,-0.28,0.24],true],["p",[0.18,-0.11,0.3,-0.27,0.47,-0.05,0.49,0.04,0.47,0.31,0.3,0.53,0.18,0.37,0.18,-0.11,0.28,0.02,0.3,0.13,0.28,0.24,0.18,0.37],true,"fill"],["p",[0.18,-0.11,0.3,-0.27,0.47,-0.05,0.49,0.04,0.47,0.31,0.3,0.53,0.18,0.37,0.28,0.24,0.3,0.13,0.28,0.02],true],["p",[1.3,0.13,1.26,0.47,1.17,0.7,0.93,1.04,0.78,1.17,0.65,0.99,0.83,0.82,1.02,0.5,1.07,0.25,1.07,0.0,0.97,-0.35,0.83,-0.56,0.65,-0.73,0.78,-0.91,0.93,-0.78,1.09,-0.58,1.26,-0.21],true,"fill"],["p",[-1.3,0.13,-1.26,-0.21,-1.13,-0.52,-0.93,-0.78,-0.78,-0.91,-0.65,-0.73,-0.83,-0.56,-1.02,-0.24,-1.07,0.0,-1.07,0.25,-0.97,0.61,-0.83,0.82,-0.65,0.99,-0.78,1.17,-0.93,1.04,-1.09,0.84,-1.26,0.47],true,"fill"],["p",[-0.5,-1.17,0.5,-1.17,0.09,-0.11,-0.09,-0.11],true]] },
  alarmdetector: { naam: "Alarmdetector", laag: "elektro", bron: "dwg", d: [["p",[0.85,1.48,1.58,2.17,2.27,1.44,1.54,0.75],false],["p",[0.85,1.48,0.74,1.33,0.7,1.15,0.72,0.97,0.8,0.81,0.94,0.69,1.11,0.62,1.39,0.65,1.54,0.75],false],["l",0.58,0.53,0.21,0.18],["l",0.95,0.3,0.81,-0.18],["l",0.37,0.92,-0.12,0.8],["t",-1.42,-1.61,"AL",1.01,"l"],["l",-1.04,-1.0,-1.65,-1.58],["l",-2.27,-2.17,-1.32,-1.94],["l",-2.27,-2.17,-1.99,-1.23],["l",-1.99,-1.23,-1.32,-1.94]] },
  alarmcontact: { naam: "Alarmcontact (raam / deur)", laag: "elektro", bron: "dwg", d: [["p",[-1.2,1.2,1.2,1.2,1.2,-1.2,-1.2,-1.2],true,"fill","grijs"],["t",-0.75,-0.37,"AL",0.85,"l"]] },
  camera: { naam: "Camera", laag: "elektro", bron: "dwg", d: [["p",[0.85,1.48,1.58,2.17,2.27,1.44,1.54,0.75],false],["p",[0.85,1.48,0.74,1.33,0.7,1.15,0.72,0.97,0.8,0.81,0.94,0.69,1.11,0.62,1.39,0.65,1.54,0.75],false],["l",0.58,0.53,0.21,0.18],["l",0.95,0.3,0.81,-0.18],["l",0.37,0.92,-0.12,0.8],["t",-1.72,-1.83,"CAM",0.81,"l"],["l",-1.04,-1.0,-1.65,-1.58],["l",-2.27,-2.17,-1.32,-1.94],["l",-2.27,-2.17,-1.99,-1.23],["l",-1.99,-1.23,-1.32,-1.94]] },
  bewegingssensor: { naam: "Bewegingssensor", laag: "elektro", bron: "dwg", d: [["p",[-0.68,-0.5,-0.5,-0.47,-0.34,-0.37,-0.23,-0.22,-0.18,-0.05,-0.23,0.22,-0.34,0.37,-0.5,0.47,-0.68,0.5],false],["l",0.18,-0.0,0.68,-0.0],["l",0.06,-0.43,0.49,-0.68],["l",0.06,0.43,0.49,0.68]] },
  thermostaat: { naam: "Thermostaat", laag: "elektro", wand: true, bron: "dwg", d: [["l",-0.0,0.0,2.25,0.0],["c",2.42,0.0,0.17,0],["t",5.21,-0.7,"°T",1.51,"r"]] },
  parlofoon: { naam: "Parlofoon / videofoon", laag: "elektro", wand: true, bron: "dwg", d: [["l",-0.0,0.0,2.25,0.0],["c",2.42,0.0,0.17,0],["t",4.02,-0.62,"P",1.51,"r"]] },
  alarmbediening: { naam: "Alarmbediening", laag: "elektro", wand: true, bron: "dwg", d: [["l",-0.0,0.0,2.25,0.0],["c",2.42,0.0,0.17,0],["t",4.16,-0.77,"A",1.51,"r"]] },
  deurbel: { naam: "Deurbel", laag: "elektro", wand: true, bron: "dwg", d: [["l",-0.0,0.0,2.25,0.0],["c",2.42,0.0,0.17,0],["t",4.16,-0.77,"B",1.51,"r"]] },
  aircobediening: { naam: "Aircobediening", laag: "elektro", wand: true, bron: "dwg", d: [["l",-0.0,0.0,2.25,0.0],["c",2.42,0.0,0.17,0],["t",2.89,-0.5,"AIRCO",1.01,"l"]] },
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
    const t = o[0]; const n0 = t === "p" ? (o[3] === "fill" ? 4 : 3) : SYM_BASIS[t]; const last = o.length > n0 ? o[o.length - 1] : null;
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
