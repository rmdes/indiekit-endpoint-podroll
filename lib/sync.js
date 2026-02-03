import { parseString } from "xml2js";
import { promisify } from "node:util";

const parseXml = promisify(parseString);

/**
 * Fetch episodes from FreshRSS greader API
 * @param {string} url - FreshRSS API URL
 * @param {number} timeout - Fetch timeout in ms
 * @param {number} fetchCount - Number of items to request from FreshRSS
 * @returns {Promise<Array>} Array of episode objects
 */
async function fetchEpisodes(url, timeout, fetchCount) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Append nb parameter for FreshRSS to request more items
    // (default is 20 which misses most episodes)
    const separator = url.includes("?") ? "&" : "?";
    const fetchUrl = `${url}${separator}nb=${fetchCount}`;

    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Indiekit-Podroll/1.0",
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.items || [];
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Fetch OPML sources from FreshRSS
 * @param {string} url - OPML URL
 * @param {number} timeout - Fetch timeout in ms
 * @returns {Promise<Array>} Array of source objects
 */
async function fetchOpmlSources(url, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Indiekit-Podroll/1.0",
        Accept: "application/xml, text/xml",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();
    const result = await parseXml(xml, { explicitArray: false });

    // Extract outlines from OPML
    const sources = [];
    const body = result?.opml?.body;

    if (body?.outline) {
      const outlines = Array.isArray(body.outline) ? body.outline : [body.outline];

      for (const outline of outlines) {
        // Handle nested outlines (categories)
        if (outline.outline) {
          const children = Array.isArray(outline.outline) ? outline.outline : [outline.outline];
          for (const child of children) {
            if (child.$ && child.$.xmlUrl) {
              sources.push({
                title: child.$.text || child.$.title || "Unknown",
                xmlUrl: child.$.xmlUrl,
                htmlUrl: child.$.htmlUrl || "",
                type: child.$.type || "rss",
                category: outline.$.text || outline.$.title || "",
              });
            }
          }
        } else if (outline.$ && outline.$.xmlUrl) {
          // Direct feed outline
          sources.push({
            title: outline.$.text || outline.$.title || "Unknown",
            xmlUrl: outline.$.xmlUrl,
            htmlUrl: outline.$.htmlUrl || "",
            type: outline.$.type || "rss",
            category: "",
          });
        }
      }
    }

    return sources;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Decode HTML entities in URLs (FreshRSS returns XML-encoded URLs)
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Transform FreshRSS episode to our schema
 * @param {object} item - FreshRSS item
 * @returns {object} Transformed episode
 */
function transformEpisode(item) {
  // Extract enclosure (audio file)
  let enclosure = null;
  if (item.enclosure && item.enclosure.length > 0) {
    const enc = item.enclosure[0];
    enclosure = {
      url: decodeHtmlEntities(enc.href || enc.url),
      type: enc.type || "audio/mpeg",
      length: enc.length ? parseInt(enc.length, 10) : 0,
    };
  }

  // Extract origin (podcast source)
  let origin = null;
  if (item.origin) {
    origin = {
      streamId: item.origin.streamId || "",
      title: item.origin.title || "",
      htmlUrl: item.origin.htmlUrl || "",
      feedUrl: item.origin.feedUrl || "",
    };
  }

  // Get canonical URL
  let url = "";
  if (item.canonical && item.canonical.length > 0) {
    url = item.canonical[0].href || "";
  } else if (item.alternate && item.alternate.length > 0) {
    url = item.alternate[0].href || "";
  }

  return {
    id: item["frss:id"] || item.id || item.guid,
    guid: item.guid || item.id,
    title: item.title || "Untitled Episode",
    url: url,
    published: item.published ? new Date(item.published * 1000) : new Date(),
    content: item.content?.content || item.summary?.content || "",
    author: item.author || "",
    enclosure: enclosure,
    origin: origin,
    categories: item.categories || [],
    fetchedAt: new Date(),
  };
}

/**
 * Sync episodes from FreshRSS to MongoDB
 * @param {object} db - MongoDB database instance
 * @param {object} options - Sync options
 * @returns {Promise<object>} Sync result stats
 */
async function syncEpisodes(db, options) {
  const { episodesUrl, fetchTimeout, maxEpisodes, fetchCount } = options;

  if (!episodesUrl) {
    return { success: false, error: "No episodesUrl configured" };
  }

  try {
    console.log("[Podroll] Fetching episodes from FreshRSS...");
    const rawEpisodes = await fetchEpisodes(episodesUrl, fetchTimeout, fetchCount);
    console.log(`[Podroll] Fetched ${rawEpisodes.length} episodes`);

    const episodes = rawEpisodes
      .map(transformEpisode)
      .slice(0, maxEpisodes);

    const collection = db.collection("podrollEpisodes");

    // Upsert episodes
    let inserted = 0;
    let updated = 0;

    for (const episode of episodes) {
      const result = await collection.updateOne(
        { id: episode.id },
        { $set: episode },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        inserted++;
      } else if (result.modifiedCount > 0) {
        updated++;
      }
    }

    // Update sync metadata
    await db.collection("podrollMeta").updateOne(
      { key: "lastEpisodesSync" },
      {
        $set: {
          key: "lastEpisodesSync",
          timestamp: new Date(),
          episodeCount: episodes.length,
          inserted,
          updated,
        },
      },
      { upsert: true }
    );

    console.log(`[Podroll] Synced episodes: ${inserted} new, ${updated} updated`);

    return {
      success: true,
      total: episodes.length,
      inserted,
      updated,
    };
  } catch (error) {
    console.error("[Podroll] Episode sync failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sync OPML sources to MongoDB
 * @param {object} db - MongoDB database instance
 * @param {object} options - Sync options
 * @returns {Promise<object>} Sync result stats
 */
async function syncSources(db, options) {
  const { opmlUrl, fetchTimeout } = options;

  if (!opmlUrl) {
    return { success: false, error: "No opmlUrl configured" };
  }

  try {
    console.log("[Podroll] Fetching OPML sources...");
    const sources = await fetchOpmlSources(opmlUrl, fetchTimeout);
    console.log(`[Podroll] Fetched ${sources.length} podcast sources`);

    const collection = db.collection("podrollSources");

    // Clear existing and insert fresh
    await collection.deleteMany({});
    if (sources.length > 0) {
      await collection.insertMany(
        sources.map((s, index) => ({
          ...s,
          order: index,
          fetchedAt: new Date(),
        }))
      );
    }

    // Update sync metadata
    await db.collection("podrollMeta").updateOne(
      { key: "lastSourcesSync" },
      {
        $set: {
          key: "lastSourcesSync",
          timestamp: new Date(),
          sourceCount: sources.length,
        },
      },
      { upsert: true }
    );

    console.log(`[Podroll] Synced ${sources.length} podcast sources`);

    return {
      success: true,
      total: sources.length,
    };
  } catch (error) {
    console.error("[Podroll] Source sync failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Run full sync (episodes + sources)
 * @param {object} db - MongoDB database instance
 * @param {object} options - Sync options
 * @returns {Promise<object>} Combined sync results
 */
export async function runSync(db, options) {
  const [episodesResult, sourcesResult] = await Promise.all([
    syncEpisodes(db, options),
    options.opmlUrl ? syncSources(db, options) : { success: true, skipped: true },
  ]);

  return {
    episodes: episodesResult,
    sources: sourcesResult,
    timestamp: new Date(),
  };
}

/**
 * Get effective URLs from DB settings, falling back to env var config
 * @param {object} db - MongoDB database instance
 * @param {object} options - Plugin config from env vars
 * @returns {Promise<object>} Options with effective URLs
 */
async function getEffectiveSyncOptions(db, options) {
  try {
    const settings = await db
      .collection("podrollMeta")
      .findOne({ key: "settings" });
    if (settings) {
      return {
        ...options,
        episodesUrl: settings.episodesUrl || options.episodesUrl,
        opmlUrl: settings.opmlUrl || options.opmlUrl,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return options;
}

/**
 * Start background sync interval
 * @param {object} Indiekit - Indiekit instance
 * @param {object} options - Sync options
 */
export function startSync(Indiekit, options) {
  const { syncInterval } = options;

  // Initial sync after short delay
  setTimeout(async () => {
    const db = Indiekit.database;
    if (db) {
      console.log("[Podroll] Running initial sync...");
      const effectiveOptions = await getEffectiveSyncOptions(db, options);
      await runSync(db, effectiveOptions);
    }
  }, 5000);

  // Periodic sync
  setInterval(async () => {
    const db = Indiekit.database;
    if (db) {
      console.log("[Podroll] Running scheduled sync...");
      const effectiveOptions = await getEffectiveSyncOptions(db, options);
      await runSync(db, effectiveOptions);
    }
  }, syncInterval);

  console.log(`[Podroll] Background sync started (interval: ${syncInterval / 1000}s)`);
}
