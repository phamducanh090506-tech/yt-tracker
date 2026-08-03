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
  const { action, tab, channel, newTab } = body;

  // "channel" có thể là 1 link/@handle, hoặc nhiều dòng/nhiều link cách nhau
  // bằng dấu phẩy (khi người dùng dán nhiều kênh cùng lúc vào ô textarea).
  const channelList =
    typeof channel === "string"
      ? channel
          .split(/[\n,]+/)
          .map((c) => c.trim())
          .filter(Boolean)
      : [];

  if (!["addChannel", "removeChannel", "addTab", "removeTab", "renameTab", "listTabs"].includes(action)) {
    return res.status(400).json({ error: "Thiếu hoặc sai 'action'." });
  }
  if (action !== "listTabs" && (!tab || typeof tab !== "string" || !tab.trim())) {
    return res.status(400).json({ error: "Thiếu tên tab." });
  }
  if ((action === "addChannel" || action === "addTab") && channelList.length === 0) {
    return res.status(400).json({ error: "Thiếu link/handle kênh." });
  }
  if (action === "renameTab" && (!newTab || typeof newTab !== "string" || !newTab.trim())) {
    return res.status(400).json({ error: "Thiếu tên tab mới." });
  }
  // Tên tab được dùng thẳng trong tên file (videos-<tab>.json) nên không được
  // chứa dấu / hoặc \ - tránh vô tình tạo nhầm đường dẫn thư mục.
  if (action === "addTab" && /[\\/]/.test(tab)) {
    return res.status(400).json({ error: "Tên tab không được chứa dấu / hoặc \\." });
  }
  if (action === "renameTab" && /[\\/]/.test(newTab)) {
    return res.status(400).json({ error: "Tên tab mới không được chứa dấu / hoặc \\." });
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
    let current = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));

    if (action === "listTabs") {
      return res.status(200).json({ ok: true, channels: current });
    }

    const tabKey = tab.trim();
    let commitMessage = "";

    if (action === "addTab") {
      if (current[tabKey]) {
        return res.status(409).json({ error: `Tab "${tabKey}" đã tồn tại rồi.` });
      }
      // Loại trùng lặp trong chính danh sách vừa dán vào.
      const deduped = [];
      for (const c of channelList) {
        if (!deduped.some((d) => d.toLowerCase() === c.toLowerCase())) deduped.push(c);
      }
      current[tabKey] = deduped;
      commitMessage = `chore: thêm tab "${tabKey}" (${deduped.length} kênh) qua web`;
    } else if (action === "removeTab") {
      if (!current[tabKey]) {
        return res.status(404).json({ error: `Không tìm thấy tab "${tabKey}".` });
      }
      delete current[tabKey];
      commitMessage = `chore: xoá tab "${tabKey}" qua web`;
    } else if (action === "renameTab") {
      if (!current[tabKey]) {
        return res.status(404).json({ error: `Không tìm thấy tab "${tabKey}".` });
      }
      const newKey = newTab.trim();
      if (newKey.toLowerCase() === tabKey.toLowerCase()) {
        return res.status(400).json({ error: "Tên tab mới trùng với tên hiện tại." });
      }
      if (current[newKey]) {
        return res.status(409).json({ error: `Tab "${newKey}" đã tồn tại rồi.` });
      }
      // Dựng lại object để giữ đúng thứ tự tab, chỉ đổi key của tab đang sửa.
      const rebuilt = {};
      for (const [k, v] of Object.entries(current)) {
        rebuilt[k === tabKey ? newKey : k] = v;
      }
      current = rebuilt;
      commitMessage = `chore: đổi tên tab "${tabKey}" thành "${newKey}" qua web`;
    } else if (action === "addChannel") {
      if (!current[tabKey]) {
        return res.status(404).json({ error: `Không tìm thấy tab "${tabKey}".` });
      }
      const existingLower = current[tabKey].map((c) => c.toLowerCase());
      const toAdd = [];
      for (const c of channelList) {
        if (existingLower.includes(c.toLowerCase())) continue; // đã có trong tab, bỏ qua
        if (toAdd.some((d) => d.toLowerCase() === c.toLowerCase())) continue; // trùng trong chính danh sách vừa dán
        toAdd.push(c);
      }
      if (toAdd.length === 0) {
        return res.status(409).json({ error: "Kênh (hoặc tất cả các kênh) này đã có trong tab rồi." });
      }
      current[tabKey].push(...toAdd);
      commitMessage =
        toAdd.length === 1
          ? `chore: thêm kênh vào tab "${tabKey}" qua web`
          : `chore: thêm ${toAdd.length} kênh vào tab "${tabKey}" qua web`;
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

    // 3. Best-effort: giữ lại dữ liệu cũ khi đổi tên tab (đổi tên luôn file
    // videos-<tab>.json / meta-<tab>.json), hoặc dọn dẹp khi xoá tab. Nếu file
    // chưa tồn tại (tab mới, chưa fetch lần nào) thì bỏ qua, không tính là lỗi.
    if (action === "renameTab") {
      const newKey = newTab.trim();
      await renameDataFile(`videos-${tabKey}.json`, `videos-${newKey}.json`, ghHeaders, owner, repo, ref);
      await renameDataFile(`meta-${tabKey}.json`, `meta-${newKey}.json`, ghHeaders, owner, repo, ref);
    } else if (action === "removeTab") {
      await deleteDataFile(`videos-${tabKey}.json`, ghHeaders, owner, repo, ref);
      await deleteDataFile(`meta-${tabKey}.json`, ghHeaders, owner, repo, ref);
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

// Đọc 1 file trong public/data/, ghi nó sang đường dẫn mới, rồi xoá file cũ.
// Im lặng bỏ qua nếu file cũ không tồn tại (chưa fetch lần nào) hoặc có lỗi -
// đây chỉ là tiện ích giữ dữ liệu, không phải bước bắt buộc để đổi tên tab.
async function renameDataFile(oldName, newName, ghHeaders, owner, repo, ref) {
  try {
    const base = `https://api.github.com/repos/${owner}/${repo}/contents/public/data`;
    const getRes = await fetch(`${base}/${oldName}?ref=${ref}`, { headers: ghHeaders });
    if (!getRes.ok) return; // không có file cũ, không sao cả
    const file = await getRes.json();

    await fetch(`${base}/${newName}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: đổi tên ${oldName} thành ${newName} qua web`,
        content: file.content,
        branch: ref,
      }),
    });

    await fetch(`${base}/${oldName}`, {
      method: "DELETE",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: xoá ${oldName} (đã đổi tên) qua web`,
        sha: file.sha,
        branch: ref,
      }),
    });
  } catch {
    // Bỏ qua - dữ liệu sẽ tự tạo lại đúng tên mới ở lần fetch tiếp theo.
  }
}

async function deleteDataFile(name, ghHeaders, owner, repo, ref) {
  try {
    const base = `https://api.github.com/repos/${owner}/${repo}/contents/public/data`;
    const getRes = await fetch(`${base}/${name}?ref=${ref}`, { headers: ghHeaders });
    if (!getRes.ok) return;
    const file = await getRes.json();
    await fetch(`${base}/${name}`, {
      method: "DELETE",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: xoá ${name} (tab đã bị xoá) qua web`,
        sha: file.sha,
        branch: ref,
      }),
    });
  } catch {
    // Bỏ qua - không nghiêm trọng, chỉ là rác dữ liệu không dùng tới nữa.
  }
}
