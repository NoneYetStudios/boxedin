/**
 * Boxed In — Three.js 3D Lattice Renderer & Camera / Selection Controller
 * Handles smooth OrbitControls, generous smart raycast edge picking,
 * floating rotating setup preview, cube capture animations, and particle bursts.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getColor } from './config.js';
import { createLattice } from './lattice.js';

const EDGE_RADIUS = {
  2: { unclaimed: 0.020, claimed: 0.040, hover: 0.056, hitbox: 0.155 },
  3: { unclaimed: 0.017, claimed: 0.034, hover: 0.048, hitbox: 0.135 },
  4: { unclaimed: 0.014, claimed: 0.029, hover: 0.042, hitbox: 0.118 },
};

const VERTEX_RADIUS = { 2: 0.036, 3: 0.030, 4: 0.026 };
const CUBE_INSET = 0.85;
const UP_VEC = new THREE.Vector3(0, 1, 0);

/**
 * Compute shortest distance from a 3D ray to a finite line segment [a, b].
 */
function rayToSegmentDistance(rayOrigin, rayDir, a, b) {
  const u = rayDir;
  const v = _tmpV1.subVectors(b, a);
  const w = _tmpV2.subVectors(rayOrigin, a);

  const aDot = u.dot(u); // 1.0 (normalized)
  const bDot = u.dot(v);
  const cDot = v.dot(v);
  const dDot = u.dot(w);
  const eDot = v.dot(w);
  const denom = aDot * cDot - bDot * bDot;

  let sc;
  let tc;
  if (denom < 1e-7) {
    sc = 0;
    tc = bDot > cDot ? dDot / bDot : eDot / cDot;
  } else {
    sc = (bDot * eDot - cDot * dDot) / denom;
    tc = (aDot * eDot - bDot * dDot) / denom;
  }

  sc = Math.max(0, sc);
  tc = Math.max(0, Math.min(1, tc));

  // Recompute sc on ray for clamped tc
  if (tc === 0 || tc === 1) {
    const segPt = _tmpV3.copy(a).addScaledVector(v, tc);
    const toPt = _tmpV4.subVectors(segPt, rayOrigin);
    sc = Math.max(0, toPt.dot(u));
  }

  const pRay = _tmpV3.copy(rayOrigin).addScaledVector(u, sc);
  const pSeg = _tmpV4.copy(a).addScaledVector(v, tc);
  return pRay.distanceTo(pSeg);
}

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();
const _tmpV4 = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

function createSoftParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class BoardRenderer {
  /**
   * @param {HTMLElement} container
   * @param {object} callbacks
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.webglSupported = true;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.raycaster = new THREE.Raycaster();

    this.boardRoot = new THREE.Group();
    this.vertexGroup = new THREE.Group();
    this.edgeGroup = new THREE.Group();
    this.hitboxGroup = new THREE.Group();
    this.cubeGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();
    this.particleGroup = new THREE.Group();

    this.boardRoot.add(
      this.vertexGroup,
      this.edgeGroup,
      this.cubeGroup,
      this.overlayGroup,
      this.hitboxGroup,
      this.particleGroup
    );

    this.currentSize = 3;
    this.lattice = null;
    this.playerColors = [getColor('blue'), getColor('red')];

    this.previewMode = true;
    this.previewTime = 0;

    this.hoveredEdgeId = -1;
    this.selectedEdgeId = -1;
    this.lastMoveEdgeId = -1;
    this.activePlayerIndex = 0;
    this.interactive = false;

    this.edgeMeshes = [];
    this.edgeHitboxes = [];
    this.edgeOwnedBy = [];
    this.cubeMeshes = [];
    this.cubeWireframes = [];
    this.cubeAnimations = [];
    this.edgeAnimations = [];
    this.particleBursts = [];

    // Hover/selected preview overlay meshes
    this.hoverRod = null;
    this.hoverHalo = null;
    this.selectRod = null;
    this.selectHalo = null;
    this.lastMoveHalo = null;
    this.cubePreviewPool = [];

    // Camera reset animation state
    this.camAnim = null;

    // Pointer tracking (strict drag vs tap separation)
    this.activePointers = new Map();
    this.gesturePointerId = null;
    this.multiTouchActive = false;
    this.pointerMoved = 0;
    this.downPos = { x: 0, y: 0 };

    // Shared geometries/materials initialized in _initScene
    this.shared = {};
    this._rafId = 0;
    this._lastFrameTime = performance.now();
    this._resizeObserver = null;

    this._initScene();
  }

  _initScene() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      this.webglSupported = false;
      return;
    }

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.className = 'board-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Boxed In 3D game board');
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.add(this.boardRoot);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 80);

    // Three-point arcade lighting for clean depth readability
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.92);
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.72);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(5, 8, 6);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-6, -4, -5);
    this.scene.add(ambient, hemi, keyLight, rimLight);

    // OrbitControls: Left-drag rotate, wheel zoom, right-drag pan; Mobile 1-finger rotate, pinch zoom, 2-finger pan
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.rotateSpeed = 0.78;
    this.controls.zoomSpeed = 0.95;
    this.controls.panSpeed = 0.78;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.addEventListener('start', () => {
      // User dragging immediately overrides reset-view interpolation
      this.camAnim = null;
    });

    // Shared resources
    this.shared.unitCylGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
    this.shared.unitHitGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
    this.shared.unitSphereGeo = new THREE.SphereGeometry(1, 12, 10);
    this.shared.unitBoxGeo = new THREE.BoxGeometry(CUBE_INSET, CUBE_INSET, CUBE_INSET);
    this.shared.unitBoxEdgesGeo = new THREE.EdgesGeometry(this.shared.unitBoxGeo);
    this.shared.previewBoxGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(0.95, 0.95, 0.95)
    );
    this.shared.particleTex = createSoftParticleTexture();

    this.shared.vertexMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      emissive: 0x334155,
      emissiveIntensity: 0.4,
      roughness: 0.35,
      metalness: 0.3,
    });

    this.shared.unclaimedMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: 0x1e293b,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.32,
      roughness: 0.55,
      metalness: 0.1,
      depthWrite: false,
    });

    this.shared.hitboxMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.shared.claimedMats = [
      this._makeClaimedEdgeMat(this.playerColors[0]),
      this._makeClaimedEdgeMat(this.playerColors[1]),
    ];

    this.shared.cubeMats = [
      this._makeCapturedCubeMat(this.playerColors[0]),
      this._makeCapturedCubeMat(this.playerColors[1]),
    ];

    this.shared.cubeWireMats = [
      new THREE.LineBasicMaterial({
        color: this.playerColors[0].threeGlow,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
      new THREE.LineBasicMaterial({
        color: this.playerColors[1].threeGlow,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    ];

    this._initOverlayMeshes();
    this._bindInput();
    this._bindResize();
    this._startLoop();
  }

  _makeClaimedEdgeMat(colorObj) {
    return new THREE.MeshStandardMaterial({
      color: colorObj.threeHex,
      emissive: colorObj.threeHex,
      emissiveIntensity: 0.42,
      roughness: 0.22,
      metalness: 0.18,
    });
  }

  _makeCapturedCubeMat(colorObj) {
    return new THREE.MeshPhysicalMaterial({
      color: colorObj.threeHex,
      emissive: colorObj.threeHex,
      emissiveIntensity: 0.36,
      transparent: true,
      opacity: 0.25,
      roughness: 0.18,
      metalness: 0.05,
      depthWrite: false,
      side: THREE.FrontSide,
    });
  }

  _initOverlayMeshes() {
    this.hoverRodMat = new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      emissive: 0x93c5fd,
      emissiveIntensity: 0.95,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.95,
    });
    this.hoverRod = new THREE.Mesh(this.shared.unitCylGeo, this.hoverRodMat);
    this.hoverRod.visible = false;
    this.hoverRod.renderOrder = 4;

    this.hoverHaloMat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.hoverHalo = new THREE.Mesh(this.shared.unitCylGeo, this.hoverHaloMat);
    this.hoverHalo.visible = false;
    this.hoverHalo.renderOrder = 4;

    this.selectRodMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x60a5fa,
      emissiveIntensity: 1.15,
      roughness: 0.12,
    });
    this.selectRod = new THREE.Mesh(this.shared.unitCylGeo, this.selectRodMat);
    this.selectRod.visible = false;
    this.selectRod.renderOrder = 5;

    this.selectHaloMat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.selectHalo = new THREE.Mesh(this.shared.unitCylGeo, this.selectHaloMat);
    this.selectHalo.visible = false;
    this.selectHalo.renderOrder = 5;

    this.lastMoveHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lastMoveHalo = new THREE.Mesh(this.shared.unitCylGeo, this.lastMoveHaloMat);
    this.lastMoveHalo.visible = false;
    this.lastMoveHalo.renderOrder = 3;

    this.overlayGroup.add(
      this.hoverRod,
      this.hoverHalo,
      this.selectRod,
      this.selectHalo,
      this.lastMoveHalo
    );

    // Pool of up to 4 affected cube preview outlines (max cubes touching any edge is 4)
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      });
      const line = new THREE.LineSegments(this.shared.previewBoxGeo, mat);
      line.visible = false;
      line.renderOrder = 6;
      this.overlayGroup.add(line);
      this.cubePreviewPool.push({ line, mat });
    }
  }

  _bindInput() {
    const el = this.renderer.domElement;

    el.addEventListener('pointerdown', (e) => {
      if (!this.interactive || this.previewMode) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size > 1) {
        this.multiTouchActive = true;
        this.gesturePointerId = null;
        return;
      }

      if (e.pointerType === 'mouse' && e.button !== 0) return;

      this.multiTouchActive = false;
      this.gesturePointerId = e.pointerId;
      this.pointerMoved = 0;
      this.downPos = { x: e.clientX, y: e.clientY };
    });

    el.addEventListener('pointermove', (e) => {
      if (this.activePointers.has(e.pointerId)) {
        const dx = e.clientX - this.downPos.x;
        const dy = e.clientY - this.downPos.y;
        this.pointerMoved = Math.max(this.pointerMoved, Math.hypot(dx, dy));
      }

      // Hover highlight for desktop mouse when no drag is active
      if (
        this.interactive &&
        !this.previewMode &&
        e.pointerType === 'mouse' &&
        e.buttons === 0
      ) {
        const edgeId = this._pickEdgeAt(e.clientX, e.clientY);
        this.setHoveredEdge(edgeId);
      } else if (this.pointerMoved > 8 && e.buttons > 0) {
        this.setHoveredEdge(-1);
      }
    });

    const handlePointerUpOrCancel = (e, isUp) => {
      this.activePointers.delete(e.pointerId);

      if (
        isUp &&
        this.interactive &&
        !this.previewMode &&
        !this.multiTouchActive &&
        this.gesturePointerId === e.pointerId &&
        (e.pointerType !== 'mouse' || e.button === 0)
      ) {
        const maxTapMove = e.pointerType === 'touch' ? 14 : 7;
        if (this.pointerMoved <= maxTapMove) {
          const edgeId = this._pickEdgeAt(e.clientX, e.clientY);
          if (edgeId >= 0 && this.callbacks.onEdgeTap) {
            this.callbacks.onEdgeTap(edgeId);
          } else if (edgeId < 0 && this.selectedEdgeId >= 0 && this.callbacks.onEmptyTap) {
            this.callbacks.onEmptyTap();
          }
        }
      }

      if (this.gesturePointerId === e.pointerId) {
        this.gesturePointerId = null;
      }
      if (this.activePointers.size === 0) {
        this.multiTouchActive = false;
      }
    };

    el.addEventListener('pointerup', (e) => handlePointerUpOrCancel(e, true));
    el.addEventListener('pointercancel', (e) => handlePointerUpOrCancel(e, false));
    el.addEventListener('pointerleave', () => {
      this.setHoveredEdge(-1);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindResize() {
    this._onResize = () => {
      if (!this.renderer || !this.camera) return;
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    };

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(this.container);
    }
    window.addEventListener('resize', this._onResize);
  }

  _positionCylinder(mesh, p1, p2, radius, lengthFactor = 1) {
    const start = _tmpV1.set(p1[0], p1[1], p1[2]);
    const end = _tmpV2.set(p2[0], p2[1], p2[2]);
    const mid = _tmpV3.addVectors(start, end).multiplyScalar(0.5);
    const dir = _tmpV4.subVectors(end, start);
    const len = dir.length();
    dir.normalize();

    _tmpQuat.setFromUnitVectors(UP_VEC, dir);
    mesh.position.copy(mid);
    mesh.quaternion.copy(_tmpQuat);
    mesh.scale.set(radius, len * lengthFactor, radius);
  }

  _pickEdgeAt(clientX, clientY) {
    if (!this.lattice || this.edgeHitboxes.length === 0) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return -1;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hits = this.raycaster.intersectObjects(this.edgeHitboxes, false);
    if (hits.length === 0) return -1;

    // Filter to unclaimed edges and score by centerline closeness + slight front bias
    // so front hitbox skirts don't steal clicks aimed straight at interior edges.
    const ray = this.raycaster.ray;
    let bestEdgeId = -1;
    let bestScore = Infinity;

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const eid = hit.object.userData.edgeId;
      if (this.edgeOwnedBy[eid] !== -1) continue;

      const edge = this.lattice.edges[eid];
      const a = new THREE.Vector3(edge.p1[0], edge.p1[1], edge.p1[2]);
      const b = new THREE.Vector3(edge.p2[0], edge.p2[1], edge.p2[2]);
      const perpDist = rayToSegmentDistance(ray.origin, ray.direction, a, b);

      // Direct centerline hit on the frontmost edge wins immediately
      if (i === 0 && perpDist <= 0.055) {
        return eid;
      }

      const score = perpDist + hit.distance * 0.04;
      if (score < bestScore) {
        bestScore = score;
        bestEdgeId = eid;
      }
    }

    return bestEdgeId;
  }

  /**
   * Update active player colors dynamically (used in setup preview and match start).
   */
  setPlayerColors(p1ColorId, p2ColorId) {
    this.playerColors = [getColor(p1ColorId, 'blue'), getColor(p2ColorId, 'red')];
    if (!this.webglSupported) return;

    for (let p = 0; p < 2; p++) {
      const c = this.playerColors[p];
      this.shared.claimedMats[p].color.setHex(c.threeHex);
      this.shared.claimedMats[p].emissive.setHex(c.threeHex);
      this.shared.cubeMats[p].color.setHex(c.threeHex);
      this.shared.cubeMats[p].emissive.setHex(c.threeHex);
      this.shared.cubeWireMats[p].color.setHex(c.threeGlow);
    }

    this._refreshHighlightColors();
  }

  setActivePlayer(playerIndex) {
    this.activePlayerIndex = playerIndex === 1 ? 1 : 0;
    this._refreshHighlightColors();
  }

  _refreshHighlightColors() {
    if (!this.webglSupported) return;
    const c = this.playerColors[this.activePlayerIndex];
    this.hoverRodMat.color.setHex(c.threeGlow);
    this.hoverRodMat.emissive.setHex(c.threeHex);
    this.hoverHaloMat.color.setHex(c.threeGlow);
    this.selectRodMat.emissive.setHex(c.threeHex);
    this.selectHaloMat.color.setHex(c.threeGlow);
  }

  /**
   * Build 3D meshes for a lattice of size N (2, 3, or 4).
   */
  buildBoard(lattice) {
    if (!this.webglSupported) return;
    this.lattice = lattice;
    this.currentSize = lattice.size;

    // Clear previous board meshes
    this._clearGroup(this.vertexGroup);
    this._clearGroup(this.edgeGroup);
    this._clearGroup(this.hitboxGroup);
    this._clearGroup(this.cubeGroup);
    this.edgeMeshes = [];
    this.edgeHitboxes = [];
    this.edgeOwnedBy = new Array(lattice.edgeCount).fill(-1);
    this.cubeMeshes = [];
    this.cubeWireframes = [];
    this.cubeAnimations = [];
    this.edgeAnimations = [];
    this.hoveredEdgeId = -1;
    this.selectedEdgeId = -1;
    this.lastMoveEdgeId = -1;
    this._updateOverlays();

    const radii = EDGE_RADIUS[lattice.size] || EDGE_RADIUS[3];
    const vRad = VERTEX_RADIUS[lattice.size] || 0.03;

    // 1. Vertices (single InstancedMesh draw call)
    const vInst = new THREE.InstancedMesh(
      this.shared.unitSphereGeo,
      this.shared.vertexMat,
      lattice.vertexCount
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < lattice.vertexCount; i++) {
      const p = lattice.vertices[i].pos;
      dummy.position.set(p[0], p[1], p[2]);
      dummy.scale.setScalar(vRad);
      dummy.updateMatrix();
      vInst.setMatrixAt(i, dummy.matrix);
    }
    vInst.instanceMatrix.needsUpdate = true;
    this.vertexGroup.add(vInst);

    // 2. Edges & Hitboxes
    for (let i = 0; i < lattice.edgeCount; i++) {
      const edge = lattice.edges[i];

      const mesh = new THREE.Mesh(this.shared.unitCylGeo, this.shared.unclaimedMat);
      this._positionCylinder(mesh, edge.p1, edge.p2, radii.unclaimed, 1.0);
      mesh.renderOrder = 1;
      mesh.userData = { edgeId: i };
      this.edgeGroup.add(mesh);
      this.edgeMeshes.push(mesh);

      const hit = new THREE.Mesh(this.shared.unitHitGeo, this.shared.hitboxMat);
      this._positionCylinder(hit, edge.p1, edge.p2, radii.hitbox, 0.74);
      hit.userData = { edgeId: i };
      this.hitboxGroup.add(hit);
      this.edgeHitboxes.push(hit);
    }

    // 3. Cube volume placeholders (revealed on capture)
    for (let i = 0; i < lattice.cubeCount; i++) {
      const cube = lattice.cubes[i];

      const box = new THREE.Mesh(this.shared.unitBoxGeo, this.shared.cubeMats[0]);
      box.position.set(cube.center[0], cube.center[1], cube.center[2]);
      box.visible = false;
      box.renderOrder = 2;
      this.cubeGroup.add(box);
      this.cubeMeshes.push(box);

      const wire = new THREE.LineSegments(
        this.shared.unitBoxEdgesGeo,
        this.shared.cubeWireMats[0]
      );
      wire.position.set(cube.center[0], cube.center[1], cube.center[2]);
      wire.visible = false;
      wire.renderOrder = 2;
      this.cubeGroup.add(wire);
      this.cubeWireframes.push(wire);
    }

    this._configureCameraLimits();
    this.resetView(true);
  }

  _clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child.isInstancedMesh) {
        child.dispose();
      }
    }
  }

  _getDefaultCameraPose() {
    const n = this.currentSize;
    const aspect = this.camera ? this.camera.aspect : 1.5;
    const portraitBoost = aspect < 1 ? Math.min(2.35, 1.24 / Math.max(0.42, aspect)) : 1.0;
    const baseDist = (n * 1.9 + 1.65) * portraitBoost;

    // Frame the floating preview cube cleanly in the open area beside/above the setup card
    const isWide = this.container.clientWidth >= 900;
    const desktopPreviewShiftX = this.previewMode && isWide ? -n * 0.45 : 0;
    const mobilePreviewShiftY = this.previewMode && !isWide ? -n * 0.72 : 0;

    const target = new THREE.Vector3(desktopPreviewShiftX, mobilePreviewShiftY, 0);
    const dir = new THREE.Vector3(1.12, 0.88, 1.28).normalize();
    const pos = target.clone().addScaledVector(dir, baseDist);
    return { pos, target };
  }

  _configureCameraLimits() {
    if (!this.controls) return;
    const n = this.currentSize;
    this.controls.minDistance = Math.max(2.1, n * 0.82);
    this.controls.maxDistance = n * 4.5 + 6.5;
  }

  /**
   * Reset camera to balanced isometric framing (animated by default).
   */
  resetView(immediate = false) {
    if (!this.webglSupported || !this.controls) return;
    const { pos, target } = this._getDefaultCameraPose();

    if (immediate) {
      this.camAnim = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    this.camAnim = {
      startPos: this.camera.position.clone(),
      endPos: pos,
      startTarget: this.controls.target.clone(),
      endTarget: target,
      elapsed: 0,
      duration: 0.36,
    };
  }

  /**
   * Switch between floating rotating setup cube preview and active gameplay.
   */
  setPreviewMode(enabled, { boardSize, p1Color, p2Color } = {}) {
    this.previewMode = Boolean(enabled);
    this.interactive = !this.previewMode;
    if (!this.webglSupported) return;

    this.setPlayerColors(p1Color, p2Color);

    if (this.previewMode) {
      const targetSize = boardSize || this.currentSize || 3;
      const previewLattice = createLattice(targetSize);
      this.buildBoard(previewLattice);
      this._populatePreviewShowcase(previewLattice);
      this.controls.enabled = false;
      this.resetView(true);
    } else {
      this.boardRoot.rotation.set(0, 0, 0);
      this.boardRoot.position.set(0, 0, 0);
      this.controls.enabled = true;
    }
  }

  /**
   * Populate an inviting sample pattern of colored edges and 2-3 translucent cubes for the floating preview.
   */
  _populatePreviewShowcase(lattice) {
    // Capture corner cube (0,0,0) in P1 color & opposite top-front cube in P2 color
    const c1 = lattice.cubes[0];
    const c2 = lattice.cubes[lattice.cubes.length - 1];

    const claimPreviewCube = (cube, player) => {
      for (const eid of cube.edges) {
        this.edgeOwnedBy[eid] = player;
        const mesh = this.edgeMeshes[eid];
        mesh.material = this.shared.claimedMats[player];
        const radii = EDGE_RADIUS[lattice.size] || EDGE_RADIUS[3];
        const edge = lattice.edges[eid];
        this._positionCylinder(mesh, edge.p1, edge.p2, radii.claimed, 1.0);
      }
      const box = this.cubeMeshes[cube.id];
      const wire = this.cubeWireframes[cube.id];
      box.material = this.shared.cubeMats[player];
      wire.material = this.shared.cubeWireMats[player];
      box.visible = true;
      wire.visible = true;
    };

    claimPreviewCube(c1, 0);
    claimPreviewCube(c2, 1);

    // Add a few extra decorative edges on middle cubes so the cube looks alive
    const midStart = Math.floor(lattice.edgeCount * 0.35);
    for (let i = 0; i < Math.min(8, lattice.edgeCount); i++) {
      const eid = (midStart + i * 7) % lattice.edgeCount;
      if (this.edgeOwnedBy[eid] === -1) {
        const player = i % 2;
        this.edgeOwnedBy[eid] = player;
        const mesh = this.edgeMeshes[eid];
        mesh.material = this.shared.claimedMats[player];
        const radii = EDGE_RADIUS[lattice.size] || EDGE_RADIUS[3];
        const edge = lattice.edges[eid];
        this._positionCylinder(mesh, edge.p1, edge.p2, radii.claimed, 1.0);
      }
    }
  }

  /**
   * Synchronize 3D board visuals with a GameEngine state (supports full sync or move delta).
   */
  syncFromEngine(engine, moveDelta = null) {
    if (!this.webglSupported || !engine?.lattice) return;

    if (!this.lattice || this.lattice.size !== engine.lattice.size) {
      this.buildBoard(engine.lattice);
    }

    this.setPlayerColors(
      engine.config.players[0].colorId,
      engine.config.players[1].colorId
    );
    this.setActivePlayer(engine.currentPlayer);
    this.interactive = engine.status === 'playing';
    this.lastMoveEdgeId = engine.lastMove ? engine.lastMove.edgeId : -1;

    const radii = EDGE_RADIUS[this.lattice.size] || EDGE_RADIUS[3];

    // Update all edges
    for (let i = 0; i < this.lattice.edgeCount; i++) {
      const owner = engine.edgeOwner[i];
      if (this.edgeOwnedBy[i] !== owner) {
        this.edgeOwnedBy[i] = owner;
        const mesh = this.edgeMeshes[i];
        const edge = this.lattice.edges[i];

        if (owner === -1) {
          mesh.material = this.shared.unclaimedMat;
          this._positionCylinder(mesh, edge.p1, edge.p2, radii.unclaimed, 1.0);
          this.edgeHitboxes[i].visible = true;
        } else {
          mesh.material = this.shared.claimedMats[owner];
          this._positionCylinder(mesh, edge.p1, edge.p2, radii.claimed, 1.0);
          this.edgeHitboxes[i].visible = false;
          if (moveDelta && moveDelta.edgeId === i) {
            this.edgeAnimations.push({
              edgeId: i,
              baseRadius: radii.claimed,
              elapsed: 0,
              duration: 0.22,
            });
          }
        }
      }
    }

    // Update all cubes
    const newlyCaptured = new Set(moveDelta?.capturedCubes || []);
    for (let i = 0; i < this.lattice.cubeCount; i++) {
      const owner = engine.cubeOwner[i];
      const box = this.cubeMeshes[i];
      const wire = this.cubeWireframes[i];

      if (owner === -1) {
        box.visible = false;
        wire.visible = false;
      } else {
        const wasHidden = !box.visible;
        box.material = this.shared.cubeMats[owner];
        wire.material = this.shared.cubeWireMats[owner];
        box.visible = true;
        wire.visible = true;

        if (wasHidden && newlyCaptured.has(i)) {
          box.scale.setScalar(0.15);
          wire.scale.setScalar(0.15);
          this.cubeAnimations.push({
            cubeId: i,
            elapsed: 0,
            duration: 0.30,
          });
          this._spawnCaptureParticles(
            this.lattice.cubes[i].center,
            this.playerColors[owner].threeGlow
          );
        } else if (wasHidden) {
          box.scale.setScalar(1);
          wire.scale.setScalar(1);
        }
      }
    }

    // Clear hover/selection if edge is now claimed
    if (this.hoveredEdgeId >= 0 && engine.edgeOwner[this.hoveredEdgeId] !== -1) {
      this.hoveredEdgeId = -1;
    }
    if (this.selectedEdgeId >= 0 && engine.edgeOwner[this.selectedEdgeId] !== -1) {
      this.selectedEdgeId = -1;
    }

    this._updateOverlays(engine);
  }

  setHoveredEdge(edgeId, engine = null) {
    const next = edgeId >= 0 && this.edgeOwnedBy[edgeId] === -1 ? edgeId : -1;
    if (next === this.hoveredEdgeId) return;
    this.hoveredEdgeId = next;
    this._updateOverlays(engine);
    if (this.callbacks.onHoverEdgeChange) {
      this.callbacks.onHoverEdgeChange(next);
    }
  }

  setSelectedEdge(edgeId, engine = null) {
    const next = edgeId >= 0 && this.edgeOwnedBy[edgeId] === -1 ? edgeId : -1;
    this.selectedEdgeId = next;
    this._updateOverlays(engine);
  }

  refreshOverlays(engine) {
    this._updateOverlays(engine);
  }

  _updateOverlays(engine = null) {
    if (!this.webglSupported || !this.lattice) return;
    const radii = EDGE_RADIUS[this.lattice.size] || EDGE_RADIUS[3];

    // Last move subtle halo
    if (this.lastMoveEdgeId >= 0 && !this.previewMode) {
      const e = this.lattice.edges[this.lastMoveEdgeId];
      const owner = this.edgeOwnedBy[this.lastMoveEdgeId];
      const color = owner >= 0 ? this.playerColors[owner].threeGlow : 0xffffff;
      this.lastMoveHaloMat.color.setHex(color);
      this._positionCylinder(this.lastMoveHalo, e.p1, e.p2, radii.claimed * 1.55, 1.0);
      this.lastMoveHalo.visible = true;
    } else {
      this.lastMoveHalo.visible = false;
    }

    // Hovered edge glow
    if (this.hoveredEdgeId >= 0 && this.hoveredEdgeId !== this.selectedEdgeId && !this.previewMode) {
      const e = this.lattice.edges[this.hoveredEdgeId];
      this._positionCylinder(this.hoverRod, e.p1, e.p2, radii.hover, 1.0);
      this._positionCylinder(this.hoverHalo, e.p1, e.p2, radii.hover * 1.9, 1.0);
      this.hoverRod.visible = true;
      this.hoverHalo.visible = true;
    } else {
      this.hoverRod.visible = false;
      this.hoverHalo.visible = false;
    }

    // Selected edge confirmation preview
    if (this.selectedEdgeId >= 0 && !this.previewMode) {
      const e = this.lattice.edges[this.selectedEdgeId];
      this._positionCylinder(this.selectRod, e.p1, e.p2, radii.hover * 1.08, 1.0);
      this._positionCylinder(this.selectHalo, e.p1, e.p2, radii.hover * 2.15, 1.0);
      this.selectRod.visible = true;
      this.selectHalo.visible = true;
    } else {
      this.selectRod.visible = false;
      this.selectHalo.visible = false;
    }

    // Cube preview outlines (prioritize selected edge if present, else hovered edge)
    for (const item of this.cubePreviewPool) {
      item.line.visible = false;
    }

    const inspectEdgeId =
      this.selectedEdgeId >= 0 ? this.selectedEdgeId : this.hoveredEdgeId;
    if (inspectEdgeId >= 0 && engine && !this.previewMode) {
      const info = engine.analyzeEdge(inspectEdgeId);
      const completesSet = new Set(info.completesCubes);
      const vulnerableSet = new Set(info.vulnerableCubes);
      const activeColor = this.playerColors[this.activePlayerIndex].threeGlow;

      info.affectedCubes.slice(0, 4).forEach((cid, idx) => {
        const poolItem = this.cubePreviewPool[idx];
        const cube = this.lattice.cubes[cid];
        poolItem.line.position.set(cube.center[0], cube.center[1], cube.center[2]);

        if (completesSet.has(cid)) {
          poolItem.mat.color.setHex(activeColor);
          poolItem.mat.opacity = 0.92;
        } else if (vulnerableSet.has(cid)) {
          poolItem.mat.color.setHex(0xfbbf24);
          poolItem.mat.opacity = 0.68;
        } else {
          poolItem.mat.color.setHex(0xe2e8f0);
          poolItem.mat.opacity = 0.22;
        }
        poolItem.line.visible = true;
      });
    }
  }

  _spawnCaptureParticles(center, hexColor) {
    const count = 20;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Random spherical direction
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.75 + Math.random() * 1.15;
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.cos(phi);
      const sz = Math.sin(phi) * Math.sin(theta);

      positions[i * 3] = center[0] + sx * 0.14;
      positions[i * 3 + 1] = center[1] + sy * 0.14;
      positions[i * 3 + 2] = center[2] + sz * 0.14;

      velocities[i * 3] = sx * speed;
      velocities[i * 3 + 1] = sy * speed;
      velocities[i * 3 + 2] = sz * speed;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: hexColor,
      map: this.shared.particleTex,
      size: 0.19,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.renderOrder = 7;
    this.particleGroup.add(points);

    this.particleBursts.push({
      points,
      geo,
      mat,
      velocities,
      elapsed: 0,
      duration: 0.65,
    });
  }

  _startLoop() {
    const tick = (now) => {
      this._rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0.001, (now - this._lastFrameTime) / 1000));
      this._lastFrameTime = now;
      this._update(dt, now / 1000);
      this.renderer.render(this.scene, this.camera);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _update(dt, timeSec) {
    // 1. Floating rotating cube preview on Setup screen
    if (this.previewMode) {
      this.previewTime += dt;
      this.boardRoot.rotation.y += dt * 0.34;
      this.boardRoot.rotation.x = Math.sin(this.previewTime * 0.55) * 0.18;
      this.boardRoot.position.y = Math.sin(this.previewTime * 1.25) * 0.1;
    } else if (this.controls) {
      // 2. Smooth reset-view camera tween
      if (this.camAnim) {
        this.camAnim.elapsed += dt;
        const rawT = Math.min(1, this.camAnim.elapsed / this.camAnim.duration);
        const ease = 1 - Math.pow(1 - rawT, 3);
        this.camera.position.lerpVectors(this.camAnim.startPos, this.camAnim.endPos, ease);
        this.controls.target.lerpVectors(
          this.camAnim.startTarget,
          this.camAnim.endTarget,
          ease
        );
        if (rawT >= 1) {
          this.camAnim = null;
        }
      }

      this.controls.update();

      // Keep pan target within clean bounds around the lattice
      const panBound = this.currentSize * 0.85;
      this.controls.target.clampLength(0, panBound);
    }

    // 3. Selected edge pulse in confirmation mode
    if (this.selectedEdgeId >= 0 && this.selectHalo?.visible) {
      const pulse = 0.35 + 0.28 * (0.5 + 0.5 * Math.sin(timeSec * 8));
      this.selectHaloMat.opacity = pulse;
    }

    // 4. Newly claimed edge pop-in animation
    for (let i = this.edgeAnimations.length - 1; i >= 0; i--) {
      const anim = this.edgeAnimations[i];
      anim.elapsed += dt;
      const t = Math.min(1, anim.elapsed / anim.duration);
      const scale = 1 + 0.38 * (1 - t) * Math.sin((1 - t) * Math.PI);
      const mesh = this.edgeMeshes[anim.edgeId];
      if (mesh) {
        mesh.scale.x = anim.baseRadius * scale;
        mesh.scale.z = anim.baseRadius * scale;
      }
      if (t >= 1) {
        if (mesh) {
          mesh.scale.x = anim.baseRadius;
          mesh.scale.z = anim.baseRadius;
        }
        this.edgeAnimations.splice(i, 1);
      }
    }

    // 5. Captured cube scale-bounce animation
    for (let i = this.cubeAnimations.length - 1; i >= 0; i--) {
      const anim = this.cubeAnimations[i];
      anim.elapsed += dt;
      const t = Math.min(1, anim.elapsed / anim.duration);
      // Smooth overshoot ease-out
      const s = 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.08;
      const box = this.cubeMeshes[anim.cubeId];
      const wire = this.cubeWireframes[anim.cubeId];
      if (box && wire) {
        box.scale.setScalar(s);
        wire.scale.setScalar(s);
      }
      if (t >= 1) {
        if (box && wire) {
          box.scale.setScalar(1);
          wire.scale.setScalar(1);
        }
        this.cubeAnimations.splice(i, 1);
      }
    }

    // 6. Subtle capture particle bursts
    for (let i = this.particleBursts.length - 1; i >= 0; i--) {
      const burst = this.particleBursts[i];
      burst.elapsed += dt;
      const t = Math.min(1, burst.elapsed / burst.duration);
      const posAttr = burst.geo.getAttribute('position');
      const arr = posAttr.array;
      const damp = Math.pow(0.18, dt);

      for (let p = 0; p < arr.length; p++) {
        arr[p] += burst.velocities[p] * dt;
        burst.velocities[p] *= damp;
      }
      posAttr.needsUpdate = true;
      burst.mat.opacity = 0.9 * Math.pow(1 - t, 1.6);

      if (t >= 1) {
        this.particleGroup.remove(burst.points);
        burst.geo.dispose();
        burst.mat.dispose();
        this.particleBursts.splice(i, 1);
      }
    }
  }

  dispose() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    window.removeEventListener('resize', this._onResize);
    if (this.controls) this.controls.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
