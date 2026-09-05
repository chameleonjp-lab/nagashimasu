import * as THREE from 'three';

import {
  CELL_COUNT,
  CellFlag,
  Direction,
  MAX_TERRAIN_HEIGHT
} from '../domain/constants';
import type { BoardSnapshot, FlowStepResult, RainEvent, WaterTransfer } from '../domain/types';
import type { BoardRenderOptions } from './board-view-contract';
import { buildThreeBoardFrame } from './three-board-frame';
import type { ThreeBoardFrame } from './three-board-frame';
import {
  cellWorldGeometry,
  computeBoardCameraFit,
  directionVector,
  interpolateWorldPoint,
  normalizeBoardRotation,
  projectCellCenterToScreen,
  terrainBlockHeight,
  waterTransferWorldPoints
} from './three-board-math';
import type { BoardCameraFit, BoardRotation, Vec3Like } from './three-board-math';
import {
  normalizedDeviceCoordinates,
  pickNearestLegalCell
} from './three-board-picking';
import type { ProjectedCellCenter } from './three-board-picking';
import { flowParticleProgress, waterVisualLevel } from './board-visuals';
import { cellCoordinate } from './cell-label';
import { clampPlaybackProgress, playbackPulseForMotion } from './playback-visuals';
import { ThreeBoardLabelPool } from './three-board-labels';
import { ThreeResourceTracker } from './three-resource-tracker';

const MAX_FLOW_TRANSFERS = CELL_COUNT * 4;
const FLOW_PARTICLE_COUNT = 3;
const MAX_FLOW_PARTICLES = MAX_FLOW_TRANSFERS * FLOW_PARTICLE_COUNT;
const MAX_RAIN_SOURCES = CELL_COUNT;
const RAIN_DROPS_PER_SOURCE = 5;
const MAX_RAIN_DROPS = MAX_RAIN_SOURCES * RAIN_DROPS_PER_SOURCE;
const MAX_FORECAST_CELLS = CELL_COUNT * 2;
const LABEL_POOL_SIZE = 768;
const CAMERA_ROTATION_DURATION_MS = 200;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const LOGICAL_DIRECTIONS = [
  Direction.North,
  Direction.East,
  Direction.South,
  Direction.West
] as const;

export interface ThreeBoardViewCallbacks {
  readonly onInitializationError?: (error: unknown) => void;
  readonly onContextLost?: () => void;
  readonly onContextRestored?: () => void;
  readonly onCameraFrame?: () => void;
}

export interface BoardRotationOptions {
  readonly reducedMotion?: boolean;
  readonly durationMs?: number;
}

interface CameraTransition {
  readonly from: BoardCameraFit;
  readonly to: BoardCameraFit;
  readonly start: number;
  readonly durationMs: number;
  readonly frameId: number;
}

interface EdgeMarkerPair {
  readonly safe: THREE.Mesh;
  readonly danger: THREE.Mesh;
  readonly index: number;
  readonly direction: Direction;
}

interface FlowVisualPair {
  readonly route: THREE.Mesh;
  readonly arrow: THREE.Mesh;
  readonly index: number;
}

interface RiskMaterialMap {
  readonly caution: THREE.MeshBasicMaterial;
  readonly danger: THREE.MeshBasicMaterial;
  readonly critical: THREE.MeshBasicMaterial;
  readonly safe: THREE.MeshBasicMaterial;
}

interface FlowMaterialMap {
  readonly cell: THREE.MeshBasicMaterial;
  readonly 'safe-edge': THREE.MeshBasicMaterial;
  readonly 'danger-edge': THREE.MeshBasicMaterial;
}

function materialColor(color: string): THREE.Color {
  return new THREE.Color(color);
}

function terrainTopColor(height: number): string {
  const lightness = Math.max(0.27, Math.min(0.52, 0.34 + height * 0.025));
  const color = new THREE.Color().setHSL(0.39, 0.35, lightness);
  return `#${color.getHexString()}`;
}

function terrainSideColor(height: number, light: boolean): string {
  const lightness = Math.max(0.18, Math.min(0.42, 0.25 + height * 0.018 + (light ? 0.035 : 0)));
  const color = new THREE.Color().setHSL(0.4, 0.32, lightness);
  return `#${color.getHexString()}`;
}

function vectorFrom(value: Vec3Like): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function setMeshPosition(mesh: THREE.Object3D, position: Vec3Like): void {
  mesh.position.set(position.x, position.y, position.z);
}

function flowColor(transfer: Pick<WaterTransfer, 'kind'>): string {
  switch (transfer.kind) {
    case 'safe-edge': return '#8ee3cf';
    case 'danger-edge': return '#ff6b6b';
    case 'cell': return '#b9e7ff';
  }
}

function riskColor(level: string): string {
  switch (level) {
    case 'caution': return '#ffd166';
    case 'danger': return '#ff925c';
    case 'critical': return '#ff5c5c';
    default: return '#55d8ed';
  }
}

function warningLabel(level: string): string {
  switch (level) {
    case 'caution': return '?';
    case 'danger': return '!';
    case 'critical': return '‼';
    default: return '';
  }
}

function faceMaterialSet(
  resources: ThreeResourceTracker,
  height: number
): THREE.Material[] {
  const top = resources.register(new THREE.MeshStandardMaterial({
    color: materialColor(terrainTopColor(height)),
    roughness: 0.88,
    metalness: 0,
    flatShading: true
  }));
  const sideLight = resources.register(new THREE.MeshStandardMaterial({
    color: materialColor(terrainSideColor(height, true)),
    roughness: 0.94,
    metalness: 0,
    flatShading: true
  }));
  const sideDark = resources.register(new THREE.MeshStandardMaterial({
    color: materialColor(terrainSideColor(height, false)),
    roughness: 0.96,
    metalness: 0,
    flatShading: true
  }));
  // BoxGeometry groups are right, left, top, bottom, front, back.
  return [sideLight, sideDark, top, sideDark, sideDark, sideLight];
}

function createTopOutlineGeometry(resources: ThreeResourceTracker): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.52, 0, -0.52, 0.52, 0, -0.52,
    0.52, 0, -0.52, 0.52, 0, 0.52,
    0.52, 0, 0.52, -0.52, 0, 0.52,
    -0.52, 0, 0.52, -0.52, 0, -0.52
  ], 3));
  return resources.register(geometry);
}

