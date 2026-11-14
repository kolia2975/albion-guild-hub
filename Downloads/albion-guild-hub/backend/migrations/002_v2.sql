-- Non-destructive migration. Legacy island/CTA/timer tables remain archived.
ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;
ALTER TABLE refining_calculations ADD COLUMN snapshot JSONB;
ALTER TABLE arbitrage_calculations ADD COLUMN snapshot JSONB;
ALTER TABLE gear_set_items ADD COLUMN item_label TEXT;
CREATE TABLE content_tabs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,subtype TEXT NOT NULL DEFAULT '',UNIQUE(name,subtype));
ALTER TABLE gear_sets ADD COLUMN tab_id UUID REFERENCES content_tabs(id) ON DELETE RESTRICT;
INSERT INTO content_tabs(name) SELECT DISTINCT content_type FROM gear_sets;
UPDATE gear_sets s SET tab_id=t.id FROM content_tabs t WHERE t.name=s.content_type;
CREATE TABLE hub_islands(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),kind TEXT NOT NULL CHECK(kind IN ('personal','guild')),owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,city TEXT NOT NULL,level INT NOT NULL CHECK(level BETWEEN 1 AND 6),
 layout_override JSONB, legacy_id UUID UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((kind='personal' AND owner_user_id IS NOT NULL) OR kind='guild'));
CREATE INDEX hub_personal_city ON hub_islands(owner_user_id,city);
CREATE TABLE hub_plots(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),island_id UUID NOT NULL REFERENCES hub_islands(id) ON DELETE CASCADE,
 plot_type TEXT NOT NULL CHECK(plot_type IN ('large','building','small_building')),plot_index INT NOT NULL CHECK(plot_index BETWEEN 1 AND 16),
 building_code TEXT,building_tier INT CHECK(building_tier BETWEEN 2 AND 8),usage_fee NUMERIC NOT NULL DEFAULT 0 CHECK(usage_fee>=0),
 food_item TEXT,food_target INT NOT NULL DEFAULT 0 CHECK(food_target>=0), last_food_at TIMESTAMPTZ, UNIQUE(island_id,plot_type,plot_index));
CREATE TABLE hub_laborers(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),island_id UUID NOT NULL REFERENCES hub_islands(id) ON DELETE CASCADE,
 plot_id UUID REFERENCES hub_plots(id) ON DELETE CASCADE,name TEXT NOT NULL DEFAULT '',laborer_type TEXT NOT NULL,tier INT NOT NULL CHECK(tier BETWEEN 2 AND 8),
 journal_tier INT NOT NULL CHECK(journal_tier BETWEEN 2 AND 8),last_journal_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(journal_tier<=tier));
CREATE TABLE hub_inventory(island_id UUID REFERENCES hub_islands(id) ON DELETE CASCADE,item TEXT NOT NULL,quantity BIGINT NOT NULL CHECK(quantity>=0),PRIMARY KEY(island_id,item));
INSERT INTO hub_islands(id,kind,owner_user_id,name,city,level,legacy_id)
 SELECT id,'personal',owner_user_id,name,city,tier,id FROM islands WHERE owner_user_id IS NOT NULL;
INSERT INTO hub_islands(id,kind,name,city,level,legacy_id)
 SELECT id,'guild',name,city,tier,id FROM guild_islands WHERE tier>=1;
-- Preserve every legacy guild plot and building, including old overestimated
-- layouts. The admin must reconcile them against the actual in-game island.
INSERT INTO hub_plots(id,island_id,plot_type,plot_index,building_code,building_tier,usage_fee)
 SELECT p.id,p.guild_island_id,p.plot_type::text,p.plot_index,p.building_code,p.building_tier,GREATEST(0,p.usage_fee_silver)
 FROM guild_island_plots p JOIN hub_islands i ON i.id=p.guild_island_id;
UPDATE hub_islands i SET layout_override=(
 SELECT jsonb_build_object('large',GREATEST(1,COALESCE(MAX(p.plot_index) FILTER(WHERE p.plot_type='large'),0)),
 'building',COALESCE(MAX(p.plot_index) FILTER(WHERE p.plot_type='building'),0),
 'small_building',COALESCE(MAX(p.plot_index) FILTER(WHERE p.plot_type='small_building'),0))
 FROM hub_plots p WHERE p.island_id=i.id)
 WHERE i.kind='guild' AND EXISTS(SELECT 1 FROM hub_plots p WHERE p.island_id=i.id);
INSERT INTO hub_inventory SELECT island_id,item_unique_name,GREATEST(0,FLOOR(quantity)) FROM island_inventory WHERE island_id IN (SELECT id FROM hub_islands);
-- Legacy laborers require explicit profession and plot assignment in the UI;
-- no guessing from free-form text and no invented active journal timer.
INSERT INTO hub_laborers(id,island_id,name,laborer_type,tier,journal_tier)
 SELECT id,island_id,COALESCE(laborer_name,building_type),'UNASSIGNED',building_tier,building_tier FROM laborer_buildings WHERE island_id IN (SELECT id FROM hub_islands);
INSERT INTO hub_laborers(id,island_id,name,laborer_type,tier,journal_tier)
 SELECT id,guild_island_id,building_type,'UNASSIGNED',building_tier,building_tier FROM guild_island_laborers WHERE guild_island_id IN (SELECT id FROM hub_islands);
CREATE TABLE announcements(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),title TEXT NOT NULL,meeting_place TEXT NOT NULL,assembly_at TIMESTAMPTZ NOT NULL,
 completed_at TIMESTAMPTZ,created_by UUID REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK(type IN ('laborer_hunger','guild_laborer_hunger','faction_timer','resource_timer','system','announcement','journal'));
ALTER TABLE notifications ADD COLUMN target_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN event_key TEXT UNIQUE;
CREATE TABLE notification_reads(notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,user_id UUID REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(notification_id,user_id));
-- Keep old read state for existing members only, future reads are per-user.
INSERT INTO notification_reads SELECT n.id,u.id FROM notifications n CROSS JOIN users u WHERE n.is_read;
UPDATE crafting_lines SET label='Палки' WHERE code='QUARTERSTAVES';
-- Historical specialization data retained but hidden/disabled in the API.
UPDATE guild_treasury_ledger SET entry_type='expense',amount_silver=ABS(amount_silver) WHERE amount_silver<0;
CREATE INDEX hub_laborer_plot ON hub_laborers(plot_id);
CREATE INDEX announcement_schedule ON announcements(assembly_at) WHERE completed_at IS NULL;
