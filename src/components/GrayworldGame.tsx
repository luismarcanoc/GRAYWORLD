"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLevel, getWorldLevels, LEVELS, WORLD_THEMES } from "@/game/levels";
import type { Bindings, GameSettings, Level, PlayerKind, Rect, Trap } from "@/game/types";

type Screen = "title" | "map" | "settings" | "game";
type Action = "left" | "right" | "jump" | "down";

const DEFAULT_BINDINGS: Bindings = {
  yin: { left: "KeyA", right: "KeyD", jump: "KeyW", down: "KeyS" },
  yang: { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", down: "ArrowDown" },
};

const DEFAULT_SETTINGS: GameSettings = {
  master: 0.8,
  music: 0.32,
  sfx: 0.72,
  screenShake: true,
  bindings: DEFAULT_BINDINGS,
};

const KEY_NAMES: Record<string, string> = {
  KeyA: "A", KeyD: "D", KeyW: "W", KeyS: "S",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  Space: "ESPACIO", ShiftLeft: "SHIFT", ShiftRight: "SHIFT",
  Numpad4: "NUM 4", Numpad6: "NUM 6", Numpad8: "NUM 8", Numpad5: "NUM 5",
};

const actionName: Record<Action, string> = { left: "IZQUIERDA", right: "DERECHA", jump: "SALTAR", down: "ABAJO" };
const playerName: Record<PlayerKind, string> = { yin: "YIN", yang: "YANG" };

function keyLabel(code: string) {
  return KEY_NAMES[code] ?? code.replace("Key", "").replace("Digit", "");
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function PixelIcon({ kind }: { kind: "play" | "map" | "gear" | "back" | "sound" | "screen" }) {
  const glyph = { play: "▶", map: "◆", gear: "✦", back: "←", sound: "♫", screen: "□" }[kind];
  return <span className="pixel-icon" aria-hidden="true">{glyph}</span>;
}

function YinYangMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`yin-yang-mark ${small ? "small" : ""}`} aria-hidden="true">
      <i className="mark-dot mark-dot-dark" />
      <i className="mark-dot mark-dot-light" />
    </span>
  );
}

