// ============================================================
// Tactics Map — app logic
// Roles: recon, squad_leader, platoon_leader, fob_designer, viewer
// ============================================================

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const ROLE_LABELS = {
  viewer: "Viewer",
  recon: "Recon",
  squad_leader: "Squad Leader",
  platoon_leader: "Platoon Leader",
  fob_designer: "FOB Designer",
};
const DRAW_ROLES = ["squad_leader", "platoon_leader", "fob_designer"];
const MAP_ROLES = ["recon", "platoon_leader"];
const PALETTE = ["#ff5252", "#4c8dff", "#3ddc84", "#ffd54f", "#ffffff", "#ff9800"];

let uid = null;
let myName = localStorage.getItem("tacticalName") || "";
let myRole = "viewer";
let currentColor = PALETTE[0];
let currentTool = "pen";
let strokesUnsub = null;
let usersUnsub = null;
let usersCache = [];
const ONLINE_THRESHOLD_MS = 45000;
const HEARTBEAT_MS = 20000;

// ---------- UI refs ----------
const el = (id) => document.getElementById(id);
const nameModal = el("nameModal");
const whoami = el("whoami");
const leaveRoleBtn = el("leaveRoleBtn");
const uploadSection = el("uploadSection");
const drawToolbar = el("drawToolbar");
const adminSection = el("adminSection");
const claimSection = el("claimSection");
const canvas = el("drawCanvas");
const ctx = canvas.getContext("2d");
const mapImage = el("mapImage");
const mapPlaceholder = el("mapPlaceholder");
const canvasWrap = el("canvasWrap");

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 3000);
}

// ---------- Auth / bootstrap ----------
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    auth.signInAnonymously().catch((e) => toast("Sign-in failed: " + e.message));
    return;
  }
  uid = user.uid;

  if (!myName) {
    nameModal.classList.remove("hidden");
  } else {
    await ensureUserDoc();
    startListeners();
  }
});

el("nameSubmit").onclick = async () => {
  const val = el("nameInput").value.trim();
  if (!val) return;
  myName = val;
  localStorage.setItem("tacticalName", myName);
  nameModal.classList.add("hidden");
  await ensureUserDoc();
  startListeners();
};

async function ensureUserDoc() {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      name: myName,
      role: "viewer",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } else if (snap.data().name !== myName) {
    await ref.update({ name: myName });
  }
}

