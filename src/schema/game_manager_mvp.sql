-- Game Manager Football — MVP schema v3
-- SQLite 3.35+
-- Scope: club football only; minute-by-minute match simulation; no transfer market.
-- Decisions applied: multi-source qualification pools with deduplication and priority;
-- explicit/tier-based promotion and relegation; normalized stage groups; scheduling constraints;
-- detailed managed matches and accelerated AI batch processing; versioned checkpoints.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

-- =========================================================
-- WORLD / CLUBS
-- =========================================================

CREATE TABLE nation (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT UNIQUE
);

CREATE TABLE city (
    id INTEGER PRIMARY KEY,
    nation_id INTEGER NOT NULL REFERENCES nation(id),
    name TEXT NOT NULL,
    climate_profile TEXT NOT NULL DEFAULT 'TEMPERATE',
    UNIQUE (nation_id, name)
);

CREATE TABLE club (
    id INTEGER PRIMARY KEY,
    nation_id INTEGER NOT NULL REFERENCES nation(id),
    city_id INTEGER REFERENCES city(id),
    name TEXT NOT NULL,
    short_name TEXT,
    reputation INTEGER NOT NULL DEFAULT 50 CHECK (reputation BETWEEN 0 AND 100),
    primary_color TEXT,
    secondary_color TEXT,
    UNIQUE (nation_id, name)
);

CREATE TABLE stadium (
    id INTEGER PRIMARY KEY,
    club_id INTEGER REFERENCES club(id),
    city_id INTEGER REFERENCES city(id),
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 10000 CHECK (capacity >= 0),
    pitch_quality INTEGER NOT NULL DEFAULT 70 CHECK (pitch_quality BETWEEN 0 AND 100),
    UNIQUE (city_id, name)
);

-- =========================================================
-- PEOPLE / PLAYERS
-- =========================================================

CREATE TABLE person (
    id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    birth_date TEXT,
    nationality_id INTEGER REFERENCES nation(id)
);

CREATE TABLE player (
    person_id INTEGER PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
    potential INTEGER NOT NULL DEFAULT 50 CHECK (potential BETWEEN 0 AND 100),
    preferred_foot TEXT NOT NULL DEFAULT 'RIGHT'
        CHECK (preferred_foot IN ('LEFT', 'RIGHT', 'BOTH')),
    goalkeeper INTEGER NOT NULL DEFAULT 0 CHECK (goalkeeper IN (0,1))
);

-- Keep simulation attributes in one row to avoid per-player joins in the hot path.
-- Ratings use a consistent 0..100 scale.
CREATE TABLE player_attribute (
    player_id INTEGER PRIMARY KEY REFERENCES player(person_id) ON DELETE CASCADE,
    pace INTEGER NOT NULL DEFAULT 50 CHECK (pace BETWEEN 0 AND 100),
    acceleration INTEGER NOT NULL DEFAULT 50 CHECK (acceleration BETWEEN 0 AND 100),
    stamina INTEGER NOT NULL DEFAULT 50 CHECK (stamina BETWEEN 0 AND 100),
    strength INTEGER NOT NULL DEFAULT 50 CHECK (strength BETWEEN 0 AND 100),
    agility INTEGER NOT NULL DEFAULT 50 CHECK (agility BETWEEN 0 AND 100),
    positioning INTEGER NOT NULL DEFAULT 50 CHECK (positioning BETWEEN 0 AND 100),
    anticipation INTEGER NOT NULL DEFAULT 50 CHECK (anticipation BETWEEN 0 AND 100),
    decisions INTEGER NOT NULL DEFAULT 50 CHECK (decisions BETWEEN 0 AND 100),
    composure INTEGER NOT NULL DEFAULT 50 CHECK (composure BETWEEN 0 AND 100),
    teamwork INTEGER NOT NULL DEFAULT 50 CHECK (teamwork BETWEEN 0 AND 100),
    work_rate INTEGER NOT NULL DEFAULT 50 CHECK (work_rate BETWEEN 0 AND 100),
    passing INTEGER NOT NULL DEFAULT 50 CHECK (passing BETWEEN 0 AND 100),
    vision INTEGER NOT NULL DEFAULT 50 CHECK (vision BETWEEN 0 AND 100),
    crossing INTEGER NOT NULL DEFAULT 50 CHECK (crossing BETWEEN 0 AND 100),
    dribbling INTEGER NOT NULL DEFAULT 50 CHECK (dribbling BETWEEN 0 AND 100),
    finishing INTEGER NOT NULL DEFAULT 50 CHECK (finishing BETWEEN 0 AND 100),
    long_shots INTEGER NOT NULL DEFAULT 50 CHECK (long_shots BETWEEN 0 AND 100),
    heading INTEGER NOT NULL DEFAULT 50 CHECK (heading BETWEEN 0 AND 100),
    tackling INTEGER NOT NULL DEFAULT 50 CHECK (tackling BETWEEN 0 AND 100),
    marking INTEGER NOT NULL DEFAULT 50 CHECK (marking BETWEEN 0 AND 100),
    aggression INTEGER NOT NULL DEFAULT 50 CHECK (aggression BETWEEN 0 AND 100),
    concentration INTEGER NOT NULL DEFAULT 50 CHECK (concentration BETWEEN 0 AND 100),
    reflexes INTEGER NOT NULL DEFAULT 50 CHECK (reflexes BETWEEN 0 AND 100),
    handling INTEGER NOT NULL DEFAULT 50 CHECK (handling BETWEEN 0 AND 100),
    aerial_reach INTEGER NOT NULL DEFAULT 50 CHECK (aerial_reach BETWEEN 0 AND 100)
);

CREATE TABLE player_position (
    player_id INTEGER NOT NULL REFERENCES player(person_id) ON DELETE CASCADE,
    position_code TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 50 CHECK (rating BETWEEN 0 AND 100),
    PRIMARY KEY (player_id, position_code)
);

-- A single current club membership for MVP. Loans and transfer history are deferred.
CREATE TABLE squad_membership (
    player_id INTEGER PRIMARY KEY REFERENCES player(person_id) ON DELETE CASCADE,
    club_id INTEGER NOT NULL REFERENCES club(id),
    shirt_number INTEGER CHECK (shirt_number BETWEEN 1 AND 99),
    squad_status TEXT NOT NULL DEFAULT 'FIRST_TEAM'
        CHECK (squad_status IN ('FIRST_TEAM', 'RESERVE', 'YOUTH'))
);

-- Fatigue, morale, sharpness and match availability are mutable campaign state.
CREATE TABLE player_condition (
    player_id INTEGER PRIMARY KEY REFERENCES player(person_id) ON DELETE CASCADE,
    energy INTEGER NOT NULL DEFAULT 100 CHECK (energy BETWEEN 0 AND 100),
    morale INTEGER NOT NULL DEFAULT 50 CHECK (morale BETWEEN 0 AND 100),
    sharpness INTEGER NOT NULL DEFAULT 50 CHECK (sharpness BETWEEN 0 AND 100),
    injured_until TEXT,
    suspension_matches INTEGER NOT NULL DEFAULT 0 CHECK (suspension_matches >= 0)
);

-- =========================================================
-- TACTICS
-- =========================================================

