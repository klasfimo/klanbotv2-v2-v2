# Minecraft Clan Watch Bot

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```
   *Note: If you encounter errors with `better-sqlite3`, ensure you have Python and Visual Studio Build Tools installed, or run `npm install --global --production windows-build-tools`.*

2. **Configuration**
   - `.env.example` dosyasını `.env` olarak kopyalayın.
   - `DISCORD_TOKEN` değerini Discord Developer Portal’dan alın.
   - `API_PORT` (varsayılan 3000) Render’da otomatik atanır; lokal geliştirmede değiştirebilirsiniz.
   - Render’da uyku modunu engellemek için servis ayarlarında “Keep Alive” URL’sini `RENDER_EXTERNAL_URL` olarak ortama ekleyin. Bu değer API sunucusunu 14 dakikada bir ping’leyen mekanizma tarafından kullanılır.

3. **Running**
   - Development: `npm run dev`
   - Production: `npm run build` then `npm start`

## API Usage (for Mod Developers)

### Heartbeat
`POST /api/heartbeat`
Header: `X-API-Key: <YOUR_API_KEY>`
Body: `{ "username": "PlayerName" }`
Response: `{ "scanRequested": boolean }`

### TabList
`POST /api/tablist`
Header: `X-API-Key: <YOUR_API_KEY>`
Body: `{ "players": ["Player1", "Player2"] }`

## Features
- Discord Bot command `!setup` creates the interface.
- "Listele" button triggers a distributed scan and beklerken `scanReady` durumuna göre otomatik sonuç döner.
- "Üye Ekle" allows tracking specific players.
- BetterAPI Fabric mod’u yalnızca hedef sunucuda iken heartbeat gönderir ve hata durumlarında exponential backoff uygular.