function createStepGeometry(
  resources: ThreeResourceTracker,
  height: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let level = 1; level < height; level += 1) {
    positions.push(
      -0.51, level, -0.51, 0.51, level, -0.51,
      0.51, level, -0.51, 0.51, level, 0.51,
      0.51, level, 0.51, -0.51, level, 0.51,
      -0.51, level, 0.51, -0.51, level, -0.51
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return resources.register(geometry);
}

function setDirectionQuaternion(object: THREE.Object3D, direction: Vec3Like): void {
  const vector = vectorFrom(direction).normalize();
  object.quaternion.setFromUnitVectors(WORLD_UP, vector);
}

function setCylinderBetween(
  object: THREE.Mesh,
  from: Vec3Like,
  to: Vec3Like,
  radiusScale = 1
): void {
  const start = vectorFrom(from);
  const end = vectorFrom(to);
  const delta = end.clone().sub(start);
  const length = Math.max(0.001, delta.length());
  object.position.copy(start.add(end).multiplyScalar(0.5));
  object.scale.set(radiusScale, length, radiusScale);
  object.quaternion.setFromUnitVectors(WORLD_UP, delta.normalize());
}

function setFlatMarker(
  object: THREE.Object3D,
  position: Vec3Like,
  scale = 1
): void {
  setMeshPosition(object, position);
  object.rotation.set(-Math.PI / 2, 0, 0);
  object.scale.setScalar(scale);
}

/**
 * Three.js board presentation. The class consumes snapshots, projections,
 * previews, and trace events; it never advances or evaluates the game.
 */
export class ThreeBoardView {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: ThreeBoardViewCallbacks;
  private readonly resources = new ThreeResourceTracker();
  private readonly scene = new THREE.Scene();
  private readonly boardRoot = new THREE.Group();
  private readonly terrainGroup = new THREE.Group();
  private readonly terrainDetailGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly edgeGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly rainGroup = new THREE.Group();
  private readonly flowGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pickingMeshes: THREE.Mesh[];
  private readonly terrainMeshes: readonly THREE.Mesh[];
  private readonly terrainOutlines: readonly THREE.LineSegments[];
  private readonly terrainSteps: readonly THREE.LineSegments[];
  private readonly waterMeshes: readonly THREE.Mesh[];
  private readonly riskMeshes: readonly THREE.Mesh[];
  private readonly legalMarkers: readonly THREE.Mesh[];
  private readonly selectedMarkers: readonly THREE.Mesh[];
  private readonly activePlacementMarkers: readonly THREE.Mesh[];
  private readonly resultMarkers: readonly THREE.Mesh[];
  private readonly storageMarkers: readonly THREE.Mesh[];
  private readonly protectedMarkers: readonly THREE.Mesh[];
  private readonly constructionBeforeMarkers: readonly THREE.LineSegments[];
  private readonly constructionAfterMarkers: readonly THREE.Mesh[];
  private readonly forecastMarkers: readonly THREE.Mesh[];
  private readonly rainClouds: readonly THREE.Group[];
  private readonly rainDrops: readonly THREE.Mesh[];
  private readonly rainRipples: readonly THREE.Mesh[];
  private readonly edgeMarkers: readonly EdgeMarkerPair[];
  private readonly flowVisuals: readonly FlowVisualPair[];
  private readonly flowParticles: readonly THREE.Mesh[];
  private readonly flowRipples: readonly THREE.Mesh[];
  private readonly flowWarningMarkers: readonly THREE.Mesh[];
  private readonly labels: ThreeBoardLabelPool;
  private readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private rendererCleanup: THREE.WebGLRenderer | null = null;
  private readonly terrainMaterials: readonly THREE.Material[][];
  private readonly waterMaterial: THREE.Material;
  private readonly terrainOutlineMaterial: THREE.LineBasicMaterial;
  private readonly terrainStepMaterial: THREE.LineBasicMaterial;
  private readonly safeMaterial: THREE.MeshBasicMaterial;
  private readonly dangerMaterial: THREE.MeshBasicMaterial;
  private readonly legalMaterial: THREE.MeshBasicMaterial;
  private readonly selectedMaterial: THREE.MeshBasicMaterial;
  private readonly placementMaterial: THREE.MeshBasicMaterial;
  private readonly resultMaterial: THREE.MeshBasicMaterial;
  private readonly storageMaterial: THREE.MeshBasicMaterial;
  private readonly protectedMaterial: THREE.MeshBasicMaterial;
  private readonly constructionAfterMaterial: THREE.MeshBasicMaterial;
  private readonly pickingMaterial: THREE.MeshBasicMaterial;
  private readonly forecastMaterials: readonly THREE.MeshBasicMaterial[];
  private readonly riskMaterials: RiskMaterialMap;
  private readonly cloudMaterial: THREE.MeshStandardMaterial;
  private readonly rainDropMaterial: THREE.MeshBasicMaterial;
  private readonly flowMaterials: FlowMaterialMap;
  private readonly flowWarningMaterial: THREE.MeshBasicMaterial;
  private readonly terrainGeometry: THREE.BoxGeometry;
  private readonly terrainEdgeGeometry: THREE.EdgesGeometry;
  private readonly waterGeometry: THREE.BoxGeometry;
  private readonly topOutlineGeometry: THREE.BufferGeometry;
  private readonly stepGeometries: readonly THREE.BufferGeometry[];
  private readonly pickGeometry: THREE.PlaneGeometry;
  private readonly ringGeometry: THREE.TorusGeometry;
  private readonly forecastRingGeometry: THREE.TorusGeometry;
  private readonly arrowGeometry: THREE.ConeGeometry;
  private readonly dangerGeometry: THREE.OctahedronGeometry;
  private readonly protectedGeometry: THREE.CylinderGeometry;
  private readonly routeGeometry: THREE.CylinderGeometry;
  private readonly particleGeometry: THREE.SphereGeometry;
  private readonly rippleGeometry: THREE.TorusGeometry;
  private readonly cloudGeometry: THREE.SphereGeometry;
  private readonly rainDropGeometry: THREE.CylinderGeometry;
  private readonly rayPointer = new THREE.Vector2();
  private lastFrame: ThreeBoardFrame | null = null;
  private cameraFit: BoardCameraFit | null = null;
  private widthCss = 1;
  private heightCss = 1;
  private devicePixelRatioValue = 1;
  private rotationValue: BoardRotation = 0;
  private transitionValue: CameraTransition | null = null;
  private contextLostValue = false;
  private destroyedValue = false;

  public constructor(canvas: HTMLCanvasElement, callbacks: ThreeBoardViewCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance'
      });
      this.rendererCleanup = this.renderer;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(1, 1, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      this.scene.background = new THREE.Color('#071521');
      this.scene.add(new THREE.HemisphereLight('#d9f6ff', '#102b3a', 1.7));
      const light = new THREE.DirectionalLight('#ffffff', 1.25);
      light.position.set(-5, 10, 6);
      this.scene.add(light);

      this.boardRoot.name = 'nagashimasu-board';
      this.terrainGroup.name = 'terrain';
      this.terrainDetailGroup.name = 'terrain-details';
      this.waterGroup.name = 'water';
      this.edgeGroup.name = 'edges';
      this.overlayGroup.name = 'overlays';
      this.rainGroup.name = 'rain';
      this.flowGroup.name = 'flow';
      this.markerGroup.name = 'markers';
      this.boardRoot.add(
        this.terrainGroup,
        this.terrainDetailGroup,
        this.waterGroup,
        this.edgeGroup,
        this.overlayGroup,
        this.rainGroup,
        this.flowGroup,
        this.markerGroup
      );
      this.scene.add(this.boardRoot);

      this.terrainGeometry = this.resources.register(new THREE.BoxGeometry(1, 1, 1));
      this.terrainEdgeGeometry = this.resources.register(new THREE.EdgesGeometry(this.terrainGeometry));
      this.waterGeometry = this.resources.register(new THREE.BoxGeometry(0.88, 1, 0.88));
      this.topOutlineGeometry = createTopOutlineGeometry(this.resources);
      this.stepGeometries = Object.freeze(
        Array.from({ length: MAX_TERRAIN_HEIGHT + 1 }, (_, height) =>
          createStepGeometry(this.resources, height)
        )
      );
      this.pickGeometry = this.resources.register(new THREE.PlaneGeometry(1, 1));
      this.ringGeometry = this.resources.register(new THREE.TorusGeometry(0.37, 0.035, 6, 20));
      this.forecastRingGeometry = this.resources.register(new THREE.TorusGeometry(0.44, 0.038, 6, 24));
      this.arrowGeometry = this.resources.register(new THREE.ConeGeometry(0.12, 0.34, 3));
      this.dangerGeometry = this.resources.register(new THREE.OctahedronGeometry(0.16, 0));
      this.protectedGeometry = this.resources.register(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 6));
      this.routeGeometry = this.resources.register(new THREE.CylinderGeometry(0.045, 0.045, 1, 6));
      this.particleGeometry = this.resources.register(new THREE.SphereGeometry(0.075, 8, 6));
      this.rippleGeometry = this.resources.register(new THREE.TorusGeometry(0.25, 0.022, 6, 18));
      this.cloudGeometry = this.resources.register(new THREE.SphereGeometry(0.34, 8, 6));
      this.rainDropGeometry = this.resources.register(new THREE.CylinderGeometry(0.022, 0.01, 0.22, 5));

      this.terrainMaterials = Object.freeze(
        Array.from({ length: MAX_TERRAIN_HEIGHT + 1 }, (_, height) =>
          faceMaterialSet(this.resources, height)
        )
      );
      this.terrainOutlineMaterial = this.resources.register(new THREE.LineBasicMaterial({
        color: '#b5e9ef',
        transparent: true,
        opacity: 0.46
      }));
      this.terrainStepMaterial = this.resources.register(new THREE.LineBasicMaterial({
        color: '#a7e0eb',
        transparent: true,
        opacity: 0.32
      }));
      this.waterMaterial = this.resources.register(new THREE.MeshStandardMaterial({
        color: '#39bee9',
        roughness: 0.16,
        metalness: 0.04,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      depthTest: false
      }));
      this.safeMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#8ee3cf',
        transparent: true,
        opacity: 0.96,
        depthTest: false
      }));
      this.dangerMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#ff6b6b',
        transparent: true,
        opacity: 0.98,
        depthTest: false
      }));
      this.legalMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#31d697',
        transparent: true,
        opacity: 0.92,
        depthTest: false
      }));
      this.selectedMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#fff3b0',
        transparent: true,
        opacity: 1,
        depthTest: false
      }));
      this.placementMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#ffd166',
        transparent: true,
        opacity: 0.8,
        depthTest: false
      }));
      this.resultMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#ff8f70',
        transparent: true,
        opacity: 0.88,
        depthTest: false
      }));
      this.storageMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#55d8ed',
        transparent: true,
        opacity: 0.96,
        depthTest: false
      }));
      this.protectedMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#ffe08a',
        transparent: true,
        opacity: 1,
        depthTest: false
      }));
      this.constructionAfterMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#ffd166',
        transparent: true,
        opacity: 0.28,
        depthTest: false
      }));
      this.pickingMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false
      }));
      this.forecastMaterials = Object.freeze([
        this.resources.register(new THREE.MeshBasicMaterial({
          color: '#c8f1ff',
          transparent: true,
          opacity: 0.92,
          depthTest: false
        })),
        this.resources.register(new THREE.MeshBasicMaterial({
          color: '#b9a7ff',
          transparent: true,
          opacity: 0.92,
          depthTest: false
        }))
      ]);
      this.riskMaterials = Object.freeze({
        caution: this.resources.register(new THREE.MeshBasicMaterial({
          color: '#ffd166', transparent: true, opacity: 0.22, depthTest: false
        })),
        danger: this.resources.register(new THREE.MeshBasicMaterial({
          color: '#ff925c', transparent: true, opacity: 0.3, depthTest: false
        })),
        critical: this.resources.register(new THREE.MeshBasicMaterial({
          color: '#ff5c5c', transparent: true, opacity: 0.38, depthTest: false
        })),
        safe: this.resources.register(new THREE.MeshBasicMaterial({
          color: '#55d8ed', transparent: true, opacity: 0, depthTest: false
        }))
      });
      this.cloudMaterial = this.resources.register(new THREE.MeshStandardMaterial({
        color: '#ccebf5',
        roughness: 0.8,
        metalness: 0,
        transparent: true,
        opacity: 0.9,
        depthTest: false
      }));
      this.rainDropMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#d8f7ff',
        transparent: true,
        opacity: 0.92,
        depthTest: false
      }));
      this.flowMaterials = Object.freeze({
        cell: this.resources.register(new THREE.MeshBasicMaterial({
          color: '#b9e7ff', transparent: true, opacity: 0.78, depthTest: false
        })),
        'safe-edge': this.resources.register(new THREE.MeshBasicMaterial({
          color: '#8ee3cf', transparent: true, opacity: 0.84, depthTest: false
        })),
        'danger-edge': this.resources.register(new THREE.MeshBasicMaterial({
          color: '#ff6b6b', transparent: true, opacity: 0.88, depthTest: false
        }))
      });
      this.flowWarningMaterial = this.resources.register(new THREE.MeshBasicMaterial({
        color: '#ff6b6b', transparent: true, opacity: 0.98, depthTest: false
      }));

      const terrainMeshes: THREE.Mesh[] = [];
      const terrainOutlines: THREE.LineSegments[] = [];
      const terrainSteps: THREE.LineSegments[] = [];
      const waterMeshes: THREE.Mesh[] = [];
      const riskMeshes: THREE.Mesh[] = [];
      const legalMarkers: THREE.Mesh[] = [];
      const selectedMarkers: THREE.Mesh[] = [];
      const activePlacementMarkers: THREE.Mesh[] = [];
      const resultMarkers: THREE.Mesh[] = [];
      const storageMarkers: THREE.Mesh[] = [];
      const protectedMarkers: THREE.Mesh[] = [];
      const constructionBeforeMarkers: THREE.LineSegments[] = [];
      const constructionAfterMarkers: THREE.Mesh[] = [];
      const forecastMarkers: THREE.Mesh[] = [];
      const pickingMeshes: THREE.Mesh[] = [];

      for (let index = 0; index < CELL_COUNT; index += 1) {
        const terrain = new THREE.Mesh(this.terrainGeometry, this.terrainMaterials[0]!);
        terrain.userData['cellIndex'] = index;
        terrainMeshes.push(terrain);
        this.terrainGroup.add(terrain);

        const outline = new THREE.LineSegments(this.terrainEdgeGeometry, this.terrainOutlineMaterial);
        terrainOutlines.push(outline);
        this.terrainDetailGroup.add(outline);

        const steps = new THREE.LineSegments(this.stepGeometries[0]!, this.terrainStepMaterial);
        terrainSteps.push(steps);
        this.terrainDetailGroup.add(steps);

        const water = new THREE.Mesh(this.waterGeometry, this.waterMaterial);
        water.renderOrder = 10;
        waterMeshes.push(water);
        this.waterGroup.add(water);

        const picking = new THREE.Mesh(this.pickGeometry, this.pickingMaterial);
        picking.rotation.x = -Math.PI / 2;
        picking.userData['cellIndex'] = index;
        pickingMeshes.push(picking);
        this.overlayGroup.add(picking);

        const risk = new THREE.Mesh(this.pickGeometry, this.riskMaterials.safe);
        risk.renderOrder = 20;
        risk.rotation.x = -Math.PI / 2;
        riskMeshes.push(risk);
        this.overlayGroup.add(risk);

        const legal = new THREE.Mesh(this.ringGeometry, this.legalMaterial);
        const selected = new THREE.Mesh(this.ringGeometry, this.selectedMaterial);
        const activePlacement = new THREE.Mesh(this.ringGeometry, this.placementMaterial);
        const result = new THREE.Mesh(this.ringGeometry, this.resultMaterial);
        for (const marker of [legal, selected, activePlacement, result]) {
          marker.rotation.x = Math.PI / 2;
          marker.renderOrder = 40;
          marker.visible = false;
          this.markerGroup.add(marker);
        }
        legalMarkers.push(legal);
        selectedMarkers.push(selected);
        activePlacementMarkers.push(activePlacement);
        resultMarkers.push(result);

        const storage = new THREE.Mesh(this.ringGeometry, this.storageMaterial);
        storage.rotation.x = Math.PI / 2;
        storage.renderOrder = 41;
        storage.visible = false;
        storageMarkers.push(storage);
        this.markerGroup.add(storage);

        const protectedMarker = new THREE.Mesh(this.protectedGeometry, this.protectedMaterial);
        protectedMarker.renderOrder = 42;
        protectedMarker.visible = false;
        protectedMarkers.push(protectedMarker);
        this.markerGroup.add(protectedMarker);

        const constructionBefore = new THREE.LineSegments(this.topOutlineGeometry, this.selectedMaterial);
        constructionBefore.renderOrder = 43;
        constructionBefore.visible = false;
        constructionBeforeMarkers.push(constructionBefore);
        this.overlayGroup.add(constructionBefore);

        const constructionAfter = new THREE.Mesh(this.ringGeometry, this.constructionAfterMaterial);
        constructionAfter.rotation.x = Math.PI / 2;
        constructionAfter.renderOrder = 43;
        constructionAfter.visible = false;
        constructionAfterMarkers.push(constructionAfter);
        this.overlayGroup.add(constructionAfter);
      }

      const edgeMarkers: EdgeMarkerPair[] = [];
      const edgeArrowGeometry = this.arrowGeometry;
      for (let index = 0; index < CELL_COUNT; index += 1) {
        for (const direction of LOGICAL_DIRECTIONS) {
          const safe = new THREE.Mesh(edgeArrowGeometry, this.safeMaterial);
          const danger = new THREE.Mesh(this.dangerGeometry, this.dangerMaterial);
          safe.renderOrder = 45;
          danger.renderOrder = 45;
          safe.visible = false;
          danger.visible = false;
          this.edgeGroup.add(safe, danger);
          edgeMarkers.push(Object.freeze({ safe, danger, index, direction }));
        }
      }

      const forecast = Array.from({ length: MAX_FORECAST_CELLS }, () => {
        const marker = new THREE.Mesh(this.forecastRingGeometry, this.forecastMaterials[0]);
        marker.rotation.x = Math.PI / 2;
        marker.renderOrder = 46;
        marker.visible = false;
        this.overlayGroup.add(marker);
        return marker;
      });

      const rainClouds: THREE.Group[] = [];
      for (let index = 0; index < MAX_RAIN_SOURCES; index += 1) {
        const cloud = new THREE.Group();
        cloud.renderOrder = 50;
        cloud.visible = false;
        const left = new THREE.Mesh(this.cloudGeometry, this.cloudMaterial);
        const middle = new THREE.Mesh(this.cloudGeometry, this.cloudMaterial);
        const right = new THREE.Mesh(this.cloudGeometry, this.cloudMaterial);
        left.position.set(-0.28, 0, 0);
        left.scale.set(0.84, 0.68, 0.72);
        middle.position.set(0, 0.1, 0);
        middle.scale.set(1.05, 0.86, 0.82);
        right.position.set(0.29, 0, 0);
        right.scale.set(0.78, 0.64, 0.68);
        cloud.add(left, middle, right);
        rainClouds.push(cloud);
        this.rainGroup.add(cloud);
      }

      const rainDrops = Array.from({ length: MAX_RAIN_DROPS }, () => {
        const drop = new THREE.Mesh(this.rainDropGeometry, this.rainDropMaterial);
        drop.renderOrder = 51;
        drop.visible = false;
        this.rainGroup.add(drop);
        return drop;
      });
      const rainRipples = Array.from({ length: MAX_RAIN_SOURCES }, () => {
        const ripple = new THREE.Mesh(this.rippleGeometry, this.rainDropMaterial);
        ripple.rotation.x = Math.PI / 2;
        ripple.renderOrder = 52;
        ripple.visible = false;
        this.rainGroup.add(ripple);
        return ripple;
      });

      const flowVisuals = Array.from({ length: MAX_FLOW_TRANSFERS }, (_, index) => {
        const route = new THREE.Mesh(this.routeGeometry, this.flowMaterials.cell);
        const arrow = new THREE.Mesh(this.arrowGeometry, this.flowMaterials.cell);
        route.renderOrder = 60;
        arrow.renderOrder = 61;
        route.visible = false;
        arrow.visible = false;
        this.flowGroup.add(route, arrow);
        return Object.freeze({ route, arrow, index });
      });
      const flowParticles = Array.from({ length: MAX_FLOW_PARTICLES }, () => {
        const particle = new THREE.Mesh(this.particleGeometry, this.flowMaterials.cell);
        particle.renderOrder = 62;
        particle.visible = false;
        this.flowGroup.add(particle);
        return particle;
      });
      const flowRipples = Array.from({ length: MAX_FLOW_TRANSFERS }, () => {
        const ripple = new THREE.Mesh(this.rippleGeometry, this.flowMaterials.cell);
        ripple.rotation.x = Math.PI / 2;
        ripple.renderOrder = 63;
        ripple.visible = false;
        this.flowGroup.add(ripple);
        return ripple;
      });
      const flowWarningMarkers = Array.from({ length: MAX_FLOW_TRANSFERS }, () => {
        const marker = new THREE.Mesh(this.dangerGeometry, this.flowWarningMaterial);
        marker.renderOrder = 64;
        marker.visible = false;
        this.flowGroup.add(marker);
        return marker;
      });

      this.terrainMeshes = Object.freeze(terrainMeshes);
      this.terrainOutlines = Object.freeze(terrainOutlines);
      this.terrainSteps = Object.freeze(terrainSteps);
      this.waterMeshes = Object.freeze(waterMeshes);
      this.riskMeshes = Object.freeze(riskMeshes);
      this.legalMarkers = Object.freeze(legalMarkers);
      this.selectedMarkers = Object.freeze(selectedMarkers);
      this.activePlacementMarkers = Object.freeze(activePlacementMarkers);
      this.resultMarkers = Object.freeze(resultMarkers);
      this.storageMarkers = Object.freeze(storageMarkers);
      this.protectedMarkers = Object.freeze(protectedMarkers);
      this.constructionBeforeMarkers = Object.freeze(constructionBeforeMarkers);
      this.constructionAfterMarkers = Object.freeze(constructionAfterMarkers);
      this.forecastMarkers = Object.freeze(forecast);
      this.rainClouds = Object.freeze(rainClouds);
      this.rainDrops = Object.freeze(rainDrops);
      this.rainRipples = Object.freeze(rainRipples);
      this.edgeMarkers = Object.freeze(edgeMarkers);
      this.flowVisuals = Object.freeze(flowVisuals);
      this.flowParticles = Object.freeze(flowParticles);
      this.flowRipples = Object.freeze(flowRipples);
      this.flowWarningMarkers = Object.freeze(flowWarningMarkers);
      this.pickingMeshes = pickingMeshes;
      this.labels = new ThreeBoardLabelPool(this.scene, this.resources, LABEL_POOL_SIZE);

      this.bindContextEvents();
      this.resize(1, 1, 1);
    } catch (error: unknown) {
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false);
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored, false);
      this.resources.dispose();
      this.rendererCleanup?.dispose();
      this.rendererCleanup = null;
      callbacks.onInitializationError?.(error);
      throw error;
    }
  }

  public get isCameraTransitioning(): boolean {
    return this.transitionValue !== null;
  }

  public get contextLost(): boolean {
    return this.contextLostValue;
  }

  public get resourceStats(): {
    readonly drawCalls: number;
    readonly geometries: number;
    readonly textures: number;
  } {
    return Object.freeze({
      drawCalls: this.renderer.info.render.calls,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures
    });
  }

  public resize(widthCss: number, heightCss: number, devicePixelRatio = 1): void {
    if (this.destroyedValue) return;
    this.widthCss = Math.max(1, Number.isFinite(widthCss) ? widthCss : 1);
    this.heightCss = Math.max(1, Number.isFinite(heightCss) ? heightCss : 1);
    this.devicePixelRatioValue = Math.min(2, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
    this.cameraFit = computeBoardCameraFit(this.widthCss, this.heightCss, {
      rotation: this.rotationValue
    });
    this.renderer.setPixelRatio(this.devicePixelRatioValue);
    this.renderer.setSize(this.widthCss, this.heightCss, false);
    this.applyCameraFit(this.cameraFit);
    if (this.lastFrame !== null) this.applyFrame(this.lastFrame);
    this.renderScene();
  }

  public setRotation(
    rotation: number,
    options: BoardRotationOptions = {}
  ): void {
    if (this.destroyedValue) return;
    const nextRotation = normalizeBoardRotation(rotation);
    if (this.transitionValue !== null) this.cancelCameraTransition();
    if (nextRotation === this.rotationValue || this.cameraFit === null) {
      this.rotationValue = nextRotation;
      if (this.cameraFit !== null) this.applyCameraFit(this.cameraFit);
      this.renderScene();
      return;
    }
    const from = this.cameraFit;
    const to = computeBoardCameraFit(this.widthCss, this.heightCss, {
      rotation: nextRotation
    });
    const durationMs = Math.max(0, options.durationMs ?? CAMERA_ROTATION_DURATION_MS);
    if (options.reducedMotion === true || durationMs === 0) {
      this.rotationValue = nextRotation;
      this.cameraFit = to;
      this.applyCameraFit(to);
      if (this.lastFrame !== null) this.applyFrame(this.lastFrame);
      this.renderScene();
      return;
    }

    const start = performance.now();
    const transition: CameraTransition = {
      from,
      to,
      start,
      durationMs,
      frameId: 0
    };
    this.rotationValue = nextRotation;
    this.transitionValue = transition;
    const frameId = requestAnimationFrame((now) => this.tickCameraTransition(now));
    this.transitionValue = Object.freeze({ ...transition, frameId });
  }

  public render(snapshot: BoardSnapshot, options: BoardRenderOptions = {}): void {
    if (this.destroyedValue) return;
    this.lastFrame = buildThreeBoardFrame(snapshot, options);
    if (this.contextLostValue) return;
    this.applyFrame(this.lastFrame);
    this.renderScene();
  }

  /** Uses legal marker centers first, then a Three.js Raycaster for normal cells. */
  public pickCell(
    clientX: number,
    clientY: number,
    preferredCellIndices: readonly number[] = []
  ): number | null {
    if (
      this.destroyedValue ||
      this.contextLostValue ||
      this.transitionValue !== null ||
      this.cameraFit === null ||
      this.lastFrame === null
    ) return null;
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const localPoint = Object.freeze({
      x: clientX - bounds.left,
      y: clientY - bounds.top
    });
    if (
      localPoint.x < 0 ||
      localPoint.y < 0 ||
      localPoint.x > bounds.width ||
      localPoint.y > bounds.height
    ) return null;
    const projectedCenters: ProjectedCellCenter[] = [];
    const seen = new Set<number>();
    for (const index of preferredCellIndices) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= CELL_COUNT || seen.has(index)) continue;
      seen.add(index);
      const center = projectCellCenterToScreen(
        this.cameraFit,
        index,
        this.lastFrame.terrain[index] ?? 0
      );
      projectedCenters.push(Object.freeze({ index, x: center.x, y: center.y }));
    }
    const preferred = pickNearestLegalCell(localPoint, projectedCenters);
    if (preferred !== null) return preferred;

    const normalized = normalizedDeviceCoordinates(localPoint, width, height);
    if (normalized === null) return null;
    this.rayPointer.set(normalized.x, normalized.y);
    this.raycaster.setFromCamera(this.rayPointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.pickingMeshes, false);
    for (const intersection of intersections) {
      const index = intersection.object.userData['cellIndex'];
      if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < CELL_COUNT) {
        return index;
      }
    }
    return null;
  }

  public destroy(): void {
    if (this.destroyedValue) return;
    this.destroyedValue = true;
    this.cancelCameraTransition();
    this.unbindContextEvents();
    this.labels.dispose();
    this.scene.clear();
    this.resources.dispose();
    this.renderer.dispose();
    this.rendererCleanup = null;
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyedValue) return;
    this.contextLostValue = true;
    this.cancelCameraTransition();
    this.callbacks.onContextLost?.();
  };

  private readonly onContextRestored = (): void => {
    if (this.destroyedValue) return;
    this.contextLostValue = false;
    this.rebuildSceneGraph();
    if (this.lastFrame !== null) this.applyFrame(this.lastFrame);
    this.renderScene();
    this.callbacks.onContextRestored?.();
  };

  private bindContextEvents(): void {
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  private unbindContextEvents(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  private cancelCameraTransition(): void {
    const transition = this.transitionValue;
    if (transition !== null) cancelAnimationFrame(transition.frameId);
    this.transitionValue = null;
  }

  private readonly tickCameraTransition = (now: number): void => {
    const transition = this.transitionValue;
    if (transition === null || this.destroyedValue) return;
    const progress = Math.min(1, Math.max(0, (now - transition.start) / transition.durationMs));
    const eased = progress * progress * (3 - 2 * progress);
    this.applyInterpolatedCamera(transition.from, transition.to, eased);
    if (this.lastFrame !== null) this.applyFrame(this.lastFrame);
    this.renderScene();
    this.callbacks.onCameraFrame?.();
    if (progress >= 1) {
      this.transitionValue = null;
      this.cameraFit = transition.to;
      this.applyCameraFit(transition.to);
      if (this.lastFrame !== null) this.applyFrame(this.lastFrame);
      this.renderScene();
      this.callbacks.onCameraFrame?.();
      return;
    }
    const frameId = requestAnimationFrame(this.tickCameraTransition);
    this.transitionValue = Object.freeze({ ...transition, frameId });
  };

  private applyInterpolatedCamera(
    from: BoardCameraFit,
    to: BoardCameraFit,
    ratio: number
  ): void {
    const position = interpolateWorldPoint(from.position, to.position, ratio);
    const target = interpolateWorldPoint(from.target, to.target, ratio);
    this.camera.position.set(position.x, position.y, position.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target.x, target.y, target.z);
    const halfHeight = from.halfHeight + (to.halfHeight - from.halfHeight) * ratio;
    const aspect = from.aspect + (to.aspect - from.aspect) * ratio;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  private applyCameraFit(fit: BoardCameraFit): void {
    this.camera.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.camera.up.set(0, 1, 0);
    this.camera.left = -fit.halfHeight * fit.aspect;
    this.camera.right = fit.halfHeight * fit.aspect;
    this.camera.top = fit.halfHeight;
    this.camera.bottom = -fit.halfHeight;
    this.camera.lookAt(fit.target.x, fit.target.y, fit.target.z);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  private rebuildSceneGraph(): void {
    this.boardRoot.clear();
    this.boardRoot.add(
      this.terrainGroup,
      this.terrainDetailGroup,
      this.waterGroup,
      this.edgeGroup,
      this.overlayGroup,
      this.rainGroup,
      this.flowGroup,
      this.markerGroup
    );
    this.scene.add(this.boardRoot);
  }

  private applyFrame(frame: ThreeBoardFrame): void {
    this.labels.beginFrame();
    const labelCells = frame.labelCells === null
      ? null
      : new Set(frame.labelCells);
    const storageCells = new Set(frame.storageCells);
    const anchorCells = new Set(frame.constructionAnchorCells);
    const activePlacementCells = new Set(frame.activePlacementCells);
    const resultCells = new Set(frame.resultHighlightCells);
    const selectedCell = frame.selectedCell;
    const pulse = playbackPulseForMotion(frame.playbackProgress, frame.reducedMotion);

    for (let index = 0; index < CELL_COUNT; index += 1) {
      const terrain = frame.terrain[index] ?? 0;
      const height = terrainBlockHeight(terrain);
      const geometry = cellWorldGeometry(index, terrain);
      const terrainMesh = this.terrainMeshes[index]!;
      terrainMesh.material = this.terrainMaterials[Math.max(0, Math.min(MAX_TERRAIN_HEIGHT, Math.trunc(terrain)))] ?? this.terrainMaterials[0]!;
      terrainMesh.scale.set(1, height, 1);
      terrainMesh.position.set(geometry.center.x, height / 2, geometry.center.z);
      terrainMesh.visible = true;

      const outline = this.terrainOutlines[index]!;
      outline.scale.set(1, height, 1);
      outline.position.set(geometry.center.x, height / 2, geometry.center.z);
      outline.visible = true;
      const steps = this.terrainSteps[index]!;
      steps.geometry = this.stepGeometries[Math.max(0, Math.min(MAX_TERRAIN_HEIGHT, Math.trunc(terrain)))] ?? this.stepGeometries[0]!;
      steps.position.set(geometry.center.x, 0, geometry.center.z);
      steps.visible = terrain >= 2;

      const topY = geometry.topY;
      const picking = this.pickingMeshes[index]!;
      picking.position.set(geometry.center.x, topY + 0.018, geometry.center.z);
      picking.visible = true;

      const waterAmount = frame.water[index] ?? 0;
      const water = this.waterMeshes[index]!;
      if (waterAmount > 0) {
        const visual = waterVisualLevel(waterAmount);
        const waterHeight = Math.max(0.045, visual.depth);
        water.visible = true;
        water.scale.set(1, waterHeight, 1);
        water.position.set(
          geometry.center.x,
          topY + 0.035 + visual.lift + waterHeight / 2,
          geometry.center.z
        );
        this.labels.use(String(waterAmount), {
          x: geometry.center.x,
          y: topY + 0.5 + visual.lift,
          z: geometry.center.z
        }, 0.34, { color: '#06263a', background: 'rgba(185, 231, 255, 0.9)' });
      } else {
        water.visible = false;
      }

      const legal = this.legalMarkers[index]!;
      legal.visible = anchorCells.has(index);
      setFlatMarker(legal, { x: geometry.center.x, y: topY + 0.13, z: geometry.center.z }, 1);

      const selected = this.selectedMarkers[index]!;
      selected.visible = selectedCell === index;
      selected.scale.setScalar(1.1 + pulse * 0.08);
      setFlatMarker(selected, { x: geometry.center.x, y: topY + 0.16, z: geometry.center.z }, 1);

      const activePlacement = this.activePlacementMarkers[index]!;
      activePlacement.visible = activePlacementCells.has(index);
      activePlacement.scale.setScalar(1.05 + pulse * 0.08);
      setFlatMarker(activePlacement, { x: geometry.center.x, y: topY + 0.18, z: geometry.center.z }, 1);

      const result = this.resultMarkers[index]!;
      result.visible = resultCells.has(index);
      result.scale.setScalar(1.08 + pulse * 0.1);
      setFlatMarker(result, { x: geometry.center.x, y: topY + 0.2, z: geometry.center.z }, 1);
      if (result.visible) {
        this.labels.use('漏れ', {
          x: geometry.center.x,
          y: topY + 0.48,
          z: geometry.center.z
        }, 0.45, { color: '#fff1ec', background: 'rgba(126, 43, 43, 0.9)' });
      }

      const storage = this.storageMarkers[index]!;
      storage.visible = storageCells.has(index);
      storage.scale.setScalar(waterAmount > 0 ? 1.08 : 0.95);
      setFlatMarker(storage, { x: geometry.center.x, y: topY + 0.17, z: geometry.center.z }, 1);
      if (storage.visible) {
        this.labels.use(waterAmount > 0 ? '池' : '池へ', {
          x: geometry.center.x,
          y: topY + 0.42,
          z: geometry.center.z
        }, 0.45, { color: '#d8f7ff', background: 'rgba(8, 68, 121, 0.88)' });
      }

      const protectedMarker = this.protectedMarkers[index]!;
      const protectedCell = ((frame.cellFlags[index] ?? 0) & CellFlag.Protected) !== 0;
      protectedMarker.visible = protectedCell;
      setMeshPosition(protectedMarker, {
        x: geometry.center.x,
        y: topY + 0.22,
        z: geometry.center.z
      });
      if (protectedCell) {
        this.labels.use('守', {
          x: geometry.center.x,
          y: topY + 0.58,
          z: geometry.center.z
        }, 0.4, { color: '#5e4314', background: 'rgba(255, 224, 138, 0.96)' });
      }

      const risk = frame.riskCells[index];
      const riskMesh = this.riskMeshes[index]!;
      if (risk === undefined || risk.level === 'safe') {
        riskMesh.visible = false;
      } else {
        riskMesh.visible = true;
        riskMesh.material = this.riskMaterials[risk.level] ?? this.riskMaterials.safe;
        riskMesh.position.set(geometry.center.x, topY + 0.075, geometry.center.z);
        riskMesh.scale.set(0.9, 0.9, 0.9);
        const symbol = warningLabel(risk.level);
        if (symbol.length > 0) {
          this.labels.use(symbol, {
            x: geometry.center.x,
            y: topY + 0.68,
            z: geometry.center.z
          }, 0.34, { color: '#24170b', background: `${riskColor(risk.level)}ee` });
        }
      }

      this.updateEdgeMarkers(index, terrain, frame);

      const beforeMarker = this.constructionBeforeMarkers[index]!;
      const afterMarker = this.constructionAfterMarkers[index]!;
      beforeMarker.visible = false;
      afterMarker.visible = false;
      const construction = frame.constructionVisual;
      if (
        construction !== null &&
        construction.placementCells.includes(index) &&
        (frame.phase === 'construction' || frame.phase === 'undo' || frame.preview !== null)
      ) {
        const beforeTerrain = construction.terrainBefore[index] ?? terrain;
        const afterTerrain = construction.terrainAfter[index] ?? terrain;
        const beforeGeometry = cellWorldGeometry(index, beforeTerrain);
        const afterGeometry = cellWorldGeometry(index, afterTerrain);
        beforeMarker.visible = true;
        beforeMarker.position.set(beforeGeometry.center.x, beforeGeometry.topY + 0.08, beforeGeometry.center.z);
        afterMarker.visible = true;
        afterMarker.scale.setScalar(1.12 + pulse * 0.08);
        setFlatMarker(afterMarker, { x: afterGeometry.center.x, y: afterGeometry.topY + 0.2, z: afterGeometry.center.z }, 1);
        this.labels.use(construction.delta > 0 ? '▲ 上げる' : '▼ 下げる', {
          x: afterGeometry.center.x,
          y: afterGeometry.topY + 0.62,
          z: afterGeometry.center.z
        }, 0.52, { color: '#fff6d6', background: 'rgba(101, 74, 23, 0.92)' });
      }

      if (labelCells === null || labelCells.has(index)) {
        this.labels.use(cellCoordinate(index), {
          x: geometry.center.x,
          y: topY + 0.16,
          z: geometry.center.z
        }, 0.25, { color: '#e2f3ff', background: 'rgba(7, 21, 33, 0.62)' });
      }
    }

    this.updateForecast(frame);
    this.updateRain(frame);
    this.updateFlow(frame);
    if (frame.background !== '') this.scene.background = new THREE.Color(frame.background);
  }

  private updateEdgeMarkers(index: number, terrain: number, frame: ThreeBoardFrame): void {
    const geometry = cellWorldGeometry(index, terrain);
    const safeMask = frame.safeEdgeMask[index] ?? 0;
    const dangerMask = frame.dangerEdgeMask[index] ?? 0;
    for (const entry of this.edgeMarkers) {
      if (entry.index !== index) continue;
      const direction = directionVector(entry.direction);
      const edgePosition = {
        x: geometry.center.x + direction.x * 0.48,
        y: geometry.topY + 0.2,
        z: geometry.center.z + direction.z * 0.48
      };
      setMeshPosition(entry.safe, edgePosition);
      setDirectionQuaternion(entry.safe, direction);
      entry.safe.visible = (safeMask & entry.direction) !== 0;
      if (entry.safe.visible) {
        this.labels.use('安全な出口', {
          x: edgePosition.x,
          y: edgePosition.y + 0.3,
          z: edgePosition.z
        }, 0.38, { color: '#06263a', background: 'rgba(142, 227, 207, 0.94)' });
      }
      setMeshPosition(entry.danger, edgePosition);
      entry.danger.visible = (dangerMask & entry.direction) !== 0;
      entry.danger.scale.setScalar(1.1);
      if (entry.danger.visible) {
        this.labels.use('!', {
          x: edgePosition.x,
          y: edgePosition.y + 0.22,
          z: edgePosition.z
        }, 0.24, { color: '#fff1ec', background: 'rgba(126, 43, 43, 0.96)' });
      }
    }
  }

  private updateForecast(frame: ThreeBoardFrame): void {
    for (const marker of this.forecastMarkers) marker.visible = false;
    const cells = frame.forecastCells.slice(0, MAX_FORECAST_CELLS);
    for (const [index, forecast] of cells.entries()) {
      const marker = this.forecastMarkers[index];
      if (marker === undefined) break;
      const terrain = frame.terrain[forecast.index] ?? 0;
      const geometry = cellWorldGeometry(forecast.index, terrain);
      marker.material = this.forecastMaterials[forecast.eventIndex % 2] ?? this.forecastMaterials[0]!;
      marker.visible = true;
      marker.position.set(geometry.center.x, geometry.topY + 0.28 + forecast.eventIndex * 0.08, geometry.center.z);
      marker.scale.setScalar(1 + forecast.eventIndex * 0.16);
      this.labels.use(String(forecast.amount), {
        x: geometry.center.x,
        y: geometry.topY + 0.92 + forecast.eventIndex * 0.1,
        z: geometry.center.z
      }, 0.3, { color: forecast.eventIndex === 0 ? '#06263a' : '#f1ecff', background: forecast.eventIndex === 0 ? 'rgba(200, 241, 255, 0.9)' : 'rgba(91, 72, 151, 0.94)' });
      this.labels.use(forecast.eventIndex === 0 ? '次' : 'その次', {
        x: geometry.center.x,
        y: geometry.topY + 0.62 + forecast.eventIndex * 0.1,
        z: geometry.center.z
      }, forecast.eventIndex === 0 ? 0.28 : 0.46, { color: '#06263a', background: forecast.eventIndex === 0 ? 'rgba(200, 241, 255, 0.92)' : 'rgba(185, 167, 255, 0.94)' });
    }
  }

  private updateRain(frame: ThreeBoardFrame): void {
    for (const cloud of this.rainClouds) cloud.visible = false;
    for (const drop of this.rainDrops) drop.visible = false;
    for (const ripple of this.rainRipples) ripple.visible = false;
    const progress = frame.reducedMotion ? 1 : clampPlaybackProgress(frame.playbackProgress);
    const rainCells = frame.rainCells.slice(0, MAX_RAIN_SOURCES);
    let dropIndex = 0;
    for (const [sourceIndex, rain] of rainCells.entries()) {
      const cloud = this.rainClouds[sourceIndex];
      const ripple = this.rainRipples[sourceIndex];
      if (cloud === undefined || ripple === undefined) break;
      const geometry = cellWorldGeometry(rain.index, frame.terrain[rain.index] ?? 0);
      const cloudY = geometry.topY + 3.1;
      cloud.visible = true;
      cloud.position.set(geometry.center.x, cloudY, geometry.center.z);
      this.labels.use(`+${rain.amount}`, {
        x: geometry.center.x,
        y: cloudY + 0.56,
        z: geometry.center.z
      }, 0.42, { color: '#e9fbff', background: 'rgba(9, 50, 71, 0.88)' });
      for (let index = 0; index < RAIN_DROPS_PER_SOURCE; index += 1) {
        const drop = this.rainDrops[dropIndex];
        dropIndex += 1;
        if (drop === undefined) break;
        const spreadX = (index - (RAIN_DROPS_PER_SOURCE - 1) / 2) * 0.14;
        const spreadZ = (index % 2 === 0 ? -0.06 : 0.06);
        const start = { x: geometry.center.x + spreadX, y: cloudY - 0.36, z: geometry.center.z + spreadZ };
        const end = { x: geometry.center.x + spreadX, y: geometry.topY + 0.16, z: geometry.center.z + spreadZ };
        const position = interpolateWorldPoint(start, end, Math.min(1, progress + (index % 3) * 0.08));
        setMeshPosition(drop, position);
        drop.visible = true;
      }
      setFlatMarker(ripple, {
        x: geometry.center.x,
        y: geometry.topY + 0.2,
        z: geometry.center.z
      }, 0.68 + progress * 0.42);
      ripple.visible = true;
    }
  }

  private updateFlow(frame: ThreeBoardFrame): void {
    for (const visual of this.flowVisuals) {
      visual.route.visible = false;
      visual.arrow.visible = false;
    }
    for (const particle of this.flowParticles) particle.visible = false;
    for (const ripple of this.flowRipples) ripple.visible = false;
    for (const warning of this.flowWarningMarkers) warning.visible = false;

    const activeFlow = frame.activeFlow;
    const flow = activeFlow ?? frame.previewFinalFlow;
    if (flow === null) return;
    const isActive = activeFlow !== null;
    const progress = isActive
      ? (frame.reducedMotion ? 0.5 : clampPlaybackProgress(frame.playbackProgress))
      : 1;
    let particleIndex = 0;
    for (const [transferIndex, transfer] of flow.transfers.entries()) {
      const visual = this.flowVisuals[transferIndex];
      const ripple = this.flowRipples[transferIndex];
      const warning = this.flowWarningMarkers[transferIndex];
      if (visual === undefined || ripple === undefined || warning === undefined) break;
      const points = waterTransferWorldPoints(
        this.cameraFit ?? computeBoardCameraFit(this.widthCss, this.heightCss, { rotation: this.rotationValue }),
        transfer,
        frame.terrain
      );
      const color = flowColor(transfer);
      const material = this.flowMaterials[transfer.kind] ?? this.flowMaterials.cell;
      visual.route.material = material;
      visual.arrow.material = material;
      setCylinderBetween(visual.route, points.from, points.to, transfer.kind === 'cell' ? 1 : 1.25);
      visual.route.visible = true;
      const direction = vectorFrom(points.to).sub(vectorFrom(points.from)).normalize();
      const arrowPosition = vectorFrom(points.to).sub(direction.clone().multiplyScalar(0.18));
      visual.arrow.position.copy(arrowPosition);
      setDirectionQuaternion(visual.arrow, { x: direction.x, y: direction.y, z: direction.z });
      visual.arrow.visible = true;

      const destination = interpolateWorldPoint(points.from, points.to, isActive ? progress : 1);
      setFlatMarker(ripple, destination, 0.65 + progress * 0.5);
      ripple.material = material;
      ripple.visible = true;
      this.labels.use(String(transfer.amount), {
        x: destination.x,
        y: destination.y + 0.34,
        z: destination.z
      }, 0.32, { color: transfer.kind === 'danger-edge' ? '#fff1ec' : '#06263a', background: `${color}ee` });
      if (transfer.kind === 'danger-edge') {
        setMeshPosition(warning, points.to);
        warning.visible = true;
        this.labels.use('!', {
          x: points.to.x,
          y: points.to.y + 0.38,
          z: points.to.z
        }, 0.28, { color: '#fff1ec', background: 'rgba(126, 43, 43, 0.96)' });
      }

      if (isActive) {
        for (let particleOffset = 0; particleOffset < FLOW_PARTICLE_COUNT; particleOffset += 1) {
          const particle = this.flowParticles[particleIndex];
          particleIndex += 1;
          if (particle === undefined) break;
          const particleProgress = flowParticleProgress(progress, particleOffset, FLOW_PARTICLE_COUNT);
          const particlePosition = interpolateWorldPoint(points.from, points.to, particleProgress);
          setMeshPosition(particle, {
            x: particlePosition.x,
            y: particlePosition.y + 0.16,
            z: particlePosition.z
          });
          particle.material = material;
          particle.visible = true;
        }
      }
    }
  }

  private renderScene(): void {
    if (this.destroyedValue || this.contextLostValue) return;
    try {
      this.renderer.render(this.scene, this.camera);
      this.canvas.dataset['rendererDrawCalls'] = String(this.renderer.info.render.calls);
      this.canvas.dataset['rendererGeometries'] = String(this.renderer.info.memory.geometries);
      this.canvas.dataset['rendererTextures'] = String(this.renderer.info.memory.textures);
    } catch (error: unknown) {
      this.callbacks.onInitializationError?.(error);
    }
  }
}
