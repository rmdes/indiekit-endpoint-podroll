import { runSync } from "../sync.js";

/**
 * Get effective URLs: DB-stored settings override env var defaults
 * @param {object} db - MongoDB database instance
 * @param {object} podrollConfig - Plugin config from env vars
 * @returns {Promise<object>} Effective episodesUrl and opmlUrl
 */
async function getEffectiveUrls(db, podrollConfig) {
  let episodesUrl = podrollConfig?.episodesUrl || "";
  let opmlUrl = podrollConfig?.opmlUrl || "";

  if (db) {
    const settings = await db
      .collection("podrollMeta")
      .findOne({ key: "settings" });
    if (settings) {
      if (settings.episodesUrl) episodesUrl = settings.episodesUrl;
      if (settings.opmlUrl) opmlUrl = settings.opmlUrl;
    }
  }

  return { episodesUrl, opmlUrl };
}

/**
 * Extract and clear flash messages from session
 * Returns { success, error } for Indiekit's native notificationBanner
 */
function consumeFlashMessage(request) {
  const result = {};
  if (request.session?.messages?.length) {
    const msg = request.session.messages[0];
    if (msg.type === "success") result.success = msg.content;
    else if (msg.type === "error" || msg.type === "warning")
      result.error = msg.content;
    request.session.messages = null;
  }
  return result;
}

/**
 * Dashboard controller for admin UI
 */
export const dashboardController = {
  /**
   * Render dashboard
   * GET /
   */
  async get(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getPodrollDb();

      let stats = {
        episodeCount: 0,
        sourceCount: 0,
        lastEpisodesSync: null,
        lastSourcesSync: null,
      };

      if (db) {
        const [episodeCount, sourceCount, episodesMeta, sourcesMeta] =
          await Promise.all([
            db.collection("podrollEpisodes").countDocuments(),
            db.collection("podrollSources").countDocuments(),
            db
              .collection("podrollMeta")
              .findOne({ key: "lastEpisodesSync" }),
            db
              .collection("podrollMeta")
              .findOne({ key: "lastSourcesSync" }),
          ]);

        // Convert Date objects to ISO strings for Nunjucks date filter
        const toISO = (d) => (d instanceof Date ? d.toISOString() : d);

        stats = {
          episodeCount,
          sourceCount,
          lastEpisodesSync: toISO(episodesMeta?.timestamp) || null,
          lastSourcesSync: toISO(sourcesMeta?.timestamp) || null,
        };
      }

      const urls = await getEffectiveUrls(db, application.podrollConfig);

      // Extract flash messages for native Indiekit notification banner
      const flash = consumeFlashMessage(request);

      response.render("dashboard", {
        title: response.__("podroll.title"),
        stats,
        config: {
          episodesUrl: urls.episodesUrl,
          opmlUrl: urls.opmlUrl,
          syncInterval: application.podrollConfig?.syncInterval || 900000,
        },
        mountPath: request.baseUrl,
        ...flash,
      });
    } catch (error) {
      console.error("[Podroll] Dashboard error:", error);
      response.status(500).render("error", {
        title: "Error",
        message: error.message,
      });
    }
  },

  /**
   * Save settings
   * POST /settings
   */
  async saveSettings(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getPodrollDb();

      if (!db) {
        return response.status(503).json({ error: "Database not available" });
      }

      const { episodesUrl, opmlUrl } = request.body;

      await db.collection("podrollMeta").updateOne(
        { key: "settings" },
        {
          $set: {
            key: "settings",
            episodesUrl: episodesUrl || "",
            opmlUrl: opmlUrl || "",
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );

      console.log("[Podroll] Settings saved");
      request.session.messages = [
        { type: "success", content: request.__("podroll.settingsSaved") },
      ];
      response.redirect(request.baseUrl);
    } catch (error) {
      console.error("[Podroll] Settings save error:", error);
      request.session.messages = [
        { type: "error", content: error.message },
      ];
      response.redirect(request.baseUrl);
    }
  },

  /**
   * Manual sync trigger
   * POST /sync
   */
  async sync(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getPodrollDb();

      if (!db) {
        return response.status(503).json({ error: "Database not available" });
      }

      // Use effective URLs (DB settings override env vars)
      const urls = await getEffectiveUrls(db, application.podrollConfig);
      const syncOptions = {
        ...application.podrollConfig,
        episodesUrl: urls.episodesUrl,
        opmlUrl: urls.opmlUrl,
      };

      await runSync(db, syncOptions);

      request.session.messages = [
        { type: "success", content: request.__("podroll.syncSuccess") },
      ];
      response.redirect(request.baseUrl);
    } catch (error) {
      console.error("[Podroll] Sync error:", error);
      request.session.messages = [
        { type: "error", content: error.message },
      ];
      response.redirect(request.baseUrl);
    }
  },

  /**
   * Clear all data and re-sync
   * POST /clear-resync
   */
  async clearResync(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getPodrollDb();

      if (!db) {
        return response.status(503).json({ error: "Database not available" });
      }

      // Clear data collections but preserve settings
      await Promise.all([
        db.collection("podrollEpisodes").deleteMany({}),
        db.collection("podrollSources").deleteMany({}),
        db
          .collection("podrollMeta")
          .deleteMany({ key: { $ne: "settings" } }),
      ]);

      console.log("[Podroll] Cleared all data, starting fresh sync...");

      // Use effective URLs (DB settings override env vars)
      const urls = await getEffectiveUrls(db, application.podrollConfig);
      const syncOptions = {
        ...application.podrollConfig,
        episodesUrl: urls.episodesUrl,
        opmlUrl: urls.opmlUrl,
      };

      await runSync(db, syncOptions);

      request.session.messages = [
        { type: "success", content: request.__("podroll.clearSuccess") },
      ];
      response.redirect(request.baseUrl);
    } catch (error) {
      console.error("[Podroll] Clear/resync error:", error);
      request.session.messages = [
        { type: "error", content: error.message },
      ];
      response.redirect(request.baseUrl);
    }
  },

  /**
   * Status API (public)
   * GET /api/status
   */
  async status(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getPodrollDb();

      if (!db) {
        return response.json({
          status: "unavailable",
          message: "Database not connected",
        });
      }

      const [episodeCount, sourceCount, episodesMeta, sourcesMeta] =
        await Promise.all([
          db.collection("podrollEpisodes").countDocuments(),
          db.collection("podrollSources").countDocuments(),
          db
            .collection("podrollMeta")
            .findOne({ key: "lastEpisodesSync" }),
          db
            .collection("podrollMeta")
            .findOne({ key: "lastSourcesSync" }),
        ]);

      response.json({
        status: "ok",
        episodes: {
          count: episodeCount,
          lastSync: episodesMeta?.timestamp || null,
        },
        sources: {
          count: sourceCount,
          lastSync: sourcesMeta?.timestamp || null,
        },
      });
    } catch (error) {
      response.status(500).json({
        status: "error",
        message: error.message,
      });
    }
  },
};
