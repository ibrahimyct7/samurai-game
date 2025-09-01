// Endless Rooftops — GitHub-ready vanilla JS game
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Handle resize (keep internal resolution constant for pixel-perfect collisions)
  function fitCanvas() {
    const aspect = canvas.width / canvas.height;
    const w = window.innerWidth, h = window.innerHeight;
    const scale = Math.min(w / canvas.width, h / canvas.height);
    canvas.style.width = (canvas.width * scale) + "px";
    canvas.style.height = (canvas.height * scale) + "px";
  }
  addEventListener("resize", fitCanvas);
  fitCanvas();

  // Assets
  const assets = {};
  const loadImage = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });

  // Input
  const keys = { left:false, right:false, jump:false };
  const pressed = new Set();
  const down = (e) => { pressed.add(e.code); if (e.code === "Space") e.preventDefault(); };
  const up = (e) => { pressed.delete(e.code); };
  addEventListener("keydown", down, {passive:false});
  addEventListener("keyup", up);

  function isDown(code){ return pressed.has(code); }

  // World constants
  const G = 2200;           // gravity px/s^2
  const AIR_ACCEL = 2400;   // horizontal control in air
  const GROUND_ACCEL = 6000;
  const MAX_SPD_X = 380;
  const MAX_SPD_Y = 1600;
  const JUMP_CHARGE_RATE = 2.2; // seconds to reach full
  const JUMP_MIN = 520;
  const JUMP_MAX = 980;
  const FLOOR_Y = 620;      // ground baseline (plants sit here)
  const CAM_LERP = 0.1;

  // Player
  const player = {
    x: 100, y: 0,
    w: 56, h: 80,
    vx: 0, vy: 0,
    grounded: false,
    charging: false,
    jumpHold: 0,
    alive: true,
    dist: 0
  };

  // Camera
  const cam = { x:0, y:0 };

  // Platforms and hazards
  const platforms = []; // {x,y,w,h, roofY}
  const hazards = [];   // {x,y,w,h,type:"sword"|"snake"}
  let worldRight = 0;
  const SEG_MIN_W = 260, SEG_MAX_W = 520;
  const GAP_MIN = 90, GAP_MAX = 240;
  const ROOF_MIN_Y = 280, ROOF_MAX_Y = 460;

  // Background decorations tiling (plants strip + parallax using map.png)
  function drawBackground(dt) {
    // Parallax sky
    const sky = assets.map;
    if (sky) {
      // draw dark gradient backdrop
      const grd = ctx.createLinearGradient(0,0,0,canvas.height);
      grd.addColorStop(0, "#081129");
      grd.addColorStop(1, "#1b0e12");
      ctx.fillStyle = grd;
      ctx.fillRect(0,0,canvas.width,canvas.height);

      // softly tile the 'map' image as a dim parallax
      const scale = 0.9;
      const w = sky.width*scale, h = sky.height*scale;
      const offsetX = -((cam.x*0.2) % w);
      for(let x=offsetX - w; x<canvas.width; x+=w){
        ctx.globalAlpha = 0.38;
        ctx.drawImage(sky, x, canvas.height-h-110, w, h);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle="#0b1020"; ctx.fillRect(0,0,canvas.width,canvas.height);
    }

    // Bottom plants deadly strip
    const plant = assets.plants;
    const tileH = 96;
    const baseY = FLOOR_Y - tileH + 24;
    if (plant) {
      const w = 160, h = tileH;
      for(let x = -((cam.x*0.6)%w) - w; x < canvas.width; x += w){
        ctx.drawImage(plant, x, baseY, w, h);
      }
    } else {
      ctx.fillStyle="#2a6b2a"; ctx.fillRect(0, baseY, canvas.width, tileH);
    }
  }

  function addPlatform(x, w, roofY) {
    const houseH = FLOOR_Y - roofY + 22;
    platforms.push({x, y: roofY, w, h: houseH, roofY});
    // Hazards on rooftop
    const hazardCount = Math.random() < 0.7 ? 1 : (Math.random() < 0.25 ? 2 : 0);
    for (let i=0;i<hazardCount;i++){
      const type = Math.random()<0.5 ? "sword" : "snake";
      const hw = type==="sword" ? 84 : 96;
      const hh = type==="sword" ? 120 : 110;
      const margin = 24;
      const hx = x + margin + Math.random()*(w - hw - margin*2);
      const hy = roofY - hh + 8;
      hazards.push({x: hx, y: hy, w: hw, h: hh, type});
    }
  }

  function generateWorld(toX){
    while(worldRight < toX){
      const w = SEG_MIN_W + Math.random()*(SEG_MAX_W-SEG_MIN_W);
      const gap = GAP_MIN + Math.random()*(GAP_MAX-GAP_MIN);
      const roofY = ROOF_MIN_Y + Math.random()*(ROOF_MAX_Y-ROOF_MIN_Y);
      addPlatform(worldRight + gap, w, roofY);
      worldRight += gap + w;
    }
  }

  function cleanupWorld(fromX){
    // drop old segments/hazards behind camera
    while(platforms.length && platforms[0].x + platforms[0].w < fromX - 400){
      platforms.shift();
    }
    while(hazards.length && hazards[0].x + hazards[0].w < fromX - 400){
      hazards.shift();
    }
  }

  function rectsOverlap(a,b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function reset() {
    platforms.length = 0; hazards.length = 0;
    worldRight = 0;
    addPlatform(-400, 800, 420); // starting area
    generateWorld(1600);
    player.x = 80; player.y = 300; player.vx=0; player.vy=0;
    player.grounded=false; player.charging=false; player.jumpHold=0; player.alive=true; player.dist=0;
    cam.x = 0; cam.y = 0;
    document.getElementById("overlay").classList.add("hidden");
  }

  function doInput(dt){
    // Horizontal control
    const ax = player.grounded ? GROUND_ACCEL : AIR_ACCEL;
    let dir = 0;
    if (isDown("ArrowLeft")) dir -= 1;
    if (isDown("ArrowRight")) dir += 1;
    player.vx += dir * ax * dt;
    // Friction when no input and on ground
    if (dir === 0 && player.grounded) {
      const fr = 3600 * dt;
      if (Math.abs(player.vx) <= fr) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * fr;
    }
    player.vx = Math.max(-MAX_SPD_X, Math.min(MAX_SPD_X, player.vx));

    // Jump charging
    if (isDown("Space")) {
      if (player.grounded) {
        player.charging = true;
        player.jumpHold = Math.min(1, player.jumpHold + (dt / JUMP_CHARGE_RATE));
      }
    } else {
      if (player.charging && player.grounded) {
        const power = JUMP_MIN + (JUMP_MAX - JUMP_MIN) * player.jumpHold;
        player.vy = -power;
        player.grounded = false;
      }
      player.charging = false;
      player.jumpHold = player.grounded ? 0 : player.jumpHold; // keep while airborne
    }
  }

  function physics(dt){
    player.vy += G * dt;
    player.vy = Math.max(-MAX_SPD_Y, Math.min(MAX_SPD_Y, player.vy));

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // Collide with platforms (one-way from top)
    const feet = {x:player.x+12, y:player.y+player.h-2, w:player.w-24, h:4};
    player.grounded = false;
    for (const p of platforms){
      const roofRect = {x:p.x, y:p.y-4, w:p.w, h:10};
      if (player.vy >= 0 && rectsOverlap(feet, roofRect)){
        player.y = p.y - player.h;
        player.vy = 0;
        player.grounded = true;
      }
      // Keep player from penetrating walls a bit
      const body = {x:player.x, y:player.y, w:player.w, h:player.h};
      const wall = {x:p.x-2, y:p.y, w:p.w+4, h:p.h};
      if (rectsOverlap(body, wall)){
        if (player.x + player.w/2 < p.x) player.x = p.x - player.w - 1;
        if (player.x + player.w/2 > p.x + p.w) player.x = p.x + p.w + 1;
      }
    }

    // Death conditions
    // Plants (bottom strip)
    if (player.y + player.h > FLOOR_Y - 8) die();

    // Hazards
    const body = {x:player.x+10, y:player.y+6, w:player.w-20, h:player.h-12};
    for (const h of hazards){
      const box = {x:h.x+8,y:h.y+8,w:h.w-16,h:h.h-16};
      if (rectsOverlap(body, box)) { die(); break; }
    }
  }

  function die(){
    if (!player.alive) return;
    player.alive = false;
    document.getElementById("title").textContent = "You Died";
    document.getElementById("subtitle").textContent = "Press R to restart";
    document.getElementById("overlay").classList.remove("hidden");
  }

  // Drawing
  function drawPlayer(){
    const img = assets.player;
    const px = Math.round(player.x - cam.x);
    const py = Math.round(player.y - cam.y);
    if (img) {
      ctx.drawImage(img, px-8, py-24, 96, 144);
    } else {
      ctx.fillStyle="#ddd"; ctx.fillRect(px, py, player.w, player.h);
    }
    if (player.charging && player.grounded){
      ctx.fillStyle="rgba(255,255,255,0.4)";
      ctx.fillRect(px, py+player.h+4, player.w * player.jumpHold, 6);
      ctx.strokeStyle="rgba(255,255,255,0.2)";
      ctx.strokeRect(px, py+player.h+4, player.w, 6);
    }
  }

  function drawWorld(){
    // houses (platform bodies)
    for (const p of platforms){
      const x = Math.round(p.x - cam.x);
      const roofY = Math.round(p.y - cam.y);
      const baseH = Math.round(FLOOR_Y - p.y + 22);

      // body
      ctx.fillStyle = "#2b1120";
      ctx.fillRect(x, roofY, p.w, baseH);

      // windows glow
      ctx.fillStyle="#ffb45a";
      for(let i=0;i<Math.floor(p.w/90);i++){
        const wx = x + 24 + i*90;
        ctx.fillRect(wx, roofY + 44, 28, 22);
      }

      // roof
      ctx.fillStyle="#0e1a2b";
      ctx.fillRect(x-4, roofY-18, p.w+8, 18);
      ctx.fillStyle="#0b1625";
      ctx.fillRect(x-2, roofY-12, p.w+4, 12);
    }

    // hazards
    for (const h of hazards){
      const img = h.type==="sword" ? assets.swords : assets.snake;
      const dx = Math.round(h.x - cam.x);
      const dy = Math.round(h.y - cam.y);
      if (img) ctx.drawImage(img, dx, dy, h.w, h.h);
      else { ctx.fillStyle = h.type==="sword"?"#ccc":"#eee"; ctx.fillRect(dx,dy,h.w,h.h); }
    }
  }

  // Main loop
  let last = performance.now();
  function tick(now){
    const dt = Math.min(0.033, (now-last)/1000);
    last = now;

    // Update
    if (player.alive){
      doInput(dt);
      physics(dt);
      cam.x += (player.x - cam.x - 420) * CAM_LERP;
      cam.y = 0;

      // Generate & cleanup
      generateWorld(cam.x + canvas.width + 800);
      cleanupWorld(cam.x - 800);

      // Distance
      player.dist = Math.max(player.dist, Math.floor((player.x-80)/16));
      document.getElementById("dist").textContent = player.dist + " m";
    }

    // Draw
    drawBackground(dt);
    drawWorld();
    drawPlayer();

    requestAnimationFrame(tick);
  }

  // Controls: restart
  addEventListener("keydown", (e)=>{
    if (e.code === "KeyR"){
      reset();
    }
  });

  // Load assets then start
  Promise.all([
    loadImage("assets/player.png").then(img=>assets.player=img).catch(()=>{}),
    loadImage("assets/swords.png").then(img=>assets.swords=img).catch(()=>{}),
    loadImage("assets/snake.png").then(img=>assets.snake=img).catch(()=>{}),
    loadImage("assets/plants.png").then(img=>assets.plants=img).catch(()=>{}),
    loadImage("assets/map.png").then(img=>assets.map=img).catch(()=>{}),
  ]).then(reset).then(()=>requestAnimationFrame(tick));
})();



// Load house images
const tallHouseImg = new Image();
tallHouseImg.src = "assets/tall-house.png";
const shortHouseImg = new Image();
shortHouseImg.src = "assets/short-house.png";


// Touch controls mapping
const pressKey = code => window.dispatchEvent(new KeyboardEvent("keydown", { key: code }));
const releaseKey = code => window.dispatchEvent(new KeyboardEvent("keyup", { key: code }));

document.getElementById("left").addEventListener("touchstart", () => pressKey("ArrowLeft"));
document.getElementById("left").addEventListener("touchend", () => releaseKey("ArrowLeft"));

document.getElementById("right").addEventListener("touchstart", () => pressKey("ArrowRight"));
document.getElementById("right").addEventListener("touchend", () => releaseKey("ArrowRight"));

document.getElementById("jump").addEventListener("touchstart", () => pressKey(" "));
document.getElementById("jump").addEventListener("touchend", () => releaseKey(" "));


// Replace block drawing with houses
function drawHousePlatform(ctx, blockX, blockY, blockWidth, blockHeight) {
  const houseImg = Math.random() < 0.5 ? shortHouseImg : tallHouseImg;
  ctx.drawImage(houseImg, blockX, blockY - (houseImg.height - blockHeight));
}
