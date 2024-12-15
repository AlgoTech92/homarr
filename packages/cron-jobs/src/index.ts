import { analyticsJob } from "./jobs/analytics";
import { iconsUpdaterJob } from "./jobs/icons-updater";
import { dnsHoleJob } from "./jobs/integrations/dns-hole";
import { downloadsJob } from "./jobs/integrations/downloads";
import { healthMonitoringJob } from "./jobs/integrations/health-monitoring";
import { smartHomeEntityStateJob } from "./jobs/integrations/home-assistant";
import { indexerManagerJob } from "./jobs/integrations/indexer-manager";
import { mediaOrganizerJob } from "./jobs/integrations/media-organizer";
import { mediaRequestListJob, mediaRequestStatsJob } from "./jobs/integrations/media-requests";
import { mediaServerJob } from "./jobs/integrations/media-server";
import { mediaTranscodingJob } from "./jobs/integrations/media-transcoding";
import { pingJob } from "./jobs/ping";
import type { RssFeed } from "./jobs/rss-feeds";
import { rssFeedsJob } from "./jobs/rss-feeds";
import { sessionCleanupJob } from "./jobs/session-cleanup";
import { updateCheckerJob } from "./jobs/update-checker";
import { createCronJobGroup } from "./lib";

export const jobGroup = createCronJobGroup({
  analytics: analyticsJob,
  iconsUpdater: iconsUpdaterJob,
  ping: pingJob,
  smartHomeEntityState: smartHomeEntityStateJob,
  mediaServer: mediaServerJob,
  mediaOrganizer: mediaOrganizerJob,
  downloads: downloadsJob,
  dnsHole: dnsHoleJob,
  mediaRequestStats: mediaRequestStatsJob,
  mediaRequestList: mediaRequestListJob,
  rssFeeds: rssFeedsJob,
  indexerManager: indexerManagerJob,
  healthMonitoring: healthMonitoringJob,
  sessionCleanup: sessionCleanupJob,
  updateChecker: updateCheckerJob,
  mediaTranscoding: mediaTranscodingJob,
});

export type JobGroupKeys = ReturnType<(typeof jobGroup)["getKeys"]>[number];
export type { RssFeed };
