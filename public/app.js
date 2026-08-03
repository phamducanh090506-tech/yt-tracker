// public/app.js

let allVideos = [];
let filteredVideos = [];
let currentComments = [];
let sortField = "publishedAt";
let sortDir = "desc";
let commentSortField = "likeCount";
let commentSortDir = "desc";
let allChannelIds = [];
let selectedChannelIds = new Set(); // empty set = all channels selected
let currentList = "MyTab"; // which named channel list (tab) is active

const els = {
  tbody: document.getElementById("videoTableBody"),
  marketTabs: document.getElementById("marketTabs"),
  search: document.getElementById("searchInput"),
  sortField: document.getElementById("sortField"),
  sortDir: document.getElementById("sortDir"),
  dateRangeFilter: document.getElementById("dateRangeFilter"),
  channelFilterWrap: document.getElementById("channelFilterWrap"),
  channelFilterBtn: document.getElementById("channelFilterBtn"),
  channelFilterPanel: document.getElementById("channelFilterPanel"),
  channelFilterList: document.getElementById("channelFilterList"),
  channelFilterLabel: document.getElementById("channelFilterLabel"),
  selectAllChannels: document.getElementById("selectAllChannels"),
  clearAllChannels: document.getElementById("clearAllChannels"),
  metaViews1d: document.getElementById("metaViews1d"),
  metaViews7d: document.getElementById("metaViews7d"),
  metaTotalVph: document.getElementById("metaTotalVph"),
  metaChannels: document.getElementById("metaChannels"),
  metaVideos: document.getElementById("metaVideos"),
  metaUpdated: document.getElementById("metaUpdated"),
  fetchTriggerWrap: document.getElementById("fetchTriggerWrap"),
  fetchTriggerBtn: document.getElementById("fetchTriggerBtn"),
  fetchTriggerPanel: document.getElementById("fetchTriggerPanel"),
  fetchForceRefresh: document.getElementById("fetchForceRefresh"),
  fetchFullHistory: document.getElementById("fetchFullHistory"),
  fetchTriggerSubmit: document.getElementById("fetchTriggerSubmit"),
  fetchTriggerStatus: document.getElementById("fetchTriggerStatus"),
  manageChannelsWrap: document.getElementById("manageChannelsWrap"),
  manageChannelsBtn: document.getElementById("manageChannelsBtn"),
  manageChannelsPanel: document.getElementById("manageChannelsPanel"),
  manageChannelsStatus: document.getElementById("manageChannelsStatus"),
  mcTabSelect: document.getElementById("mcTabSelect"),
  mcChannelInput: document.getElementById("mcChannelInput"),
  mcAddChannelBtn: document.getElementById("mcAddChannelBtn"),
  mcNewTabName: document.getElementById("mcNewTabName"),
  mcNewTabChannel: document.getElementById("mcNewTabChannel"),
  mcAddTabBtn: document.getElementById("mcAddTabBtn"),
  mcChannelList: document.getElementById("mcChannelList"),
  mcRenameTabInput: document.getElementById("mcRenameTabInput"),
  mcRenameTabBtn: document.getElementById("mcRenameTabBtn"),
  mcDeleteTabBtn: document.getElementById("mcDeleteTabBtn"),
  modalOverlay: document.getElementById("modalOverlay"),
  modalClose: document.getElementById("modalClose"),
  channelModalOverlay: document.getElementById("channelModalOverlay"),
  channelModalClose: document.getElementById("channelModalClose"),
  channelModalAvatar: document.getElementById("channelModalAvatar"),
  channelModalName: document.getElementById("channelModalName"),
  channelModalSub: document.getElementById("channelModalSub"),
  channelModalGrid: document.getElementById("channelModalGrid"),
  channelModalRevenue: document.getElementById("channelModalRevenue"),
  channelRpmMin: document.getElementById("channelRpmMin"),
  channelRpmMax: document.getElementById("channelRpmMax"),
  modalThumb: document.getElementById("modalThumb"),
  modalTitle: document.getElementById("modalTitle"),
  modalChannel: document.getElementById("modalChannel"),
  modalStats: document.getElementById("modalStats"),
  commentsList: document.getElementById("commentsList"),
  commentSortField: document.getElementById("commentSortField"),
  commentSortDir: document.getElementById("commentSortDir"),
};

function fmtNumber(n) {
  if (n === null || n === undefined) return "–";
  return new Intl.NumberFormat("vi-VN").format(n);
}

// viewsPerHourSource is "recent" (real delta vs. last fetch - reliable velocity)
// or "lifetime" (fallback average since publish - only happens for videos we're
// seeing for the first time, no previous data point to diff against yet).
function fmtViewsPerHour(v) {
  if (v.viewsPerHour === null || v.viewsPerHour === undefined) return "–";
  const num = fmtNumber(v.viewsPerHour);
  if (v.viewsPerHourSource === "lifetime") {
    return `${num} <span class="vph-badge" title="Chưa có dữ liệu lần fetch trước - đây là trung bình cả đời video, không phải tốc độ gần đây">~</span>`;
  }
  return num;
}

function fmtDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function parseDurationToSeconds(iso) {
  if (!iso) return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + min * 60 + s;
}

function fmtDuration(iso) {
  const total = parseDurationToSeconds(iso);
  if (!total) return "–";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function loadData() {
  els.tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><span class="loading-plane">✈️</span> Đang tải dữ liệu...</td></tr>`;
  try {
    const [videosRes, metaRes] = await Promise.all([
      fetch(`data/videos-${currentList}.json`, { cache: "no-store" }),
      fetch(`data/meta-${currentList}.json`, { cache: "no-store" }),
    ]);
    allVideos = videosRes.ok ? await videosRes.json() : [];
    const meta = metaRes.ok ? await metaRes.json() : null;

    populateChannelFilter();
    if (meta) {
      els.metaChannels.textContent = meta.channelCount ?? "–";
      els.metaVideos.textContent = meta.videoCount ?? allVideos.length;
      els.metaUpdated.textContent = meta.lastUpdated ? fmtDateTime(meta.lastUpdated) : "–";
    } else {
      els.metaVideos.textContent = allVideos.length;
    }
    // Tổng view 1/7 ngày = tổng lượt xem (hiện tại) của các video ĐĂNG trong
    // khoảng thời gian đó - không phải tốc độ tăng view.
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    let views1d = 0;
    let views7d = 0;
    for (const v of allVideos) {
      if (!v.publishedAt) continue;
      const ageMs = now - new Date(v.publishedAt).getTime();
      if (ageMs <= 7 * DAY_MS) views7d += v.viewCount || 0;
      if (ageMs <= DAY_MS) views1d += v.viewCount || 0;
    }
    els.metaViews1d.textContent = fmtNumber(views1d);
    els.metaViews7d.textContent = fmtNumber(views7d);
    // Tổng VPH của cả tab - tính trên toàn bộ video của danh sách đang chọn,
    // không bị ảnh hưởng bởi tìm kiếm/lọc kênh hiện tại.
    const totalVph = allVideos.reduce((sum, v) => sum + (v.viewsPerHour || 0), 0);
    els.metaTotalVph.textContent = fmtNumber(totalVph);
    applyFilters();
  } catch (err) {
    els.tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Không tải được dữ liệu. Hãy chắc chắn GitHub Action đã chạy ít nhất 1 lần và public/data/videos-${currentList}.json tồn tại.</td></tr>`;
    els.metaTotalVph.textContent = "–";
    els.metaViews1d.textContent = "–";
    els.metaViews7d.textContent = "–";
    console.error(err);
  }
}

