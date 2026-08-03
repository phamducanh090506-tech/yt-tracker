// scripts/fetch-data.mjs
//
// Pulls stats for one or more named lists of YouTube channels (videos +
// stats + comments) and writes static JSON files into public/data/ so the
// frontend (hosted as a static site on Netlify) never needs to touch the
// YouTube API or an API key directly.
//
// channels.json holds named lists ("markets"/tabs in the frontend), e.g.:
//   { "TBN": ["@kenh1", "..."], "4K": ["@kenh2", "..."] }
// Each list name produces its own output files:
//   public/data/videos-<LIST>.json
//   public/data/meta-<LIST>.json
// Comments are shared across lists in public/data/comments/<videoId>.json
// since a comment file only depends on the video, not which list found it.
//
// IMPORTANT - videos-<LIST>.json is a MERGE across runs, not a rebuild:
// a normal run only fetches each channel's most recent MAX_VIDEOS_PER_CHANNEL
// videos and adds/updates just those - it does NOT delete older videos that
// fall outside that window. Only a full-history run (FULL_CHANNEL_HISTORY or
// a channel matched in FULL_HISTORY_CHANNELS) is treated as authoritative for
// that channel and reconciles deletions (removes videos that no longer show
// up). This means the very first fetch for a list should normally be a
// full-history run - otherwise every subsequent normal run stays capped at
// whatever that first run happened to catch.
//
// Each video record also gets:
//   viewsPerHour        - view velocity (see computeViewsPerHour() below for the
//                          "recent vs lifetime" logic)
//   viewsPerHourSource   - "recent" (real delta since last fetch) or "lifetime"
//                          (fallback average, used only the first time a video is seen)
//
// Run locally:   YOUTUBE_API_KEY=xxx node scripts/fetch-data.mjs
// Run in CI:      see .github/workflows/fetch-data.yml
//
// Config via env vars (all optional):
//   MAX_VIDEOS_PER_CHANNEL   default 50   - how many most-recent videos to track per channel
//   FULL_CHANNEL_HISTORY     default false - when true, ignores MAX_VIDEOS_PER_CHANNEL and
//                            pulls every video in EVERY channel's uploads playlist. Uses a
//                            lot more quota - meant for an occasional manual "fetch toàn bộ"
//                            run, not every scheduled run.
//   FULL_HISTORY_CHANNELS    default "" - comma-separated handles/URLs (as they appear in
//                            channels.json). Only THESE channels get the full-history
//                            treatment this run; everything else still uses
//                            MAX_VIDEOS_PER_CHANNEL. Handy right after adding a new channel -
//                            no need to re-fetch every other channel's full history too.
//   MAX_COMMENTS_PER_VIDEO   default 100  - how many top-level comments to store per video
//   MAX_REPLIES_PER_COMMENT  default 20   - how many replies to store per top-level comment
//   COMMENT_ORDER            default "relevance" (or "time") - ignored when
//                            COMMENT_MAX_AGE_DAYS > 0, which forces "time" order
//   COMMENT_MAX_AGE_DAYS     default 90   - only keep comments newer than this many
//                            days (0 = no limit, keep all up to MAX_COMMENTS_PER_VIDEO).
//                            Also stops paginating as soon as older comments are hit,
//                            so this actually saves quota, not just storage.
//   FORCE_REFRESH_COMMENTS   default false - refetch comments even if commentCount unchanged
//   YOUTUBE_API_KEY          a single API key
//   YOUTUBE_API_KEYS         multiple API keys, comma-separated - used as automatic
//                            fallbacks: when one key hits its daily quota
//                            (quotaExceeded), the script switches to the next key
//                            and keeps going instead of failing the whole run.

import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import path from "path";

