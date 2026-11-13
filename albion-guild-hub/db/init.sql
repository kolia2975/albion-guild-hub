-- =====================================================================
--  ALBION GUILD HUB — повна схема бази даних
--  Виконується автоматично один раз при першому старті контейнера
--  Postgres (docker-entrypoint-initdb.d). Якщо треба перезастосувати
--  вручну: docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB < db/init.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- для gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. РОЛІ ТА КОРИСТУВАЧІ
-- ---------------------------------------------------------------------
-- Ієрархія ролей (доступи описані в backend/src/middleware/roles.js):
--   member      — гільд-юзер, базовий доступ (свої розрахунки, свій профіль)
--   economist   — економіст (переробка/крафт/арбітраж/фокус, повний read)
--   accountant  — обліковець (скарбниця гільдії, фінансові звіти)
--   roster      — "кістяк файтів" (білди/сети, склад на КТА, готовність)
--   moderator   — модератор (керування користувачами, контент, нотифікації)
--   admin       — адміністратор (повний доступ, налаштування бота, острови)
CREATE TYPE user_role AS ENUM (
  'member', 'economist', 'accountant', 'roster', 'moderator', 'admin'
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  in_game_nick    TEXT,
  discord_id      TEXT UNIQUE,
  role            user_role NOT NULL DEFAULT 'member',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  theme_pref      TEXT NOT NULL DEFAULT 'dark' CHECK (theme_pref IN ('dark','light')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. ПРОФІЛЬ ГРАВЦЯ ТА МАЙСТЕРКИ (CRAFTING SPECIALIZATIONS)
-- ---------------------------------------------------------------------
CREATE TABLE crafting_lines (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,          -- напр. 'PLATE_ARMOR', 'AXES', 'FIRE_STAFF'
  label       TEXT NOT NULL,                 -- людська назва
  category    TEXT NOT NULL                  -- 'weapon' | 'offhand' | 'armor' | 'accessory' | 'consumable' | 'tool'
);

CREATE TABLE player_crafting_specializations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crafting_line_id  INT NOT NULL REFERENCES crafting_lines(id) ON DELETE CASCADE,
  mastery_level     INT NOT NULL DEFAULT 0 CHECK (mastery_level BETWEEN 0 AND 100),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, crafting_line_id)
);

-- ---------------------------------------------------------------------
-- 3. ОСОБИСТІ ОСТРОВИ ТА РОБІТНИКИ (LABORERS)
-- ---------------------------------------------------------------------
CREATE TABLE islands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL,
  tier            INT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 6),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE laborer_buildings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  island_id         UUID NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  building_type     TEXT NOT NULL,           -- напр. 'Lumberjack Hut'
  building_tier     INT NOT NULL CHECK (building_tier BETWEEN 4 AND 8),
  laborer_name      TEXT,
  target_item       TEXT NOT NULL,           -- що виробляє (для журналів)
  happiness_current INT NOT NULL DEFAULT 1000 CHECK (happiness_current BETWEEN 0 AND 1000),
  happiness_max     INT NOT NULL DEFAULT 1000,
  last_fed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  feed_cycle_hours  INT NOT NULL DEFAULT 22, -- за замовчуванням 22 год. на цикл
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE island_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  island_id     UUID NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  item_unique_name TEXT NOT NULL,            -- напр. 'T5_MEAL_PIE', 'T5_JOURNAL_HERO'
  quantity      NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (island_id, item_unique_name)
);

-- ---------------------------------------------------------------------
-- 4. ГІЛЬДІЙСЬКИЙ ОСТРІВ (GUILD ISLAND)
-- ---------------------------------------------------------------------
-- Джерело механік: wiki.albiononline.com/wiki/Guild_Island,
-- altarofgaming.com, heaven-guardian.com (зведено на 2026 рік).
-- УВАГА: розробники Albion Online регулярно змінюють вартість/кількість
-- плотів у патчах — перевіряй ці цифри в грі раз на сезон і онови
-- guild_island_building_catalog вручну через адмінку, якщо щось зміниться.
CREATE TYPE plot_type AS ENUM ('large', 'building', 'small_building');
CREATE TYPE plot_status AS ENUM ('empty', 'under_construction', 'built');