function switchList(listName) {
  if (listName === currentList) return;
  currentList = listName;
  els.marketTabs.querySelectorAll(".market-tab").forEach((btn) => {
    const isActive = btn.dataset.list === currentList;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
  els.search.value = "";
  els.dateRangeFilter.value = "0";
  loadData();
}

// Tab được tạo tự động từ public/data/tabs.json - thêm/xoá tab trong
// channels.json (kể cả qua bảng "Quản lý kênh") là đủ, không cần sửa HTML.
async function loadTabs() {
  try {
    const res = await fetch("data/tabs.json", { cache: "no-store" });
    const tabs = res.ok ? await res.json() : [];
    renderTabs(tabs.length ? tabs : [currentList]);
  } catch (err) {
    console.error("Không tải được danh sách tab:", err);
    renderTabs([currentList]);
  }
}

function renderTabs(tabs) {
  if (!tabs.includes(currentList)) currentList = tabs[0];
  els.marketTabs.innerHTML = tabs
    .map(
      (t) =>
        `<button type="button" class="market-tab${t === currentList ? " active" : ""}" data-list="${escapeAttr(t)}" role="tab" aria-selected="${t === currentList}">${escapeHtml(t)}</button>`
    )
    .join("");
  els.marketTabs.querySelectorAll(".market-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchList(btn.dataset.list));
  });
  populateManageTabSelect(tabs);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function populateChannelFilter() {
  const channels = new Map();
  for (const v of allVideos) {
    if (!channels.has(v.channelId)) {
      channels.set(v.channelId, { title: v.channelTitle, thumbnail: v.channelThumbnail || "" });
    }
  }
  const sorted = [...channels.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title));
  allChannelIds = sorted.map(([id]) => id);
  // Empty selection means "all channels" - start with nothing checked = show everything.
  selectedChannelIds = new Set();

  els.channelFilterList.innerHTML = sorted
    .map(
      ([id, info]) => `
    <div class="channel-filter__item" data-id="${id}">
      <input type="checkbox" value="${id}" />
      <a class="channel-filter__link" href="https://www.youtube.com/channel/${id}" target="_blank" rel="noopener" title="Mở kênh trên YouTube">
        <img class="channel-filter__avatar" src="${info.thumbnail}" alt="" loading="lazy" />
        <span>${escapeHtml(info.title)}</span>
      </a>
    </div>`
    )
    .join("");

  els.channelFilterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedChannelIds.add(cb.value);
      else selectedChannelIds.delete(cb.value);
      updateChannelFilterLabel();
      applyFilters();
    });
  });

  // Clicking anywhere on the row still toggles the filter checkbox, except
  // when the click is on the avatar/name link, which navigates to YouTube instead.
  els.channelFilterList.querySelectorAll(".channel-filter__item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".channel-filter__link")) return;
      if (e.target.tagName === "INPUT") return;
      const cb = item.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
  });

  updateChannelFilterLabel();
}

function updateChannelFilterLabel() {
  if (selectedChannelIds.size === 0 || selectedChannelIds.size === allChannelIds.length) {
    els.channelFilterLabel.textContent = "Tất cả kênh";
  } else if (selectedChannelIds.size === 1) {
    const id = [...selectedChannelIds][0];
    const cb = els.channelFilterList.querySelector(`input[value="${id}"]`);
    els.channelFilterLabel.textContent = cb ? cb.parentElement.querySelector("span").textContent : "1 kênh";
  } else {
    els.channelFilterLabel.textContent = `${selectedChannelIds.size} kênh đã chọn`;
  }
}

function toggleChannelPanel(forceOpen) {
  const isOpen = els.channelFilterWrap.classList.contains("open");
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
  els.channelFilterWrap.classList.toggle("open", shouldOpen);
}

els.channelFilterBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleChannelPanel();
});

document.addEventListener("click", (e) => {
  if (!els.channelFilterWrap.contains(e.target)) toggleChannelPanel(false);
  if (!els.fetchTriggerWrap.contains(e.target)) toggleFetchPanel(false);
  if (!els.manageChannelsWrap.contains(e.target)) toggleManagePanel(false);
});

function toggleFetchPanel(forceOpen) {
  const isOpen = els.fetchTriggerWrap.classList.contains("open");
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
  els.fetchTriggerWrap.classList.toggle("open", shouldOpen);
  if (shouldOpen) setFetchStatus("");
}

els.fetchTriggerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleFetchPanel();
});

function setFetchStatus(message, kind) {
  els.fetchTriggerStatus.textContent = message;
  els.fetchTriggerStatus.classList.toggle("visible", Boolean(message));
  els.fetchTriggerStatus.classList.remove("fetch-trigger__status--ok", "fetch-trigger__status--error");
  if (kind) els.fetchTriggerStatus.classList.add(`fetch-trigger__status--${kind}`);
}

async function submitFetchTrigger() {
  els.fetchTriggerSubmit.disabled = true;
  setFetchStatus("Đang gửi yêu cầu...", "");

  try {
    const res = await fetch("/api/trigger-fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        forceRefreshComments: els.fetchForceRefresh.checked,
        fullChannelHistory: els.fetchFullHistory.checked,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      setFetchStatus(
        "Đã kích hoạt! Quá trình lấy dữ liệu chạy nền vài phút, tải lại trang sau đó để xem kết quả mới.",
        "ok"
      );
    } else {
      setFetchStatus(data.error || "Có lỗi xảy ra, thử lại sau.", "error");
    }
  } catch (err) {
    setFetchStatus("Không kết nối được tới server.", "error");
  } finally {
    els.fetchTriggerSubmit.disabled = false;
  }
}

