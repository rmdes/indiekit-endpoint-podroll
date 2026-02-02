/**
 * Episodes API controller
 */
export const episodesController = {
  /**
   * List episodes
   * GET /api/episodes
   * Query params: limit, offset, source (filter by origin title)
   */
  async list(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getPodrollDb();

      if (!db) {
        return response.status(503).json({
          error: "Database not available",
        });
      }

      const limit = Math.min(parseInt(request.query.limit) || 50, 200);
      const offset = parseInt(request.query.offset) || 0;
      const source = request.query.source || null;

      const collection = db.collection("podrollEpisodes");

      // Build query
      const query = {};
      if (source) {
        query["origin.title"] = { $regex: source, $options: "i" };
      }

      // Get total count
      const total = await collection.countDocuments(query);

      // Get episodes
      const episodes = await collection
        .find(query)
        .sort({ published: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();

      // Transform for API response
      const items = episodes.map((ep) => ({
        id: ep.id,
        title: ep.title,
        url: ep.url,
        published: ep.published,
        content: ep.content,
        author: ep.author,
        enclosure: ep.enclosure,
        podcast: ep.origin
          ? {
              title: ep.origin.title,
              url: ep.origin.htmlUrl,
              feedUrl: ep.origin.feedUrl,
            }
          : null,
      }));

      response.json({
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      });
    } catch (error) {
      console.error("[Podroll] Episodes list error:", error);
      response.status(500).json({ error: error.message });
    }
  },

  /**
   * Get single episode
   * GET /api/episodes/:id
   */
  async get(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getPodrollDb();

      if (!db) {
        return response.status(503).json({
          error: "Database not available",
        });
      }

      const { id } = request.params;
      const collection = db.collection("podrollEpisodes");

      const episode = await collection.findOne({ id });

      if (!episode) {
        return response.status(404).json({ error: "Episode not found" });
      }

      response.json({
        id: episode.id,
        title: episode.title,
        url: episode.url,
        published: episode.published,
        content: episode.content,
        author: episode.author,
        enclosure: episode.enclosure,
        podcast: episode.origin
          ? {
              title: episode.origin.title,
              url: episode.origin.htmlUrl,
              feedUrl: episode.origin.feedUrl,
            }
          : null,
        categories: episode.categories,
      });
    } catch (error) {
      console.error("[Podroll] Episode get error:", error);
      response.status(500).json({ error: error.message });
    }
  },
};
