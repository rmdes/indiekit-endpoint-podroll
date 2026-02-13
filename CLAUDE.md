# CLAUDE.md - indiekit-endpoint-podroll

## Package Overview

`@rmdes/indiekit-endpoint-podroll` is a podcast aggregation plugin for Indiekit. It syncs podcast episodes from a FreshRSS instance (via its Google Reader API), caches them in MongoDB, and provides public JSON APIs for displaying a podcast roll page with episode listings and OPML sidebar on your site's frontend.

**Package Name:** `@rmdes/indiekit-endpoint-podroll`
**Version:** 1.0.9
**Type:** ESM module
**Entry Point:** `index.js`

## Core Purpose

This plugin is a **backend-only data aggregator**. It does NOT provide a frontend UI - it only provides JSON APIs that your site's frontend (Eleventy, etc.) can consume to render a podcast roll page.

Think of it as the data layer for a "blogroll, but for podcasts".

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    BACKGROUND SYNC                           │
├──────────────────────────────────────────────────────────────┤
│ setInterval (15 min default)                                 │
│   ↓                                                           │
│ fetchEpisodes(FreshRSS API) → transform → MongoDB            │
│   ↓                                                           │
│ fetchOpmlSources(FreshRSS OPML) → parse → MongoDB            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    PUBLIC JSON APIs                          │
├──────────────────────────────────────────────────────────────┤
│ GET /podrollapi/api/episodes → JSON list                     │
│ GET /podrollapi/api/episodes/:id → Single episode JSON       │
│ GET /podrollapi/api/sources → OPML parsed as JSON            │
│ GET /podrollapi/api/status → Sync health and counts          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    ADMIN UI (protected)                      │
├──────────────────────────────────────────────────────────────┤
│ GET /podrollapi/ → Dashboard (stats, manual sync)            │
│ POST /podrollapi/sync → Trigger sync now                     │
│ POST /podrollapi/clear-resync → Clear and re-sync            │
│ POST /podrollapi/settings → Save FreshRSS URLs               │
└──────────────────────────────────────────────────────────────┘
```

### Frontend Integration Pattern

Your Eleventy site (or other frontend) fetches the JSON APIs client-side and renders the podcast roll:

```javascript
// In your frontend JavaScript
const response = await fetch('/podrollapi/api/episodes?limit=20');
const { items, hasMore } = await response.json();

// Render episodes
items.forEach(episode => {
  const audio = document.createElement('audio');
  audio.src = episode.enclosure.url;
  // ... render episode card
});

// Fetch sidebar
const sourcesResponse = await fetch('/podrollapi/api/sources');
const { items: sources, categories } = await sourcesResponse.json();
// ... render OPML sidebar
```

## MongoDB Collections

### `podrollEpisodes`

Stores podcast episodes from FreshRSS.

```javascript
{
  _id: ObjectId,
  id: "tag:google.com,2005:reader/item/...", // FreshRSS ID (unique)
  guid: "https://podcast.example/ep123",      // Episode GUID
  title: "Episode 42: The Answer",
  url: "https://podcast.example/ep123",       // Episode page URL
  published: "2026-02-13T12:00:00.000Z",      // ISO string
  content: "<p>Episode description HTML</p>",
  author: "Author Name",
  enclosure: {
    url: "https://cdn.example/ep42.mp3",      // Audio file URL
    type: "audio/mpeg",
    length: 45678901                           // Bytes
  },
  origin: {
    streamId: "feed/123",
    title: "The Example Podcast",
    htmlUrl: "https://podcast.example",
    feedUrl: "https://podcast.example/feed.xml"
  },
  categories: ["Technology", "Science"],
  fetchedAt: "2026-02-13T14:30:00.000Z"
}
```

**Key Fields:**
- `id`: FreshRSS unique ID (used for deduplication)
- `enclosure.url`: The actual audio file - THIS IS WHAT AUDIO PLAYERS NEED
- `origin`: Metadata about the podcast source

**Indexes:**
- `{ id: 1 }` - Unique index for deduplication
- `{ published: -1 }` - Sort by date for API queries

### `podrollSources`

Stores podcast feeds from FreshRSS OPML export (for sidebar).

```javascript
{
  _id: ObjectId,
  title: "The Example Podcast",
  xmlUrl: "https://podcast.example/feed.xml",
  htmlUrl: "https://podcast.example",
  type: "rss",
  category: "Technology",                     // From OPML category
  order: 0,                                   // Original OPML order
  fetchedAt: "2026-02-13T14:30:00.000Z"
}
```

**Purpose:** Render a sidebar of subscribed podcasts (like a blogroll). Category grouping is optional.

**Replacement Strategy:** This collection is **cleared and re-populated** on every sync (unlike episodes which are upserted).

**Indexes:**
- `{ category: 1, order: 1 }` - Group and sort by category

### `podrollMeta`

Stores sync metadata and user settings.

```javascript
// Sync metadata (auto-created by sync process)
{
  _id: ObjectId,
  key: "lastEpisodesSync",
  timestamp: "2026-02-13T14:30:00.000Z",
  episodeCount: 200,
  inserted: 15,
  updated: 3
}