els.fetchTriggerSubmit.addEventListener("click", submitFetchTrigger);

// ===== Quản lý kênh (thêm/xoá kênh, thêm/xoá tab) =====

let mcTabsCache = {}; // { tabName: [channel, ...] }

function toggleManagePanel(forceOpen) {
  const isOpen = els.manageChannelsWrap.classList.contains("open");
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
  els.manageChannelsWrap.classList.toggle("open", shouldOpen);
  if (shouldOpen) {
    setManageStatus("");
    loadManageTabs();
  }
}

els.manageChannelsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleManagePanel();
});

function setManageStatus(message, kind) {
  els.manageChannelsStatus.textContent = message;
  els.manageChannelsStatus.classList.toggle("visible", Boolean(message));
  els.manageChannelsStatus.classList.remove("fetch-trigger__status--ok", "fetch-trigger__status--error");
  if (kind) els.manageChannelsStatus.classList.add(`fetch-trigger__status--${kind}`);
}

function populateManageTabSelect(tabs) {
  const prevValue = els.mcTabSelect.value;
  els.mcTabSelect.innerHTML = tabs.map((t) => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join("");
  if (tabs.includes(prevValue)) els.mcTabSelect.value = prevValue;
}

async function loadManageTabs() {
  try {
    const res = await fetch("/api/manage-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listTabs" }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.channels) {
      mcTabsCache = data.channels;
      populateManageTabSelect(Object.keys(mcTabsCache));
      renderManageChannelList();
    }
  } catch (err) {
    // Im lặng - danh sách kênh vẫn dùng được từ cache trước đó (nếu có).
  }
}

function renderManageChannelList() {
  const tab = els.mcTabSelect.value;
  const list = mcTabsCache[tab] || [];
  if (!list.length) {
    els.mcChannelList.innerHTML = `<div class="manage-channels__empty">Chưa có kênh nào trong tab này.</div>`;
    return;
  }
  els.mcChannelList.innerHTML = list
    .map(
      (c) =>
        `<div class="manage-channels__item">
          <span class="manage-channels__item-text">${escapeHtml(c)}</span>
          <button type="button" class="manage-channels__remove" data-channel="${escapeAttr(c)}" title="Xoá kênh này">✕</button>
        </div>`
    )
    .join("");
  els.mcChannelList.querySelectorAll(".manage-channels__remove").forEach((btn) => {
    btn.addEventListener("click", () => removeChannel(tab, btn.dataset.channel));
  });
}

els.mcTabSelect.addEventListener("change", renderManageChannelList);

async function callManageChannels(payload, busyBtn) {
  if (busyBtn) busyBtn.disabled = true;
  setManageStatus("Đang xử lý...", "");
  try {
    const res = await fetch("/api/manage-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setManageStatus("Xong! Dữ liệu sẽ tự cập nhật trong vài phút.", "ok");
      await loadManageTabs();
      await loadTabs();
      return true;
    }
    setManageStatus(data.error || "Có lỗi xảy ra, thử lại sau.", "error");
    return false;
  } catch (err) {
    setManageStatus("Không kết nối được tới server.", "error");
    return false;
  } finally {
    if (busyBtn) busyBtn.disabled = false;
  }
}

els.mcAddChannelBtn.addEventListener("click", async () => {
  const tab = els.mcTabSelect.value;
  const channel = els.mcChannelInput.value.trim();
  if (!tab) return setManageStatus("Chưa có tab nào - tạo tab mới trước đã.", "error");
  if (!channel) return setManageStatus("Dán link/handle kênh trước đã.", "error");
  const ok = await callManageChannels({ action: "addChannel", tab, channel }, els.mcAddChannelBtn);
  if (ok) els.mcChannelInput.value = "";
});

els.mcAddTabBtn.addEventListener("click", async () => {
  const tab = els.mcNewTabName.value.trim();
  const channel = els.mcNewTabChannel.value.trim();
  if (!tab) return setManageStatus("Nhập tên tab mới trước đã.", "error");
  if (!channel) return setManageStatus("Dán link/handle kênh đầu tiên trước đã.", "error");
  const ok = await callManageChannels({ action: "addTab", tab, channel }, els.mcAddTabBtn);
  if (ok) {
    els.mcNewTabName.value = "";
    els.mcNewTabChannel.value = "";
    els.mcTabSelect.value = tab;
    renderManageChannelList();
  }
});

els.mcRenameTabBtn.addEventListener("click", async () => {
  const tab = els.mcTabSelect.value;
  const newTabName = els.mcRenameTabInput.value.trim();
  if (!tab) return setManageStatus("Chưa có tab nào để đổi tên.", "error");
  if (!newTabName) return setManageStatus("Nhập tên mới cho tab trước đã.", "error");
  const wasCurrent = tab === currentList;
  const ok = await callManageChannels({ action: "renameTab", tab, newTab: newTabName }, els.mcRenameTabBtn);
  if (ok) {
    els.mcRenameTabInput.value = "";
    els.mcTabSelect.value = newTabName;
    renderManageChannelList();
    if (wasCurrent) {
      currentList = newTabName;
      els.marketTabs.querySelectorAll(".market-tab").forEach((btn) => {
        const isActive = btn.dataset.list === currentList;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", String(isActive));
      });
      loadData();
    }
  }
});

els.mcDeleteTabBtn.addEventListener("click", async () => {
  const tab = els.mcTabSelect.value;
  if (!tab) return setManageStatus("Chưa có tab nào để xoá.", "error");
  if (Object.keys(mcTabsCache).length <= 1) {
    return setManageStatus("Không thể xoá tab cuối cùng - cần ít nhất 1 tab.", "error");
  }
  if (!confirm(`Xoá toàn bộ tab "${tab}" và danh sách kênh trong đó? Không thể hoàn tác.`)) return;
  const wasCurrent = tab === currentList;
  const ok = await callManageChannels({ action: "removeTab", tab }, els.mcDeleteTabBtn);
  // Nếu vừa xoá đúng tab đang xem, loadTabs() bên trong callManageChannels đã
  // tự chuyển currentList sang tab đầu tiên còn lại - chỉ cần tải lại dữ liệu.
  if (ok && wasCurrent) loadData();
});