CREATE TABLE formation (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

-- Position coordinates are presentation-independent tactical slots (0..100).
CREATE TABLE formation_slot (
    id INTEGER PRIMARY KEY,
    formation_id INTEGER NOT NULL REFERENCES formation(id) ON DELETE CASCADE,
    slot_number INTEGER NOT NULL,
    position_code TEXT NOT NULL,
    x REAL NOT NULL CHECK (x BETWEEN 0 AND 100),
    y REAL NOT NULL CHECK (y BETWEEN 0 AND 100),
    UNIQUE (formation_id, slot_number)
);

CREATE TABLE tactical_instruction (
    id INTEGER PRIMARY KEY,
    instruction_key TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    value_type TEXT NOT NULL CHECK (value_type IN ('NUMBER', 'BOOLEAN', 'ENUM'))
);

CREATE TABLE team_tactic (
    club_id INTEGER PRIMARY KEY REFERENCES club(id) ON DELETE CASCADE,
    formation_id INTEGER NOT NULL REFERENCES formation(id),
    mentality TEXT NOT NULL DEFAULT 'BALANCED'
        CHECK (mentality IN ('VERY_DEFENSIVE','DEFENSIVE','BALANCED','ATTACKING','VERY_ATTACKING')),
    pressing INTEGER NOT NULL DEFAULT 50 CHECK (pressing BETWEEN 0 AND 100),
    tempo INTEGER NOT NULL DEFAULT 50 CHECK (tempo BETWEEN 0 AND 100),
    defensive_line INTEGER NOT NULL DEFAULT 50 CHECK (defensive_line BETWEEN 0 AND 100),
    width INTEGER NOT NULL DEFAULT 50 CHECK (width BETWEEN 0 AND 100),
    passing_directness INTEGER NOT NULL DEFAULT 50 CHECK (passing_directness BETWEEN 0 AND 100),
    counter_attack INTEGER NOT NULL DEFAULT 1 CHECK (counter_attack IN (0,1))
);

CREATE TABLE team_tactic_instruction (
    club_id INTEGER NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    instruction_id INTEGER NOT NULL REFERENCES tactical_instruction(id),
    value TEXT NOT NULL,
    PRIMARY KEY (club_id, instruction_id)
);

-- Persisted substitutions / tactical changes can be scheduled for an in-progress match.
CREATE TABLE match_tactical_change (
    id INTEGER PRIMARY KEY,
    fixture_id INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
    minute INTEGER NOT NULL CHECK (minute BETWEEN 1 AND 120),
    club_id INTEGER NOT NULL REFERENCES club(id),
    change_type TEXT NOT NULL CHECK (change_type IN ('MENTALITY','FORMATION','INSTRUCTION','SUBSTITUTION')),
    payload TEXT NOT NULL,
    applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0,1))
);

-- =========================================================
-- COMPETITION MODEL — DO NOT COLLAPSE THIS INTO ONE TABLE
-- =========================================================

CREATE TABLE competition (
    id INTEGER PRIMARY KEY,
    nation_id INTEGER REFERENCES nation(id),
    name TEXT NOT NULL,
    code TEXT UNIQUE,
    competition_kind TEXT NOT NULL DEFAULT 'LEAGUE'
        CHECK (competition_kind IN ('LEAGUE','CUP','SUPER_CUP','PLAYOFF','OTHER')),
    UNIQUE (nation_id, name)
);

CREATE TABLE competition_season (
    id INTEGER PRIMARY KEY,
    competition_id INTEGER NOT NULL REFERENCES competition(id),
    season_year INTEGER NOT NULL,
    start_date TEXT,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED','ACTIVE','COMPLETED')),
    UNIQUE (competition_id, season_year)
);

CREATE TABLE competition_stage (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES competition_season(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stage_order INTEGER NOT NULL,
    stage_kind TEXT NOT NULL CHECK (stage_kind IN ('LEAGUE','GROUPS','KNOCKOUT','SINGLE_MATCH','FINAL')),
    UNIQUE (season_id, stage_order),
    UNIQUE (season_id, name)
);

-- Generic stage configuration; fields are interpreted according to stage_kind.
CREATE TABLE stage_format (
    stage_id INTEGER PRIMARY KEY REFERENCES competition_stage(id) ON DELETE CASCADE,
    group_count INTEGER NOT NULL DEFAULT 1 CHECK (group_count >= 1),
    legs INTEGER NOT NULL DEFAULT 1 CHECK (legs >= 1),
    home_away INTEGER NOT NULL DEFAULT 1 CHECK (home_away IN (0,1)),
    extra_time INTEGER NOT NULL DEFAULT 0 CHECK (extra_time IN (0,1)),
    penalties INTEGER NOT NULL DEFAULT 0 CHECK (penalties IN (0,1)),
    away_goals_rule INTEGER NOT NULL DEFAULT 0 CHECK (away_goals_rule IN (0,1)),
    win_points INTEGER NOT NULL DEFAULT 3,
    draw_points INTEGER NOT NULL DEFAULT 1,
    loss_points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stage_group (
    id INTEGER PRIMARY KEY,
    stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    group_code TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order >= 1),
    UNIQUE (stage_id, group_code),
    UNIQUE (stage_id, sort_order)
);

CREATE TABLE stage_participant (
    stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    club_id INTEGER NOT NULL REFERENCES club(id),
    group_id INTEGER NOT NULL REFERENCES stage_group(id),
    seed INTEGER CHECK (seed IS NULL OR seed > 0),
    qualification_pool_id INTEGER REFERENCES qualification_pool(id),
    source_note TEXT,
    PRIMARY KEY (stage_id, club_id)
);

CREATE TABLE stage_participant_source (
    id INTEGER PRIMARY KEY,
    target_stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('EXPLICIT_TEAMS','FINAL_POSITION','CUP_WINNER','CUP_RUNNER_UP','BEST_RANKED')),
    source_stage_id INTEGER REFERENCES competition_stage(id),
    position_from INTEGER,
    position_to INTEGER,
    rank_from INTEGER,
    rank_to INTEGER,
    filter_nation_id INTEGER REFERENCES nation(id),
    CHECK (
        (source_type = 'EXPLICIT_TEAMS') OR
        (source_stage_id IS NOT NULL AND
         (source_type NOT IN ('FINAL_POSITION','BEST_RANKED') OR
          (position_from IS NOT NULL AND position_to >= position_from)))
    )
);

-- Participating clubs are season-specific and may be seeded by source rules.
CREATE TABLE competition_entry (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES competition_season(id) ON DELETE CASCADE,
    club_id INTEGER NOT NULL REFERENCES club(id),
    seed INTEGER,
    entry_source TEXT NOT NULL DEFAULT 'MANUAL',
    UNIQUE (season_id, club_id)
);

CREATE TABLE stage_standing_rule (
    stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    rule_order INTEGER NOT NULL,
    rule_key TEXT NOT NULL CHECK (rule_key IN
        ('POINTS','GOAL_DIFFERENCE','GOALS_FOR','HEAD_TO_HEAD','WINS','FAIR_PLAY','DRAW')),
    PRIMARY KEY (stage_id, rule_order),
    UNIQUE (stage_id, rule_key)
);

-- Declarative outcomes from final positions: continental/national cup places,
-- promotion, relegation, playoff qualification, or next-stage qualification.
-- A pool represents one destination with a fixed number of places. Multiple source
-- rows can feed the same pool; the engine orders candidates and deduplicates clubs.
CREATE TABLE qualification_pool (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target_stage_id INTEGER REFERENCES competition_stage(id) ON DELETE CASCADE,
    target_season_id INTEGER REFERENCES competition_season(id) ON DELETE CASCADE,
    slot_count INTEGER NOT NULL CHECK (slot_count > 0),
    priority_mode TEXT NOT NULL DEFAULT 'RULE_THEN_POSITION'
        CHECK (priority_mode IN ('RULE_THEN_POSITION','POSITION_THEN_RULE','SOURCE_ORDER')),
    duplicate_club_policy TEXT NOT NULL DEFAULT 'KEEP_BEST'
        CHECK (duplicate_club_policy IN ('KEEP_BEST','SKIP_DUPLICATE','ALLOW_DUPLICATE')),
    CHECK (
        (target_stage_id IS NOT NULL AND target_season_id IS NULL) OR
        (target_stage_id IS NULL AND target_season_id IS NOT NULL)
    )
);

CREATE TABLE qualification_pool_source (
    id INTEGER PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES qualification_pool(id) ON DELETE CASCADE,
    source_stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    position_from INTEGER NOT NULL CHECK (position_from > 0),
    position_to INTEGER NOT NULL CHECK (position_to >= position_from),
    source_outcome TEXT NOT NULL DEFAULT 'FINAL_POSITION'
        CHECK (source_outcome IN ('FINAL_POSITION','CUP_WINNER','CUP_RUNNER_UP','BEST_RANKED')),
    rule_priority INTEGER NOT NULL DEFAULT 100,
    filter_nation_id INTEGER REFERENCES nation(id),
    UNIQUE (pool_id, source_stage_id, position_from, position_to, source_outcome)
);

