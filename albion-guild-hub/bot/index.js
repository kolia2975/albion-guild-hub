// -----------------------------------------------------------------------
// Discord-бот Albion Guild Hub.
//  - Слеш-команди: /status, /laborers, /factionwar, /ping
//  - Фоновий поллінг раз на 60с: забирає нові нотифікації з бекенду
//    (голод робітників, таймери фракційки/ресурсів) і постить їх у канал.
// -----------------------------------------------------------------------
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');

const {
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  DISCORD_NOTIFY_CHANNEL_ID,
  DISCORD_WEBHOOK_URL,
  APP_INTERNAL_URL,
  BOT_INTERNAL_API_KEY,
} = process.env;

if (!DISCORD_BOT_TOKEN) {
  console.error('[bot] DISCORD_BOT_TOKEN не вказано в .env — бот не може стартувати.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function api(path) {
  return `${APP_INTERNAL_URL}${path}`;
}

async function apiGet(path) {
  const res = await fetch(api(path), { headers: { 'X-Internal-Key': BOT_INTERNAL_API_KEY } });
  if (!res.ok) throw new Error(`API GET ${path} -> ${res.status}`);
  return res.json();
}

async function apiPost(path) {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'X-Internal-Key': BOT_INTERNAL_API_KEY },
  });
  if (!res.ok) throw new Error(`API POST ${path} -> ${res.status}`);
  return res.json();
}

// ---------- Слеш-команди ----------

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Перевірити, чи бот живий'),
  new SlashCommandBuilder().setName('status').setDescription('Загальний стан гільдії (скарбниця, острови, робітники)'),
  new SlashCommandBuilder().setName('laborers').setDescription('Список голодних робітників (особисті + гільдійський острів)'),
  new SlashCommandBuilder().setName('factionwar').setDescription('Найближчі таймери фракційної війни'),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID) // миттєво з'являються в 1 гільдії — зручно для розробки
    : Routes.applicationCommands(DISCORD_CLIENT_ID); // глобально (до ~1 год на оновлення)
  await rest.put(route, { body: commands });
  console.log('[bot] Слеш-команди зареєстровано.');
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'ping') {
      await interaction.reply('🏓 Понг! Бот на зв\'язку.');
      return;
    }

    if (interaction.commandName === 'status') {
      await interaction.deferReply();
      const s = await apiGet('/api/bot/summary');
      const embed = new EmbedBuilder()
        .setTitle('📊 Стан гільдії — Albion Guild Hub')
        .setColor(0xf59e0b)
        .addFields(
          { name: '💰 Баланс скарбниці', value: `${s.treasuryBalance.toLocaleString('uk-UA')} срібла`, inline: true },
          { name: '🏝️ Особистих островів', value: String(s.islandsCount), inline: true },
          { name: '🍽️ Голодних робітників', value: String(s.hungryLaborersCount), inline: true },
          {
            name: '🏰 Гільдійський острів',
            value: s.guildIsland ? `${s.guildIsland.name} (${s.guildIsland.city}, T${s.guildIsland.tier})` : 'ще не зареєстровано',
          },
          { name: '🔔 Непрочитаних нотифікацій', value: String(s.pendingNotificationsCount), inline: true }
        )
        .setTimestamp(new Date());
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === 'laborers') {
      await interaction.deferReply();
      const list = await apiGet('/api/bot/laborers-hungry');
      if (list.length === 0) {
        await interaction.editReply('✅ Усі робітники нагодовані, голодних немає.');
        return;
      }
      const lines = list
        .slice(0, 20)
        .map((l) => `• **${l.building_type}** (${l.target_item}) — острів "${l.island_name}", власник: ${l.owner}`);
      await interaction.editReply(`🍽️ Голодні робітники (${list.length}):\n${lines.join('\n')}`);
      return;
    }

    if (interaction.commandName === 'factionwar') {
      await interaction.deferReply();
      const timers = await apiGet('/api/bot/faction-timers');
      if (timers.length === 0) {
        await interaction.editReply('Немає активних таймерів фракційної війни.');
        return;
      }
      const lines = timers.map(
        (t) => `• **${t.zone_name}**${t.tier ? ` (T${t.tier})` : ''} — статус: ${t.flag_status}, до <t:${Math.floor(new Date(t.timer_ends_at).getTime() / 1000)}:R>`
      );
      await interaction.editReply(`⚔️ Таймери фракційки:\n${lines.join('\n')}`);
      return;
    }
  } catch (err) {
    console.error('[bot] Помилка обробки команди:', err);
    const msg = '❌ Сталася помилка при зверненні до бекенду. Перевір, чи піднятий контейнер app.';
    if (interaction.deferred) await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
});

// ---------- Фонова доставка нотифікацій ----------

function severityColor(severity) {
  if (severity === 'critical') return 0xef4444;
  if (severity === 'warning') return 0xf59e0b;
  return 0x38bdf8;
}

async function deliverPendingNotifications() {
  try {
    const pending = await apiGet('/api/bot/pending-notifications');
    if (pending.length === 0) return;

    const channel = DISCORD_NOTIFY_CHANNEL_ID ? await client.channels.fetch(DISCORD_NOTIFY_CHANNEL_ID) : null;

    for (const n of pending) {
      const embed = new EmbedBuilder()
        .setTitle(n.title)
        .setDescription(n.message)
        .setColor(severityColor(n.severity))
        .setFooter({ text: n.type })
        .setTimestamp(new Date(n.created_at));

      if (channel) {
        await channel.send({ embeds: [embed] });
      } else if (DISCORD_WEBHOOK_URL) {
        await fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed.toJSON()] }),
        });
      } else {
        console.warn('[bot] Немає ні DISCORD_NOTIFY_CHANNEL_ID, ні DISCORD_WEBHOOK_URL — нотифікацію не доставлено.');
      }

      await apiPost(`/api/bot/notifications/${n.id}/ack`);
    }
  } catch (err) {
    console.error('[bot] Помилка доставки нотифікацій:', err);
  }
}

client.once('ready', async () => {
  console.log(`[bot] Увійшов як ${client.user.tag}`);
  await registerCommands();
  setInterval(deliverPendingNotifications, 60_000);
  deliverPendingNotifications();
});

client.login(DISCORD_BOT_TOKEN);