function startHeartbeat() {
  const beat = () =>
    db.collection("users").doc(uid).update({
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
  beat();
  setInterval(beat, HEARTBEAT_MS);
}

function startListeners() {
  db.collection("users")
    .doc(uid)
    .onSnapshot((snap) => {
      if (!snap.exists) return;
      myRole = snap.data().role || "viewer";
      applyRoleUI();
    });

  startHeartbeat();

  usersUnsub = db.collection("users").onSnapshot((snap) => {
    usersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOnlineList();
    if (myRole === "platoon_leader") renderRoster();
  });
  setInterval(renderOnlineList, 15000); // re-check staleness even without new writes

  listenToMap();
  listenToStrokes();
}

function applyRoleUI() {
  whoami.textContent = `${myName} — ${ROLE_LABELS[myRole] || myRole}`;
  leaveRoleBtn.classList.toggle("hidden", myRole === "viewer");
  uploadSection.classList.toggle("hidden", !MAP_ROLES.includes(myRole));
  drawToolbar.classList.toggle("hidden", !DRAW_ROLES.includes(myRole));
  adminSection.classList.toggle("hidden", myRole !== "platoon_leader");
  claimSection.classList.toggle("hidden", myRole === "platoon_leader");

  if (myRole === "platoon_leader") renderRoster();
}

leaveRoleBtn.onclick = () => {
  if (!confirm(`Step down from ${ROLE_LABELS[myRole]} back to Viewer? Someone else will be able to take this role.`)) return;
  db.collection("users").doc(uid).update({ role: "viewer" })
    .catch((e) => toast("Could not leave role: " + e.message));
};

// ---------- Online Now (everyone sees this) ----------
function renderOnlineList() {
  const list = el("onlineList");
  const now = Date.now();
  const online = usersCache.filter((u) => {
    const ts = u.lastSeen && u.lastSeen.toMillis ? u.lastSeen.toMillis() : 0;
    return now - ts < ONLINE_THRESHOLD_MS;
  });
  online.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  list.innerHTML = "";
  if (online.length === 0) {
    list.innerHTML = '<div class="online-empty">No one else is here right now.</div>';
    return;
  }
  online.forEach((u) => {
    const row = document.createElement("div");
    row.className = "online-row";

    const dot = document.createElement("span");
    dot.className = "online-dot";
    row.appendChild(dot);

    const name = document.createElement("span");
    name.className = "online-name";
    name.textContent = (u.name || "(unnamed)") + (u.id === uid ? " (you)" : "");
    row.appendChild(name);

    const role = document.createElement("span");
    role.className = "online-role";
    role.textContent = ROLE_LABELS[u.role] || u.role;
    row.appendChild(role);

    list.appendChild(row);
  });
}

// ---------- Claim Platoon Leader ----------
el("claimBtn").onclick = async () => {
  const code = el("passcodeInput").value;
  if (!code) return;
  const ref = db.collection("users").doc(uid);
  try {
    await ref.set(
      { name: myName, role: "platoon_leader", passcode: code },
      { merge: true }
    );
    // Strip the passcode back out immediately — it should never sit in the doc.
    await ref.update({ passcode: firebase.firestore.FieldValue.delete() });
    toast("You are now Platoon Leader.");
    el("passcodeInput").value = "";
  } catch (e) {
    toast("Incorrect passcode.");
  }
};

// ---------- Roster (Platoon Leader only) ----------
function renderRoster() {
  const roster = el("roster");
  roster.innerHTML = "";
  usersCache.forEach((data) => {
    const row = document.createElement("div");
    row.className = "roster-row";

    const name = document.createElement("span");
    name.className = "rname";
    name.textContent = data.name || "(unnamed)";
    row.appendChild(name);

    const select = document.createElement("select");
    Object.keys(ROLE_LABELS).forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = ROLE_LABELS[r];
      if (r === data.role) opt.selected = true;
      select.appendChild(opt);
    });
    select.onchange = () => {
      db.collection("users").doc(data.id).update({ role: select.value })
        .catch((e) => toast("Could not update role: " + e.message));
    };
    row.appendChild(select);

    if (data.id !== uid) {
      const kickBtn = document.createElement("button");
      kickBtn.className = "kick-btn";
      kickBtn.textContent = "×";
      kickBtn.title = "Kick From Squad";
      kickBtn.onclick = () => {
        if (!confirm(`Kick ${data.name || "this person"} from the squad? They'll rejoin as a Viewer if they reopen the app.`)) return;
        db.collection("users").doc(data.id).delete()
          .catch((e) => toast("Could not kick: " + e.message));
      };
      row.appendChild(kickBtn);
    }

    roster.appendChild(row);
  });
}

// ---------- Map image ----------
function listenToMap() {
  db.collection("map").doc("current").onSnapshot((snap) => {
    if (snap.exists && snap.data().imageData) {
      mapImage.src = snap.data().imageData;
      mapImage.onload = () => {
        resizeCanvasToImage();
      };
      mapImage.classList.remove("hidden");
      mapPlaceholder.classList.add("hidden");
      el("mapStage").classList.remove("hidden");
      el("zoomControls").classList.remove("hidden");
    } else {
      mapImage.classList.add("hidden");
      el("mapStage").classList.add("hidden");
      el("zoomControls").classList.add("hidden");
      mapPlaceholder.classList.remove("hidden");
    }
  });
}

function resizeCanvasToImage() {
  const w = mapImage.naturalWidth || 1200;
  const h = mapImage.naturalHeight || 800;
  // The canvas's actual pixel buffer stays at the image's native resolution,
  // so drawing stays crisp — only its on-screen CSS size changes to fit the
  // window and zoom level. canvasPos() below already converts screen
  // coordinates into this buffer's coordinate space, so scaling the display
  // size doesn't break where strokes land.
  canvas.width = w;
  canvas.height = h;
  zoomLevel = 1; // fresh map load resets to "fit"
  applyStageSize();
  redrawAllStrokes();
}

// ---------- Zoom ----------
let zoomLevel = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;

function computeFitScale(w, h) {
  const availW = canvasWrap.clientWidth - 24;
  const availH = canvasWrap.clientHeight - 24;
  return Math.min(availW / w, availH / h) * 0.995;
}