-- Movement between tiers can be tier-based or point to an explicit destination.
CREATE TABLE promotion_relegation_rule (
    id INTEGER PRIMARY KEY,
    source_stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    position_from INTEGER NOT NULL CHECK (position_from > 0),
    position_to INTEGER NOT NULL CHECK (position_to >= position_from),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('PROMOTE','RELEGATE','PLAYOFF')),
    target_competition_id INTEGER REFERENCES competition(id),
    target_stage_id INTEGER REFERENCES competition_stage(id),
    target_tier INTEGER,
    priority INTEGER NOT NULL DEFAULT 100,
    CHECK (
        (target_competition_id IS NOT NULL AND target_tier IS NULL) OR
        (target_competition_id IS NULL AND target_tier IS NOT NULL) OR
        (target_competition_id IS NULL AND target_tier IS NULL)
    ),
    CHECK (target_stage_id IS NULL OR target_competition_id IS NOT NULL)
);

-- Rounds allow calendars with gaps, legs, rescheduling and irregular cup rounds.
CREATE TABLE competition_round (
    id INTEGER PRIMARY KEY,
    stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    UNIQUE (stage_id, round_number)
);

CREATE TABLE fixture (
    id INTEGER PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES competition_round(id) ON DELETE CASCADE,
    home_club_id INTEGER NOT NULL REFERENCES club(id),
    away_club_id INTEGER NOT NULL REFERENCES club(id),
    stadium_id INTEGER REFERENCES stadium(id),
    scheduled_at TEXT,
    scheduled_end_at TEXT,
    status TEXT NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','POSTPONED','CANCELLED')),
    home_score INTEGER,
    away_score INTEGER,
    home_penalties INTEGER,
    away_penalties INTEGER,
    current_minute INTEGER NOT NULL DEFAULT 0 CHECK (current_minute BETWEEN 0 AND 120),
    random_seed INTEGER,
    CHECK (home_club_id <> away_club_id),
    CHECK (scheduled_end_at IS NULL OR scheduled_at IS NULL OR scheduled_end_at > scheduled_at)
);

-- Standings are a rebuildable cache. Source of truth remains completed fixtures.
CREATE TABLE stage_standing (
    stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    club_id INTEGER NOT NULL REFERENCES club(id),
    group_id INTEGER NOT NULL REFERENCES stage_group(id) ON DELETE CASCADE,
    played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    goals_for INTEGER NOT NULL DEFAULT 0,
    goals_against INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    fair_play_points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (stage_id, club_id, group_id)
);

-- =========================================================
-- CALENDAR / SCHEDULING CONSTRAINTS
-- =========================================================

CREATE TABLE schedule_profile (
    id INTEGER PRIMARY KEY,
    stage_id INTEGER NOT NULL UNIQUE REFERENCES competition_stage(id) ON DELETE CASCADE,
    min_rest_hours INTEGER NOT NULL DEFAULT 48 CHECK (min_rest_hours >= 0),
    max_matches_7_days INTEGER NOT NULL DEFAULT 3 CHECK (max_matches_7_days >= 1),
    default_match_duration_minutes INTEGER NOT NULL DEFAULT 120
        CHECK (default_match_duration_minutes BETWEEN 30 AND 240),
    home_away_balance INTEGER NOT NULL DEFAULT 1 CHECK (home_away_balance IN (0,1)),
    avoid_same_opponent_consecutive INTEGER NOT NULL DEFAULT 1
        CHECK (avoid_same_opponent_consecutive IN (0,1)),
    travel_fatigue_enabled INTEGER NOT NULL DEFAULT 1 CHECK (travel_fatigue_enabled IN (0,1))
);

CREATE TABLE schedule_blackout (
    id INTEGER PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('CLUB','STADIUM','COMPETITION')),
    club_id INTEGER REFERENCES club(id) ON DELETE CASCADE,
    stadium_id INTEGER REFERENCES stadium(id) ON DELETE CASCADE,
    competition_id INTEGER REFERENCES competition(id) ON DELETE CASCADE,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    CHECK (ends_at > starts_at),
    CHECK (
        (scope_type = 'CLUB' AND club_id IS NOT NULL AND stadium_id IS NULL AND competition_id IS NULL) OR
        (scope_type = 'STADIUM' AND stadium_id IS NOT NULL AND club_id IS NULL AND competition_id IS NULL) OR
        (scope_type = 'COMPETITION' AND competition_id IS NOT NULL AND club_id IS NULL AND stadium_id IS NULL)
    )
);

CREATE TABLE stadium_availability (
    id INTEGER PRIMARY KEY,
    stadium_id INTEGER NOT NULL REFERENCES stadium(id) ON DELETE CASCADE,
    available_from TEXT NOT NULL,
    available_until TEXT NOT NULL,
    reason TEXT,
    CHECK (available_until > available_from)
);

CREATE TABLE travel_route (
    from_city_id INTEGER NOT NULL REFERENCES city(id),
    to_city_id INTEGER NOT NULL REFERENCES city(id),
    distance_km REAL NOT NULL CHECK (distance_km >= 0),
    estimated_hours REAL NOT NULL CHECK (estimated_hours >= 0),
    travel_mode TEXT NOT NULL DEFAULT 'BUS'
        CHECK (travel_mode IN ('BUS','TRAIN','PLANE','MIXED')),
    PRIMARY KEY (from_city_id, to_city_id),
    CHECK (from_city_id <> to_city_id)
);

-- Declarative constraints not safely reducible to simple columns. The engine interprets
-- params_json and applies these during candidate calendar generation.
CREATE TABLE schedule_constraint (
    id INTEGER PRIMARY KEY,
    stage_id INTEGER NOT NULL REFERENCES competition_stage(id) ON DELETE CASCADE,
    constraint_type TEXT NOT NULL CHECK (constraint_type IN (
        'MIN_REST_HOURS','MAX_MATCHES_IN_WINDOW','HOME_AWAY_BALANCE',
        'AVOID_CONSECUTIVE_OPPONENT','TRAVEL_LIMIT','STADIUM_AVAILABILITY',
        'CLUB_BLACKOUT','WEATHER_RISK','DERBY_SEPARATION'
    )),
    params_json TEXT NOT NULL DEFAULT '{}',
    severity TEXT NOT NULL DEFAULT 'HARD' CHECK (severity IN ('HARD','SOFT')),
    priority INTEGER NOT NULL DEFAULT 100,
    CHECK (json_valid(params_json))
);

-- =========================================================
-- MATCH SIMULATION / MOMENTUM
-- =========================================================

CREATE TABLE match_lineup (
    fixture_id INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
    club_id INTEGER NOT NULL REFERENCES club(id),
    player_id INTEGER NOT NULL REFERENCES player(person_id),
    slot_number INTEGER NOT NULL,
    is_starting INTEGER NOT NULL DEFAULT 1 CHECK (is_starting IN (0,1)),
    position_code TEXT NOT NULL,
    role_code TEXT,
    PRIMARY KEY (fixture_id, player_id),
    UNIQUE (fixture_id, club_id, slot_number)
);

CREATE TABLE match_player_state (
    fixture_id INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES player(person_id),
    club_id INTEGER NOT NULL REFERENCES club(id),
    energy INTEGER NOT NULL CHECK (energy BETWEEN 0 AND 100),
    rating REAL NOT NULL DEFAULT 6.0,
    minutes_played INTEGER NOT NULL DEFAULT 0,
    goals INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,
    yellow_cards INTEGER NOT NULL DEFAULT 0,
    red_card INTEGER NOT NULL DEFAULT 0 CHECK (red_card IN (0,1)),
    substituted_out INTEGER NOT NULL DEFAULT 0 CHECK (substituted_out IN (0,1)),
    PRIMARY KEY (fixture_id, player_id)
);

