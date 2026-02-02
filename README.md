# @rmdes/indiekit-endpoint-podroll

Podcast roll endpoint for Indiekit. Aggregates podcast episodes from a FreshRSS instance and provides JSON APIs for displaying a podroll page with episode listings and OPML sidebar.

## Features

- Syncs podcast episodes from FreshRSS greader API
- Syncs podcast sources from OPML export
- Caches data in MongoDB for fast API responses
- Background sync at configurable intervals
- Public JSON APIs for frontend consumption
- Admin dashboard for manual sync and status

## Installation

```bash
npm install @rmdes/indiekit-endpoint-podroll
```

## Configuration

Add to your Indiekit config:

```javascript
import PodrollEndpoint from "@rmdes/indiekit-endpoint-podroll";

export default {
  plugins: [
    new PodrollEndpoint({
      episodesUrl: "https://your-freshrss.example/api/query.php?user=USER&t=TOKEN&f=greader",
      opmlUrl: "https://your-freshrss.example/api/query.php?user=USER&t=TOKEN&f=opml",
      syncInterval: 900000, // 15 minutes (default)
      maxEpisodes: 100,     // Maximum episodes to cache (default)
    }),
  ],
};
```

## API Endpoints

### Public (no auth required)

| Endpoint | Description |
|----------|-------------|
| `GET /podrollapi/api/episodes` | List episodes. Params: `limit`, `offset`, `source` |
| `GET /podrollapi/api/episodes/:id` | Get single episode |
| `GET /podrollapi/api/sources` | List podcast sources from OPML. Params: `category` |
| `GET /podrollapi/api/status` | Sync status and counts |

### Protected (requires auth)

| Endpoint | Description |
|----------|-------------|
| `GET /podrollapi/` | Admin dashboard |
| `POST /podrollapi/sync` | Trigger manual sync |
| `POST /podrollapi/clear-resync` | Clear cache and re-sync |

## Episode Response Schema

```json
{
  "items": [
    {
      "id": "unique-episode-id",
      "title": "Episode Title",
      "url": "https://podcast.example/episode",
      "published": "2026-01-31T12:00:00.000Z",
      "content": "<p>Episode description HTML</p>",
      "author": "Author Name",
      "enclosure": {
        "url": "https://cdn.example/episode.mp3",
        "type": "audio/mpeg",
        "length": 12345678
      },
      "podcast": {
        "title": "Podcast Name",
        "url": "https://podcast.example",
        "feedUrl": "https://podcast.example/feed.xml"
      }
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0,
  "hasMore": true
}
```

## Sources Response Schema

```json
{
  "items": [
    {
      "title": "Podcast Name",
      "xmlUrl": "https://podcast.example/feed.xml",
      "htmlUrl": "https://podcast.example",
      "category": "Technology"
    }
  ],
  "total": 70,
  "categories": ["Technology", "Culture", "Politics"]
}
```

## Frontend Integration

The APIs are designed for client-side fetching. Example with vanilla JavaScript:

```javascript
// Fetch episodes
const response = await fetch('/podrollapi/api/episodes?limit=20');
const { items, hasMore } = await response.json();

// Fetch sources for sidebar
const sourcesResponse = await fetch('/podrollapi/api/sources');
const { items: sources } = await sourcesResponse.json();
```

## License

MIT
