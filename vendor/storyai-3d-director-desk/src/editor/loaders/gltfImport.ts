import { createClientId } from "./createClientId";

export async function readGltfFile(file: File) {
  return {
    id: createClientId("gltf"),
    fileName: file.name,
    name: file.name.replace(/\.(glb|gltf)$/i, ""),
    url: URL.createObjectURL(file),
  };
}