CREATE TABLE match_event (
    id INTEGER PRIMARY KEY,
    fixture_id INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
    minute INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 120),
    added_time INTEGER NOT NULL DEFAULT 0,
    club_id INTEGER REFERENCES club(id),
    player_id INTEGER REFERENCES player(person_id),
    secondary_player_id INTEGER REFERENCES player(person_id),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'KICK_OFF','CHANCE','SHOT','SHOT_ON_TARGET','GOAL','OWN_GOAL',
        'SAVE','MISS','BLOCK','CORNER','FOUL','YELLOW_CARD','RED_CARD',
        'OFFSIDE','SUBSTITUTION','TACTIC_CHANGE','INJURY','PENALTY',
        'PENALTY_GOAL','PENALTY_MISS','HALF_TIME','FULL_TIME'
    )),
    x REAL,
    y REAL,
    xg REAL,
    description TEXT
);

-- One compact sample per simulated minute supports a momentum chart without
-- requiring the UI to reconstruct pressure from every event.
CREATE TABLE match_momentum (
    fixture_id INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
    minute INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 120),
    home_pressure REAL NOT NULL,
    away_pressure REAL NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    PRIMARY KEY (fixture_id, minute)
);

-- Optional per-match weather override; generated from city profile if absent.
CREATE TABLE match_environment (
    fixture_id INTEGER PRIMARY KEY REFERENCES fixture(id) ON DELETE CASCADE,
    weather TEXT NOT NULL DEFAULT 'CLEAR'
        CHECK (weather IN ('CLEAR','RAIN','HEAVY_RAIN','WIND','HEAT','COLD')),
    temperature_c INTEGER,
    pitch_condition INTEGER NOT NULL DEFAULT 70 CHECK (pitch_condition BETWEEN 0 AND 100)
);

-- Checkpoint for resuming a match after saving/closing the game.
-- state_json contains engine-only transient state (possession, pending actions, RNG state, etc.).
-- Keep it versioned so the TypeScript engine can migrate checkpoints safely.
CREATE TABLE match_simulation_state (
    fixture_id INTEGER PRIMARY KEY REFERENCES fixture(id) ON DELETE CASCADE,
    state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),
    simulation_minute INTEGER NOT NULL DEFAULT 0 CHECK (simulation_minute BETWEEN 0 AND 120),
    added_time INTEGER NOT NULL DEFAULT 0 CHECK (added_time >= 0),
    state_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(state_json)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- INDEXES FOR HOT QUERIES
-- =========================================================

CREATE INDEX idx_entry_season ON competition_entry(season_id, club_id);
CREATE INDEX idx_stage_season_order ON competition_stage(season_id, stage_order);
CREATE INDEX idx_round_stage_number ON competition_round(stage_id, round_number);
CREATE INDEX idx_fixture_round_status ON fixture(round_id, status);
CREATE INDEX idx_fixture_schedule ON fixture(scheduled_at, status);
CREATE INDEX idx_fixture_home ON fixture(home_club_id, status);
CREATE INDEX idx_fixture_away ON fixture(away_club_id, status);
CREATE INDEX idx_lineup_fixture_club ON match_lineup(fixture_id, club_id, is_starting);
CREATE INDEX idx_match_event_fixture_minute ON match_event(fixture_id, minute, id);
CREATE INDEX idx_membership_club ON squad_membership(club_id, player_id);
CREATE INDEX idx_player_position_code ON player_position(position_code, rating);
CREATE INDEX idx_qualification_pool_target_stage ON qualification_pool(target_stage_id);
CREATE INDEX idx_qualification_pool_target_season ON qualification_pool(target_season_id);
CREATE INDEX idx_qualification_source_stage ON qualification_pool_source(source_stage_id, rule_priority);
CREATE INDEX idx_qualification_source_pool ON qualification_pool_source(pool_id, rule_priority);
CREATE INDEX idx_promotion_relegation_source ON promotion_relegation_rule(source_stage_id, priority);
CREATE INDEX idx_stage_group_stage ON stage_group(stage_id, sort_order);
CREATE INDEX idx_stage_participant_group ON stage_participant(stage_id, group_id);
CREATE INDEX idx_schedule_blackout_club ON schedule_blackout(club_id, starts_at, ends_at);
CREATE INDEX idx_schedule_blackout_stadium ON schedule_blackout(stadium_id, starts_at, ends_at);
CREATE INDEX idx_stadium_availability ON stadium_availability(stadium_id, available_from, available_until);
CREATE INDEX idx_travel_route_destination ON travel_route(to_city_id, from_city_id);
CREATE INDEX idx_schedule_constraint_stage ON schedule_constraint(stage_id, priority);
CREATE INDEX idx_participant_source_target ON stage_participant_source(target_stage_id);
CREATE INDEX idx_tactical_change_fixture_minute ON match_tactical_change(fixture_id, minute, applied);

-- Guard against lineups containing a club/player unrelated to the fixture.
-- Membership validation is suitable for the MVP because transfers/loans are deferred.
CREATE TRIGGER trg_match_lineup_validate_insert
BEFORE INSERT ON match_lineup
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM fixture f
        WHERE f.id = NEW.fixture_id
          AND NEW.club_id IN (f.home_club_id, f.away_club_id)
    ) THEN RAISE(ABORT, 'lineup club must be one of the fixture clubs') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM squad_membership sm
        WHERE sm.player_id = NEW.player_id AND sm.club_id = NEW.club_id
    ) THEN RAISE(ABORT, 'lineup player must belong to the selected club') END;
END;

CREATE TRIGGER trg_match_lineup_validate_update
BEFORE UPDATE OF fixture_id, club_id, player_id ON match_lineup
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM fixture f
        WHERE f.id = NEW.fixture_id
          AND NEW.club_id IN (f.home_club_id, f.away_club_id)
    ) THEN RAISE(ABORT, 'lineup club must be one of the fixture clubs') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM squad_membership sm
        WHERE sm.player_id = NEW.player_id AND sm.club_id = NEW.club_id
    ) THEN RAISE(ABORT, 'lineup player must belong to the selected club') END;
END;

CREATE TRIGGER trg_tactical_change_validate_insert
BEFORE INSERT ON match_tactical_change
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM fixture f
        WHERE f.id = NEW.fixture_id
          AND NEW.club_id IN (f.home_club_id, f.away_club_id)
    ) THEN RAISE(ABORT, 'tactical change club must be one of the fixture clubs') END;
END;

-- Calendar integrity triggers. Intervals are half-open: a match ending at 18:00
-- does not conflict with another starting at 18:00. ISO-8601 sortable timestamps are expected.
CREATE TRIGGER trg_fixture_schedule_validate_insert
BEFORE INSERT ON fixture
WHEN NEW.status NOT IN ('CANCELLED','POSTPONED') AND NEW.scheduled_at IS NOT NULL
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM fixture f
        WHERE f.status NOT IN ('CANCELLED','POSTPONED')
          AND f.scheduled_at IS NOT NULL
          AND (f.home_club_id IN (NEW.home_club_id, NEW.away_club_id)
               OR f.away_club_id IN (NEW.home_club_id, NEW.away_club_id))
          AND julianday(f.scheduled_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(COALESCE(f.scheduled_end_at, datetime(f.scheduled_at, '+120 minutes'))) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'club has an overlapping fixture') END;

    SELECT CASE WHEN NEW.stadium_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM fixture f
        WHERE f.status NOT IN ('CANCELLED','POSTPONED')
          AND f.stadium_id = NEW.stadium_id
          AND f.scheduled_at IS NOT NULL
          AND julianday(f.scheduled_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(COALESCE(f.scheduled_end_at, datetime(f.scheduled_at, '+120 minutes'))) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'stadium has an overlapping fixture') END;

    SELECT CASE WHEN NEW.stadium_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM schedule_blackout b
        WHERE b.scope_type = 'STADIUM' AND b.stadium_id = NEW.stadium_id
          AND julianday(b.starts_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(b.ends_at) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'stadium is blocked during the requested interval') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM schedule_blackout b
        WHERE b.scope_type = 'CLUB' AND b.club_id IN (NEW.home_club_id, NEW.away_club_id)
          AND julianday(b.starts_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(b.ends_at) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'club is blocked during the requested interval') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM schedule_blackout b
        JOIN competition_round r ON r.id = NEW.round_id
        JOIN competition_stage st ON st.id = r.stage_id
        JOIN competition_season cs ON cs.id = st.season_id
        WHERE b.scope_type = 'COMPETITION' AND b.competition_id = cs.competition_id
          AND julianday(b.starts_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(b.ends_at) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'competition is blocked during the requested interval') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM stadium_availability a
        WHERE a.stadium_id = NEW.stadium_id
    ) AND NOT EXISTS (
        SELECT 1 FROM stadium_availability a
        WHERE a.stadium_id = NEW.stadium_id
          AND julianday(NEW.scheduled_at) >= julianday(a.available_from)
          AND julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes'))) <= julianday(a.available_until)
    ) THEN RAISE(ABORT, 'stadium is not available for the requested interval') END;
