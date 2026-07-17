import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  buildHostBlockingCharacterObject,
  getHostBlockingCharacterId,
  normalizeHostBlockingLayoutPayload,
  shouldApplyHostBlockingLayout,
} from "./blockingLayoutImport";

it("maps blocking zones to world positions and facings to rotation", () => {
  const normalized = normalizeHostBlockingLayoutPayload({
    characters: [
      {
        characterId: 12,
        name: "林晚",
        zone: "left_front",
        facing: "right",
        color: "#e74c3c",
      },
    ],
  });

  expect(normalized.characters[0]).toMatchObject({
    characterId: 12,
    name: "林晚",
    position: [-1.6, 0, 1.2],
    rotationY: -Math.PI / 2,
    color: "#e74c3c",
  });
});

it("builds host-linked character objects with stable ids", () => {
  const entry = normalizeHostBlockingLayoutPayload({
    characters: [{ characterId: 7, name: "陈默", zone: "center" }],
  }).characters[0];

  const object = buildHostBlockingCharacterObject(entry);

  expect(object.id).toBe(getHostBlockingCharacterId(7));
  expect(object.name).toBe("陈默");
  expect(object.kind).toBe("character");
});

it("only auto-applies blocking layout on the default untouched scene", () => {
  const defaultScene = [
    {
      id: "char_default_a",
      kind: "character" as const,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
  ];

  expect(shouldApplyHostBlockingLayout(defaultScene as never[], false)).toBe(true);
  expect(
    shouldApplyHostBlockingLayout(
      [
        ...defaultScene,
        {
          id: "char_preset_1",
          kind: "character" as const,
          transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      ] as never[],
      false
    )
  ).toBe(false);
  expect(shouldApplyHostBlockingLayout([], true)).toBe(true);
});