CREATE TABLE guild_islands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL DEFAULT 'Гільдійський острів',
  city             TEXT NOT NULL,
  tier             INT NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 6), -- 0 = ще не куплений
  silver_invested  NUMERIC NOT NULL DEFAULT 0,
  purchased_at     TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Довідник будівель гільдійського острова (Economy / Crafting / Houses)
CREATE TABLE guild_island_building_catalog (
  code               TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  category           TEXT NOT NULL CHECK (category IN ('economy','crafting','house')),
  required_plot_type plot_type NOT NULL
);

CREATE TABLE guild_island_plots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_island_id   UUID NOT NULL REFERENCES guild_islands(id) ON DELETE CASCADE,
  plot_type         plot_type NOT NULL,
  plot_index        INT NOT NULL,
  building_code     TEXT REFERENCES guild_island_building_catalog(code),
  building_tier     INT CHECK (building_tier BETWEEN 4 AND 8),
  status            plot_status NOT NULL DEFAULT 'empty',
  usage_fee_silver  NUMERIC NOT NULL DEFAULT 0,
  managed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  built_at          TIMESTAMPTZ,
  UNIQUE (guild_island_id, plot_type, plot_index)
);

-- Робітники (лаборери), розміщені саме на гільдійському острові
CREATE TABLE guild_island_laborers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_island_id   UUID NOT NULL REFERENCES guild_islands(id) ON DELETE CASCADE,
  building_type     TEXT NOT NULL,
  building_tier     INT NOT NULL CHECK (building_tier BETWEEN 4 AND 8),
  target_item       TEXT NOT NULL,
  happiness_current INT NOT NULL DEFAULT 1000 CHECK (happiness_current BETWEEN 0 AND 1000),
  last_fed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  feed_cycle_hours  INT NOT NULL DEFAULT 22,
  fed_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Права доступу учасників гільдії до складу/плотів острова
CREATE TABLE guild_island_access (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_island_id  UUID NOT NULL REFERENCES guild_islands(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_build        BOOLEAN NOT NULL DEFAULT FALSE,
  can_use_storage  BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage_fees  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (guild_island_id, user_id)
);

-- ---------------------------------------------------------------------
-- 5. ПЕРЕРОБКА / КРАФТ / АРБІТРАЖ / ФОКУС — історія розрахунків
-- ---------------------------------------------------------------------
CREATE TABLE refining_calculations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES users(id) ON DELETE SET NULL,
  recipe_name            TEXT NOT NULL,
  city                   TEXT NOT NULL,
  resource_tier          INT NOT NULL,
  enchant                INT NOT NULL DEFAULT 0,
  return_rate_percent    NUMERIC NOT NULL,       -- RRF, напр. 15.2 / 36.7 / 43.5 / 53.9
  station_fee_silver     NUMERIC NOT NULL DEFAULT 0,
  inputs                 JSONB NOT NULL,
  outputs                JSONB NOT NULL,
  raw_cost_silver        NUMERIC NOT NULL,
  product_revenue_silver NUMERIC NOT NULL,
  market_tax_percent     NUMERIC NOT NULL DEFAULT 4,
  net_profit_silver      NUMERIC NOT NULL,
  profit_margin_percent  NUMERIC NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE arbitrage_calculations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  item_unique_name    TEXT NOT NULL,
  buy_city            TEXT NOT NULL,
  sell_city           TEXT NOT NULL,
  buy_price_silver    NUMERIC NOT NULL,
  sell_price_silver   NUMERIC NOT NULL,
  sell_tax_percent    NUMERIC NOT NULL DEFAULT 4,
  setup_fee_percent   NUMERIC NOT NULL DEFAULT 2.5,
  quantity            INT NOT NULL DEFAULT 1,
  net_profit_silver   NUMERIC NOT NULL,
  roi_percent         NUMERIC NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE focus_calculations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  activity_name       TEXT NOT NULL,
  focus_cost          INT NOT NULL,
  silver_output       NUMERIC NOT NULL,
  silver_per_focus    NUMERIC NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE market_price_cache (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_unique_name  TEXT NOT NULL,
  city              TEXT NOT NULL,
  quality           INT NOT NULL DEFAULT 1,
  sell_price_min    NUMERIC,
  buy_price_max     NUMERIC,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_unique_name, city, quality)
);