END;

CREATE TRIGGER trg_fixture_schedule_validate_update
BEFORE UPDATE OF round_id, home_club_id, away_club_id, stadium_id, scheduled_at, scheduled_end_at, status ON fixture
WHEN NEW.status NOT IN ('CANCELLED','POSTPONED') AND NEW.scheduled_at IS NOT NULL
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM fixture f
        WHERE f.id <> NEW.id
          AND f.status NOT IN ('CANCELLED','POSTPONED')
          AND f.scheduled_at IS NOT NULL
          AND (f.home_club_id IN (NEW.home_club_id, NEW.away_club_id)
               OR f.away_club_id IN (NEW.home_club_id, NEW.away_club_id))
          AND julianday(f.scheduled_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(COALESCE(f.scheduled_end_at, datetime(f.scheduled_at, '+120 minutes'))) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'club has an overlapping fixture') END;

    SELECT CASE WHEN NEW.stadium_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM fixture f
        WHERE f.id <> NEW.id
          AND f.status NOT IN ('CANCELLED','POSTPONED')
          AND f.stadium_id = NEW.stadium_id
          AND f.scheduled_at IS NOT NULL
          AND julianday(f.scheduled_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(COALESCE(f.scheduled_end_at, datetime(f.scheduled_at, '+120 minutes'))) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'stadium has an overlapping fixture') END;
END;


CREATE TRIGGER trg_stage_participant_group_stage_insert
BEFORE INSERT ON stage_participant
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM stage_group g
        WHERE g.id = NEW.group_id AND g.stage_id = NEW.stage_id
    ) THEN RAISE(ABORT, 'participant group must belong to the same stage') END;
END;

CREATE TRIGGER trg_stage_participant_group_stage_update
BEFORE UPDATE OF stage_id, group_id ON stage_participant
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM stage_group g
        WHERE g.id = NEW.group_id AND g.stage_id = NEW.stage_id
    ) THEN RAISE(ABORT, 'participant group must belong to the same stage') END;
END;

CREATE TRIGGER trg_stage_standing_group_stage_insert
BEFORE INSERT ON stage_standing
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM stage_group g
        WHERE g.id = NEW.group_id AND g.stage_id = NEW.stage_id
    ) THEN RAISE(ABORT, 'standing group must belong to the same stage') END;
END;

CREATE TRIGGER trg_stage_standing_group_stage_update
BEFORE UPDATE OF stage_id, group_id ON stage_standing
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM stage_group g
        WHERE g.id = NEW.group_id AND g.stage_id = NEW.stage_id
    ) THEN RAISE(ABORT, 'standing group must belong to the same stage') END;
END;

-- Update path mirrors blackout and stadium-availability checks from the insert path.
CREATE TRIGGER trg_fixture_schedule_blackout_update
BEFORE UPDATE OF round_id, home_club_id, away_club_id, stadium_id, scheduled_at, scheduled_end_at, status ON fixture
WHEN NEW.status NOT IN ('CANCELLED','POSTPONED') AND NEW.scheduled_at IS NOT NULL
BEGIN
    SELECT CASE WHEN NEW.stadium_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM schedule_blackout b
        WHERE b.scope_type = 'STADIUM' AND b.stadium_id = NEW.stadium_id
          AND julianday(b.starts_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(b.ends_at) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'stadium is blocked during the requested interval') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM schedule_blackout b
        WHERE b.scope_type = 'CLUB' AND b.club_id IN (NEW.home_club_id, NEW.away_club_id)
          AND julianday(b.starts_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(b.ends_at) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'club is blocked during the requested interval') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM schedule_blackout b
        JOIN competition_round r ON r.id = NEW.round_id
        JOIN competition_stage st ON st.id = r.stage_id
        JOIN competition_season cs ON cs.id = st.season_id
        WHERE b.scope_type = 'COMPETITION' AND b.competition_id = cs.competition_id
          AND julianday(b.starts_at) < julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes')))
          AND julianday(b.ends_at) > julianday(NEW.scheduled_at)
    ) THEN RAISE(ABORT, 'competition is blocked during the requested interval') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM stadium_availability a WHERE a.stadium_id = NEW.stadium_id
    ) AND NOT EXISTS (
        SELECT 1 FROM stadium_availability a
        WHERE a.stadium_id = NEW.stadium_id
          AND julianday(NEW.scheduled_at) >= julianday(a.available_from)
          AND julianday(COALESCE(NEW.scheduled_end_at, datetime(NEW.scheduled_at, '+120 minutes'))) <= julianday(a.available_until)
    ) THEN RAISE(ABORT, 'stadium is not available for the requested interval') END;
END;

-- =========================================================
-- MINIMAL FICTIONAL SEED DATA
-- =========================================================

INSERT INTO nation (id, name, code) VALUES (1, 'Brasil', 'BRA');
INSERT INTO city (id, nation_id, name, climate_profile) VALUES
    (1, 1, 'Nova Aurora', 'TROPICAL'),
    (2, 1, 'Vale Verde', 'SUBTROPICAL');
INSERT INTO club (id, nation_id, city_id, name, short_name, reputation) VALUES
    (1, 1, 1, 'Aurora Futebol Clube', 'AUR', 68),
    (2, 1, 2, 'Vale Verde Atlético', 'VVA', 62),
    (3, 1, 1, 'União do Norte', 'UDN', 54),
    (4, 1, 2, 'Esporte Clube Horizonte', 'ECH', 48);
INSERT INTO stadium (id, club_id, city_id, name, capacity, pitch_quality) VALUES
    (1, 1, 1, 'Estádio da Aurora', 24000, 78),
    (2, 2, 2, 'Parque Verde', 18000, 72),
    (3, 3, 1, 'Arena do Norte', 12000, 68),
    (4, 4, 2, 'Estádio Horizonte', 9000, 65);

