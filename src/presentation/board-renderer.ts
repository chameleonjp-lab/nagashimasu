import { CellFlag, Direction, CELL_COUNT } from '../domain/constants';
import type {
  BoardSnapshot,
  FlowStepResult,
  RainEvent,
  WaterTransfer
} from '../domain/types';
import type { StageTracePhase, StageTurnPreview } from '../domain/stage-session';
import type { ForecastCellView, StageCellRiskView } from './stage-projection';
import {
  getCellGeometry,
  insetDiamond,
  projectCell,
  sortCellIndicesForDrawing
} from './isometric';
import type { IsometricCellGeometry, IsometricLayout, IsometricPoint } from './isometric';
import { clampPlaybackProgress, playbackPulseForMotion } from './playback-visuals';
import { flowParticleProgress, waterVisualLevel } from './board-visuals';

export interface ConstructionVisual {
  readonly placementCells: readonly number[];
  readonly terrainBefore: readonly number[];
  readonly terrainAfter: readonly number[];
  readonly delta: number;
}

export interface BoardRenderOptions {
  readonly selectedCell?: number | null;
  readonly preview?: StageTurnPreview | null;
  readonly constructionAnchorCells?: readonly number[];
  readonly activePlacementCells?: readonly number[];
  readonly flowResult?: FlowStepResult | null;
  readonly rainCells?: readonly RainEvent[];
  readonly forecastCells?: readonly ForecastCellView[];
  readonly riskCells?: readonly StageCellRiskView[];
  readonly playbackProgress?: number | null;
  readonly phase?: StageTracePhase | null;
  readonly constructionVisual?: ConstructionVisual | null;
  readonly resultPhase?: 'cleared' | 'failed' | null;
  readonly resultText?: string;
  readonly objectiveLabel?: string;
  readonly objectiveProgress?: { readonly value: number; readonly target: number } | null;
  readonly reducedMotion?: boolean;
  readonly background?: string;
}

function polygonPath(
  context: CanvasRenderingContext2D,
  polygon: readonly IsometricPoint[]
): void {
  const first = polygon[0];
  if (first === undefined) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const current of polygon.slice(1)) context.lineTo(current.x, current.y);
  context.closePath();
}