async function removeChannel(tab, channel) {
  if (!confirm(`Xoá kênh này khỏi tab "${tab}"?\n${channel}`)) return;
  await callManageChannels({ action: "removeChannel", tab, channel });
}

els.selectAllChannels.addEventListener("click", () => {
  selectedChannelIds = new Set(allChannelIds);
  els.channelFilterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
  updateChannelFilterLabel();
  applyFilters();
});

els.clearAllChannels.addEventListener("click", () => {
  selectedChannelIds = new Set();
  els.channelFilterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  updateChannelFilterLabel();
  applyFilters();
});

function applyFilters() {
  const q = els.search.value.trim().toLowerCase();
  const filterActive = selectedChannelIds.size > 0 && selectedChannelIds.size < allChannelIds.length;
  const months = parseInt(els.dateRangeFilter.value, 10);
  const dateCutoff = months > 0 ? Date.now() - months * 30 * 24 * 60 * 60 * 1000 : null;

  filteredVideos = allVideos.filter((v) => {
    if (filterActive && !selectedChannelIds.has(v.channelId)) return false;
    if (dateCutoff !== null && new Date(v.publishedAt).getTime() < dateCutoff) return false;
    if (!q) return true;
    return (
      v.title.toLowerCase().includes(q) ||
      v.channelTitle.toLowerCase().includes(q)
    );
  });

  sortVideos();
  renderTable();
}

function sortVideos() {
  const dir = sortDir === "asc" ? 1 : -1;
  filteredVideos.sort((a, b) => {
    let av = a[sortField];
    let bv = b[sortField];
    if (sortField === "publishedAt") {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    } else if (sortField === "duration") {
      av = parseDurationToSeconds(av);
      bv = parseDurationToSeconds(bv);
    } else {
      av = av ?? -1;
      bv = bv ?? -1;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function renderTable() {
  document.querySelectorAll(".board-table thead th[data-field]").forEach((th) => {
    th.classList.toggle("active-sort", th.dataset.field === sortField);
  });

  if (!filteredVideos.length) {
    els.tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Không có video phù hợp.</td></tr>`;
    return;
  }

  els.tbody.innerHTML = filteredVideos
    .map(
      (v) => `
    <tr>
      <td>
        <div class="video-cell">
          <a class="video-cell__thumb-link" href="https://www.youtube.com/watch?v=${v.videoId}" target="_blank" rel="noopener" title="Mở video trên YouTube">
            <img src="${v.thumbnail}" alt="" loading="lazy" />
          </a>
          <div class="video-cell__info">
            <div class="video-cell__title">${escapeHtml(v.title)}</div>
            <button class="comments-btn" data-video-id="${v.videoId}">💬 Xem bình luận</button>
          </div>
        </div>
      </td>
      <td class="channel-cell" data-channel-id="${v.channelId}">
        <img class="channel-cell__avatar" src="${v.channelThumbnail}" alt="" loading="lazy" />
        <span>${escapeHtml(v.channelTitle)}</span>
      </td>
      <td class="col-num">${fmtDate(v.publishedAt)}</td>
      <td class="col-num">${fmtDuration(v.duration)}</td>
      <td class="col-num">${fmtNumber(v.viewCount)}</td>
      <td class="col-num">${fmtViewsPerHour(v)}</td>
      <td class="col-num">${fmtNumber(v.likeCount)}</td>
      <td class="col-num">${fmtNumber(v.commentCount)}</td>
      <td class="col-num">${fmtNumber(v.subscriberCount)}</td>
    </tr>`
    )
    .join("");

  els.tbody.querySelectorAll(".comments-btn").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.videoId));
  });

  els.tbody.querySelectorAll(".channel-cell").forEach((cell) => {
    cell.addEventListener("click", () => openChannelModal(cell.dataset.channelId));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Modal & comments ----------

async function openModal(videoId) {
  const video = allVideos.find((v) => v.videoId === videoId);
  if (!video) return;

  els.modalOverlay.classList.add("open");
  els.modalThumb.src = video.thumbnail;
  els.modalTitle.textContent = video.title;
  els.modalChannel.textContent = video.channelTitle;
  els.modalStats.innerHTML = `
    <span>${fmtNumber(video.viewCount)} lượt xem</span>
    <span>${fmtNumber(video.likeCount)} thích</span>
    <span>${fmtNumber(video.commentCount)} bình luận</span>
    <span>${fmtDate(video.publishedAt)}</span>
  `;
  els.commentsList.innerHTML = `<div class="empty-state"><span class="loading-plane">✈️</span> Đang tải bình luận...</div>`;

  try {
    const res = await fetch(`data/comments/${videoId}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("no comments file");
    const data = await res.json();
    if (data.disabled) {
      currentComments = [];
      els.commentsList.innerHTML = `<div class="empty-state">Video này đã tắt bình luận.</div>`;
      return;
    }
    currentComments = data.comments || [];
    renderComments();
  } catch (err) {
    currentComments = [];
    els.commentsList.innerHTML = `<div class="empty-state">Chưa có dữ liệu bình luận cho video này.</div>`;
  }
}

function renderComments() {
  if (!currentComments.length) {
    els.commentsList.innerHTML = `<div class="empty-state">Không có bình luận.</div>`;
    return;
  }

  const dir = commentSortDir === "asc" ? 1 : -1;
  const sorted = [...currentComments].sort((a, b) => {
    let av = a[commentSortField];
    let bv = b[commentSortField];
    if (commentSortField === "publishedAt") {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  els.commentsList.innerHTML = sorted
    .map((c, i) => {
      const replies = c.replies || [];
      const replyCount = c.replyCount || replies.length;
      return `
    <div class="comment" data-idx="${i}">
      <div class="comment__head">
        <img class="comment__avatar" src="${c.authorImage}" alt="" loading="lazy" />
        <span class="comment__author">${escapeHtml(c.author)}</span>
        <span class="comment__date">${fmtDate(c.publishedAt)}</span>
      </div>
      <div class="comment__text">${escapeHtml(c.text)}</div>
      <div class="comment__footer">
        <span class="comment__likes">♥ ${fmtNumber(c.likeCount)} lượt thích</span>
        <button class="translate-btn" data-idx="${i}" data-kind="comment">Dịch sang Tiếng Việt</button>
        ${
          replyCount > 0
            ? `<button class="replies-toggle-btn" data-idx="${i}" data-count="${replyCount}">💬 Xem ${fmtNumber(replyCount)} trả lời</button>`
            : ""
        }
      </div>
      <div class="comment__translation" id="translation-${i}"></div>
      ${
        replyCount > 0
          ? `<div class="comment__replies" id="replies-${i}">${renderReplies(replies, i)}</div>`
          : ""
      }
    </div>`;
    })
    .join("");

  els.commentsList.querySelectorAll(".translate-btn[data-kind='comment']").forEach((btn) => {
    btn.addEventListener("click", () => translateComment(sorted, btn.dataset.idx));
  });

  els.commentsList.querySelectorAll(".translate-btn[data-kind='reply']").forEach((btn) => {
    const [ci, ri] = btn.dataset.idx.split(":");
    btn.addEventListener("click", () => translateReply(sorted[ci].replies, ci, ri));
  });

  els.commentsList.querySelectorAll(".replies-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleReplies(btn));
  });
}

function renderReplies(replies, commentIdx) {
  if (!replies.length) {
    return `<div class="reply reply--empty">Chưa có dữ liệu nội dung trả lời cho bình luận này.</div>`;
  }
  return replies
    .map(
      (r, ri) => `
    <div class="reply">
      <div class="reply__head">
        <img class="reply__avatar" src="${r.authorImage}" alt="" loading="lazy" />
        <span class="reply__author">${escapeHtml(r.author)}</span>
        <span class="reply__date">${fmtDate(r.publishedAt)}</span>
      </div>
      <div class="reply__text">${escapeHtml(r.text)}</div>
      <div class="reply__footer">
        <span class="reply__likes">♥ ${fmtNumber(r.likeCount)} lượt thích</span>
        <button class="translate-btn translate-btn--small" data-idx="${commentIdx}:${ri}" data-kind="reply">Dịch sang Tiếng Việt</button>
      </div>
      <div class="comment__translation" id="translation-reply-${commentIdx}-${ri}"></div>
    </div>`
    )
    .join("");
}

function toggleReplies(btn) {
  const idx = btn.dataset.idx;
  const count = btn.dataset.count;
  const box = document.getElementById(`replies-${idx}`);
  if (!box) return;
  const isOpen = box.classList.toggle("open");
  btn.textContent = isOpen ? "Ẩn trả lời" : `💬 Xem ${count} trả lời`;
}

async function translateComment(sortedList, idx) {
  const comment = sortedList[idx];
  const box = document.getElementById(`translation-${idx}`);
  box.classList.add("visible");
  box.textContent = "Đang dịch...";

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(
      comment.text
    )}`;
    const res = await fetch(url);
    const json = await res.json();
    const translated = json[0].map((chunk) => chunk[0]).join("");
    box.textContent = translated;
  } catch (err) {
    box.innerHTML = `Không dịch được tự động. <a href="https://translate.google.com/?sl=auto&tl=vi&text=${encodeURIComponent(
      comment.text
    )}&op=translate" target="_blank" rel="noopener">Mở Google Dịch</a>`;
  }
}

async function translateReply(replies, commentIdx, replyIdx) {
  const reply = replies[replyIdx];
  const box = document.getElementById(`translation-reply-${commentIdx}-${replyIdx}`);
  box.classList.add("visible");
  box.textContent = "Đang dịch...";

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(
      reply.text
    )}`;
    const res = await fetch(url);
    const json = await res.json();
    const translated = json[0].map((chunk) => chunk[0]).join("");
    box.textContent = translated;
  } catch (err) {
    box.innerHTML = `Không dịch được tự động. <a href="https://translate.google.com/?sl=auto&tl=vi&text=${encodeURIComponent(
      reply.text
    )}&op=translate" target="_blank" rel="noopener">Mở Google Dịch</a>`;
  }
}