INSERT INTO person (id, full_name, birth_date, nationality_id) VALUES
    (1, 'Enzo Barros', '1997-01-01', 1),
    (2, 'Felipe Esteves', '1998-02-02', 1),
    (3, 'Gustavo Henrique', '1999-03-03', 1),
    (4, 'Heitor Lopes', '2000-04-04', 1),
    (5, 'Ícaro Oliveira', '2001-05-05', 1),
    (6, 'João Ramos', '2002-06-06', 1),
    (7, 'Kaique Barros', '2003-07-07', 1),
    (8, 'Lucas Esteves', '2004-08-08', 1),
    (9, 'Mateus Henrique', '2005-09-09', 1),
    (10, 'Nicolas Lopes', '2006-10-10', 1),
    (11, 'Otávio Oliveira', '1997-11-11', 1),
    (12, 'Pedro Ramos', '1998-12-12', 1),
    (13, 'Rafael Barros', '1999-01-13', 1),
    (14, 'Samuel Esteves', '2000-02-14', 1),
    (15, 'Theo Henrique', '2001-03-15', 1),
    (16, 'Vitor Lopes', '2002-04-16', 1),
    (17, 'Caio Oliveira', '2003-05-17', 1),
    (18, 'Davi Ramos', '2004-06-18', 1),
    (19, 'Gustavo Cardoso', '1997-01-01', 1),
    (20, 'Heitor Ferreira', '1998-02-02', 1),
    (21, 'Ícaro Ibrahim', '1999-03-03', 1),
    (22, 'João Moraes', '2000-04-04', 1),
    (23, 'Kaique Pereira', '2001-05-05', 1),
    (24, 'Lucas Silva', '2002-06-06', 1),
    (25, 'Mateus Cardoso', '2003-07-07', 1),
    (26, 'Nicolas Ferreira', '2004-08-08', 1),
    (27, 'Otávio Ibrahim', '2005-09-09', 1),
    (28, 'Pedro Moraes', '2006-10-10', 1),
    (29, 'Rafael Pereira', '1997-11-11', 1),
    (30, 'Samuel Silva', '1998-12-12', 1),
    (31, 'Theo Cardoso', '1999-01-13', 1),
    (32, 'Vitor Ferreira', '2000-02-14', 1),
    (33, 'Caio Ibrahim', '2001-03-15', 1),
    (34, 'Davi Moraes', '2002-04-16', 1),
    (35, 'Enzo Pereira', '2003-05-17', 1),
    (36, 'Felipe Silva', '2004-06-18', 1),
    (37, 'Ícaro Dias', '1997-01-01', 1),
    (38, 'João Gomes', '1998-02-02', 1),
    (39, 'Kaique Junqueira', '1999-03-03', 1),
    (40, 'Lucas Nascimento', '2000-04-04', 1),
    (41, 'Mateus Queiroz', '2001-05-05', 1),
    (42, 'Nicolas Almeida', '2002-06-06', 1),
    (43, 'Otávio Dias', '2003-07-07', 1),
    (44, 'Pedro Gomes', '2004-08-08', 1),
    (45, 'Rafael Junqueira', '2005-09-09', 1),
    (46, 'Samuel Nascimento', '2006-10-10', 1),
    (47, 'Theo Queiroz', '1997-11-11', 1),
    (48, 'Vitor Almeida', '1998-12-12', 1),
    (49, 'Caio Dias', '1999-01-13', 1),
    (50, 'Davi Gomes', '2000-02-14', 1),
    (51, 'Enzo Junqueira', '2001-03-15', 1),
    (52, 'Felipe Nascimento', '2002-04-16', 1),
    (53, 'Gustavo Queiroz', '2003-05-17', 1),
    (54, 'Heitor Almeida', '2004-06-18', 1),
    (55, 'Kaique Esteves', '1997-01-01', 1),
    (56, 'Lucas Henrique', '1998-02-02', 1),
    (57, 'Mateus Lopes', '1999-03-03', 1),
    (58, 'Nicolas Oliveira', '2000-04-04', 1),
    (59, 'Otávio Ramos', '2001-05-05', 1),
    (60, 'Pedro Barros', '2002-06-06', 1),
    (61, 'Rafael Esteves', '2003-07-07', 1),
    (62, 'Samuel Henrique', '2004-08-08', 1),
    (63, 'Theo Lopes', '2005-09-09', 1),
    (64, 'Vitor Oliveira', '2006-10-10', 1),
    (65, 'Caio Ramos', '1997-11-11', 1),
    (66, 'Davi Barros', '1998-12-12', 1),
    (67, 'Enzo Esteves', '1999-01-13', 1),
    (68, 'Felipe Henrique', '2000-02-14', 1),
    (69, 'Gustavo Lopes', '2001-03-15', 1),
    (70, 'Heitor Oliveira', '2002-04-16', 1),
    (71, 'Ícaro Ramos', '2003-05-17', 1),
    (72, 'João Barros', '2004-06-18', 1);
INSERT INTO player (person_id, potential, preferred_foot, goalkeeper) VALUES
    (1, 58, 'LEFT', 1),
    (2, 65, 'RIGHT', 1),
    (3, 72, 'RIGHT', 0),
    (4, 79, 'RIGHT', 0),
    (5, 55, 'RIGHT', 0),
    (6, 62, 'LEFT', 0),
    (7, 69, 'RIGHT', 0),
    (8, 76, 'RIGHT', 0),
    (9, 83, 'RIGHT', 0),
    (10, 59, 'RIGHT', 0),
    (11, 66, 'LEFT', 0),
    (12, 73, 'RIGHT', 0),
    (13, 80, 'RIGHT', 0),
    (14, 56, 'RIGHT', 0),
    (15, 63, 'RIGHT', 0),
    (16, 70, 'LEFT', 0),
    (17, 77, 'RIGHT', 0),
    (18, 84, 'RIGHT', 0),
    (19, 61, 'LEFT', 1),
    (20, 68, 'RIGHT', 1),
    (21, 75, 'RIGHT', 0),
    (22, 82, 'RIGHT', 0),
    (23, 58, 'RIGHT', 0),
    (24, 65, 'LEFT', 0),
    (25, 72, 'RIGHT', 0),
    (26, 79, 'RIGHT', 0),
    (27, 55, 'RIGHT', 0),
    (28, 62, 'RIGHT', 0),
    (29, 69, 'LEFT', 0),
    (30, 76, 'RIGHT', 0),
    (31, 83, 'RIGHT', 0),
    (32, 59, 'RIGHT', 0),
    (33, 66, 'RIGHT', 0),
    (34, 73, 'LEFT', 0),
    (35, 80, 'RIGHT', 0),
    (36, 56, 'RIGHT', 0),
    (37, 64, 'LEFT', 1),
    (38, 71, 'RIGHT', 1),
    (39, 78, 'RIGHT', 0),
    (40, 85, 'RIGHT', 0),
    (41, 61, 'RIGHT', 0),
    (42, 68, 'LEFT', 0),
    (43, 75, 'RIGHT', 0),
    (44, 82, 'RIGHT', 0),
    (45, 58, 'RIGHT', 0),
    (46, 65, 'RIGHT', 0),
    (47, 72, 'LEFT', 0),
    (48, 79, 'RIGHT', 0),
    (49, 55, 'RIGHT', 0),
    (50, 62, 'RIGHT', 0),
    (51, 69, 'RIGHT', 0),
    (52, 76, 'LEFT', 0),
    (53, 83, 'RIGHT', 0),
    (54, 59, 'RIGHT', 0),
    (55, 67, 'LEFT', 1),
    (56, 74, 'RIGHT', 1),
    (57, 81, 'RIGHT', 0),
    (58, 57, 'RIGHT', 0),
    (59, 64, 'RIGHT', 0),
    (60, 71, 'LEFT', 0),
    (61, 78, 'RIGHT', 0),
    (62, 85, 'RIGHT', 0),
    (63, 61, 'RIGHT', 0),
    (64, 68, 'RIGHT', 0),
    (65, 75, 'LEFT', 0),
    (66, 82, 'RIGHT', 0),
    (67, 58, 'RIGHT', 0),
    (68, 65, 'RIGHT', 0),
    (69, 72, 'RIGHT', 0),
    (70, 79, 'LEFT', 0),
    (71, 55, 'RIGHT', 0),
    (72, 62, 'RIGHT', 0);
INSERT INTO player_attribute (player_id) VALUES
    (1),
    (2),
    (3),
    (4),
    (5),
    (6),
    (7),
    (8),
    (9),
    (10),
    (11),
    (12),
    (13),
    (14),
    (15),
    (16),
    (17),
    (18),
    (19),
    (20),
    (21),
    (22),
    (23),
    (24),
    (25),
    (26),
    (27),
    (28),
    (29),
    (30),
    (31),
    (32),
    (33),
    (34),
    (35),
    (36),
    (37),
    (38),
    (39),
    (40),
    (41),
    (42),
    (43),
    (44),
    (45),
    (46),
    (47),
    (48),
    (49),
    (50),
    (51),
    (52),
    (53),
    (54),
    (55),
    (56),
    (57),
    (58),
    (59),
    (60),
    (61),
    (62),
    (63),
    (64),
    (65),
    (66),
    (67),
    (68),
    (69),
    (70),
    (71),
    (72);