{
  _id: ObjectId,
  key: "lastSourcesSync",
  timestamp: "2026-02-13T14:30:00.000Z",
  sourceCount: 70
}

// User settings (saved from admin UI)
{
  _id: ObjectId,
  key: "settings",
  episodesUrl: "https://freshrss.example/api/query.php?user=USER&t=TOKEN&f=greader",
  opmlUrl: "https://freshrss.example/api/query.php?user=USER&t=TOKEN&f=opml",
  updatedAt: "2026-02-13T14:00:00.000Z"
}
```

**Settings Override:** If `settings` document exists, its URLs override the plugin config (env vars). This allows changing FreshRSS URLs via admin UI without restarting Indiekit.

## Key Files and Modules

### Core Entry Point

**`index.js`**
- Exports `PodrollEndpoint` class
- Defines protected routes (admin dashboard, settings, sync)
- Defines public routes (JSON APIs)
- Initializes MongoDB collections
- Starts background sync on `init()`
- Stores config and database getter in `application` for controller access

### Controllers

**`lib/controllers/dashboard.js`**
- `get()` - Render admin dashboard with stats and config form
- `saveSettings()` - Save FreshRSS URLs to `podrollMeta.settings`
- `sync()` - Trigger manual sync now (redirects back to dashboard)
- `clearResync()` - Delete all episodes/sources, then sync (preserves settings)
- `status()` - Public API for sync health and counts

**Settings Override Pattern:**
```javascript
// Settings from DB override env var config
const settings = await db.collection("podrollMeta").findOne({ key: "settings" });
const effectiveUrls = {
  episodesUrl: settings?.episodesUrl || config.episodesUrl,
  opmlUrl: settings?.opmlUrl || config.opmlUrl,
};
```

**`lib/controllers/episodes.js`**
- `list()` - GET /api/episodes - Paginated episode list
  - Query params: `limit` (max 200), `offset`, `source` (filter by podcast title)
  - Returns: `{ items, total, limit, offset, hasMore }`
- `get()` - GET /api/episodes/:id - Single episode by FreshRSS ID

**`lib/controllers/sources.js`**
- `list()` - GET /api/sources - List podcast sources from OPML
  - Query params: `category` (filter by category)
  - Returns: `{ items, total, categories }`

### Sync Logic

**`lib/sync.js`**

Core sync functions and background scheduler.

**`runSync(db, options)`**
- Runs both `syncEpisodes()` and `syncSources()` in parallel
- Returns combined results with timestamp

**`syncEpisodes(db, options)`**
1. Fetch episodes from FreshRSS greader API
2. Transform FreshRSS format to plugin schema
3. Upsert episodes (by `id` field)
4. Update `podrollMeta.lastEpisodesSync` with stats
5. Return `{ success, total, inserted, updated }`

**`syncSources(db, options)`**
1. Fetch OPML XML from FreshRSS
2. Parse XML with `xml2js`
3. Extract `<outline>` elements (handles nested categories)
4. **Delete all existing sources** (`deleteMany({})`)
5. Insert fresh sources with `order` field (preserves OPML order)
6. Update `podrollMeta.lastSourcesSync`
7. Return `{ success, total }`

**`startSync(Indiekit, options)`**
- Starts background sync:
  - Initial sync after 5 seconds
  - Periodic sync every `syncInterval` (default 15 minutes)
- Uses `getEffectiveSyncOptions()` to prefer DB settings over env vars

### Data Transformation

**`transformEpisode(item)`**

Converts FreshRSS greader API format to plugin schema:

```javascript
// Input: FreshRSS item
{
  "frss:id": "tag:google.com,2005:reader/item/...",
  "title": "Episode Title",
  "published": 1707826800,               // Unix timestamp
  "enclosure": [{
    "href": "https://cdn.example/ep.mp3",
    "type": "audio/mpeg",
    "length": "45678901"
  }],
  "origin": {
    "streamId": "feed/123",
    "title": "Podcast Name",
    "htmlUrl": "https://podcast.example",
    "feedUrl": "https://feed.example/rss"
  },
  // ... more fields
}