function GameCanvas({
  level,
  settings,
  paused,
  restartToken,
  onPause,
  onDeath,
  onComplete,
  playSfx,
}: {
  level: Level;
  settings: GameSettings;
  paused: boolean;
  restartToken: number;
  onPause: () => void;
  onDeath: () => void;
  onComplete: () => void;
  playSfx: (type: "jump" | "death" | "switch" | "win" | "trap") => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pressed = useRef(new Set<string>());
  const justPressed = useRef(new Set<string>());
  const pausedRef = useRef(paused);
  const [exitState, setExitState] = useState({ yin: false, yang: false });

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const allCodes = Object.values(settings.bindings).flatMap((binding) => Object.values(binding));
      if (allCodes.includes(event.code)) event.preventDefault();
      if (event.code === "Escape") {
        event.preventDefault();
        onPause();
        return;
      }
      if (!pressed.current.has(event.code)) justPressed.current.add(event.code);
      pressed.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => pressed.current.delete(event.code);
    const blur = () => pressed.current.clear();
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [onPause, settings.bindings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = level.width ?? 960;
    const height = level.height ?? 540;
    const theme = WORLD_THEMES[level.world - 1];
    canvas.width = width;
    canvas.height = height;

    type RuntimePlayer = Rect & {
      kind: PlayerKind;
      vx: number;
      vy: number;
      grounded: boolean;
      coyote: number;
      facing: number;
      walk: number;
      groundId?: string;
      exited: boolean;
    };
    type TrapState = { active: boolean; time: number; x?: number; y?: number; velocity?: number };

    const makePlayer = (kind: PlayerKind): RuntimePlayer => ({
      x: level.spawn[kind].x,
      y: level.spawn[kind].y - 34,
      w: 24,
      h: 34,
      kind,
      vx: 0,
      vy: 0,
      grounded: false,
      coyote: 0,
      facing: kind === "yin" ? 1 : -1,
      walk: 0,
      exited: false,
    });

    let players = [makePlayer("yin"), makePlayer("yang")];
    let trapStates: TrapState[] = (level.traps ?? []).map((trap) => ({
      active: false,
      time: 0,
      x: trap.type === "side-slam" ? trap.rect.x : undefined,
      y: trap.type === "crusher" ? trap.rect.y : undefined,
      velocity: 0,
    }));
    let platformFalls = new Map<string, { active: boolean; time: number; y: number; velocity: number }>();
    for (const platform of level.platforms) {
      if (platform.id) platformFalls.set(platform.id, { active: false, time: 0, y: 0, velocity: 0 });
    }
    let latched = new Set<string>();
    let currentSwitches = new Set<string>();
    let deadTimer = 0;
    let completeTimer = 0;
    let completed = false;
    let shake = 0;
    let time = 0;
    let last = performance.now();
    let raf = 0;
    let particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];

    setExitState({ yin: false, yang: false });

    const resetLevel = () => {
      players = [makePlayer("yin"), makePlayer("yang")];
      trapStates = (level.traps ?? []).map((trap) => ({
        active: false,
        time: 0,
        x: trap.type === "side-slam" ? trap.rect.x : undefined,
        y: trap.type === "crusher" ? trap.rect.y : undefined,
        velocity: 0,
      }));
      platformFalls = new Map();
      for (const platform of level.platforms) {
        if (platform.id) platformFalls.set(platform.id, { active: false, time: 0, y: 0, velocity: 0 });
      }
      latched = new Set();
      currentSwitches = new Set();
      deadTimer = 0;
      completeTimer = 0;
      completed = false;
      particles = [];
      setExitState({ yin: false, yang: false });
    };

    const activePlatforms = () => level.platforms.map((platform) => {
      const fall = platform.id ? platformFalls.get(platform.id) : undefined;
      return { ...platform, y: platform.y + (fall?.y ?? 0), disabled: (fall?.y ?? 0) > 650 };
    }).filter((platform) => !platform.disabled);

    const gateOpen = (switchId: string) => currentSwitches.has(switchId) || latched.has(switchId);

    const kill = (player: RuntimePlayer) => {
      if (deadTimer > 0 || completed) return;
      deadTimer = 0.78;
      shake = settings.screenShake ? 12 : 0;
      for (let i = 0; i < 22; i += 1) {
        const angle = (Math.PI * 2 * i) / 22;
        particles.push({
          x: player.x + player.w / 2,
          y: player.y + player.h / 2,
          vx: Math.cos(angle) * (80 + (i % 4) * 24),
          vy: Math.sin(angle) * (80 + (i % 3) * 34),
          life: 0.72,
          color: player.kind === "yin" ? "#08090a" : "#f4f4f0",
        });
      }
      playSfx("death");
      onDeath();
    };

    const drawSpikes = (rect: Rect, color = "#b9b9b9") => {
      const teeth = Math.max(1, Math.floor(rect.w / 12));
      ctx.fillStyle = color;
      for (let i = 0; i < teeth; i += 1) {
        const toothW = rect.w / teeth;
        ctx.beginPath();
        ctx.moveTo(rect.x + i * toothW, rect.y + rect.h);
        ctx.lineTo(rect.x + (i + 0.5) * toothW, rect.y);
        ctx.lineTo(rect.x + (i + 1) * toothW, rect.y + rect.h);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(rect.x, rect.y + rect.h - 4, rect.w, 4);
    };

    const drawBlock = (rect: Rect, fill = theme.block, top = theme.blockTop, offset = 0) => {
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(Math.round(rect.x) - 3, Math.round(rect.y) - 3, Math.round(rect.w) + 6, Math.round(rect.h) + 6);
      ctx.fillStyle = fill;
      ctx.fillRect(Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h));
      ctx.fillStyle = top;
      ctx.fillRect(Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), 5);
      ctx.fillStyle = "rgba(0,0,0,.14)";
      for (let x = rect.x + 12 + offset; x < rect.x + rect.w; x += 24) {
        ctx.fillRect(Math.round(x), Math.round(rect.y + 13), 5, Math.max(0, Math.round(rect.h - 18)));
      }
    };

    const drawPlayer = (player: RuntimePlayer) => {
      if (player.exited) return;
      const moving = Math.abs(player.vx) > 20 && player.grounded;
      const cycle = Math.sin(player.walk * 10);
      const bob = moving ? Math.abs(Math.sin(player.walk * 10)) * 2 : 0;
      const x = Math.round(player.x);
      const y = Math.round(player.y - bob);
      const light = player.kind === "yang";
      const body = light ? "#f1f1ed" : "#08090a";
      const opposite = light ? "#090a0b" : "#efefeb";
      const outline = light ? "#090a0b" : "#d8d8d4";
      const legA = moving ? Math.round(cycle * 3) : 0;
      const legB = moving ? Math.round(-cycle * 3) : 0;
      const armA = moving ? Math.round(-cycle * 2) : 0;
      const armB = moving ? Math.round(cycle * 2) : 0;

      ctx.fillStyle = outline;
      ctx.fillRect(x + 2 + legA, y + 26, 8, 9);
      ctx.fillRect(x + 14 + legB, y + 26, 8, 9);
      ctx.fillRect(x - 2, y + 13 + armA, 6, 14);
      ctx.fillRect(x + 20, y + 13 + armB, 6, 14);
      ctx.fillStyle = body;
      ctx.fillRect(x + 4 + legA, y + 26, 5, 8);
      ctx.fillRect(x + 15 + legB, y + 26, 5, 8);
      ctx.fillRect(x, y + 14 + armA, 4, 11);
      ctx.fillRect(x + 20, y + 14 + armB, 4, 11);
      ctx.fillRect(x + 3, y + 11, 18, 18);
      ctx.fillRect(x + 1, y + 3, 22, 17);
      ctx.fillRect(x + 4, y, 16, 22);
      ctx.fillStyle = opposite;
      const eyeX = player.facing > 0 ? x + 15 : x + 7;
      ctx.fillRect(eyeX, y + 7, 3, 4);
      ctx.fillRect(x + 10, y + 18, 4, 4);
    };

    const drawExit = (exit: Level["exits"][number], reached: boolean) => {
      const isLight = exit.for === "yang";
      ctx.fillStyle = "#090a0b";
      ctx.fillRect(exit.x - 4, exit.y - 4, exit.w + 8, exit.h + 4);
      ctx.fillStyle = isLight ? "#e9e9e5" : "#111315";
      ctx.fillRect(exit.x, exit.y, exit.w, exit.h);
      ctx.fillStyle = isLight ? "#111315" : "#e9e9e5";
      ctx.fillRect(exit.x + 9, exit.y + 13, 18, 18);
      ctx.fillStyle = isLight ? "#e9e9e5" : "#111315";
      ctx.fillRect(exit.x + 14, exit.y + 18, 8, 8);
      if (reached) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 3;
        ctx.strokeRect(exit.x - 7, exit.y - 7, exit.w + 14, exit.h + 10);
      }
    };

    const draw = () => {
      ctx.save();
      const sx = shake > 0 ? Math.round((Math.random() - 0.5) * shake) : 0;
      const sy = shake > 0 ? Math.round((Math.random() - 0.5) * shake) : 0;
      ctx.translate(sx, sy);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(-20, -20, width + 40, height + 40);

      ctx.fillStyle = theme.far;
      for (let x = -30; x < width + 50; x += 96) {
        const tower = 90 + ((x / 96 + level.number * 3) % 4) * 26;
        ctx.fillRect(x, 480 - tower, 62, tower);
        ctx.fillRect(x + 16, 480 - tower - 18, 28, 18);
      }
      ctx.fillStyle = theme.near;
      for (let x = 0; x < width; x += 48) {
        const h = 25 + ((x / 48 + level.world + level.number) % 3) * 14;
        ctx.fillRect(x, 480 - h, 34, h);
      }
      ctx.fillStyle = `${theme.accent}18`;
      for (let y = 22; y < 430; y += 38) {
        for (let x = (y / 38) % 2 ? 20 : 8; x < width; x += 52) ctx.fillRect(x, y, 2, 2);
      }

      level.exits.forEach((exit) => drawExit(exit, players.find((p) => p.kind === exit.for)?.exited ?? false));

      for (const hazard of level.hazards) {
        if (hazard.kind === "spikes") drawSpikes(hazard, "#b7b7b4");
        if (hazard.kind === "void") {
          ctx.fillStyle = "#050506";
          ctx.fillRect(hazard.x, hazard.y, hazard.w, hazard.h);
          ctx.fillStyle = theme.accentSoft;
          for (let x = hazard.x; x < hazard.x + hazard.w; x += 18) ctx.fillRect(x, hazard.y, 8, 3);
        }
        if (hazard.kind === "field") {
          const white = hazard.dangerousTo === "yin";
          ctx.fillStyle = white ? "#e8e8e4" : "#070809";
          ctx.fillRect(hazard.x, hazard.y, hazard.w, hazard.h);
          ctx.fillStyle = white ? "#111" : "#eee";
          for (let x = hazard.x + 4; x < hazard.x + hazard.w; x += 14) ctx.fillRect(x, hazard.y + 5, 5, 5);
        }
      }

      activePlatforms().forEach((platform, index) => drawBlock(platform, theme.block, theme.blockTop, index % 2 ? 8 : 0));

      (level.switches ?? []).forEach((plate) => {
        const on = currentSwitches.has(plate.id) || latched.has(plate.id);
        ctx.fillStyle = "#08090a";
        ctx.fillRect(plate.x - 3, plate.y - 3, plate.w + 6, plate.h + 3);
        ctx.fillStyle = on ? theme.accent : theme.accentSoft;
        ctx.fillRect(plate.x, plate.y + (on ? 5 : 0), plate.w, plate.h - (on ? 5 : 0));
        ctx.fillStyle = plate.for === "yin" ? "#08090a" : plate.for === "yang" ? "#f0f0ec" : "#777";
        ctx.fillRect(plate.x + plate.w / 2 - 4, plate.y + 4 + (on ? 4 : 0), 8, 5);
      });

      (level.gates ?? []).forEach((gate) => {
        if (gateOpen(gate.switchId)) return;
        drawBlock(gate, "#25282a", theme.accentSoft);
        ctx.fillStyle = theme.accent;
        for (let y = gate.y + 10; y < gate.y + gate.h; y += 22) ctx.fillRect(gate.x + 7, y, gate.w - 14, 6);
      });

      (level.traps ?? []).forEach((trap, index) => {
        const state = trapStates[index];
        if (trap.type === "pop-spikes") {
          if (state.active && state.time >= (trap.delay ?? 0.2)) drawSpikes(trap.hazard, theme.accent);
          else if (state.active) {
            ctx.fillStyle = theme.accentSoft;
            for (let x = trap.hazard.x; x < trap.hazard.x + trap.hazard.w; x += 13) ctx.fillRect(x, trap.hazard.y + trap.hazard.h - 3, 5, 3);
          }
        }
        if (trap.type === "crusher") {
          const rect = { ...trap.rect, y: state.y ?? trap.rect.y };
          drawBlock(rect, "#383b3d", theme.accentSoft);
          drawSpikes({ x: rect.x, y: rect.y + rect.h, w: rect.w, h: 16 }, theme.accent);
        }
        if (trap.type === "side-slam") {
          const rect = { ...trap.rect, x: state.x ?? trap.rect.x };
          drawBlock(rect, "#383b3d", theme.accentSoft);
          ctx.fillStyle = theme.accent;
          ctx.fillRect(rect.x + (trap.targetX > trap.rect.x ? rect.w - 6 : 0), rect.y + 8, 6, rect.h - 16);
        }
      });

      players.forEach(drawPlayer);
      particles.forEach((particle) => {
        ctx.globalAlpha = Math.max(0, particle.life / 0.72);
        ctx.fillStyle = particle.color;
        ctx.fillRect(Math.round(particle.x), Math.round(particle.y), 6, 6);
      });
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(0,0,0,.62)";
      ctx.fillRect(18, 18, 258, 42);
      ctx.fillStyle = theme.accent;
      ctx.font = "bold 16px monospace";
      ctx.fillText(`${level.id}  ${level.name}`, 32, 44);
      ctx.restore();
    };

    const updateTrap = (trap: Trap, state: TrapState, index: number, dt: number) => {
      const trigger = "trigger" in trap ? trap.trigger : undefined;
      if (trigger && !state.active && players.some((player) => !player.exited && intersects(player, trigger))) {
        state.active = true;
        state.time = 0;
        playSfx("trap");
      }
      if (trap.type === "falling-floor") {
        const fall = platformFalls.get(trap.platformId);
        if (!fall) return;
        if (!fall.active && players.some((player) => player.grounded && player.groundId === trap.platformId)) {
          fall.active = true;
          fall.time = 0;
          playSfx("trap");
        }
        if (fall.active) {
          fall.time += dt;
          if (fall.time > (trap.delay ?? 0.45)) {
            fall.velocity += 980 * dt;
            fall.y += fall.velocity * dt;
          }
        }
        return;
      }
      if (!state.active) return;
      state.time += dt;
      if (trap.type === "crusher") state.y = Math.min(trap.targetY, (state.y ?? trap.rect.y) + (trap.speed ?? 600) * dt);
      if (trap.type === "side-slam") {
        const direction = Math.sign(trap.targetX - trap.rect.x);
        const next = (state.x ?? trap.rect.x) + direction * (trap.speed ?? 700) * dt;
        state.x = direction > 0 ? Math.min(trap.targetX, next) : Math.max(trap.targetX, next);
      }
      void index;
    };

    const update = (dt: number) => {
      time += dt;
      shake = Math.max(0, shake - dt * 34);
      particles.forEach((particle) => {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 380 * dt;
      });
      particles = particles.filter((particle) => particle.life > 0);

      if (deadTimer > 0) {
        deadTimer -= dt;
        if (deadTimer <= 0) resetLevel();
        return;
      }
      if (completed) {
        completeTimer += dt;
        if (completeTimer > 0.65) onComplete();
        return;
      }

      currentSwitches = new Set();
      (level.switches ?? []).forEach((plate) => {
        players.forEach((player) => {
          if (player.exited) return;
          const allowed = !plate.for || plate.for === "any" || plate.for === player.kind;
          if (allowed && intersects(player, plate)) {
            currentSwitches.add(plate.id);
            if (plate.latch && !latched.has(plate.id)) {
              latched.add(plate.id);
              playSfx("switch");
            }
          }
        });
      });

      (level.traps ?? []).forEach((trap, index) => updateTrap(trap, trapStates[index], index, dt));

      const colliders: (Rect & { id?: string })[] = [
        ...activePlatforms(),
        ...(level.gates ?? []).filter((gate) => !gateOpen(gate.switchId)),
      ];

      for (const player of players) {
        if (player.exited) continue;
        const binding = settings.bindings[player.kind];
        const left = pressed.current.has(binding.left);
        const right = pressed.current.has(binding.right);
        const down = pressed.current.has(binding.down);
        const jump = justPressed.current.has(binding.jump);
        const direction = Number(right) - Number(left);
        const acceleration = player.grounded ? 2600 : 1500;
        const target = direction * 235;
        if (direction !== 0) {
          player.vx += Math.sign(target - player.vx) * Math.min(Math.abs(target - player.vx), acceleration * dt);
          player.facing = direction;
          player.walk += dt;
        } else {
          player.vx *= Math.pow(player.grounded ? 0.00008 : 0.045, dt);
        }
        player.coyote = player.grounded ? 0.1 : Math.max(0, player.coyote - dt);
        if (jump && player.coyote > 0) {
          player.vy = -610;
          player.grounded = false;
          player.coyote = 0;
          playSfx("jump");
        }
        if (down && !player.grounded) player.vy += 850 * dt;
        player.vy = Math.min(860, player.vy + 1750 * dt);

        player.x += player.vx * dt;
        for (const collider of colliders) {
          if (!intersects(player, collider)) continue;
          if (player.vx > 0) player.x = collider.x - player.w;
          else if (player.vx < 0) player.x = collider.x + collider.w;
          player.vx = 0;
        }

        player.grounded = false;
        player.groundId = undefined;
        player.y += player.vy * dt;
        for (const collider of colliders) {
          if (!intersects(player, collider)) continue;
          if (player.vy > 0) {
            player.y = collider.y - player.h;
            player.grounded = true;
            player.groundId = collider.id;
          } else if (player.vy < 0) player.y = collider.y + collider.h;
          player.vy = 0;
        }
        player.x = Math.max(0, Math.min(width - player.w, player.x));

        for (const hazard of level.hazards) {
          const dangerous = !hazard.dangerousTo || hazard.dangerousTo === "both" || hazard.dangerousTo === player.kind;
          if (dangerous && intersects(player, hazard)) kill(player);
        }
        (level.traps ?? []).forEach((trap, index) => {
          const state = trapStates[index];
          if (trap.type === "pop-spikes" && state.active && state.time >= (trap.delay ?? 0.2) && intersects(player, trap.hazard)) kill(player);
          if (trap.type === "crusher") {
            const rect = { ...trap.rect, y: state.y ?? trap.rect.y };
            if (intersects(player, rect)) kill(player);
          }
          if (trap.type === "side-slam") {
            const rect = { ...trap.rect, x: state.x ?? trap.rect.x };
            if (intersects(player, rect)) kill(player);
          }
        });
        if (player.y > height + 40) kill(player);

        const ownExit = level.exits.find((exit) => exit.for === player.kind);
        if (ownExit && intersects(player, ownExit)) {
          player.exited = true;
          player.vx = 0;
          player.vy = 0;
          setExitState((previous) => ({ ...previous, [player.kind]: true }));
          playSfx("switch");
        }
      }
      justPressed.current.clear();
      if (players.every((player) => player.exited)) {
        completed = true;
        playSfx("win");
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) update(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level, onComplete, onDeath, playSfx, restartToken, settings.bindings, settings.screenShake]);

  return (
    <div className="canvas-shell">
      <div className="goal-status" aria-label="Estado de las salidas">
        <span className={exitState.yin ? "arrived" : ""}><i className="mini-player yin" /> YIN</span>
        <span className={exitState.yang ? "arrived" : ""}><i className="mini-player yang" /> YANG</span>
      </div>
      <canvas ref={canvasRef} className="game-canvas" aria-label={`Nivel ${level.id}: ${level.name}`} />
    </div>
  );
}