INSERT INTO player_position (player_id, position_code, rating) VALUES
    (1, 'GK', 61),
    (2, 'GK', 66),
    (3, 'RB', 71),
    (4, 'CB', 76),
    (5, 'CB', 81),
    (6, 'LB', 60),
    (7, 'RWB', 65),
    (8, 'LWB', 70),
    (9, 'DM', 75),
    (10, 'CM', 80),
    (11, 'CM', 85),
    (12, 'AM', 64),
    (13, 'RM', 69),
    (14, 'LM', 74),
    (15, 'RW', 79),
    (16, 'LW', 84),
    (17, 'ST', 63),
    (18, 'ST', 68),
    (19, 'GK', 62),
    (20, 'GK', 67),
    (21, 'RB', 72),
    (22, 'CB', 77),
    (23, 'CB', 82),
    (24, 'LB', 61),
    (25, 'RWB', 66),
    (26, 'LWB', 71),
    (27, 'DM', 76),
    (28, 'CM', 81),
    (29, 'CM', 60),
    (30, 'AM', 65),
    (31, 'RM', 70),
    (32, 'LM', 75),
    (33, 'RW', 80),
    (34, 'LW', 85),
    (35, 'ST', 64),
    (36, 'ST', 69),
    (37, 'GK', 63),
    (38, 'GK', 68),
    (39, 'RB', 73),
    (40, 'CB', 78),
    (41, 'CB', 83),
    (42, 'LB', 62),
    (43, 'RWB', 67),
    (44, 'LWB', 72),
    (45, 'DM', 77),
    (46, 'CM', 82),
    (47, 'CM', 61),
    (48, 'AM', 66),
    (49, 'RM', 71),
    (50, 'LM', 76),
    (51, 'RW', 81),
    (52, 'LW', 60),
    (53, 'ST', 65),
    (54, 'ST', 70),
    (55, 'GK', 64),
    (56, 'GK', 69),
    (57, 'RB', 74),
    (58, 'CB', 79),
    (59, 'CB', 84),
    (60, 'LB', 63),
    (61, 'RWB', 68),
    (62, 'LWB', 73),
    (63, 'DM', 78),
    (64, 'CM', 83),
    (65, 'CM', 62),
    (66, 'AM', 67),
    (67, 'RM', 72),
    (68, 'LM', 77),
    (69, 'RW', 82),
    (70, 'LW', 61),
    (71, 'ST', 66),
    (72, 'ST', 71);
INSERT INTO squad_membership (player_id, club_id, shirt_number, squad_status) VALUES
    (1, 1, 1, 'FIRST_TEAM'),
    (2, 1, 2, 'FIRST_TEAM'),
    (3, 1, 3, 'FIRST_TEAM'),
    (4, 1, 4, 'FIRST_TEAM'),
    (5, 1, 5, 'FIRST_TEAM'),
    (6, 1, 6, 'FIRST_TEAM'),
    (7, 1, 7, 'FIRST_TEAM'),
    (8, 1, 8, 'FIRST_TEAM'),
    (9, 1, 9, 'FIRST_TEAM'),
    (10, 1, 10, 'FIRST_TEAM'),
    (11, 1, 11, 'FIRST_TEAM'),
    (12, 1, 12, 'FIRST_TEAM'),
    (13, 1, 13, 'FIRST_TEAM'),
    (14, 1, 14, 'FIRST_TEAM'),
    (15, 1, 15, 'FIRST_TEAM'),
    (16, 1, 16, 'FIRST_TEAM'),
    (17, 1, 17, 'FIRST_TEAM'),
    (18, 1, 18, 'FIRST_TEAM'),
    (19, 2, 1, 'FIRST_TEAM'),
    (20, 2, 2, 'FIRST_TEAM'),
    (21, 2, 3, 'FIRST_TEAM'),
    (22, 2, 4, 'FIRST_TEAM'),
    (23, 2, 5, 'FIRST_TEAM'),
    (24, 2, 6, 'FIRST_TEAM'),
    (25, 2, 7, 'FIRST_TEAM'),
    (26, 2, 8, 'FIRST_TEAM'),
    (27, 2, 9, 'FIRST_TEAM'),
    (28, 2, 10, 'FIRST_TEAM'),
    (29, 2, 11, 'FIRST_TEAM'),
    (30, 2, 12, 'FIRST_TEAM'),
    (31, 2, 13, 'FIRST_TEAM'),
    (32, 2, 14, 'FIRST_TEAM'),
    (33, 2, 15, 'FIRST_TEAM'),
    (34, 2, 16, 'FIRST_TEAM'),
    (35, 2, 17, 'FIRST_TEAM'),
    (36, 2, 18, 'FIRST_TEAM'),
    (37, 3, 1, 'FIRST_TEAM'),
    (38, 3, 2, 'FIRST_TEAM'),
    (39, 3, 3, 'FIRST_TEAM'),
    (40, 3, 4, 'FIRST_TEAM'),
    (41, 3, 5, 'FIRST_TEAM'),
    (42, 3, 6, 'FIRST_TEAM'),
    (43, 3, 7, 'FIRST_TEAM'),
    (44, 3, 8, 'FIRST_TEAM'),
    (45, 3, 9, 'FIRST_TEAM'),
    (46, 3, 10, 'FIRST_TEAM'),
    (47, 3, 11, 'FIRST_TEAM'),
    (48, 3, 12, 'FIRST_TEAM'),
    (49, 3, 13, 'FIRST_TEAM'),
    (50, 3, 14, 'FIRST_TEAM'),
    (51, 3, 15, 'FIRST_TEAM'),
    (52, 3, 16, 'FIRST_TEAM'),
    (53, 3, 17, 'FIRST_TEAM'),
    (54, 3, 18, 'FIRST_TEAM'),
    (55, 4, 1, 'FIRST_TEAM'),
    (56, 4, 2, 'FIRST_TEAM'),
    (57, 4, 3, 'FIRST_TEAM'),
    (58, 4, 4, 'FIRST_TEAM'),
    (59, 4, 5, 'FIRST_TEAM'),
    (60, 4, 6, 'FIRST_TEAM'),
    (61, 4, 7, 'FIRST_TEAM'),
    (62, 4, 8, 'FIRST_TEAM'),
    (63, 4, 9, 'FIRST_TEAM'),
    (64, 4, 10, 'FIRST_TEAM'),
    (65, 4, 11, 'FIRST_TEAM'),
    (66, 4, 12, 'FIRST_TEAM'),
    (67, 4, 13, 'FIRST_TEAM'),
    (68, 4, 14, 'FIRST_TEAM'),
    (69, 4, 15, 'FIRST_TEAM'),
    (70, 4, 16, 'FIRST_TEAM'),
    (71, 4, 17, 'FIRST_TEAM'),
    (72, 4, 18, 'FIRST_TEAM');