// Output: Plugin schema
{
  id: "tag:google.com,2005:reader/item/...",
  title: "Episode Title",
  published: "2026-02-13T12:00:00.000Z",  // ISO string
  enclosure: {
    url: "https://cdn.example/ep.mp3",     // Decoded HTML entities
    type: "audio/mpeg",
    length: 45678901                       // Parsed as int
  },
  origin: { ... },
  fetchedAt: "2026-02-13T14:30:00.000Z"
}
```

**`decodeHtmlEntities(str)`**

FreshRSS returns XML-encoded URLs (e.g., `&amp;` → `&`). This function decodes them so audio URLs work correctly.

### OPML Parsing

**`fetchOpmlSources(url, timeout)`**

Parses FreshRSS OPML export:

```xml
<opml version="2.0">
  <body>
    <outline text="Technology" title="Technology">
      <outline text="Podcast A" xmlUrl="https://a.example/feed" htmlUrl="https://a.example" type="rss"/>
      <outline text="Podcast B" xmlUrl="https://b.example/feed" htmlUrl="https://b.example" type="rss"/>
    </outline>
    <outline text="Uncategorized Feed" xmlUrl="https://c.example/feed" type="rss"/>
  </body>
</opml>
```

Extracts:
- Top-level `<outline>` with children → category + feeds
- Top-level `<outline>` with `xmlUrl` → uncategorized feed

Returns array of sources with `category` field.

## Configuration

```javascript
import PodrollEndpoint from "@rmdes/indiekit-endpoint-podroll";

export default {
  plugins: [
    new PodrollEndpoint({
      episodesUrl: "https://freshrss.example/api/query.php?user=USER&t=TOKEN&f=greader",
      opmlUrl: "https://freshrss.example/api/query.php?user=USER&t=TOKEN&f=opml",
      syncInterval: 900000,   // 15 minutes (default)
      maxEpisodes: 200,       // Max episodes to cache (default 200)
      fetchCount: 200,        // Items to request from FreshRSS (default 200)
      fetchTimeout: 15000,    // Fetch timeout in ms (default 15s)
      mountPath: "/podrollapi", // Default
    }),
  ],
};
```

### FreshRSS API URLs

**Episodes URL** (greader API):
```
https://YOUR-FRESHRSS/api/query.php?user=USERNAME&t=TOKEN&f=greader
```

**OPML URL**:
```
https://YOUR-FRESHRSS/api/query.php?user=USERNAME&t=TOKEN&f=opml
```

Get your token from FreshRSS: **Settings → API Management → Create new token**

### Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `episodesUrl` | (required) | FreshRSS greader API URL with auth |
| `opmlUrl` | "" | FreshRSS OPML export URL (optional) |
| `syncInterval` | 900000 | Sync interval in ms (15 min) |
| `maxEpisodes` | 200 | Max episodes to store |
| `fetchCount` | 200 | Items to request from FreshRSS (nb parameter) |
| `fetchTimeout` | 15000 | HTTP fetch timeout (ms) |
| `mountPath` | "/podrollapi" | Base path for all routes |

**Note:** FreshRSS's default `nb` parameter is 20, which misses most episodes. The plugin appends `nb=fetchCount` to the URL to request more items.

## Routes

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/podrollapi/api/episodes` | List episodes (paginated) |
| GET | `/podrollapi/api/episodes/:id` | Single episode by ID |
| GET | `/podrollapi/api/sources` | List podcast sources (OPML) |
| GET | `/podrollapi/api/status` | Sync health and counts |

### Protected (require auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/podrollapi/` | Admin dashboard |
| POST | `/podrollapi/settings` | Save FreshRSS URLs |
| POST | `/podrollapi/sync` | Trigger manual sync |
| POST | `/podrollapi/clear-resync` | Clear all data and re-sync |

