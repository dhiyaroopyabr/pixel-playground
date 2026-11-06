// THEME: Replace these colors and nouns after the theme roulette.
const THEME = {
  background: "#0b1426", grid: "#1b2a43", player: "#70edcf",
  collectible: "#ffdc76", hazard: "#ff778e", echo: "#c1a5ff", collectiblePlural: "sparks"
};

// RULES: Speeds are in Canvas pixels per second.
const RULES = {
  playerSpeed: 270, hazardSpeed: 115, speedPerLevel: 22,
  maxHazardSpeed: 235, pointsPerLevel: 5, maxHazards: 8,
  pointsPerEcho: 5, echoHistory: 5, echoWarning: 1
};

const canvas = document.querySelector("#arena");
const ctx = canvas.getContext("2d");
const { width, height } = canvas;
const overlay = document.querySelector("#overlay");
const action = document.querySelector("#action");
const scoreLabel = document.querySelector("#score");
const levelLabel = document.querySelector("#level");
const bestLabel = document.querySelector("#best");
const echoLabel = document.querySelector("#echo-count");
const echoNotice = document.querySelector("#echo-notice");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const panelDetail = document.querySelector("#panel-detail");
const panelTitle = document.querySelector("#panel-title");
const status = document.querySelector("#status");
const controls = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"];
const keys = new Set();
const touches = new Map();
const storageKey = "pixel-playground-best";

let state = "ready";
let player, collectible, hazards, score, level;
let echoes, movementHistory, roundTime, pendingEchoes, lastEchoSpawn;
let best = 0;
let lastTime;

try {
  best = Number(localStorage.getItem(storageKey)) || 0;
} catch {
  // The best score still works for this page if storage is disabled.
}

function resetRound() {
  player = { x: width / 2, y: height / 2, size: 26 };
  echoes = [];
  roundTime = 0;
  movementHistory = [{ x: player.x, y: player.y, time: roundTime }];
  pendingEchoes = 0;
  lastEchoSpawn = -Infinity;
  echoNotice.textContent = "";
  hazards = [];
  collectible = undefined;
  score = 0;
  level = 1;
  addHazard();
  addHazard();
  placeCollectible();
  updateHud();
}

function updateHud() {
  scoreLabel.textContent = score;
  levelLabel.textContent = level;
  bestLabel.textContent = best;
  echoLabel.textContent = echoes.length;
}

function startRound() {
  clearInput();
  resetRound();
  state = "playing";
  lastTime = undefined;
  overlay.hidden = true;
  canvas.focus();
}

function endRound(title) {
  state = "over";
  clearInput();
  status.textContent = "RUN COMPLETE";
  panelTitle.textContent = title;
  echoNotice.textContent = "";
  panelDetail.textContent = `Score ${score} · Level ${level} · Best ${best}`;
  action.textContent = "Play again";
  overlay.hidden = false;
  action.focus();
}

// All positions describe the center of an object.
function overlaps(a, b, gap = 0) {
  const reach = (a.size + b.size) / 2 + gap;
  return Math.abs(a.x - b.x) < reach && Math.abs(a.y - b.y) < reach;
}

function openSpot(size, blockers, gap) {
  // Scan a grid so placement always finishes, even when the arena gets busy.
  const spots = [];
  for (let y = 24; y <= height - 24; y += 28) {
    for (let x = 24; x <= width - 24; x += 28) {
      const spot = { x, y, size };
      if (blockers.every(blocker => !overlaps(spot, blocker, gap))) spots.push(spot);
    }
  }
  return spots[Math.floor(Math.random() * spots.length)];
}

function addHazard() {
  const blockers = collectible ? [player, collectible, ...hazards] : [player, ...hazards];
  const spot = openSpot(28, blockers, 50) ?? openSpot(28, blockers, 0);
  if (!spot) return;
  const angle = Math.random() * Math.PI * 2;
  hazards.push({ ...spot, dx: Math.cos(angle), dy: Math.sin(angle) });
}