function fillPolygon(
  context: CanvasRenderingContext2D,
  polygon: readonly IsometricPoint[],
  fill: string,
  stroke = 'rgba(12, 25, 36, 0.55)',
  lineWidth = 1
): void {
  polygonPath(context, polygon);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function terrainColor(terrain: number): string {
  const lightness = Math.max(20, Math.min(46, 29 + terrain * 2.4));
  return `hsl(142 32% ${lightness}%)`;
}

function terrainSideColor(terrain: number, side: 'left' | 'right'): string {
  const base = Math.max(14, Math.min(38, 22 + terrain * 1.7));
  return side === 'left' ? `hsl(145 30% ${base}%)` : `hsl(150 26% ${base - 5}%)`;
}

function diamondAt(
  center: IsometricPoint,
  layout: IsometricLayout,
  widthRatio = 0.42,
  heightRatio = 0.42
): readonly IsometricPoint[] {
  return [
    point(center.x, center.y - layout.tileHeight * heightRatio),
    point(center.x + layout.tileWidth * widthRatio, center.y),
    point(center.x, center.y + layout.tileHeight * heightRatio),
    point(center.x - layout.tileWidth * widthRatio, center.y)
  ];
}

function waterSurfacePolygon(
  layout: IsometricLayout,
  geometry: IsometricCellGeometry,
  amount: number
): readonly IsometricPoint[] {
  const visual = waterVisualLevel(amount);
  const center = point(
    geometry.center.x,
    geometry.center.y - layout.tileHeight * visual.lift
  );
  return insetDiamond(
    diamondAt(center, layout, 0.43, 0.43),
    Math.min(layout.tileWidth, layout.tileHeight) * 0.06
  );
}

function point(x: number, y: number): IsometricPoint {
  return Object.freeze({ x, y });
}

function mixPoint(
  from: IsometricPoint,
  to: IsometricPoint,
  ratio: number
): IsometricPoint {
  return point(
    from.x + (to.x - from.x) * ratio,
    from.y + (to.y - from.y) * ratio
  );
}

function drawTerrainDetails(
  context: CanvasRenderingContext2D,
  geometry: IsometricCellGeometry
): void {
  if (geometry.terrain <= 0) return;

  // Horizontal seams make each height unit read as a stack instead of a flat
  // dark polygon, especially on a narrow phone viewport.
  for (let level = 1; level < geometry.terrain; level += 1) {
    const ratio = level / geometry.terrain;
    const leftStart = mixPoint(geometry.top[3]!, geometry.groundCenter, ratio);
    const leftEnd = mixPoint(geometry.top[2]!, geometry.groundCenter, ratio);
    const rightStart = mixPoint(geometry.top[1]!, geometry.groundCenter, ratio);
    const rightEnd = mixPoint(geometry.top[2]!, geometry.groundCenter, ratio);
    context.beginPath();
    context.moveTo(leftStart.x, leftStart.y);
    context.lineTo(leftEnd.x, leftEnd.y);
    context.moveTo(rightStart.x, rightStart.y);
    context.lineTo(rightEnd.x, rightEnd.y);
    context.strokeStyle = 'rgba(180, 235, 255, 0.22)';
    context.lineWidth = 0.8;
    context.stroke();
  }

  polygonPath(context, geometry.top);
  context.strokeStyle = 'rgba(174, 255, 216, 0.62)';
  context.lineWidth = 1.15;
  context.stroke();
}

function waterSurfaceCenter(
  layout: IsometricLayout,
  geometry: IsometricCellGeometry,
  amount: number
): IsometricPoint {
  const visual = waterVisualLevel(amount);
  return point(
    geometry.center.x,
    geometry.center.y - layout.tileHeight * visual.lift
  );
}

function drawRipple(
  context: CanvasRenderingContext2D,
  center: IsometricPoint,
  radius: number,
  color: string,
  lineWidth = 1.2
): void {
  context.save();
  context.scale(1, 0.42);
  context.beginPath();
  context.ellipse(center.x, center.y / 0.42, radius, radius * 0.64, 0, 0, Math.PI * 2);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

function drawWaterPool(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  geometry: IsometricCellGeometry,
  amount: number,
  pulse: number
): void {
  if (amount <= 0) return;
  const visual = waterVisualLevel(amount);
  const surfaceCenter = waterSurfaceCenter(layout, geometry, amount);
  const surface = waterSurfacePolygon(layout, geometry, amount);
  const baseCenter = point(
    surfaceCenter.x,
    surfaceCenter.y + layout.tileHeight * visual.depth
  );
  const base = insetDiamond(
    diamondAt(baseCenter, layout, 0.43, 0.43),
    Math.min(layout.tileWidth, layout.tileHeight) * 0.06
  );

  fillPolygon(context, [surface[3]!, surface[2]!, base[2]!, base[3]!],
    `rgba(11, 94, 148, ${0.76 + visual.ratio * 0.12})`, 'rgba(185, 231, 255, 0.4)', 0.8);
  fillPolygon(context, [surface[1]!, surface[2]!, base[2]!, base[1]!],
    `rgba(8, 68, 121, ${0.78 + visual.ratio * 0.1})`, 'rgba(185, 231, 255, 0.32)', 0.8);
  fillPolygon(context, surface,
    `rgba(55, 190, 236, ${0.76 + visual.ratio * 0.16})`, 'rgba(218, 249, 255, 0.92)', 1.25);

  const rippleRadius = Math.max(4, layout.tileWidth * (0.18 + visual.ratio * 0.08));
  drawRipple(context, surfaceCenter, rippleRadius, `rgba(235, 253, 255, ${0.48 + pulse * 0.3})`);
  drawRipple(
    context,
    point(surfaceCenter.x, surfaceCenter.y + layout.tileHeight * 0.04),
    rippleRadius * 0.58,
    'rgba(9, 89, 143, 0.5)',
    0.9
  );

  context.font = `700 ${Math.max(9, Math.round(layout.tileHeight * 0.24))}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#06263a';
  context.fillText(String(amount), surfaceCenter.x, surfaceCenter.y);
}

function drawRainCloud(
  context: CanvasRenderingContext2D,
  center: IsometricPoint,
  scale: number
): void {
  context.save();
  context.translate(center.x, center.y);
  context.fillStyle = 'rgba(204, 235, 247, 0.9)';
  context.strokeStyle = 'rgba(9, 50, 71, 0.9)';
  context.lineWidth = Math.max(1, scale * 1.2);
  context.beginPath();
  context.arc(-scale * 12, scale * 2, scale * 7, Math.PI, 0);
  context.arc(-scale * 2, -scale * 2, scale * 10, Math.PI, 0);
  context.arc(scale * 9, scale * 2, scale * 8, Math.PI, 0);
  context.lineTo(scale * 16, scale * 7);
  context.lineTo(-scale * 18, scale * 7);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawRainAnimation(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  rainCells: readonly RainEvent[],
  progress: number,
  reducedMotion: boolean
): void {
  const ratio = reducedMotion ? 1 : clampPlaybackProgress(progress);
  for (const rain of rainCells) {
    const geometry = getCellGeometry(layout, snapshot, rain.index);
    const scale = Math.max(0.62, Math.min(1.15, layout.tileWidth / 54));
    const cloud = point(
      geometry.center.x,
      Math.max(20, geometry.center.y - layout.tileHeight * 1.65)
    );
    drawRainCloud(context, cloud, scale);

    const rainStartY = cloud.y + layout.tileHeight * 0.2;
    const rainEndY = geometry.center.y - layout.tileHeight * 0.18;
    const dropCount = layout.tileWidth < 48 ? 3 : 5;
    for (let index = 0; index < dropCount; index += 1) {
      const spread = (index - (dropCount - 1) / 2) * layout.tileWidth * 0.12;
      const startY = rainStartY + (index % 2) * layout.tileHeight * 0.06;
      const offsetProgress = Math.min(1, Math.max(0, ratio + (index % 3) * 0.08));
      const endY = startY + (rainEndY - startY) * offsetProgress;
      context.beginPath();
      context.moveTo(cloud.x + spread, startY);
      context.lineTo(cloud.x + spread - layout.tileWidth * 0.025, endY);
      context.strokeStyle = '#d8f7ff';
      context.lineWidth = Math.max(1.4, layout.tileWidth * 0.025);
      context.stroke();
    }

    const ripple = Math.max(3, layout.tileWidth * 0.14) * (0.8 + ratio * 0.7);
    drawRipple(
      context,
      point(geometry.center.x, geometry.center.y - layout.tileHeight * 0.12),
      ripple,
      `rgba(220, 250, 255, ${0.55 + (reducedMotion ? 0 : (1 - ratio) * 0.3)})`,
      1.5
    );
    context.font = `800 ${Math.max(9, Math.round(layout.tileHeight * 0.23))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#e9fbff';
    context.fillText(`+${rain.amount}`, cloud.x, cloud.y - layout.tileHeight * 0.28);
  }
}

function drawEdgeMarker(
  context: CanvasRenderingContext2D,
  geometry: IsometricCellGeometry,
  mask: number,
  direction: Direction,
  color: string
): void {
  if ((mask & direction) === 0) return;
  const edgeIndex = direction === Direction.North
    ? 0
    : direction === Direction.East
      ? 1
      : direction === Direction.South
        ? 2
        : 3;
  const nextIndex = (edgeIndex + 1) % 4;
  const start = geometry.top[edgeIndex];
  const end = geometry.top[nextIndex];
  if (start === undefined || end === undefined) return;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.stroke();
}

function drawArrow(
  context: CanvasRenderingContext2D,
  from: IsometricPoint,
  to: IsometricPoint,
  color: string
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 6;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle - Math.PI / 6) * head, to.y - Math.sin(angle - Math.PI / 6) * head);
  context.lineTo(to.x - Math.cos(angle + Math.PI / 6) * head, to.y - Math.sin(angle + Math.PI / 6) * head);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function flowTarget(
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  from: number,
  to: number | null,
  direction: Direction
): IsometricPoint {
  const fromPoint = getCellGeometry(layout, snapshot, from).center;
  if (to !== null) return getCellGeometry(layout, snapshot, to).center;
  const distance = layout.tileWidth * 0.75;
  const horizontal = direction === Direction.East ? distance : direction === Direction.West ? -distance : 0;
  const vertical = direction === Direction.South ? distance * 0.45 : direction === Direction.North ? -distance * 0.45 : 0;
  return point(fromPoint.x + horizontal, fromPoint.y + vertical);
}

function flowTransferColor(transfer: WaterTransfer): string {
  return transfer.kind === 'danger-edge'
    ? '#ff6b6b'
    : transfer.kind === 'safe-edge'
      ? '#8ee3cf'
      : '#b9e7ff';
}

function drawFlowRoute(
  context: CanvasRenderingContext2D,
  from: IsometricPoint,
  to: IsometricPoint,
  color: string,
  lineWidth: number
): void {
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.save();
  context.globalAlpha *= 0.42;
  context.stroke();
  context.restore();
}

/** Returns the point where a recorded water transfer is shown in playback. */
export function interpolateWaterTransferPoint(
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  transfer: Pick<WaterTransfer, 'from' | 'to' | 'direction'>,
  progress: number
): IsometricPoint {
  const from = getCellGeometry(layout, snapshot, transfer.from).center;
  const to = flowTarget(layout, snapshot, transfer.from, transfer.to, transfer.direction);
  const ratio = clampPlaybackProgress(progress);
  return point(
    from.x + (to.x - from.x) * ratio,
    from.y + (to.y - from.y) * ratio
  );
}

/** Returns a small train of presentation-only water particles on a route. */
export function flowParticlePositions(
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  transfer: Pick<WaterTransfer, 'from' | 'to' | 'direction'>,
  progress: number,
  particleCount = 4
): readonly IsometricPoint[] {
  if (!Number.isSafeInteger(particleCount) || particleCount <= 0) {
    throw new RangeError('particleCount must be a positive integer');
  }
  return Object.freeze(
    Array.from({ length: particleCount }, (_, index) =>
      interpolateWaterTransferPoint(
        layout,
        snapshot,
        transfer,
        flowParticleProgress(progress, index, particleCount)
      )
    )
  );
}

function drawFlowPreview(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  result: FlowStepResult
): void {
  for (const transfer of result.transfers) {
    const from = getCellGeometry(layout, snapshot, transfer.from).center;
    const to = flowTarget(layout, snapshot, transfer.from, transfer.to, transfer.direction);
    drawFlowRoute(
      context,
      from,
      to,
      flowTransferColor(transfer),
      Math.max(4, layout.tileHeight * 0.16)
    );
    drawArrow(context, from, to, flowTransferColor(transfer));
  }
}

function drawActiveWaterTransfers(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  result: FlowStepResult,
  progress: number,
  reducedMotion: boolean
): void {
  const transferProgress = reducedMotion ? 0.5 : clampPlaybackProgress(progress);
  const particleCount = layout.tileWidth < 48 ? 3 : 4;
  for (const transfer of result.transfers) {
    const from = getCellGeometry(layout, snapshot, transfer.from).center;
    const to = flowTarget(layout, snapshot, transfer.from, transfer.to, transfer.direction);
    const color = flowTransferColor(transfer);
    drawFlowRoute(
      context,
      from,
      to,
      color,
      Math.max(6, layout.tileHeight * 0.22)
    );
    const positions = flowParticlePositions(
      layout,
      snapshot,
      transfer,
      transferProgress,
      particleCount
    );
    for (const [index, position] of positions.entries()) {
      const liftedY = position.y - Math.max(2, layout.tileHeight * 0.16);
      const radius = Math.max(3.5, Math.min(8, layout.tileHeight * 0.24)) *
        (index === 0 ? 1.15 : 0.82);
      context.beginPath();
      context.arc(position.x, liftedY, radius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = '#f4fbff';
      context.lineWidth = 1.2;
      context.stroke();
    }

    const destinationPulse = Math.max(0.1, transferProgress);
    drawRipple(
      context,
      point(to.x, to.y - Math.max(2, layout.tileHeight * 0.12)),
      Math.max(5, layout.tileWidth * (0.12 + destinationPulse * 0.12)),
      `${color}cc`,
      1.4
    );
    context.font = `800 ${Math.max(9, Math.round(layout.tileHeight * 0.22))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f4fbff';
    context.fillText(String(transfer.amount), to.x, to.y - layout.tileHeight * 0.25);
  }
}

function riskColor(level: StageCellRiskView['level']): string {
  switch (level) {
    case 'caution': return 'rgba(255, 209, 102, 0.22)';
    case 'danger': return 'rgba(255, 145, 92, 0.28)';
    case 'critical': return 'rgba(255, 92, 92, 0.34)';
    case 'safe': return 'transparent';
  }
}

function forecastColor(eventIndex: number): string {
  return eventIndex % 2 === 0 ? '#c8f1ff' : '#b9a7ff';
}

function drawRiskOverlay(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  risks: readonly StageCellRiskView[]
): void {
  for (const risk of risks) {
    if (risk.level === 'safe') continue;
    const geometry = getCellGeometry(layout, snapshot, risk.index);
    fillPolygon(context, geometry.top, riskColor(risk.level), 'rgba(255, 255, 255, 0.18)', 1.5);
  }
}

function drawForecastOverlay(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  forecastCells: readonly ForecastCellView[]
): void {
  context.setLineDash([4, 3]);
  for (const forecast of forecastCells) {
    const geometry = getCellGeometry(layout, snapshot, forecast.index);
    const radius = Math.max(5, layout.tileHeight * 0.22) + forecast.eventIndex * 3;
    context.beginPath();
    context.arc(geometry.center.x, geometry.center.y, radius, 0, Math.PI * 2);
    context.strokeStyle = forecastColor(forecast.eventIndex);
    context.lineWidth = 2;
    context.stroke();
    context.font = `${Math.max(9, Math.round(layout.tileHeight * 0.2))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = forecastColor(forecast.eventIndex);
    context.fillText(String(forecast.amount), geometry.center.x, geometry.center.y - radius - 4);
    drawRainCloud(
      context,
      point(geometry.center.x, Math.max(18, geometry.center.y - layout.tileHeight * 1.3)),
      Math.max(0.52, Math.min(0.9, layout.tileWidth / 64))
    );
  }
  context.setLineDash([]);
}

function drawConstructionVisual(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  visual: ConstructionVisual,
  pulse: number
): void {
  const beforeSnapshot: Pick<BoardSnapshot, 'terrain'> = { terrain: visual.terrainBefore };
  const afterSnapshot: Pick<BoardSnapshot, 'terrain'> = { terrain: visual.terrainAfter };
  const color = visual.delta > 0 ? '#ffd166' : '#ff9f68';
  for (const index of visual.placementCells) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= CELL_COUNT) continue;
    const before = getCellGeometry(layout, beforeSnapshot, index);
    const after = getCellGeometry(layout, afterSnapshot, index);
    context.save();
    context.setLineDash([5, 4]);
    polygonPath(context, before.top);
    context.strokeStyle = 'rgba(226, 243, 255, 0.82)';
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();

    fillPolygon(
      context,
      after.top,
      `rgba(255, 209, 102, ${0.2 + pulse * 0.16})`,
      color,
      2 + pulse
    );

    const start = point(
      after.center.x,
      after.center.y + layout.tileHeight * (visual.delta > 0 ? 0.32 : -0.32)
    );
    const end = point(
      after.center.x,
      after.center.y - layout.tileHeight * (visual.delta > 0 ? 0.32 : -0.32)
    );
    drawArrow(context, start, end, color);
    context.font = `800 ${Math.max(10, Math.round(layout.tileHeight * 0.25))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#fff6d6';
    context.fillText(visual.delta > 0 ? '▲ 上げる' : '▼ 下げる', after.center.x, end.y - layout.tileHeight * 0.14);
  }
}

function phaseIndex(phase: StageTracePhase | null, resultPhase: BoardRenderOptions['resultPhase']): number {
  if (resultPhase !== null && resultPhase !== undefined) return 3;
  switch (phase) {
    case 'rain': return 1;
    case 'flow': return 2;
    case 'evaluation': return 3;
    case 'construction':
    case 'undo':
    case null:
    case undefined:
      return 0;
  }
}

function drawPhaseTimeline(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  phase: StageTracePhase | null,
  resultPhase: BoardRenderOptions['resultPhase']
): void {
  const labels = ['① 工事', '② 雨', '③ 水が流れる', '④ 判定'];
  const colors = ['#ffd166', '#c8f1ff', '#65d7ff', '#8ee3cf'];
  const gap = 4;
  const width = Math.max(44, (layout.viewportWidth - 24 - gap * 3) / labels.length);
  const active = phaseIndex(phase, resultPhase);
  for (let index = 0; index < labels.length; index += 1) {
    const x = 12 + index * (width + gap);
    const isActive = index === active;
    const color = colors[index]!;
    context.fillStyle = isActive ? `${color}dd` : 'rgba(7, 21, 33, 0.84)';
    context.fillRect(x, 12, width, 29);
    context.strokeStyle = isActive ? color : 'rgba(180, 235, 255, 0.25)';
    context.lineWidth = isActive ? 1.8 : 1;
    context.strokeRect(x, 12, width, 29);
    context.font = `800 ${Math.max(8, Math.min(12, layout.tileWidth * 0.18))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = isActive ? '#06263a' : 'rgba(226, 243, 255, 0.68)';
    context.fillText(labels[index]!, x + width / 2, 26.5);
  }
}

function drawObjectiveMeter(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  objectiveProgress: BoardRenderOptions['objectiveProgress'],
  objectiveLabel: string
): void {
  if (objectiveProgress === null || objectiveProgress === undefined) return;
  const target = Math.max(1, objectiveProgress.target);
  const value = Math.max(0, Math.min(target, objectiveProgress.value));
  const ratio = value / target;
  const width = Math.min(220, Math.max(140, layout.viewportWidth * 0.34));
  const x = layout.viewportWidth - width - 12;
  const y = 52;
  context.fillStyle = 'rgba(7, 21, 33, 0.84)';
  context.fillRect(x, y, width, 30);
  context.strokeStyle = 'rgba(180, 235, 255, 0.32)';
  context.lineWidth = 1;
  context.strokeRect(x, y, width, 30);
  context.fillStyle = 'rgba(8, 68, 121, 0.9)';
  context.fillRect(x + 7, y + 18, width - 14, 6);
  context.fillStyle = '#55d8ed';
  context.fillRect(x + 7, y + 18, (width - 14) * ratio, 6);
  context.font = `800 ${Math.max(9, Math.min(12, layout.tileWidth * 0.2))}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#eef8ff';
  context.fillText(`${objectiveLabel} ${value} / ${target}`, x + width / 2, y + 9);
}

function drawResultBanner(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  resultPhase: BoardRenderOptions['resultPhase'],
  resultText: string
): void {
  if (resultPhase === null || resultPhase === undefined) return;
  const cleared = resultPhase === 'cleared';
  const height = 46;
  const x = 12;
  const y = layout.viewportHeight - height - 12;
  const width = layout.viewportWidth - 24;
  context.fillStyle = cleared ? 'rgba(18, 101, 79, 0.94)' : 'rgba(126, 43, 43, 0.94)';
  context.fillRect(x, y, width, height);
  context.strokeStyle = cleared ? '#8ee3cf' : '#ff8f70';
  context.lineWidth = 2;
  context.strokeRect(x, y, width, height);
  context.beginPath();
  context.arc(x + 24, y + height / 2, 13, 0, Math.PI * 2);
  context.fillStyle = cleared ? '#8ee3cf' : '#ff8f70';
  context.fill();
  context.font = '900 17px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#06263a';
  context.fillText(cleared ? '✓' : '!', x + 24, y + height / 2 + 1);
  context.font = `900 ${Math.max(12, Math.min(18, layout.tileWidth * 0.3))}px system-ui, sans-serif`;
  context.textAlign = 'left';
  context.fillStyle = '#ffffff';
  context.fillText(resultText, x + 46, y + height / 2);
}

function drawConstructionAnchorMarkers(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  anchorIndices: readonly number[]
): void {
  const radius = Math.max(5, Math.min(8, Math.min(layout.tileWidth, layout.tileHeight) * 0.34));
  for (const index of anchorIndices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= CELL_COUNT) continue;
    const geometry = getCellGeometry(layout, snapshot, index);
    context.beginPath();
    context.arc(geometry.center.x, geometry.center.y, radius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(49, 214, 151, 0.78)';
    context.fill();
    context.strokeStyle = '#d7fff0';
    context.lineWidth = 1.5;
    context.stroke();
  }
}

/** Draws one deterministic board frame. It contains no game-rule calculations. */
export function renderIsometricBoard(
  context: CanvasRenderingContext2D,
  snapshot: BoardSnapshot,
  layout: IsometricLayout,
  options: BoardRenderOptions = {}
): void {
  context.clearRect(0, 0, layout.viewportWidth, layout.viewportHeight);
  context.fillStyle = options.background ?? '#071521';
  context.fillRect(0, 0, layout.viewportWidth, layout.viewportHeight);
  context.lineJoin = 'round';
  context.lineCap = 'round';

  const preview = options.preview;
  const previewVisual: ConstructionVisual | null =
    preview !== undefined && preview !== null && preview.valid && preview.action.type === 'construct'
      ? {
          placementCells: preview.placementCells,
          terrainBefore: snapshot.terrain,
          terrainAfter: preview.terrainAfterConstruction,
          delta: preview.action.slot >= 0
            ? (preview.terrainAfterConstruction[preview.placementCells[0] ?? 0] ?? 0) -
              (snapshot.terrain[preview.placementCells[0] ?? 0] ?? 0)
            : 0
        }
      : null;
  const constructionVisual = options.constructionVisual ?? previewVisual;
  const terrain = constructionVisual?.terrainAfter ?? preview?.terrainAfterConstruction;
  const renderSnapshot: Pick<BoardSnapshot, 'terrain'> = {
    terrain: terrain ?? snapshot.terrain
  };
  const waterSnapshot = preview?.valid ? preview.boardAfterNextFlow : snapshot;
  const indices = sortCellIndicesForDrawing(renderSnapshot);

  for (const index of indices) {
    const geometry = getCellGeometry(layout, renderSnapshot, index);
    if (geometry.terrain > 0) {
      fillPolygon(context, geometry.leftSide, terrainSideColor(geometry.terrain, 'left'));
      fillPolygon(context, geometry.rightSide, terrainSideColor(geometry.terrain, 'right'));
    }
  }

  for (const index of indices) {
    const geometry = getCellGeometry(layout, renderSnapshot, index);
    const waterAmount = waterSnapshot.water[index] ?? 0;
    fillPolygon(context, geometry.top, terrainColor(geometry.terrain), 'rgba(8, 22, 31, 0.76)');
    drawTerrainDetails(context, geometry);
    drawWaterPool(context, layout, geometry, waterAmount, 0);

    const flags = snapshot.cellFlags[index] ?? 0;
    if ((flags & CellFlag.Protected) !== 0) {
      context.beginPath();
      context.arc(geometry.center.x, geometry.center.y, Math.max(4, layout.tileHeight * 0.12), 0, Math.PI * 2);
      context.fillStyle = '#ffe08a';
      context.fill();
      context.strokeStyle = '#5e4314';
      context.lineWidth = 1;
      context.stroke();
    }
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.North, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.East, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.South, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.West, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.North, '#ff6b6b');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.East, '#ff6b6b');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.South, '#ff6b6b');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.West, '#ff6b6b');
  }

  drawRiskOverlay(context, layout, renderSnapshot, options.riskCells ?? []);
  drawForecastOverlay(context, layout, renderSnapshot, options.forecastCells ?? []);

  const selectedCell = options.selectedCell ?? null;
  if (selectedCell !== null && selectedCell >= 0 && selectedCell < CELL_COUNT) {
    const geometry = getCellGeometry(layout, renderSnapshot, selectedCell);
    fillPolygon(context, geometry.top, 'rgba(255, 255, 255, 0.14)', '#fff3b0', 3);
  }

  const playbackProgress = clampPlaybackProgress(options.playbackProgress);
  const playbackPulseValue = playbackPulseForMotion(playbackProgress, options.reducedMotion ?? false);
  const activePlacementCells = options.activePlacementCells ?? [];
  for (const index of activePlacementCells) {
    const geometry = getCellGeometry(layout, renderSnapshot, index);
    fillPolygon(
      context,
      geometry.top,
      `rgba(255, 208, 92, ${0.12 + playbackPulseValue * 0.22})`,
      '#ffd166',
      2 + playbackPulseValue
    );
  }

  const activeFlow = options.flowResult ?? null;
  if (preview !== undefined && preview !== null && preview.valid) {
    for (const index of preview.placementCells) {
      const geometry = getCellGeometry(layout, renderSnapshot, index);
      fillPolygon(context, geometry.top, 'rgba(255, 208, 92, 0.28)', '#ffd166', 2);
    }
    if (activeFlow === null) drawFlowPreview(context, layout, renderSnapshot, preview.nextFlow);
    if (preview.rainCells.length > 0) {
      drawRainAnimation(
        context,
        layout,
        renderSnapshot,
        preview.rainCells,
        1,
        true
      );
    }
  }

  if (constructionVisual !== null &&
      (options.phase === 'construction' || options.phase === 'undo' ||
        (options.phase === null || options.phase === undefined) && preview !== null && preview !== undefined)) {
    drawConstructionVisual(context, layout, constructionVisual, playbackPulseValue);
  }

  if (activeFlow !== null) {
    const previousAlpha = context.globalAlpha;
    context.globalAlpha = 0.58 + playbackPulseValue * 0.42;
    drawFlowPreview(context, layout, renderSnapshot, activeFlow);
    drawActiveWaterTransfers(
      context,
      layout,
      renderSnapshot,
      activeFlow,
      playbackProgress,
      options.reducedMotion ?? false
    );
    context.globalAlpha = previousAlpha;
  }

  const activeRain = options.rainCells ?? [];
  if (activeRain.length > 0) {
    drawRainAnimation(
      context,
      layout,
      renderSnapshot,
      activeRain,
      playbackProgress,
      options.reducedMotion ?? false
    );
  }

  drawBoardGridLabels(context, layout, renderSnapshot);
  drawConstructionAnchorMarkers(
    context,
    layout,
    renderSnapshot,
    options.constructionAnchorCells ?? []
  );
  drawPhaseTimeline(context, layout, options.phase ?? null, options.resultPhase ?? null);
  drawObjectiveMeter(
    context,
    layout,
    options.objectiveProgress ?? null,
    options.objectiveLabel ?? '目標'
  );
  drawResultBanner(
    context,
    layout,
    options.resultPhase ?? null,
    options.resultText ?? '結果を確認してください'
  );
}

export function drawBoardGridLabels(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>
): void {
  context.font = `${Math.max(9, Math.round(layout.tileHeight * 0.22))}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = 'rgba(226, 243, 255, 0.5)';
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const geometry = getCellGeometry(layout, snapshot, index);
    context.fillText(String(index + 1), geometry.center.x, geometry.center.y + layout.tileHeight * 0.25);
  }
}
