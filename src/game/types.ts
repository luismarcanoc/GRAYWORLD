export type PlayerKind = "yin" | "yang";
export type PowerKind = "phase" | "light" | "doubleJump" | "push" | "shrink" | "shoot" | "sword" | "shield";

export type Rect = { x: number; y: number; w: number; h: number };

export type Platform = Rect & {
  id?: string;
  tint?: number;
};

export type Hazard = Rect & {
  kind: "spikes" | "void" | "field";
  dangerousTo?: PlayerKind | "both";
};

export type ExitDoor = Rect & { for: PlayerKind };

export type SwitchPlate = Rect & {
  id: string;
  for?: PlayerKind | "any";
  latch?: boolean;
};

export type Gate = Rect & { switchId: string; inverted?: boolean };

export type PowerPet = Rect & {
  for: PlayerKind;
  power: PowerKind;
};

export type SecretWall = Rect & { id?: string };

export type PushCrate = Rect & { id: string };

export type PowerTarget = Rect & {
  id: string;
  requires: "shoot" | "sword";
  solid?: boolean;
};

export type Sentry = Rect & {
  direction: -1 | 1;
  interval?: number;
};

export type Trap =
  | {
      type: "pop-spikes";
      trigger: Rect;
      hazard: Rect;
      delay?: number;
    }
  | {
      type: "falling-floor";
      platformId: string;
      delay?: number;
    }
  | {
      type: "crusher";
      trigger: Rect;
      rect: Rect;
      targetY: number;
      speed?: number;
    }
  | {
      type: "side-slam";
      trigger: Rect;
      rect: Rect;
      targetX: number;
      speed?: number;
    };

export type Level = {
  id: string;
  world: number;
  number: number;
  name: string;
  hint: string;
  width?: number;
  height?: number;
  spawn: { yin: { x: number; y: number }; yang: { x: number; y: number } };
  platforms: Platform[];
  hazards: Hazard[];
  exits: ExitDoor[];
  switches?: SwitchPlate[];
  gates?: Gate[];
  traps?: Trap[];
  pets?: PowerPet[];
  secretWalls?: SecretWall[];
  crates?: PushCrate[];
  targets?: PowerTarget[];
  sentries?: Sentry[];
  duality?: boolean;
  powerHint?: string;
};

export type WorldTheme = {
  id: number;
  name: string;
  subtitle: string;
  accent: string;
  accentSoft: string;
  bg: string;
  far: string;
  near: string;
  block: string;
  blockTop: string;
};

export type Bindings = Record<PlayerKind, Record<"left" | "right" | "jump" | "down" | "power", string>>;

export type GameSettings = {
  master: number;
  music: number;
  sfx: number;
  screenShake: boolean;
  bindings: Bindings;
};