function placeCollectible() {
  const blockers = [player, ...hazards];
  collectible = openSpot(22, blockers, 20) ?? openSpot(22, blockers);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function movePlayer(dt) {
  const held = key => keys.has(key) || [...touches.values()].includes(key);
  const dx = Number(held("arrowright") || held("d")) - Number(held("arrowleft") || held("a"));
  const dy = Number(held("arrowdown") || held("s")) - Number(held("arrowup") || held("w"));
  // Normalize so moving diagonally is just as fast.
  const distance = RULES.playerSpeed * dt / (Math.hypot(dx, dy) || 1);
  const edge = player.size / 2;
  player.x = clamp(player.x + dx * distance, edge, width - edge);
  player.y = clamp(player.y + dy * distance, edge, height - edge);
}

function moveHazards(dt) {
  const speed = Math.min(RULES.maxHazardSpeed, RULES.hazardSpeed + (level - 1) * RULES.speedPerLevel);
  for (const hazard of hazards) {
    const edge = hazard.size / 2;
    hazard.x += hazard.dx * speed * dt;
    hazard.y += hazard.dy * speed * dt;
    if (hazard.x < edge || hazard.x > width - edge) hazard.dx *= -1;
    if (hazard.y < edge || hazard.y > height - edge) hazard.dy *= -1;
    hazard.x = clamp(hazard.x, edge, width - edge);
    hazard.y = clamp(hazard.y, edge, height - edge);
  }
}

function positionAt(from, to, time) {
  const fraction = (time - from.time) / (to.time - from.time);
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    time
  };
}

function recordMovement(dt) {
  if (dt <= 0) return;
  roundTime += dt;
  movementHistory.push({ x: player.x, y: player.y, time: roundTime });
  const cutoff = roundTime - RULES.echoHistory;
  while (movementHistory[1].time <= cutoff) movementHistory.shift();
  // Keep one exact boundary sample even when the cutoff falls between frames.
  if (movementHistory[0].time < cutoff) {
    movementHistory[0] = positionAt(movementHistory[0], movementHistory[1], cutoff);
  }
}

function spawnEchoes() {
  // Keep early milestones pending until a full five-second path is available.
  if (!pendingEchoes || roundTime < RULES.echoHistory) return;
  const path = movementHistory.slice();
  for (; pendingEchoes > 0; pendingEchoes -= 1) {
    echoes.push({
      x: path[0].x, y: path[0].y, size: player.size,
      path, segment: 0, spawnedAt: roundTime, dangerous: false
    });
  }
  lastEchoSpawn = roundTime;
  echoNotice.textContent = "ECHO DETECTED!";
  echoLabel.textContent = echoes.length;
}

function moveEchoes() {
  for (let i = echoes.length - 1; i >= 0; i -= 1) {
    const echo = echoes[i];
    const elapsed = roundTime - echo.spawnedAt - RULES.echoWarning;
    if (elapsed < 0) continue;
    if (elapsed >= RULES.echoHistory) {
      echoes.splice(i, 1);
      echoLabel.textContent = echoes.length;
      continue;
    }
    echo.dangerous = true;
    const time = echo.path[0].time + elapsed;
    while (echo.segment < echo.path.length - 2 && echo.path[echo.segment + 1].time <= time) {
      echo.segment += 1;
    }
    const position = positionAt(echo.path[echo.segment], echo.path[echo.segment + 1], time);
    echo.x = position.x;
    echo.y = position.y;
  }
}

function update(dt) {
  movePlayer(dt);
  recordMovement(dt);
  moveHazards(dt);
  moveEchoes();
  if (echoNotice.textContent && roundTime - lastEchoSpawn >= 1.5) {
    echoNotice.textContent = "";
  }
  if (hazards.some(hazard => overlaps(player, hazard))) {
    endRound("Drone collision!");
    return;
  }
  if (echoes.some(echo => echo.dangerous && overlaps(player, echo))) {
    endRound("Echo collision!");
    return;
  }
  if (collectible && overlaps(player, collectible)) {
    score += 1;
    if (score > best) {
      best = score;
      try {
        localStorage.setItem(storageKey, best);
      } catch {
        // Keep the in-memory score.
      }
    }
    if (score % RULES.pointsPerLevel === 0) {
      level += 1;
      if (hazards.length < RULES.maxHazards) addHazard();
    }
    if (score % RULES.pointsPerEcho === 0) pendingEchoes += 1;
    placeCollectible();
    updateHud();
  }
  spawnEchoes();
}

