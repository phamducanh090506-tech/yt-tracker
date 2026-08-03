// api/manage-channels.js
//
// Lets the "Quản lý kênh" panel on the site add/remove a channel, or
// add/remove an entire tab, WITHOUT anyone having to open GitHub or edit
// channels.json by hand. It reads channels.json from the repo via GitHub's
// Contents API, edits it in memory, and commits it straight back - which
// then triggers the existing `push: paths: channels.json` rule in
// fetch-data.yml, so new channels get fetched automatically within a few
// minutes without any extra step.
//
// No password on this endpoint either (matches trigger-fetch.js) - anyone
// who can load the site can manage channels/tabs. If that's ever a concern,
// the simplest fix is restricting who knows the site's URL, since neither
// endpoint exposes any secret to the browser.
//
// Required environment variables (same ones trigger-fetch.js uses):
//   GITHUB_TOKEN   Needs "Contents: Read and write" permission on the repo
//                  (a classic PAT with the "repo" scope already has this).
//   GITHUB_OWNER
//   GITHUB_REPO
// Optional:
//   GITHUB_REF     defaults to "main"

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const missing = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"].filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({
      error: `Server chưa cấu hình đủ biến môi trường: ${missing.join(", ")} (vào Vercel Settings > Environment Variables).`,
    });
  }
  const ref = process.env.GITHUB_REF || "main";

  const body = typeof req.body === "string" ? safeJsonParse(req.body) : req.body || {};
  const { action, tab, channel } = body;

  if (!["addChannel", "removeChannel", "addTab", "removeTab", "listTabs"].includes(action)) {
    return res.status(400).json({ error: "Thiếu hoặc sai 'action'." });
  }
  if (action !== "listTabs" && (!tab || typeof tab !== "string" || !tab.trim())) {
    return res.status(400).json({ error: "Thiếu tên tab." });
  }
  if ((action === "addChannel" || action === "addTab") && (!channel || typeof channel !== "string" || !channel.trim())) {
    return res.status(400).json({ error: "Thiếu link/handle kênh." });
  }

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/channels.json`;

  try {
    // 1. Đọc channels.json hiện tại.
    const getRes = await fetch(`${contentsUrl}?ref=${ref}`, { headers: ghHeaders });
    if (!getRes.ok) {
      const t = await getRes.text();
      return res.status(502).json({ error: `Không đọc được channels.json (HTTP ${getRes.status}): ${t.slice(0, 300)}` });
    }
    const file = await getRes.json();
    const sha = file.sha;
    const current = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));

    if (action === "listTabs") {
      return res.status(200).json({ ok: true, channels: current });
    }

    const tabKey = tab.trim();
    let commitMessage = "";

    if (action === "addTab") {
      if (current[tabKey]) {
        return res.status(409).json({ error: `Tab "${tabKey}" đã tồn tại rồi.` });
      }
      current[tabKey] = [channel.trim()];
      commitMessage = `chore: thêm tab "${tabKey}" qua web`;
    } else if (action === "removeTab") {
      if (!current[tabKey]) {
        return res.status(404).json({ error: `Không tìm thấy tab "${tabKey}".` });
      }
      delete current[tabKey];
      commitMessage = `chore: xoá tab "${tabKey}" qua web`;
    } else if (action === "addChannel") {
      if (!current[tabKey]) {
        return res.status(404).json({ error: `Không tìm thấy tab "${tabKey}".` });
      }
      const clean = channel.trim();
      if (current[tabKey].some((c) => c.toLowerCase() === clean.toLowerCase())) {
        return res.status(409).json({ error: "Kênh này đã có trong tab rồi." });
      }
      current[tabKey].push(clean);
      commitMessage = `chore: thêm kênh vào tab "${tabKey}" qua web`;
    } else if (action === "removeChannel") {
      if (!current[tabKey]) {
        return res.status(404).json({ error: `Không tìm thấy tab "${tabKey}".` });
      }
      const clean = channel.trim().toLowerCase();
      const before = current[tabKey].length;
      current[tabKey] = current[tabKey].filter((c) => c.toLowerCase() !== clean);
      if (current[tabKey].length === before) {
        return res.status(404).json({ error: "Không tìm thấy kênh này trong tab." });
      }
      commitMessage = `chore: xoá kênh khỏi tab "${tabKey}" qua web`;
    }

    // 2. Ghi channels.json mới lên GitHub.
    const newContent = Buffer.from(JSON.stringify(current, null, 2) + "\n", "utf-8").toString("base64");
    const putRes = await fetch(contentsUrl, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        content: newContent,
        sha,
        branch: ref,
      }),
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return res.status(502).json({ error: `Không ghi được channels.json (HTTP ${putRes.status}): ${t.slice(0, 300)}` });
    }

    return res.status(200).json({ ok: true, channels: current });
  } catch (err) {
    return res.status(500).json({ error: `Lỗi: ${err.message}` });
  }
};

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
