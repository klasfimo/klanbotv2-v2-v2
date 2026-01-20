import 'dotenv/config';
import { initDb, seedTestUser } from './database/db';
import { startServer } from './api/server';
import { startBot } from './bot/bot';

async function main() {
    console.log('Starting Minecraft Clan Watch System...');

    // 1. Initialize Database
    initDb();
    seedTestUser();

    // 2. Start API Server
    const PORT = parseInt(process.env.PORT || process.env.API_PORT || '3000', 10);
    startServer(PORT);

    // 3. Start Discord Bot
    const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
    if (!DISCORD_TOKEN) {
        console.error('CRITICAL: DISCORD_TOKEN is missing in .env file.');
        // We continue running API but Bot won't work
    } else {
        startBot(DISCORD_TOKEN, PORT);
    }
}

main().catch(err => {
    console.error('Fatal Error:', err);
});
