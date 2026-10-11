import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Carga el GLB del coche (meshopt + WebP) con el gestor de progreso compartido. */
export function loadCarModel(url, manager) {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.loadAsync(url);
}
