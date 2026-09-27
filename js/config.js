// Every tunable number in the game lives here. Tweak, save, refresh.
export const CONFIG = {
  // World layout (all distances in world pixels from the vortex centre)
  RIM: 4500,                        // reach this radius to win
  CORE_R: 70,                       // tiles closer than this are swallowed
  RINGS: [900, 1600, 2300, 3000, 3700], // checkpoint rings between start and rim
  START_R: 260,

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
  MIN_AREA: 900,                    // smaller fragments crumble to rubble
  CRACK_BASE: 0.4,                  // crack time = CRACK_BASE + sqrt(area) * CRACK_PER_SIZE
  CRACK_PER_SIZE: 1 / 120,
  SHARDS_MIN: 5,
  SHARDS_MAX: 14,
  SHARD_AREA: 3000,                 // one extra shard per this much tile area
  SHATTER_KICK: 45,                 // px/s push away from the impact point
  KICK_DAMPING: 1.5,

  // Player
  WALK_SPEED: 110,                  // px/s across a tile at full joystick
  STEP_REACH: 14,                   // can step over gaps this wide onto a neighbouring tile
  JUMP_MIN: 70,                     // jump slider at rest (a quick tap)
  JUMP_RANGE: 260,                  // jump slider pushed to the top
  CHARGE_TIME: 0.8,                 // keyboard: seconds holding Space to fill the slider
  AIR_TIME: 0.45,                   // seconds in the air; tiles keep moving meanwhile
  PLAYER_R: 10,
  FALL_TIME: 1.2,

  // Camera
  VIEW_SIZE: 1000,                  // world pixels across the shorter screen side
  PLAYER_SCREEN_Y: 0.55,            // player sits a bit below centre so you see outward

  // On-screen controls
  JOY_DEADZONE: 0.15,               // fraction of the joystick radius that does nothing
};
