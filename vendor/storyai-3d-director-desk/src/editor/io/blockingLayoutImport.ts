import type { CharacterBodyType, DirectorObject } from "../schema/directorProject";
import { DEFAULT_CHARACTER_BODY_TYPE } from "../runtime/mannequin/bodyTypes";

export type HostBlockingLayoutCharacter = {
  characterId: number | string;
  name: string;
  zone?: string;
  facing?: string;
  color?: string;
  position?: [number, number, number];
  rotationY?: number;
};

export type HostBlockingLayoutPayload = {
  characters?: HostBlockingLayoutCharacter[];
  notes?: string;
  force?: boolean;
};

const ZONE_POSITIONS: Record<string, [number, number, number]> = {
  left_front: [-1.6, 0, 1.2],
  center: [0, 0, 0],
  right_front: [1.6, 0, 1.2],
  left_back: [-1.6, 0, -1.4],
  right_back: [1.6, 0, -1.4],
};

const FACING_ROTATIONS: Record<string, number> = {
  camera: 0,
  front: 0,
  left: Math.PI / 2,
  right: -Math.PI / 2,
  back: Math.PI,
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePosition(value: unknown, zone: string): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    const z = Number(value[2]);
    if ([x, y, z].every(Number.isFinite)) {
      return [x, y, z];
    }
  }

  return ZONE_POSITIONS[zone] || ZONE_POSITIONS.center;
}

function normalizeRotationY(facing: string, value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return FACING_ROTATIONS[facing] ?? 0;
}

export function normalizeHostBlockingLayoutPayload(payload: HostBlockingLayoutPayload | null | undefined) {
  const characters = Array.isArray(payload?.characters)
    ? payload.characters
        .map((entry, index) => {
          const rawEntry = entry as HostBlockingLayoutCharacter & { character_id?: number | string };
          const characterId = rawEntry?.characterId ?? rawEntry?.character_id ?? index + 1;
          const name = normalizeString(entry?.name) || `角色${index + 1}`;
          const zone = normalizeString(entry?.zone) || "center";
          const facing = normalizeString(entry?.facing) || "camera";
          const color = normalizeString(entry?.color);

          return {
            characterId,
            name,
            zone,
            facing,
            color: color || undefined,
            position: normalizePosition(entry?.position, zone),
            rotationY: normalizeRotationY(facing, entry?.rotationY),
          };
        })
        .filter((entry) => entry.name)
    : [];

  return {
    characters,
    notes: normalizeString(payload?.notes),
    force: Boolean(payload?.force),
  };
}

export function getHostBlockingCharacterId(characterId: number | string) {
  return `char_hg_${String(characterId)}`;
}

export function shouldApplyHostBlockingLayout(
  objects: DirectorObject[],
  force: boolean,
) {
  if (force) return true;

  const characters = objects.filter((item) => item.kind === "character");
  if (!characters.length) return true;

  if (characters.length === 1 && characters[0]?.id === "char_default_a") {
    const [x, y, z] = characters[0].transform.position;
    return x === 0 && y === 0 && z === 0;
  }

  const hostCharacters = characters.filter((item) => item.id.startsWith("char_hg_"));
  const customCharacters = characters.filter(
    (item) => !item.id.startsWith("char_hg_") && item.id !== "char_default_a"
  );

  return hostCharacters.length > 0 && customCharacters.length === 0;
}

export function buildHostBlockingCharacterObject(
  entry: ReturnType<typeof normalizeHostBlockingLayoutPayload>["characters"][number],
  bodyType: CharacterBodyType = DEFAULT_CHARACTER_BODY_TYPE,
): DirectorObject {
  return {
    id: getHostBlockingCharacterId(entry.characterId),
    name: entry.name,
    kind: "character",
    visible: true,
    locked: false,
    bodyType,
    color: entry.color || "#4F8EF7",
    transform: {
      position: entry.position,
      rotation: [0, entry.rotationY, 0],
      scale: [1, 1, 1],
    },
    characterRig: {
      rigType: "ue4-mannequin",
      posePresetId: "stand",
      controls: {},
    },
  };
}
