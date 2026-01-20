import fs from 'fs';
import path from 'path';

const DB_FILE = path.resolve(__dirname, '../../database.json');

interface Database {
    users: User[];
    clanMembers: ClanMember[];
}

export interface User {
    id: number; //kept for compatibility, simulated
    discordId: string | null;
    minecraftUsername: string;
    apiKey: string;
    lastSeen: number;
}

export interface ClanMember {
    id: number;
    minecraftUsername: string;
    addedByDiscordId: string;
}

let dbCache: Database = {
    users: [],
    clanMembers: []
};
let isDbLoaded = false;

// Helper: load DB (idempotent)
function loadDb(force = false) {
    if (isDbLoaded && !force) {
        return;
    }
    try {
        if (!fs.existsSync(DB_FILE)) {
            saveDb(); // Create empty
        }
        const data = fs.readFileSync(DB_FILE, 'utf-8');
        dbCache = JSON.parse(data);
        isDbLoaded = true;
    } catch (e) {
        console.error('Failed to load database:', e);
        // Reset if corrupt
        dbCache = { users: [], clanMembers: [] };
        isDbLoaded = true;
    }
}

// Helper: save DB
function saveDb() {
    try {
        const tempFile = `${DB_FILE}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(dbCache, null, 2));
        fs.renameSync(tempFile, DB_FILE);
        isDbLoaded = true;
    } catch (e) {
        console.error('Failed to save database:', e);
    }
}

// Debounced save mechanism
let saveTimeout: NodeJS.Timeout | null = null;
function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveDb();
    }, 500); // Save after 500ms of inactivity
}

export function initDb() {
    loadDb(true);
    console.log('JSON Database initialized at ' + DB_FILE);
}

export function getClanMembers(): string[] {
    loadDb();
    return dbCache.clanMembers.map(m => m.minecraftUsername);
}

export function getUserByApiKey(apiKey: string): User | undefined {
    return dbCache.users.find(u => u.apiKey === apiKey);
}

export function addClanMember(username: string, addedBy: string) {
    // check exists
    if (dbCache.clanMembers.some(m => m.minecraftUsername.toLowerCase() === username.toLowerCase())) {
        return;
    }

    dbCache.clanMembers.push({
        id: Date.now(),
        minecraftUsername: username,
        addedByDiscordId: addedBy
    });
    loadDb(); // Reload to ensure consistency
    saveDb(); // Immediate save for important data
}

export function updateUserLastSeen(apiKey: string): boolean {
    const user = dbCache.users.find(u => u.apiKey === apiKey);
    if (user) {
        user.lastSeen = Date.now();
        debouncedSave(); // Use debounced save for frequent updates
        return true;
    }
    return false; // User not found (invalid API key)
}

export function getActiveModUsers(): string[] {
    // Use in-memory cache
    const threshold = Date.now() - 30000;
    return dbCache.users
        .filter(u => u.lastSeen > threshold)
        .map(u => u.minecraftUsername);
}

export function seedTestUser() {
    if (dbCache.users.length === 0) {
        const testKey = 'test-api-key';
        dbCache.users.push({
            id: 1,
            discordId: null,
            minecraftUsername: 'TestModUser',
            apiKey: testKey,
            lastSeen: Date.now()
        });
        saveDb();
        console.log(`Seeded test user with API Key: ${testKey}`);
    }
}

export function addUser(username: string, apiKey: string) {
    // Check if user already exists, if so update key
    const existing = dbCache.users.find(u => u.minecraftUsername.toLowerCase() === username.toLowerCase());
    if (existing) {
        existing.apiKey = apiKey;
        existing.lastSeen = Date.now();
    } else {
        dbCache.users.push({
            id: Date.now(),
            discordId: null,
            minecraftUsername: username,
            apiKey: apiKey,
            lastSeen: Date.now()
        });
    }
    loadDb(); // Reload to ensure consistency
    saveDb(); // Immediate save for user registration
}
