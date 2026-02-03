import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { dashboardController } from "./lib/controllers/dashboard.js";
import { episodesController } from "./lib/controllers/episodes.js";
import { sourcesController } from "./lib/controllers/sources.js";
import { startSync } from "./lib/sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const protectedRouter = express.Router();
const publicRouter = express.Router();

const defaults = {
  mountPath: "/podrollapi",
  syncInterval: 900_000, // 15 minutes
  fetchCount: 200, // Items to request from FreshRSS (nb parameter)
  maxEpisodes: 200,
  fetchTimeout: 15_000,
  // These should be overridden in config
  episodesUrl: "",
  opmlUrl: "",
};

export default class PodrollEndpoint {
  name = "Podcast roll endpoint";

  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.mountPath = this.options.mountPath;
  }

  get localesDirectory() {
    return path.join(__dirname, "locales");
  }

  get navigationItems() {
    return {
      href: this.options.mountPath,
      text: "podroll.title",
      requiresDatabase: true,
    };
  }

  get shortcutItems() {
    return {
      url: this.options.mountPath,
      name: "podroll.title",
      iconName: "syndicate",
      requiresDatabase: true,
    };
  }

  /**
   * Protected routes (require authentication)
   * Admin dashboard and management
   */
  get routes() {
    // Dashboard
    protectedRouter.get("/", dashboardController.get);

    // Save settings
    protectedRouter.post("/settings", dashboardController.saveSettings);

    // Manual sync trigger
    protectedRouter.post("/sync", dashboardController.sync);

    // Clear and re-sync
    protectedRouter.post("/clear-resync", dashboardController.clearResync);

    return protectedRouter;
  }

  /**
   * Public routes (no authentication required)
   * Read-only JSON API endpoints for frontend
   */
  get routesPublic() {
    // Episodes API (read-only)
    publicRouter.get("/api/episodes", episodesController.list);
    publicRouter.get("/api/episodes/:id", episodesController.get);

    // Sources/OPML API (read-only)
    publicRouter.get("/api/sources", sourcesController.list);

    // Status API
    publicRouter.get("/api/status", dashboardController.status);

    return publicRouter;
  }

  init(Indiekit) {
    Indiekit.addEndpoint(this);

    // Add MongoDB collections
    Indiekit.addCollection("podrollEpisodes");
    Indiekit.addCollection("podrollSources");
    Indiekit.addCollection("podrollMeta");

    // Store config in application for controller access
    Indiekit.config.application.podrollConfig = this.options;
    Indiekit.config.application.podrollEndpoint = this.mountPath;

    // Store database getter for controller access
    Indiekit.config.application.getPodrollDb = () => Indiekit.database;

    // Start background sync if database is available and URLs are configured
    if (Indiekit.config.application.mongodbUrl && this.options.episodesUrl) {
      startSync(Indiekit, this.options);
    } else if (!this.options.episodesUrl) {
      console.warn("[Podroll] No episodesUrl configured, sync disabled");
    }
  }
}