INSERT INTO player_condition (player_id, energy, morale, sharpness, injured_until, suspension_matches) VALUES
    (1, 100, 55, 50, NULL, 0),
    (2, 100, 55, 50, NULL, 0),
    (3, 100, 55, 50, NULL, 0),
    (4, 100, 55, 50, NULL, 0),
    (5, 100, 55, 50, NULL, 0),
    (6, 100, 55, 50, NULL, 0),
    (7, 100, 55, 50, NULL, 0),
    (8, 100, 55, 50, NULL, 0),
    (9, 100, 55, 50, NULL, 0),
    (10, 100, 55, 50, NULL, 0),
    (11, 100, 55, 50, NULL, 0),
    (12, 100, 55, 50, NULL, 0),
    (13, 100, 55, 50, NULL, 0),
    (14, 100, 55, 50, NULL, 0),
    (15, 100, 55, 50, NULL, 0),
    (16, 100, 55, 50, NULL, 0),
    (17, 100, 55, 50, NULL, 0),
    (18, 100, 55, 50, NULL, 0),
    (19, 100, 55, 50, NULL, 0),
    (20, 100, 55, 50, NULL, 0),
    (21, 100, 55, 50, NULL, 0),
    (22, 100, 55, 50, NULL, 0),
    (23, 100, 55, 50, NULL, 0),
    (24, 100, 55, 50, NULL, 0),
    (25, 100, 55, 50, NULL, 0),
    (26, 100, 55, 50, NULL, 0),
    (27, 100, 55, 50, NULL, 0),
    (28, 100, 55, 50, NULL, 0),
    (29, 100, 55, 50, NULL, 0),
    (30, 100, 55, 50, NULL, 0),
    (31, 100, 55, 50, NULL, 0),
    (32, 100, 55, 50, NULL, 0),
    (33, 100, 55, 50, NULL, 0),
    (34, 100, 55, 50, NULL, 0),
    (35, 100, 55, 50, NULL, 0),
    (36, 100, 55, 50, NULL, 0),
    (37, 100, 55, 50, NULL, 0),
    (38, 100, 55, 50, NULL, 0),
    (39, 100, 55, 50, NULL, 0),
    (40, 100, 55, 50, NULL, 0),
    (41, 100, 55, 50, NULL, 0),
    (42, 100, 55, 50, NULL, 0),
    (43, 100, 55, 50, NULL, 0),
    (44, 100, 55, 50, NULL, 0),
    (45, 100, 55, 50, NULL, 0),
    (46, 100, 55, 50, NULL, 0),
    (47, 100, 55, 50, NULL, 0),
    (48, 100, 55, 50, NULL, 0),
    (49, 100, 55, 50, NULL, 0),
    (50, 100, 55, 50, NULL, 0),
    (51, 100, 55, 50, NULL, 0),
    (52, 100, 55, 50, NULL, 0),
    (53, 100, 55, 50, NULL, 0),
    (54, 100, 55, 50, NULL, 0),
    (55, 100, 55, 50, NULL, 0),
    (56, 100, 55, 50, NULL, 0),
    (57, 100, 55, 50, NULL, 0),
    (58, 100, 55, 50, NULL, 0),
    (59, 100, 55, 50, NULL, 0),
    (60, 100, 55, 50, NULL, 0),
    (61, 100, 55, 50, NULL, 0),
    (62, 100, 55, 50, NULL, 0),
    (63, 100, 55, 50, NULL, 0),
    (64, 100, 55, 50, NULL, 0),
    (65, 100, 55, 50, NULL, 0),
    (66, 100, 55, 50, NULL, 0),
    (67, 100, 55, 50, NULL, 0),
    (68, 100, 55, 50, NULL, 0),
    (69, 100, 55, 50, NULL, 0),
    (70, 100, 55, 50, NULL, 0),
    (71, 100, 55, 50, NULL, 0),
    (72, 100, 55, 50, NULL, 0);

INSERT INTO formation (id, code, name) VALUES (1, '4-3-3', '4-3-3');
INSERT INTO formation_slot (formation_id, slot_number, position_code, x, y) VALUES
    (1, 1, 'GK', 5, 50),
    (1, 2, 'LB', 22, 15),
    (1, 3, 'CB', 22, 38),
    (1, 4, 'CB', 22, 62),
    (1, 5, 'RB', 22, 85),
    (1, 6, 'CM', 48, 30),
    (1, 7, 'DM', 48, 50),
    (1, 8, 'CM', 48, 70),
    (1, 9, 'LW', 73, 20),
    (1, 10, 'ST', 73, 50),
    (1, 11, 'RW', 73, 80);
INSERT INTO team_tactic (club_id, formation_id) VALUES (1,1),(2,1),(3,1),(4,1);

INSERT INTO competition (id, nation_id, name, code, competition_kind) VALUES
    (1, 1, 'Liga Nacional de Teste', 'LNT', 'LEAGUE'),
    (2, 1, 'Copa Nacional de Teste', 'CNT', 'CUP');
INSERT INTO competition_season (id, competition_id, season_year, start_date, end_date, status) VALUES
    (1, 1, 2026, '2026-01-10', '2026-05-30', 'PLANNED'),
    (2, 2, 2026, '2026-02-01', '2026-06-15', 'PLANNED');
INSERT INTO competition_stage (id, season_id, name, stage_order, stage_kind) VALUES
    (1, 1, 'Pontos corridos', 1, 'LEAGUE'),
    (2, 2, 'Fase eliminatória', 1, 'KNOCKOUT');
INSERT INTO stage_format (stage_id, group_count, legs, home_away, win_points, draw_points, loss_points)
VALUES (1, 1, 2, 1, 3, 1, 0), (2, 1, 1, 0, 3, 1, 0);

INSERT INTO stage_group (id, stage_id, group_code, name, sort_order) VALUES
    (1, 1, 'LEAGUE', 'Classificação geral', 1),
    (2, 2, 'KO', 'Chave eliminatória', 1);

INSERT INTO stage_participant (stage_id, club_id, group_id, seed) VALUES
    (1, 1, 1, 1), (1, 2, 1, 2), (1, 3, 1, 3), (1, 4, 1, 4),
    (2, 1, 2, 1), (2, 2, 2, 2), (2, 3, 2, 3), (2, 4, 2, 4);

INSERT INTO schedule_profile (stage_id, min_rest_hours, max_matches_7_days, default_match_duration_minutes)
VALUES (1, 72, 2, 120), (2, 72, 2, 120);

INSERT INTO travel_route (from_city_id, to_city_id, distance_km, estimated_hours, travel_mode) VALUES
    (1, 2, 180, 3.0, 'BUS'),
    (2, 1, 180, 3.0, 'BUS');

INSERT INTO schedule_constraint (stage_id, constraint_type, params_json, severity, priority) VALUES
    (1, 'MIN_REST_HOURS', '{"hours":72}', 'HARD', 10),
    (1, 'TRAVEL_LIMIT', '{"maxTravelHours":8}', 'SOFT', 50),
    (2, 'STADIUM_AVAILABILITY', '{}', 'HARD', 10);
INSERT INTO stage_standing_rule (stage_id, rule_order, rule_key) VALUES
    (1, 1, 'POINTS'), (1, 2, 'WINS'), (1, 3, 'GOAL_DIFFERENCE'), (1, 4, 'GOALS_FOR');
INSERT INTO competition_entry (id, season_id, club_id, seed) VALUES
    (1, 1, 1, 1), (2, 1, 2, 2), (3, 1, 3, 3), (4, 1, 4, 4),
    (5, 2, 1, 1), (6, 2, 2, 2), (7, 2, 3, 3), (8, 2, 4, 4);
INSERT INTO competition_round (id, stage_id, round_number, name, start_date, end_date) VALUES
    (1, 1, 1, 'Turno 1', '2026-01-10', '2026-01-10'),
    (2, 1, 2, 'Turno 2', '2026-01-17', '2026-01-17'),
    (3, 2, 1, 'Semifinais', '2026-03-01', '2026-03-01');
INSERT INTO fixture (id, round_id, home_club_id, away_club_id, stadium_id, scheduled_at, random_seed) VALUES
    (1, 1, 1, 2, 1, '2026-01-10T16:00:00', 11001),
    (2, 1, 3, 4, 3, '2026-01-10T18:00:00', 11002),
    (3, 2, 2, 1, 2, '2026-01-17T16:00:00', 11003),
    (4, 2, 4, 3, 4, '2026-01-17T18:00:00', 11004),
    (5, 3, 1, 4, 1, '2026-03-01T16:00:00', 22001),
    (6, 3, 2, 3, 2, '2026-03-01T18:00:00', 22002);
-- Example destination pool fed by more than one source stage.
-- The seed is illustrative; this pool is not applied until the engine resolves its sources.
INSERT INTO competition (id, nation_id, name, code, competition_kind) VALUES
    (3, 1, 'Torneio Continental de Teste', 'TCT', 'CUP');
INSERT INTO competition_season (id, competition_id, season_year, start_date, end_date, status) VALUES
    (3, 3, 2026, '2026-07-01', '2026-11-30', 'PLANNED');
INSERT INTO qualification_pool (id, name, target_season_id, slot_count, priority_mode, duplicate_club_policy)
VALUES (1, 'Vagas continentais de exemplo', 3, 2, 'RULE_THEN_POSITION', 'KEEP_BEST');
INSERT INTO qualification_pool_source
    (pool_id, source_stage_id, position_from, position_to, source_outcome, rule_priority)
VALUES
    (1, 1, 1, 2, 'FINAL_POSITION', 10),
    (1, 2, 1, 1, 'CUP_WINNER', 20);

INSERT INTO stage_standing (stage_id, club_id, group_id) VALUES
    (1, 1, 1), (1, 2, 1), (1, 3, 1), (1, 4, 1);