function drawSquare(object, color) {
  ctx.fillStyle = color;
  const half = object.size / 2;
  ctx.fillRect(object.x - half, object.y - half, object.size, object.size);
}

function drawAvatar(object, color) {
  drawSquare(object, color);
  ctx.fillStyle = THEME.background;
  ctx.fillRect(object.x - 7, object.y - 4, 4, 5);
  ctx.fillRect(object.x + 3, object.y - 4, 4, 5);
}

function drawEcho(echo) {
  ctx.save();
  ctx.strokeStyle = THEME.echo;
  ctx.shadowColor = THEME.echo;
  ctx.shadowBlur = 9;
  if (echo.dangerous) {
    const trailStart = echo.path[0].time + roundTime - echo.spawnedAt - RULES.echoWarning - 0.3;
    let start = echo.segment;
    while (start > 0 && echo.path[start - 1].time >= trailStart) start -= 1;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(echo.path[start].x, echo.path[start].y);
    for (let i = start + 1; i <= echo.segment; i += 1) {
      ctx.lineTo(echo.path[i].x, echo.path[i].y);
    }
    ctx.lineTo(echo.x, echo.y);
    ctx.stroke();
  }
  ctx.globalAlpha = echo.dangerous ? 0.55 : 0.28;
  drawAvatar(echo, THEME.echo);
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  const half = echo.size / 2;
  ctx.strokeRect(echo.x - half, echo.y - half, echo.size, echo.size);
  if (!echo.dangerous) {
    const remaining = RULES.echoWarning - (roundTime - echo.spawnedAt);
    ctx.beginPath();
    ctx.arc(echo.x, echo.y, half + 8, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * remaining / RULES.echoWarning);
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = THEME.grid;
  for (let x = 0; x < width; x += 24) ctx.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += 24) ctx.fillRect(0, y, width, 1);

  if (collectible) {
    ctx.save();
    ctx.translate(collectible.x, collectible.y);
    ctx.rotate(Math.PI / 4);
    drawSquare({ x: 0, y: 0, size: collectible.size / Math.SQRT2 }, THEME.collectible);
    ctx.restore();
  }
  for (const hazard of hazards) {
    drawSquare(hazard, THEME.hazard);
    ctx.fillStyle = THEME.background;
    ctx.font = "bold 22px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("×", hazard.x, hazard.y + 1);
  }
  for (const echo of echoes) drawEcho(echo);
  drawAvatar(player, THEME.player);
  const flashAge = roundTime - lastEchoSpawn;
  if (state === "playing" && flashAge < 0.22 && !reducedMotion.matches) {
    ctx.save();
    ctx.globalAlpha = 0.17 * (1 - flashAge / 0.22);
    ctx.fillStyle = THEME.echo;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

function frame(time) {
  // Cap the step after interruptions to avoid jumping across the arena.
  const dt = lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, 0.033);
  lastTime = time;
  if (state === "playing" && !document.hidden) update(dt);
  draw();
  requestAnimationFrame(frame);
}

function clearInput() {
  keys.clear();
  touches.clear();
}

action.addEventListener("click", startRound);
window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (state !== "playing" || !controls.includes(key) ||
      event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  keys.add(key);
});
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", clearInput);
for (const button of document.querySelectorAll("[data-key]")) {
  button.addEventListener("pointerdown", event => {
    if (state !== "playing") return;
    button.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, button.dataset.key);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(name, event => touches.delete(event.pointerId));
  }
}

panelDetail.textContent = `Grab ${RULES.pointsPerLevel} ${THEME.collectiblePlural} to level up. Dodge the Echo when its warning ring runs out.`;
resetRound();
requestAnimationFrame(frame);