## API Response Schemas

### Episodes List

```json
{
  "items": [
    {
      "id": "tag:google.com,2005:reader/item/abc123",
      "title": "Episode 42: The Answer",
      "url": "https://podcast.example/ep42",
      "published": "2026-02-13T12:00:00.000Z",
      "content": "<p>Episode description HTML</p>",
      "author": "Author Name",
      "enclosure": {
        "url": "https://cdn.example/ep42.mp3",
        "type": "audio/mpeg",
        "length": 45678901
      },
      "podcast": {
        "title": "The Example Podcast",
        "url": "https://podcast.example",
        "feedUrl": "https://podcast.example/feed.xml"
      }
    }
  ],
  "total": 200,
  "limit": 50,
  "offset": 0,
  "hasMore": true
}
```

### Single Episode

Same as list item, plus `categories` array:

```json
{
  "id": "...",
  "title": "...",
  "categories": ["Technology", "Science"],
  // ... other fields
}
```

### Sources List

```json
{
  "items": [
    {
      "title": "The Example Podcast",
      "xmlUrl": "https://podcast.example/feed.xml",
      "htmlUrl": "https://podcast.example",
      "category": "Technology"
    }
  ],
  "total": 70,
  "categories": ["Technology", "Culture", "Politics"]
}
```

### Status

```json
{
  "status": "ok",
  "episodes": {
    "count": 200,
    "lastSync": "2026-02-13T14:30:00.000Z"
  },
  "sources": {
    "count": 70,
    "lastSync": "2026-02-13T14:30:00.000Z"
  }
}
```

## Frontend Integration Examples

### Vanilla JavaScript

```javascript
// Fetch episodes
async function loadEpisodes() {
  const response = await fetch('/podrollapi/api/episodes?limit=20');
  const { items, hasMore } = await response.json();

  items.forEach(episode => {
    console.log(episode.title);
    console.log(episode.enclosure.url); // Audio file URL
  });
}

// Fetch sources for sidebar
async function loadSources() {
  const response = await fetch('/podrollapi/api/sources');
  const { items, categories } = await response.json();

  // Group by category
  const grouped = {};
  items.forEach(source => {
    const cat = source.category || 'Uncategorized';
    grouped[cat] = grouped[cat] || [];
    grouped[cat].push(source);
  });
}
```

### Eleventy (11ty) Data File

```javascript
// _data/podroll.js
module.exports = async function() {
  const response = await fetch('https://your-site.example/podrollapi/api/episodes?limit=50');
  const data = await response.json();
  return data;
};
```

```njk
{# podroll.njk #}
{% for episode in podroll.items %}
  <article class="episode">
    <h2>{{ episode.title }}</h2>
    <p>{{ episode.content | striptags | truncate(200) }}</p>
    <audio controls src="{{ episode.enclosure.url }}"></audio>
    <small>from {{ episode.podcast.title }}</small>
  </article>
{% endfor %}
```

## Admin Dashboard

The protected admin UI (`/podrollapi/`) shows:

- **Stats**: Episode count, source count, last sync times
- **Settings Form**: Edit FreshRSS URLs (overrides env vars)
- **Manual Sync Button**: Trigger sync immediately
- **Clear & Re-Sync Button**: Delete all data and sync fresh

**Settings Persistence:** URLs saved via the dashboard are stored in `podrollMeta.settings` and override the env var config. This allows changing URLs without restarting the server.

**Flash Messages:** The dashboard uses Indiekit's native notification banner for success/error messages after sync operations.

## Known Gotchas

### Date Handling

**Rule:** All dates are stored and returned as ISO 8601 strings.

```javascript
// CORRECT
published: new Date(timestamp).toISOString()

// WRONG (causes Nunjucks | date filter to crash)
published: new Date(timestamp)
```

Dashboard templates use `{% if lastSync %}{{ lastSync | date("PPp") }}{% endif %}` which requires ISO strings.

### FreshRSS Item Count

FreshRSS's greader API defaults to returning only 20 items. The plugin appends `nb=fetchCount` to the URL to request more. Default `fetchCount` is 200.

If you have more than 200 subscribed podcasts with recent episodes, increase `fetchCount`:

```javascript
new PodrollEndpoint({
  fetchCount: 500,
  maxEpisodes: 500,
})
```

### OPML Replacement Strategy

Unlike episodes (which are upserted), sources are **replaced entirely** on every sync:
1. `deleteMany({})` - Clear all sources
2. `insertMany(sources)` - Insert fresh sources

This ensures the sidebar always matches your current FreshRSS subscriptions, but means any manual edits to the `podrollSources` collection will be lost.

### HTML Entity Encoding

FreshRSS returns XML-encoded URLs (e.g., `https://example.com?foo=bar&amp;baz=qux`). The plugin decodes these with `decodeHtmlEntities()` so audio players can fetch the files correctly.

### Sync Timing

- **Initial sync**: 5 seconds after server start
- **Periodic sync**: Every `syncInterval` (default 15 minutes)
- **Manual sync**: Via dashboard or POST to `/sync`

Sync runs in background - it does NOT block server startup.

### Episode Deduplication

Episodes are deduplicated by FreshRSS's `frss:id` field (stored as `id` in plugin schema). If FreshRSS changes an episode's ID, it will be added as a new episode.

### Max Episodes Limit

Only the first `maxEpisodes` items from FreshRSS are stored (after fetching `fetchCount` items). Sorted by published date descending.

```javascript
const episodes = rawEpisodes
  .map(transformEpisode)
  .slice(0, maxEpisodes);
```

If you need older episodes, increase both `fetchCount` and `maxEpisodes`.

## Common Issues

**Q: Episodes not syncing?**
- Check FreshRSS API URL is correct and includes auth token
- Check Indiekit logs for `[Podroll] Fetching episodes...`
- Verify FreshRSS has podcasts subscribed (not just RSS blogs)
- Try "Clear & Re-Sync" from dashboard

**Q: Audio files not playing?**
- Check `enclosure.url` in JSON response - is it a valid audio file?
- Test URL directly in browser
- Check if URL has HTML entities (should be decoded automatically)

**Q: Sources list is empty?**
- OPML sync is optional - check `opmlUrl` is configured
- FreshRSS OPML export must be public or include auth token

**Q: Old episodes disappearing?**
- Check `maxEpisodes` config - default is 200
- Increase if you need more history

**Q: Sync not running?**
- Background sync requires `episodesUrl` to be configured
- Check logs for `[Podroll] Background sync started`
- Database must be available (MongoDB)

**Q: Dashboard settings not saving?**
- Check MongoDB connection
- Check browser console for errors
- Settings are stored in `podrollMeta.settings`

## Integration with Eleventy Theme

The Eleventy theme (`indiekit-eleventy-theme`) has a `/podroll` page that fetches these JSON APIs client-side and renders:
- Episode cards with audio players
- OPML sidebar with category grouping
- Pagination controls

See the theme's `podroll.njk` and `assets/scripts/podroll.js` for reference implementation.

## Dependencies

**Core:**
- `express` - Routing
- `xml2js` - OPML parsing
- `sanitize-html` - XSS prevention in episode content

**Indiekit:**
- `@indiekit/error` - Error handling

**Peer:**
- `@indiekit/indiekit` >= 1.0.0-beta.25

## Testing and Debugging

**Check sync status:**
```bash
curl https://your-site.example/podrollapi/api/status
```

**Force sync:**
```bash
curl -X POST https://your-site.example/podrollapi/sync \
  -H "Cookie: session=YOUR_SESSION"
```

**Inspect MongoDB:**
```javascript
db.podrollEpisodes.find().sort({ published: -1 }).limit(5)
db.podrollSources.find()
db.podrollMeta.find()
```

**Check FreshRSS API:**
```bash
# Test greader API
curl "https://freshrss.example/api/query.php?user=USER&t=TOKEN&f=greader&nb=10"

# Test OPML export
curl "https://freshrss.example/api/query.php?user=USER&t=TOKEN&f=opml"
```

## Future Improvements

- Episode search API (full-text search on titles/content)
- Filter by date range
- Per-podcast episode lists (filter by `origin.title`)
- Mark-played state (requires user accounts)
- Audio player embed codes
- RSS feed output (convert back to RSS for compatibility)
- Alternative sources (direct podcast feeds without FreshRSS)
- Pagination with cursor-based paging (currently offset-based)