function applyStageSize() {
  const w = mapImage.naturalWidth;
  const h = mapImage.naturalHeight;
  if (!w || !h) return;
  const scale = computeFitScale(w, h) * zoomLevel;
  const dispW = Math.floor(w * scale);
  const dispH = Math.floor(h * scale);
  const stage = el("mapStage");
  stage.style.width = dispW + "px";
  stage.style.height = dispH + "px";
  mapImage.style.width = dispW + "px";
  mapImage.style.height = dispH + "px";
  canvas.style.width = dispW + "px";
  canvas.style.height = dispH + "px";

  // Past "fit" size the stage no longer fits the container, so switch to a
  // scrollable/pannable view anchored top-left (centering an over-sized flex
  // child with overflow:auto can make part of it permanently unscrollable-to,
  // a known flexbox quirk — top-left anchoring avoids that).
  const zoomedIn = zoomLevel > 1.001;
  canvasWrap.style.overflow = zoomedIn ? "auto" : "hidden";
  canvasWrap.style.justifyContent = zoomedIn ? "flex-start" : "center";
  canvasWrap.style.alignItems = zoomedIn ? "flex-start" : "center";

  el("zoomLabel").textContent = Math.round(zoomLevel * 100) + "%";
}

function setZoom(newZoom) {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  applyStageSize();
}

el("zoomInBtn").onclick = () => setZoom(zoomLevel * 1.25);
el("zoomOutBtn").onclick = () => setZoom(zoomLevel / 1.25);
el("zoomResetBtn").onclick = () => setZoom(1);

// Ctrl+scroll (also how browsers report trackpad pinch-zoom) zooms;
// plain scroll/trackpad pans normally when zoomed in past fit.
canvasWrap.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    if (!mapImage.naturalWidth) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setZoom(zoomLevel * factor);
  },
  { passive: false }
);

const stageResizeObserver = new ResizeObserver(() => {
  if (mapImage.naturalWidth) applyStageSize();
});
stageResizeObserver.observe(canvasWrap);

el("mapUploadBtn").onclick = () => el("mapFileInput").click();
el("mapFileInput").onchange = (e) => {
  if (e.target.files[0]) uploadMapFile(e.target.files[0]);
};

// Paste-to-upload, anywhere on the page
window.addEventListener("paste", (e) => {
  if (!MAP_ROLES.includes(myRole)) return;
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) uploadMapFile(file);
      break;
    }
  }
});

// Firestore documents cap out at 1 MiB, so instead of a Storage bucket we
// compress the image down to fit and store it directly on the map document
// as a base64 data URL. This keeps the whole app on Firebase's free Spark
// plan — no billing account required anywhere.
const FIRESTORE_DOC_BUDGET = 900000; // bytes, leaving headroom under 1 MiB