-- ---------------------------------------------------------------------
-- 6. СЕТИ / БІЛДИ ("кістяк файтів")
-- ---------------------------------------------------------------------
CREATE TYPE gear_slot AS ENUM (
  'weapon','offhand','helmet','armor','boots','cape','food','potion','mount'
);

CREATE TABLE gear_sets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  content_type     TEXT NOT NULL,             -- 'ZvZ' | 'Small Scale' | 'Crystal Arena' | 'Static' | ...
  description      TEXT,
  is_admin_curated BOOLEAN NOT NULL DEFAULT TRUE, -- true = вручну зібрав адмін
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gear_set_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gear_set_id  UUID NOT NULL REFERENCES gear_sets(id) ON DELETE CASCADE,
  slot         gear_slot NOT NULL,
  item_unique_name TEXT NOT NULL,
  tier         INT NOT NULL,
  enchant      INT NOT NULL DEFAULT 0,
  crafting_line_id INT REFERENCES crafting_lines(id), -- для авто-підбору за майстеркою
  quantity     INT NOT NULL DEFAULT 1                 -- для їжі/зіль (стаки)
);

-- Що гравець фактично має на складі/собі (self-report або синхронізація)
CREATE TABLE player_inventory (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_unique_name TEXT NOT NULL,
  tier             INT NOT NULL,
  enchant          INT NOT NULL DEFAULT 0,
  quantity         NUMERIC NOT NULL DEFAULT 0,
  location         TEXT NOT NULL DEFAULT 'guild_bank', -- 'guild_bank' | 'personal' | 'island'
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_unique_name, tier, enchant, location)
);

-- Кешований статус готовності гравця до конкретного сету
CREATE TABLE gear_readiness (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gear_set_id    UUID NOT NULL REFERENCES gear_sets(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('ready','partial','missing')),
  missing_items  JSONB NOT NULL DEFAULT '[]',
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gear_set_id, user_id)
);

-- ---------------------------------------------------------------------
-- 7. СКАРБНИЦЯ ГІЛЬДІЇ (для ролі "обліковець")
-- ---------------------------------------------------------------------
CREATE TABLE guild_treasury_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('income','expense','transfer')),
  category        TEXT NOT NULL,              -- 'regear' | 'island_upkeep' | 'donation' | 'market_sale' | ...
  amount_silver   NUMERIC NOT NULL,
  description     TEXT,
  related_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 8. ТАЙМЕРИ ТА НОТИФІКАЦІЇ
-- ---------------------------------------------------------------------
CREATE TABLE faction_warfare_timers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name      TEXT NOT NULL,
  tier           INT,
  flag_status    TEXT NOT NULL DEFAULT 'neutral', -- 'neutral' | 'contested' | 'captured'
  timer_ends_at  TIMESTAMPTZ NOT NULL,
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Таймери "перечарки"/відновлення ресурсних зон (статики, ресурсні руни тощо)
CREATE TABLE zone_resource_timers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name     TEXT NOT NULL,
  resource_type TEXT NOT NULL,     -- 'ore' | 'wood' | 'hide' | 'fiber' | 'rock' | 'relic'
  tier          INT,
  respawns_at   TIMESTAMPTZ NOT NULL,
  notes         TEXT,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                TEXT NOT NULL CHECK (type IN
                        ('laborer_hunger','guild_laborer_hunger','faction_timer','resource_timer','system')),
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  severity            TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  related_entity_id   UUID,
  target_role         user_role,               -- NULL = для всіх
  is_read             BOOLEAN NOT NULL DEFAULT FALSE,
  deliver_discord     BOOLEAN NOT NULL DEFAULT TRUE,
  delivered_discord_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE discord_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- ---------------------------------------------------------------------
