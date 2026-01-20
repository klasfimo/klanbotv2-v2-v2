import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { addUser, updateUserLastSeen, getClanMembers, getActiveModUsers } from '../database/db';

const app = express();
app.use(express.json());

// In-memory state for scan
// Ideally, this should be in Redis if we scaled, but in-memory is fine for single instance.
let scanRequested = false;
let scanTimeout: NodeJS.Timeout | null = null;
let receivedPlayers = new Set<string>();
const registrationCooldown = new Map<string, number>();
let isScanLocked = false;
let targetUser: string | null = null;

type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>;

const getFetch = (() => {
    let cached: FetchLike | null = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
    return async (): Promise<FetchLike> => {
        if (cached) return cached;
        const { default: nodeFetch } = await import('node-fetch');
        cached = nodeFetch as unknown as FetchLike;
        return cached;
    };
})();

// 1. Heartbeat from Mod Client
app.post('/api/heartbeat', (req: Request, res: Response) => {
    // API Key authentication (case-insensitive)
    const apiKey = req.header('X-API-Key') || req.header('x-api-key');
    const { username } = req.body as { username?: string };

    // We allow string or undefined for username, though usually mod sends it.

    if (!apiKey) {
        console.warn('Heartbeat rejected: Missing API Key');
        res.status(401).json({ error: 'Missing API Key' });
        return;
    }

    // Update last seen in DB
    const updated = updateUserLastSeen(apiKey);

    if (!updated) {
        res.status(403).json({ error: 'Invalid API Key' });
        return;
    }

    // Check if this user is targeted for scan
    const isTargeted = scanRequested && (targetUser === null || targetUser === username);

    // Return scan status
    res.json({ scanRequested: isTargeted, isTargeted });
});

// 1.5. Auto-Register (New Feature)
app.post('/api/register', (req: Request, res: Response) => {
    const { username } = req.body as { username?: unknown };
    if (typeof username !== 'string' || username.length < 3 || username.length > 16) {
        res.status(400).json({ error: 'Valid username (3-16 chars) required' });
        return;
    }

    const requesterId = req.ip ?? 'unknown';
    const now = Date.now();
    const lastAttempt = registrationCooldown.get(requesterId) ?? 0;
    if (now - lastAttempt < 1000 * 10) { // 10s cooldown per IP
        res.status(429).json({ error: 'Too many registration attempts. Please wait.' });
        return;
    }
    registrationCooldown.set(requesterId, now);

    const newApiKey = uuidv4();
    addUser(username, newApiKey);

    console.log(`Auto-registered user: ${username} with key: ${newApiKey}`);
    res.json({ apiKey: newApiKey });
});


// 2. Tab List Data Receiver
app.post('/api/tablist', (req: Request, res: Response) => {
    const apiKey = req.header('X-API-Key') || req.header('x-api-key');
    if (!apiKey || !updateUserLastSeen(apiKey)) {
        console.warn('TabList rejected: Invalid API Key');
        res.status(403).json({ error: 'Unauthorized' });
        return;
    }

    const { players } = req.body; // expected string[]
    if (Array.isArray(players)) {
        console.log(`Received tablist data with ${players.length} players from user using key: ${apiKey}`);
        players.forEach((p: string) => receivedPlayers.add(p));
    } else {
        console.warn('Received invalid players data:', players);
    }

    res.json({ success: true });
});

// 3. Internal: Trigger Scan (from Bot)
// This endpoint is called by the local Discord Bot to start the scanning process
app.post('/api/scan-request', (req: Request, res: Response) => {
    const { targetUser: requestedUser } = req.body as { targetUser?: string | null };

    if (isScanLocked) {
        res.status(409).json({ error: 'Scan already in progress. Please wait.' });
        return;
    }
    isScanLocked = true;

    scanRequested = true;
    receivedPlayers.clear();
    targetUser = typeof requestedUser === 'string' && requestedUser.trim().length > 0 ? requestedUser : null;

    console.log(`Scan requested via API. Target: ${targetUser ?? 'ALL USERS'}`);

    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
        scanRequested = false;
        isScanLocked = false;
        targetUser = null;
        console.log('Scan window closed');
    }, 30000); // 30s scan window

    res.json({ success: true, message: 'Scan initiated', targetUser });
});

// 4. Internal: Get Results (from Bot)
app.get('/api/scan-results', (req: Request, res: Response) => {
    const peek = req.query.peek === '1' || req.query.peek === 'true';
    const allFound = Array.from(receivedPlayers);
    const clanMembers = getClanMembers();
    const activeMods = getActiveModUsers();

    // Normalize lists for case-insensitive comparison
    const allFoundLower = allFound.map(p => p.toLowerCase());

    // Intersection: which clan members are in the scanned list (case-insensitive)
    const onlineClanMembers = clanMembers.filter(member => {
        return allFoundLower.includes(member.toLowerCase());
    });

    console.log(`Scan Results - Scanned: ${allFound.length}, Watched: ${clanMembers.length}, Matched: ${onlineClanMembers.length}`);
    if (onlineClanMembers.length > 0) {
        console.log('Matched Members:', onlineClanMembers);
    }

    const scanReady = !scanRequested || allFound.length > 0;

    res.json({
        onlineClanMembers,
        activeModUsers: activeMods,
        totalScanned: allFound.length,
        scanReady
    });

    if (!peek && scanReady) {
        // reset state after delivering final results
        scanRequested = false;
        isScanLocked = false;
        receivedPlayers.clear();
        targetUser = null;
    }
});

// 5. Root Endpoint (for uptime checks)
app.get('/', (req: Request, res: Response) => {
    res.send('Minecraft Clan Bot API is running.');
});

// Keep-Alive Mechanism
const startKeepAlive = () => {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) {
        console.log('Skipping Keep-Alive: RENDER_EXTERNAL_URL not set.');
        return;
    }

    console.log(`Keep-Alive system started. Pinging ${url} every 14 minutes.`);
    
    const ping = async () => {
        try {
            const fetchImpl = await getFetch();
            const res = await fetchImpl(url);
            if (res.ok) console.log(`Keep-Alive Ping: Success (${res.status})`);
            else console.error(`Keep-Alive Ping: Failed (${res.status})`);
        } catch (err) {
            console.error('Keep-Alive Ping: Error', err);
        }
    };

    // Initial ping
    void ping();

    // Ping every 14 minutes (to be safe within 15 min window)
    setInterval(() => {
        void ping();
    }, 14 * 60 * 1000);
};

export const startServer = (port: number) => {
    app.listen(port, '0.0.0.0', () => {
        console.log(`API Server running on port ${port}`);
        startKeepAlive();
    });
};
