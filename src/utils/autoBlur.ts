import type { AutoBlurRegion } from '../types/studio';

const REGION_COORDINATE_MAX = 1000;

export function sanitizeAutoBlurRegions(value: unknown): AutoBlurRegion[] {
  if (!Array.isArray(value)) return [];

  const sanitized = value
    .slice(0, 24)
    .flatMap((item): AutoBlurRegion[] => {
      if (!item || typeof item !== 'object') return [];
      const region = item as Record<string, unknown>;
      const isCoordinate = (coordinate: unknown): coordinate is number =>
        typeof coordinate === 'number' && Number.isFinite(coordinate);
      if (
        !isCoordinate(region.x) ||
        !isCoordinate(region.y) ||
        !isCoordinate(region.width) ||
        !isCoordinate(region.height)
      ) {
        return [];
      }

      const rawX = region.x;
      const rawY = region.y;
      const rawWidth = region.width;
      const rawHeight = region.height;
      const x = Math.min(REGION_COORDINATE_MAX, Math.max(0, rawX));
      const y = Math.min(REGION_COORDINATE_MAX, Math.max(0, rawY));
      const right = Math.min(REGION_COORDINATE_MAX, Math.max(x, rawX + rawWidth));
      const bottom = Math.min(REGION_COORDINATE_MAX, Math.max(y, rawY + rawHeight));
      if (right <= x || bottom <= y) return [];

      return [{ x, y, width: right - x, height: bottom - y }];
    });

  return sanitized;
}

export function mergeAutoBlurRegions(regions: AutoBlurRegion[]): AutoBlurRegion[] {
  const merged: AutoBlurRegion[] = [];
  for (const region of regions) {
    const regionArea = region.width * region.height;
    const duplicateIndex = merged.findIndex((existing) => {
      const overlapWidth = Math.max(
        0,
        Math.min(existing.x + existing.width, region.x + region.width) - Math.max(existing.x, region.x)
      );
      const overlapHeight = Math.max(
        0,
        Math.min(existing.y + existing.height, region.y + region.height) - Math.max(existing.y, region.y)
      );
      const overlapArea = overlapWidth * overlapHeight;
      return overlapArea / Math.min(existing.width * existing.height, regionArea) >= 0.6;
    });

    if (duplicateIndex < 0) {
      merged.push(region);
      continue;
    }

    const existing = merged[duplicateIndex];
    const x = Math.min(existing.x, region.x);
    const y = Math.min(existing.y, region.y);
    const right = Math.max(existing.x + existing.width, region.x + region.width);
    const bottom = Math.max(existing.y + existing.height, region.y + region.height);
    merged[duplicateIndex] = { x, y, width: right - x, height: bottom - y };
  }
  return merged;
}