async function uploadMapFile(file) {
  try {
    toast("Processing map image...");
    const dataUrl = await fitImageToBudget(file, FIRESTORE_DOC_BUDGET);
    await db.collection("map").doc("current").set({
      imageData: dataUrl,
      uploadedBy: myName,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("Map updated.");
  } catch (e) {
    toast("Upload failed: " + e.message);
  }
}

function fitImageToBudget(file, budgetBytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let maxDim = 2000;
        let quality = 0.85;

        const tryRender = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const c = document.createElement("canvas");
          c.width = width;
          c.height = height;
          c.getContext("2d").drawImage(img, 0, 0, width, height);
          const dataUrl = c.toDataURL("image/jpeg", quality);
          const approxBytes = dataUrl.length * 0.75; // base64 -> raw bytes, roughly

          if (approxBytes <= budgetBytes || (quality <= 0.35 && maxDim <= 800)) {
            resolve(dataUrl);
            return;
          }
          // Step down quality first, then resolution, and try again.
          if (quality > 0.35) {
            quality -= 0.1;
          } else {
            maxDim = Math.round(maxDim * 0.75);
            quality = 0.7;
          }
          tryRender();
        };
        tryRender();
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Drawing tools ----------
document.querySelectorAll(".toolBtn").forEach((btn) => {
  btn.onclick = () => {
    currentTool = btn.dataset.tool;
    document.querySelectorAll(".toolBtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  };
});
document.querySelector('.toolBtn[data-tool="pen"]').classList.add("active");

const colorRow = el("colorRow");
PALETTE.forEach((c, i) => {
  const sw = document.createElement("div");
  sw.className = "color-swatch" + (i === 0 ? " active" : "");
  sw.style.background = c;
  sw.onclick = () => {
    currentColor = c;
    document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
    sw.classList.add("active");
  };
  colorRow.appendChild(sw);
});

let drawing = false;
let currentPoints = [];

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function startDraw(e) {
  if (!DRAW_ROLES.includes(myRole)) return;
  if (currentTool === "text") return handleTextTool(e);
  if (currentTool === "eraser") return handleEraserClick(e);
  drawing = true;
  currentPoints = [canvasPos(e)];
}
function moveDraw(e) {
  if (!drawing) return;
  const p = canvasPos(e);
  currentPoints.push(p);
  redrawAllStrokes();
  drawLiveStroke();
}
async function endDraw() {
  if (!drawing) return;
  drawing = false;
  if (currentPoints.length < 2) {
    currentPoints = [];
    return;
  }
  const points = currentTool === "arrow"
    ? [currentPoints[0], currentPoints[currentPoints.length - 1]]
    : currentPoints;

  try {
    await db.collection("strokes").add({
      uid,
      author: myName,
      tool: currentTool,
      color: currentColor,
      points,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    toast("Could not save stroke: " + e.message);
  }
  currentPoints = [];
}

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", moveDraw);
window.addEventListener("mouseup", endDraw);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener("touchmove", (e) => { e.preventDefault(); moveDraw(e); }, { passive: false });
canvas.addEventListener("touchend", endDraw);

function handleTextTool(e) {
  const label = prompt("Label text:");
  if (!label) return;
  const p = canvasPos(e);
  db.collection("strokes").add({
    uid,
    author: myName,
    tool: "text",
    color: currentColor,
    text: label,
    points: [p],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch((e) => toast("Could not save label: " + e.message));
}

let allStrokes = [];
function handleEraserClick(e) {
  const p = canvasPos(e);
  const hit = allStrokes.find((s) => strokeContainsPoint(s, p));
  if (!hit) return;
  if (hit.uid !== uid && myRole !== "platoon_leader") {
    toast("You can only erase your own markings.");
    return;
  }
  db.collection("strokes").doc(hit.id).delete().catch((e) => toast(e.message));
}

function strokeContainsPoint(stroke, p) {
  const pts = stroke.points || [];
  const threshold = 14;
  for (let i = 0; i < pts.length; i++) {
    if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < threshold) return true;
    if (i > 0) {
      if (distToSegment(p, pts[i - 1], pts[i]) < threshold) return true;
    }
  }
  return false;
}
function distToSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

el("undoBtn").onclick = () => {
  const mine = allStrokes.filter((s) => s.uid === uid);
  if (mine.length === 0) return;
  const last = mine[mine.length - 1];
  db.collection("strokes").doc(last.id).delete().catch((e) => toast(e.message));
};

// ---------- Stroke sync + rendering ----------
function listenToStrokes() {
  if (strokesUnsub) strokesUnsub();
  strokesUnsub = db.collection("strokes").orderBy("createdAt").onSnapshot(
    (snap) => {
      allStrokes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      redrawAllStrokes();
    },
    (e) => toast("Sync error: " + e.message)
  );
}

function redrawAllStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  allStrokes.forEach(drawStroke);
}

function drawStroke(stroke) {
  const pts = stroke.points || [];
  if (pts.length === 0) return;
  ctx.strokeStyle = stroke.color || "#fff";
  ctx.fillStyle = stroke.color || "#fff";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (stroke.tool === "text") {
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(stroke.text || "", pts[0].x, pts[0].y);
    return;
  }

  if (stroke.tool === "arrow" && pts.length >= 2) {
    drawArrow(pts[0], pts[pts.length - 1]);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawLiveStroke() {
  // Draw the in-progress stroke (not yet saved) on top, for local feedback
  if (currentPoints.length < 2) return;
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (currentTool === "arrow") {
    drawArrow(currentPoints[0], currentPoints[currentPoints.length - 1]);
  } else {
    ctx.beginPath();
    ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
    for (let i = 1; i < currentPoints.length; i++) ctx.lineTo(currentPoints[i].x, currentPoints[i].y);
    ctx.stroke();
  }
}

function drawArrow(a, b) {
  const headLen = 16;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

// ---------- Clear map (Platoon Leader only) ----------
el("clearMapBtn").onclick = async () => {
  if (!confirm("Clear the map image and all markings for everyone? This cannot be undone.")) return;
  try {
    const snap = await db.collection("strokes").get();
    const batchSize = 400;
    let batch = db.batch();
    let count = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      count++;
      if (count % batchSize === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();
    await db.collection("map").doc("current").set({ imageData: null });
    toast("Map cleared.");
  } catch (e) {
    toast("Clear failed: " + e.message);
  }
};