export function GrayworldGame() {
  const [screen, setScreen] = useState<Screen>("title");
  const [settingsReturn, setSettingsReturn] = useState<Screen>("title");
  const [settingsTab, setSettingsTab] = useState<"display" | "audio" | "controls">("display");
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [completed, setCompleted] = useState<string[]>([]);
  const [activeLevelId, setActiveLevelId] = useState("1-1");
  const [paused, setPaused] = useState(false);
  const [levelWon, setLevelWon] = useState(false);
  const [restartToken, setRestartToken] = useState(0);
  const [deaths, setDeaths] = useState(0);
  const [rebinding, setRebinding] = useState<{ player: PlayerKind; action: Action } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const activeLevel = useMemo(() => getLevel(activeLevelId), [activeLevelId]);

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem("grayworld:settings");
      const savedProgress = localStorage.getItem("grayworld:progress");
      if (savedSettings) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
      if (savedProgress) setCompleted(JSON.parse(savedProgress));
    } catch { /* damaged saves fall back safely */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("grayworld:settings", JSON.stringify(settings));
  }, [hydrated, settings]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("grayworld:progress", JSON.stringify(completed));
  }, [completed, hydrated]);

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) audioRef.current = new AudioContext();
    if (audioRef.current.state === "suspended") void audioRef.current.resume();
    return audioRef.current;
  }, []);

  const tone = useCallback((frequency: number, duration: number, gain = 0.08, type: OscillatorType = "square") => {
    const audio = ensureAudio();
    if (!audio || settings.master <= 0 || settings.sfx <= 0) return;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(gain * settings.master * settings.sfx, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
  }, [ensureAudio, settings.master, settings.sfx]);

  const playSfx = useCallback((type: "jump" | "death" | "switch" | "win" | "trap") => {
    if (type === "jump") tone(190, 0.12, 0.065);
    if (type === "switch") tone(420, 0.09, 0.045);
    if (type === "trap") tone(82, 0.15, 0.07, "sawtooth");
    if (type === "death") { tone(110, 0.32, 0.095, "sawtooth"); window.setTimeout(() => tone(62, 0.26, 0.07), 70); }
    if (type === "win") { tone(330, 0.18, 0.065); window.setTimeout(() => tone(494, 0.28, 0.07), 120); }
  }, [tone]);

  const clickSound = useCallback(() => tone(260, 0.055, 0.035), [tone]);

  useEffect(() => {
    if (screen !== "game" && screen !== "map") return;
    let step = 0;
    const notes = screen === "game" ? [55, 65.4, 73.4, 49] : [82.4, 98, 110, 73.4];
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.state !== "running" || settings.music <= 0 || settings.master <= 0) return;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = notes[step % notes.length];
      gain.gain.setValueAtTime(0.022 * settings.music * settings.master, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.7);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.72);
      step += 1;
    }, 760);
    return () => window.clearInterval(timer);
  }, [screen, settings.master, settings.music]);

  useEffect(() => {
    if (!rebinding) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") { setRebinding(null); return; }
      setSettings((previous) => ({
        ...previous,
        bindings: {
          ...previous.bindings,
          [rebinding.player]: { ...previous.bindings[rebinding.player], [rebinding.action]: event.code },
        },
      }));
      setRebinding(null);
      clickSound();
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [clickSound, rebinding]);

  const go = (next: Screen) => {
    ensureAudio();
    clickSound();
    setScreen(next);
  };

  const startLevel = (id: string) => {
    ensureAudio();
    clickSound();
    setActiveLevelId(id);
    setDeaths(0);
    setPaused(false);
    setLevelWon(false);
    setRestartToken((token) => token + 1);
    setScreen("game");
  };

  const openSettings = (from: Screen) => {
    setSettingsReturn(from);
    setSettingsTab("display");
    setScreen("settings");
    clickSound();
  };

  const isUnlocked = (level: Level) => {
    const index = LEVELS.findIndex((candidate) => candidate.id === level.id);
    return index === 0 || completed.includes(LEVELS[index - 1].id);
  };

  const nextLevel = () => {
    const index = LEVELS.findIndex((level) => level.id === activeLevelId);
    const next = LEVELS[index + 1];
    if (next) startLevel(next.id);
    else go("map");
  };

  const handleComplete = useCallback(() => {
    setCompleted((previous) => previous.includes(activeLevelId) ? previous : [...previous, activeLevelId]);
    setLevelWon(true);
    setPaused(true);
  }, [activeLevelId]);

  const handleDeath = useCallback(() => setDeaths((value) => value + 1), []);
  const handlePause = useCallback(() => setPaused((value) => !value), []);

  const toggleFullscreen = async () => {
    clickSound();
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* browser may deny fullscreen outside a trusted click */ }
  };

  const renderTitle = () => (
    <main className="screen title-screen">
      <div className="scanlines" />
      <div className="title-characters" aria-hidden="true">
        <div className="hero-sprite hero-yin"><i /><b /></div>
        <div className="hero-divider"><YinYangMark /></div>
        <div className="hero-sprite hero-yang"><i /><b /></div>
      </div>
      <section className="title-panel">
        <p className="eyebrow">UN JUEGO COOPERATIVO PARA DOS</p>
        <h1 aria-label="Grayworld"><span>GRAY</span>WORLD</h1>
        <p className="tagline">DOS MITADES. UN MUNDO QUE JUEGA SUCIO.</p>
        <div className="menu-stack">
          <button className="pixel-button primary" onClick={() => go(completed.length ? "map" : "game")}>
            <PixelIcon kind="play" /> {completed.length ? "CONTINUAR" : "COMENZAR"}
          </button>
          <button className="pixel-button" onClick={() => go("map")}><PixelIcon kind="map" /> SELECCIÓN DE NIVELES</button>
          <button className="pixel-button" onClick={() => openSettings("title")}><PixelIcon kind="gear" /> AJUSTES</button>
        </div>
        <div className="quick-controls">
          <span><i className="mini-player yin" /> YIN <kbd>WASD</kbd></span>
          <span><i className="mini-player yang" /> YANG <kbd>FLECHAS</kbd></span>
        </div>
      </section>
      <p className="version">v0.1 · PRIMER DESCENSO</p>
    </main>
  );

  const renderMap = () => (
    <main className="screen map-screen">
      <header className="topbar">
        <button className="icon-button" onClick={() => go("title")} aria-label="Volver"><PixelIcon kind="back" /></button>
        <div><p className="eyebrow">ARCHIVO DE DESCENSO</p><h2>MAPA DE GRAYWORLD</h2></div>
        <div className="map-progress"><strong>{completed.length}</strong><span>/ {LEVELS.length}</span></div>
      </header>
      <div className="world-list">
        {WORLD_THEMES.map((world, worldIndex) => {
          const levels = getWorldLevels(world.id);
          const worldDone = levels.filter((level) => completed.includes(level.id)).length;
          return (
            <section className={`world-card world-${world.id}`} key={world.id} style={{ "--world-accent": world.accent, "--world-soft": world.accentSoft } as React.CSSProperties}>
              <div className="world-heading">
                <span className="world-number">0{world.id}</span>
                <div><p>MUNDO {world.id}</p><h3>{world.name}</h3><small>{world.subtitle}</small></div>
                <span className="world-count">{worldDone}/5</span>
              </div>
              <div className="level-route">
                <div className="route-line" />
                {levels.map((level, index) => {
                  const done = completed.includes(level.id);
                  const unlocked = isUnlocked(level);
                  return (
                    <button
                      key={level.id}
                      className={`level-node ${done ? "done" : ""} ${unlocked ? "" : "locked"} ${index % 2 ? "low" : "high"}`}
                      onClick={() => unlocked && startLevel(level.id)}
                      disabled={!unlocked}
                      aria-label={`${level.id}: ${level.name}${done ? ", completado" : unlocked ? "" : ", bloqueado"}`}
                    >
                      <span>{done ? <YinYangMark small /> : unlocked ? level.number : "×"}</span>
                      <small>{level.name}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <p className="map-legend"><span className="legend-done" /> COMPLETADO EN BLANCO Y NEGRO <span className="legend-open" /> DISPONIBLE <span className="legend-lock" /> BLOQUEADO</p>
    </main>
  );

  const renderSettings = () => (
    <main className="screen settings-screen">
      <header className="topbar compact">
        <button className="icon-button" onClick={() => { setScreen(settingsReturn); setRebinding(null); }} aria-label="Volver"><PixelIcon kind="back" /></button>
        <div><p className="eyebrow">CONFIGURACIÓN DEL SISTEMA</p><h2>AJUSTES</h2></div>
        <span />
      </header>
      <section className="settings-card">
        <nav className="settings-tabs">
          <button className={settingsTab === "display" ? "active" : ""} onClick={() => setSettingsTab("display")}><PixelIcon kind="screen" /> PANTALLA</button>
          <button className={settingsTab === "audio" ? "active" : ""} onClick={() => setSettingsTab("audio")}><PixelIcon kind="sound" /> SONIDO</button>
          <button className={settingsTab === "controls" ? "active" : ""} onClick={() => setSettingsTab("controls")}><PixelIcon kind="gear" /> CONTROLES</button>
        </nav>
        <div className="settings-content">
          {settingsTab === "display" && (
            <div className="settings-section">
              <p className="section-kicker">PANTALLA</p>
              <div className="setting-row"><div><strong>MODO PANTALLA COMPLETA</strong><small>Oculta el resto del navegador para concentrarse en sufrir.</small></div><button className="small-button" onClick={toggleFullscreen}>ALTERNAR</button></div>
              <div className="setting-row"><div><strong>SACUDIDA DE PANTALLA</strong><small>Impacto visual cuando GRAYWORLD gana una ronda.</small></div><button className={`toggle ${settings.screenShake ? "on" : ""}`} onClick={() => setSettings((s) => ({ ...s, screenShake: !s.screenShake }))}><i /></button></div>
              <div className="display-preview"><div className="preview-yin" /><YinYangMark /><div className="preview-yang" /><span>960 × 540 · ESCALA PIXEL PERFECT</span></div>
            </div>
          )}
          {settingsTab === "audio" && (
            <div className="settings-section">
              <p className="section-kicker">MEZCLADOR</p>
              {(["master", "music", "sfx"] as const).map((key) => (
                <label className="slider-row" key={key}>
                  <span><strong>{key === "master" ? "VOLUMEN GENERAL" : key === "music" ? "MÚSICA" : "EFECTOS"}</strong><small>{Math.round(settings[key] * 100)}%</small></span>
                  <input type="range" min="0" max="1" step="0.01" value={settings[key]} onChange={(event) => setSettings((s) => ({ ...s, [key]: Number(event.target.value) }))} style={{ "--value": `${settings[key] * 100}%` } as React.CSSProperties} />
                </label>
              ))}
              <button className="small-button test-sound" onClick={() => playSfx("win")}>PROBAR SONIDO</button>
            </div>
          )}
          {settingsTab === "controls" && (
            <div className="settings-section controls-settings">
              <div className="controls-title"><p className="section-kicker">ASIGNACIÓN DE TECLAS</p><button className="text-button" onClick={() => setSettings((s) => ({ ...s, bindings: DEFAULT_BINDINGS }))}>RESTAURAR</button></div>
              <div className="binding-columns">
                {(["yin", "yang"] as PlayerKind[]).map((player) => (
                  <div className={`binding-player ${player}`} key={player}>
                    <h3><i className={`mini-player ${player}`} /> {playerName[player]} <small>JUGADOR {player === "yin" ? "1" : "2"}</small></h3>
                    {(Object.keys(actionName) as Action[]).map((action) => (
                      <div className="binding-row" key={action}><span>{actionName[action]}</span><button className={rebinding?.player === player && rebinding.action === action ? "listening" : ""} onClick={() => setRebinding({ player, action })}>{rebinding?.player === player && rebinding.action === action ? "PULSA..." : keyLabel(settings.bindings[player][action])}</button></div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="control-note">ESC cancela la reasignación · ABAJO acelera la caída</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );

  const renderGame = () => {
    const won = paused && levelWon;
    const index = LEVELS.findIndex((level) => level.id === activeLevelId);
    return (
      <main className="screen game-screen" style={{ "--level-accent": WORLD_THEMES[activeLevel.world - 1].accent } as React.CSSProperties}>
        <div className="game-topbar">
          <button className="icon-button" onClick={() => { setPaused(true); clickSound(); }} aria-label="Pausa">Ⅱ</button>
          <div className="game-title"><span>MUNDO {activeLevel.world}</span><strong>{activeLevel.name}</strong></div>
          <div className="death-counter"><span>CAÍDAS</span><strong>{String(deaths).padStart(2, "0")}</strong></div>
        </div>
        <GameCanvas
          level={activeLevel}
          settings={settings}
          paused={paused}
          restartToken={restartToken}
          onPause={handlePause}
          onDeath={handleDeath}
          onComplete={handleComplete}
          playSfx={playSfx}
        />
        <div className="game-bottom">
          <p><strong>PISTA:</strong> {activeLevel.hint}</p>
          <div><span>YIN {keyLabel(settings.bindings.yin.left)} {keyLabel(settings.bindings.yin.right)} {keyLabel(settings.bindings.yin.jump)}</span><span>YANG {keyLabel(settings.bindings.yang.left)} {keyLabel(settings.bindings.yang.right)} {keyLabel(settings.bindings.yang.jump)}</span></div>
        </div>
        {paused && (
          <div className="pause-layer">
            <section className={`pause-card ${won ? "win-card" : ""}`}>
              {won ? (
                <>
                  <YinYangMark />
                  <p className="eyebrow">SINCRONÍA ALCANZADA</p>
                  <h2>NIVEL COMPLETADO</h2>
                  <p>{activeLevel.id} · {activeLevel.name}</p>
                  <div className="completion-stats"><span>CAÍDAS <strong>{deaths}</strong></span><span>PROGRESO <strong>{completed.length}/{LEVELS.length}</strong></span></div>
                  <button className="pixel-button primary" onClick={nextLevel}>{index < LEVELS.length - 1 ? "SIGUIENTE NIVEL ▶" : "VOLVER AL MAPA"}</button>
                  <button className="text-button" onClick={() => go("map")}>MAPA DE NIVELES</button>
                </>
              ) : (
                <>
                  <p className="eyebrow">JUEGO EN PAUSA</p>
                  <h2>RESPIRA.</h2>
                  <p>El mundo puede esperar unos segundos.</p>
                  <button className="pixel-button primary" onClick={() => { setPaused(false); clickSound(); }}>CONTINUAR</button>
                  <button className="pixel-button" onClick={() => { setRestartToken((token) => token + 1); setLevelWon(false); setPaused(false); clickSound(); }}>REINICIAR NIVEL</button>
                  <button className="pixel-button" onClick={() => openSettings("game")}>AJUSTES</button>
                  <button className="text-button" onClick={() => { setPaused(false); go("map"); }}>SALIR AL MAPA</button>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    );
  };

  if (!hydrated) return <main className="boot-screen"><YinYangMark /><p>CONSTRUYENDO EL MUNDO...</p></main>;
  return (
    <div className="grayworld-app">
      {screen === "title" && renderTitle()}
      {screen === "map" && renderMap()}
      {screen === "settings" && renderSettings()}
      {screen === "game" && renderGame()}
    </div>
  );
}
