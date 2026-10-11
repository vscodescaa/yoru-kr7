import * as THREE from 'three';

/*
 * Reflejo planar del suelo (y = 0): la escena se dibuja desde una cámara espejada a
 * media resolución, con plano de recorte oblicuo y mipmaps para desenfocarla según
 * la rugosidad del asfalto.
 */
export class PlanarReflector {
  constructor({ scale = 0.5 } = {}) {
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      samples: 0,
    });
    this.camera = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.hidden = []; // objetos que no deben verse en el reflejo
    this.enabled = true;

    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._mirror = new THREE.Matrix4().makeScale(1, -1, 1);
    this._v = new THREE.Vector3();
  }

  setSize(w, h) {
    const W = Math.max(1, Math.round(w * this.scale));
    const H = Math.max(1, Math.round(h * this.scale));
    if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H);
  }

  update(renderer, scene, camera) {
    if (!this.enabled) return;
    const cam = this.camera;
    camera.updateMatrixWorld();
    // Cámara espejada respecto al plano y = 0.
    cam.matrixWorld.copy(this._mirror).multiply(camera.matrixWorld);
    cam.matrixWorld.multiply(this._mirror); // conserva la orientación de la imagen
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.matrixAutoUpdate = false;
    cam.matrixWorldAutoUpdate = false;
    cam.position.setFromMatrixPosition(cam.matrixWorld);
    cam.layers.mask = camera.layers.mask;

    // Matriz que lleva un punto del mundo al UV del reflejo.
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // Plano de recorte oblicuo: nada por debajo del suelo entra en el reflejo.
    const plane = this._plane.clone().applyMatrix4(cam.matrixWorldInverse);
    this._clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = cam.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(this._clip.x) + p.elements[8]) / p.elements[0];
    q.y = (Math.sign(this._clip.y) + p.elements[9]) / p.elements[5];
    q.z = -1;
    q.w = (1 + p.elements[10]) / p.elements[14];
    this._clip.multiplyScalar(2 / this._clip.dot(q));
    p.elements[2] = this._clip.x;
    p.elements[6] = this._clip.y;
    p.elements[10] = this._clip.z + 1 - 0.003;
    p.elements[14] = this._clip.w;

    const vis = this.hidden.map((o) => o.visible);
    this.hidden.forEach((o) => (o.visible = false));
    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    this.hidden.forEach((o, i) => (o.visible = vis[i]));
  }
}
