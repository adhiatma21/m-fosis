import * as toGeoJSON from 'togeojson';

export interface MergedCableRoute {
  feature: any; // GeoJSON Feature with geometry LineString
  coordinatesLatLng: [number, number][]; // [[lat, lng], ...] for calculations & Leaflet
  totalDistanceMeters: number;
  segmentCount: number;
}

/**
 * Calculates Haversine distance between two [lat, lng] coordinates in meters.
 */
export function haversineDistance(p1: [number, number], p2: [number, number]): number {
  const R = 6371000; // Earth radius in meters
  const lat1 = (p1[0] * Math.PI) / 180;
  const lat2 = (p2[0] * Math.PI) / 180;
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Merges multiple disconnected or cut cable segments into a single continuous chain
 * of [lat, lng] coordinates, ordered continuously from upstream (Hulu) to downstream (Hilir).
 * 
 * @param segments Array of segments, where each segment is an array of [lat, lng] coordinates.
 * @param originHint Optional [lat, lng] representing upstream / Hulu (e.g. STO, ODC, or start station).
 * @param destinationHint Optional [lat, lng] representing downstream / Hilir (e.g. ODP, ODC, or target station).
 */
export function stitchSegmentsToContinuousPath(
  segments: [number, number][][],
  originHint?: [number, number] | null,
  destinationHint?: [number, number] | null
): [number, number][] {
  // 1. Filter out empty or single-point invalid segments
  const validSegments = segments
    .map(seg => seg.filter(p => !isNaN(p[0]) && !isNaN(p[1])))
    .filter(seg => seg.length >= 2);

  if (validSegments.length === 0) return [];
  if (validSegments.length === 1) {
    let single = [...validSegments[0]];
    // Orient single segment from Hulu to Hilir if hint provided
    if (originHint) {
      const dStart = haversineDistance(single[0], originHint);
      const dEnd = haversineDistance(single[single.length - 1], originHint);
      if (dEnd < dStart) {
        single.reverse();
      }
    } else if (destinationHint) {
      const dStart = haversineDistance(single[0], destinationHint);
      const dEnd = haversineDistance(single[single.length - 1], destinationHint);
      if (dStart < dEnd) {
        single.reverse();
      }
    }
    return single;
  }

  // 2. Clone segment pool
  const pool = validSegments.map(s => [...s]);

  // 3. Choose starting segment
  let startIdx = 0;
  let startReversed = false;

  if (originHint) {
    let bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const seg = pool[i];
      const d0 = haversineDistance(seg[0], originHint);
      const d1 = haversineDistance(seg[seg.length - 1], originHint);
      if (d0 < bestDist) {
        bestDist = d0;
        startIdx = i;
        startReversed = false;
      }
      if (d1 < bestDist) {
        bestDist = d1;
        startIdx = i;
        startReversed = true;
      }
    }
  }

  let chain = startReversed ? pool[startIdx].slice().reverse() : pool[startIdx].slice();
  pool.splice(startIdx, 1);

  // 4. Bidirectional greedy nearest-neighbor chaining
  while (pool.length > 0) {
    const head = chain[0];
    const tail = chain[chain.length - 1];

    let bestDist = Infinity;
    let bestPoolIdx = -1;
    let bestMode: 'tail-start' | 'tail-end' | 'head-end' | 'head-start' = 'tail-start';

    for (let i = 0; i < pool.length; i++) {
      const seg = pool[i];
      const segStart = seg[0];
      const segEnd = seg[seg.length - 1];

      // Option A: Append to tail (segStart attaches to tail)
      const dTailStart = haversineDistance(tail, segStart);
      if (dTailStart < bestDist) {
        bestDist = dTailStart;
        bestPoolIdx = i;
        bestMode = 'tail-start';
      }

      // Option B: Append reversed to tail (segEnd attaches to tail)
      const dTailEnd = haversineDistance(tail, segEnd);
      if (dTailEnd < bestDist) {
        bestDist = dTailEnd;
        bestPoolIdx = i;
        bestMode = 'tail-end';
      }

      // Option C: Prepend to head (segEnd attaches to head)
      const dHeadEnd = haversineDistance(segEnd, head);
      if (dHeadEnd < bestDist) {
        bestDist = dHeadEnd;
        bestPoolIdx = i;
        bestMode = 'head-end';
      }

      // Option D: Prepend reversed to head (segStart attaches to head)
      const dHeadStart = haversineDistance(segStart, head);
      if (dHeadStart < bestDist) {
        bestDist = dHeadStart;
        bestPoolIdx = i;
        bestMode = 'head-start';
      }
    }

    if (bestPoolIdx === -1) break;

    const chosenSeg = pool[bestPoolIdx];
    pool.splice(bestPoolIdx, 1);

    switch (bestMode) {
      case 'tail-start': {
        // Skip duplicate connecting point if within 1 meter
        const startOffset = haversineDistance(tail, chosenSeg[0]) < 1.0 ? 1 : 0;
        for (let j = startOffset; j < chosenSeg.length; j++) {
          chain.push(chosenSeg[j]);
        }
        break;
      }
      case 'tail-end': {
        const rev = chosenSeg.slice().reverse();
        const startOffset = haversineDistance(tail, rev[0]) < 1.0 ? 1 : 0;
        for (let j = startOffset; j < rev.length; j++) {
          chain.push(rev[j]);
        }
        break;
      }
      case 'head-end': {
        const endLimit = haversineDistance(chosenSeg[chosenSeg.length - 1], head) < 1.0
          ? chosenSeg.length - 1
          : chosenSeg.length;
        const prefix = chosenSeg.slice(0, endLimit);
        chain = prefix.concat(chain);
        break;
      }
      case 'head-start': {
        const rev = chosenSeg.slice().reverse();
        const endLimit = haversineDistance(rev[rev.length - 1], head) < 1.0
          ? rev.length - 1
          : rev.length;
        const prefix = rev.slice(0, endLimit);
        chain = prefix.concat(chain);
        break;
      }
    }
  }

  // 5. Deduplicate consecutive identical points
  const cleanChain: [number, number][] = [];
  for (let i = 0; i < chain.length; i++) {
    if (i === 0) {
      cleanChain.push(chain[i]);
    } else {
      const prev = cleanChain[cleanChain.length - 1];
      if (haversineDistance(prev, chain[i]) > 0.05) {
        cleanChain.push(chain[i]);
      }
    }
  }

  // 6. Guarantee upstream (Hulu) to downstream (Hilir) orientation
  if (originHint && cleanChain.length >= 2) {
    const dHead = haversineDistance(cleanChain[0], originHint);
    const dTail = haversineDistance(cleanChain[cleanChain.length - 1], originHint);
    if (dTail < dHead) {
      cleanChain.reverse();
    }
  } else if (destinationHint && cleanChain.length >= 2) {
    const dHead = haversineDistance(cleanChain[0], destinationHint);
    const dTail = haversineDistance(cleanChain[cleanChain.length - 1], destinationHint);
    if (dHead < dTail) {
      cleanChain.reverse();
    }
  }

  return cleanChain;
}