const API_KEYS = (process.env.YOUTUBE_API_KEYS || process.env.YOUTUBE_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
if (API_KEYS.length === 0) {
  console.error("Missing YOUTUBE_API_KEY or YOUTUBE_API_KEYS environment variable.");
  process.exit(1);
}
let apiKeyIndex = 0;
let keysExhausted = false; // true once every key has hit quotaExceeded

// Log this clearly at startup - the #1 cause of "key 2 never gets used" bug
// reports is that the workflow only passes YOUTUBE_API_KEY (singular) as an
// env var, so this array only ever has 1 entry no matter how many secrets
// exist in GitHub. Check this line in the Action logs first when debugging.
console.log(
  `Loaded ${API_KEYS.length} API key(s): ${API_KEYS.map((k) => k.slice(0, 4) + "…" + k.slice(-4)).join(", ")}`
);
if (API_KEYS.length < 2) {
  console.log(
    `  (Chỉ có 1 key - nếu bạn nghĩ mình đã cấu hình nhiều key, kiểm tra workflow đang set biến ` +
      `YOUTUBE_API_KEYS (số nhiều, cách nhau dấu phẩy) chứ không phải YOUTUBE_API_KEY.)`
  );
}

const MAX_VIDEOS_PER_CHANNEL = parseInt(process.env.MAX_VIDEOS_PER_CHANNEL || "50", 10);
const FULL_CHANNEL_HISTORY = /^true$/i.test(process.env.FULL_CHANNEL_HISTORY || "");
if (FULL_CHANNEL_HISTORY) {
  console.log("FULL_CHANNEL_HISTORY=true - sẽ lấy TOÀN BỘ video của mỗi kênh (bỏ qua giới hạn MAX_VIDEOS_PER_CHANNEL).");
}

// Comma-separated list of channel handles/URLs (as they appear in
// channels.json) that should get the FULL video history this run, without
// forcing every other channel to also re-fetch its full history. Useful
// right after adding a brand-new channel - only that one needs a backfill,
// everything else can keep using the normal MAX_VIDEOS_PER_CHANNEL cap.
// Matching is loose (case-insensitive substring) so pasting just "@handle"
// still matches a full "https://www.youtube.com/@handle" entry.
const FULL_HISTORY_CHANNELS = (process.env.FULL_HISTORY_CHANNELS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
if (FULL_HISTORY_CHANNELS.length) {
  console.log(`FULL_HISTORY_CHANNELS: sẽ lấy toàn bộ lịch sử riêng cho: ${FULL_HISTORY_CHANNELS.join(", ")}`);
}
function shouldUseFullHistory(rawChannel) {
  if (FULL_CHANNEL_HISTORY) return true;
  const lower = rawChannel.toLowerCase();
  return FULL_HISTORY_CHANNELS.some((c) => lower.includes(c) || c.includes(lower));
}

const MAX_COMMENTS_PER_VIDEO = parseInt(process.env.MAX_COMMENTS_PER_VIDEO || "100", 10);
const MAX_REPLIES_PER_COMMENT = parseInt(process.env.MAX_REPLIES_PER_COMMENT || "20", 10);
const COMMENT_ORDER = process.env.COMMENT_ORDER || "relevance";
const COMMENT_MAX_AGE_DAYS = parseInt(process.env.COMMENT_MAX_AGE_DAYS || "90", 10); // 0 = no limit
const FORCE_REFRESH_COMMENTS = /^true$/i.test(process.env.FORCE_REFRESH_COMMENTS || "");

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const COMMENTS_DIR = path.join(DATA_DIR, "comments");
const CHANNELS_FILE = path.join(ROOT, "channels.json");
const videosFileFor = (listName) => path.join(DATA_DIR, `videos-${listName}.json`);
const metaFileFor = (listName) => path.join(DATA_DIR, `meta-${listName}.json`);
// Remembers rawChannel -> channelId even across a run where resolveChannel()
// itself failed (e.g. quota ran out before we could even resolve it), so a
// later failed run can still find that channel's previously-cached videos.
const channelMapFileFor = (listName) => path.join(DATA_DIR, `channel-map-${listName}.json`);

let quotaUnits = 0;
const API_BASE = "https://www.googleapis.com/youtube/v3";

async function apiGet(endpoint, params, cost = 1) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  url.searchParams.set("key", API_KEYS[apiKeyIndex]);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  quotaUnits += cost;
  const json = await res.json();
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason || res.status;
    const err = new Error(`${endpoint} failed: ${reason}`);
    err.reason = reason;
    err.status = res.status;
    throw err;
  }
  return json;
}

