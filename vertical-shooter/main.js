// main.js
(() => {
  // === CANVAS SETUP ===
  const canvas = document.getElementById('gameCanvas');
  const ctx    = canvas.getContext('2d');
  let   W      = window.innerWidth;
  let   H      = window.innerHeight;
  const STAR_COUNT = 100;
  const SCALE      = 1.2;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = W;
    canvas.height = H;
  }
  window.addEventListener('resize', resize);
  resize();

  // === INPUT & STATE ===
  const keys = {};
  let state    = 'loading';      // 'loading','start','tutorial','playing','over','highscores'
  let username = '';

  window.addEventListener('keydown', e => {
    keys[e.code] = true;

    if (state === 'start') {
      if (e.code === 'Space') {
        username = (prompt("Enter your player name:") || 'Anonymous').trim();
        startGame();
      }
      if (e.code === 'KeyT') {
        state = 'tutorial';
      }
      if (e.code === 'KeyH') {
        loadHighScores().catch(_ => alert('Failed loading highscores'));
      }
    }
    else if (state === 'tutorial' && e.code === 'Escape') {
      state = 'start';
    }
    else if (state === 'highscores' && e.code === 'Escape') {
      state = 'start';
    }
    else if (state === 'over' && e.code === 'Space') {
      if (!username) {
        username = (prompt("Enter your player name:") || 'Anonymous').trim();
      }
      sendScore(username, game.points)
        .then(resp => {
          alert(`Score ${resp.newScore} ${resp.status}!`);
          location.reload();
        })
        .catch(err => {
          if (err.status === 'too_low') {
            if (confirm(`Your existing high score (${err.existing}) is higher than ${game.points}.\nUse a different name?`)) {
              const newName = prompt("New player name:")?.trim();
              if (newName) {
                username = newName;
                return sendScore(username, game.points)
                  .then(r2 => {
                    alert(`Score ${r2.newScore} ${r2.status}!`);
                    location.reload();
                  });
              }
            } else {
              state = 'start';
            }
          } else {
            alert('Error submitting score.');
          }
        });
    }
    else if (state === 'playing' && e.code === 'KeyC') {
      fireTorpedo();
    }
  });

  window.addEventListener('keyup', e => {
    keys[e.code] = false;
  });

  // === ASSETS LOADING ===
  const assets = {}, assetList = {
    background_image:   'assets/background_image.png',
    player:             'assets/player.png',
    asteroid_small:     'assets/asteroid_small.png',
    asteroid_large:     'assets/asteroid_large.png',
    enemy:              'assets/enemy.png',
    boss:               'assets/boss.png',
    drone:              'assets/drone.png',
    shieldPU:           'assets/shield.png',
    ammoPU:             'assets/unlimited.png',
    laser:              'assets/laser.gif',
    enemyLaser:         'assets/enemy_laser.gif',
    star1:              'assets/star1.png',
    star2:              'assets/star2.png',
    star3:              'assets/star3.png',
    star4:              'assets/star4.png',
    spark:              'assets/spark.png',
    explosion_small:    'assets/explosion_small.png',
    explosion_medium:   'assets/explosion_medium.png',
    explosion_big:      'assets/explosion_big.png',
    hb_full:            'assets/OneTenth_Healthbar_full.png',
    hb_empty:           'assets/OneTenth_Healthbar_empty.png',
    plasma_torpedo:     'assets/plasma_torpedo.png',
    torpedo_pickup:     'assets/torpedo_pickup_icon.png'
  };
  let loaded = 0, total = Object.keys(assetList).length;
  for (let key in assetList) {
    const img = new Image();
    img.src = assetList[key];
    img.onload  = () => { loaded++; drawLoading(); if (loaded === total) { state = 'start'; init(); } };
    img.onerror = () => { loaded++; drawLoading(); if (loaded === total) { state = 'start'; init(); } };
    assets[key] = img;
  }

  // === AUDIO SETUP ===
  const audio = {
    playerLaser:        new Audio('assets/player_laser_sound.mp3'),
    enemyExplosion:     new Audio('assets/enemy_explosion.mp3'),
    bossExplosion:      new Audio('assets/boss_explosion_sound.mp3'),
    impactShield:       new Audio('assets/impact_on_shield.mp3'),
    shieldPickup:       new Audio('assets/shield_pick_up.mp3'),
    playerHit:          new Audio('assets/player_gets_hit.mp3'),
    spacetorpedo_fired: new Audio('assets/spacetorpedo_fired.mp3'),
    bgm:                document.getElementById('bgm')
  };
  const volumes = {
    playerLaser:        0.5,
    enemyExplosion:     0.5,
    bossExplosion:      0.7,
    impactShield:       0.5,
    shieldPickup:       0.5,
    playerHit:          0.5,
    spacetorpedo_fired: 0.6,
    bgm:                0.3
  };
  Object.values(audio).forEach(a => a.load());
  audio.bgm.volume = volumes.bgm;
  function playSound(name) {
    if (name === 'bgm') return;
    const s = audio[name].cloneNode();
    s.volume = volumes[name] || 1;
    s.play();
  }

  // === ENTITY CLASS ===
  class Entity {
    constructor(x, y, w, h) {
      Object.assign(this, { x, y, w, h, dead: false });
    }
    draw(img) {
      ctx.drawImage(img, this.x, this.y, this.w * SCALE, this.h * SCALE);
    }
    collide(o) {
      return !(
        this.x + this.w < o.x ||
        this.x > o.x + o.w ||
        this.y + this.h < o.y ||
        this.y > o.y + o.h
      );
    }
  }

  // === GAME STATE ===
  const game = {
    last: 0, dt: 0,
    stars: [], particles: [],
    player: Object.assign(new Entity(0, 0, 50, 50), {
      speed: 250,
      health: 100,
      ammo: 25,
      plasma: 0,
      shield: false,
      shieldTimer: 0,
      shieldHits: 0,
      unlimited: false,
      unlimitedTimer: 0,
      flashTimer: 0,
      flashColor: null,
      _shootCooldown: 0,
      _torpCooldown: 0
    }),
    bullets: [], torpedoes: [], asteroids: [], enemies: [], drones: [], powerups: [], explosions: [],
    boss: null, points: 0, highscore: 0, level: 1,
    timers: { astSmall: 0, astLarge: 0, enemy: 0, pu: 0, boss: 0, plasma: 0 },
    highscores: []
  };

  // === DRAW LOADING BAR ===
  function drawLoading() {
    ctx.clearRect(0, 0, W, H);
    if (assets.background_image) {
      ctx.drawImage(assets.background_image, 0, 0, W, H);
    }
    const bw = 20 * SCALE, bh = 20 * SCALE, sp = 2 * SCALE, y = H - bh - 10 * SCALE;
    for (let i = 0; i < total; i++) {
      const img = i < loaded ? assets.hb_full : assets.hb_empty;
      ctx.drawImage(img, 10 + i * (bw + sp), y, bw, bh);
    }
  }

  // === INITIALIZE & STARFIELD ===
  function init() {
    resize();
    game.player.x = W / 2 - 25;
    game.player.y = H - 70;
    initStars();
    requestAnimationFrame(loop);
  }
  function initStars() {
    game.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const img = assets['star' + ((i % 4) + 1)];
      game.stars.push({
        img,
        x: Math.random() * W,
        y: Math.random() * H,
        speed: 20 + Math.random() * 40,
        size: 3 + Math.random() * 5
      });
    }
  }

  // === MAIN LOOP ===
  function loop(ts) {
    if (!game.last) game.last = ts;
    game.dt   = (ts - game.last) / 1000;
    game.last = ts;

    switch (state) {
      case 'start':       drawStart();        break;
      case 'tutorial':    drawTutorial();     break;
      case 'playing':     update(); drawGame(); break;
      case 'over':        drawGameOver();     break;
      case 'highscores':  drawHighscores();   break;
    }

    requestAnimationFrame(loop);
  }

  // === STATE TRANSITIONS ===
  function startGame() {
    state = 'playing';
    resetGame();
    audio.bgm.play();
  }
  function endGame() {
    state = 'over';
    audio.bgm.pause();
    game.highscore = Math.max(game.highscore, game.points);
  }

  // === UPDATE GAME LOGIC ===
  function update() {
    const p = game.player, dt = game.dt;

    // -- player movement --
    if (keys.ArrowLeft  || keys.KeyA) p.x -= p.speed * dt;
    if (keys.ArrowRight || keys.KeyD) p.x += p.speed * dt;
    if (keys.ArrowUp    || keys.KeyW) p.y -= p.speed * dt;
    if (keys.ArrowDown  || keys.KeyS) p.y += p.speed * dt;

    // clamp to screen
    p.x = Math.max(0, Math.min(W - p.w * SCALE, p.x));
    p.y = Math.max(0, Math.min(H - p.h * SCALE, p.y));

    // -- shooting cooldowns --
    p._shootCooldown = Math.max(0, p._shootCooldown - dt);
    p._torpCooldown  = Math.max(0, p._torpCooldown  - dt);

    // -- fire laser --
    if (keys.Space && p._shootCooldown === 0 && (p.unlimited || p.ammo > 0)) {
      game.bullets.push(new Entity(p.x + 20, p.y - 30, 10, 40));
      p._shootCooldown = p.unlimited ? 0.15 : 0.3;
      if (!p.unlimited) p.ammo--;
      playSound('playerLaser');
    }

    // -- torpedo pickup timer --
    game.timers.plasma += dt;
    if (game.timers.plasma > 20) {
      spawnTorpedoPickup();
      game.timers.plasma = 0;
    }

    // -- spawns --
    game.timers.astSmall += dt; if (game.timers.astSmall > 0.5) { spawnAst('small'); game.timers.astSmall = 0; }
    game.timers.astLarge += dt; if (game.timers.astLarge > 2)   { spawnAst('large'); game.timers.astLarge = 0; }
    game.timers.enemy    += dt; if (game.timers.enemy    > 3)   { spawnEnemy();      game.timers.enemy    = 0; }
    game.timers.pu       += dt; if (game.timers.pu       > 8)   { spawnPowerUp();    game.timers.pu       = 0; }
    game.timers.boss     += dt; if (!game.boss && game.timers.boss > 30) { spawnBoss(); game.timers.boss = 0; }

    // -- move entities --
    game.stars     .forEach(s => { s.y += s.speed * dt; if (s.y > H) s.y = 0; });
    game.bullets   .forEach(b => { b.y -= 600 * dt; if (b.y < -b.h * SCALE) b.dead = true; });
    game.asteroids .forEach(a => { a.y += a.speed * dt; if (a.y > H) a.dead = true; });
    game.enemies   .forEach(e => updateEnemy(e, dt));
    if (game.boss)                           updateBoss(dt);
    game.drones    .forEach(d => updateDrone(d, dt));
    game.powerups  .forEach(pu=>{ pu.y += 120 * dt; if (pu.y > H) pu.dead = true; });
    game.explosions.forEach(ex=>{ ex.time -= dt; if (ex.time <= 0) ex.dead = true; });
    game.particles .forEach(pt=>{ pt.x += pt.dx * dt; pt.y += pt.dy * dt; pt.time -= dt; if (pt.time <= 0) pt.dead = true; });
    game.torpedoes .forEach(t => updateTorpedo(t, dt));

    // -- collisions --
    handleCollisions();

    // -- shield timer (fixed!) --
    if (game.player.shield) {
      game.player.shieldTimer -= game.dt;
      if (game.player.shieldTimer <= 0 || game.player.shieldHits <= 0) {
        game.player.shield = false;
      }
    }

    // -- cleanup dead --
    ['bullets','asteroids','enemies','drones','powerups','explosions','particles','torpedoes']
      .forEach(key => {
        game[key] = game[key].filter(o => !o.dead);
      });

    // -- end or level up --
    if (p.health <= 0)            endGame();
    if (game.boss && game.boss.dead) finishLevel();
  }

  // === FIRE TORPEDO ===
  function fireTorpedo() {
    const p = game.player;
    if (p.plasma > 0 && p._torpCooldown === 0) {
      const t = new Entity(p.x + 20, p.y - 30, 16, 16);
      t.speed = 300;
      t.type  = 'torpedo';
      game.torpedoes.push(t);
      p.plasma--;
      p._torpCooldown = 0.5;
      playSound('spacetorpedo_fired');
    }
  }

  // === DRAW FUNCTIONS ===

  function drawStart() {
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(assets.background_image,0,0,W,H);
    ctx.fillStyle = '#0ff';
    ctx.font      = `${64*SCALE}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('GALAXY CONQUER', W/2, H/2 - 120*SCALE);

    const labels = ['START (Spacebar)','TUTORIAL (T)','HIGHSCORE LIST (H)'];
    ctx.font      = `${48*SCALE}px monospace`;
    const widths  = labels.map(t=>ctx.measureText(t).width);
    const btnW    = Math.max(...widths) + 40*SCALE;
    const btnH    = 60*SCALE;
    const gap     = 10*SCALE;
    const totalH  = labels.length*btnH + (labels.length-1)*gap;
    let   startY  = H/2 - totalH/2 + 20*SCALE;

    labels.forEach((txt,i)=>{
      const x = (W-btnW)/2;
      const y = startY + i*(btnH+gap);
      ctx.fillStyle = '#123';
      ctx.fillRect(x,y,btnW,btnH);
      ctx.fillStyle = '#0ff';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, W/2, y+btnH/2);
    });

    ctx.font = `${20*SCALE}px monospace`;
    ctx.fillText('', W/2, startY + labels.length*(btnH+gap) + 30*SCALE);
  }

  function drawTutorial() {
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(assets.background_image,0,0,W,H);

    const lines = [
      'HOW TO PLAY:',
      'Arrow    = Move',
      'Space    = Laser',
      'C        = Plasma Torpedo',
      'ShieldPU = Absorb Hits',
      'AmmoPU   = Unlimited Fire',
      'TorpPU   = +3 Torpedoes'
    ];
    const pX = 30*SCALE;
    const pY = 30*SCALE;
    const fT = 48*SCALE;
    const fE = 28*SCALE;
    const fH = 20*SCALE;
    const lH = 40*SCALE;
    const bW = Math.min(600, W*0.8);
    const bH = pY*2 + fT + 10*SCALE + lines.length*lH + fH + 10*SCALE;
    const bX = (W-bW)/2;
    const bY = (H-bH)/2;

    ctx.fillStyle   = '#123';
    ctx.fillRect(bX,bY,bW,bH);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth   = 2;
    ctx.strokeRect(bX,bY,bW,bH);

    ctx.fillStyle   = '#0ff';
    ctx.font        = `${fT}px monospace`;
    ctx.textAlign   = 'center';
    ctx.fillText('TUTORIAL', W/2, bY + pY + fT*0.75);

    ctx.font      = `${fE}px monospace`;
    ctx.textAlign = 'left';
    let y = bY + pY + fT + 10*SCALE;
    lines.forEach(line => {
      ctx.fillText(line, bX + pX, y + fE*0.3);
      y += lH;
    });

    ctx.font      = `${fH}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Press ESC to go back', W/2, bY + bH - pY/3);
  }

  function drawGameOver() {
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(assets.background_image,0,0,W,H);
    ctx.fillStyle = '#f00';
    ctx.font      = `${64*SCALE}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', W/2, H/2 - 100*SCALE);
    ctx.fillStyle = '#0ff';
    ctx.font      = `${32*SCALE}px monospace`;
    ctx.fillText(`Score: ${game.points}`, W/2, H/2);
    ctx.fillText('SPACE to Restart', W/2, H/2 + 60*SCALE);
  }

  function drawGame() {
    ctx.clearRect(0,0,W,H);

    // stars
    game.stars.forEach(s => {
      ctx.drawImage(s.img, s.x, s.y, s.size*SCALE, s.size*SCALE);
    });

    // player flash
    if (game.player.flashTimer > 0) {
      ctx.fillStyle   = game.player.flashColor;
      ctx.globalAlpha = game.player.flashTimer;
      ctx.fillRect(0,0,W,H);
      ctx.globalAlpha = 1;
      game.player.flashTimer = Math.max(0, game.player.flashTimer - game.dt);
    }

    // health bar
    for (let i=0; i<10; i++) {
      const img = i < Math.ceil(game.player.health/10) ? assets.hb_full : assets.hb_empty;
      ctx.drawImage(img, 20 + i*22*SCALE, H-40*SCALE, 20*SCALE, 20*SCALE);
    }

    // shield overlay
    if (game.player.shield) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        game.player.x + game.player.w*SCALE/2,
        game.player.y + game.player.h*SCALE/2,
        game.player.w*SCALE, 0, Math.PI*2
      );
      ctx.strokeStyle = 'rgba(0,240,208,0.6)';
      ctx.lineWidth   = 4;
      ctx.stroke();
      ctx.restore();

      // shield HUD
      ctx.fillStyle   = '#0ff';
      ctx.font        = `${20*SCALE}px monospace`;
      ctx.textAlign   = 'left';
      ctx.fillText(
        `Shield: ${game.player.shieldTimer.toFixed(1)}s | Hits: ${game.player.shieldHits}`,
        20, 120*SCALE
      );
    }

    // player
    game.player.draw(assets.player);

    // bullets
    game.bullets.forEach(b => {
      ctx.drawImage(assets.laser, b.x, b.y, b.w*SCALE, b.h*SCALE);
    });

    // torpedoes
    game.torpedoes.forEach(t => {
      ctx.drawImage(assets.plasma_torpedo, t.x, t.y, t.w*SCALE, t.h*SCALE);
    });

    // asteroids
    game.asteroids.forEach(a => {
      const key = a.size==='large' ? 'asteroid_large' : 'asteroid_small';
      ctx.drawImage(assets[key], a.x, a.y, a.w*SCALE, a.h*SCALE);
    });

    // enemies
    game.enemies.forEach(e => e.draw(assets.enemy));

    // boss
    if (game.boss) {
      game.boss.draw(assets.boss);
      if (game.boss.shieldActive) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(
          game.boss.x + game.boss.w*SCALE/2,
          game.boss.y + game.boss.h*SCALE/2,
          game.boss.w*SCALE, 0, Math.PI*2
        );
        ctx.strokeStyle = 'rgba(255,255,0,0.6)';
        ctx.lineWidth   = 6;
        ctx.stroke();
        ctx.restore();
      }
    }

    // drones & enemy lasers
    game.drones.forEach(d => {
      if (d.type === 'explosive') {
        d.draw(assets.drone);
      } else {
        ctx.drawImage(assets.enemyLaser, d.x, d.y, d.w*SCALE, d.h*SCALE);
      }
    });

    // power-ups
    game.powerups.forEach(pu => {
      ctx.drawImage(assets[pu.kind], pu.x, pu.y, 30*SCALE, 30*SCALE);
    });

    // explosions & sparks
    game.explosions.forEach(ex => {
      ctx.drawImage(
        assets[ex.img],
        ex.x - (ex.w/2)*SCALE,
        ex.y - (ex.h/2)*SCALE,
        ex.w*SCALE,
        ex.h*SCALE
      );
    });
    game.particles.forEach(pt => {
      ctx.drawImage(assets.spark, pt.x, pt.y, pt.w*SCALE, pt.h*SCALE);
    });

    // HUD
    ctx.fillStyle = '#0ff';
    ctx.font      = `${20*SCALE}px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`Ammo: ${game.player.ammo}`,     20,  30*SCALE);
    ctx.fillText(`Score: ${game.points}`,        20,  60*SCALE);
    ctx.fillText(`High: ${game.highscore}`,      20,  90*SCALE);
  }

  function drawHighscores() {
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(assets.background_image,0,0,W,H);
    const list = game.highscores;
    const pX = 30*SCALE, pY = 30*SCALE;
    const fT = 48*SCALE, fE = 28*SCALE, fH = 20*SCALE, lH = 40*SCALE;
    const bW = Math.min(600, W * 0.8);
    const bH = pY*2 + fT + 10*SCALE + list.length*lH + fH + 10*SCALE;
    const bX = (W - bW)/2, bY = (H - bH)/2;

    ctx.fillStyle   = '#123';
    ctx.fillRect(bX,bY,bW,bH);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth   = 2;
    ctx.strokeRect(bX,bY,bW,bH);

    ctx.fillStyle = '#0ff';
    ctx.font      = `${fT}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Highscore List', W/2, bY + pY + fT*0.75);

    ctx.font      = `${fE}px monospace`;
    ctx.textAlign = 'left';
    let y = bY + pY + fT + 10*SCALE;
    list.forEach((e,i) => {
      ctx.fillText(`${i+1}.  ${e.name}    ${e.score}`, bX + pX, y + fE*0.3);
      y += lH;
    });

    ctx.font      = `${fH}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Press ESC to go back', W/2, bY + bH - pY/3);
  }

  // === SPAWN & COLLISION HELPERS ===

  function spawnAst(size) {
    const w = size==='large'?60:30;
    game.asteroids.push(Object.assign(
      new Entity(Math.random()*(W-w), -w, w, w),
      { size, speed: size==='large'?80:150, hp: size==='large'?5:1 }
    ));
  }

  function spawnEnemy() {
    game.enemies.push(Object.assign(
      new Entity(Math.random()*(W-40), -40, 40, 40),
      { hp:2, initialHp:2, _shotTimer:0 }
    ));
  }

  function spawnBoss() {
    game.boss = Object.assign(
      new Entity(W/2 - 75, -150, 150, 150),
      {
        hp:25, flashTimer:0, flashColor:null,
        shieldActive:false, shieldTimer:0, nextShieldTimer:Math.random()*5+5,
        _shot:0, _drone:0
      }
    );
  }

  function spawnPowerUp() {
    const kind = Math.random()<0.5 ? 'shieldPU' : 'ammoPU';
    game.powerups.push(Object.assign(
      new Entity(Math.random()*(W-30), -30, 30, 30),
      { kind }
    ));
  }

  function spawnTorpedoPickup() {
    game.powerups.push(Object.assign(
      new Entity(Math.random()*(W-30), -30, 30, 30),
      { kind:'torpedo_pickup' }
    ));
  }

  function updateEnemy(e, dt) {
    e.y += 100*dt;
    const dx = (game.player.x+25) - (e.x+20);
    if (Math.abs(dx) > 5) e.x += Math.sign(dx) * 80 * dt;
    e._shotTimer += dt;
    if (e._shotTimer > 2) {
      game.drones.push(Object.assign(
        new Entity(e.x+20, e.y+e.h, 8,20),
        { type:'enemyLaser' }
      ));
      e._shotTimer = 0;
    }
    if (e.y > H) e.dead = true;
  }

  function updateBoss(dt) {
    const b = game.boss;
    if (!b.shieldActive) {
      b.nextShieldTimer -= dt;
      if (b.nextShieldTimer <= 0) {
        b.shieldActive  = true;
        b.shieldTimer   =  Math.random()*2 + 2;
      }
    } else {
      b.shieldTimer -= dt;
      if (b.shieldTimer <= 0) {
        b.shieldActive   = false;
        b.nextShieldTimer = Math.random()*5 + 5;
      }
    }
    if (b.flashTimer > 0) {
      b.flashTimer -= dt;
      ctx.save();
      ctx.globalAlpha = b.flashTimer;
      ctx.fillStyle   = b.flashColor;
      ctx.fillRect(0,0,W,H);
      ctx.restore();
    }
    b.y = Math.min(50, b.y + 50*dt);
    b._shot += dt;
    if (b._shot > 1) {
      game.drones.push(Object.assign(
        new Entity(b.x+70, b.y+150, 6,20),
        { type:'enemyLaser' }
      ));
      b._shot = 0;
    }
    b._drone += dt;
    if (b._drone > 3) {
      game.drones.push(Object.assign(
        new Entity(b.x + Math.random()*b.w, b.y + b.h, 20,20),
        { type:'explosive' }
      ));
      b._drone = 0;
    }
  }

  function updateDrone(d, dt) {
    if (d.type==='explosive') {
      d._life = (d._life||0) + dt;
      if (d._life > 4) d.dead = true;
      const dx = game.player.x - d.x;
      const dy = game.player.y - d.y;
      const mag = Math.hypot(dx,dy) || 1;
      d.x += dx/mag * 100 * dt;
      d.y += dy/mag * 100 * dt;
    } else {
      d.y += 400 * dt;
      if (d.y > H) d.dead = true;
    }
  }

  function updateTorpedo(t, dt) {
    let target = null, md = Infinity;
    game.enemies.forEach(e => {
      const dx = e.x - t.x, dy = e.y - t.y, dist = dx*dx + dy*dy;
      if (dist < md) { md = dist; target = e; }
    });
    if (target) {
      const dx = target.x - t.x, dy = target.y - t.y, mag = Math.hypot(dx,dy) || 1;
      t.x += dx/mag * t.speed * dt;
      t.y += dy/mag * t.speed * dt;
    } else {
      t.y -= t.speed * dt;
    }
    if (t.y < -t.h * SCALE) t.dead = true;
  }

  function handleCollisions() {
    const p = game.player;

    // enemy lasers destroy asteroids
    game.drones.forEach(d => {
      if (d.type==='enemyLaser') {
        game.asteroids.forEach(a => {
          if (!a.dead && d.collide(a)) {
            a.dead = true;
            addExp(a.x, a.y, 'explosion_small');
            d.dead = true;
          }
        });
      }
    });

    // bullets vs asteroids/enemies/boss
    game.bullets.forEach(b => {
      game.asteroids.forEach(a => {
        if (!a.dead && b.collide(a)) {
          a.hp--;
          addExp(a.x, a.y, 'explosion_small');
          b.dead = true;
          if (a.hp <= 0) {
            a.dead = true;
            addExp(a.x, a.y, 'explosion_medium');
            p.ammo += a.initialHp===5 ? 8 : 3;
            game.points += a.initialHp===5 ? 5 : 1;
            playSound('enemyExplosion');
          }
        }
      });
      game.enemies.forEach(e => {
        if (!e.dead && b.collide(e)) {
          e.hp--;
          addExp(e.x, e.y, 'explosion_small');
          b.dead = true;
          if (e.hp <= 0) {
            e.dead = true;
            addExp(e.x, e.y, 'explosion_small');
            p.ammo += 5;
            game.points += 2;
            playSound('enemyExplosion');
          }
        }
      });
      if (game.boss && !game.boss.shieldActive && b.collide(game.boss)) {
        game.boss.hp--;
        addExp(game.boss.x, game.boss.y, 'explosion_big');
        b.dead = true;
        p.ammo += 25;
        game.points += 25;
        playSound('bossExplosion');
        if (game.boss.hp <= 0) game.boss.dead = true;
      }
    });

    // torpedoes vs enemies/boss
    game.torpedoes.forEach(t => {
      game.enemies.forEach(e => {
        if (!e.dead && t.collide(e)) {
          e.dead = true;
          t.dead = true;
          addExp(e.x, e.y, 'explosion_medium');
          p.ammo += 5;
          game.points += 2;
        }
      });
      if (game.boss && t.collide(game.boss)) {
        game.boss.flashColor = 'rgba(255,0,0,0.5)';
        game.boss.flashTimer = 0.3;
        t.dead = true;
      }
    });

    // player collisions
    [...game.asteroids, ...game.enemies, ...game.drones].forEach(o => {
      if (!o.dead && p.collide(o)) {
        if (p.shield) {
          o.dead = true;
          addExp(o.x, o.y, 'explosion_small');
          playSound('impactShield');
          p.shieldHits--;
          if (p.shieldHits <= 0) p.shield = false;
          p.flashColor = 'rgba(0,255,255,0.5)';
          p.flashTimer = 0.3;
        } else {
          o.dead = true;
          addExp(p.x, p.y, 'explosion_small');
          playSound('playerHit');
          p.health -= (o.initialHp===5 ? 20 : 10);
          p.flashColor = 'rgba(255,0,0,0.5)';
          p.flashTimer = 0.3;
          if (p.health <= 0) endGame();
        }
      }
    });

    // power-ups
    game.powerups.forEach(pu => {
      if (!pu.dead && pu.collide(game.player)) {
        pu.dead = true;
        addExp(pu.x, pu.y, 'explosion_small');
        if (pu.kind === 'shieldPU') {
          p.shield      = true;
          p.shieldTimer = 12;   // 12 seconds
          p.shieldHits  = 12;
          playSound('shieldPickup');
        }
        else if (pu.kind === 'ammoPU') {
          p.unlimited      = true;
          p.unlimitedTimer = 8;
        }
        else if (pu.kind === 'torpedo_pickup') {
          p.plasma += 3;
          playSound('shieldPickup');
        }
      }
    });
  }

  function addExp(x, y, type) {
    const map = {
      explosion_small:  { img:'explosion_small',  w:24, h:24, t:0.5 },
      explosion_medium: { img:'explosion_medium', w:48, h:48, t:0.7 },
      explosion_big:    { img:'explosion_big',    w:72, h:72, t:1.0 }
    }[type];
    if (map) {
      game.explosions.push(Object.assign(
        new Entity(x, y, map.w, map.h),
        { img: map.img, time: map.t }
      ));
    }
  }

  function generateSparks(x, y) {
    for (let i=0; i<8; i++) {
      const a = Math.random()*2*Math.PI;
      const s = 100 + Math.random()*100;
      game.particles.push(Object.assign(
        new Entity(x, y, 8, 8),
        { dx:Math.cos(a)*s, dy:Math.sin(a)*s, time:0.3 }
      ));
    }
  }

  function finishLevel() {
    game.player.health = 100;
    game.level++;
    game.boss = null;
    game.timers.boss = 0;
  }

  function resetGame() {
    game.highscore = Math.max(game.highscore, game.points);
    game.points    = 0;
    const p = game.player;
    p.health       = 100;
    p.ammo         = 25;
    p.plasma       = 0;
    p.shield       = false;
    p.unlimited    = false;
    p.flashTimer   = 0;
    game.asteroids = [];
    game.enemies   = [];
    game.drones    = [];
    game.powerups  = [];
    game.explosions= [];
    game.particles = [];
    game.torpedoes = [];
    game.boss      = null;
    game.level     = 1;
    for (let k in game.timers) game.timers[k] = 0;
  }

  // === JSONP FOR HIGH SCORES ===
  const SCORE_WEB_APP = 'https://script.google.com/macros/s/AKfycbxHA4Sh-7im9IUwMc64BeIy8WlIUuX5tiznqy3UE-Tzj4zOfep5clvZidDvn8a-n40h/exec';

  function loadHighScores() {
    return new Promise((resolve, reject) => {
      const cb = 'onHighscoreList';
      window[cb] = list => {
        delete window[cb];
        game.highscores = list;
        state = 'highscores';
        resolve();
      };
      const tag = document.createElement('script');
      tag.src = `${SCORE_WEB_APP}?callback=${cb}`;
      tag.onerror = () => {
        delete window[cb];
        reject();
      };
      document.body.appendChild(tag);
    });
  }

  function sendScore(username, score) {
    return new Promise((resolve, reject) => {
      const cb = 'onScoreReturned';
      window[cb] = data => {
        delete window[cb];
        if (data.status==='added' || data.status==='updated') resolve(data);
        else if (data.status==='too_low') reject(data);
        else reject(data);
      };
      const tag = document.createElement('script');
      tag.src = `${SCORE_WEB_APP}` +
                `?username=${encodeURIComponent(username)}` +
                `&score=${score}` +
                `&callback=${cb}`;
      document.body.appendChild(tag);
    });
  }

  // === START EVERYTHING ===
  init();
})();
