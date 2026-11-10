export type PreferredFoot = "LEFT" | "RIGHT" | "BOTH";

export type SquadStatus = "FIRST_TEAM" | "RESERVE" | "YOUTH";

export type CompetitionKind =
  "LEAGUE" | "CUP" | "SUPER_CUP" | "PLAYOFF" | "OTHER";

export type StageKind =
  "LEAGUE" | "GROUPS" | "KNOCKOUT" | "SINGLE_MATCH" | "FINAL";

export type MovementType = "PROMOTE" | "RELEGATE" | "PLAYOFF";

export type EntityType =
  | "nation"
  | "city"
  | "club"
  | "stadium"
  | "player"
  | "competition"
  | "season"
  | "stage";

export interface DataPackageDependency {
  id: string;
  version?: string;
}

export interface DataPackageNation {
  code: string;
  name: string;
}

export interface DataPackageCity {
  code: string;
  nationCode: string;
  name: string;
  climateProfile?: string;
}

export interface DataPackageClub {
  code: string;
  nationCode: string;
  cityCode?: string;
  name: string;
  shortName?: string;
  reputation?: number;
  primaryColor?: string;
  secondaryColor?: string;
}

export interface DataPackageStadium {
  code: string;
  clubCode?: string;
  cityCode?: string;
  name: string;
  capacity?: number;
  pitchQuality?: number;
}

export interface DataPackagePlayerPosition {
  code: string;
  rating: number;
}

export interface DataPackagePlayer {
  code: string;
  name: string;
  nationalityCode?: string;
  birthDate?: string;
  potential?: number;
  preferredFoot?: PreferredFoot;
  goalkeeper?: boolean;
  clubCode?: string;
  squadStatus?: SquadStatus;
  shirtNumber?: number;
  attributes?: Record<string, number>;
  positions?: DataPackagePlayerPosition[];
}

export interface DataPackageStageFormat {
  groupCount?: number;
  legs?: number;
  homeAway?: boolean;
  extraTime?: boolean;
  penalties?: boolean;
  awayGoalsRule?: boolean;
  winPoints?: number;
  drawPoints?: number;
  lossPoints?: number;
}

export interface DataPackageGroup {
  code: string;
  name: string;
}

export interface DataPackageParticipant {
  clubCode: string;
  groupCode?: string;
  seed?: number;
}

export interface DataPackageFixture {
  homeClubCode: string;
  awayClubCode: string;
  date?: string;
  stadiumCode?: string;
}

export interface DataPackageRound {
  number: number;
  name?: string;
  date?: string;
  fixtures: DataPackageFixture[];
}

export interface DataPackageMovement {
  positionFrom: number;
  positionTo: number;
  movementType: MovementType;
  targetCompetitionCode?: string;
  targetTier?: number;
  priority?: number;
}

export interface DataPackageStage {
  code: string;
  name: string;
  order: number;
  kind: StageKind;
  format?: DataPackageStageFormat;
  standingsRules?: string[];
  groups?: DataPackageGroup[];
  participants: DataPackageParticipant[];
  calendar?: DataPackageRound[];
  promotionRelegation?: DataPackageMovement[];
}

export interface DataPackageSeason {
  year: number;
  startDate?: string;
  endDate?: string;
  stages: DataPackageStage[];
}

export interface DataPackageCompetition {
  code: string;
  name: string;
  nationCode?: string;
  tier?: number;
  kind?: CompetitionKind;
  seasons: DataPackageSeason[];
}

export interface DataPackage {
  schemaVersion: 1;
  id: string;
  version: string;
  minGameVersion?: string;
  dependencies?: DataPackageDependency[];
  nations?: DataPackageNation[];
  cities?: DataPackageCity[];
  clubs?: DataPackageClub[];
  stadiums?: DataPackageStadium[];
  players?: DataPackagePlayer[];
  competitions?: DataPackageCompetition[];
}

export interface InstallDataPackageResult {
  packageId: string;
  version: string;
  created: number;
  updated: number;
  stages: number;
  fixtures: number;
}

export interface InstalledDataPackage {
  id: string;
  version: string;
  installedAt: string;
  dependencies: string;
}

export interface PromotionRelegationMovement {
  clubId: number;
  club: string;
  movement: string;
  from: string;
  to: string;
}

export interface PromotionRelegationResult {
  movements: PromotionRelegationMovement[];
}
