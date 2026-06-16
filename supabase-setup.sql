-- ════════════════════════════════════════════════════════════
-- FSV Belegungsplan – Datenbank-Setup für Supabase
-- ════════════════════════════════════════════════════════════
-- Anleitung: Diesen gesamten Code in den Supabase SQL-Editor
-- kopieren und auf "Run" klicken.
-- ════════════════════════════════════════════════════════════

-- Tabelle: Plätze
create table pitches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

-- Tabelle: Teams
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null,
  created_at timestamptz default now()
);

-- Tabelle: Buchungen (inkl. Serientermine)
create table bookings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  pitch text not null,
  team_id uuid references teams(id) on delete cascade,
  start_h int not null,
  end_h int not null,
  note text,
  recur_type text default 'none',
  recur_until date,
  exceptions text[] default '{}',
  created_at timestamptz default now()
);

-- ── Standard-Plätze einfügen ──────────────────────────────────
insert into pitches (name, sort_order) values
  ('Rasenplatz', 1),
  ('Hartplatz', 2),
  ('Bolzplatz', 3),
  ('Nebenplatz Kinzig', 4),
  ('Sportheim', 5);

-- ── Standard-Teams einfügen ───────────────────────────────────
insert into teams (name, color) values
  ('FSV Herren', '#2563eb'),
  ('FSV Minis', '#06b6d4'),
  ('Miners Herren', '#16a34a'),
  ('Miners Cheerleader', '#db2777'),
  ('FSV Alte Herren', '#92400e');

-- ── Sicherheitseinstellungen (Row Level Security) ─────────────
-- Damit jeder mit dem Link lesen UND schreiben kann (kein Login nötig)
alter table pitches enable row level security;
alter table teams enable row level security;
alter table bookings enable row level security;

create policy "Öffentlicher Lesezugriff Plätze" on pitches for select using (true);
create policy "Öffentlicher Schreibzugriff Plätze" on pitches for insert with check (true);
create policy "Öffentlicher Update-Zugriff Plätze" on pitches for update using (true);
create policy "Öffentlicher Löschzugriff Plätze" on pitches for delete using (true);

create policy "Öffentlicher Lesezugriff Teams" on teams for select using (true);
create policy "Öffentlicher Schreibzugriff Teams" on teams for insert with check (true);
create policy "Öffentlicher Update-Zugriff Teams" on teams for update using (true);
create policy "Öffentlicher Löschzugriff Teams" on teams for delete using (true);

create policy "Öffentlicher Lesezugriff Buchungen" on bookings for select using (true);
create policy "Öffentlicher Schreibzugriff Buchungen" on bookings for insert with check (true);
create policy "Öffentlicher Update-Zugriff Buchungen" on bookings for update using (true);
create policy "Öffentlicher Löschzugriff Buchungen" on bookings for delete using (true);

-- ── Echtzeit-Updates aktivieren ────────────────────────────────
-- Damit alle Nutzer Änderungen sofort sehen, ohne neu zu laden
alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table pitches;
alter publication supabase_realtime add table teams;
