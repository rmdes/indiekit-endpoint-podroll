import { runSync } from "../sync.js";

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
        const [episodeCount, sourceCount, episodesMeta, sourcesMeta] = await Promise.all([
          db.collection("podrollEpisodes").countDocuments(),
          db.collection("podrollSources").countDocuments(),
          db.collection("podrollMeta").findOne({ key: "lastEpisodesSync" }),
          db.collection("podrollMeta").findOne({ key: "lastSourcesSync" }),
        ]);

        stats = {
          episodeCount,
          sourceCount,
          lastEpisodesSync: episodesMeta?.timestamp || null,
          lastSourcesSync: sourcesMeta?.timestamp || null,
        };
      }

      response.render("dashboard", {
        title: response.__("podroll.title"),
        stats,
        config: {
          episodesUrl: application.podrollConfig?.episodesUrl ? "Configured" : "Not set",
          opmlUrl: application.podrollConfig?.opmlUrl ? "Configured" : "Not set",
          syncInterval: application.podrollConfig?.syncInterval || 900000,
        },
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

      const result = await runSync(db, application.podrollConfig);

      // Redirect back to dashboard with success message
      response.redirect(application.podrollEndpoint + "?synced=true");
    } catch (error) {
      console.error("[Podroll] Sync error:", error);
      response.redirect(application.podrollEndpoint + "?error=" + encodeURIComponent(error.message));
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

      // Clear collections
      await Promise.all([
        db.collection("podrollEpisodes").deleteMany({}),
        db.collection("podrollSources").deleteMany({}),
        db.collection("podrollMeta").deleteMany({}),
      ]);

      console.log("[Podroll] Cleared all data, starting fresh sync...");

      // Run fresh sync
      const result = await runSync(db, application.podrollConfig);

      response.redirect(application.podrollEndpoint + "?cleared=true");
    } catch (error) {
      console.error("[Podroll] Clear/resync error:", error);
      response.redirect(application.podrollEndpoint + "?error=" + encodeURIComponent(error.message));
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

      const [episodeCount, sourceCount, episodesMeta, sourcesMeta] = await Promise.all([
        db.collection("podrollEpisodes").countDocuments(),
        db.collection("podrollSources").countDocuments(),
        db.collection("podrollMeta").findOne({ key: "lastEpisodesSync" }),
        db.collection("podrollMeta").findOne({ key: "lastSourcesSync" }),
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