// Retries transient failures (network blips, 5xx, rate limiting) a couple of
// times before giving up, so a single hiccup mid-run doesn't silently leave
// a comment's replies empty. Also rotates to the next API key immediately
// when the current key hits its daily quota, instead of wasting retries on
// a key that's already exhausted.
async function apiGetWithRetry(endpoint, params, cost = 1, retries = 2) {
  let lastErr;
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await apiGet(endpoint, params, cost);
    } catch (err) {
      lastErr = err;
      if (err.reason === "quotaExceeded" || err.reason === "dailyLimitExceeded") {
        if (apiKeyIndex < API_KEYS.length - 1) {
          apiKeyIndex++;
          console.error(
            `    ! API key #${apiKeyIndex} bị hết quota, chuyển sang key #${apiKeyIndex + 1}...`
          );
          continue; // retry the same request on the new key, don't burn a retry attempt
        }
        keysExhausted = true;
        throw err;
      }
      // Don't retry permanent/expected failures like commentsDisabled or bad requests.
      const permanent = ["commentsDisabled", "commentThreadNotFound", "processingFailure"].includes(
        err.reason
      );
      attempt++;
      if (permanent || attempt > retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

function extractChannelRef(rawInput) {
  let raw = rawInput.trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // leave as-is if not valid percent-encoding
  }
  // Full URL forms
  const chMatch = raw.match(/youtube\.com\/channel\/([A-Za-z0-9_-]{10,})/);
  if (chMatch) return { type: "id", value: chMatch[1] };
  const handleMatch = raw.match(/youtube\.com\/@([^\/?&]+)/);
  if (handleMatch) return { type: "handle", value: "@" + handleMatch[1] };
  // Bare channel ID (starts with UC, 24 chars)
  if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return { type: "id", value: raw };
  // Bare handle
  if (raw.startsWith("@")) return { type: "handle", value: raw };
  // Fallback: treat as handle
  return { type: "handle", value: "@" + raw.replace(/^@/, "") };
}

async function resolveChannel(raw) {
  const ref = extractChannelRef(raw);
  const params = { part: "snippet,statistics,contentDetails" };
  if (ref.type === "id") params.id = ref.value;
  else params.forHandle = ref.value;

  const json = await apiGetWithRetry("channels", params);
  const item = json.items?.[0];
  if (!item) throw new Error(`Channel not found for "${raw}"`);
  return {
    channelId: item.id,
    channelTitle: item.snippet.title,
    channelThumbnail: item.snippet.thumbnails?.default?.url || "",
    subscriberCount: item.statistics.hiddenSubscriberCount
      ? null
      : parseInt(item.statistics.subscriberCount || "0", 10),
    channelViewCount: parseInt(item.statistics.viewCount || "0", 10),
    channelVideoCount: parseInt(item.statistics.videoCount || "0", 10),
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

async function getRecentVideoIds(uploadsPlaylistId, max) {
  const ids = [];
  let pageToken = "";
  while (max === Infinity || ids.length < max) {
    const remaining = max === Infinity ? 50 : max - ids.length;
    const json = await apiGetWithRetry("playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(50, remaining)),
      ...(pageToken ? { pageToken } : {}),
    });
    for (const it of json.items || []) ids.push(it.contentDetails.videoId);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return max === Infinity ? ids : ids.slice(0, max);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getVideoStats(ids) {
  const results = [];
  for (const group of chunk(ids, 50)) {
    const json = await apiGetWithRetry("videos", {
      part: "snippet,statistics,contentDetails",
      id: group.join(","),
    });
    for (const v of json.items || []) {
      results.push({
        videoId: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumbnail:
          v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
        viewCount: parseInt(v.statistics.viewCount || "0", 10),
        likeCount: v.statistics.likeCount !== undefined ? parseInt(v.statistics.likeCount, 10) : null,
        commentCount:
          v.statistics.commentCount !== undefined ? parseInt(v.statistics.commentCount, 10) : 0,
        duration: v.contentDetails.duration,
      });
    }
  }
  return results;
}

const replyErrors = [];

async function getReplies(parentId, max, videoId) {
  // commentThreads only embeds a small preview of replies for some orders,
  // so fetch explicitly via comments.list to get a consistent set.
  const replies = [];
  let pageToken = "";
  try {
    while (replies.length < max) {
      const json = await apiGetWithRetry("comments", {
        part: "snippet",
        parentId,
        maxResults: String(Math.min(100, max - replies.length)),
        textFormat: "plainText",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of json.items || []) {
        const s = item.snippet;
        replies.push({
          id: item.id,
          author: s.authorDisplayName,
          authorImage: s.authorProfileImageUrl,
          text: s.textDisplay,
          likeCount: s.likeCount || 0,
          publishedAt: s.publishedAt,
        });
      }
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
  } catch (err) {
    // Don't fail the whole run if replies can't be fetched for one comment -
    // but do record it so it's visible in meta.json instead of only in logs.
    console.error(`    ! Failed replies for comment ${parentId}: ${err.message}`);
    replyErrors.push({ videoId, commentId: parentId, error: err.message });
  }
  // Replies come back newest-first from the API; show oldest-first like YouTube does.
  return replies.reverse();
}

async function getComments(videoId, max, order, maxRepliesPerComment, maxAgeDays) {
  const comments = [];
  let pageToken = "";
  // If we're only keeping recent comments, we MUST fetch newest-first ("time")
  // so we can stop paginating as soon as we hit a comment older than the
  // cutoff - that's what actually saves quota, not just filtering afterwards.
  const effectiveOrder = maxAgeDays > 0 ? "time" : order;
  const cutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : null;
  try {
    outer: while (comments.length < max) {
      const json = await apiGetWithRetry("commentThreads", {
        part: "snippet",
        videoId,
        maxResults: String(Math.min(100, max - comments.length)),
        order: effectiveOrder,
        textFormat: "plainText",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of json.items || []) {
        const top = item.snippet.topLevelComment.snippet;
        if (cutoff !== null && new Date(top.publishedAt).getTime() < cutoff) {
          // Newest-first order: once we hit one comment older than the
          // cutoff, everything after it is older too - stop entirely.
          break outer;
        }
        const replyCount = item.snippet.totalReplyCount || 0;
        const replies =
          replyCount > 0 && maxRepliesPerComment > 0
            ? await getReplies(item.id, maxRepliesPerComment, videoId)
            : [];
        comments.push({
          id: item.id,
          author: top.authorDisplayName,
          authorImage: top.authorProfileImageUrl,
          text: top.textDisplay,
          likeCount: top.likeCount || 0,
          publishedAt: top.publishedAt,
          replyCount,
          replies,
        });
      }
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
  } catch (err) {
    if (err.reason === "commentsDisabled") {
      return { disabled: true, comments: [] };
    }
    throw err;
  }
  return { disabled: false, comments };
}

async function loadPreviousVideos(listName) {
  try {
    const raw = await readFile(videosFileFor(listName), "utf-8");
    const arr = JSON.parse(raw);
    const map = new Map();
    for (const v of arr) map.set(v.videoId, v);
    return map;
  } catch {
    return new Map();
  }
}

async function loadPreviousFetchTime(listName) {
  try {
    const raw = await readFile(metaFileFor(listName), "utf-8");
    const meta = JSON.parse(raw);
    return meta.lastUpdated ? new Date(meta.lastUpdated) : null;
  } catch {
    return null;
  }
}

// Views/hour has two flavors:
//  - "recent": (viewCount now - viewCount at last successful fetch) / hours between
//    the two fetches. This is what actually shows "is this video hot RIGHT NOW",
//    including old videos that suddenly spike again. Needs a previous data point.
//  - "lifetime": viewCount / hours since publishedAt. Used as a fallback the first
//    time we ever see a video (no previous data point to diff against yet). It's a
//    lifetime average, not a velocity, so it under-reports spikes on older videos -
//    but it's the only number available until the next fetch gives us a real delta.
function computeViewsPerHour(video, prevVideo, previousFetchTime, now) {
  if (prevVideo && previousFetchTime) {
    const hoursBetweenFetches = (now - previousFetchTime) / 3600000;
    if (hoursBetweenFetches >= 0.5) {
      const delta = video.viewCount - prevVideo.viewCount;
      return {
        viewsPerHour: Math.round(Math.max(0, delta) / hoursBetweenFetches),
        viewsPerHourSource: "recent",
      };
    }
  }
  const hoursSincePublish = Math.max((now - new Date(video.publishedAt)) / 3600000, 1);
  return {
    viewsPerHour: Math.round(video.viewCount / hoursSincePublish),
    viewsPerHourSource: "lifetime",
  };
}

async function loadChannelMap(listName) {
  try {
    const raw = await readFile(channelMapFileFor(listName), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveChannelMap(listName, map) {
  await writeFile(channelMapFileFor(listName), JSON.stringify(map, null, 2));
}

// Normalizes channels.json into { listName: [rawChannel, ...] } pairs.
// Supports the current named-lists object format, e.g. { "TBN": [...], "4K": [...] },
// and also accepts a plain array (treated as a single implicit "default" list)
// for backwards compatibility with older channels.json files.
function normalizeChannelLists(parsed) {
  if (Array.isArray(parsed)) {
    return { default: parsed };
  }
  if (parsed && typeof parsed === "object") {
    return parsed;
  }
  throw new Error("channels.json must be either an array or an object of named lists.");
}

async function fetchList(listName, rawChannels) {
  console.log(`\n########## Danh sách: ${listName} (${rawChannels.length} kênh) ##########`);

  const previousVideos = await loadPreviousVideos(listName);
  const previousFetchTime = await loadPreviousFetchTime(listName);
  const now = new Date();
  const channelMap = await loadChannelMap(listName); // rawChannel -> channelId, from last successful resolve
  const errors = [];

  // The video set is a MERGE across runs, not a fresh rebuild each time:
  //  - Start from everything we've ever recorded for this list.
  //  - A normal run (capped at MAX_VIDEOS_PER_CHANNEL) only ADDS/UPDATES the
  //    videos it actually fetched - older videos outside that window are left
  //    untouched, so the historical backlog from a past full-history fetch
  //    survives every ordinary cron run instead of being wiped down to ~50/kênh.
  //  - A full-history run for a channel (FULL_CHANNEL_HISTORY or that channel
  //    matched in FULL_HISTORY_CHANNELS) IS authoritative for that channel's
  //    entire video set, so it also prunes any of that channel's videos that
  //    weren't returned this time (genuinely deleted/privated on YouTube).
  //  - A channel that fails entirely this run simply isn't touched - whatever
  //    was already in the map for it (from any earlier run) stays as-is.
  const videoMap = new Map(previousVideos);

  for (const rawChannel of rawChannels) {
    let channel = null;
    const isNewChannel = !channelMap[rawChannel];
    try {
      console.log(`\n=== Channel: ${rawChannel} ===`);
      channel = await resolveChannel(rawChannel);
      channelMap[rawChannel] = channel.channelId;
      console.log(`Resolved: ${channel.channelTitle} (${channel.channelId})`);

      // Brand-new channels (never resolved before, e.g. just added through
      // the "Quản lý kênh" panel) automatically get their full history on
      // this first run - nobody has to remember to tick a "full history"
      // option. Established channels keep using the normal capped fetch
      // unless FULL_CHANNEL_HISTORY / FULL_HISTORY_CHANNELS says otherwise.
      const useFullHistory = isNewChannel || shouldUseFullHistory(rawChannel);
      if (useFullHistory) {
        console.log(
          isNewChannel
            ? `  -> kênh mới, tự động lấy toàn bộ lịch sử lần đầu`
            : `  -> full history riêng cho kênh này (khớp FULL_HISTORY_CHANNELS)`
        );
      }
      const videoIds = await getRecentVideoIds(
        channel.uploadsPlaylistId,
        useFullHistory ? Infinity : MAX_VIDEOS_PER_CHANNEL
      );
      console.log(`Found ${videoIds.length} videos`);

      const stats = await getVideoStats(videoIds);
      const fetchedIds = new Set();

      for (const v of stats) {
        fetchedIds.add(v.videoId);
        const prev = previousVideos.get(v.videoId);
        const { viewsPerHour, viewsPerHourSource } = computeViewsPerHour(v, prev, previousFetchTime, now);

        videoMap.set(v.videoId, {
          ...v,
          channelId: channel.channelId,
          channelTitle: channel.channelTitle,
          channelThumbnail: channel.channelThumbnail,
          subscriberCount: channel.subscriberCount,
          channelViewCount: channel.channelViewCount,
          channelVideoCount: channel.channelVideoCount,
          viewsPerHour,
          viewsPerHourSource,
        });

        const needsCommentRefresh =
          FORCE_REFRESH_COMMENTS ||
          !prev ||
          prev.commentCount !== v.commentCount;

        if (!needsCommentRefresh) {
          console.log(`  - ${v.videoId} comments unchanged, skipping`);
          continue;
        }

        try {
          const { disabled, comments } = await getComments(
            v.videoId,
            MAX_COMMENTS_PER_VIDEO,
            COMMENT_ORDER,
            MAX_REPLIES_PER_COMMENT,
            COMMENT_MAX_AGE_DAYS
          );
          await writeFile(
            path.join(COMMENTS_DIR, `${v.videoId}.json`),
            JSON.stringify({ videoId: v.videoId, disabled, comments }, null, 2)
          );
          console.log(`  - ${v.videoId} fetched ${comments.length} comments${disabled ? " (disabled)" : ""}`);
        } catch (err) {
          console.error(`  ! Failed comments for ${v.videoId}: ${err.message}`);
          errors.push({ videoId: v.videoId, error: err.message });
        }
      }

      // Full-history runs reconcile deletions for THIS channel only - never
      // for channels that used the normal capped fetch this run, since a
      // capped fetch legitimately doesn't see older videos and that's not
      // the same thing as those videos having been deleted.
      if (useFullHistory) {
        for (const [videoId, v] of videoMap) {
          if (v.channelId === channel.channelId && !fetchedIds.has(videoId)) {
            videoMap.delete(videoId);
          }
        }
      }
    } catch (err) {
      console.error(`! Failed channel "${rawChannel}": ${err.message}`);
      errors.push({ channel: rawChannel, error: err.message });
    }
  }

  await saveChannelMap(listName, channelMap);

  const allVideos = [...videoMap.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await writeFile(videosFileFor(listName), JSON.stringify(allVideos, null, 2));
  await writeFile(
    metaFileFor(listName),
    JSON.stringify(
      {
        list: listName,
        lastUpdated: new Date().toISOString(),
        channelCount: rawChannels.length,
        videoCount: allVideos.length,
        quotaUnitsUsed: quotaUnits,
        apiKeysConfigured: API_KEYS.length,
        allKeysExhausted: keysExhausted,
        errors,
        replyErrors,
      },
      null,
      2
    )
  );

  console.log(`\n[${listName}] Done. Videos: ${allVideos.length}.`);
  if (errors.length) {
    console.log(`[${listName}] Completed with ${errors.length} error(s) - see meta-${listName}.json`);
  }

  return allVideos;
}

async function main() {
  await mkdir(COMMENTS_DIR, { recursive: true });

  const channelLists = normalizeChannelLists(JSON.parse(await readFile(CHANNELS_FILE, "utf-8")));
  const listNames = Object.keys(channelLists);

  // The frontend renders its tab buttons FROM this file instead of having
  // them hardcoded in index.html - so adding/removing a tab in
  // channels.json (including via the "Quản lý kênh" panel on the site) is
  // enough on its own; nobody needs to touch any HTML ever again. Written
  // up front, before the fetch loop, so the tab list stays correct even if
  // this run gets cut short (e.g. quota runs out partway through).
  await writeFile(path.join(DATA_DIR, "tabs.json"), JSON.stringify(listNames, null, 2));

  let grandTotalVideos = [];
  for (const listName of listNames) {
    const videos = await fetchList(listName, channelLists[listName]);
    grandTotalVideos = grandTotalVideos.concat(videos);
    if (keysExhausted) {
      console.log("\nTất cả API key đã hết quota, dừng sớm các danh sách còn lại.");
      break;
    }
  }

  // Prune comment files for videos no longer tracked in ANY list.
  try {
    const trackedIds = new Set(grandTotalVideos.map((v) => v.videoId));
    const existingFiles = await readdir(COMMENTS_DIR);
    for (const file of existingFiles) {
      const id = file.replace(/\.json$/, "");
      if (!trackedIds.has(id)) {
        await unlink(path.join(COMMENTS_DIR, file));
      }
    }
  } catch {
    // ignore
  }

  console.log(`\nHoàn tất tất cả danh sách (${listNames.join(", ")}). Tổng video: ${grandTotalVideos.length}. Ước tính quota dùng: ${quotaUnits}.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
