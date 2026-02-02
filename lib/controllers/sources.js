/**
 * Sources (OPML) API controller
 */
export const sourcesController = {
  /**
   * List podcast sources from OPML
   * GET /api/sources
   * Query params: category (filter by category)
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

      const category = request.query.category || null;
      const collection = db.collection("podrollSources");

      // Build query
      const query = {};
      if (category) {
        query.category = { $regex: category, $options: "i" };
      }

      // Get sources sorted by order (original OPML order)
      const sources = await collection
        .find(query)
        .sort({ category: 1, order: 1 })
        .toArray();

      // Group by category if multiple categories exist
      const categories = [...new Set(sources.map((s) => s.category).filter(Boolean))];

      // Transform for API response
      const items = sources.map((s) => ({
        title: s.title,
        xmlUrl: s.xmlUrl,
        htmlUrl: s.htmlUrl,
        category: s.category,
      }));

      response.json({
        items,
        total: items.length,
        categories: categories.length > 0 ? categories : null,
      });
    } catch (error) {
      console.error("[Podroll] Sources list error:", error);
      response.status(500).json({ error: error.message });
    }
  },
};