// ---------- Channel stats modal ----------

let currentChannelId = null;

function openChannelModal(channelId) {
  currentChannelId = channelId;
  renderChannelModal();
  els.channelModalOverlay.classList.add("open");
}

function closeChannelModal() {
  els.channelModalOverlay.classList.remove("open");
}

function renderChannelModal() {
  const videos = allVideos.filter((v) => v.channelId === currentChannelId);
  if (!videos.length) return;
  const c = videos[0];

  els.channelModalAvatar.src = c.channelThumbnail;
  els.channelModalName.textContent = c.channelTitle;
  els.channelModalName.href = `https://www.youtube.com/channel/${c.channelId}`;
  els.channelModalSub.textContent = `${fmtNumber(c.subscriberCount)} subscribers`;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const totalViews = videos.reduce((s, v) => s + (v.viewCount || 0), 0);
  const totalComments = videos.reduce((s, v) => s + (v.commentCount || 0), 0);
  const views7d = videos
    .filter((v) => now - new Date(v.publishedAt).getTime() <= 7 * day)
    .reduce((s, v) => s + (v.viewCount || 0), 0);
  const views30d = videos
    .filter((v) => now - new Date(v.publishedAt).getTime() <= 30 * day)
    .reduce((s, v) => s + (v.viewCount || 0), 0);

  const dates = videos.map((v) => new Date(v.publishedAt).getTime()).sort((a, b) => a - b);
  const spanDays = Math.max(1, (dates[dates.length - 1] - dates[0]) / day);
  const videosPerWeek = (videos.length / spanDays) * 7;
  const latestPublished = new Date(dates[dates.length - 1]);

  const statCards = [
    ["Subscribers", fmtNumber(c.subscriberCount)],
    ["Tổng view kênh (all-time)", c.channelViewCount ? fmtNumber(c.channelViewCount) : "–"],
    ["Tổng số video kênh", c.channelVideoCount ? fmtNumber(c.channelVideoCount) : "–"],
    ["Video đang theo dõi", fmtNumber(videos.length)],
    ["View trung bình / video", fmtNumber(Math.round(totalViews / videos.length))],
    ["Bình luận trung bình / video", fmtNumber(Math.round(totalComments / videos.length))],
    ["Tần suất đăng bài", `~${videosPerWeek.toFixed(1)} video/tuần`],
    ["Video mới nhất", fmtDate(latestPublished.toISOString())],
    ["View 7 ngày qua*", fmtNumber(views7d)],
    ["View 30 ngày qua*", fmtNumber(views30d)],
  ];

  els.channelModalGrid.innerHTML = statCards
    .map(
      ([label, value]) => `
    <div class="channel-stat">
      <div class="channel-stat__label">${label}</div>
      <div class="channel-stat__value">${value}</div>
    </div>`
    )
    .join("");

  renderChannelRevenue(views7d, views30d);
}