/**
 * Extracts all LineString segments and Point placemarks from a GeoJSON object
 * (including sub-folders, FeatureCollections, and MultiLineStrings).
 */
export function extractGeoJsonFeatures(geoJson: any): { lineFeatures: any[]; pointFeatures: any[] } {
  const lineFeatures: any[] = [];
  const pointFeatures: any[] = [];

  const processGeometry = (geometry: any, properties: any) => {
    if (!geometry) return;
    if (geometry.type === 'LineString') {
      lineFeatures.push({ type: 'Feature', geometry, properties });
    } else if (geometry.type === 'MultiLineString') {
      (geometry.coordinates || []).forEach((coords: any, idx: number) => {
        lineFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { ...properties, subIndex: idx }
        });
      });
    } else if (geometry.type === 'Point') {
      pointFeatures.push({ type: 'Feature', geometry, properties });
    } else if (geometry.type === 'Polygon') {
      if (geometry.coordinates && geometry.coordinates.length > 0) {
        lineFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: geometry.coordinates[0] },
          properties
        });
      }
    } else if (geometry.type === 'MultiPolygon') {
      (geometry.coordinates || []).forEach((poly: any) => {
        if (poly && poly.length > 0) {
          lineFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: poly[0] },
            properties
          });
        }
      });
    } else if (geometry.type === 'GeometryCollection') {
      (geometry.geometries || []).forEach((g: any) => processGeometry(g, properties));
    }
  };

  const processFeature = (feature: any) => {
    if (!feature) return;
    if (feature.type === 'Feature') {
      processGeometry(feature.geometry, feature.properties);
    } else if (feature.type === 'FeatureCollection' || Array.isArray(feature.features)) {
      (feature.features || []).forEach(processFeature);
    }
  };

  processFeature(geoJson);
  return { lineFeatures, pointFeatures };
}

/**
 * Extracts LineString segments directly from a KML XML DOM document,
 * respecting any <Folder> subfolder groupings and multiple <Placemark> line strings.
 */
export function extractLineSegmentsFromKmlDom(kmlDom: Document): [number, number][][] {
  const segments: [number, number][][] = [];

  // Look for all LineString elements (with or without namespace)
  const lineStringNodes = Array.from(kmlDom.getElementsByTagName('LineString')).concat(
    Array.from(kmlDom.getElementsByTagNameNS('*', 'LineString'))
  );

  const uniqueLineStrings = Array.from(new Set(lineStringNodes));

  for (const lsNode of uniqueLineStrings) {
    const coordNodes = Array.from(lsNode.getElementsByTagName('coordinates')).concat(
      Array.from(lsNode.getElementsByTagNameNS('*', 'coordinates'))
    );
    if (coordNodes.length === 0) continue;

    const rawText = coordNodes[0].textContent || '';
    const pointsText = rawText.trim().split(/\s+/);
    const segCoords: [number, number][] = [];

    for (const ptStr of pointsText) {
      const parts = ptStr.split(',');
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          segCoords.push([lat, lng]);
        }
      }
    }

    if (segCoords.length >= 2) {
      segments.push(segCoords);
    }
  }

  return segments;
}

