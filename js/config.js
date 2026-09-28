// Every tunable number in the game lives here. Tweak, save, refresh.
export const CONFIG = {
  BUILD: 21,                        // shown on the title screen; bump on every deploy

  // World layout (all distances in world pixels from the vortex centre)
  RIM: 4500,                        // outer edge, where fresh tiles drift in
  CORE_R: 70,                       // tiles closer than this are swallowed
  RINGS: [900, 1600, 2300, 3000, 3700], // depth bands (drawn as rings)
  START_R: 1400,

  // Survival: the vortex gets stronger over time. Strength multiplies every tile's
  // swirl and inward pull (1 = normal).
  STRENGTH_START: 1,
  STRENGTH_RATE: 0.01,              // added per second
  STRENGTH_MAX: 5,                  // the run ends when the vortex reaches this
  FALL_PENALTY: 1,                  // a fall adds this much strength, then you respawn where you fell

  // Pickups: each one takes vortex strength away. The amount grows with depth:
  // CALM_MIN at the rim up to CALM_MAX at the core (curved by CALM_CURVE).
  // In seconds of vortex growth that's CALM / STRENGTH_RATE (e.g. 0.15 = 15s).
  PICKUP_COUNT: 8,                  // kept alive around the player
  PICKUP_RADIUS: 24,                // how close you must get to collect one
  PICKUP_SPAWN_MIN: 150,            // spawn this far from the player...
  PICKUP_SPAWN_MAX: 1100,           // ...but no further
  PICKUP_FORGET: 2200,              // pickups this far away are recycled
  CALM_MIN: 0.03,
  CALM_MAX: 0.25,
  CALM_CURVE: 2,

  // Vortex motion:
  //   speedFactor = sqrt(REF_AREA / area)            (small tiles are faster)
  //   ω  = BASE_SPIN * speedFactor * (R_REF / r)^SPIN_FALLOFF
  //   vr = -INWARD_PULL * r * ω
  BASE_SPIN: 0.05,
  R_REF: 1000,
  SPIN_FALLOFF: 1.2,
  INWARD_PULL: 0.12,
  REF_AREA: 30000,
  SPEED_FACTOR_MIN: 0.35,
  SPEED_FACTOR_MAX: 4,

  // Tile population: density ∝ (r / R_REF)^-DENSITY_FALLOFF
  DENSITY_AT_REF: 1 / 80000,        // tiles per square pixel at R_REF
  DENSITY_FALLOFF: 0.8,
  // Sizes are picked log-uniformly between TILE_MIN_SIZE and a max that grows outward,
  // so medium tiles are common but tiny shards and huge slabs both turn up.
  TILE_MIN_SIZE: 30,
  TILE_MAX_SIZE_CORE: 170,
  TILE_MAX_SIZE: 280,

  // Cracking and shattering
  MIN_AREA: 900,                    // smaller scraps can't hold the player (they still drift on)
  SOLID_AREA: 2250,                 // tiles smaller than this never crack (too small to split)
  CRACK_TIME: 3.5,                  // seconds from a tile starting to crack to it breaking, any size
  WAKE_DISTANCE: 8,                 // px you must walk on the piece you're left on before it starts cracking
  SHARD_SIZE: 20,                   // one piece per this many px of tile width (sqrt of area)
  SHARDS_MIN: 2,
  SHARDS_MAX: 14,
  CLEAN_SPLIT_MAX: 3,               // tiles breaking into this few pieces split evenly instead of shattering
  SHATTER_KICK: 45,                 // px/s push away from the impact point
  KICK_DAMPING: 1.5,                // how fast knocks (from shatters and collisions) fade back into the current

  // Collisions between tiles
  COLLIDE_BOUNCE: 0.25,             // 0 = thud, 1 = perfectly bouncy
  COLLIDE_PUSH: 0.6,                // fraction of any overlap pushed apart each frame
  COLLIDE_SLOP: 0.5,                // px of overlap allowed before pushing (stops jitter)
  CORE_NO_COLLIDE: 210,             // inside this radius tiles stop colliding so they can fall in
  SPIN_DAMPING: 0.6,                // how fast collision spin settles back to the tile's natural spin
  MAX_SPIN: 3,                      // rad/s cap
  IMPACT_SPEED: 45,                 // closing speed (px/s) that throws sparks

  // Player
  WALK_SPEED: 110,                  // px/s across a tile at full joystick
  STEP_REACH: 14,                   // can step over gaps this wide onto a neighbouring tile
  JUMP_MIN: 70,                     // jump slider at rest (a quick tap)
  JUMP_RANGE: 260,                  // jump slider pushed to the top
  // Double-tap-and-drag and the controller's right stick snap to these three
  // distances (short, medium, long); the drag is split into three equal bands.
  JUMP_SNAPS: [90, 170, 260],
  CHARGE_TIME: 0.8,                 // keyboard: seconds holding Space to reach JUMP_RANGE
  AIR_TIME: 0.45,                   // seconds in the air; tiles keep moving meanwhile

  // Double-tap-and-drag jump (one-handed): tap, then tap again and hold, and drag
  // the way you want to jump. Drag distance sets jump distance; let go to jump.
  // Letting go inside AIM_DEADZONE cancels.
  TAP_MAX_TIME: 0.25,               // a touch shorter than this (s)...
  TAP_MAX_MOVE: 12,                 // ...that moves less than this (px) counts as a tap
  DOUBLE_TAP_TIME: 0.35,            // second touch must start within this long (s) after the tap
  DOUBLE_TAP_DIST: 70,              // ...and this close (px) to it
  AIM_DEADZONE: 20,                 // px of drag that does nothing (let go here to cancel)
  AIM_DRAG: 110,                    // px of drag for a full-length jump

  // Game controller
  PAD_DEADZONE: 0.2,                // left stick (walk)
  PAD_AIM_DEADZONE: 0.25,           // right stick (aim); centred = cancel
  PLAYER_R: 10,
  FALL_TIME: 1.2,

  // Camera
  VIEW_SIZE: 1000,                  // world pixels across the shorter screen side
  PLAYER_SCREEN_Y: 0.55,            // player sits a bit below centre so you see ahead
  CAMERA_TURN: 3,                   // how quickly the view swings round behind you once you stop walking
  // Zoom follows the tile you're standing on: ZOOM_NEAR on tiles ZOOM_SMALL_W wide or less,
  // 1 (normal) on tiles ZOOM_LARGE_W wide or more, in between on medium tiles.
  ZOOM_NEAR: 1.5,
  ZOOM_SMALL_W: 60,
  ZOOM_LARGE_W: 200,
  ZOOM_SPEED: 2,

  // On-screen controls
  JOY_DEADZONE: 0.25,               // fraction of the joystick radius that does nothing (a resting thumb)
};