function renderChannelRevenue(views7d, views30d) {
  let rpmMin = parseFloat(els.channelRpmMin.value) || 0;
  let rpmMax = parseFloat(els.channelRpmMax.value) || 0;
  if (rpmMin > rpmMax) [rpmMin, rpmMax] = [rpmMax, rpmMin];

  const fmtMoney = (n) => `$${n.toFixed(2)}`;
  const range = (views) => {
    const lo = (views * rpmMin) / 1000;
    const hi = (views * rpmMax) / 1000;
    return rpmMin === rpmMax ? fmtMoney(lo) : `${fmtMoney(lo)} – ${fmtMoney(hi)}`;
  };

  const cards = [
    ["Ước tính 7 ngày qua*", range(views7d)],
    ["Ước tính 30 ngày qua*", range(views30d)],
  ];

  els.channelModalRevenue.innerHTML = cards
    .map(
      ([label, value]) => `
    <div class="channel-stat channel-stat--money">
      <div class="channel-stat__label">${label}</div>
      <div class="channel-stat__value">${value}</div>
    </div>`
    )
    .join("");
}

function closeModal() {
  els.modalOverlay.classList.remove("open");
}

// ---------- Events ----------

els.search.addEventListener("input", applyFilters);
els.dateRangeFilter.addEventListener("change", applyFilters);

els.sortField.addEventListener("change", () => {
  sortField = els.sortField.value;
  applyFilters();
});

els.sortDir.addEventListener("click", () => {
  sortDir = sortDir === "asc" ? "desc" : "asc";
  els.sortDir.dataset.dir = sortDir;
  els.sortDir.querySelector(".dir-btn__arrow").textContent = sortDir === "asc" ? "↑" : "↓";
  els.sortDir.lastChild.textContent = sortDir === "asc" ? " Tăng dần" : " Giảm dần";
  applyFilters();
});

document.querySelectorAll(".board-table thead th[data-field]").forEach((th) => {
  th.addEventListener("click", () => {
    const field = th.dataset.field;
    els.sortField.value = field;
    sortField = field;
    applyFilters();
  });
});

els.commentSortField.addEventListener("change", () => {
  commentSortField = els.commentSortField.value;
  renderComments();
});

els.commentSortDir.addEventListener("click", () => {
  commentSortDir = commentSortDir === "asc" ? "desc" : "asc";
  els.commentSortDir.dataset.dir = commentSortDir;
  els.commentSortDir.querySelector(".dir-btn__arrow").textContent = commentSortDir === "asc" ? "↑" : "↓";
  renderComments();
});

els.modalClose.addEventListener("click", closeModal);
els.modalOverlay.addEventListener("click", (e) => {
  if (e.target === els.modalOverlay) closeModal();
});
els.channelModalClose.addEventListener("click", closeChannelModal);
els.channelModalOverlay.addEventListener("click", (e) => {
  if (e.target === els.channelModalOverlay) closeChannelModal();
});
els.channelRpmMin.addEventListener("input", () => {
  if (currentChannelId) renderChannelModal();
});
els.channelRpmMax.addEventListener("input", () => {
  if (currentChannelId) renderChannelModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    closeChannelModal();
  }
});

loadTabs().then(loadData);

// ---------- AI chat (Gemini) - client-side only, user supplies their own API key ----------
// This block is fully additive and does not touch any of the Fetch-trigger
// or table/filter code above.

