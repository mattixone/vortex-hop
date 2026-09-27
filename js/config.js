// Every tunable number in the game lives here. Tweak, save, refresh.
export const CONFIG = {
  // World layout (all distances in world pixels from the vortex centre)
  RIM: 3000,                        // reach this radius to win
  CORE_R: 70,                       // tiles closer than this are swallowed
  RINGS: [800, 1350, 1900, 2450],   // checkpoint rings between start and rim
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
  SPEED_FACTOR_MIN: 0.5,
  SPEED_FACTOR_MAX: 4,

  // Tile population: density ∝ (r / R_REF)^-DENSITY_FALLOFF
  DENSITY_AT_REF: 1 / 55000,        // tiles per square pixel at R_REF
  DENSITY_FALLOFF: 0.8,
  TILE_MIN_SIZE: 55,
  TILE_MAX_SIZE: 180,

  // Cracking and shattering
  MIN_AREA: 900,                    // smaller fragments crumble to rubble
  CRACK_BASE: 0.8,                  // crack time = CRACK_BASE + sqrt(area) * CRACK_PER_SIZE
  CRACK_PER_SIZE: 1 / 60,
  SHARDS_MIN: 5,
  SHARDS_MAX: 14,
  SHARD_AREA: 3000,                 // one extra shard per this much tile area
  SHATTER_KICK: 45,                 // px/s push away from the impact point
  KICK_DAMPING: 1.5,

  // Player
  WALK_SPEED: 110,                  // px/s across a tile at full joystick
  STEP_REACH: 14,                   // can step over gaps this wide onto a neighbouring tile
  JUMP_MIN: 70,                     // a quick tap of the jump button
  JUMP_RANGE: 260,                  // a fully charged jump
  CHARGE_TIME: 0.8,                 // seconds of holding to reach JUMP_RANGE
  AIR_TIME: 0.45,                   // seconds in the air; tiles keep moving meanwhile
  PLAYER_R: 10,
  FALL_TIME: 1.2,

  // Camera
  VIEW_SIZE: 1000,                  // world pixels across the shorter screen side
  PLAYER_SCREEN_Y: 0.55,            // player sits a bit below centre so you see outward

  // On-screen controls
  JOY_DEADZONE: 0.15,               // fraction of the joystick radius that does nothing
};
