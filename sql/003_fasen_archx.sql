-- =====================================================================
--  BROS Planbord — databasescript 003: fasen en standaardtaken vervangen
--  door de lijst "Fases Archx" (14 fasen, 44 standaardtaken).
--  Bestaande projecten en taken blijven staan; alleen de sjabloonlijst wijzigt.
--  Mag opnieuw uitgevoerd worden.
-- =====================================================================

-- 1. Fasen: hernoemen op nummer (nr 14 is nieuw)
insert into public.fasen (nr, naam) values
  (1,'Offerte'),
  (2,'Ondertekenen contract'),
  (3,'Opmeting'),
  (4,'Ontwerpfase'),
  (5,'Bespreking voorontwerp'),
  (6,'Definitief ontwerp'),
  (7,'Ruwbouw'),
  (8,'Buitenschrijnwerk'),
  (9,'Technieken'),
  (10,'Bezetting'),
  (11,'Vloeren'),
  (12,'Opmeting maatwerk'),
  (13,'Installatie maatwerk'),
  (14,'Afwerking')
on conflict (nr) do update set naam = excluded.naam, actief = true;

-- 2. Standaardtaken: volledig vervangen
delete from public.standaardtaken;
insert into public.standaardtaken (fase_nr, volgorde, titel) values
  (1,1,'Ontdekkingsgesprek'),
  (1,2,'Opmaken offerte'),
  (1,3,'Opvolging offerte'),
  (2,1,'Contract opstellen'),
  (2,2,'Afspraak ter ondertekening'),
  (3,1,'Afspraak voor opmeting inplannen'),
  (3,2,'Opmeten en model in VWX uitzetten'),
  (4,1,'Grondplan'),
  (4,2,'Functies'),
  (4,3,'Organigram'),
  (4,4,'Organigram omzetten in indeling op grondplan'),
  (4,5,'Materialisatie en toetsen aan functies'),
  (4,6,'Omzetten naar ontwerp'),
  (5,1,'Afspraak bespreking inplannen'),
  (5,2,'Moodboard maken'),
  (5,3,'Indeling uitwerken'),
  (5,4,'3D-model tekenen'),
  (5,5,'Renders en presentatie maken'),
  (6,1,'Plannen technieken maken'),
  (6,2,'Plannen maatwerk maken'),
  (6,3,'Meetstaat maken'),
  (6,4,'Offertes opvragen'),
  (6,5,'Planning opstellen'),
  (6,6,'Afspraak met klant en alles definitief vastleggen'),
  (7,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (7,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (8,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (8,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (9,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (9,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (10,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (10,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (11,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (11,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (12,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (12,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (12,3,'Opmeting bijwonen'),
  (12,4,'Afspreken met klant om aangepaste plannen te bespreken'),
  (13,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (13,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (13,3,'Controlemomenten inplannen'),
  (14,1,'Wekelijkse werfvergadering inplannen en bijwonen'),
  (14,2,'Werfverslag opstellen en planning/budget opvolgen'),
  (14,3,'Oplevering doen');

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '3'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 14 en 44 teruggeven
select (select count(*) from public.fasen) as fasen, (select count(*) from public.standaardtaken) as standaardtaken;
