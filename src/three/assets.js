import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/** Carga compartida con progreso agregado (bytes aproximados por recurso). */
export class Assets {
  constructor(onProgress) {
    this.manager = new THREE.LoadingManager();
    this.manager.onProgress = (_, loaded, total) => onProgress?.(loaded / total);
    this.tex = new THREE.TextureLoader(this.manager);
    this.hdr = new HDRLoader(this.manager);
    this.base = import.meta.env.BASE_URL;
  }

  texture(path, { srgb = false, repeat = true } = {}) {
    return new Promise((resolve, reject) => {
      this.tex.load(
        this.base + path,
        (t) => {
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          resolve(t);
        },
        undefined,
        reject
      );
    });
  }

  hdri(path) {
    return new Promise((resolve, reject) => {
      this.hdr.load(
        this.base + path,
        (t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          resolve(t);
        },
        undefined,
        reject
      );
    });
  }
}
