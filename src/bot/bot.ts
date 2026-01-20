import {
    Client,
    GatewayIntentBits,
    Events,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Message
} from 'discord.js';
import { addClanMember } from '../database/db';

let API_ROOT = 'http://localhost:3000/api'; // Updated dynamically in startBot

const POLL_INTERVAL_MS = 2000;
const SCAN_TIMEOUT_MS = 30000;

type ScanResults = {
    onlineClanMembers: string[];
    activeModUsers: string[];
    totalScanned: number;
    scanReady?: boolean;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchScanResults(peek: boolean): Promise<ScanResults> {
    const url = `${API_ROOT}/scan-results${peek ? '?peek=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Scan results request failed (${res.status})`);
    }
    return res.json();
}

async function pollUntilReady(): Promise<ScanResults> {
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const peekData = await fetchScanResults(true);
        if (peekData.scanReady) {
            return fetchScanResults(false);
        }
        await wait(POLL_INTERVAL_MS);
    }
    throw new Error('Scan timeout');
}

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once(Events.ClientReady, c => {
    console.log(`Bot Ready! Logged in as ${c.user.tag}`);
    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${c.user.id}&permissions=2147485696&scope=bot`;
    console.log(`Invite Link: ${inviteLink}`);
});

client.on(Events.MessageCreate, async (message) => {
    // Determine command prefix or just listening for specific message
    if (message.content === '!setup' && message.member?.permissions.has('Administrator')) {
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('listele_btn')
                    .setLabel('Listele (Scan)')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🔍'),
                new ButtonBuilder()
                    .setCustomId('add_member_btn')
                    .setLabel('Üye Ekle')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➕'),
            );

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🛡️ MaviBuğday Klan Takip Sistemi')
            .setDescription('Aşağıdaki butonları kullanarak klan üyelerini takip edebilir ve sistemi yönetebilirsiniz.')
            .addFields(
                { name: 'Nasıl Çalışır?', value: 'Listele butonuna bastığınızda, aktif mod kullanıcılarını seçebilir ve seçilen kullanıcı üzerinden tarama yapabilirsiniz.' }
            )
            .setFooter({ text: 'Powered by BetterAPI Mod' })
            .setTimestamp();

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete().catch(() => { }); // cleanup command
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isButton()) {
            if (interaction.customId === 'listele_btn') {
                await interaction.reply({ content: '📡 Tarama başlatıldı, sonuçlar bekleniyor...', ephemeral: true });

                try {
                    console.log('Scan requested by user:', interaction.user.tag);
                    const res = await fetch(`${API_ROOT}/scan-request`, { method: 'POST' });
                    if (!res.ok) {
                        throw new Error(`Scan request rejected (${res.status})`);
                    }
                } catch (e) {
                    console.error('API Error:', e);
                    await interaction.editReply('❌ Hata: Tarama isteği başlatılamadı. Lütfen daha sonra tekrar deneyin.');
                    return;
                }

                try {
                    const { onlineClanMembers, activeModUsers, totalScanned } = await pollUntilReady();

                    const resultEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('🎯 Tarama Sonuçları')
                        .addFields(
                            {
                                name: `Online Klan Üyeleri (${onlineClanMembers.length})`,
                                value: onlineClanMembers.length > 0 ? onlineClanMembers.join('\n') : '⚠️ Hiçbir üye bulunamadı.',
                                inline: false
                            },
                            {
                                name: `Aktif Mod Kullanıcıları (${activeModUsers.length})`,
                                value: activeModUsers.length > 0 ? activeModUsers.join(', ') : 'Yok',
                                inline: true
                            },
                            {
                                name: 'Toplam Oyuncu',
                                value: String(totalScanned),
                                inline: true
                            }
                        )
                        .setFooter({ text: `İstek yapan: ${interaction.user.tag}` })
                        .setTimestamp();

                    await interaction.editReply({ content: '✅ Tarama tamamlandı!', embeds: [resultEmbed] });
                } catch (e) {
                    console.error('Scan results error:', e);
                    await interaction.editReply('❌ Sonuçlar alınırken bir hata oluştu veya süre doldu.');
                }
            }

            if (interaction.customId === 'add_member_btn') {
                const modal = new ModalBuilder()
                    .setCustomId('add_member_modal')
                    .setTitle('İzleme Listesine Ekle');

                const nameInput = new TextInputBuilder()
                    .setCustomId('minecraftUsername')
                    .setLabel("Minecraft Kullanıcı Adı")
                    .setPlaceholder("Notch")
                    .setMinLength(3)
                    .setMaxLength(16)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const row = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
                modal.addComponents(row);

                await interaction.showModal(modal);
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'add_member_modal') {
                const username = interaction.fields.getTextInputValue('minecraftUsername');
                console.log(`Adding member attempt: ${username} by ${interaction.user.tag}`);

                try {
                    addClanMember(username, interaction.user.id);
                    await interaction.reply({ content: `✅ **${username}** başarıyla izleme listesine eklendi!`, ephemeral: true });
                } catch (err) {
                    console.error('DB Error:', err);
                    await interaction.reply({ content: `❌ Bir hata oluştu: ${err}`, ephemeral: true });
                }
            }
        }
    } catch (error) {
        console.error('Interaction error:', error);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '❌ Beklenmedik bir hata oluştu.', ephemeral: true });
        }
    }
});

export const startBot = (token: string, port: number) => {
    API_ROOT = `http://localhost:${port}/api`;
    console.log(`Bot connecting to internal API at: ${API_ROOT}`);
    client.login(token);
};