/**
 * Core pre-processing function that takes an array of GeoJSON LineString features
 * (or multiple segments from subfolders), merges them into a single continuous cable route Feature,
 * and outputs clean continuous coordinates from Hulu to Hilir.
 */
export function mergeCableFeatures(
  lineFeatures: any[],
  options?: {
    originHint?: [number, number] | null;
    destinationHint?: [number, number] | null;
    name?: string;
  }
): MergedCableRoute | null {
  if (!lineFeatures || lineFeatures.length === 0) return null;

  // Convert each line feature to [lat, lng][] segment
  const segments: [number, number][][] = [];
  const propertyNames: string[] = [];

  lineFeatures.forEach((f: any) => {
    if (!f.geometry) return;
    const name = f.properties?.name || f.properties?.Name;
    if (name) propertyNames.push(name);

    if (f.geometry.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
      const seg: [number, number][] = f.geometry.coordinates
        .map((c: any) => [parseFloat(c[1]), parseFloat(c[0])] as [number, number])
        .filter((c: [number, number]) => !isNaN(c[0]) && !isNaN(c[1]));
      if (seg.length >= 2) segments.push(seg);
    } else if (f.geometry.type === 'MultiLineString' && Array.isArray(f.geometry.coordinates)) {
      f.geometry.coordinates.forEach((lineCoords: any) => {
        const seg: [number, number][] = lineCoords
          .map((c: any) => [parseFloat(c[1]), parseFloat(c[0])] as [number, number])
          .filter((c: [number, number]) => !isNaN(c[0]) && !isNaN(c[1]));
        if (seg.length >= 2) segments.push(seg);
      });
    }
  });

  if (segments.length === 0) return null;

  // Stitch all segments into a single continuous chain
  const continuousCoords = stitchSegmentsToContinuousPath(
    segments,
    options?.originHint,
    options?.destinationHint
  );

  if (continuousCoords.length < 2) return null;

  // Calculate total path distance
  let totalDistanceMeters = 0;
  for (let i = 0; i < continuousCoords.length - 1; i++) {
    totalDistanceMeters += haversineDistance(continuousCoords[i], continuousCoords[i + 1]);
  }

  // Create unified GeoJSON Feature (coordinates as [lng, lat])
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: continuousCoords.map(c => [c[1], c[0]])
    },
    properties: {
      name: options?.name || Array.from(new Set(propertyNames)).join(' - ') || 'Rute Kabel Tergabung',
      isMergedContinuousRoute: true,
      originalSegmentCount: segments.length,
      totalDistanceMeters: Math.round(totalDistanceMeters)
    }
  };

  return {
    feature,
    coordinatesLatLng: continuousCoords,
    totalDistanceMeters: Math.round(totalDistanceMeters),
    segmentCount: segments.length
  };
}

/**
 * Pre-processes raw KML string:
 * 1. Parses XML DOM and extracts all LineStrings and Points (including inside all <Folder> subfolders).
 * 2. Merges all cut/fragmented cable segments into an intact continuous cable route object.
 * 3. Automatically aligns orientation from Hulu (upstream) to Hilir (downstream).
 */
export function parseAndMergeKml(
  kmlText: string,
  options?: {
    originHint?: [number, number] | null;
    destinationHint?: [number, number] | null;
    name?: string;
  }
): {
  mergedRoute: MergedCableRoute | null;
  pointFeatures: any[];
  allLineFeatures: any[];
  rawGeoJson: any;
} {
  const parser = new DOMParser();
  const kmlDom = parser.parseFromString(kmlText, 'text/xml');
  const rawGeoJson = toGeoJSON.kml(kmlDom);

  const { lineFeatures, pointFeatures } = extractGeoJsonFeatures(rawGeoJson);

  // Fallback: If toGeoJSON missed any LineStrings from nested KML folders, extract directly from DOM
  if (lineFeatures.length === 0) {
    const domSegments = extractLineSegmentsFromKmlDom(kmlDom);
    domSegments.forEach((seg, idx) => {
      lineFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: seg.map(c => [c[1], c[0]])
        },
        properties: { name: `Segment ${idx + 1}` }
      });
    });
  }

  // Auto-detect origin hint if not provided:
  // In telecom KML, ODC / STO / OTB is typically marked as a point Placemark.
  let originHint = options?.originHint;
  let destinationHint = options?.destinationHint;

  if (!originHint) {
    const odcOrStoPoint = pointFeatures.find(p => {
      const name = (p.properties?.name || p.properties?.Name || '').toUpperCase();
      return name.includes('ODC') || name.includes('STO') || name.includes('OTB');
    });
    if (odcOrStoPoint && odcOrStoPoint.geometry && odcOrStoPoint.geometry.coordinates) {
      originHint = [
        parseFloat(odcOrStoPoint.geometry.coordinates[1]),
        parseFloat(odcOrStoPoint.geometry.coordinates[0])
      ];
    }
  }

  const mergedRoute = mergeCableFeatures(lineFeatures, {
    originHint,
    destinationHint,
    name: options?.name
  });

  return {
    mergedRoute,
    pointFeatures,
    allLineFeatures: lineFeatures,
    rawGeoJson
  };
}