-- 9. ІНДЕКСИ
-- ---------------------------------------------------------------------
CREATE INDEX idx_laborer_buildings_island ON laborer_buildings(island_id);
CREATE INDEX idx_guild_island_laborers_island ON guild_island_laborers(guild_island_id);
CREATE INDEX idx_notifications_unread ON notifications(is_read, created_at);
CREATE INDEX idx_player_inventory_user ON player_inventory(user_id);
CREATE INDEX idx_gear_set_items_set ON gear_set_items(gear_set_id);
CREATE INDEX idx_treasury_created_at ON guild_treasury_ledger(created_at);
CREATE INDEX idx_refining_user ON refining_calculations(user_id);
CREATE INDEX idx_arbitrage_user ON arbitrage_calculations(user_id);

-- ---------------------------------------------------------------------
-- 10. ПОЧАТКОВІ ДАНІ (SEED)
-- ---------------------------------------------------------------------

-- Довідник будівель гільдійського острова
INSERT INTO guild_island_building_catalog (code, label, category, required_plot_type) VALUES
  ('GUILD_HALL',      'Guild Hall',        'house',    'large'),
  ('HOUSE',           'House',             'house',    'building'),
  ('LUMBER_MILL',     'Lumber Mill',       'economy',  'building'),
  ('SMELTER',         'Smelter',           'economy',  'small_building'),
  ('TANNER',          'Tanner',            'economy',  'building'),
  ('WEAVER',          'Weaver',            'economy',  'building'),
  ('TOOLMAKER',       'Toolmaker',         'economy',  'building'),
  ('STONEMASON',      'Stonemason',        'economy',  'building'),
  ('REPAIR_STATION',  'Repair Station',    'economy',  'building'),
  ('ALCHEMY_LAB',     'Alchemist''s Lab',  'crafting', 'building'),
  ('COOK',            'Cook',              'crafting', 'building'),
  ('MILL',            'Mill',              'crafting', 'building'),
  ('BUTCHER',         'Butcher',           'crafting', 'small_building'),
  ('SADDLER',         'Saddler',           'crafting', 'building')
ON CONFLICT DO NOTHING;

-- Базовий набір ліній майстерок (доповнюй через адмінку за потреби)
INSERT INTO crafting_lines (code, label, category) VALUES
  ('SWORDS',        'Мечі',                'weapon'),
  ('AXES',          'Сокири',              'weapon'),
  ('MACES',         'Булави',              'weapon'),
  ('HAMMERS',       'Молоти',              'weapon'),
  ('SPEARS',        'Списи',               'weapon'),
  ('QUARTERSTAVES', 'Посохи (бойові)',     'weapon'),
  ('DAGGERS',       'Кинджали',            'weapon'),
  ('BOWS',          'Луки',                'weapon'),
  ('CROSSBOWS',     'Арбалети',            'weapon'),
  ('FIRE_STAFF',    'Вогняний посох',      'weapon'),
  ('FROST_STAFF',   'Крижаний посох',      'weapon'),
  ('ARCANE_STAFF',  'Арканний посох',      'weapon'),
  ('HOLY_STAFF',    'Святий посох',        'weapon'),
  ('NATURE_STAFF',  'Природній посох',     'weapon'),
  ('CURSED_STAFF',  'Прокляті посохи',     'weapon'),
  ('OFFHANDS',      'Офхенди',             'offhand'),
  ('PLATE_ARMOR',   'Латна броня',         'armor'),
  ('LEATHER_ARMOR', 'Шкіряна броня',       'armor'),
  ('CLOTH_ARMOR',   'Тканинна броня',      'armor'),
  ('CAPES',         'Плащі',               'accessory'),
  ('FOOD',          'Кухня (їжа)',         'consumable'),
  ('POTIONS',       'Зілля',               'consumable'),
  ('TOOLS',         'Інструменти',         'tool'),
  ('MOUNTS',        'Транспорт',           'tool')
ON CONFLICT DO NOTHING;