(function setupAIChat() {
  const KEY_STORAGE = "gemini_api_key";
  const CHATS_STORAGE = "yt_tracker_ai_chats_v1";
  const ACTIVE_CHAT_STORAGE = "yt_tracker_ai_active_chat_v1";

  const fab = document.getElementById("aiChatBtn");
  const panel = document.getElementById("aiChatPanel");
  const closeBtn = document.getElementById("aiChatClose");
  const expandBtn = document.getElementById("aiChatExpandBtn");
  const resetKeyBtn = document.getElementById("aiChatResetKey");
  const newChatBtn = document.getElementById("aiChatNewBtn");
  const historyBtn = document.getElementById("aiChatHistoryBtn");
  const historyPanel = document.getElementById("aiChatHistoryPanel");
  const historyEmpty = document.getElementById("aiChatHistoryEmpty");
  const historyList = document.getElementById("aiChatHistoryList");
  const messagesEl = document.getElementById("aiChatMessages");
  const input = document.getElementById("aiChatInput");
  const sendBtn = document.getElementById("aiChatSend");
  const dataModeToggle = document.getElementById("aiDataModeToggle");
  const dataModeCount = document.getElementById("aiDataModeCount");

  if (!fab || !panel) return;

  const getApiKey = () => localStorage.getItem(KEY_STORAGE) || "";
  const setApiKey = (key) => localStorage.setItem(KEY_STORAGE, key);
  const clearApiKey = () => localStorage.removeItem(KEY_STORAGE);

  // ---------- Chat persistence (all conversations saved in this browser) ----------

  function loadAllChats() {
    try {
      const raw = localStorage.getItem(CHATS_STORAGE);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveAllChats(chats) {
    try {
      localStorage.setItem(CHATS_STORAGE, JSON.stringify(chats));
    } catch {
      // Storage full or unavailable (private browsing etc.) - fail silently,
      // the chat still works for the current session, just won't persist.
    }
  }

  function makeChatId() {
    return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function createChatRecord() {
    const now = Date.now();
    return { id: makeChatId(), title: "Đoạn chat mới", createdAt: now, updatedAt: now, history: [], messages: [] };
  }

  let allChats = loadAllChats();
  let activeChatId = localStorage.getItem(ACTIVE_CHAT_STORAGE) || "";
  let activeChat = allChats.find((c) => c.id === activeChatId) || null;

  // Mirrors activeChat.history, kept as a separate variable so the rest of
  // the send/receive logic below (unchanged) keeps working exactly as before.
  let conversationHistory = activeChat ? activeChat.history : [];

  function persistActiveChat() {
    if (!activeChat) return;
    activeChat.updatedAt = Date.now();
    const idx = allChats.findIndex((c) => c.id === activeChat.id);
    if (idx === -1) allChats.unshift(activeChat);
    else allChats[idx] = activeChat;
    saveAllChats(allChats);
    localStorage.setItem(ACTIVE_CHAT_STORAGE, activeChat.id);
  }

  function ensureActiveChat() {
    if (activeChat) return activeChat;
    activeChat = createChatRecord();
    conversationHistory = activeChat.history;
    return activeChat;
  }

  function loadChatIntoView(chat) {
    activeChat = chat;
    conversationHistory = chat.history;
    messagesEl.innerHTML = "";
    for (const m of chat.messages) appendMessage(m.text, m.who, false);
    localStorage.setItem(ACTIVE_CHAT_STORAGE, chat.id);
  }

  function startNewChat() {
    activeChat = createChatRecord();
    conversationHistory = activeChat.history;
    messagesEl.innerHTML = "";
    persistActiveChat();
    renderHistoryList();
    input.focus();
  }

  function deleteChat(id, evt) {
    if (evt) evt.stopPropagation();
    allChats = allChats.filter((c) => c.id !== id);
    saveAllChats(allChats);
    if (activeChat && activeChat.id === id) {
      startNewChat();
    }
    renderHistoryList();
  }

  function fmtChatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function renderHistoryList() {
    const sorted = [...allChats].sort((a, b) => b.updatedAt - a.updatedAt);
    historyEmpty.classList.toggle("hidden", sorted.length > 0);
    historyList.innerHTML = sorted
      .map(
        (c) => `
      <div class="ai-chat-history__item ${activeChat && c.id === activeChat.id ? "active" : ""}" data-chat-id="${c.id}">
        <div class="ai-chat-history__item-main">
          <div class="ai-chat-history__item-title">${escapeHtml(c.title || "Đoạn chat mới")}</div>
          <div class="ai-chat-history__item-date">${fmtChatDate(c.updatedAt)}</div>
        </div>
        <button class="ai-chat-history__item-delete" data-delete-id="${c.id}" title="Xoá">✕</button>
      </div>`
      )
      .join("");

    historyList.querySelectorAll(".ai-chat-history__item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".ai-chat-history__item-delete")) return;
        const chat = allChats.find((c) => c.id === el.dataset.chatId);
        if (chat) {
          loadChatIntoView(chat);
          toggleHistoryPanel(false);
        }
      });
    });
    historyList.querySelectorAll(".ai-chat-history__item-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => deleteChat(btn.dataset.deleteId, e));
    });
  }

  function toggleHistoryPanel(forceOpen) {
    const isOpen = historyPanel.classList.contains("open");
    const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
    if (shouldOpen) renderHistoryList();
    historyPanel.classList.toggle("open", shouldOpen);
  }

  newChatBtn.addEventListener("click", startNewChat);
  historyBtn.addEventListener("click", () => toggleHistoryPanel());

  function appendMessage(text, who, persist = true) {
    const div = document.createElement("div");
    div.className = `ai-msg ai-msg--${who}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (persist && activeChat) {
      activeChat.messages.push({ text, who });
      div.dataset.msgIndex = activeChat.messages.length - 1;
      persistActiveChat();
    }
    return div;
  }

  // Updates a message bubble's final text (e.g. replacing "Đang trả lời..."
  // with the real answer) and, if that bubble was persisted, patches the
  // saved copy too so reloading history shows the real answer, not the
  // transient "thinking..." placeholder.
  function updateMessage(div, newText) {
    div.textContent = newText;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (activeChat && div.dataset.msgIndex !== undefined) {
      const idx = Number(div.dataset.msgIndex);
      if (activeChat.messages[idx]) {
        activeChat.messages[idx].text = newText;
        persistActiveChat();
      }
    }
  }

  function promptForApiKey() {
    input.placeholder = "Dán API key Gemini vào đây rồi bấm gửi...";
    input.dataset.mode = "apikey";
  }

  // Uses whatever is currently displayed on the table (respecting the
  // search box, channel filter, and date-range filter that already exist),
  // not the entire dataset.
  function currentFilteredList() {
    return typeof filteredVideos !== "undefined" && filteredVideos.length
      ? filteredVideos
      : typeof allVideos !== "undefined"
      ? allVideos
      : [];
  }

  function updateDataModeCount() {
    dataModeCount.textContent = currentFilteredList().length;
  }

  function openPanel() {
    panel.classList.add("open");
    ensureActiveChat();
    if (!getApiKey()) promptForApiKey();
    updateDataModeCount();
    setTimeout(() => input.focus(), 50);
  }
  const EXPANDED_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
  const COLLAPSED_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3v4a2 2 0 0 1-2 2H3M15 3v4a2 2 0 0 0 2 2h4M9 21v-4a2 2 0 0 0-2-2H3M15 21v-4a2 2 0 0 1 2-2h4"/></svg>`;

  function setExpanded(expanded) {
    panel.classList.toggle("expanded", expanded);
    if (expandBtn) {
      expandBtn.innerHTML = expanded ? COLLAPSED_ICON : EXPANDED_ICON;
      expandBtn.title = expanded ? "Thu nhỏ" : "Phóng to";
    }
  }
  if (expandBtn) {
    expandBtn.addEventListener("click", () => setExpanded(!panel.classList.contains("expanded")));
  }

  function closePanel() {
    panel.classList.remove("open");
    toggleHistoryPanel(false);
  }

  // Backdrop-click-to-close only makes sense in expanded mode - the mini
  // dock has no backdrop to click since the box fills the whole panel.
  panel.addEventListener("click", (e) => {
    if (panel.classList.contains("expanded") && e.target === panel) closePanel();
  });

  // Restore whatever conversation was last active in this browser, if any,
  // so re-opening the panel shows it without waiting for the user to click.
  if (activeChat) {
    for (const m of activeChat.messages) appendMessage(m.text, m.who, false);
  }

  fab.addEventListener("click", openPanel);
  closeBtn.addEventListener("click", closePanel);
  resetKeyBtn.addEventListener("click", () => {
    clearApiKey();
    appendMessage("Đã xoá API key cũ.", "bot");
    promptForApiKey();
    input.focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });
  dataModeToggle.addEventListener("change", updateDataModeCount);

  function buildFullVideoList(list) {
    return list
      .map((v) => {
        const title = v.title.length > 55 ? v.title.slice(0, 55) + "…" : v.title;
        const date = v.publishedAt ? v.publishedAt.slice(0, 10) : "?";
        return `${date} | ${v.channelTitle} | "${title}" | ${fmtNumber(v.viewCount)} views | ${fmtNumber(
          v.likeCount
        )} likes | ${fmtNumber(v.commentCount)} comments`;
      })
      .join("\n");
  }

  function buildChannelSummary(list) {
    const map = new Map();
    for (const v of list) {
      if (!map.has(v.channelId)) {
        map.set(v.channelId, {
          title: v.channelTitle,
          subscriberCount: v.subscriberCount,
          videoCount: 0,
          totalViews: 0,
          totalLikes: 0,
          totalComments: 0,
        });
      }
      const c = map.get(v.channelId);
      c.videoCount += 1;
      c.totalViews += v.viewCount || 0;
      c.totalLikes += v.likeCount || 0;
      c.totalComments += v.commentCount || 0;
    }
    return [...map.values()]
      .map(
        (c) =>
          `- ${c.title}: ${c.videoCount} video, tổng ${fmtNumber(c.totalViews)} views, ${fmtNumber(
            c.totalLikes
          )} likes, ${fmtNumber(c.totalComments)} bình luận, ${
            c.subscriberCount != null ? fmtNumber(c.subscriberCount) : "?"
          } sub`
      )
      .join("\n");
  }

  // Pulls every comment for every video in the given (already filtered) list.
  async function gatherCommentContext(list, onProgress) {
    let done = 0;
    const parts = await Promise.all(
      list.map(async (v) => {
        let commentsText = "";
        try {
          const res = await fetch(`data/comments/${v.videoId}.json`, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (!data.disabled && data.comments?.length) {
              commentsText = data.comments.map((c) => `- ${c.text}`).join("\n");
            }
          }
        } catch {
          // no comments file for this video, skip silently
        } finally {
          done += 1;
          if (onProgress) onProgress(done, list.length);
        }
        if (!commentsText) return "";
        return `Video: "${v.title}" (Kênh: ${v.channelTitle}, ${fmtNumber(v.viewCount)} views)\nBình luận:\n${commentsText}`;
      })
    );
    return parts.filter(Boolean).join("\n\n---\n\n");
  }

  // Google regularly retires Gemini model names (1.5 and 2.0-flash are both
  // already shut down as of mid-2026). Try a short list of currently-known
  // working names in order, falling back to the next one on a 404, instead
  // of hardcoding a single model that can silently break again later.
  const MODEL_CANDIDATES = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];

  async function callGemini(apiKey, contents) {
    let lastError = null;

    for (const model of MODEL_CANDIDATES) {
      let res, data;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
            apiKey
          )}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents }),
          }
        );
        data = await res.json().catch(() => null);
      } catch (networkErr) {
        lastError = new Error("Không kết nối được tới Gemini API. Kiểm tra lại mạng.");
        continue;
      }

      if (res.ok) {
        const blockReason = data?.promptFeedback?.blockReason;
        if (blockReason) {
          throw new Error(`Gemini từ chối trả lời (lý do: ${blockReason}). Thử diễn đạt lại câu hỏi.`);
        }
        return (
          data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
          "Gemini không trả về nội dung nào."
        );
      }

      // Model not found/not supported - try the next candidate. Any other
      // error (bad key, quota, etc.) should surface immediately instead of
      // silently trying more models.
      const isModelNotFound = res.status === 404 || /not found|not supported/i.test(data?.error?.message || "");
      if (!isModelNotFound) {
        throw new Error(
          `Lỗi từ Gemini (${res.status}): ${data?.error?.message || "không rõ nguyên nhân"}. Kiểm tra lại API key hoặc thử lại sau.`
        );
      }
      lastError = new Error(
        `Model "${model}" không còn khả dụng (${data?.error?.message || res.status}).`
      );
    }

    throw new Error(
      (lastError?.message ? lastError.message + " " : "") +
        "Không có model Gemini nào trong danh sách còn hoạt động - Google có thể đã đổi tên model, thử lại sau hoặc báo để cập nhật danh sách model."
    );
  }

  async function handleAISend() {
    const text = input.value.trim();
    if (!text) return;

    if (input.dataset.mode === "apikey") {
      setApiKey(text);
      input.value = "";
      input.dataset.mode = "";
      input.placeholder = "Việt Nam - khán giả đang bình luận gì?";
      appendMessage("Đã lưu API key trên trình duyệt này. Giờ anh hỏi được rồi!", "bot");
      return;
    }

    ensureActiveChat();
    appendMessage(text, "user");
    input.value = "";

    const apiKey = getApiKey();
    if (!apiKey) {
      promptForApiKey();
      return;
    }

    const dataModeOn = dataModeToggle.checked;
    const thinkingEl = appendMessage(dataModeOn ? "Đang tải dữ liệu..." : "Đang trả lời...", "bot");
    sendBtn.disabled = true;

    try {
      let messageForGemini = text;

      if (dataModeOn) {
        const list = currentFilteredList();
        const channelSummary = buildChannelSummary(list);
        const videoList = buildFullVideoList(list);
        const commentContext = await gatherCommentContext(list, (done, total) => {
          thinkingEl.textContent = `Đang tải bình luận... (${done}/${total} video)`;
        });
        thinkingEl.textContent = "Đang phân tích...";

        messageForGemini = `Dưới đây là dữ liệu của đúng các video đang được hiển thị/lọc trên bảng lúc này (${list.length} video, theo bộ lọc/tìm kiếm hiện tại của người dùng trên app). Hãy dùng dữ liệu này để trả lời câu hỏi bên dưới nếu liên quan; nếu câu hỏi không liên quan tới dữ liệu, trả lời bình thường.

=== TỔNG HỢP THEO KÊNH (trong phạm vi đang lọc) ===
${channelSummary || "(không có video nào trong phạm vi đang lọc)"}

=== DANH SÁCH VIDEO ĐANG LỌC (ngày | kênh | tiêu đề | views | likes | comments) ===
${videoList || "(trống)"}

=== BÌNH LUẬN CỦA CÁC VIDEO ĐANG LỌC ===
${commentContext || "(không có dữ liệu bình luận)"}

CÂU HỎI: ${text}`;
      }

      const contents = [
        ...conversationHistory,
        { role: "user", parts: [{ text: messageForGemini }] },
      ];

      const answer = await callGemini(apiKey, contents);
      updateMessage(thinkingEl, answer);

      conversationHistory.push({ role: "user", parts: [{ text }] });
      conversationHistory.push({ role: "model", parts: [{ text: answer }] });
      if (conversationHistory.length > 20) {
        conversationHistory.splice(0, conversationHistory.length - 20);
      }
      if (activeChat) {
        activeChat.history = conversationHistory;
        if (!activeChat.title || activeChat.title === "Đoạn chat mới") {
          activeChat.title = text.length > 42 ? text.slice(0, 42) + "…" : text;
        }
        persistActiveChat();
        renderHistoryList();
      }
    } catch (err) {
      updateMessage(thinkingEl, err.message || "Không gọi được Gemini API. Kiểm tra lại kết nối mạng hoặc API key.");
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", handleAISend);
})();
