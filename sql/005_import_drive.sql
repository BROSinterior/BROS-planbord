-- =====================================================================
--  BROS Planbord — databasescript 005: projecten importeren uit de
--  Drive-map BROS/PROJECTEN (48 klantmappen, stand 14/09/2026).
--  Bestaande projecten met dezelfde klantnaam worden overgeslagen.
--  Mag opnieuw uitgevoerd worden.
-- =====================================================================
with import(klant, drive_map, klanttype) as (values
  ('Appelmans Jo', 'Appelmans Jo', 'particulier'),
  ('Appelmans Praktijk', 'Appelmans Praktijk', 'zakelijk'),
  ('Beckand Clothilde', 'Beckand Clothilde', 'particulier'),
  ('Chantor Mansi', 'Chantor Mansi', 'particulier'),
  ('Christiaens Van Goethem', 'Christiaens  Van Goethem', 'particulier'),
  ('Claes Marc', 'Claes Marc', 'particulier'),
  ('Costers Bakx', 'Costers  Bakx', 'particulier'),
  ('De Lathouwer', 'De Lathouwer', 'particulier'),
  ('De Spiegeleer Doevenspeck', 'De Spiegeleer  Doevenspeck', 'particulier'),
  ('De Zutter Peter', 'De Zutter Peter', 'particulier'),
  ('Debster Overdracht', 'Debster Overdracht', 'particulier'),
  ('Destrycker Lynn', 'Destrycker Lynn', 'particulier'),
  ('Dewachter Matthijs', 'Dewachter Matthijs', 'particulier'),
  ('Everaert Dominique', 'Everaert Dominique', 'particulier'),
  ('Genbrugge', 'Genbrugge', 'particulier'),
  ('Geyssens Caecilia 1', 'Geyssens Caecilia 1', 'particulier'),
  ('Ghys Leyder', 'Ghys Leyder', 'particulier'),
  ('Goossens Veronique', 'Goossens Veronique', 'particulier'),
  ('Hens Didier', 'Hens Didier', 'particulier'),
  ('Jerjir Naïm', 'Jerjir Naïm', 'particulier'),
  ('Kempenaers Van Praet', 'Kempenaers  Van Praet', 'particulier'),
  ('Kennes BArt', 'Kennes BArt', 'particulier'),
  ('Las Manas 1', 'Las Manas 1', 'particulier'),
  ('Malines Group 2026', 'Malines Group 2026', 'zakelijk'),
  ('Meert Uitbreiding BK', 'Meert  Uitbreiding BK', 'particulier'),
  ('Meeuwsse Bjorn', 'Meeuwsse Bjorn', 'particulier'),
  ('Michielsens Jan', 'Michielsens Jan', 'particulier'),
  ('Nelis Yorachim', 'Nelis Yorachim', 'particulier'),
  ('Op De Beeck Leien', 'Op De Beeck Leien', 'particulier'),
  ('Peter Gent', 'Peter Gent', 'particulier'),
  ('Philippron Anouck', 'Philippron Anouck', 'particulier'),
  ('Preckler Hannes', 'Preckler Hannes', 'particulier'),
  ('Roosendaal Mathieu 2', 'Roosendaal Mathieu 2', 'particulier'),
  ('Schepens Björn', 'Schepens Björn', 'particulier'),
  ('Sene Jules', 'Sene Jules', 'particulier'),
  ('Stals Laenen Peter', 'Stals Laenen Peter', 'particulier'),
  ('Steiger 3 tussenkast', 'Steiger 3 tussenkast', 'particulier'),
  ('Stinnet Rono', 'Stinnet Rono', 'particulier'),
  ('Taeymans De Keersmaecker', 'Taeymans De Keersmaecker', 'particulier'),
  ('Thibau Hans', 'Thibau Hans', 'particulier'),
  ('Valiante Diego', 'Valiante Diego', 'particulier'),
  ('Van Assche', 'Van Assche', 'particulier'),
  ('Van Den Bosch Karine', 'Van Den Bosch Karine', 'particulier'),
  ('Van Gerven Peter', 'Van Gerven Peter', 'particulier'),
  ('Van Quickelberghe - Keppens', 'Van Quickelberghe - Keppens', 'particulier'),
  ('Vertriest', 'Vertriest', 'particulier'),
  ('Willekens Gothar', 'Willekens Gothar', 'particulier'),
  ('ZAAF BV', 'ZAAF BV', 'zakelijk')
)
insert into public.projecten (klant, naam, klanttype, status, fase_nr, lead, created_by, drive_map, notities)
select i.klant, '', i.klanttype, 'lopend', null,
       (select id from public.profiles where role = 'beheer' order by created_at limit 1),
       (select id from public.profiles where role = 'beheer' order by created_at limit 1),
       'PROJECTEN/' || i.drive_map,
       'Geïmporteerd uit Drive op 14/09/2026 — status, fase en gegevens nog aan te vullen.'
from import i
where not exists (
  select 1 from public.projecten p
  where regexp_replace(lower(p.klant), '[^a-z0-9]', '', 'g') = regexp_replace(lower(i.klant), '[^a-z0-9]', '', 'g')
);

-- Controle
select count(*) as projecten_totaal from public.projecten;
select nummer, klant, klanttype, status from public.projecten order by klant;
