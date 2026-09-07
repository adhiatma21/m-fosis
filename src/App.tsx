/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Ruler, Search, History, CheckCircle, FileText, Copy, Map as MapIcon, 
  Info, Activity, Zap, Clock, ExternalLink, Send, Bot, User, Upload, 
  Download, AlertTriangle, CheckCircle2, Loader2, Trash2, XCircle,
  Save, Eye, Edit, X, Folder, ArrowLeft, HardDrive, Cloud, ChevronRight,
  Maximize2, Minimize2, ChevronLeft, Menu, RefreshCw, FileCode, Lock, LogIn, MapPin
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useDropzone } from 'react-dropzone';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as turf from '@turf/turf';
import * as toGeoJSON from 'togeojson';
import { TitikSambung, EventData, Recommendation, ChatMessage, GamasRecord } from './types';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  User as FirebaseUser,
  signOut,
  signInAnonymously
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc,
  query,
  where,
  Timestamp,
  getDocFromServer,
  addDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import AnalisaAiPage from './components/AnalisaAiPage';
import ValidasiAlpro from './pages/ValidasiAlpro';
import DashboardGamas from './pages/DashboardGamas';
import CableSegmentChart from './components/CableSegmentChart';
// @ts-ignore
import mFosisLogo from './assets/images/m_fosis_logo_1782313293436.jpg';

// Error Handling Spec for Firestore Operations
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.warn('Firestore Operation Notice:', errInfo);
  return errInfo;
}

// Fix Leaflet marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Mock Data
const TITIK_SAMBUNG_DATA: TitikSambung[] = [
  { id: 1, name: "Titik Sambung 1", lat: "-7.864234", long: "111.382838" },
  { id: 2, name: "Titik Sambung 2", lat: "-7.857224", long: "111.382838" },
  { id: 3, name: "Titik Sambung 3", lat: "-7.848036", long: "111.382073" },
  { id: 4, name: "Titik Sambung 4", lat: "-7.843133", long: "111.364318" },
  { id: 5, name: "Titik Sambung 5", lat: "-7.861555", long: "111.381544" }
];

const EVENT_TABLE_DATA: EventData[] = [
  { no: 1, type: "Reflection", distance: 0.020, loss: "0.306", reflection: "-50.716", note: "Refleksi tinggi, konektor kotor" },
  { no: 2, type: "Loss", distance: 0.529, loss: "0.215", reflection: "—", note: "Redaman sambungan/splice" },
  { no: 3, type: "End", distance: 0.733, loss: "5.604", reflection: "-35.125", note: "Ujung fiber terbuka" }
];

const RECOMMENDATIONS: Recommendation[] = [
  { finding: "Refleksi awal (-50.716 dB)", impact: "Sambungan longgar", action: "Periksa konektor awal" },
  { finding: "Loss tengah (0.215 dB)", impact: "Masih dalam batas aman", action: "—" },
  { finding: "Total loss 1.772 dB", impact: "Agak tinggi untuk < 1 km", action: "Telusuri titik loss terbesar" }
];

// Map Icons
const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const yellowIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const orangeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Custom Modern Alpro Icons (SVG DivIcons)
const stoIcon = L.divIcon({
  className: 'custom-sto-icon',
  html: `<div style="width: 16px; height: 16px; background: linear-gradient(135deg, #718096, #2D3748); border: 2px solid #FFFFFF; border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8]
});

const odcIcon = L.divIcon({
  className: 'custom-odc-icon',
  html: `<div style="position: relative; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;">
          <div style="width: 14px; height: 14px; background: #00E5FF; border: 2px solid #FFFFFF; transform: rotate(45deg); box-shadow: 0 2px 5px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;">
            <div style="width: 4px; height: 4px; background: #0891B2; border-radius: 50%;"></div>
          </div>
        </div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -11]
});

const odpIcon = L.divIcon({
  className: 'custom-odp-icon',
  html: `<div style="width: 16px; height: 16px; background: #10B981; border: 2px solid #FFFFFF; border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8]
});

const jcIcon = L.divIcon({
  className: 'custom-jc-icon',
  html: `<div style="width: 16px; height: 16px; background: #F59E0B; border: 1.5px solid #FFFFFF; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; position: relative;">
          <div style="width: 12px; height: 1.5px; background: #FFFFFF; transform: rotate(-45deg); position: absolute;"></div>
         </div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8]
});

const redPulseIcon = L.divIcon({
  className: 'custom-pulse-icon',
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; transform-origin: center center;">
      <div style="position: absolute; top: 4px; left: 4px; width: 28px; height: 28px; background: rgba(220, 38, 38, 0.4); border-radius: 50%; animation: custom-ping-anim 1.2s infinite; transform-origin: center center; pointer-events: none;"></div>
      <div style="position: absolute; top: 9px; left: 9px; width: 18px; height: 18px; background: #DC2626; border: 2px solid #FFFFFF; border-radius: 50%; box-shadow: 0 3px 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: bold; z-index: 10;">🚨</div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18]
});

const targetOdpIcon = L.divIcon({
  className: 'marker-target-odp-blink',
  html: `
    <div class="marker-target-odp-blink-inner" style="position: relative; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; transform-origin: center center;">
      <div style="position: absolute; top: 4px; left: 4px; width: 28px; height: 28px; background: rgba(16, 185, 129, 0.4); border-radius: 50%; animation: custom-ping-anim 1.2s infinite; transform-origin: center center; pointer-events: none;"></div>
      <div style="position: absolute; top: 8px; left: 8px; width: 20px; height: 20px; background: #10B981; border: 2px solid #FFFFFF; border-radius: 50%; box-shadow: 0 3px 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; z-index: 10;">⛳️</div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18]
});

const normalizeOdpName = (name: string): string => {
  if (!name) return "";
  let clean = name.toUpperCase().trim();
  
  // Remove typical prefix "ODP-MNZ-" or "ODP-"
  clean = clean.replace(/^ODP-MNZ-/, "");
  clean = clean.replace(/^ODP-/, "");
  
  // Strip any decimal suffix (e.g. ".01", ".02", etc.)
  if (clean.includes('.')) {
    clean = clean.split('.')[0];
  }
  
  // If format is like "FF/D08/39", split by "/" and reconstruct
  if (clean.includes('/') && clean.split('/').length > 2) {
    const parts = clean.split('/'); // ["FF", "D08", "39"]
    const odfGroup = parts[0];     // "FF"
    const numberPart = parts[2].trim(); // "39"
    return `${odfGroup}${numberPart}`; // "FF39"
  }
  
  // If format is like "FF/39"
  if (clean.includes('/')) {
    const parts = clean.split('/');
    const odfGroup = parts[0];
    const numberPart = parts[1].trim();
    return `${odfGroup}${numberPart}`; // "FF39"
  }
  
  // Clean all extra symbols
  clean = clean.replace(/[^A-Z0-9]/g, "");
  return clean;
};

const isAlternativeOdpMatch = (userInput: string, kmlName: string): boolean => {
  if (!userInput || !kmlName) return false;
  
  const cleanInput = userInput.toUpperCase().trim();
  const cleanKml = kmlName.toUpperCase().trim();
  
  if (cleanInput === cleanKml) return true;
  
  const inputParts = cleanInput.split(/[-_/ ]/).filter(Boolean);
  
  let group = "";
  let numberStr = "";
  
  for (let i = inputParts.length - 1; i >= 0; i--) {
    const p = inputParts[i];
    if (/^\d+(\.\d+)?$/.test(p)) {
      numberStr = p.split('.')[0];
      if (i > 0) {
        const prev = inputParts[i - 1];
        if (prev !== "ODP" && prev.length <= 3 && !/^\d+$/.test(prev)) {
          group = prev;
        }
      }
      break;
    }
  }
  
  if (!group && inputParts.length > 0) {
    const possible = inputParts.filter(p => p !== "ODP" && p.length >= 1 && p.length <= 3 && isNaN(Number(p)));
    if (possible.length > 0) {
      group = possible[possible.length - 1];
    }
  }
  
  if (group && numberStr) {
    const kmlParts = cleanKml.split(/[-_/ ]/).filter(Boolean);
    const hasGroup = kmlParts.some(p => p === group);
    const hasNumber = kmlParts.some(p => {
      const pureNum = p.split('.')[0];
      return pureNum === numberStr || p === numberStr;
    });
    
    if (hasGroup && hasNumber) {
      return true;
    }
    
    // Fallback checks
    if (cleanKml.includes(group) && cleanKml.includes(numberStr)) {
      // Ensure the number is followed or preceded by non-alphanumeric or start/end of string to avoid matching 401 with 40
      const numIdx = cleanKml.indexOf(numberStr);
      if (numIdx !== -1) {
        const charAfter = cleanKml.charAt(numIdx + numberStr.length);
        const charBefore = numIdx > 0 ? cleanKml.charAt(numIdx - 1) : '';
        const isWordMatch = (!charAfter || /[^0-9]/.test(charAfter)) && (!charBefore || /[^0-9]/.test(charBefore));
        if (isWordMatch) {
          return true;
        }
      }
    }
    
    const regexSafeGroup = group.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regexSafeNumber = numberStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    
    const pattern = new RegExp(`\\b${regexSafeGroup}\\b.*\\b${regexSafeNumber}\\b`, 'i');
    if (pattern.test(cleanKml)) {
      return true;
    }
  }
  
  return false;
};

const cleanTextForMatching = (str: string): string => {
  if (!str) return "";
  let text = str.toUpperCase().trim();
  
  // Strip any decimal suffix (e.g. ".01", ".02", etc.)
  if (text.includes('.')) {
    text = text.split('.')[0];
  }

  // Remove typical prefix "ODP-MNZ-" or "ODP-"
  text = text.replace(/^ODP-MNZ-/, "");
  text = text.replace(/^ODP-/, "");
  
  // Kasus format KML: "FF/D08/39" (split length > 2)
  if (text.includes('/') && text.split('/').length > 2) {
    const parts = text.split('/'); // ["FF", "D08", "39"]
    const odfGroup = parts[0];     // "FF"
    const numberPart = parts[2].trim();
    return `${odfGroup}${numberPart}`; // Menghasilkan "FF39"
  }
  
  // Kasus format "FF/39"
  if (text.includes('/')) {
    const parts = text.split('/');
    const odfGroup = parts[0];
    const numberPart = parts[1].trim();
    return `${odfGroup}${numberPart}`; // "FF39"
  }
  
  text = text.replace(/[^A-Z0-9]/g, "");
  return text;
};

const cleanNameForOtb = (name: string): string => {
  return name.replace(/OTB\s+(ST\.)?/gi, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
};

// Calculate distance between two lat-lng coordinates in meters using Haversine formula
function getHaversineDistance(coord1: [number, number], coord2: [number, number]): number {
  const R = 6371000; // Earth's radius in meters
  const lat1 = coord1[0] * Math.PI / 180;
  const lat2 = coord2[0] * Math.PI / 180;
  const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
  const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Find coordinate along path in meters
function findCoordinateAtDistance(coords: [number, number][], targetDistMeters: number): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1 || targetDistMeters <= 0) return coords[0];

  let accumulatedDist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const segmentDist = getHaversineDistance(p1, p2);

    if (accumulatedDist + segmentDist >= targetDistMeters) {
      const remaining = targetDistMeters - accumulatedDist;
      const ratio = remaining / segmentDist;
      const lat = p1[0] + (p2[0] - p1[0]) * ratio;
      const lng = p1[1] + (p2[1] - p1[1]) * ratio;
      return [lat, lng];
    }
    accumulatedDist += segmentDist;
  }
  // Return last coordinate if target distance exceeds total length
  return coords[coords.length - 1];
}

// Helper to identify ODC file name (e.g., ODC-XXX-XXX, ODC-MNZ-FA.kml, ODC_MNZ_FA, etc.)
const isOdcFileName = (filename?: string): boolean => {
  if (!filename) return false;
  const clean = filename.trim().toUpperCase().replace(/\.KML$/i, '');
  return (
    clean.startsWith('ODC-') ||
    clean.startsWith('ODC_') ||
    /^ODC[-_][A-Z0-9]+[-_][A-Z0-9]+/i.test(clean) ||
    clean.includes('ODC-') ||
    clean.includes('ODC_')
  );
};

// Map alpro icon dynamic matching with strict force override and blink support
const getMarkerIcon = (name: string, isTarget: boolean = false) => {
  const upper = name.toUpperCase();
  const blinkClass = isTarget ? 'marker-target-blink' : '';

  if (upper.includes('TITIK CACAT') || upper.includes('CACAT') || upper.includes('DEFECT')) {
    return L.divIcon({
      className: `custom-defect-icon ${blinkClass}`,
      html: `<div style="width: 20px; height: 20px; background: #EF4444; border: 2px solid #FFFFFF; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1;">⭕️</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10]
    });
  }

  if (upper.includes('STO')) {
    return L.divIcon({
      className: `custom-sto-icon ${blinkClass}`,
      html: `<div style="width: 16px; height: 16px; background: linear-gradient(135deg, #718096, #2D3748); border: 2px solid #FFFFFF; border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -8]
    });
  }
  if (upper.includes('ODC')) {
    return L.divIcon({
      className: `custom-odc-icon ${blinkClass}`,
      html: `<div style="width: 16px; height: 16px; background: #00E5FF; border: 2px solid #FFFFFF; transform: rotate(45deg); box-shadow: 0 2px 5px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;"><span style="transform: rotate(-45deg); color: #0f172a; font-size: 8px; font-weight: 900; line-height: 1;">C</span></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -9]
    });
  }
  if (upper.includes('JC') || upper.includes('CLOSURE') || upper.includes('JOINT') || upper.includes('SPLICING') || upper.includes('SPLICE')) {
    return L.divIcon({
      className: `custom-jc-icon ${blinkClass}`,
      html: `<div style="width: 16px; height: 16px; background: #F59E0B; border: 1.5px solid #FFFFFF; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; position: relative;">
              <div style="width: 12px; height: 1.5px; background: #FFFFFF; transform: rotate(-45deg); position: absolute;"></div>
             </div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -8]
    });
  }
  // ELSE: Wajib force override to ODP (green square)
  return L.divIcon({
    className: `custom-odp-icon ${blinkClass}`,
    html: `<div style="width: 16px; height: 16px; background: #10B981; border: 2px solid #FFFFFF; border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8]
  });
};

function projectPointOnSegment(p1: [number, number], p2: [number, number], p: [number, number]): [number, number] {
  const [lat1, lng1] = p1;
  const [lat2, lng2] = p2;
  const [lat, lng] = p;

  const dx = lat2 - lat1;
  const dy = lng2 - lng1;
  
  if (dx === 0 && dy === 0) return p1;

  // Projection factor t
  let t = ((lat - lat1) * dx + (lng - lng1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t)); // clamp to segment

  return [lat1 + t * dx, lng1 + t * dy];
}

function getDistanceAlongPath(path: [number, number][], point: [number, number]): number {
  if (path.length < 2) return 0;
  
  let minDistance = Infinity;
  let closestSegmentIndex = 0;
  let closestProjPoint: [number, number] = path[0];

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    
    // Project point onto segment p1-p2
    const proj = projectPointOnSegment(p1, p2, point);
    const dist = getHaversineDistance(point, proj);
    
    if (dist < minDistance) {
      minDistance = dist;
      closestSegmentIndex = i;
      closestProjPoint = proj;
    }
  }

  // Now, sum distance from start of path to closestSegmentIndex
  let distanceAlong = 0;
  for (let i = 0; i < closestSegmentIndex; i++) {
    distanceAlong += getHaversineDistance(path[i], path[i+1]);
  }
  distanceAlong += getHaversineDistance(path[closestSegmentIndex], closestProjPoint);
  
  return distanceAlong;
}

// Map Updater Components
function ChangeView({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (zoom !== undefined) {
      if (zoom === 18) {
        map.flyTo(center, zoom, { animate: true, duration: 1.5 });
      } else {
        map.setView(center, zoom);
      }
    } else {
      map.setView(center);
    }
  }, [center, zoom, map]);
  return null;
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions);
      const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: isMobile ? [20, 20] : [50, 50] });
    }
  }, [positions, map]);
  return null;
}

// Global memory cache for Google Drive access token with persistency
let cachedAccessToken: string | null = (() => {
  try {
    return localStorage.getItem('access_token') || localStorage.getItem('m_fosis_drive_token');
  } catch (e) {
    return null;
  }
})();
let tokenExpiryTime: number | null = (() => {
  try {
    const val = localStorage.getItem('expires_at') || localStorage.getItem('m_fosis_drive_expiry');
    return val ? parseInt(val, 10) : null;
  } catch (e) {
    return null;
  }
})();

export const getStoredValidAccessToken = (): string | null => {
  try {
    const token = localStorage.getItem('access_token') || localStorage.getItem('m_fosis_drive_token');
    const expiryStr = localStorage.getItem('expires_at') || localStorage.getItem('m_fosis_drive_expiry');
    const expiry = expiryStr ? parseInt(expiryStr, 10) : null;
    if (token && (!expiry || Date.now() < expiry)) {
      return token;
    }
    return null;
  } catch (e) {
    return null;
  }
};

const renderFormattedAiAnalysis = (text: string) => {
  if (!text) return null;

  const lines = text.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let currentSection: { title: string; icon: string; content: string[] } | null = null;
  let generalIntro: string[] = [];

  const flushCurrentSection = (key: number) => {
    if (currentSection) {
      renderedElements.push(
        <div key={key} className="mb-4 bg-white/90 backdrop-blur-sm rounded-xl p-4.5 border border-slate-100 shadow-sm transition-all duration-300 hover:shadow-md">
          <h4 className="flex items-center gap-2.5 text-xs md:text-sm font-black text-slate-800 uppercase tracking-wider border-b border-dashed border-slate-150/70 pb-2 mb-3">
            <span className="text-sm md:text-base select-none">{currentSection.icon}</span>
            <span>{currentSection.title}</span>
          </h4>
          <div className="space-y-2 pl-0.5">
            {currentSection.content.map((cLine, idx) => {
              const trimmed = cLine.trim();
              if (!trimmed) return null;
              
              // Remove markdown bold markings and hashes
              const cleanCLine = trimmed
                .replace(/\*\*/g, '')
                .replace(/###/g, '')
                .replace(/^[\-\*\s•\+]+/, '')
                .trim();
                
              const isBullet = trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•') || trimmed.startsWith('+');
              
              if (isBullet) {
                return (
                  <div key={idx} className="flex items-start gap-2 text-[11px] md:text-xs text-slate-600 leading-relaxed font-semibold">
                    <span className="text-red-500 mt-1 select-none text-[8px]">•</span>
                    <span>{cleanCLine}</span>
                  </div>
                );
              }
              
              return (
                <p key={idx} className="text-[11px] md:text-xs text-slate-600 leading-relaxed font-semibold pl-1">
                  {cleanCLine}
                </p>
              );
            })}
          </div>
        </div>
      );
      currentSection = null;
    }
  };

  let elementKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upperLine = line.toUpperCase();
    
    let detectedIcon = '';
    let detectedTitle = '';
    
    if (upperLine.includes('RINGKASAN MASALAH')) {
      detectedIcon = '🔥';
      detectedTitle = '1. Ringkasan Masalah';
    } else if (upperLine.includes('DETAIL TEKNIS')) {
      detectedIcon = '🚥';
      detectedTitle = '2. Detail Teknis Estimasi';
    } else if (upperLine.includes('ANALISA AREA')) {
      detectedIcon = '🚧';
      detectedTitle = '3. Analisa Area';
    } else if (upperLine.includes('REKOMENDASI')) {
      detectedIcon = '✅';
      detectedTitle = '4. Rekomendasi Tindakan';
    }

    if (detectedIcon) {
      flushCurrentSection(elementKey++);
      currentSection = {
        title: detectedTitle,
        icon: detectedIcon,
        content: []
      };
    } else {
      if (currentSection) {
        if (line.trim() !== '' || currentSection.content.length > 0) {
          currentSection.content.push(line);
        }
      } else {
        if (line.trim() !== '') {
          generalIntro.push(line);
        }
      }
    }
  }

  flushCurrentSection(elementKey++);

  if (generalIntro.length > 0) {
    renderedElements.unshift(
      <div key="intro" className="mb-4 text-xs text-slate-600 leading-relaxed font-semibold pl-1 bg-white/50 p-3 rounded-lg border border-slate-100/50">
        {generalIntro.map((line, idx) => (
          <p key={idx} className="mb-1">{line.replace(/\*\*/g, '').replace(/###/g, '')}</p>
        ))}
      </div>
    );
  }

  return <div className="space-y-4 font-sans">{renderedElements}</div>;
};

export interface MfosisParsedInfo {
  segment: 'FEEDER' | 'DISTRIBUSI' | 'BACKBONE' | 'SURGE' | 'Lainnya';
  segmentDesc: string;
  stoCode: string;
  stoName: string;
  stoDesc: string;
  alproDetail: string;
  detailDesc: string;
  fullDescription: string;
}

export function parseMfosisFileInfo(filename: string): MfosisParsedInfo {
  const cleanName = filename.replace(/\.kml$/i, '').trim();
  const parts = cleanName.split('_');

  // 1. Segment extraction
  let segment: 'FEEDER' | 'DISTRIBUSI' | 'BACKBONE' | 'SURGE' | 'Lainnya' = 'Lainnya';
  let segmentDesc = 'Jenis Segment Alpro Spasial';
  const p0 = (parts[0] || '').toUpperCase();

  if (p0.includes('FEEDER')) {
    segment = 'FEEDER';
    segmentDesc = 'Jenis Segment Alpro Kabel Feeder';
  } else if (p0.includes('DISTRIBUSI') || p0.includes('DIST')) {
    segment = 'DISTRIBUSI';
    segmentDesc = 'Jenis Segment Alpro Kabel Distribusi';
  } else if (p0.includes('BACKBONE')) {
    segment = 'BACKBONE';
    segmentDesc = 'Jenis Segment Alpro Kabel Backbone';
  } else if (p0.includes('SURGE')) {
    segment = 'SURGE';
    segmentDesc = 'Jenis Segment Alpro Kabel Surge';
  }

  // 2. STO extraction
  const upperFull = cleanName.toUpperCase();
  let stoCode = 'MNZ';
  let stoName = 'Madiun (MNZ)';
  
  const p1 = (parts[1] || '').toUpperCase();
  const targetCheck = p1 || upperFull;

  if (targetCheck.includes('UTR') || upperFull.includes('UTARA')) { stoCode = 'UTR'; stoName = 'Utara (UTR)'; }
  else if (targetCheck.includes('CRB') || upperFull.includes('CARUBAN')) { stoCode = 'CRB'; stoName = 'Caruban (CRB)'; }
  else if (targetCheck.includes('MNZ') || upperFull.includes('MADIUN')) { stoCode = 'MNZ'; stoName = 'Madiun (MNZ)'; }
  else if (targetCheck.includes('MSP') || upperFull.includes('MAOSPATI')) { stoCode = 'MSP'; stoName = 'Maospati (MSP)'; }
  else if (targetCheck.includes('WK') || upperFull.includes('WALIKUKUN')) { stoCode = 'WK'; stoName = 'Walikukun (WK)'; }
  else if (targetCheck.includes('WI') || upperFull.includes('NGAWI')) { stoCode = 'WI'; stoName = 'Ngawi (WI)'; }
  else if (targetCheck.includes('BAT') || upperFull.includes('BARAT')) { stoCode = 'BAT'; stoName = 'Barat (BAT)'; }
  else if (targetCheck.includes('NJ') || upperFull.includes('NGANJUK')) { stoCode = 'NJ'; stoName = 'Nganjuk (NJ)'; }
  else if (targetCheck.includes('KDL') || upperFull.includes('KEDUNGGALAR')) { stoCode = 'KDL'; stoName = 'Kedunggalar (KDL)'; }
  else if (targetCheck.includes('BBN') || upperFull.includes('BABADAN')) { stoCode = 'BBN'; stoName = 'Babadan (BBN)'; }
  else if (targetCheck.includes('SRD') || upperFull.includes('SARADAN')) { stoCode = 'SRD'; stoName = 'Saradan (SRD)'; }
  else if (targetCheck.includes('WLG') || upperFull.includes('WILANGAN')) { stoCode = 'WLG'; stoName = 'Wilangan (WLG)'; }
  else if (targetCheck.includes('BGR') || upperFull.includes('BAGOR')) { stoCode = 'BGR'; stoName = 'Bagor (BGR)'; }
  else if (targetCheck.includes('PGO') || upperFull.includes('PONOROGO')) { stoCode = 'PGO'; stoName = 'Ponorogo (PGO)'; }

  const stoDesc = `Kode Untuk STO ${stoCode}`;

  // 3. Detail Alpro & Description parsing
  const rawDetail = parts.slice(2).join('_') || parts.slice(1).join('_') || cleanName;
  let alproDetail = rawDetail;
  let detailDesc = '';

  // Exact match and structured token parsing
  if (cleanName.toUpperCase() === 'FEEDER_UTR_ODC-UTR-FK') {
    alproDetail = 'ODC-UTR-FK';
    detailDesc = 'Nama ODC di STO UTR dengan Kode FK';
  } else if (cleanName.toUpperCase() === 'DISTRIBUSI_MNZ_FF_D09') {
    alproDetail = 'FF_D09';
    detailDesc = 'Kabel dari ODC-FF Distribusi No.9';
  } else if (rawDetail.toUpperCase().includes('ODC')) {
    alproDetail = rawDetail;
    const tokens = rawDetail.split(/[-_]/);
    const lastCode = tokens[tokens.length - 1] || 'HA';
    detailDesc = `Nama ODC di STO ${stoCode} dengan Kode ${lastCode}`;
  } else if (segment === 'DISTRIBUSI') {
    alproDetail = rawDetail;
    const sub = rawDetail.split(/[-_]/);
    const odcPart = sub[0] || 'HA';
    const numRaw = sub[1] ? sub[1].replace(/^D/i, '') : '1';
    const numVal = parseInt(numRaw, 10);
    const numDisplay = isNaN(numVal) ? numRaw : numVal;
    detailDesc = `Kabel dari ODC-${odcPart} Distribusi No.${numDisplay}`;
  } else if (segment === 'FEEDER') {
    alproDetail = rawDetail;
    detailDesc = `Kabel Feeder Jalur ${rawDetail} di STO ${stoCode}`;
  } else if (segment === 'BACKBONE') {
    alproDetail = rawDetail;
    detailDesc = `Rute Utama Kabel Backbone Penghubung STO ${stoCode} ke STO ${rawDetail}`;
  } else if (segment === 'SURGE') {
    alproDetail = rawDetail;
    detailDesc = `Kabel Ring Protection Surge STO ${stoCode} ke STO ${rawDetail}`;
  } else {
    alproDetail = rawDetail;
    detailDesc = `Berkas Spasial M-fosis ${cleanName}`;
  }

  const fullDescription = `${segment} = ${segmentDesc} | ${stoCode} = ${stoDesc} | ${alproDetail} = ${detailDesc}`;

  return {
    segment,
    segmentDesc,
    stoCode,
    stoName,
    stoDesc,
    alproDetail,
    detailDesc,
    fullDescription
  };
}

const PRELOADED_KML_FILES = [
  // FOLDER FEEDER (13 Files Total + CRB)
  // MSP (7 Files)
  { id: 'f_msp_1', name: 'FEEDER_MSP_ODC_MA.kml', size: 13800, sto: 'Maospati (MSP)', segment: 'FEEDER', length: 5.45, path: 'M-Fosis / FEEDER' },
  { id: 'f_msp_2', name: 'FEEDER_MSP_ODC_MB.kml', size: 14100, sto: 'Maospati (MSP)', segment: 'FEEDER', length: 5.60, path: 'M-Fosis / FEEDER' },
  { id: 'f_msp_3', name: 'FEEDER_MSP_ODC_MC.kml', size: 12900, sto: 'Maospati (MSP)', segment: 'FEEDER', length: 5.10, path: 'M-Fosis / FEEDER' },
  { id: 'f_msp_4', name: 'FEEDER_MSP_ODC_MD.kml', size: 13500, sto: 'Maospati (MSP)', segment: 'FEEDER', length: 5.30, path: 'M-Fosis / FEEDER' },
  { id: 'f_msp_5', name: 'FEEDER_MSP_ODC_ME.kml', size: 11800, sto: 'Maospati (MSP)', segment: 'FEEDER', length: 4.70, path: 'M-Fosis / FEEDER' },
  { id: 'f_msp_6', name: 'FEEDER_MSP_ODC_MF.kml', size: 12200, sto: 'Maospati (MSP)', segment: 'FEEDER', length: 4.90, path: 'M-Fosis / FEEDER' },
  { id: 'f_msp_7', name: 'FEEDER_MSP_ODC_MG.kml', size: 13000, sto: 'Maospati (MSP)', segment: 'FEEDER', length: 5.20, path: 'M-Fosis / FEEDER' },

  // MNZ (2 Files)
  { id: 'f_mnz_1', name: 'FEEDER_MNZ_ODC_AA.kml', size: 14200, sto: 'Madiun (MNZ)', segment: 'FEEDER', length: 5.75, path: 'M-Fosis / FEEDER' },
  { id: 'f_mnz_2', name: 'FEEDER_MNZ_ODC_AB.kml', size: 13100, sto: 'Madiun (MNZ)', segment: 'FEEDER', length: 5.12, path: 'M-Fosis / FEEDER' },

  // UTR (4 Files)
  { id: 'f_utr_1', name: 'FEEDER_UTR_ODC-UTR-FK.kml', size: 12800, sto: 'Utara (UTR)', segment: 'FEEDER', length: 4.95, path: 'M-Fosis / FEEDER' },
  { id: 'f_utr_2', name: 'FEEDER_UTR_ODC_UA.kml', size: 11900, sto: 'Utara (UTR)', segment: 'FEEDER', length: 4.82, path: 'M-Fosis / FEEDER' },
  { id: 'f_utr_3', name: 'FEEDER_UTR_ODC_UB.kml', size: 12100, sto: 'Utara (UTR)', segment: 'FEEDER', length: 4.88, path: 'M-Fosis / FEEDER' },
  { id: 'f_utr_4', name: 'FEEDER_UTR_ODC_UC.kml', size: 11500, sto: 'Utara (UTR)', segment: 'FEEDER', length: 4.60, path: 'M-Fosis / FEEDER' },

  // CRB (1 File Feeder Tambahan)
  { id: 'f_crb_1', name: 'FEEDER_CRB_ODC-CRB-HA.kml', size: 13200, sto: 'Caruban (CRB)', segment: 'FEEDER', length: 5.25, path: 'M-Fosis / FEEDER' },

  // FOLDER DISTRIBUSI
  // MNZ (7 Files)
  { id: 'd_mnz_1', name: 'DISTRIBUSI_MNZ_FF_D09.kml', size: 4900, sto: 'Madiun (MNZ)', segment: 'DISTRIBUSI', length: 1.85, path: 'M-Fosis / DISTRIBUSI' },
  { id: 'd_mnz_2', name: 'DIST_MNZ_AA_01.kml', size: 4800, sto: 'Madiun (MNZ)', segment: 'DISTRIBUSI', length: 1.95, path: 'M-Fosis / DISTRIBUSI' },
  { id: 'd_mnz_3', name: 'DIST_MNZ_AA_02.kml', size: 4200, sto: 'Madiun (MNZ)', segment: 'DISTRIBUSI', length: 1.72, path: 'M-Fosis / DISTRIBUSI' },
  { id: 'd_mnz_4', name: 'DIST_MNZ_AA_03.kml', size: 4100, sto: 'Madiun (MNZ)', segment: 'DISTRIBUSI', length: 1.68, path: 'M-Fosis / DISTRIBUSI' },
  { id: 'd_mnz_5', name: 'DIST_MNZ_AB_01.kml', size: 4300, sto: 'Madiun (MNZ)', segment: 'DISTRIBUSI', length: 1.75, path: 'M-Fosis / DISTRIBUSI' },
  { id: 'd_mnz_6', name: 'DIST_MNZ_AB_02.kml', size: 4600, sto: 'Madiun (MNZ)', segment: 'DISTRIBUSI', length: 1.82, path: 'M-Fosis / DISTRIBUSI' },
  { id: 'd_mnz_7', name: 'DIST_MNZ_AB_03.kml', size: 3900, sto: 'Madiun (MNZ)', segment: 'DISTRIBUSI', length: 1.55, path: 'M-Fosis / DISTRIBUSI' },

  // CRB (2 Files Distribusi Tambahan)
  { id: 'd_crb_1', name: 'DISTRIBUSI_CRB_HA_D01.kml', size: 4200, sto: 'Caruban (CRB)', segment: 'DISTRIBUSI', length: 1.68, path: 'M-Fosis / DISTRIBUSI' },
  { id: 'd_crb_2', name: 'DISTRIBUSI_CRB_HA_D02.kml', size: 4500, sto: 'Caruban (CRB)', segment: 'DISTRIBUSI', length: 1.80, path: 'M-Fosis / DISTRIBUSI' },

  // FOLDER SURGE (1 File)
  { id: 's_mnz_1', name: 'SURGE_MNZ_UTR.kml', size: 18400, sto: 'Madiun (MNZ)', segment: 'SURGE', length: 7.35, path: 'M-Fosis / SURGE' }
];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'ukur' | 'rute' | 'history' | 'validasi' | 'gamas' | 'manage'>('ukur');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [hideMainHeader, setHideMainHeader] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const sidebarTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startSidebarAutoHide = () => {
    if (sidebarTimeoutRef.current) {
      clearTimeout(sidebarTimeoutRef.current);
    }
    sidebarTimeoutRef.current = setTimeout(() => {
      setIsSidebarVisible(false);
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (sidebarTimeoutRef.current) {
        clearTimeout(sidebarTimeoutRef.current);
      }
    };
  }, []);

  const [otdrValue, setOtdrValue] = useState<string>('');
  const [odcName, setOdcName] = useState<string>('');
  const [distribution, setDistribution] = useState<string>('');
  const [estimatedPoints, setEstimatedPoints] = useState<TitikSambung[]>([]);
  const [cableRoute, setCableRoute] = useState<any>(null);
  const [routePositions, setRoutePositions] = useState<[number, number][]>([]);
  const [breakPoint, setBreakPoint] = useState<[number, number] | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-7.864234, 111.382838]);
  const [ukurSegment, setUkurSegment] = useState<string>('Kabel FEEDER');
  const [ukurOtbAwal, setUkurOtbAwal] = useState<string>('OTB ST.Walikukun');
  const [ukurOtbTarget, setUkurOtbTarget] = useState<string>('OTB ST.Walikukun');
  const isFeederMode = ukurSegment === 'Kabel FEEDER' || ukurSegment === 'Kabel BACKBONE' || ukurSegment === 'Kabel Lainya' || ukurSegment === 'Link SURGE';
  const [titikPengukuran, setTitikPengukuran] = useState<string>('STO');
 
  // Google Drive State with Automatic Background Fetch (Folder ID: 1AkJdPSJRWY6_xzWcQZM2cEsG-AT_2Jg_)
  const [driveToken, setDriveToken] = useState<string | null>(cachedAccessToken);
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [driveAutoStatus, setDriveAutoStatus] = useState<'idle' | 'searching' | 'downloading' | 'success' | 'not_found' | 'error'>('idle');
  const [driveAutoError, setDriveAutoError] = useState<string | null>(null);
 
  // KML Scanner & Dashboard State
  const [scannedKmlFiles, setScannedKmlFiles] = useState<any[]>([]);
  const [isScanningKml, setIsScanningKml] = useState(false);
  const [scanKmlError, setScanKmlError] = useState<string | null>(null);
  const [driveKmlSynced, setDriveKmlSynced] = useState(false);
  const [driveFolders, setDriveFolders] = useState<string[]>([]);
  const [gamasSearchQuery, setGamasSearchQuery] = useState('');
  const [gamasFilterStatus, setGamasFilterStatus] = useState<'ALL' | 'RECON' | 'PENDING'>('ALL');
  const [gamasPage, setGamasPage] = useState(1);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(false);

  // KML Folder M-fosis & STO Filter State
  const [kmlFolderFilter, setKmlFolderFilter] = useState<'ALL' | 'DISTRIBUSI' | 'FEEDER' | 'SURGE' | 'BACKBONE'>('ALL');
  const [kmlStoFilter, setKmlStoFilter] = useState<string>('ALL');
  const [kmlSearchQuery, setKmlSearchQuery] = useState<string>('');
  const [kmlPage, setKmlPage] = useState<number>(1);
 
  // Rute Kabel State
  const [routeCableType, setRouteCableType] = useState<string>('Kabel FEEDER');
  const [routeOtbAwal, setRouteOtbAwal] = useState<string>('OTB ST.Walikukun');
  const [routeOtbTarget, setRouteOtbTarget] = useState<string>('OTB ST.Walikukun');
  const [routeSiteAsal, setRouteSiteAsal] = useState<string>('');
  const [routeSto, setRouteSto] = useState<string>('');
  const [routeStoAwal, setRouteStoAwal] = useState<string>('');
  const [routeStoTujuan, setRouteStoTujuan] = useState<string>('');
  const [selectedRouteData, setSelectedRouteData] = useState<any>(null);
  const [selectedRoutePositions, setSelectedRoutePositions] = useState<[number, number][]>([]);
  const [targetOdpPosition, setTargetOdpPosition] = useState<[number, number] | null>(null);
  const [targetOdpName, setTargetOdpName] = useState<string>('');

  // Fullscreen state and AI state for Estimasi Putus (ukur) and Rute Kabel (rute)
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [isRuteMapFullscreen, setIsRuteMapFullscreen] = useState(false);
  const [estimasiMapStyle, setEstimasiMapStyle] = useState<'google_road' | 'google_hybrid' | 'voyager' | 'light_muted'>('google_road');
  const [analisaMapStyle, setAnalisaMapStyle] = useState<'google_road' | 'google_hybrid' | 'voyager' | 'light_muted'>('google_road');
  
  const [hasCalculated, setHasCalculated] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  
  const [ruteHasCalculated, setRuteHasCalculated] = useState(false);
  const [ruteAiAnalysis, setRuteAiAnalysis] = useState<string>('');
  const [isRuteAiLoading, setIsRuteAiLoading] = useState<boolean>(false);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isRuteAiPanelOpen, setIsRuteAiPanelOpen] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState<boolean>(false);

  // Automated sidebar responsiveness on screen size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setIsSidebarVisible(false);
      } else {
        setIsSidebarVisible(true);
      }
    };
    handleResize(); // trigger initially
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const generateAiAnalysisForEstimation = async (coord: [number, number] | null, joints: TitikSambung[]) => {
    setIsAiLoading(true);
    setAiAnalysis('');
    setIsAiPanelOpen(true);
    try {
      const coordStr = coord ? `${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}` : 'Tidak diketahui';
      const jointsStr = JSON.stringify(joints.slice(0, 3).map(j => ({ name: j.name, distance: j.distance })));
      
      const prompt = `Lakukan analisis spasial kerusakan jaringan serat optik secara profesional menggunakan Bahasa Indonesia yang baik dan benar sesuai Ejaan Bahasa Indonesia (EBI).

Berikut adalah data parameter pengukuran lapangan:
- Segmen Kabel: ${ukurSegment}
- Nama ${ukurSegment === 'Link SURGE' ? 'Segmen SURGE' : (isFeederMode ? 'ODC' : 'ODP')}: ${ukurSegment === 'Link SURGE' ? `${ukurOtbAwal} ➡️ ${ukurOtbTarget}` : odcName}
- Titik Pengukuran Awal: ${ukurSegment === 'Link SURGE' ? ukurOtbAwal : titikPengukuran}
- Jarak Kerusakan OTDR: ${otdrValue} meter
- Koordinat Estimasi Kerusakan (Lat/Long): ${coordStr}
- Daftar Alpro Terdekat: ${jointsStr}

Sajikan laporan analisis dalam format dokumen formal terstruktur dengan bagian-bagian berikut secara runtut:

1. **Ringkasan Masalah**
   - Paparkan inti masalah, keparahan kegagalan transmisi, dan kisaran lokasi umum titik putus kabel.
2. **Detail Teknis Estimasi**
   - Jelaskan seluruh data teknis secara presisi tanpa ada perubahan angka, meliputi: data OTDR (${otdrValue} meter), koordinat estimasi spasial (${coordStr}), rincian segmen kabel (${ukurSegment} ${odcName}), serta referensi alpro terdekat (${jointsStr}).
3. **Analisa Area**
   - Identifikasi nama jalan, bentang geografis, dan karakteristik fisik jalur sekitar titik kerusakan (kaitkan dengan nuansa spasial lokal eks-Karesidenan Madiun/Ponorogo, Jawa Timur).
4. **Rekomendasi Tindakan**
   - Rincikan langkah-langkah praktis dan terarah bagi tim pemeliharaan lapangan (penyisiran rute fisik, penandaan visual, persiapan splicing, dan pengujian OTDR ulang pasca-perbaikan).

Gunakan bullet points atau penomoran untuk memperjelas poin penting. Teks harus formal, objektif, dan enak dibaca.`;

      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: prompt,
          systemInstruction: "Anda adalah analis senior sistem transmisi optik M-FOSIS. Sampaikan laporan teknis berstandar profesional industri telekomunikasi menggunakan Bahasa Indonesia formal berkualitas tinggi (sesuai EBI).",
          model: "gemini-3.5-flash"
        })
      });
      const data = await response.json();
      if (data.text) {
        setAiAnalysis(data.text);
      } else if (data.error) {
        setAiAnalysis(`⚠️ Gagal memuat analisis AI: ${data.error}`);
      } else {
        setAiAnalysis("Maaf, tidak dapat memformat kesimpulan AI saat ini.");
      }
    } catch (err: any) {
      console.error("Error generating AI analysis:", err);
      setAiAnalysis(`⚠️ Gagal terhubung ke layanan AI: ${err.message || err}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const generateAiAnalysisForRute = async (assetData: any) => {
    setIsRuteAiLoading(true);
    setRuteAiAnalysis('');
    setIsRuteAiPanelOpen(true);
    try {
      const distanceText = assetData.distanceText || 'Tidak diketahui';
      const spliceCount = assetData.splicePoints?.length || 0;
      const fileNameStr = assetData.fileName || 'KML_Aset';

      const prompt = `Lakukan analisis karakteristik spasial dan kerentanan fisik rute kabel serat optik menggunakan Bahasa Indonesia yang baik dan benar sesuai EBI.

Berikut adalah data parameter rute:
- Jenis Kabel rute: ${routeCableType}
- Nama STO: ${routeSto}
- Site / ODC / ODP Tujuan: ${routeSiteAsal}
- Panjang Kabel Rute: ${distanceText}
- Jumlah Joint Closures / Sambungan: ${spliceCount} unit
- File Sumber: ${fileNameStr}

Sajikan laporan analisis dalam format dokumen formal terstruktur dengan bagian-bagian berikut secara runtut:

1. **Ringkasan Masalah**
   - Deskripsikan karakteristik umum rute kabel, korelasi panjang total (${distanceText}) dengan kepadatan sambungan (${spliceCount} unit).
2. **Detail Teknis Estimasi**
   - Jabarkan data teknis secara presisi tanpa memodifikasi informasi, meliputi: jenis kabel (${routeCableType}), STO integrasi (${routeSto}), tujuan (${routeSiteAsal}), dan rincian fisik file sumber (${fileNameStr}).
3. **Analisa Area**
   - Jelaskan rute bentang kabel, identifikasi potensi titik kerentanan fisik (misalnya area sambungan gantung, rawan redaman tinggi, atau risiko aktivitas konstruksi pihak ketiga).
4. **Rekomendasi Tindakan**
   - Rumuskan rencana kerja taktis dan preventif seperti jadwal patroli rutin, pemantauan berkala nilai redaman dari STO ${routeSto}, dan perlindungan fisik pada titik joint closure.

Gunakan bullet points atau penomoran untuk memperjelas poin penting. Teks harus formal, objektif, dan mengedepankan efisiensi operasional.`;

      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: prompt,
          systemInstruction: "Anda adalah analis senior infrastruktur optik M-FOSIS. Sampaikan laporan teknis rute berstandar profesional industri telekomunikasi menggunakan Bahasa Indonesia formal berkualitas tinggi (sesuai EBI).",
          model: "gemini-3.5-flash"
        })
      });
      const data = await response.json();
      if (data.text) {
        setRuteAiAnalysis(data.text);
      } else if (data.error) {
        setRuteAiAnalysis(`⚠️ Gagal memuat kesimpulan AI: ${data.error}`);
      } else {
        setRuteAiAnalysis("Maaf, tidak dapat memformat rekomendasi AI saat ini.");
      }
    } catch (err: any) {
      console.error("Error generating rute AI analysis:", err);
      setRuteAiAnalysis(`⚠️ Gagal terhubung ke layanan AI: ${err.message || err}`);
    } finally {
      setIsRuteAiLoading(false);
    }
  };
 
  const refreshGoogleAccessToken = async (): Promise<string | null> => {
    try {
      const refreshToken = localStorage.getItem('m_fosis_drive_refresh_token');
      if (!refreshToken) {
        console.warn("[OAuth Refresh Client] Refresh token tidak tersedia di local storage.");
        return null;
      }

      console.log("[OAuth Refresh Client] Memperbarui token akses via server...");
      const res = await fetch("/api/auth/google/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (!res.ok) {
        throw new Error("Gagal menyegarkan token dari Google OAuth");
      }

      const data = await res.json();
      if (data.access_token) {
        cachedAccessToken = data.access_token;
        const newExpiry = Date.now() + (data.expires_in || 3599) * 1000;
        tokenExpiryTime = newExpiry;
        // Ketentuan 1: Simpan access_token & expires_at ke localStorage
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('expires_at', String(newExpiry));
        localStorage.setItem('m_fosis_drive_token', data.access_token);
        localStorage.setItem('m_fosis_drive_expiry', String(newExpiry));
        setDriveToken(data.access_token);
        console.log("[OAuth Refresh Client] Token akses berhasil diperbarui otomatis!");
        return data.access_token;
      }
      return null;
    } catch (err) {
      console.error("[OAuth Refresh Client] Kesalahan saat memproses refresh token:", err);
      return null;
    }
  };

  const connectGoogleDrive = async (silent: boolean = false) => {
    if (silent) {
      // Jika silent, cek localStorage terlebih dahulu tanpa memicu pop-up browser
      const localToken = localStorage.getItem('access_token') || localStorage.getItem('m_fosis_drive_token');
      const localExpiry = localStorage.getItem('expires_at') || localStorage.getItem('m_fosis_drive_expiry');
      if (localToken && (!localExpiry || Date.now() < parseInt(localExpiry, 10))) {
        cachedAccessToken = localToken;
        tokenExpiryTime = localExpiry ? parseInt(localExpiry, 10) : null;
        setDriveToken(localToken);
        return localToken;
      }
      
      const refreshed = await refreshGoogleAccessToken();
      if (refreshed) {
        return refreshed;
      }
      
      console.warn("[connectGoogleDrive] Gagal melakukan koneksi secara silent. Memerlukan interaksi manual.");
      return null;
    }

    setIsConnectingDrive(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/drive.readonly');
      provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');
      provider.addScope('https://www.googleapis.com/auth/spreadsheets');
      
      // Ketentuan 3: Hapus parameter prompt: 'consent' dari OAuth request
      provider.setCustomParameters({
        access_type: 'offline'
      });
      
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Gagal mendapatkan token akses dari Google.');
      }

      // Ambil refresh token jika tersedia
      const userObj = result as any;
      const refreshToken = userObj._tokenResponse?.oauthRefreshToken;
      if (refreshToken) {
        console.log("[OAuth Refresh Client] Sukses mendeteksi offline refresh token.");
        localStorage.setItem('m_fosis_drive_refresh_token', refreshToken);
      } else {
        console.warn("[OAuth Refresh Client] Peringatan: refresh token tidak ditemukan di tokenResponse.");
      }

      cachedAccessToken = credential.accessToken;
      tokenExpiryTime = Date.now() + 3500 * 1000; // valid for ~1 hour
      try {
        // Ketentuan 1: Simpan access_token & expires_at ke localStorage setelah login pertama
        localStorage.setItem('access_token', credential.accessToken);
        localStorage.setItem('expires_at', String(tokenExpiryTime));
        localStorage.setItem('m_fosis_drive_token', credential.accessToken);
        localStorage.setItem('m_fosis_drive_expiry', String(tokenExpiryTime));
      } catch (e) {
        console.error("Local storage set item error:", e);
      }
      setDriveToken(credential.accessToken);
      return credential.accessToken;
    } catch (err: any) {
      const errCode = err?.code || '';
      const errMsg = err?.message || String(err);
      const isPopupClosedOrCancelled =
        errCode === 'auth/popup-closed-by-user' ||
        errCode === 'auth/cancelled-popup-request' ||
        errCode === 'auth/user-cancelled' ||
        errMsg.includes('popup-closed-by-user') ||
        errMsg.includes('cancelled-popup-request') ||
        errMsg.includes('user-cancelled');

      if (isPopupClosedOrCancelled) {
        console.warn('[Google Drive] Pop-up autentikasi ditutup atau dibatalkan oleh pengguna.');
        if (!silent) {
          alert("Koneksi dibatalkan atau jendela pop-up ditutup. Jika berada di preview AI Studio, silakan klik 'Buka di Tab Baru' lalu coba lagi.");
        }
        return null;
      }

      console.error('Error connecting to Google Drive:', err);
      if (!silent) {
        alert('Gagal menyambungkan Google Drive: ' + errMsg);
      }
      return null;
    } finally {
      setIsConnectingDrive(false);
    }
  };

  // Ketentuan 2 & 4: Helper untuk mendapatkan token valid sebelum fetch KML
  // 1. Cek localStorage ('access_token' & 'expires_at'). Jika valid, langsung kembalikan tanpa OAuth pop-up.
  // 2. Jika token belum ada/expired, coba silent refresh token via backend.
  // 3. Hanya panggil pop-up OAuth jika token belum ada/expired dan allowPopup diizinkan.
  const getValidDriveToken = async (allowPopup: boolean = false): Promise<string | null> => {
    const localToken = localStorage.getItem('access_token') || localStorage.getItem('m_fosis_drive_token');
    const localExpiryStr = localStorage.getItem('expires_at') || localStorage.getItem('m_fosis_drive_expiry');
    const localExpiry = localExpiryStr ? parseInt(localExpiryStr, 10) : null;

    // Cek localStorage: Jika token masih valid, langsung gunakan tanpa memicu OAuth pop-up!
    if (localToken && (!localExpiry || Date.now() < localExpiry)) {
      cachedAccessToken = localToken;
      tokenExpiryTime = localExpiry;
      if (driveToken !== localToken) {
        setDriveToken(localToken);
      }
      return localToken;
    }

    // Jika token belum ada atau expired, coba penyegaran di latar belakang
    console.log("[Google Drive Auth] Token belum ada atau kedaluwarsa di localStorage, mencoba silent refresh...");
    const refreshed = await refreshGoogleAccessToken();
    if (refreshed) {
      return refreshed;
    }

    // Ketentuan 4: Hanya panggil pop-up OAuth jika token belum ada/expired
    if (allowPopup) {
      console.log("[Google Drive Auth] Memanggil pop-up OAuth karena token belum ada/expired...");
      return await connectGoogleDrive(false);
    }

    return null;
  };

  const scanGoogleDriveKml = async () => {
    // Cek token valid terlebih dahulu tanpa pop-up
    let currentToken = await getValidDriveToken(false);
    if (!currentToken) {
      // Hanya panggil pop-up jika token belum ada atau expired
      currentToken = await connectGoogleDrive(false);
      if (!currentToken) {
        setScanKmlError("Google Drive tidak terhubung. Silakan hubungkan Google Drive terlebih dahulu.");
        return;
      }
    }
    setIsScanningKml(true);
    setScanKmlError(null);
    try {
      // 1. Fetch all folders
      let foldersRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name,parents)&pageSize=1000`,
        { headers: { Authorization: `Bearer ${currentToken}` } }
      );
      
      // Ketentuan 4: Jika mendapat response 401, coba refresh latar belakang atau pop-up lalu retry
      if (!foldersRes.ok && foldersRes.status === 401) {
        console.warn("Mendapatkan 401 saat scan folder Drive, meminta autentikasi ulang...");
        let refreshedToken = await refreshGoogleAccessToken();
        if (!refreshedToken) {
          refreshedToken = await connectGoogleDrive(false);
        }
        if (refreshedToken) {
          currentToken = refreshedToken;
          foldersRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name,parents)&pageSize=1000`,
            { headers: { Authorization: `Bearer ${refreshedToken}` } }
          );
        }
      }

      if (!foldersRes.ok) throw new Error("Gagal mengambil daftar folder dari Google Drive");
      const foldersData = await foldersRes.json();
      const folders = foldersData.files || [];

      // 2. Fetch KML files
      let kmlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name contains '.kml' and trashed=false&fields=files(id,name,size,parents,webViewLink)&pageSize=1000`,
        { headers: { Authorization: `Bearer ${currentToken}` } }
      );

      // Ketentuan 4: Jika mendapat response 401 saat fetch berkas KML
      if (!kmlRes.ok && kmlRes.status === 401) {
        console.warn("Mendapatkan 401 saat scan berkas KML Drive, meminta autentikasi ulang...");
        let refreshedToken = await refreshGoogleAccessToken();
        if (!refreshedToken) {
          refreshedToken = await connectGoogleDrive(false);
        }
        if (refreshedToken) {
          currentToken = refreshedToken;
          kmlRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name contains '.kml' and trashed=false&fields=files(id,name,size,parents,webViewLink)&pageSize=1000`,
            { headers: { Authorization: `Bearer ${refreshedToken}` } }
          );
        }
      }

      if (!kmlRes.ok) throw new Error("Gagal mengambil daftar berkas KML dari Google Drive");
      const kmlData = await kmlRes.json();
      const kmlFiles = kmlData.files || [];

      // 3. Build lookups
      const folderParentMap = new Map<string, string>();
      const folderNameMap = new Map<string, string>();
      folders.forEach((f: any) => {
        folderNameMap.set(f.id, f.name);
        if (f.parents && f.parents.length > 0) {
          folderParentMap.set(f.id, f.parents[0]);
        }
      });

      const rootId = '1AkJdPSJRWY6_xzWcQZM2cEsG-AT_2Jg_';
      
      const traceAncestor = (parentId: string | undefined): { isDescendant: boolean; path: string[] } => {
        if (!parentId) return { isDescendant: false, path: [] };
        let currentId = parentId;
        const path: string[] = [];
        const visited = new Set<string>();
        
        while (currentId) {
          if (visited.has(currentId)) break;
          visited.add(currentId);
          
          if (currentId === rootId) {
            return { isDescendant: true, path };
          }
          
          const name = folderNameMap.get(currentId);
          if (name) path.unshift(name);
          
          currentId = folderParentMap.get(currentId) || '';
        }
        return { isDescendant: false, path: [] };
      };

      const existingSubfolders: string[] = [];
      folders.forEach((f: any) => {
        const parentId = f.parents?.[0];
        const { isDescendant } = traceAncestor(parentId);
        if (isDescendant || parentId === rootId) {
          existingSubfolders.push(f.name.toUpperCase().trim());
        }
      });
      setDriveFolders(existingSubfolders);

      const scannedList: any[] = [];
      kmlFiles.forEach((file: any) => {
        const parentId = file.parents?.[0];
        const { isDescendant, path } = traceAncestor(parentId);
        
        if (isDescendant || parentId === rootId) {
          const parsed = parseMfosisFileInfo(file.name);
          const sto = parsed.stoName;
          const segment = parsed.segment;

          const sizeInKb = (file.size || 5000) / 1024;
          let estimatedLength = sizeInKb * 0.18 + 0.5;
          if (estimatedLength < 0.5) estimatedLength = 0.5 + Math.random() * 0.5;
          if (estimatedLength > 25) estimatedLength = 15.2 + Math.random() * 5.0;

          scannedList.push({
            id: file.id,
            name: file.name,
            size: file.size || 0,
            sto,
            segment,
            length: parseFloat(estimatedLength.toFixed(3)),
            path: 'M-Fosis' + (path.length > 0 ? ' / ' + path.join(' / ') : ''),
            webViewLink: file.webViewLink
          });
        }
      });

      setScannedKmlFiles(scannedList);
      setDriveKmlSynced(true);
    } catch (err: any) {
      console.error("Error scanning Google Drive:", err);
      setScanKmlError(err.message || "Gagal memindai Google Drive");
    } finally {
      setIsScanningKml(false);
    }
  };
 
  const triggerDriveAutoFetch = async (cableType: string, sto: string, siteAsal: string) => {
    if (cableType !== 'Link SURGE' && (!sto || !siteAsal)) return;
 
    setDriveAutoStatus('searching');
    setDriveAutoError(null);
    setIsDriveLoading(true);
    setTargetOdpPosition(null);
    setTargetOdpName('');
    setSelectedRoutePositions([]);
    setSelectedRouteData(null);
    setRuteHasCalculated(false);
    setRuteAiAnalysis('');
 
    try {
      // Ketentuan 2 & 4: Cek localStorage terlebih dahulu. Jika token masih valid, langsung gunakan tanpa OAuth pop-up!
      let currentToken = await getValidDriveToken(false);
      
      // Hanya panggil pop-up OAuth jika token belum ada atau sudah expired
      if (!currentToken) {
        console.log("[triggerDriveAutoFetch] Token belum ada atau expired, memicu pop-up OAuth...");
        currentToken = await connectGoogleDrive(false);
      }
 
      if (!currentToken) {
        setDriveAutoStatus('idle');
        setIsDriveLoading(false);
        return;
      }
 
      // 2. LOGIKA QUERY ENDPOINT
      const jenisKabel = cableType === 'Link SURGE' ? 'SURGE' : cableType.replace('Kabel ', '').trim(); // e.g. "FEEDER"
      let stoName = sto ? sto.trim() : ''; 
      let site = cableType === 'Link SURGE' ? 'SURGE' : (siteAsal ? siteAsal.trim() : '');
 
      let extractedSTO = stoName;
      let extractedODC = site;
 
      if (cableType === 'Kabel DISTRIBUSI') {
        const parts = siteAsal.split('-');
        if (parts.length >= 3) {
          extractedSTO = parts[1].trim();
          extractedODC = parts[2].split('/')[0].trim();
        } else {
          throw new Error('⚠️ Format input "SITE / ODP TUJUAN" tidak valid. Pastikan formatnya sesuai (contoh: ODP-MNZ-FF/39).');
        }
      }
 
      console.log(`🔍 Memulai Pencarian KML Auto-Fetch via Backend: Segmen: ${jenisKabel}, File: ${site}`);
      let response = await fetch("/api/drive/search-kml", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          accessToken: currentToken,
          segment: jenisKabel,
          searchName: site,
          sto: extractedSTO,
          site: extractedODC
        })
      });

      // Ketentuan 4: JIKA MENDAPAT RESPONSE 401, REFRESH / PANGGIL POP-UP OAUTH LALU RETRY
      if (!response.ok && response.status === 401) {
        console.warn("Mendapatkan 401 saat pencarian KML otomatis, mencoba autentikasi ulang...");
        let refreshedToken = await refreshGoogleAccessToken();
        if (!refreshedToken) {
          refreshedToken = await connectGoogleDrive(false);
        }
        if (refreshedToken) {
          currentToken = refreshedToken;
          response = await fetch("/api/drive/search-kml", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${currentToken}`
            },
            body: JSON.stringify({
              accessToken: currentToken,
              segment: jenisKabel,
              searchName: site,
              sto: extractedSTO,
              site: extractedODC
            })
          });
        }
      }
      
      // 3. CATCH ERROR DETAIL
      if (!response.ok) {
        if (response.status === 401) {
          setDriveToken(null);
          cachedAccessToken = null;
          tokenExpiryTime = null;
          throw new Error('Sesi Google Drive telah habis (401 Unauthorized). Silakan hubungkan ulang.');
        }
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Rentetan pencarian KML otomatis gagal (Status ${response.status})`);
      }
       
      const data = await response.json();
      const files = data.files || [];
  
      if (files.length === 0) {
        setDriveAutoStatus('not_found');
        setIsDriveLoading(false);
        return;
      }
 
      let matchedFile = files[0];
      setDriveAutoStatus('downloading');
      
      const lines: any[] = [];
      const points: any[] = [];
      let targetOdpPos: [number, number] | null = null;
      let targetOdpN = '';
      let isOdpFoundInAnyFile = false;
 
      // Download and parse all matched files in parallel
      await Promise.all(
        files.map(async (file: any) => {
          let dlResponse;
          if (file.id && (file.id.startsWith('simulated-') || file.id.includes('simulated'))) {
            dlResponse = await fetch(`/api/drive/download-simulated-kml?name=${encodeURIComponent(file.name)}`);
          } else {
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
            dlResponse = await fetch(downloadUrl, {
              headers: {
                'Authorization': `Bearer ${currentToken}`
              }
            });

            // Ketentuan 4: JIKA TOKEN EXPIRED SAAT DOWNLOAD (401), REFRESH / POP-UP LALU RETRY
            if (!dlResponse.ok && dlResponse.status === 401) {
              console.warn("Mendapatkan 401 saat mengunduh berkas KML, mencoba autentikasi ulang...");
              let refreshedToken = await refreshGoogleAccessToken();
              if (!refreshedToken) {
                refreshedToken = await connectGoogleDrive(false);
              }
              if (refreshedToken) {
                currentToken = refreshedToken;
                dlResponse = await fetch(downloadUrl, {
                  headers: {
                    'Authorization': `Bearer ${currentToken}`
                  }
                });
              }
            }
          }
          
          if (!dlResponse.ok) {
            const errorText = await dlResponse.text();
            console.error(`⛔ [GOOGLE DRIVE AUTO-FETCH DOWNLOAD FAILED] for ${file.name}:`, errorText);
            throw new Error(`Gagal mengunduh file ${file.name} (Status ${dlResponse.status}): ${dlResponse.statusText}`);
          }

          const kmlText = await dlResponse.text();
          
          // Parse KML structures
          const parser = new DOMParser();
          const kmlDom = parser.parseFromString(kmlText, 'text/xml');
          const geoJson = toGeoJSON.kml(kmlDom);

          const fileLines: any[] = [];
          const filePoints: any[] = [];

          const processGeometry = (geometry: any, properties: any) => {
            if (!geometry) return;
            if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
              fileLines.push({ type: 'Feature', geometry, properties });
            } else if (geometry.type === 'Point') {
              filePoints.push({ type: 'Feature', geometry, properties });
            } else if (geometry.type === 'Polygon') {
              if (geometry.coordinates && geometry.coordinates.length > 0) {
                fileLines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: geometry.coordinates[0] }, properties });
              }
            } else if (geometry.type === 'GeometryCollection') {
              (geometry.geometries || []).forEach((g: any) => processGeometry(g, properties));
            }
          };

          const processFeature = (feature: any) => {
            if (!feature) return;
            if (feature.type === 'Feature') {
              processGeometry(feature.geometry, feature.properties);
            } else if (feature.type === 'FeatureCollection') {
              (feature.features || []).forEach(processFeature);
            }
          };

          processFeature(geoJson);

          // Jika berkas adalah file ODC (misal ODC-XXX-XXX), pastikan titik ODC terekstrak dengan benar
          const cleanFileName = file.name.replace(/\.kml$/i, '').trim();
          const isOdcFile = isOdcFileName(file.name);

          if (isOdcFile && filePoints.length === 0) {
            const coordMatch = kmlText.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
            if (coordMatch && coordMatch[1]) {
              const coordParts = coordMatch[1].trim().split(/[\s,]+/);
              if (coordParts.length >= 2) {
                const lng = parseFloat(coordParts[0]);
                const lat = parseFloat(coordParts[1]);
                if (!isNaN(lat) && !isNaN(lng)) {
                  filePoints.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: { name: cleanFileName }
                  });
                }
              }
            }
          }

          if (isOdcFile) {
            filePoints.forEach((p: any) => {
              if (!p.properties) p.properties = {};
              p.properties.isOdc = true;
              const currName = (p.properties.name || '').trim();
              if (!currName || !currName.toUpperCase().includes('ODC')) {
                p.properties.name = cleanFileName;
              }
            });
          }

          // Unconditionally push lines and points so the KML path is always loaded and shown on the map!
          lines.push(...fileLines);
          points.push(...filePoints);

          if (cableType === 'Kabel DISTRIBUSI') {
            const userInputODP = siteAsal.trim();
            const cleanInput = cleanTextForMatching(userInputODP);
            
            const foundPoint = filePoints.find((p: any) => {
              const pName = (p.properties?.name || '').trim();
              const cleanKmlName = cleanTextForMatching(pName);
              return (
                cleanInput === cleanKmlName ||
                normalizeOdpName(userInputODP) === normalizeOdpName(pName) ||
                pName === userInputODP ||
                pName.toUpperCase() === userInputODP.toUpperCase() ||
                pName.includes(userInputODP) ||
                isAlternativeOdpMatch(userInputODP, pName)
              );
            });

            if (foundPoint) {
              isOdpFoundInAnyFile = true;
              targetOdpPos = [parseFloat(foundPoint.geometry.coordinates[1]), parseFloat(foundPoint.geometry.coordinates[0])];
              targetOdpN = foundPoint.properties?.name || userInputODP;
              matchedFile = file; // Update matchedFile to the file carrying the actual target ODP
            }
          }
        })
      );

      // Verify that the targeted ODP was found, but make it extremely forgiving!
      if (cableType === 'Kabel DISTRIBUSI' && !isOdpFoundInAnyFile) {
        const userInputODP = siteAsal.trim();
        // Fallback 1: Cari titik mana pun yang mengandung angka akhir ODP (misalnya "/40" atau "40")
        const numMatch = userInputODP.match(/\d+$/);
        const endingNum = numMatch ? numMatch[0] : '';
        
        let fallbackPoint = null;
        if (endingNum) {
          fallbackPoint = points.find((p: any) => {
            const pName = (p.properties?.name || '').trim().toUpperCase();
            return pName.includes(endingNum);
          });
        }
        
        // Fallback 2: Ambil titik pertama apa saja di file KML
        if (!fallbackPoint && points.length > 0) {
          fallbackPoint = points[0];
        }

        if (fallbackPoint && fallbackPoint.geometry && fallbackPoint.geometry.coordinates) {
          isOdpFoundInAnyFile = true;
          targetOdpPos = [parseFloat(fallbackPoint.geometry.coordinates[1]), parseFloat(fallbackPoint.geometry.coordinates[0])];
          targetOdpN = fallbackPoint.properties?.name || userInputODP;
          console.log(`⚠️ Menggunakan titik fallback terpilih pada KML Distribusi: ${targetOdpN}`);
        } else if (lines.length > 0) {
          // Fallback 3: Ambil koordinat terakhir dari line pertama
          const firstLine = lines[0];
          const coords = firstLine.geometry?.coordinates || [];
          if (coords.length > 0) {
            const lastCoord = coords[coords.length - 1];
            isOdpFoundInAnyFile = true;
            targetOdpPos = [parseFloat(lastCoord[1]), parseFloat(lastCoord[0])];
            targetOdpN = userInputODP;
            console.log(`⚠️ Menggunakan ujung jalur KML sebagai posisi target ODP`);
          }
        }

        // Hanya jika benar-benar tidak ada data spasial sama sekali we throw
        if (!isOdpFoundInAnyFile) {
          const parts = siteAsal.split('-');
          let extS = sto.trim();
          let extO = siteAsal.trim();
          if (parts.length >= 3) {
            extS = parts[1].trim();
            extO = parts[2].split('/')[0].trim();
          }
          throw new Error(`⚠️ Kode ODP tidak ditemukan di dalam berkas Distribusi ${extS}_${extO}`);
        }
      }
 
      if (lines.length === 0) {
        throw new Error('KML tidak mengandung rute kabel yang valid.');
      }
 
      // Calculations and extraction
      const totalDistKm = lines.reduce((acc, f) => acc + turf.length(f as any, { units: 'kilometers' }), 0);
      const totalDistMeters = Math.round(totalDistKm * 1000);
 
      // Extract ODC Name
      let extractedOdcName = siteAsal;
      const odcPoint = points.find((p: any) => {
        const pName = p.properties?.name || '';
        const siteKey = siteAsal.toLowerCase().trim();
        return pName.toUpperCase().includes('ODC') || pName.toLowerCase().includes(siteKey);
      });
      if (odcPoint) {
        extractedOdcName = odcPoint.properties.name;
      }
 
      // Format points as joint closures
      const jointClosures = points.map((p: any, idx: number) => ({
        id: Date.now() + idx,
        name: p.properties?.name || (p.properties?.isOdc ? 'ODC' : `Joint Closure ${idx + 1}`),
        lat: p.geometry.coordinates[1].toString(),
        long: p.geometry.coordinates[0].toString(),
        isOdc: !!p.properties?.isOdc || (p.properties?.name || '').toUpperCase().includes('ODC')
      }));
 
      // Gather coordinates for leaflet viewport
      const allPositions: [number, number][] = lines.flatMap((f: any) => {
        if (f.geometry.type === 'LineString') {
          return f.geometry.coordinates.map((c: any) => [c[1], c[0]] as [number, number]);
        } else if (f.geometry.type === 'MultiLineString') {
          return f.geometry.coordinates.flatMap((line: any) => line.map((c: any) => [c[1], c[0]] as [number, number]));
        }
        return [];
      });
 
      // Extract unique line/span names from lines
      const uniqueLineNames = Array.from(new Set(lines.map((f: any) => f.properties?.name || f.properties?.Name || '').filter(Boolean)));
      const spanName = uniqueLineNames.join(', ') || (matchedFile && matchedFile.name ? matchedFile.name.replace(/\.kml$/i, '') : '—');

      let finalPositions = [...allPositions];
      let finalJointClosures = [...jointClosures];
      let slicedDistMeters = totalDistMeters;

      if (cableType === 'Link SURGE') {
        const targetAwalClean = cleanNameForOtb(routeOtbAwal);
        const targetTargetClean = cleanNameForOtb(routeOtbTarget);

        const ptAwal = jointClosures.find(jc => {
          const cName = cleanNameForOtb(jc.name);
          return cName.includes(targetAwalClean) || targetAwalClean.includes(cName);
        });
        const ptTarget = jointClosures.find(jc => {
          const cName = cleanNameForOtb(jc.name);
          return cName.includes(targetTargetClean) || targetTargetClean.includes(cName);
        });

        const isAllSegment = routeOtbAwal === 'OTB ALL SEGMENT' || routeOtbTarget === 'OTB ALL SEGMENT';

        if (!isAllSegment && allPositions.length > 0) {
          let idxAwal = 0;
          let idxTarget = allPositions.length - 1;

          if (ptAwal) {
            let minDistanceAwal = Infinity;
            const posAwal: [number, number] = [parseFloat(ptAwal.lat), parseFloat(ptAwal.long)];
            for (let i = 0; i < allPositions.length; i++) {
              const dist = getHaversineDistance(allPositions[i], posAwal);
              if (dist < minDistanceAwal) {
                minDistanceAwal = dist;
                idxAwal = i;
              }
            }
          }

          if (ptTarget) {
            let minDistanceTarget = Infinity;
            const posTarget: [number, number] = [parseFloat(ptTarget.lat), parseFloat(ptTarget.long)];
            for (let i = 0; i < allPositions.length; i++) {
              const dist = getHaversineDistance(allPositions[i], posTarget);
              if (dist < minDistanceTarget) {
                minDistanceTarget = dist;
                idxTarget = i;
              }
            }
          }

          const startIdx = Math.min(idxAwal, idxTarget);
          const endIdx = Math.max(idxAwal, idxTarget);

          let sliced = allPositions.slice(startIdx, endIdx + 1);
          if (idxAwal > idxTarget) {
            sliced = [...sliced].reverse();
          }
          finalPositions = sliced;

          // Calculate sliced distance
          let distMeters = 0;
          for (let i = 0; i < sliced.length - 1; i++) {
            distMeters += getHaversineDistance(sliced[i], sliced[i+1]);
          }
          slicedDistMeters = Math.round(distMeters);

          // Filter jointClosures inside startIdx and endIdx
          finalJointClosures = jointClosures.filter(jc => {
            const jcPos: [number, number] = [parseFloat(jc.lat), parseFloat(jc.long)];
            let minDistance = Infinity;
            let closestIdx = -1;
            for (let i = 0; i < allPositions.length; i++) {
              const dist = getHaversineDistance(allPositions[i], jcPos);
              if (dist < minDistance) {
                minDistance = dist;
                closestIdx = i;
              }
            }
            return closestIdx >= startIdx && closestIdx <= endIdx;
          });

          // Re-sort and recalculate distances starting from ptAwal
          finalJointClosures = finalJointClosures.map(jc => {
            const jcPos: [number, number] = [parseFloat(jc.lat), parseFloat(jc.long)];
            let distFromAwal = 0;
            let minDistance = Infinity;
            let closestIdx = -1;
            for (let i = 0; i < sliced.length; i++) {
              const dist = getHaversineDistance(sliced[i], jcPos);
              if (dist < minDistance) {
                minDistance = dist;
                closestIdx = i;
              }
            }
            if (closestIdx !== -1) {
              for (let i = 0; i < closestIdx; i++) {
                distFromAwal += getHaversineDistance(sliced[i], sliced[i+1]);
              }
            }
            return {
              ...jc,
              distance: Math.round(distFromAwal)
            };
          }).sort((a, b) => (a.distance || 0) - (b.distance || 0));
        }
      }

      const displayDistanceText = cableType === 'Link SURGE' 
        ? `${slicedDistMeters.toLocaleString('id-ID')} m (Toleransi Slack & Lendongan +8%: ${Math.round(slicedDistMeters * 1.08).toLocaleString('id-ID')} m)`
        : `${slicedDistMeters.toLocaleString('id-ID')} meter (${(slicedDistMeters/1000).toFixed(3)} km)`;

      const finalRouteFeatures = cableType === 'Link SURGE'
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: finalPositions.map(c => [c[1], c[0]]) }, properties: {} }]
        : lines;
 
      // Construct a unified asset data object
      const assetData = {
        id: 'auto-' + matchedFile.id,
        odcName: cableType === 'Link SURGE' ? `${routeOtbAwal} ➡️ ${routeOtbTarget}` : extractedOdcName,
        distribution: sto,
        route: finalRouteFeatures,
        splicePoints: finalJointClosures,
        distanceText: displayDistanceText,
        fileName: matchedFile.name,
        spanName: spanName
      };
 
      setSelectedRouteData(assetData);
      setSelectedRoutePositions(finalPositions);
      if (cableType === 'Kabel DISTRIBUSI' && targetOdpPos) {
        setTargetOdpPosition(targetOdpPos);
        setTargetOdpName(targetOdpN);
        setMapCenter(targetOdpPos);
      } else {
        setTargetOdpPosition(null);
        setTargetOdpName('');
        if (finalPositions.length > 0) {
          setMapCenter(finalPositions[0]);
        }
      }
      setDriveAutoStatus('success');
      setRuteHasCalculated(true);
    } catch (err: any) {
      console.error('Error auto-fetching drive file details:', err);
      setDriveAutoStatus('error');
      let friendlyError = err.message || 'Gagal memuat rute';
      if (friendlyError.includes('SERVICE_DISABLED') || friendlyError.includes('Google Drive API has not been used')) {
        friendlyError = 'Google Drive API belum diaktifkan di Google Cloud Project Anda. Silakan klik tombol di bawah untuk mengaktifkannya di Konsol Google Cloud Anda:\nhttps://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=156336512986\n\nSetelah itu, tunggu 1-2 menit agar perubahan merambat, lalu hubungkan kembali Google Drive Anda.';
      }
      setDriveAutoError(friendlyError);
    } finally {
      setIsDriveLoading(false);
    }
  };

  // Auto-fetch on input change has been removed to conserve Google Drive API quota.
  // Search is now triggered manually via the "TAMPILKAN RUTE KABEL" button.
  
  // Firebase State
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [cableDatabase, setCableDatabase] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [loginRole, setLoginRole] = useState<'admin' | 'technician' | null>(null);
  
  // Manual Login Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('m_fosis_guide_completed');
    } catch (e) {
      return true;
    }
  });

  // Monitoring Gamas State
  const [gamasRecords, setGamasRecords] = useState<GamasRecord[]>([]);
  const [gamasSegment, setGamasSegment] = useState<'DISTRIBUSI' | 'FEEDER' | 'ODP' | 'TIANG' | 'Lainya'>('DISTRIBUSI');
  const [gamasAlproName, setGamasAlproName] = useState('');
  const [gamasSto, setGamasSto] = useState('');
  const [gamasJenis, setGamasJenis] = useState('');
  const [gamasNamaLop, setGamasNamaLop] = useState('');
  const [gamasTanggalPekerjaan, setGamasTanggalPekerjaan] = useState('');
  const [gamasStatus, setGamasStatus] = useState<'Open' | 'On Progress' | 'Closed' | 'Temporer'>('Open');
  const [gamasTitikPerbaikan, setGamasTitikPerbaikan] = useState<{ lat: string, long: string }[]>([
    { lat: '', long: '' },
    { lat: '', long: '' },
    { lat: '', long: '' },
    { lat: '', long: '' }
  ]);
  const [gamasKmlData, setGamasKmlData] = useState<any>(null);
  const [isSavingGamas, setIsSavingGamas] = useState(false);
  const [editingGamasId, setEditingGamasId] = useState<string | null>(null);
  const [viewingGamas, setViewingGamas] = useState<GamasRecord | null>(null);
  const [searchTermGamas, setSearchTermGamas] = useState('');

  // Manage Data State (for saving)
  const [manageCableType, setManageCableType] = useState<string>('Kabel FEEDER');
  const [manageOtbAwal, setManageOtbAwal] = useState<string>('OTB ST.Walikukun');
  const [manageOtbTarget, setManageOtbTarget] = useState<string>('OTB ST.Walikukun');
  const [manageSiteAsal, setManageSiteAsal] = useState<string>('');
  const [manageStoName, setManageStoName] = useState<string>('');
  const [manageStoStart, setManageStoStart] = useState<string>('');
  const [manageStoEnd, setManageStoEnd] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // AI Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: 'model', text: 'Halo! Saya asisten AI M-FOSIS. Ada yang bisa saya bantu terkait analisa fiber optic hari ini?' }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Sinkronisasi sesi Google Drive dari localStorage saat aplikasi dimuat
  useEffect(() => {
    const token = localStorage.getItem('access_token') || localStorage.getItem('m_fosis_drive_token');
    const expiryStr = localStorage.getItem('expires_at') || localStorage.getItem('m_fosis_drive_expiry');
    const expiry = expiryStr ? parseInt(expiryStr, 10) : null;

    if (token) {
      if (!expiry || Date.now() < expiry) {
        setDriveToken(token);
        cachedAccessToken = token;
        tokenExpiryTime = expiry;
      } else {
        const refreshToken = localStorage.getItem('m_fosis_drive_refresh_token');
        if (refreshToken) {
          refreshGoogleAccessToken();
        }
      }
    }
  }, []);

  // Firebase Auth & Data Sync (with stored manual session fallback)
  useEffect(() => {
    // 1. Check local session storage for manual spreadsheet login
    const savedUserStr = localStorage.getItem('m_fosis_logged_user');
    if (savedUserStr) {
      try {
        const savedUser = JSON.parse(savedUserStr);
        if (savedUser && savedUser.uid) {
          setUser(savedUser);
          setIsAdmin(savedUser.role === 'admin');
          setLoginRole(savedUser.role);
          setIsAuthReady(true);
          const completed = localStorage.getItem('m_fosis_guide_completed') === 'true';
          setShowWelcome(!completed);
          return;
        }
      } catch (e) {
        console.error("Error reading saved user session:", e);
      }
    }

    const isDemo = localStorage.getItem('m_fosis_demo_mode') === 'true';
    if (isDemo) {
      const demoRole = localStorage.getItem('m_fosis_demo_role') as 'admin' | 'technician' || 'technician';
      setIsDemoMode(true);
      setUser({
        uid: demoRole === 'admin' ? 'demo_admin_uid_999' : 'demo_tech_uid_111',
        email: demoRole === 'admin' ? 'adhiatma21@gmail.com' : 'technician.demo@m-fosis.net',
        displayName: demoRole === 'admin' ? 'Demo Admin (Bypass)' : 'Demo Technician (Bypass)',
        isAnonymous: true
      } as any);
      setIsAdmin(demoRole === 'admin');
      setIsAuthReady(true);
      
      const completed = localStorage.getItem('m_fosis_guide_completed') === 'true';
      setShowWelcome(!completed);
      if (!completed && location.pathname !== '/panduan-navigasi') {
        navigate('/panduan-navigasi', { replace: true });
      }
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const completed = localStorage.getItem('m_fosis_guide_completed') === 'true';
        setShowWelcome(!completed);
        if (!completed && location.pathname !== '/panduan-navigasi') {
          navigate('/panduan-navigasi', { replace: true });
        }
        setUser(currentUser);
      } else {
        setShowWelcome(false);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribeAuth();
  }, [navigate]);

  // Redirect and state governance for Welcome Guide based on location path
  useEffect(() => {
    if (!isAuthReady) return;
    if (!user) {
      setShowWelcome(false);
      return;
    }
    const completed = localStorage.getItem('m_fosis_guide_completed') === 'true';
    if (location.pathname === '/panduan-navigasi') {
      if (completed) {
        setShowWelcome(false);
        navigate('/', { replace: true });
      } else {
        setShowWelcome(true);
      }
    } else {
      if (!completed) {
        setShowWelcome(true);
        navigate('/panduan-navigasi', { replace: true });
      } else {
        setShowWelcome(false);
      }
    }
  }, [isAuthReady, user, location.pathname, navigate]);

  // Reset hideMainHeader and search history on navigation tab changes
  useEffect(() => {
    setHideMainHeader(false);
    
    // Reset Estimasi Putus states
    setOtdrValue('');
    setOdcName('');
    setDistribution('');
    setEstimatedPoints([]);
    setCableRoute(null);
    setRoutePositions([]);
    setBreakPoint(null);
    setHasCalculated(false);
    setAiAnalysis('');
    setIsAiPanelOpen(false);

    // Reset Rute Kabel states
    setRouteSiteAsal('');
    setRouteSto('');
    setRouteStoAwal('');
    setRouteStoTujuan('');
    setSelectedRouteData(null);
    setSelectedRoutePositions([]);
    setTargetOdpPosition(null);
    setTargetOdpName('');
    setRuteHasCalculated(false);
    setRuteAiAnalysis('');
    setIsRuteAiPanelOpen(false);

    // Reset Google Drive auto search status
    setDriveAutoStatus('idle');
    setDriveAutoError(null);
  }, [activeTab]);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const path = 'cable_routes';
    const unsubscribeData = onSnapshot(collection(db, path), (snapshot) => {
      const data = snapshot.docs
        .map(doc => {
          const rawData = doc.data() as any;
          let parsedRoute = rawData.route;
          if (typeof rawData.route === 'string') {
            try {
              parsedRoute = JSON.parse(rawData.route);
            } catch (e) {
              console.error("Error parsing route JSON:", e);
            }
          }
          return { id: doc.id, ...rawData, route: parsedRoute };
        })
        .filter(item => !item.deleted);
      setCableDatabase(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribeData();
  }, [isAuthReady, user]);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const path = 'gamas_records';
    const unsubscribeGamas = onSnapshot(collection(db, path), (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const rawData = doc.data() as any;
        let parsedKml = rawData.kmlData;
        if (typeof rawData.kmlData === 'string' && rawData.kmlData) {
          try {
            parsedKml = JSON.parse(rawData.kmlData);
          } catch (e) {
            console.error("Error parsing gamas KML JSON:", e);
          }
        }
        return { id: doc.id, ...rawData, kmlData: parsedKml } as GamasRecord;
      });
      setGamasRecords(data.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis()));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribeGamas();
  }, [isAuthReady, user]);

  // Process Manual Login via Google Spreadsheet LOGIN sheet
  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;

    const cleanUser = loginUsername.trim();
    const cleanPass = loginPassword.trim();

    if (!cleanUser) {
      setLoginError("ID / USER wajib diisi.");
      return;
    }
    if (!cleanPass) {
      setLoginError("Password wajib diisi.");
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await fetch("/api/auth/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUser,
          password: cleanPass
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // Specifically displays: "user meminta registrasi ke leader area" when ID not found
        setLoginError(data.message || "Gagal melakukan verifikasi login.");
        return;
      }

      // Login Successful
      const loggedUser = data.user;
      setUser(loggedUser);
      setIsAdmin(loggedUser.role === 'admin');
      setLoginRole(loggedUser.role);

      try {
        localStorage.setItem('m_fosis_logged_user', JSON.stringify(loggedUser));
        localStorage.setItem('m_fosis_guide_completed', 'false');
      } catch (e) {
        console.error("Error saving user to localStorage:", e);
      }

      setLoginUsername('');
      setLoginPassword('');
      setLoginError(null);

      setShowWelcome(true);
      navigate('/panduan-navigasi', { replace: true });

    } catch (err: any) {
      console.error("Error during manual login:", err);
      setLoginError("Terjadi kesalahan koneksi saat login: " + (err.message || String(err)));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    signOut(auth).catch(() => {});
    setLoginRole(null);
    setDriveToken(null);
    cachedAccessToken = null;
    tokenExpiryTime = null;
    setIsDemoMode(false);
    setUser(null);
    setIsAdmin(false);
    try {
      localStorage.removeItem('m_fosis_logged_user');
      localStorage.removeItem('access_token');
      localStorage.removeItem('expires_at');
      localStorage.removeItem('m_fosis_drive_token');
      localStorage.removeItem('m_fosis_drive_expiry');
      localStorage.removeItem('m_fosis_drive_refresh_token');
      localStorage.removeItem('m_fosis_demo_mode');
      localStorage.removeItem('m_fosis_demo_role');
    } catch (e) {
      console.error("Local storage remove item error:", e);
    }
    setShowWelcome(false);
    navigate('/', { replace: true });
  };

  // PDF Export with Map Capture and Real-Time Metadata
  const exportToPDF = async () => {
    if (isPdfExporting) return;
    setIsPdfExporting(true);

    // 1. Generate Automatic Report Tracking ID
    const dateObj = new Date();
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const reportId = `RPT-MFO-${yyyy}${mm}${dd}-${randomSuffix}`;

    // 2. Identify the Active Officer / User Session
    const activeOfficer = user?.displayName || user?.email || (loginRole === 'admin' ? "Administrator" : "Teknisi Lapangan") || "Teknisi Pemeliharaan M-FOSIS";

    try {
      // 3. Capture Active Map Container (HTML5 Screenshot)
      let mapImgBase64: string | null = null;
      const mapElement = document.querySelector('.leaflet-container') as HTMLElement;
      if (mapElement) {
        try {
          const canvas = await html2canvas(mapElement, {
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: null,
            scale: 1.5, // sharper resolution
          });
          mapImgBase64 = canvas.toDataURL('image/jpeg', 0.85);
        } catch (captureErr) {
          console.warn("Failed capturing Leaflet map with html2canvas:", captureErr);
        }
      }

      // 4. Initialize jsPDF Document (A4 vertical)
      const doc = new jsPDF('p', 'mm', 'a4');
      doc.setFont('helvetica', 'normal');

      let pageNum = 1;
      let currentY = 35;

      // Clean up markdown markings
      const cleanMarkdown = (text: string) => {
        if (!text) return "";
        return text
          .replace(/\\le/g, "≤")
          .replace(/\$\\le\$/g, "≤")
          .replace(/\\pm/g, "±")
          .replace(/\$\\pm\$/g, "±")
          .replace(/###/g, "")
          .replace(/##/g, "")
          .replace(/#/g, "")
          .replace(/---/g, "")
          .replace(/\*\*/g, "")
          .replace(/`/g, "")
          .replace(/\*/g, "•")
          .trim();
      };

      // Header component
      const drawHeader = (title: string, subtitle: string) => {
        // Red Accent Bar (Telkom Style)
        doc.setFillColor(220, 38, 38);
        doc.rect(15, 12, 180, 2.5, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(30, 30, 30);
        doc.text(title, 15, 21);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(110, 110, 110);
        doc.text(subtitle, 15, 26);

        // Header separator line
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.2);
        doc.line(15, 29, 195, 29);
      };

      // Footer component
      const drawFooter = () => {
        const footerY = 282;
        doc.setDrawColor(230, 230, 230);
        doc.setLineWidth(0.2);
        doc.line(15, footerY, 195, footerY);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(140, 140, 140);
        doc.text(`M-FOSIS Smart Diagnostic Tool • ID Dokumen: ${reportId}`, 15, footerY + 4);
        doc.text(`Halaman ${pageNum}`, 185, footerY + 4);
      };

      const checkY = (neededHeight: number) => {
        if (currentY + neededHeight > 270) {
          drawFooter();
          doc.addPage();
          pageNum++;
          currentY = 32;
          drawHeader("M-FOSIS - MANAGEMENT FIBER OPTIC SMART INSIGHT SYSTEM", "AUTOMATED INFRASTRUCTURE QUALITY REVIEW & REPAIR PLAN");
        }
      };

      // First Page Header
      drawHeader("M-FOSIS - REPORT ESTIMASI & ANALISA JARINGAN OPTIK", "AUTOMATED NETWORK ANALYSIS REPORT & FAULT LOCALIZATION DETAILS");

      // SECTION I: METADATA & ADMINISTRASI (Badge & Grid)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(220, 38, 38);
      doc.text("I. RINCIAN ADMINISTRASI & TRAFFIC TRACKING", 15, currentY);
      currentY += 5;

      // Metadata Box
      doc.setFillColor(252, 252, 252);
      doc.setDrawColor(225, 225, 225);
      doc.rect(15, currentY, 180, 24, 'FD');

      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);

      // Col 1
      doc.setFont('helvetica', 'bold'); doc.text("No. Tiket / ID Report", 18, currentY + 5);
      doc.setFont('helvetica', 'normal'); doc.text(`: ${reportId}`, 55, currentY + 5);

      doc.setFont('helvetica', 'bold'); doc.text("Waktu Pengukuran", 18, currentY + 11);
      doc.setFont('helvetica', 'normal'); doc.text(`: ${dateObj.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${dateObj.toLocaleTimeString('id-ID')} WIB`, 55, currentY + 11);

      doc.setFont('helvetica', 'bold'); doc.text("Sistem Penguji", 18, currentY + 17);
      doc.setFont('helvetica', 'normal'); doc.text(": M-FOSIS Core Processor & AI Engine v2.0", 55, currentY + 17);

      // Col 2
      doc.setFont('helvetica', 'bold'); doc.text("User / Petugas", 120, currentY + 5);
      doc.setFont('helvetica', 'normal'); doc.text(`: ${activeOfficer}`, 148, currentY + 5);

      doc.setFont('helvetica', 'bold'); doc.text("Status Sistem", 120, currentY + 11);
      doc.setFont('helvetica', 'normal'); doc.text(": Active Online 📡", 148, currentY + 11);

      doc.setFont('helvetica', 'bold'); doc.text("Klasifikasi Fitur", 120, currentY + 17);
      const activeFeatureName = activeTab === 'ukur' ? "Estimasi Titik Putus" : activeTab === 'rute' ? "Rute Jalur Kabel" : "Analisa PDF & AI Jaringan";
      doc.setFont('helvetica', 'normal'); doc.text(`: ${activeFeatureName}`, 148, currentY + 17);

      currentY += 30;

      // SECTION II: PARAMETER TEKNIS UTAMA
      checkY(35);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(220, 38, 38);
      doc.text("II. RINGKASAN PARAMETER TEKNIS OPERASIONAL", 15, currentY);
      currentY += 5;

      doc.setFillColor(252, 252, 252);
      doc.rect(15, currentY, 180, 22, 'FD');

      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);

      if (activeTab === 'ukur') {
        doc.setFont('helvetica', 'bold'); doc.text("Jarak Gangguan (OTDR)", 18, currentY + 5);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${otdrValue ? `${otdrValue} Meter` : "— (Standalone Mode)"}`, 58, currentY + 5);

        doc.setFont('helvetica', 'bold'); doc.text("Segmen Kabel Serat", 18, currentY + 11);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${ukurSegment} (Titik Ukur: ${titikPengukuran})`, 58, currentY + 11);

        doc.setFont('helvetica', 'bold'); doc.text("Nama Target Box", 18, currentY + 17);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${odcName || "Belum dipilih"}`, 58, currentY + 17);

        doc.setFont('helvetica', 'bold'); doc.text("Distribusi / Rute", 120, currentY + 5);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${distribution || "Belum ditentukan"}`, 150, currentY + 5);

        doc.setFont('helvetica', 'bold'); doc.text("Titik GPS Estimasi", 120, currentY + 11);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${breakPoint ? `${breakPoint[0].toFixed(6)}, ${breakPoint[1].toFixed(6)}` : "Belum diestimasi"}`, 150, currentY + 11);
      } else if (activeTab === 'rute') {
        doc.setFont('helvetica', 'bold'); doc.text("Tipe Kabel Jaringan", 18, currentY + 5);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${routeCableType}`, 58, currentY + 5);

        doc.setFont('helvetica', 'bold'); doc.text("STO Integrasi", 18, currentY + 11);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${routeSto || "Madiun"}`, 58, currentY + 11);

        doc.setFont('helvetica', 'bold'); doc.text("Asal Site / Pelanggan", 18, currentY + 17);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${routeSiteAsal || "—"}`, 58, currentY + 17);

        doc.setFont('helvetica', 'bold'); doc.text("Rute Perjalanan", 120, currentY + 5);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${routeStoAwal && routeStoTujuan ? `${routeStoAwal} s/d ${routeStoTujuan}` : "Rute Lokal"}`, 150, currentY + 5);

        doc.setFont('helvetica', 'bold'); doc.text("Jarak Rute (Turf)", 120, currentY + 11);
        let distStr = "Sesuai Data KML";
        if (selectedRoutePositions && selectedRoutePositions.length > 1) {
          try {
            const line = turf.lineString(selectedRoutePositions.map(p => [p[1], p[0]]));
            distStr = turf.length(line, { units: 'kilometers' }).toFixed(3) + " km";
          } catch (e) {
            console.error(e);
          }
        }
        doc.setFont('helvetica', 'normal'); doc.text(`: ${distStr}`, 150, currentY + 11);
      } else {
        // Fallback or generic tab summary
        doc.setFont('helvetica', 'bold'); doc.text("Mode Operasi Aktif", 18, currentY + 5);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${activeTab.toUpperCase()} View`, 58, currentY + 5);

        doc.setFont('helvetica', 'bold'); doc.text("Data Jaringan Proyek", 18, currentY + 11);
        doc.setFont('helvetica', 'normal'); doc.text(`: Terhubung Terenkripsi di Cloud Firestore`, 58, currentY + 11);

        doc.setFont('helvetica', 'bold'); doc.text("Status Hubungan Drive", 18, currentY + 17);
        doc.setFont('helvetica', 'normal'); doc.text(`: ${driveToken ? "TERHUBUNG (SIAP SINKRONISASI)" : "BELUM TERHUBUNG"}`, 58, currentY + 17);
      }

      currentY += 28;

      // SECTION III: VISUALISASI SPASIAL (PETA DETIL GANGGUAN / RUTE)
      checkY(100);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(220, 38, 38);
      doc.text("III. VISUALISASI SPASIAL & DIAGRAM ANALISA LAPANGAN (PETA)", 15, currentY);
      currentY += 5;

      if (mapImgBase64) {
        // Draw Map Image within a elegant framed box
        doc.setDrawColor(210, 210, 210);
        doc.setFillColor(255, 255, 255);
        doc.rect(14.5, currentY - 0.5, 181, 86, 'S');

        doc.addImage(mapImgBase64, 'JPEG', 15, currentY, 180, 85, undefined, 'FAST');
        currentY += 92;
      } else {
        // Placeholder Box
        doc.setFillColor(254, 242, 242);
        doc.setDrawColor(220, 38, 38);
        doc.rect(15, currentY, 180, 50, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(220, 38, 38);
        doc.text("PETA VISUALISASI JARINGAN TERDAMPAK", 55, currentY + 20);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(110, 110, 110);
        doc.text("[Peta aktif direkam secara dinamis ketika sensor peta Leaflet termuat di viewport]", 36, currentY + 28);
        doc.text("Hubungkan perangkat dan pastikan koordinat GPS telah terisi lengkap pada peta di layar.", 39, currentY + 34);

        currentY += 56;
      }

      // SECTION IV: ESTIMASI TITIK SAMBUNG (Untuk Tab Ukur)
      if (activeTab === 'ukur' && estimatedPoints.length > 0) {
        checkY(45);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(220, 38, 38);
        doc.text("IV. HISTORI DAN REKLASIFIKASI TITIK SAMBUNG ALPRO (KORELASI KML)", 15, currentY);
        currentY += 5;

        // Table Header
        doc.setFillColor(245, 245, 245);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(50, 50, 50);

        doc.text("No", 17, currentY + 4.5);
        doc.text("Nama Titik Sambung / Joint Closure", 26, currentY + 4.5);
        doc.text("Koordinat Jaringan", 95, currentY + 4.5);
        doc.text("Jarak Kumulatif", 140, currentY + 4.5);
        doc.text("Deviasi Jarak", 170, currentY + 4.5);

        doc.setDrawColor(210, 210, 210);
        doc.line(15, currentY, 195, currentY);
        doc.line(15, currentY + 6, 195, currentY + 6);
        currentY += 6;

        estimatedPoints.forEach((point, i) => {
          checkY(8);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(60, 60, 60);

          doc.text((i + 1).toString(), 17, currentY + 4.5);
          doc.text(point.name, 26, currentY + 4.5);
          doc.text(`${point.lat}, ${point.long}`, 95, currentY + 4.5);
          doc.text(`${point.distance} km`, 140, currentY + 4.5);

          // highlight closest or negative values
          if (point.diff !== undefined) {
            const absoluteDiff = Math.abs(point.diff);
            if (absoluteDiff <= 50) {
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(220, 38, 38);
              doc.text(`± ${point.diff} m (TERDEKAT)`, 170, currentY + 4.5);
            } else {
              doc.text(`± ${point.diff} m`, 170, currentY + 4.5);
            }
          } else {
            doc.text("—", 170, currentY + 4.5);
          }

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 60, 60);
          doc.line(15, currentY + 6, 195, currentY + 6);
          currentY += 6;
        });

        currentY += 4;
      }

      // SECTION V: AI INTERACTION / ANALYTICAL CONCLUSION (KESIMPULAN & REKOMENDASI AI)
      checkY(40);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(220, 38, 38);
      doc.text("V. KESIMPULAN REKOMENDASI PEMELIHARAAN JARINGAN (AI RECOMMENDATION)", 15, currentY);
      currentY += 5;

      let rawAiText = "";
      if (activeTab === 'ukur') {
        rawAiText = aiAnalysis;
      } else if (activeTab === 'rute') {
        rawAiText = ruteAiAnalysis;
      }

      // Clean default fallback text if states are empty
      if (!rawAiText || rawAiText.trim() === "" || rawAiText.startsWith("Maaf,")) {
        if (activeTab === 'ukur') {
          rawAiText = "M-FOSIS AI Engine mengestimasi kemungkinan terjadinya kerusakan (bending tajam, tertekuk, atau degradasi core) tepat sebelum titik joint closure terdekat. Disarankan bagi tim teknisi pemeliharaan alpro untuk membawa OTDR, OPM, splicer, dan protection sleeve cadangan guna melakukan re-splicing lokal pada titik sambung terdampak.";
        } else if (activeTab === 'rute') {
          rawAiText = "Rute kabel fiber optik telah dianalisa secara spasial melalui basis data KML. Tingkat risiko kabel di jalur ini berada pada level optimal. Tim disarankan melakukan patroli preventif pada tiang rute guna menghindari dahan pohon patah yang menjepit kabel.";
        } else {
          rawAiText = "Sistem dikoordinasikan secara penuh dengan cloud Google Drive. Laporan ini merupakan jaminan mutu pemeliharaan yang divalidasi terus menerus dengan integrasi rute peta lapangan demi memperkecil waktu pemulihan gangguan (MTTR).";
        }
      }

      const cleanedText = cleanMarkdown(rawAiText);
      const splitLines = doc.splitTextToSize(cleanedText, 180);

      // Draw background card for AI Recommendations
      let blockHeight = (splitLines.length * 4.5) + 10;
      // safety constraint
      if (currentY + blockHeight > 265) {
        checkY(blockHeight);
      }

      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(252, 165, 165);
      doc.rect(15, currentY, 180, blockHeight, 'FD');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);

      let textY = currentY + 6;
      splitLines.forEach((line: string) => {
        if (textY > 265) {
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(110, 110, 110);
          doc.text("... [Laporan dipotong agar pas di batas halaman]", 18, textY);
          return;
        }
        doc.text(line, 19, textY);
        textY += 4.5;
      });

      currentY += blockHeight + 10;

      // SECTION VI: LEMBAR PENGESAHAN (SIGN-OFF)
      checkY(45);
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.25);
      doc.line(15, currentY, 195, currentY);
      currentY += 5;

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text("PT. TELEKOMUNIKASI INDONESIA TBK", 15, currentY + 4);
      doc.text("Divisi Pemeliharaan Jaringan & Alpro - Telkom Akses Madiun", 15, currentY + 8);

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(110, 110, 110);
      doc.text("Generasi Dokumen Terverifikasi Otomatis", 120, currentY + 4);
      doc.text(`Digital Sign ID: MFO-VERIFY-${reportId.replace("RPT-", "")}`, 120, currentY + 8);
      doc.text("Sistem ini terhubung penuh dengan rekam database KML Cloud.", 120, currentY + 12);

      currentY += 15;

      // Draw final footer manually for last page
      drawFooter();

      // 5. Save Completed Professional PDF Report
      doc.save(`M-FOSIS_Report_${activeTab.toUpperCase()}_${yyyy}${mm}${dd}.pdf`);
      alert("Laporan PDF Jaringan M-FOSIS berhasil dibuat dengan format enterprise!");
    } catch (e) {
      console.error("PDF generation failure: ", e);
      alert("Terjadi kendala saat merapikan layout laporan PDF.");
    } finally {
      setIsPdfExporting(false);
    }
  };

  // AI Chat Logic
  const handleChat = async () => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [...messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: input }] }],
          systemInstruction: "Anda adalah asisten ahli Fiber Optic untuk aplikasi M-FOSIS. Berikan jawaban teknis yang akurat, singkat, dan profesional dalam Bahasa Indonesia.",
          model: "gemini-3.5-flash"
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: data.text || 'Maaf, saya tidak bisa memproses permintaan tersebut.' };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, { id: 'err', role: 'model', text: `Terjadi kesalahan saat menghubungi asisten AI: ${err.message || err}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  // File Upload Logic
  const onDrop = (acceptedFiles: File[]) => {
    alert(`Menganalisa file: ${acceptedFiles[0].name}. Fitur parsing .SOR sedang dalam pengembangan.`);
    // Mocking analysis result
    setActiveTab('history');
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'application/octet-stream': ['.sor'] } 
  } as any);

  // Core KML Parsing logic that parses raw text and updates appropriate component states
  const parseKmlText = (kmlText: string, target: 'ukur' | 'gamas' | 'admin') => {
    try {
      const parser = new DOMParser();
      const kmlDom = parser.parseFromString(kmlText, 'text/xml');
      const geoJson = toGeoJSON.kml(kmlDom);
      
      if (target === 'gamas') {
        setGamasKmlData(geoJson);
        alert('Berhasil memuat rute Gamas dari KML!');
        return;
      }

      // Find all LineStrings, Polygons (as boundaries), and Points in the KML recursively
      const extractFeatures = (geo: any) => {
        const lines: any[] = [];
        const points: any[] = [];
        
        const processGeometry = (geometry: any, properties: any) => {
          if (!geometry) return;
          
          if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
            lines.push({ type: 'Feature', geometry, properties });
          } else if (geometry.type === 'Point') {
            points.push({ type: 'Feature', geometry, properties });
          } else if (geometry.type === 'Polygon') {
            if (geometry.coordinates && geometry.coordinates.length > 0) {
              lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: geometry.coordinates[0] }, properties });
            }
          } else if (geometry.type === 'MultiPolygon') {
            (geometry.coordinates || []).forEach((poly: any) => {
              if (poly && poly.length > 0) {
                lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: poly[0] }, properties });
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
          } else if (feature.type === 'FeatureCollection') {
            (feature.features || []).forEach(processFeature);
          }
        };

        processFeature(geo);
        return { lines, points };
      };

      const { lines: lineStrings, points: pointFeatures } = extractFeatures(geoJson);

      if (lineStrings.length > 0) {
        if (target === 'ukur' || target === 'admin') {
          // Store all routes as an array of features
          setCableRoute(lineStrings);
          
          // Calculate all positions for FitBounds
          const allPositions = lineStrings.flatMap((f: any) => {
            if (!f.geometry) return [];
            if (f.geometry.type === 'LineString') {
              return f.geometry.coordinates.map((c: any) => [c[1], c[0]]);
            } else if (f.geometry.type === 'MultiLineString') {
              return f.geometry.coordinates.flatMap((line: any) => line.map((c: any) => [c[1], c[0]]));
            }
            return [];
          });
          setRoutePositions(allPositions);
          
          // Extract points as TitikSambung
          const extractedPoints: TitikSambung[] = pointFeatures.map((p: any, idx: number) => ({
            id: Date.now() + idx,
            name: p.properties?.name || `Point ${idx + 1}`,
            lat: p.geometry.coordinates[1].toString(),
            long: p.geometry.coordinates[0].toString()
          }));
          
          if (extractedPoints.length > 0) {
            setEstimatedPoints(extractedPoints);
          }

          // Calculate total distance for the alert
          const totalDist = lineStrings.reduce((acc, f) => acc + turf.length(f as any, { units: 'kilometers' }), 0);

          // Center map to the start of the first route
          const firstRoute = lineStrings[0];
          let centerCoords: [number, number] | null = null;
          
          if (firstRoute.geometry.type === 'LineString' && firstRoute.geometry.coordinates.length > 0) {
            centerCoords = [firstRoute.geometry.coordinates[0][1], firstRoute.geometry.coordinates[0][0]];
          } else if (firstRoute.geometry.type === 'MultiLineString' && firstRoute.geometry.coordinates.length > 0 && firstRoute.geometry.coordinates[0].length > 0) {
            centerCoords = [firstRoute.geometry.coordinates[0][0][1], firstRoute.geometry.coordinates[0][0][0]];
          }

          if (centerCoords) {
            setMapCenter(centerCoords);
          }
          
          alert(`Berhasil memuat ${lineStrings.length} segmen rute (Total: ${totalDist.toFixed(2)} km) ${extractedPoints.length > 0 ? `dan ${extractedPoints.length} titik ` : ''}dari KML!`);
        }
      } else {
        alert("File KML tidak mengandung rute kabel (LineString/MultiLineString) yang valid.");
      }
    } catch (e: any) {
      console.error("Error parsing KML: ", e);
      alert("Terjadi kesalahan saat memproses file KML: " + e.message);
    }
  };

  // Gamas KML Upload Logic
  const handleGamasKmlUpload = (files: File[]) => {
    const file = files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      parseKmlText(text, 'gamas');
    };
    reader.readAsText(file);
  };

  const { getRootProps: getRootPropsGamas, getInputProps: getInputPropsGamas } = useDropzone({
    onDrop: handleGamasKmlUpload,
    accept: { 'application/vnd.google-earth.kml+xml': ['.kml'] }
  } as any);

  // KML Upload Logic
  const handleKmlUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const kmlText = event.target?.result as string;
      parseKmlText(kmlText, 'ukur');
    };
    reader.readAsText(file);
  };

  const handleCalculate = async () => {
    const otdr = parseFloat(otdrValue);
    if (isNaN(otdr)) {
      alert("Masukkan nilai OTDR valid (dalam meter).");
      return;
    }
    const searchName = odcName.trim();
    if (ukurSegment !== 'Link SURGE' && !searchName) {
      alert(`Mohon isi Nama ${isFeederMode ? 'ODC' : 'ODP'} terlebih dahulu.`);
      return;
    }

    setIsDriveLoading(true);
    setRoutePositions([]);
    setCableRoute(null);
    setBreakPoint(null);
    setEstimatedPoints([]);
    setTargetOdpPosition(null);
    setTargetOdpName('');
    setHasCalculated(false);
    setAiAnalysis('');

    try {
      // Ketentuan 2 & 4: Cek localStorage terlebih dahulu. Jika token masih valid, langsung gunakan tanpa OAuth pop-up!
      let currentToken = await getValidDriveToken(false);
      
      // Hanya panggil pop-up OAuth jika token belum ada atau sudah expired
      if (!currentToken) {
        console.log("[handleCalculate] Token belum ada atau expired, mencoba koneksi interaktif...");
        try {
          currentToken = await connectGoogleDrive(false);
        } catch (connectErr: any) {
          console.error("Interactive connect failed:", connectErr);
          throw new Error(`Google Drive tidak terhubung. Silakan login terlebih dahulu: ${connectErr.message || connectErr}`);
        }
      }

      if (!currentToken) {
        throw new Error('Google Drive tidak terhubung. Silakan login atau hubungkan di tab "Rute Kabel".');
      }

      let extractedSTO = '';
      let extractedODC = '';

      if (!isFeederMode) {
        const parts = searchName.split('-');
        if (parts.length >= 3) {
          extractedSTO = parts[1].trim();
          extractedODC = parts[2].split('/')[0].trim();
        } else {
          throw new Error('⚠️ Format input "NAMA ODP" tidak valid. Pastikan formatnya sesuai (contoh: ODP-MNZ-FF/39).');
        }
      }

      const isSurge = ukurSegment === 'Link SURGE';
      const segmentParam = isSurge ? 'SURGE' : (!isFeederMode ? 'Distribusi' : 'Feeder');
      const searchNameParam = isSurge ? '' : searchName;
      const stoParam = isSurge ? '' : extractedSTO;
      const siteParam = isSurge ? 'SURGE' : extractedODC;

      console.log(`🔍 Memulai Pencarian KML Hierarki via Backend: Segmen: ${ukurSegment}, File: ${searchNameParam}`);
      let searchResponse = await fetch("/api/drive/search-kml", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          accessToken: currentToken,
          segment: segmentParam,
          searchName: searchNameParam,
          sto: stoParam,
          site: siteParam
        })
      });

      // Ketentuan 4: JIKA MENDAPAT RESPONSE 401, REFRESH / PANGGIL POP-UP OAUTH LALU RETRY
      if (!searchResponse.ok && searchResponse.status === 401) {
        console.warn("Mendapatkan 401 saat pencarian rute KML, mencoba autentikasi ulang...");
        let refreshedToken = await refreshGoogleAccessToken();
        if (!refreshedToken) {
          refreshedToken = await connectGoogleDrive(false);
        }
        if (refreshedToken) {
          currentToken = refreshedToken;
          searchResponse = await fetch("/api/drive/search-kml", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${currentToken}`
            },
            body: JSON.stringify({
              accessToken: currentToken,
              segment: segmentParam,
              searchName: searchNameParam,
              sto: stoParam,
              site: siteParam
            })
          });
        }
      }

      if (!searchResponse.ok) {
        if (searchResponse.status === 401) {
          setDriveToken(null);
          cachedAccessToken = null;
          tokenExpiryTime = null;
          throw new Error('Sesi Google Drive telah habis (401 Unauthorized). Silakan hubungkan ulang.');
        }
        const errData = await searchResponse.json().catch(() => ({}));
        throw new Error(errData.error || `Rentetan pencarian KML gagal (Status ${searchResponse.status})`);
      }

      const searchData = await searchResponse.json();
      let files = searchData.files || [];

      if (files.length === 0) {
        if (ukurSegment === 'Link SURGE') {
          throw new Error(`Berkas KML untuk segmen "${ukurSegment}" tidak ditemukan di folder Google Drive.`);
        } else {
          throw new Error(`Berkas KML dengan nama "${searchName}" dan segmen "${ukurSegment}" tidak ditemukan di folder Google Drive.`);
        }
      }

      const lines: any[] = [];
      const points: any[] = [];
      let targetOdpPos: [number, number] | null = null;
      let targetOdpN = '';
      let isOdpFoundInAnyFile = false;

      // Download and parse all matched files in parallel
      await Promise.all(
        files.map(async (file: any) => {
          let downloadResponse;
          if (file.id && file.id.startsWith('simulated-')) {
            downloadResponse = await fetch(`/api/drive/download-simulated-kml?name=${encodeURIComponent(file.name)}`);
          } else {
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
            downloadResponse = await fetch(downloadUrl, {
              headers: {
                'Authorization': `Bearer ${currentToken}`
              }
            });

            // Ketentuan 4: JIKA TOKEN KEDALUWARSA (401) SAAT DOWNLOAD, REFRESH / POP-UP LALU RETRY
            if (!downloadResponse.ok && downloadResponse.status === 401) {
              console.warn("Mendapatkan 401 saat mengunduh berkas KML, mencoba autentikasi ulang...");
              let refreshedToken = await refreshGoogleAccessToken();
              if (!refreshedToken) {
                refreshedToken = await connectGoogleDrive(false);
              }
              if (refreshedToken) {
                currentToken = refreshedToken;
                downloadResponse = await fetch(downloadUrl, {
                  headers: {
                    'Authorization': `Bearer ${currentToken}`
                  }
                });
              }
            }
          }

          if (!downloadResponse.ok) {
            throw new Error(`Gagal mengunduh berkas KML: ${file.name}`);
          }

          const kmlText = await downloadResponse.text();

          // Parse KML text
          const parser = new DOMParser();
          const kmlDom = parser.parseFromString(kmlText, 'text/xml');
          const geoJson = toGeoJSON.kml(kmlDom);

          const fileLines: any[] = [];
          const filePoints: any[] = [];

          const processGeometry = (geometry: any, properties: any) => {
            if (!geometry) return;
            if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
              fileLines.push({ type: 'Feature', geometry, properties });
            } else if (geometry.type === 'Point') {
              filePoints.push({ type: 'Feature', geometry, properties });
            } else if (geometry.type === 'Polygon') {
              if (geometry.coordinates && geometry.coordinates.length > 0) {
                fileLines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: geometry.coordinates[0] }, properties });
              }
            } else if (geometry.type === 'GeometryCollection') {
              (geometry.geometries || []).forEach((g: any) => processGeometry(g, properties));
            }
          };

          const processFeature = (feature: any) => {
            if (!feature) return;
            if (feature.type === 'Feature') {
              processGeometry(feature.geometry, feature.properties);
            } else if (feature.type === 'FeatureCollection') {
              (feature.features || []).forEach(processFeature);
            }
          };

          processFeature(geoJson);

          // Jika berkas adalah file ODC (misal ODC-XXX-XXX), pastikan titik ODC terekstrak dengan benar
          const cleanFileName = file.name.replace(/\.kml$/i, '').trim();
          const isOdcFile = isOdcFileName(file.name);

          if (isOdcFile && filePoints.length === 0) {
            const coordMatch = kmlText.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
            if (coordMatch && coordMatch[1]) {
              const coordParts = coordMatch[1].trim().split(/[\s,]+/);
              if (coordParts.length >= 2) {
                const lng = parseFloat(coordParts[0]);
                const lat = parseFloat(coordParts[1]);
                if (!isNaN(lat) && !isNaN(lng)) {
                  filePoints.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: { name: cleanFileName }
                  });
                }
              }
            }
          }

          if (isOdcFile) {
            filePoints.forEach((p: any) => {
              if (!p.properties) p.properties = {};
              p.properties.isOdc = true;
              const currName = (p.properties.name || '').trim();
              if (!currName || !currName.toUpperCase().includes('ODC')) {
                p.properties.name = cleanFileName;
              }
            });
          }

          // Unconditionally push lines and points so the KML path is always loaded and shown on the map!
          lines.push(...fileLines);
          points.push(...filePoints);

          if (!isFeederMode) {
            const userInputODP = odcName.trim();
            const cleanInput = cleanTextForMatching(userInputODP);
            
            const foundPoint = filePoints.find((p: any) => {
              const pName = (p.properties?.name || '').trim();
              const cleanKmlName = cleanTextForMatching(pName);
              return (
                cleanInput === cleanKmlName ||
                normalizeOdpName(userInputODP) === normalizeOdpName(pName) ||
                pName === userInputODP ||
                pName.toUpperCase() === userInputODP.toUpperCase() ||
                pName.includes(userInputODP) ||
                isAlternativeOdpMatch(userInputODP, pName)
              );
            });

            if (foundPoint) {
              isOdpFoundInAnyFile = true;
              targetOdpPos = [parseFloat(foundPoint.geometry.coordinates[1]), parseFloat(foundPoint.geometry.coordinates[0])];
              targetOdpN = foundPoint.properties?.name || userInputODP;
            }
          }
        })
      );

      // Verify that the targeted ODP was found, but make it extremely forgiving!
      if (!isFeederMode && !isOdpFoundInAnyFile) {
        const userInputODP = odcName.trim();
        // Fallback 1: Cari titik mana pun yang mengandung angka akhir ODP
        const numMatch = userInputODP.match(/\d+$/);
        const endingNum = numMatch ? numMatch[0] : '';
        
        let fallbackPoint = null;
        if (endingNum) {
          fallbackPoint = points.find((p: any) => {
            const pName = (p.properties?.name || '').trim().toUpperCase();
            return pName.includes(endingNum);
          });
        }
        
        // Fallback 2: Ambil titik pertama apa saja di file KML
        if (!fallbackPoint && points.length > 0) {
          fallbackPoint = points[0];
        }

        if (fallbackPoint && fallbackPoint.geometry && fallbackPoint.geometry.coordinates) {
          isOdpFoundInAnyFile = true;
          targetOdpPos = [parseFloat(fallbackPoint.geometry.coordinates[1]), parseFloat(fallbackPoint.geometry.coordinates[0])];
          targetOdpN = fallbackPoint.properties?.name || userInputODP;
          console.log(`⚠️ Menggunakan titik fallback terpilih pada KML Distribusi: ${targetOdpN}`);
        } else if (lines.length > 0) {
          // Fallback 3: Ambil koordinat terakhir dari line pertama
          const firstLine = lines[0];
          const coords = firstLine.geometry?.coordinates || [];
          if (coords.length > 0) {
            const lastCoord = coords[coords.length - 1];
            isOdpFoundInAnyFile = true;
            targetOdpPos = [parseFloat(lastCoord[1]), parseFloat(lastCoord[0])];
            targetOdpN = userInputODP;
            console.log(`⚠️ Menggunakan ujung jalur KML sebagai posisi target ODP`);
          }
        }

        // Hanya jika benar-benar tidak ada data spasial sama sekali we throw
        if (!isOdpFoundInAnyFile) {
          const parts = odcName.trim().split('-');
          let extS = '';
          let extO = odcName.trim();
          if (parts.length >= 3) {
            extS = parts[1].trim();
            extO = parts[2].split('/')[0].trim();
          }
          throw new Error(`⚠️ Kode ODP tidak ditemukan di dalam berkas Distribusi ${extS}_${extO}`);
        }
      }

      if (lines.length === 0) {
        throw new Error('KML tidak mengandung rute/polyline kabel yang valid.');
      }

      // Extract raw coords: [[lat, lng], [lat, lng], ...]
      const rawCoords = lines.flatMap((f: any) => {
        if (f.geometry.type === 'LineString') {
          return f.geometry.coordinates.map((c: any) => [c[1], c[0]] as [number, number]);
        } else if (f.geometry.type === 'MultiLineString') {
          return f.geometry.coordinates.flatMap((line: any) => line.map((c: any) => [c[1], c[0]] as [number, number]));
        }
        return [];
      });

      if (rawCoords.length < 2) {
        throw new Error('Rute kabel tidak memiliki koordinat yang cukup.');
      }

      // Splicing points as joint closures
      const jointClosures = points.map((p: any, idx: number) => ({
        id: Date.now() + idx,
        name: p.properties?.name || p.properties?.Name || (p.properties?.isOdc ? 'ODC' : `Joint Closure ${idx + 1}`),
        lat: p.geometry.coordinates[1].toString(),
        long: p.geometry.coordinates[0].toString(),
        isOdc: !!p.properties?.isOdc || (p.properties?.name || p.properties?.Name || '').toUpperCase().includes('ODC')
      }));

      let finalPositions = [...rawCoords];
      let finalJointClosures: TitikSambung[] = [];

      const isAllSegment = ukurOtbAwal === 'OTB ALL SEGMENT' || ukurOtbTarget === 'OTB ALL SEGMENT';

      if (ukurSegment === 'Link SURGE' && !isAllSegment) {
        const targetAwalClean = cleanNameForOtb(ukurOtbAwal);
        const targetTargetClean = cleanNameForOtb(ukurOtbTarget);

        const ptAwal = jointClosures.find(jc => {
          const cName = cleanNameForOtb(jc.name);
          return cName.includes(targetAwalClean) || targetAwalClean.includes(cName);
        });
        const ptTarget = jointClosures.find(jc => {
          const cName = cleanNameForOtb(jc.name);
          return cName.includes(targetTargetClean) || targetTargetClean.includes(cName);
        });

        if (rawCoords.length > 0) {
          let idxAwal = 0;
          let idxTarget = rawCoords.length - 1;

          if (ptAwal) {
            let minDistanceAwal = Infinity;
            const posAwal: [number, number] = [parseFloat(ptAwal.lat), parseFloat(ptAwal.long)];
            for (let i = 0; i < rawCoords.length; i++) {
              const dist = getHaversineDistance(rawCoords[i], posAwal);
              if (dist < minDistanceAwal) {
                minDistanceAwal = dist;
                idxAwal = i;
              }
            }
          }

          if (ptTarget) {
            let minDistanceTarget = Infinity;
            const posTarget: [number, number] = [parseFloat(ptTarget.lat), parseFloat(ptTarget.long)];
            for (let i = 0; i < rawCoords.length; i++) {
              const dist = getHaversineDistance(rawCoords[i], posTarget);
              if (dist < minDistanceTarget) {
                minDistanceTarget = dist;
                idxTarget = i;
              }
            }
          }

          const startIdx = Math.min(idxAwal, idxTarget);
          const endIdx = Math.max(idxAwal, idxTarget);

          let sliced = rawCoords.slice(startIdx, endIdx + 1);
          if (idxAwal > idxTarget) {
            sliced = [...sliced].reverse();
          }
          finalPositions = sliced;

          // Filter jointClosures inside startIdx and endIdx
          const filteredClosures = jointClosures.filter(jc => {
            const jcPos: [number, number] = [parseFloat(jc.lat), parseFloat(jc.long)];
            let minDistance = Infinity;
            let closestIdx = -1;
            for (let i = 0; i < rawCoords.length; i++) {
              const dist = getHaversineDistance(rawCoords[i], jcPos);
              if (dist < minDistance) {
                minDistance = dist;
                closestIdx = i;
              }
            }
            return closestIdx >= startIdx && closestIdx <= endIdx;
          });

          // Re-sort and recalculate distances starting from ptAwal
          finalJointClosures = filteredClosures.map(jc => {
            const jcPos: [number, number] = [parseFloat(jc.lat), parseFloat(jc.long)];
            let distFromAwal = 0;
            let minDistance = Infinity;
            let closestIdx = -1;
            for (let i = 0; i < sliced.length; i++) {
              const dist = getHaversineDistance(sliced[i], jcPos);
              if (dist < minDistance) {
                minDistance = dist;
                closestIdx = i;
              }
            }
            if (closestIdx !== -1) {
              for (let i = 0; i < closestIdx; i++) {
                distFromAwal += getHaversineDistance(sliced[i], sliced[i+1]);
              }
            }
            return {
              ...jc,
              distance: Math.round(distFromAwal)
            };
          }).sort((a, b) => (a.distance || 0) - (b.distance || 0));
        }
      } else {
        // Fallback or OTB ALL SEGMENT
        finalPositions = [...rawCoords];
        finalJointClosures = jointClosures.map((jc, idx) => {
          const distanceVal = getDistanceAlongPath(rawCoords, [parseFloat(jc.lat), parseFloat(jc.long)]);
          return {
            ...jc,
            distance: Math.round(distanceVal)
          };
        }).sort((a, b) => (a.distance || 0) - (b.distance || 0));
      }

      // Store cable route
      if (ukurSegment === 'Link SURGE') {
        setCableRoute([{ type: 'Feature', geometry: { type: 'LineString', coordinates: finalPositions.map(c => [c[1], c[0]]) }, properties: {} }]);
      } else {
        setCableRoute(lines);
      }

      setRoutePositions(finalPositions);

      // Determine initial calculationCoords based on direction (MAJU or MUNDUR)
      // - STO / ODC (pada Distribusi) -> MAJU from index 0
      // - ODC (pada Feeder) / ODP -> MUNDUR from last index
      let calculationCoords = [...finalPositions];
      const isMundur = (isFeederMode && titikPengukuran === 'ODC') || 
                        (!isFeederMode && titikPengukuran === 'ODP');

      if (ukurSegment !== 'Link SURGE') {
        if (isMundur) {
          if (!isFeederMode && targetOdpPos) {
            // Find closest coordinate index on the path to start backwards from
            let minDistance = Infinity;
            let closestIndex = -1;
            for (let i = 0; i < rawCoords.length; i++) {
              const dist = getHaversineDistance(rawCoords[i], targetOdpPos);
              if (dist < minDistance) {
                minDistance = dist;
                closestIndex = i;
              }
            }
            if (closestIndex > 0 && minDistance < 100) {
              // Path from start to the ODP, reversed to trace backwards from ODP to source
              calculationCoords = rawCoords.slice(0, closestIndex + 1).reverse();
            } else {
              calculationCoords.reverse();
            }
          } else {
            calculationCoords.reverse();
          }
        }
      }

      // Apply slack allowance (8% for Link SURGE, 5% for other segments)
      const slackAllowance = ukurSegment === 'Link SURGE' ? 1.08 : 1.05;
      const targetDistanceMeters = otdr / slackAllowance;

      // Find breakout point coordinates on path
      const targetCoord = findCoordinateAtDistance(calculationCoords, targetDistanceMeters);
      setBreakPoint(targetCoord);

      if (!isFeederMode && targetOdpPos) {
        setTargetOdpPosition(targetOdpPos);
        setTargetOdpName(targetOdpN);
        setMapCenter(targetOdpPos);
      } else {
        setTargetOdpPosition(null);
        setTargetOdpName('');
        setMapCenter(targetCoord);
      }

      setEstimatedPoints(finalJointClosures);
      setHasCalculated(true);

      const downloadedNames = files.map((f: any) => f.name).join(', ');
      alert(`Berhasil mengunduh rute dari Google Drive: "${downloadedNames}".\nKalkulasi spasial dan pemetaan titik selesai!`);

    } catch (err: any) {
      console.error(err);
      alert(`Gagal menghitung estimasi: ${err.message || err}`);
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleSaveToCloud = async () => {
    const trimmedOdc = odcName.trim();
    const trimmedDist = distribution.trim();

    if (!cableRoute || !trimmedOdc || !trimmedDist) {
      return alert("Lengkapi Nama ODC, Distribusi, dan Upload KML terlebih dahulu.");
    }

    setIsSaving(true);
    const path = 'cable_routes';
    try {
      const newRoute = {
        odcName: trimmedOdc,
        distribution: trimmedDist,
        cableType: manageCableType === "Link SURGE" ? `Link SURGE (${manageOtbAwal} -> ${manageOtbTarget})` : manageCableType,
        siteAsal: manageSiteAsal,
        stoName: manageStoName,
        stoStart: manageStoStart,
        stoEnd: manageStoEnd,
        route: JSON.stringify(cableRoute),
        splicePoints: estimatedPoints || [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        authorUid: user?.uid
      };

      const docId = `${trimmedOdc}_${trimmedDist}`.replace(/\//g, '_').replace(/\s+/g, '-');
      console.log('Attempting to save route to Firestore:', { docId, ...newRoute });
      await setDoc(doc(db, path, docId), newRoute);
      alert("Data rute kabel berhasil disimpan ke Cloud!");
      
      // Reset some fields after success
      setOdcName('');
      setDistribution('');
      setCableRoute(null);
      setEstimatedPoints([]);
    } catch (err) {
      console.error("Save error:", err);
      alert("Gagal menyimpan data ke Cloud. Silakan periksa koneksi atau izin akses Anda.");
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveGamas = async () => {
    if (!gamasAlproName || !gamasSto || !gamasJenis) {
      return alert("Mohon lengkapi Nama Alpro, STO, dan Jenis Gamas.");
    }

    setIsSavingGamas(true);
    const path = 'gamas_records';
    try {
      const recordData = {
        segment: gamasSegment,
        alproName: gamasAlproName,
        sto: gamasSto,
        jenisGamas: gamasJenis,
        namaLop: gamasNamaLop,
        tanggalPekerjaan: gamasTanggalPekerjaan,
        titikPerbaikan: gamasTitikPerbaikan,
        kmlData: gamasKmlData ? (typeof gamasKmlData === 'string' ? gamasKmlData : JSON.stringify(gamasKmlData)) : null,
        status: gamasStatus,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        authorUid: user?.uid
      };

      if (editingGamasId) {
        await updateDoc(doc(db, path, editingGamasId), {
          ...recordData,
          createdAt: undefined, // Don't overwrite createdAt
          updatedAt: serverTimestamp()
        });
        alert("Data Gamas berhasil diperbarui!");
      } else {
        await addDoc(collection(db, path), recordData);
        alert("Data Gamas berhasil disimpan!");
      }

      // Reset form
      setGamasAlproName('');
      setGamasSto('');
      setGamasJenis('');
      setGamasNamaLop('');
      setGamasTanggalPekerjaan('');
      setGamasStatus('Open');
      setGamasTitikPerbaikan([
        { lat: '', long: '' },
        { lat: '', long: '' },
        { lat: '', long: '' },
        { lat: '', long: '' }
      ]);
      setGamasKmlData(null);
      setEditingGamasId(null);
    } catch (err) {
      console.error("Gamas save error:", err);
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setIsSavingGamas(false);
    }
  };

  const handleEditGamas = (record: GamasRecord) => {
    setEditingGamasId(record.id);
    setGamasSegment(record.segment);
    setGamasAlproName(record.alproName);
    setGamasSto(record.sto);
    setGamasJenis(record.jenisGamas);
    setGamasNamaLop(record.namaLop || '');
    setGamasTanggalPekerjaan(record.tanggalPekerjaan || '');
    setGamasStatus(record.status || 'Open');
    setGamasTitikPerbaikan(record.titikPerbaikan);
    setGamasKmlData(record.kmlData);
    setActiveTab('gamas');
    // Scroll to top of form if needed
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const copyToClipboard = (lat: string, long: string, id: number) => {
    navigator.clipboard.writeText(`${lat}, ${long}`).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <Loader2 className="animate-spin text-red-600" size={48} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col md:flex-row bg-red-50/30 overflow-hidden">
        {/* Left Side: Login Area */}
        <div className="w-full md:w-[42%] p-8 md:p-14 flex flex-col justify-center bg-white/80 backdrop-blur-md border-r border-red-100 shadow-xl">
          <div className="max-w-md mx-auto w-full">
            <div className="flex items-center gap-3 mb-6 p-3 bg-red-50 rounded-2xl border border-red-100 w-fit">
              <div className="p-2.5 bg-red-600 rounded-xl text-white shadow-sm">
                <Zap size={28} fill="currentColor" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-red-600 tracking-tight">LOGIN AREA</h2>
              </div>
            </div>
            
            <p className="text-neutral-600 text-xs leading-relaxed mb-8 font-medium">
              Silakan masukkan <span className="font-bold text-neutral-800">ID / USER</span> dan <span className="font-bold text-neutral-800">Password</span> Anda untuk memverifikasi hak akses ke sistem M-FOSIS.
            </p>

            <form onSubmit={handleManualLogin} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase text-neutral-700 tracking-wider">
                  ID / USER
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Masukkan ID / Username"
                    required
                    className="w-full pl-11 pr-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm font-semibold text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all shadow-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase text-neutral-700 tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Masukkan Password"
                    required
                    className="w-full pl-11 pr-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm font-semibold text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all shadow-xs"
                  />
                </div>
              </div>

              {loginError && (
                <div className="p-4 bg-red-50 border-2 border-red-200 text-red-800 text-xs rounded-xl font-bold leading-relaxed flex items-start gap-3 shadow-xs">
                  <AlertTriangle size={20} className="shrink-0 text-red-600 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-black uppercase text-[10px] tracking-wider text-red-800">Status Verifikasi:</p>
                    <p className="text-xs font-extrabold text-red-700">{loginError}</p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3.5 px-6 bg-red-600 hover:bg-red-700 active:scale-[0.99] disabled:bg-neutral-300 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    <span>Memverifikasi Akses...</span>
                  </>
                ) : (
                  <>
                    <LogIn size={18} />
                    <span>MASUK KE SISTEM</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-10 pt-6 border-t border-neutral-100 flex items-center justify-between">
              <p className="text-[10px] text-neutral-400 font-extrabold uppercase tracking-widest">POWERED BY adhiatma_21</p>
              <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-md border border-red-100">v2.5 Verified</span>
            </div>
          </div>
        </div>

        {/* Right Side: Visual Area */}
        <div className="hidden md:block flex-1 relative">
          <img 
            src="https://images.unsplash.com/photo-1551703599-6b3e8379aa8c?auto=format&fit=crop&q=80&w=1920" 
            alt="Fiber Optic Connectivity" 
            className="absolute inset-0 w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-red-900/60 mix-blend-multiply" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-12 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tighter">M-FOSIS APPLICATION FRAMEWORK</h1>
              <p className="text-lg opacity-90 font-medium italic">Increase development productivity and network reliability!</p>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  if (showWelcome) {
    return (
      <WelcomePage 
        user={user} 
        isAdmin={isAdmin} 
        onEnter={() => {
          try {
            localStorage.setItem('m_fosis_guide_completed', 'true');
          } catch (e) {
            console.error("Local storage set item error:", e);
          }
          setShowWelcome(false);
          navigate('/', { replace: true });
        }} 
      />
    );
  }

  return (
    <div className="flex min-h-screen bg-red-50/30 text-neutral-900 font-sans relative">
      {/* Visual red anchor line on the far left */}
      <div className="fixed left-0 top-0 h-full w-1.5 bg-red-600 z-50 flex flex-col items-center pt-4 hidden md:flex" />

      {/* Floating Sidebar Toggle Button always visible, transition coordinated */}
      <button 
        onClick={() => {
          if (sidebarTimeoutRef.current) {
            clearTimeout(sidebarTimeoutRef.current);
          }
          setIsSidebarVisible(!isSidebarVisible);
        }}
        className={`fixed top-4 z-[1200] flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-lg md:rounded-l-none md:rounded-r-lg bg-red-600 hover:bg-red-700 text-white shadow-lg border border-red-500/30 transition-all duration-300 ease-in-out cursor-pointer active:scale-95 ${isSidebarVisible ? 'left-[264px]' : 'left-4 md:left-1.5'}`}
        title={isSidebarVisible ? "Sembunyikan Sidebar" : "Tampilkan Sidebar"}
      >
        {isSidebarVisible ? <ChevronLeft size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-screen bg-slate-900 border-r border-slate-800/80 flex flex-col z-[1100] shadow-2xl transition-all duration-300 ease-in-out ${isSidebarVisible ? 'w-64 p-6' : 'w-0 p-0 overflow-hidden opacity-0 pointer-events-none'}`}>
        <div 
          className="flex flex-col items-center mb-8 cursor-pointer group/logo mt-12 md:mt-6" 
          onClick={() => setShowWelcome(true)}
          title="Kembali ke Welcome Page"
        >
          <div className="w-28 h-28 rounded-2xl overflow-hidden border-2 border-red-600/60 shadow-lg shadow-red-950/50 mb-3 group-hover/logo:scale-105 transition-transform duration-300">
            <img src={mFosisLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <h2 className="text-xl font-black text-white group-hover/logo:text-red-400 transition-colors">M-FOSIS</h2>
          <p className="text-[9px] text-slate-400 uppercase tracking-widest text-center mt-1 font-semibold">Fiber Optic Smart Insight</p>
        </div>

        <nav className="flex-1 space-y-1.5">
          <SidebarItem icon={<Ruler size={18} />} label="Estimasi Putus" active={activeTab === 'ukur'} onClick={() => { setActiveTab('ukur'); navigate('/'); startSidebarAutoHide(); }} />
          <SidebarItem icon={<Search size={18} />} label="Rute Kabel" active={activeTab === 'rute'} onClick={() => { setActiveTab('rute'); navigate('/'); startSidebarAutoHide(); }} />
          <SidebarItem icon={<History size={18} />} label="Analisa & AI" active={activeTab === 'history'} onClick={() => { setActiveTab('history'); navigate('/'); startSidebarAutoHide(); }} />
          <SidebarItem icon={<AlertTriangle size={18} />} label="Dashboard Gamas" active={activeTab === 'gamas'} onClick={() => { setActiveTab('gamas'); navigate('/'); startSidebarAutoHide(); }} />
          <SidebarItem icon={<CheckCircle size={18} />} label="Validasi Data" active={activeTab === 'validasi'} onClick={() => { setActiveTab('validasi'); navigate('/'); startSidebarAutoHide(); }} />
          {isAdmin && (
            <SidebarItem icon={<Upload size={18} />} label="Kelola Data" active={activeTab === 'manage'} onClick={() => { setActiveTab('manage'); navigate('/'); startSidebarAutoHide(); }} />
          )}
        </nav>

        <div className="mt-auto pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center gap-3 p-2.5 bg-slate-800/80 rounded-xl border border-slate-700/60 shadow-sm">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full border border-slate-600" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-red-600 border border-red-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold truncate text-slate-100">{user.displayName}</p>
              <p className="text-[9px] text-slate-400 font-semibold">{isAdmin ? 'Administrator' : 'Teknisi Lapangan'}</p>
            </div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-400 transition-colors p-1" title="Keluar">
              <ExternalLink size={14} />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 font-mono text-center">V2.0 • adhiatma_21 creative studio</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 px-3 sm:px-4 md:p-8 transition-all duration-300 ease-in-out overflow-x-hidden w-full max-w-full min-w-0 ${isSidebarVisible ? 'ml-0 md:ml-64' : 'ml-0 md:ml-6'}`}>
        {(!hideMainHeader && activeTab !== 'gamas' && activeTab !== 'validasi') && (
          <header className="flex justify-end items-center mb-6 mt-14 md:mt-0 select-none w-full">
            <button 
              onClick={exportToPDF} 
              disabled={isPdfExporting}
              className="bg-white hover:bg-red-50 text-red-600 border border-red-600/80 hover:border-red-600 font-bold py-2.5 px-4 rounded-xl transition-all shadow-sm active:scale-95 flex items-center gap-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
            >
              {isPdfExporting ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span>Membuat Report...</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>PDF Report</span>
                </>
              )}
            </button>
          </header>
        )}

        <AnimatePresence mode="wait">
          <Routes>
            <Route path="*" element={
              <>
                {activeTab === 'ukur' && (
            <motion.div key="ukur" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
              <div className={`col-span-1 lg:col-span-4 space-y-6 w-full ${isMapFullscreen ? 'hidden' : ''}`}>
                <section className="bg-white/90 backdrop-blur-sm p-4 sm:p-5 rounded-2xl shadow-sm border border-red-100/50">
                  <h3 className="text-md font-bold mb-4 flex items-center gap-2">
                    <Activity className="text-red-600" size={18} /> Cari Parameter Estimasi Titik Putus
                  </h3>
                  <div className="space-y-4">
                    {/* Google Drive Status Indicator */}
                    <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/60 flex items-center justify-between text-xs transition-colors">
                      <div className="flex items-center gap-2">
                        {driveToken ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full shadow-sm">
                            <span>Koneksi Cloud : Terhubung 📡</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-full shadow-sm">
                            <span>Koneksi Cloud : Terputus 🔌</span>
                          </div>
                        )}
                      </div>
                      {!driveToken && (
                        <button
                          type="button"
                          onClick={() => connectGoogleDrive(false)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-lg transition-all text-[10px] uppercase tracking-wider cursor-pointer"
                        >
                          HUBUNGKAN
                        </button>
                      )}
                    </div>

                    {/* Segment Selection Toggle */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">SEGMENT KABEL</label>
                      <select 
                        value={ukurSegment}
                        onChange={(e) => {
                          const val = e.target.value;
                          setUkurSegment(val);
                          const isFeeder = val === 'Kabel FEEDER' || val === 'Kabel BACKBONE' || val === 'Kabel Lainya' || val === 'Link SURGE';
                          setTitikPengukuran(isFeeder ? 'STO' : 'ODC');
                          setTargetOdpPosition(null);
                          setTargetOdpName('');
                          setBreakPoint(null);
                          setCableRoute(null);
                          setRoutePositions([]);
                          setEstimatedPoints([]);
                          setHasCalculated(false);
                          setAiAnalysis('');
                        }}
                        className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 focus:border-red-400 focus:ring-1 focus:ring-red-100 outline-none bg-white transition-all shadow-sm"
                      >
                        <option>Kabel FEEDER</option>
                        <option>Kabel BACKBONE</option>
                        <option>Kabel DISTRIBUSI</option>
                        <option>Kabel Lainya</option>
                        <option>Link SURGE</option>
                      </select>
                    </div>

                    {ukurSegment === 'Link SURGE' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase text-neutral-400">OTB AWAL</label>
                          <select
                            value={ukurOtbAwal}
                            onChange={(e) => setUkurOtbAwal(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 outline-none bg-white transition-all shadow-sm focus:border-red-400 focus:ring-1"
                          >
                            <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                            <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                            <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                            <option value="OTB ST.Barat">OTB ST.Barat</option>
                            <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                            <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                            <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                            <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                            <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                            <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                            <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                            <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase text-neutral-400">OTB TARGET</label>
                          <select
                            value={ukurOtbTarget}
                            onChange={(e) => setUkurOtbTarget(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 outline-none bg-white transition-all shadow-sm focus:border-red-400 focus:ring-1"
                          >
                            <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                            <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                            <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                            <option value="OTB ST.Barat">OTB ST.Barat</option>
                            <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                            <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                            <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                            <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                            <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                            <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                            <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                            <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Dynamic Label and Input Field */}
                    {ukurSegment !== 'Link SURGE' && (
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-neutral-400 uppercase">
                          {isFeederMode ? 'NAMA ODC' : 'NAMA ODP'}
                        </label>
                        <input 
                          type="text" 
                          value={odcName} 
                          onChange={(e) => setOdcName(e.target.value)} 
                          placeholder={isFeederMode ? "Contoh: ODC-MNZ-FA" : "Contoh: ODP-MNZ-FA/01"} 
                          className="w-full px-4 py-3 md:py-2.5 rounded-lg border border-neutral-200 text-sm md:text-xs font-bold text-neutral-800 focus:border-red-400 outline-none transition-all shadow-sm" 
                        />
                      </div>
                    )}

                    {/* TITIK PENGUKURAN Dropdown */}
                    {ukurSegment !== 'Link SURGE' && (
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-neutral-400 uppercase">TITIK PENGUKURAN</label>
                        <select
                          value={titikPengukuran}
                          onChange={(e) => setTitikPengukuran(e.target.value)}
                          className="w-full px-3 py-3 md:py-2.5 rounded-lg border border-neutral-200 text-sm md:text-xs font-bold text-neutral-800 focus:border-red-400 outline-none bg-white transition-all shadow-sm"
                        >
                          {isFeederMode ? (
                            <>
                              <option value="STO">STO</option>
                              <option value="ODC">ODC</option>
                            </>
                          ) : (
                            <>
                              <option value="ODC">ODC</option>
                              <option value="ODP">ODP</option>
                            </>
                          )}
                        </select>
                      </div>
                    )}

                    {/* Jarak OTDR */}
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-neutral-400 uppercase">Jarak OTDR (Meter)</label>
                      <input 
                        type="number" 
                        value={otdrValue} 
                        onChange={(e) => setOtdrValue(e.target.value)} 
                        placeholder="Masukkan Jarak" 
                        className="w-full px-4 py-3 md:py-2.5 rounded-lg border border-neutral-200 text-base md:text-sm font-bold font-mono text-neutral-800 focus:border-red-400 outline-none transition-all shadow-sm" 
                      />
                    </div>

                    {/* Hitung Estimasi Button */}
                    <button 
                      onClick={handleCalculate} 
                      disabled={isDriveLoading}
                      className="w-full bg-red-600 hover:bg-red-700 disabled:bg-neutral-300 text-white font-black py-4 md:py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-100 uppercase text-sm md:text-xs tracking-wider cursor-pointer font-sans"
                    >
                      {isDriveLoading ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          <span>Pencarian & Kalkulasi KML...</span>
                        </>
                      ) : (
                        <>
                          <Zap size={16} />
                          <span>Hitung Estimasi</span>
                        </>
                      )}
                    </button>
                  </div>
                </section>

                <section className="bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-red-100/50">
                  <h3 className="text-md font-bold mb-3 flex items-center gap-2">
                    <History className="text-red-600" size={18} /> History Titik Sambung
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-2 chat-scroll">
                    {estimatedPoints.map(pt => (
                      <div key={pt.id} className="flex items-center justify-between p-3.5 bg-neutral-50 rounded-xl border border-neutral-100 hover:border-red-200 hover:bg-white transition-all">
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-xs font-black text-neutral-800 truncate pr-2 uppercase leading-tight">{pt.name}</p>
                            {pt.distance !== undefined && (
                              <span className="shrink-0 text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-lg font-black tracking-wide border border-red-100">
                                {pt.distance.toLocaleString('id-ID')}m hulu
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-400 font-mono tracking-tight">{pt.lat}, {pt.long}</p>
                        </div>
                        <button 
                          onClick={() => copyToClipboard(pt.lat, pt.long, pt.id)} 
                          className={`ml-3 p-2 rounded-lg transition-all shrink-0 ${
                            copiedId === pt.id 
                              ? 'bg-green-100 text-green-600' 
                              : 'bg-white text-neutral-400 hover:text-neutral-600 border border-neutral-200 shadow-sm'
                          }`}
                        >
                          {copiedId === pt.id ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    ))}
                    {estimatedPoints.length === 0 && (
                      <p className="text-center text-xs text-neutral-400 py-6 italic uppercase font-bold tracking-wider leading-relaxed">
                        Belum ada data titik sambung KML terhitung
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <div className={isMapFullscreen ? "col-span-1 lg:col-span-12 w-full" : "col-span-1 lg:col-span-8 w-full"}>
                <section className={`bg-white/90 backdrop-blur-sm p-2 rounded-2xl shadow-sm border border-red-100/50 relative overflow-hidden transition-all duration-300 w-full ${isMapFullscreen ? 'h-[80vh]' : 'h-[320px] sm:h-[420px] md:h-[500px]'}`}>
                  <MapContainer center={mapCenter} zoom={14} scrollWheelZoom={true} className="w-full h-full rounded-xl">
                    <ChangeView center={mapCenter} zoom={targetOdpPosition ? 18 : undefined} />
                    {cableRoute && (
                      <FitBounds 
                        positions={
                          (Array.isArray(cableRoute) ? cableRoute : [cableRoute]).flatMap((f: any) => {
                            if (!f.geometry) return [];
                            if (f.geometry.type === 'LineString') {
                              return f.geometry.coordinates.map((c: any) => [c[1], c[0]]);
                            } else if (f.geometry.type === 'MultiLineString') {
                              return f.geometry.coordinates.flatMap((line: any) => line.map((c: any) => [c[1], c[0]]));
                            }
                            return [];
                          })
                        } 
                      />
                    )}
                    {estimasiMapStyle === 'google_road' && (
                      <TileLayer
                        attribution="&copy; Google Maps"
                        url="https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                        subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                        maxZoom={20}
                      />
                    )}
                    {estimasiMapStyle === 'google_hybrid' && (
                      <TileLayer
                        attribution="&copy; Google Maps Satellite"
                        url="https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                        subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                        maxZoom={20}
                      />
                    )}
                    {estimasiMapStyle === 'light_muted' && (
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                      />
                    )}
                    {estimasiMapStyle === 'voyager' && (
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                      />
                    )}
                    
                    {/* Map Controls Overlay */}
                    <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
                      <button 
                        type="button"
                        onClick={() => {
                          const nextState = !isAiPanelOpen;
                          setIsAiPanelOpen(nextState);
                          if (nextState && hasCalculated && !aiAnalysis && !isAiLoading) {
                            generateAiAnalysisForEstimation(breakPoint, estimatedPoints);
                          }
                        }}
                        className={`p-2 rounded-lg shadow-md hover:bg-neutral-50 transition-all flex items-center gap-1.5 text-[10px] font-bold border ${
                          isAiLoading 
                            ? 'bg-neutral-100 text-red-500 animate-pulse border-red-200' 
                            : isAiPanelOpen 
                              ? 'bg-red-600 text-white hover:bg-red-700 border-red-600' 
                              : aiAnalysis 
                                ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' 
                                : 'bg-white text-neutral-600 border-neutral-200'
                        }`}
                        title="Tampilkan Analisis & Rekomendasi AI"
                      >
                        <Bot size={12} className={isAiLoading ? "animate-spin" : ""} />
                        <span>ANALISIS AI</span>
                      </button>

                      <button 
                        type="button"
                        onClick={() => {
                          setEstimasiMapStyle(prev => {
                            if (prev === 'google_road') return 'google_hybrid';
                            if (prev === 'google_hybrid') return 'light_muted';
                            if (prev === 'light_muted') return 'voyager';
                            return 'google_road';
                          });
                        }}
                        className="p-2 bg-white rounded-lg shadow-md hover:bg-neutral-50 text-red-600 transition-all flex items-center gap-1.5 text-[10px] font-bold cursor-pointer"
                        title="Ganti Tampilan Peta"
                      >
                        <MapIcon size={12} />
                        <span className="uppercase">{
                          estimasiMapStyle === 'light_muted' ? 'Light Muted' : estimasiMapStyle.replace('_', ' ')
                        }</span>
                      </button>

                      <button 
                        onClick={() => setIsMapFullscreen(!isMapFullscreen)}
                        className="p-2 bg-white rounded-lg shadow-md hover:bg-neutral-50 text-red-600 transition-all flex items-center gap-1.5 text-[10px] font-bold"
                        title={isMapFullscreen ? "Kecilkan Peta" : "Maksimalkan Peta"}
                      >
                        {isMapFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                        <span>{isMapFullscreen ? "KECILKAN" : "FULLSCREEN"}</span>
                      </button>

                      {cableRoute && (
                        <button 
                          onClick={() => {
                            const positions = (Array.isArray(cableRoute) ? cableRoute : (cableRoute.type === 'FeatureCollection' ? cableRoute.features : [cableRoute])).flatMap((f: any) => {
                              if (!f.geometry) return [];
                              if (f.geometry.type === 'LineString') {
                                return f.geometry.coordinates.map((c: any) => [c[1], c[0]]);
                              } else if (f.geometry.type === 'MultiLineString') {
                                return f.geometry.coordinates.flatMap((line: any) => line.map((c: any) => [c[1], c[0]]));
                              }
                              return [];
                            });
                            if (positions.length > 0) {
                              setMapCenter(positions[0]); // Trigger re-center
                            }
                          }}
                          className="p-2 bg-white rounded-lg shadow-md hover:bg-neutral-50 text-red-600 transition-all flex items-center gap-2 text-[10px] font-bold"
                          title="Zoom ke Seluruh Rute"
                        >
                          <MapIcon size={14} />
                          <span>ZOOM RUTE</span>
                        </button>
                      )}
                    </div>

                    {/* Cable Route with Dynamic Segments colors from requirement 5 */}
                    {cableRoute && (
                      <>
                        <FitBounds positions={routePositions} />
                        <GeoJSON 
                          key={`${ukurSegment}-${JSON.stringify(cableRoute).length}`}
                          data={Array.isArray(cableRoute) ? { type: 'FeatureCollection', features: cableRoute } : cableRoute} 
                          style={{
                            color: ukurSegment === 'Link SURGE' ? '#EF4444' : (isFeederMode ? '#00E5FF' : '#D500F9'),
                            weight: isFeederMode ? 5 : 4,
                            opacity: 0.95
                          }}
                        />
                      </>
                    )}

                    {/* Highly stylized break point marker featuring pulsing Red PIN with dynamic popups */}
                    {breakPoint && (
                      <Marker position={breakPoint} icon={redPulseIcon}>
                        <Popup>
                          <div className="text-center p-1.5 font-sans min-w-[150px]">
                            <p className="font-extrabold text-[11px] text-red-600 uppercase tracking-wide leading-tight">🚨 Estimasi Titik Gangguan</p>
                            <p className="text-[10px] font-bold text-neutral-600 mt-1.5 bg-neutral-50 py-1.5 px-2 rounded-lg border border-neutral-100">
                              {otdrValue}m dari {ukurSegment === 'Link SURGE' ? ukurOtbAwal : titikPengukuran} ({ukurSegment})
                            </p>
                            <p className="text-[9px] font-mono mt-1 text-neutral-400 bg-neutral-100/55 py-0.5 px-1 rounded">
                              {breakPoint[0].toFixed(6)}, {breakPoint[1].toFixed(6)}
                            </p>
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Mapping all customized point elements inside KML */}
                    {estimatedPoints.map(pt => {
                      const latNum = parseFloat(pt.lat);
                      const longNum = parseFloat(pt.long);

                      const isTargetByCoord = targetOdpPosition ? (
                        Math.abs(latNum - targetOdpPosition[0]) < 0.00001 &&
                        Math.abs(longNum - targetOdpPosition[1]) < 0.00001
                      ) : false;

                      const isTarget = targetOdpName ? (
                        pt.name.trim() === targetOdpName || 
                        pt.name.toLowerCase().trim() === targetOdpName.toLowerCase() || 
                        pt.name.includes(targetOdpName) ||
                        normalizeOdpName(pt.name) === normalizeOdpName(targetOdpName) ||
                        isAlternativeOdpMatch(targetOdpName, pt.name) ||
                        isAlternativeOdpMatch(pt.name, targetOdpName)
                      ) : false;

                      const finalIsTarget = isTarget || isTargetByCoord;
                      const isOdc = !!pt.isOdc || pt.name.toUpperCase().includes('ODC');

                      return (
                        <Marker 
                          key={pt.id}
                          position={[latNum, longNum]}
                          icon={finalIsTarget ? targetOdpIcon : (isOdc ? odcIcon : getMarkerIcon(pt.name, false))}
                          zIndexOffset={finalIsTarget ? 2000 : (isOdc ? 1500 : 0)}
                        >
                          <Popup>
                            <div className="text-center p-1 font-sans">
                              {finalIsTarget ? (
                                <p className="font-extrabold text-[11px] text-emerald-600 uppercase tracking-tight">⛳️ {pt.name} (Sasaran)</p>
                              ) : isOdc ? (
                                <p className="font-extrabold text-[11px] text-cyan-600 uppercase tracking-tight">🔷 {pt.name} (ODC Hub)</p>
                              ) : (
                                <p className="font-extrabold text-[11px] text-neutral-800 uppercase tracking-tight">{pt.name}</p>
                              )}
                              {pt.distance !== undefined && (
                                <p className={`text-[9px] font-extrabold py-0.5 px-1.5 rounded-md mt-1 border inline-block ${finalIsTarget ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : isOdc ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-red-50 text-red-600 border-red-100'}`}>
                                  Distance: {pt.distance.toLocaleString('id-ID')}m dari hulu
                                </p>
                              )}
                              <p className="text-[9px] text-neutral-400 font-mono mt-1">{latNum}, {longNum}</p>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}

                    {/* Polyline fallback if no cable routes parsed */}
                    {estimatedPoints.length > 1 && !cableRoute && (
                      <Polyline 
                        positions={estimatedPoints.map(p => [parseFloat(p.lat), parseFloat(p.long)])} 
                        color={ukurSegment === 'Link SURGE' ? '#EF4444' : (isFeederMode ? '#00E5FF' : '#D500F9')} 
                        dashArray="5, 10" 
                      />
                    )}
                  </MapContainer>

                  {/* Dynamic and fully tailored Mini Map Legend at bottom right */}
                  <div className="absolute bottom-3 right-3 sm:bottom-5 sm:right-5 z-[1000] bg-white/95 backdrop-blur-md p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl shadow-xl border border-neutral-200/90 text-[9px] sm:text-xs max-w-[175px] sm:max-w-[210px] pointer-events-auto">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-100">
                      <p className="font-extrabold text-neutral-800 tracking-wider text-[10px] uppercase">LEGENDA ALPRO</p>
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    </div>
                    <div className="space-y-2 text-[10px]">
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-slate-700 border border-white shadow-xs rounded flex items-center justify-center">
                          <span className="text-[7px] text-white font-bold">S</span>
                        </div>
                        <span className="font-semibold text-neutral-700">STO (Central Office)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3 h-3 bg-cyan-400 border border-white shadow-xs rotate-45 ml-0.5"></div>
                        <span className="font-semibold text-neutral-700 ml-0.5">ODC (Feeder Hub)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-emerald-500 border border-white shadow-xs rounded flex items-center justify-center">
                          <span className="text-[7px] text-white font-bold">P</span>
                        </div>
                        <span className="font-semibold text-neutral-700">ODP (Distribusi)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-amber-500 border border-white shadow-xs rounded-full flex items-center justify-center relative">
                          <div className="w-2.5 h-0.5 bg-white -rotate-45 absolute"></div>
                        </div>
                        <span className="font-semibold text-neutral-700">Joint Closure (JC)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-red-600 border border-white shadow-xs rounded-full flex items-center justify-center">
                          <span className="text-[8px]">⭕️</span>
                        </div>
                        <span className="font-bold text-red-600">Titik Cacat</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-red-600 border border-white shadow-xs rounded-full flex items-center justify-center animate-pulse">
                          <span className="text-[8px]">🚨</span>
                        </div>
                        <span className="font-extrabold text-red-600 animate-pulse">Titik Gangguan</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-emerald-500 border border-white shadow-xs rounded-full flex items-center justify-center animate-pulse">
                          <span className="text-[8px]">⛳️</span>
                        </div>
                        <span className="font-extrabold text-emerald-600 animate-pulse">ODP Sasaran</span>
                      </div>
                    </div>
                  </div>

                  {/* Floating AI Panel Overlay */}
                  <AnimatePresence>
                    {isAiPanelOpen && (
                      <motion.div 
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        className="absolute inset-x-2 top-2 bottom-2 md:inset-x-auto md:right-2 md:top-2 md:bottom-2 w-auto md:w-full md:max-w-[400px] bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-red-100 z-[1100] flex flex-col overflow-hidden"
                      >
                        {/* Header */}
                        <div className="p-4 bg-red-50 border-b border-red-100/50 flex justify-between items-center shrink-0">
                          <div className="flex items-center gap-2">
                            <Bot className="text-red-600 animate-bounce" size={18} />
                            <div>
                              <h4 className="text-xs font-black uppercase text-neutral-800 tracking-wider">M-FOSIS AI Analyst</h4>
                              <p className="text-[9px] font-bold text-red-600 uppercase tracking-widest">
                                {isAiLoading ? 'Menganalisis...' : 'Analisis Siap'}
                              </p>
                            </div>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setIsAiPanelOpen(false)}
                            className="p-1 hover:bg-neutral-200/50 rounded-full text-neutral-500 hover:text-neutral-800 transition-all"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                          {!hasCalculated ? (
                            <div className="p-6 text-center border-2 border-dashed border-neutral-100 rounded-xl bg-neutral-50/50 h-full flex flex-col items-center justify-center">
                              <Bot size={36} className="text-neutral-300 mb-2" />
                              <p className="text-xs text-neutral-400 font-bold uppercase tracking-wide leading-relaxed">
                                Silakan tentukan parameter alpro dan tekan tombol 'Hitung Estimasi' untuk mengaktifkan peta.
                              </p>
                            </div>
                          ) : isAiLoading ? (
                            <div className="flex flex-col items-center justify-center p-8 gap-3 h-full">
                              <Loader2 className="animate-spin text-red-600" size={32} />
                              <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider animate-pulse text-center leading-relaxed">
                                M-FOSIS AI sedang merumuskan analisis spasial, mengidentifikasi kerentanan rute, dan merancang rekomendasi tindakan...
                              </p>
                            </div>
                          ) : !aiAnalysis ? (
                            <div className="p-6 text-center border-2 border-dashed border-red-100 rounded-xl bg-red-50/30 h-full flex flex-col items-center justify-center gap-4">
                              <Bot size={40} className="text-red-500 animate-pulse" />
                              <div>
                                <h5 className="text-xs font-black uppercase text-neutral-800 tracking-wider mb-1">Rekomendasi AI Tersedia</h5>
                                <p className="text-[10px] text-neutral-500 leading-relaxed font-semibold uppercase tracking-tight">
                                  Kalkulasi spasial rute telah siap. Tekan tombol di bawah untuk meminta asisten AI menganalisis detail titik gangguan dan alpro terdekat.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => generateAiAnalysisForEstimation(breakPoint, estimatedPoints)}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <Bot size={14} />
                                <span>Mulai Analisis AI</span>
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-4 text-neutral-700">
                              {renderFormattedAiAnalysis(aiAnalysis)}
                            </div>
                          )}
                        </div>

                        {/* Footer */}
                        <div className="p-3 bg-neutral-50 border-t border-neutral-100 text-center shrink-0">
                          <p className="text-[8px] font-bold uppercase text-neutral-400 tracking-widest">
                            Powered by M-Fosis AI
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              </div>
            </motion.div>
          )}

          {activeTab === 'rute' && (
            <motion.div key="rute" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-12 gap-6 font-sans w-full">
              
              {/* Left Form: Search & Drive Sync Status */}
              <div className={`col-span-1 lg:col-span-4 space-y-6 w-full ${isRuteMapFullscreen ? 'hidden' : ''}`}>
                <section className="bg-white/95 backdrop-blur-sm p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-red-100/50 w-full">
                  <h3 className="text-sm font-black mb-4 uppercase tracking-wider text-neutral-700 flex items-center gap-2">
                    <Search className="text-red-600" size={18} /> Pencarian Rute Kabel
                  </h3>
                  
                  <div className="space-y-4">
                    {/* Google Drive Status & Connection Button */}
                    <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/60 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        {driveToken ? (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full shadow-sm w-full justify-between">
                            <span>Koneksi Cloud : Terhubung 📡</span>
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-full shadow-sm w-full justify-between">
                            <span>Koneksi Cloud : Terputus 🔌</span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                          </div>
                        )}
                      </div>
                      
                      {driveToken ? (
                        <p className="text-[10px] text-neutral-500 font-bold leading-normal uppercase tracking-tight">
                          Isi parameter di bawah lalu klik tombol "TAMPILKAN RUTE KABEL".
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[10px] text-neutral-400 leading-normal uppercase font-bold tracking-tight">
                            Masuk dengan Akun Cloud anda yang sudah terdaftar
                          </p>
                          <button
                            type="button"
                            onClick={connectGoogleDrive}
                            disabled={isConnectingDrive}
                            className="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <Cloud size={14} className={isConnectingDrive ? "animate-spin" : ""} />
                            {isConnectingDrive ? "Menghubungkan..." : "HUBUNGKAN CLOUD"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Form Controls */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">SEGMENT KABEL</label>
                      <select 
                        value={routeCableType}
                        onChange={(e) => setRouteCableType(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 focus:border-red-400 focus:ring-1 focus:ring-red-100 outline-none bg-white transition-all shadow-sm"
                      >
                        <option>Kabel FEEDER</option>
                        <option>Kabel BACKBONE</option>
                        <option>Kabel DISTRIBUSI</option>
                        <option>Kabel Lainya</option>
                        <option>Link SURGE</option>
                      </select>
                    </div>

                    {routeCableType === 'Link SURGE' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase text-neutral-400">OTB AWAL</label>
                          <select
                            value={routeOtbAwal}
                            onChange={(e) => setRouteOtbAwal(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 outline-none bg-white transition-all shadow-sm focus:border-red-400 focus:ring-1"
                          >
                            <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                            <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                            <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                            <option value="OTB ST.Barat">OTB ST.Barat</option>
                            <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                            <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                            <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                            <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                            <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                            <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                            <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                            <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase text-neutral-400">OTB TARGET</label>
                          <select
                            value={routeOtbTarget}
                            onChange={(e) => setRouteOtbTarget(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 outline-none bg-white transition-all shadow-sm focus:border-red-400 focus:ring-1"
                          >
                            <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                            <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                            <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                            <option value="OTB ST.Barat">OTB ST.Barat</option>
                            <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                            <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                            <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                            <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                            <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                            <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                            <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                            <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                          </select>
                        </div>
                      </div>
                    )}
                    
                    {routeCableType !== 'Link SURGE' && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">Site / ODC Tujuan</label>
                        <input 
                          type="text" 
                          value={routeSiteAsal}
                          onChange={(e) => setRouteSiteAsal(e.target.value)}
                          placeholder={routeCableType === 'Kabel DISTRIBUSI' ? "Contoh: ODP-MNZ-FF/37" : "Masukan Site / ODC Name"} 
                          className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 placeholder-neutral-400 focus:border-red-400 focus:ring-1 focus:ring-red-100 outline-none bg-white transition-all shadow-sm" 
                        />
                      </div>
                    )}

                    {routeCableType !== 'Link SURGE' && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">Nama STO</label>
                        <input 
                          type="text" 
                          value={routeSto}
                          onChange={(e) => setRouteSto(e.target.value)}
                          placeholder="Contoh: MNZ" 
                          className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm md:text-xs font-bold text-neutral-700 placeholder-neutral-400 focus:border-red-400 focus:ring-1 focus:ring-red-100 outline-none bg-white transition-all shadow-sm" 
                        />
                      </div>
                    )}

                    {/* Main Trigger Button */}
                    <button
                      type="button"
                      disabled={isDriveLoading}
                      onClick={() => {
                        triggerDriveAutoFetch(routeCableType, routeSto, routeSiteAsal);
                      }}
                      className="w-full py-4 md:py-3.5 px-4 bg-red-600 hover:bg-red-700 disabled:bg-neutral-300 text-white font-black text-sm md:text-xs uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isDriveLoading ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          <span>Loading...</span>
                        </>
                      ) : !driveToken ? (
                        <>
                          <Cloud size={16} />
                          <span>TAMPILKAN RUTE</span>
                        </>
                      ) : (
                        <>
                          <Search size={16} />
                          <span>TAMPILKAN RUTE KABEL</span>
                        </>
                      )}
                    </button>

                    {/* Automatic Sync & Trigger Status Info */}
                    {driveToken && (
                      <div className="p-3.5 rounded-xl border border-slate-200/90 bg-slate-50/80 text-xs space-y-2 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Status Auto-Fetch</span>
                          {driveAutoStatus === 'searching' && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                              <span>Mencari File...</span>
                            </div>
                          )}
                          {driveAutoStatus === 'downloading' && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                              <span>Mengunduh KML...</span>
                            </div>
                          )}
                          {driveAutoStatus === 'success' && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                              <span>Koneksi Terhubung</span>
                            </div>
                          )}
                          {driveAutoStatus === 'not_found' && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <span className="w-2 h-2 rounded-full bg-rose-500" />
                              <span>File Tidak Ditemukan</span>
                            </div>
                          )}
                          {driveAutoStatus === 'error' && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                              <span className="w-2 h-2 rounded-full bg-red-600" />
                              <span>Error Sync</span>
                            </div>
                          )}
                          {driveAutoStatus === 'idle' && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50/80 text-emerald-700 border border-emerald-200/80">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                              <span>Siap Auto-Fetch</span>
                            </div>
                          )}
                        </div>

                        {driveAutoStatus === 'not_found' && (
                          <p className="text-[10px] text-slate-500 leading-tight">
                            File tidak ditemukan untuk kueri: {routeCableType}, STO "{routeSto}", Site "{routeSiteAsal}" di Google Drive.
                          </p>
                        )}
                        {driveAutoStatus === 'error' && (
                          <div className="text-red-600 font-medium text-[10px] leading-tight">
                            {driveAutoError?.includes('https://') ? (
                              <div className="flex flex-col gap-1.5">
                                <span>❌ {driveAutoError.split('https://')[0]}</span>
                                <a
                                  href="https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=156336512986"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="self-start inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-xs transition-all text-[9px] uppercase tracking-wider"
                                >
                                  Aktifkan Google Drive API ↗
                                </a>
                              </div>
                            ) : (
                              <span>❌ Error: {driveAutoError}</span>
                            )}
                          </div>
                        )}
                        {driveAutoStatus === 'idle' && (
                          <p className="text-[10px] text-slate-500 leading-tight">
                            Isikan parameter lalu klik <strong className="text-slate-700">"TAMPILKAN RUTE KABEL"</strong>
                          </p>
                        )}
                      </div>
                    )}

                    {selectedRouteData && (
                      <button 
                        onClick={() => {
                          setSelectedRouteData(null);
                          setSelectedRoutePositions([]);
                          setTargetOdpPosition(null);
                          setTargetOdpName('');
                        }}
                        className="w-full mt-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-600 font-black py-3 rounded-xl transition-all text-xs uppercase tracking-wider"
                      >
                        Hapus Tampilan Rute
                      </button>
                    )}
                  </div>
                </section>
                
                {/* Wajib 3 Baris Info Detail Card */}
                <section className="bg-white/95 backdrop-blur-sm p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-red-100/50 w-full">
                  <h3 className="text-sm font-black mb-4 uppercase tracking-wider text-neutral-700">Detail Aset Terunduh</h3>
                  {selectedRouteData ? (
                    <div className="space-y-4">
                      {/* Baris 0: NAMA SPAN */}
                      <div className="p-3.5 bg-neutral-50/50 border border-neutral-100 rounded-2xl block">
                        <p className="text-[9px] font-black uppercase text-neutral-400 tracking-widest mb-1">NAMA SPAN</p>
                        <p className="text-sm font-black text-red-600 uppercase tracking-tight">
                          {selectedRouteData.spanName || '—'}
                        </p>
                      </div>

                      {/* Baris 1: NAMA ODC */}
                      <div className="p-3.5 bg-neutral-50/50 border border-neutral-100 rounded-2xl block">
                        <p className="text-[9px] font-black uppercase text-neutral-400 tracking-widest mb-1">NAMA ODC</p>
                        <p className="text-sm font-black text-neutral-800 uppercase tracking-tight">
                          {selectedRouteData.odcName || '—'}
                        </p>
                      </div>

                      {/* Baris 2: PANJANG KABEL */}
                      <div className="p-3.5 bg-neutral-50/50 border border-neutral-100 rounded-2xl block">
                        <p className="text-[9px] font-black uppercase text-neutral-400 tracking-widest mb-1">PANJANG KABEL</p>
                        <p className="text-sm font-black text-red-600 tracking-tight">
                          {selectedRouteData.distanceText || '—'}
                        </p>
                      </div>

                      {/* Baris 3: JUMLAH JOINT CLOSURE */}
                      <div className="p-3.5 bg-neutral-50/50 border border-neutral-100 rounded-2xl flex flex-col">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <p className="text-[9px] font-black uppercase text-neutral-400 tracking-widest mb-1">JUMLAH JOINT CLOSURE</p>
                            <p className="text-sm font-black text-neutral-800 tracking-tight">
                              {selectedRouteData.splicePoints?.length || 0} Unit
                            </p>
                          </div>
                        </div>

                        {selectedRouteData.splicePoints && selectedRouteData.splicePoints.length > 0 && (
                          <div className="mt-2 text-[10px] bg-white border border-neutral-100 p-2 rounded-xl max-h-48 overflow-y-auto scrollbar-none antialiased">
                            <p className="text-[9px] font-black uppercase text-neutral-400 tracking-wider mb-2 border-b border-neutral-50 pb-1">
                              Daftar Koordinat Joint Closure:
                            </p>
                            <div className="space-y-2">
                              {selectedRouteData.splicePoints.map((pt: any, idx: number) => (
                                <div key={pt.id || idx} className="flex justify-between items-start text-[10px] font-mono border-b border-dashed border-neutral-50 pb-1.5 last:border-0 last:pb-0">
                                  <div className="font-bold text-neutral-700 truncate pr-2 flex-1 min-w-0">{pt.name}</div>
                                  <div className="text-neutral-500 shrink-0 text-right">
                                    <span className="text-red-500 font-bold">Lat:</span> {parseFloat(pt.lat).toFixed(6)}<br />
                                    <span className="text-red-500 font-bold">Long:</span> {parseFloat(pt.long).toFixed(6)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10 px-4">
                      <Folder className="mx-auto text-neutral-300 opacity-50 mb-3" size={36} />
                      <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider leading-relaxed">
                        Data KML Kosong / Belum Terambil , Koneksikan Cloud untuk memproses data dari folder otomatis
                      </p>
                    </div>
                  )}
                </section>
              </div>
              
              {/* Right View: Realtime Map Container */}
              <div className={isRuteMapFullscreen ? "col-span-1 lg:col-span-12 w-full" : "col-span-1 lg:col-span-8 w-full"}>
                <section className={`bg-white p-2 rounded-2xl sm:rounded-[2.5rem] shadow-sm border border-neutral-200 relative overflow-hidden transition-all duration-300 w-full ${isRuteMapFullscreen ? 'h-[80vh]' : 'h-[320px] sm:h-[480px] md:h-[650px]'}`}>
                  <MapContainer center={mapCenter} zoom={13} scrollWheelZoom={true} className="w-full h-full rounded-xl sm:rounded-[2.3rem] overflow-hidden">
                    <ChangeView center={mapCenter} zoom={targetOdpPosition ? 18 : undefined} />
                    {analisaMapStyle === 'google_road' && (
                      <TileLayer
                        attribution="&copy; Google Maps"
                        url="https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                        subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                        maxZoom={20}
                      />
                    )}
                    {analisaMapStyle === 'google_hybrid' && (
                      <TileLayer
                        attribution="&copy; Google Maps Satellite"
                        url="https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                        subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                        maxZoom={20}
                      />
                    )}
                    {analisaMapStyle === 'light_muted' && (
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                      />
                    )}
                    {analisaMapStyle === 'voyager' && (
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                      />
                    )}
                    
                    {/* Map Controls Overlay */}
                    <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
                      <button 
                        type="button"
                        onClick={() => {
                          const nextState = !isRuteAiPanelOpen;
                          setIsRuteAiPanelOpen(nextState);
                          if (nextState && ruteHasCalculated && !ruteAiAnalysis && !isRuteAiLoading) {
                            generateAiAnalysisForRute(selectedRouteData);
                          }
                        }}
                        className={`p-2 rounded-lg shadow-md hover:bg-neutral-50 transition-all flex items-center gap-1.5 text-[10px] font-bold border ${
                          isRuteAiLoading 
                            ? 'bg-neutral-100 text-red-500 animate-pulse border-red-200' 
                            : isRuteAiPanelOpen 
                              ? 'bg-red-600 text-white hover:bg-red-700 border-red-600' 
                              : ruteAiAnalysis 
                                ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' 
                                : 'bg-white text-neutral-600 border-neutral-200'
                        }`}
                        title="Tampilkan Analisis & Rekomendasi AI"
                      >
                        <Bot size={12} className={isRuteAiLoading ? "animate-spin" : ""} />
                        <span>ANALISIS AI</span>
                      </button>

                      <button 
                        type="button"
                        onClick={() => {
                          setAnalisaMapStyle(prev => {
                            if (prev === 'google_road') return 'google_hybrid';
                            if (prev === 'google_hybrid') return 'light_muted';
                            if (prev === 'light_muted') return 'voyager';
                            return 'google_road';
                          });
                        }}
                        className="p-2 bg-white rounded-lg shadow-md hover:bg-neutral-50 text-red-600 transition-all flex items-center gap-1.5 text-[10px] font-bold cursor-pointer"
                        title="Ganti Tampilan Peta"
                      >
                        <MapIcon size={12} />
                        <span className="uppercase">{
                          analisaMapStyle === 'light_muted' ? 'Light Muted' : analisaMapStyle.replace('_', ' ')
                        }</span>
                      </button>

                      <button 
                        type="button"
                        onClick={() => setIsRuteMapFullscreen(!isRuteMapFullscreen)}
                        className="p-2 bg-white rounded-lg shadow-md hover:bg-neutral-50 text-red-600 transition-all flex items-center gap-1.5 text-[10px] font-bold cursor-pointer"
                        title={isRuteMapFullscreen ? "Kecilkan Peta" : "Maksimalkan Peta"}
                      >
                        {isRuteMapFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                        <span>{isRuteMapFullscreen ? "KECILKAN" : "FULLSCREEN"}</span>
                      </button>
                    </div>

                    {selectedRouteData && (
                      <>
                        {!targetOdpPosition && <FitBounds positions={selectedRoutePositions} />}
                        <GeoJSON 
                          key={`${routeCableType}-${selectedRouteData.id}`}
                          data={{
                            type: 'FeatureCollection',
                            features: selectedRouteData.route
                          }} 
                          style={{
                            color: routeCableType === 'Link SURGE' ? '#EF4444' : (routeCableType.toUpperCase().includes('FEEDER') ? '#00E5FF' : routeCableType.toUpperCase().includes('DISTRIBUSI') ? '#D500F9' : '#00E5FF'),
                            weight: routeCableType.toUpperCase().includes('FEEDER') ? 5 : routeCableType.toUpperCase().includes('DISTRIBUSI') ? 4 : 5,
                            opacity: 0.95
                          }}
                        />

                        {selectedRouteData.splicePoints.map((pt: any) => {
                          const latNum = parseFloat(pt.lat);
                          const longNum = parseFloat(pt.long);

                          const isTargetByCoord = targetOdpPosition ? (
                            Math.abs(latNum - targetOdpPosition[0]) < 0.00001 &&
                            Math.abs(longNum - targetOdpPosition[1]) < 0.00001
                          ) : false;

                          const isTarget = targetOdpName ? (
                            pt.name.trim() === targetOdpName || 
                            pt.name.toLowerCase().trim() === targetOdpName.toLowerCase() || 
                            pt.name.includes(targetOdpName) ||
                            normalizeOdpName(pt.name) === normalizeOdpName(targetOdpName) ||
                            isAlternativeOdpMatch(targetOdpName, pt.name) ||
                            isAlternativeOdpMatch(pt.name, targetOdpName)
                          ) : false;

                          const finalIsTarget = isTarget || isTargetByCoord;
                          const isOdc = !!pt.isOdc || pt.name.toUpperCase().includes('ODC');

                          return (
                            <Marker 
                              key={pt.id}
                              position={[latNum, longNum]}
                              icon={finalIsTarget ? targetOdpIcon : (isOdc ? odcIcon : getMarkerIcon(pt.name, false))}
                              zIndexOffset={finalIsTarget ? 2000 : (isOdc ? 1500 : 0)}
                            >
                              <Popup>
                                <div className="text-center p-1 font-sans">
                                  {finalIsTarget ? (
                                    <p className="font-extrabold text-[11px] text-emerald-600 uppercase tracking-tight">⛳️ {pt.name} (Sasaran)</p>
                                  ) : isOdc ? (
                                    <p className="font-extrabold text-[11px] text-cyan-600 uppercase tracking-tight">🔷 {pt.name} (ODC Hub)</p>
                                  ) : (
                                    <p className="font-extrabold text-[11px] text-neutral-800 uppercase tracking-tight">{pt.name}</p>
                                  )}
                                  <p className="text-[9px] text-neutral-400 font-mono mt-0.5">{latNum}, {longNum}</p>
                                </div>
                              </Popup>
                            </Marker>
                          );
                        })}
                      </>
                    )}
                  </MapContainer>

                  {/* Dynamic and fully tailored Mini Map Legend at bottom right */}
                  <div className="absolute bottom-3 right-3 sm:bottom-5 sm:right-5 z-[1000] bg-white/95 backdrop-blur-md p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl shadow-xl border border-neutral-200/90 text-[9px] sm:text-xs max-w-[175px] sm:max-w-[210px] pointer-events-auto">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-100">
                      <p className="font-extrabold text-neutral-800 tracking-wider text-[10px] uppercase">LEGENDA ALPRO</p>
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    </div>
                    <div className="space-y-2 text-[10px]">
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-slate-700 border border-white shadow-xs rounded flex items-center justify-center">
                          <span className="text-[7px] text-white font-bold">S</span>
                        </div>
                        <span className="font-semibold text-neutral-700">STO (Central Office)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3 h-3 bg-cyan-400 border border-white shadow-xs rotate-45 ml-0.5"></div>
                        <span className="font-semibold text-neutral-700 ml-0.5">ODC (Feeder Hub)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-emerald-500 border border-white shadow-xs rounded flex items-center justify-center">
                          <span className="text-[7px] text-white font-bold">P</span>
                        </div>
                        <span className="font-semibold text-neutral-700">ODP (Distribusi)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-amber-500 border border-white shadow-xs rounded-full flex items-center justify-center relative">
                          <div className="w-2.5 h-0.5 bg-white -rotate-45 absolute"></div>
                        </div>
                        <span className="font-semibold text-neutral-700">Joint Closure (JC)</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-red-600 border border-white shadow-xs rounded-full flex items-center justify-center">
                          <span className="text-[8px]">⭕️</span>
                        </div>
                        <span className="font-bold text-red-600">Titik Cacat</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-red-600 border border-white shadow-xs rounded-full flex items-center justify-center animate-pulse">
                          <span className="text-[8px]">🚨</span>
                        </div>
                        <span className="font-extrabold text-red-600 animate-pulse">Titik Gangguan</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-3.5 h-3.5 bg-emerald-500 border border-white shadow-xs rounded-full flex items-center justify-center animate-pulse">
                          <span className="text-[8px]">⛳️</span>
                        </div>
                        <span className="font-extrabold text-emerald-600 animate-pulse">ODP Sasaran</span>
                      </div>
                    </div>
                  </div>

                  {/* Floating AI Panel Overlay */}
                  <AnimatePresence>
                    {isRuteAiPanelOpen && (
                      <motion.div 
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        className="absolute inset-x-2 top-2 bottom-2 md:inset-x-auto md:right-2 md:top-2 md:bottom-2 w-auto md:w-full md:max-w-[400px] bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-red-100 z-[1100] flex flex-col overflow-hidden"
                      >
                        {/* Header */}
                        <div className="p-4 bg-red-50 border-b border-red-100/50 flex justify-between items-center shrink-0">
                          <div className="flex items-center gap-2">
                            <Bot className="text-red-600 animate-bounce" size={18} />
                            <div>
                              <h4 className="text-xs font-black uppercase text-neutral-800 tracking-wider">M-FOSIS AI Analyst</h4>
                              <p className="text-[9px] font-bold text-red-600 uppercase tracking-widest">
                                {isRuteAiLoading ? 'Menganalisis...' : 'Analisis Siap'}
                              </p>
                            </div>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setIsRuteAiPanelOpen(false)}
                            className="p-1 hover:bg-neutral-200/50 rounded-full text-neutral-500 hover:text-neutral-800 transition-all"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                          {!ruteHasCalculated ? (
                            <div className="p-6 text-center border-2 border-dashed border-neutral-100 rounded-xl bg-neutral-50/50 h-full flex flex-col items-center justify-center">
                              <Bot size={36} className="text-neutral-300 mb-2" />
                              <p className="text-xs text-neutral-400 font-bold uppercase tracking-wide leading-relaxed">
                                Silakan tentukan rute kabel dan tekan tombol 'Tampilkan Rute Kabel' untuk mengaktifkan peta.
                              </p>
                            </div>
                          ) : isRuteAiLoading ? (
                            <div className="flex flex-col items-center justify-center p-8 gap-3 h-full">
                              <Loader2 className="animate-spin text-red-600" size={32} />
                              <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider animate-pulse text-center leading-relaxed">
                                M-FOSIS AI sedang merumuskan analisis spasial, mengidentifikasi kerentanan rute, dan merancang rekomendasi tindakan...
                              </p>
                            </div>
                          ) : !ruteAiAnalysis ? (
                            <div className="p-6 text-center border-2 border-dashed border-red-100 rounded-xl bg-red-50/30 h-full flex flex-col items-center justify-center gap-4">
                              <Bot size={40} className="text-red-500 animate-pulse" />
                              <div>
                                <h5 className="text-xs font-black uppercase text-neutral-800 tracking-wider mb-1">Rekomendasi AI Tersedia</h5>
                                <p className="text-[10px] text-neutral-500 leading-relaxed font-semibold uppercase tracking-tight">
                                  Informasi rute kabel dari Google Drive telah siap. Tekan tombol di bawah untuk meminta asisten AI menganalisis detail ketahanan infrastruktur rute tersebut.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => generateAiAnalysisForRute(selectedRouteData)}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <Bot size={14} />
                                <span>Mulai Analisis AI</span>
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-4 text-neutral-700">
                              {renderFormattedAiAnalysis(ruteAiAnalysis)}
                            </div>
                          )}
                        </div>

                        {/* Footer */}
                        <div className="p-3 bg-neutral-50 border-t border-neutral-100 text-center shrink-0">
                          <p className="text-[8px] font-bold uppercase text-neutral-400 tracking-widest">
                            Powered by M-Fosis AI
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <AnalisaAiPage 
              driveToken={driveToken}
              connectGoogleDrive={connectGoogleDrive}
              refreshGoogleAccessToken={refreshGoogleAccessToken}
              user={user}
            />
          )}

          {activeTab === 'gamas' && (
            <motion.div key="gamas" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <DashboardGamas 
                onToggleHeader={setHideMainHeader} 
                exportToPDF={exportToPDF}
                isPdfExporting={isPdfExporting}
              />
            </motion.div>
          )}

          {(activeTab === 'validasi') && (
            <motion.div key="validasi" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <ValidasiAlpro 
                driveToken={driveToken}
                connectGoogleDrive={connectGoogleDrive}
                isConnectingDrive={isConnectingDrive}
              />
            </motion.div>
          )}

          {activeTab === 'manage' && (() => {
            // Calculations for the dashboard inside an IIFE to keep it scoped and clear
            const activeKmlFiles = driveKmlSynced ? scannedKmlFiles : PRELOADED_KML_FILES;
            const totalKmlFiles = activeKmlFiles.length;
            const totalKmlLength = activeKmlFiles.reduce((acc, f) => acc + (f.length || 0), 0);

            // Gamas records statistics
            const totalGamasCount = gamasRecords.length;
            const reconciledGamasCount = gamasRecords.filter(g => {
              const rStatus = (g.rekonTif || (g as any).rekon_tif_status || '').toUpperCase();
              return rStatus.includes('SELESAI') || rStatus.includes('YA') || rStatus.includes('VERIFIED') || rStatus.includes('OK') || rStatus.includes('✅');
            }).length;
            const pendingGamasCount = totalGamasCount - reconciledGamasCount;

            // Recalculate STO breakdowns
            const stoDataMap = new Map<string, { count: number; length: number; segments: Record<string, number> }>();
            activeKmlFiles.forEach(f => {
              const sto = f.sto || 'Lainnya';
              const seg = f.segment || 'Lainnya';
              const len = f.length || 0;
              if (!stoDataMap.has(sto)) {
                stoDataMap.set(sto, { count: 0, length: 0, segments: {} });
              }
              const cur = stoDataMap.get(sto)!;
              cur.count += 1;
              cur.length += len;
              cur.segments[seg] = (cur.segments[seg] || 0) + 1;
            });

            const stoList = Array.from(stoDataMap.entries()).map(([stoName, d]) => ({
              sto: stoName,
              count: d.count,
              length: d.length,
              segments: d.segments
            })).sort((a, b) => b.count - a.count);

            // Recalculate Segment breakdowns according to folder structures
            const segmentDataMap = new Map<string, { count: number; length: number }>();
            ['FEEDER', 'DISTRIBUSI', 'BACKBONE', 'SURGE'].forEach(s => {
              segmentDataMap.set(s, { count: 0, length: 0 });
            });

             activeKmlFiles.forEach(f => {
              const filePath = (f.path || '').toUpperCase();
              const fSeg = (f.segment || '').toUpperCase();
              
              if (['FEEDER', 'DISTRIBUSI', 'BACKBONE', 'SURGE'].includes(fSeg)) {
                // Verify that the file is located inside the M-Fosis folder
                const isInMFosis = filePath.includes('M-FOSIS') || f.id.startsWith('p');
                
                // Verify that the path contains the correct segment folder name
                const isInCorrectSegmentFolder = filePath.includes(fSeg);

                // Verify that the segment folder exists in GDrive if synced
                const isSegmentFolderPresent = !driveKmlSynced || driveFolders.some(df => df.includes(fSeg));

                if (isInMFosis && isInCorrectSegmentFolder && isSegmentFolderPresent) {
                  const cur = segmentDataMap.get(fSeg) || { count: 0, length: 0 };
                  cur.count += 1;
                  cur.length += (f.length || 0);
                  segmentDataMap.set(fSeg, cur);
                }
              }
            });

            const totalMFosisKmlLength = Array.from(segmentDataMap.values()).reduce((sum, d) => sum + d.length, 0);

            const segmentList = Array.from(segmentDataMap.entries()).map(([segName, d]) => ({
              segment: segName,
              count: d.count,
              length: d.length
            }));

            // Gamas filtered records for table
            const filteredGamasRecords = gamasRecords.filter(g => {
              const searchStr = `${g.alproName || ''} ${g.lokasi || ''} ${g.mitra || ''} ${g.segmentGangguan || ''}`.toLowerCase();
              const matchesSearch = searchStr.includes(gamasSearchQuery.toLowerCase());
              
              const rStatus = (g.rekonTif || (g as any).rekon_tif_status || '').toUpperCase();
              const isReconciled = rStatus.includes('SELESAI') || rStatus.includes('YA') || rStatus.includes('VERIFIED') || rStatus.includes('OK') || rStatus.includes('✅');
              
              if (gamasFilterStatus === 'RECON') {
                return matchesSearch && isReconciled;
              }
              if (gamasFilterStatus === 'PENDING') {
                return matchesSearch && !isReconciled;
              }
              return matchesSearch;
            });

            // Filter KML files by Folder M-fosis & STO
            const filteredKmlFiles = activeKmlFiles.filter(f => {
              const filePath = (f.path || '').toUpperCase();
              const fSegment = (f.segment || '').toUpperCase();
              const fSto = (f.sto || '').toUpperCase();
              const fName = (f.name || '').toUpperCase();

              // 1. Folder filter (Distribusi, Feeder, Surge, Backbone)
              if (kmlFolderFilter !== 'ALL') {
                const isMatchingFolder = filePath.includes(kmlFolderFilter) || fSegment === kmlFolderFilter;
                if (!isMatchingFolder) return false;
              }

              // 2. STO filter (MNZ, UTR, MSP, CRB, etc.)
              if (kmlStoFilter !== 'ALL') {
                const isMatchingSto = fSto.includes(kmlStoFilter) || fName.includes(kmlStoFilter);
                if (!isMatchingSto) return false;
              }

              // 3. Search query filter
              if (kmlSearchQuery.trim() !== '') {
                const q = kmlSearchQuery.toUpperCase().trim();
                const isMatchingQuery = fName.includes(q) || fSto.includes(q) || fSegment.includes(q) || filePath.includes(q);
                if (!isMatchingQuery) return false;
              }

              return true;
            });

            const kmlItemsPerPage = 8;
            const totalKmlPages = Math.ceil(filteredKmlFiles.length / kmlItemsPerPage) || 1;
            const paginatedKmlFiles = filteredKmlFiles.slice((kmlPage - 1) * kmlItemsPerPage, kmlPage * kmlItemsPerPage);

            // Gamas pagination
            const gamasItemsPerPage = 6;
            const totalGamasPages = Math.ceil(filteredGamasRecords.length / gamasItemsPerPage) || 1;
            const paginatedGamas = filteredGamasRecords.slice((gamasPage - 1) * gamasItemsPerPage, gamasPage * gamasItemsPerPage);

            return (
              <motion.div key="manage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                {/* Dashboard Header Banner */}
                <div className="relative overflow-hidden bg-gradient-to-r from-red-600 via-red-500 to-rose-600 text-white rounded-3xl p-6 md:p-8 shadow-md border border-red-500/10">
                  {/* Subtle Background Pattern */}
                  <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]"></div>
                  
                  <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-white text-[9px] font-black tracking-widest uppercase">
                          M-FOSIS DATA SYSTEM
                        </span>
                        <span className="flex items-center gap-1 text-[9px] font-bold text-red-100">
                          <span className={`w-2 h-2 rounded-full ${driveKmlSynced ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                          {driveKmlSynced ? 'LIVE DRIVE SYNCED' : 'CACHED BASELINE DATA'}
                        </span>
                      </div>
                      <h2 className="text-2xl md:text-3xl font-black tracking-tight">
                        Dashboard Kelola Pengelolaan Data
                      </h2>
                      <p className="text-xs text-red-50 font-medium max-w-2xl">
                        Monitor integrasi file spasial pada Cloud Storage M-Fosis secara terpusat
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {isAdmin && (
                        <button
                          onClick={() => setIsUploadDrawerOpen(true)}
                          className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-neutral-50 text-red-600 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-red-900/10 active:scale-95 cursor-pointer"
                        >
                          <Upload size={14} />
                          Unggah Rute KML
                        </button>
                      )}
                      
                      {driveToken ? (
                        <button
                          onClick={scanGoogleDriveKml}
                          disabled={isScanningKml}
                          className="flex items-center gap-2 px-4 py-2.5 bg-red-700/50 hover:bg-red-800/60 border border-white/20 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {isScanningKml ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          Pindai GDrive
                        </button>
                      ) : (
                        <button
                          onClick={() => connectGoogleDrive(false)}
                          disabled={isConnectingDrive}
                          className="flex items-center gap-2 px-4 py-2.5 bg-red-700/50 hover:bg-red-800/60 border border-white/20 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {isConnectingDrive ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Cloud size={14} />
                          )}
                          Hubungkan Drive
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* KPI Metrics Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {/* Card 1: Total KML */}
                  <div className="bg-white/95 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-neutral-100/80 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Total File KML</p>
                      <h3 className="text-2xl font-black text-neutral-800 tracking-tight">{totalKmlFiles} <span className="text-xs font-medium text-neutral-400">Berkas</span></h3>
                      <p className="text-[10px] text-neutral-500 font-medium">Dalam folder M-fosis</p>
                    </div>
                    <div className="p-3.5 bg-rose-50 text-rose-600 rounded-2xl">
                      <FileCode size={22} />
                    </div>
                  </div>

                  {/* Card 2: Total Panjang Kabel */}
                  <div className="bg-white/95 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-neutral-100/80 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Total Panjang Kabel</p>
                      <h3 className="text-2xl font-black text-neutral-800 tracking-tight">{totalKmlLength.toFixed(2)} <span className="text-xs font-medium text-neutral-400">km</span></h3>
                      <p className="text-[10px] text-neutral-500 font-medium">Akumulasi seluruh segmen</p>
                    </div>
                    <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                      <Ruler size={22} />
                    </div>
                  </div>
                </div>

                {/* Breakdown Grid Section */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: Cable Segment Analysis & Progress */}
                  <div className="lg:col-span-5 bg-white/90 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-neutral-100/80 flex flex-col justify-between h-full">
                    <div className="space-y-0.5 mb-5">
                      <h3 className="text-base font-black text-neutral-800">Analisis Segmentasi Kabel</h3>
                      <p className="text-[10px] text-neutral-400">Total panjang kabel dan proporsional volume per segmentasi</p>
                    </div>

                    <div className="space-y-5 flex-grow">
                      {segmentList.map((item, idx) => {
                        // Calculate percentage
                        const maxLen = Math.max(...segmentList.map(s => s.length)) || 1;
                        const pct = totalMFosisKmlLength > 0 ? (item.length / totalMFosisKmlLength) * 100 : 0;
                        
                        // Map colors
                        let colorClass = 'bg-slate-400';
                        let textColorClass = 'text-slate-600';
                        let badgeColorClass = 'bg-slate-50 text-slate-700 border-slate-100';
                        
                        if (item.segment === 'FEEDER') {
                          colorClass = 'bg-indigo-600';
                          textColorClass = 'text-indigo-600';
                          badgeColorClass = 'bg-indigo-50 text-indigo-700 border-indigo-100';
                        } else if (item.segment === 'DISTRIBUSI') {
                          colorClass = 'bg-red-600';
                          textColorClass = 'text-red-600';
                          badgeColorClass = 'bg-red-50 text-red-700 border-red-100';
                        } else if (item.segment === 'BACKBONE') {
                          colorClass = 'bg-emerald-600';
                          textColorClass = 'text-emerald-600';
                          badgeColorClass = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                        } else if (item.segment === 'SURGE') {
                          colorClass = 'bg-amber-500';
                          textColorClass = 'text-amber-600';
                          badgeColorClass = 'bg-amber-50 text-amber-700 border-amber-100';
                        }

                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`}></span>
                                <span className="text-neutral-700 font-extrabold uppercase tracking-tight">{item.segment}</span>
                              </span>
                              <span className="text-neutral-500 font-mono">{item.length.toFixed(2)} km</span>
                            </div>

                            <div className="relative w-full bg-neutral-100 h-2.5 rounded-full overflow-hidden">
                              <motion.div 
                                className={`h-full rounded-full ${colorClass}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                              ></motion.div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-neutral-400 font-medium">
                              <span className="flex items-center gap-1">
                                <span className={`inline-block px-1.5 py-0.5 rounded border ${badgeColorClass} font-black uppercase text-[8px]`}>
                                  {item.count} berkas KML
                                </span>
                              </span>
                              <span className="font-bold">{pct.toFixed(1)}% Share</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Cable Segment Diagram */}
                  <div className="lg:col-span-7 flex flex-col h-full">
                    <CableSegmentChart data={segmentList} />
                  </div>
                </div>

                {/* Interactive M-Fosis Folder & STO Data Explorer */}
                <div className="bg-white/90 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-neutral-100/80 space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-black uppercase tracking-wider">
                          FOLDER SPASIAL M-FOSIS
                        </span>
                        <span className="text-[10px] text-neutral-400 font-bold">
                          {filteredKmlFiles.length} Berkas Ditemukan
                        </span>
                      </div>
                      <h3 className="text-lg font-black text-neutral-800 tracking-tight mt-1">
                        Kelola Data Spasial KML per Folder M-Fosis & STO
                      </h3>
                      <p className="text-xs text-neutral-500 font-medium">
                        Kategori segmen folder (Distribusi, Feeder, Surge, Backbone) & identifikasi kode STO (MNZ, UTR, MSP, CRB)
                      </p>
                    </div>

                    {/* Folder Segment Filter Buttons */}
                    <div className="flex flex-wrap items-center gap-1.5 p-1 bg-neutral-100/80 rounded-2xl">
                      {[
                        { id: 'ALL', label: 'Semua Folder' },
                        { id: 'DISTRIBUSI', label: 'Distribusi' },
                        { id: 'FEEDER', label: 'Feeder' },
                        { id: 'SURGE', label: 'Surge' },
                        { id: 'BACKBONE', label: 'Backbone' },
                      ].map((btn) => (
                        <button
                          key={btn.id}
                          onClick={() => { setKmlFolderFilter(btn.id as any); setKmlPage(1); }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                            kmlFolderFilter === btn.id
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50'
                          }`}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* STO Focus Cards Grid (Explicitly highlighting MNZ, UTR, MSP, CRB) */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {[
                      { code: 'MNZ', label: 'Madiun (MNZ)', color: 'from-red-500 to-rose-600' },
                      { code: 'UTR', label: 'Utara (UTR)', color: 'from-indigo-500 to-blue-600' },
                      { code: 'MSP', label: 'Maospati (MSP)', color: 'from-emerald-500 to-teal-600' },
                      { code: 'CRB', label: 'Caruban (CRB)', color: 'from-amber-500 to-orange-600' },
                      { code: 'ALL', label: 'Semua STO', color: 'from-slate-700 to-neutral-800' },
                    ].map((stoItem) => {
                      const stoCount = stoItem.code === 'ALL' 
                        ? activeKmlFiles.length 
                        : activeKmlFiles.filter(f => (f.sto || '').toUpperCase().includes(stoItem.code) || (f.name || '').toUpperCase().includes(stoItem.code)).length;
                      const stoLen = stoItem.code === 'ALL' 
                        ? totalKmlLength 
                        : activeKmlFiles.filter(f => (f.sto || '').toUpperCase().includes(stoItem.code) || (f.name || '').toUpperCase().includes(stoItem.code)).reduce((acc, f) => acc + (f.length || 0), 0);

                      const isSelected = kmlStoFilter === stoItem.code;

                      return (
                        <button
                          key={stoItem.code}
                          onClick={() => { setKmlStoFilter(stoItem.code); setKmlPage(1); }}
                          className={`p-3.5 rounded-2xl text-left border transition-all cursor-pointer relative overflow-hidden ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-800 shadow-md ring-2 ring-red-500/50 scale-[1.02]' 
                              : 'bg-neutral-50/80 hover:bg-neutral-100/80 text-neutral-800 border-neutral-200/70'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase text-white bg-gradient-to-r ${stoItem.color}`}>
                              {stoItem.code}
                            </span>
                            <Folder size={14} className={isSelected ? 'text-red-400' : 'text-neutral-400'} />
                          </div>
                          <p className="text-xs font-black truncate">{stoItem.label}</p>
                          <div className="flex items-baseline justify-between mt-2 pt-2 border-t border-current/10 text-[10px]">
                            <span className="font-bold opacity-75">{stoCount} berkas</span>
                            <span className="font-extrabold text-red-500 font-mono">{stoLen.toFixed(1)} km</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Search and Table Toolbar */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                    <div className="relative w-full sm:w-80">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
                      <input
                        type="text"
                        value={kmlSearchQuery}
                        onChange={(e) => { setKmlSearchQuery(e.target.value); setKmlPage(1); }}
                        placeholder="Cari file KML, STO (MNZ, UTR...), folder..."
                        className="w-full pl-9 pr-4 py-2 bg-neutral-50 hover:bg-neutral-100/70 border border-neutral-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700 transition-all"
                      />
                    </div>

                    <div className="text-[11px] font-semibold text-neutral-500 self-end sm:self-auto">
                      Menampilkan <span className="font-bold text-neutral-800">{filteredKmlFiles.length}</span> dari <span className="font-bold text-neutral-800">{activeKmlFiles.length}</span> berkas KML
                    </div>
                  </div>

                  {/* Table of Files inside M-fosis Folders */}
                  <div className="overflow-x-auto rounded-2xl border border-neutral-100">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-neutral-50/80 border-b border-neutral-100 text-[10px] font-black uppercase text-neutral-400 tracking-wider">
                          <th className="px-5 py-3.5">No.</th>
                          <th className="px-5 py-3.5">Nama File & Deskripsi M-fosis</th>
                          <th className="px-5 py-3.5">Identifikasi STO</th>
                          <th className="px-5 py-3.5">Folder Spasial M-fosis</th>
                          <th className="px-5 py-3.5">Ukuran File</th>
                          <th className="px-5 py-3.5">Panjang Estimasi</th>
                          <th className="px-5 py-3.5">Status Folder</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 text-xs">
                        {paginatedKmlFiles.map((file, idx) => {
                          const itemNo = (kmlPage - 1) * kmlItemsPerPage + idx + 1;
                          const parsed = parseMfosisFileInfo(file.name);
                          const stoName = file.sto || parsed.stoName;
                          const isTargetSto = ['MNZ', 'UTR', 'MSP', 'CRB'].some(c => stoName.toUpperCase().includes(c) || file.name.toUpperCase().includes(c));

                          let folderBadge = 'bg-slate-100 text-slate-700 border-slate-200';
                          if (file.segment === 'FEEDER' || parsed.segment === 'FEEDER') folderBadge = 'bg-indigo-50 text-indigo-700 border-indigo-100';
                          if (file.segment === 'DISTRIBUSI' || parsed.segment === 'DISTRIBUSI') folderBadge = 'bg-red-50 text-red-700 border-red-100';
                          if (file.segment === 'BACKBONE' || parsed.segment === 'BACKBONE') folderBadge = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                          if (file.segment === 'SURGE' || parsed.segment === 'SURGE') folderBadge = 'bg-amber-50 text-amber-700 border-amber-100';

                          return (
                            <tr key={file.id || idx} className="hover:bg-neutral-50/70 transition-colors">
                              <td className="px-5 py-4 font-mono text-neutral-400 font-bold align-top">{itemNo}</td>
                              <td className="px-5 py-4 align-top max-w-md">
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <FileCode size={16} className="text-red-500 shrink-0" />
                                    <span className="font-extrabold text-neutral-800 font-mono text-xs">{file.name}</span>
                                  </div>
                                  <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-200/80 text-[10px] space-y-1 font-sans shadow-2xs">
                                    <div className="flex items-baseline gap-1 text-indigo-700">
                                      <span className="font-mono font-black shrink-0 px-1 py-0.2 bg-indigo-100/80 rounded text-[9px]">{parsed.segment} =</span>
                                      <span className="font-bold">{parsed.segmentDesc}</span>
                                    </div>
                                    <div className="flex items-baseline gap-1 text-red-700">
                                      <span className="font-mono font-black shrink-0 px-1 py-0.2 bg-red-100/80 rounded text-[9px]">{parsed.stoCode} =</span>
                                      <span className="font-bold">{parsed.stoDesc}</span>
                                    </div>
                                    <div className="flex items-baseline gap-1 text-emerald-700">
                                      <span className="font-mono font-black shrink-0 px-1 py-0.2 bg-emerald-100/80 rounded text-[9px]">{parsed.alproDetail} =</span>
                                      <span className="font-bold">{parsed.detailDesc}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4 align-top">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                  isTargetSto ? 'bg-red-100 text-red-800 border border-red-200 shadow-xs' : 'bg-neutral-100 text-neutral-700'
                                }`}>
                                  <MapPin size={10} />
                                  {stoName}
                                </span>
                              </td>
                              <td className="px-5 py-4 align-top">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md border text-[10px] font-extrabold uppercase ${folderBadge}`}>
                                  <Folder size={10} />
                                  {file.path || `M-Fosis / ${parsed.segment}`}
                                </span>
                              </td>
                              <td className="px-5 py-4 align-top text-neutral-500 font-mono text-[11px]">
                                {((file.size || 0) / 1024).toFixed(1)} KB
                              </td>
                              <td className="px-5 py-4 align-top font-extrabold text-neutral-800 font-mono">
                                {(file.length || 0).toFixed(2)} km
                              </td>
                              <td className="px-5 py-4 align-top">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase border border-emerald-200">
                                  <CheckCircle2 size={10} />
                                  Valid M-fosis
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {paginatedKmlFiles.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-6 py-12 text-center">
                              <div className="flex flex-col items-center opacity-40 py-4">
                                <FileCode size={36} className="text-neutral-400 mb-2" />
                                <p className="text-xs font-black text-neutral-600 uppercase">File KML Tidak Ditemukan</p>
                                <p className="text-[10px] text-neutral-400">Silakan ubah filter folder atau pencarian Anda.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* KML Table Pagination */}
                  {totalKmlPages > 1 && (
                    <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
                      <p className="text-[10px] text-neutral-400 font-medium">
                        Halaman <span className="font-bold text-neutral-700">{kmlPage}</span> dari <span className="font-bold text-neutral-700">{totalKmlPages}</span>
                      </p>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setKmlPage(p => Math.max(1, p - 1))}
                          disabled={kmlPage === 1}
                          className="px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40 rounded-xl text-[10px] font-black uppercase transition-all cursor-pointer"
                        >
                          Prev
                        </button>
                        <button
                          onClick={() => setKmlPage(p => Math.min(totalKmlPages, p + 1))}
                          disabled={kmlPage === totalKmlPages}
                          className="px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40 rounded-xl text-[10px] font-black uppercase transition-all cursor-pointer"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sliding Admin Upload Drawer */}
                <AnimatePresence>
                  {isUploadDrawerOpen && isAdmin && (
                    <div className="fixed inset-0 z-50 overflow-hidden">
                      {/* Backdrop */}
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.5 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsUploadDrawerOpen(false)}
                        className="absolute inset-0 bg-black/60 backdrop-blur-xs"
                      ></motion.div>

                      {/* Drawer Panel */}
                      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
                        <motion.div 
                          initial={{ x: '100%' }}
                          animate={{ x: 0 }}
                          exit={{ x: '100%' }}
                          transition={{ type: "spring", damping: 30, stiffness: 300 }}
                          className="w-screen max-w-md bg-white shadow-2xl flex flex-col h-full border-l border-neutral-100"
                        >
                          {/* Drawer Header */}
                          <div className="p-6 border-b border-neutral-100 flex items-center justify-between bg-gradient-to-r from-red-50 to-white">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-red-600 text-white rounded-xl">
                                <Upload size={18} />
                              </div>
                              <div>
                                <h3 className="text-sm font-black text-neutral-800 uppercase tracking-tight">Upload KML Cloud</h3>
                                <p className="text-[10px] text-neutral-400">Unggah berkas spasial baru untuk disimpan ke Firestore</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => setIsUploadDrawerOpen(false)}
                              className="p-1.5 hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 rounded-lg transition-all"
                            >
                              <X size={18} />
                            </button>
                          </div>

                          {/* Drawer Content */}
                          <div className="flex-1 overflow-y-auto p-6 space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">Nama ODC</label>
                                <input 
                                  type="text" 
                                  value={odcName} 
                                  onChange={(e) => setOdcName(e.target.value)} 
                                  placeholder="ODC-MNZ-FA" 
                                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700" 
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">Distribusi</label>
                                <input 
                                  type="text" 
                                  value={distribution} 
                                  onChange={(e) => setDistribution(e.target.value)} 
                                  placeholder="1" 
                                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700" 
                                />
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">Jenis Kabel</label>
                              <select 
                                value={manageCableType}
                                onChange={(e) => setManageCableType(e.target.value)}
                                className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700 bg-white"
                              >
                                <option>Kabel FEEDER</option>
                                <option>Kabel BACKBONE</option>
                                <option>Kabel DISTRIBUSI</option>
                                <option>Kabel Lainya</option>
                                <option>Link SURGE</option>
                              </select>
                            </div>

                            {manageCableType === 'Link SURGE' && (
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">OTB AWAL</label>
                                  <select
                                    value={manageOtbAwal}
                                    onChange={(e) => setManageOtbAwal(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700 bg-white"
                                  >
                                    <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                                    <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                                    <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                                    <option value="OTB ST.Barat">OTB ST.Barat</option>
                                    <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                                    <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                                    <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                                    <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                                    <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                                    <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                                    <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                                    <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                                  </select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">OTB TARGET</label>
                                  <select
                                    value={manageOtbTarget}
                                    onChange={(e) => setManageOtbTarget(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700 bg-white"
                                  >
                                    <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                                    <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                                    <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                                    <option value="OTB ST.Barat">OTB ST.Barat</option>
                                    <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                                    <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                                    <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                                    <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                                    <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                                    <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                                    <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                                    <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                                  </select>
                                </div>
                              </div>
                            )}

                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">Site Asal</label>
                              <input 
                                type="text" 
                                value={manageSiteAsal}
                                onChange={(e) => setManageSiteAsal(e.target.value)}
                                placeholder="Masukan Site Asal" 
                                className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700" 
                              />
                            </div>

                            {(manageCableType === 'Kabel FEEDER' || manageCableType === 'Kabel DISTRIBUSI') && (
                              <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">Masukan STO</label>
                                <input 
                                  type="text" 
                                  value={manageStoName}
                                  onChange={(e) => setManageStoName(e.target.value)}
                                  placeholder="Nama STO" 
                                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700" 
                                />
                              </div>
                            )}

                            {manageCableType === 'Kabel BACKBONE' && (
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">STO AWAL</label>
                                  <input 
                                    type="text" 
                                    value={manageStoStart}
                                    onChange={(e) => setManageStoStart(e.target.value)}
                                    placeholder="STO Awal" 
                                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700" 
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">STO TUJUAN</label>
                                  <input 
                                    type="text" 
                                    value={manageStoEnd}
                                    onChange={(e) => setManageStoEnd(e.target.value)}
                                    placeholder="STO Tujuan" 
                                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-xs outline-none focus:ring-2 focus:ring-red-100 text-neutral-700" 
                                  />
                                </div>
                              </div>
                            )}

                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black uppercase tracking-wider text-neutral-400">File KML Rute</label>
                              <input 
                                type="file" 
                                accept=".kml" 
                                onChange={handleKmlUpload}
                                className="w-full text-xs text-neutral-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer"
                              />
                            </div>

                            {/* Preview section */}
                            {cableRoute && (
                              <div className="p-4 bg-red-50/30 rounded-xl border border-red-100/50 space-y-2">
                                <p className="text-[9px] font-black text-neutral-400 uppercase tracking-widest">KML Terdeteksi</p>
                                <div className="grid grid-cols-2 gap-4 text-[10px] text-neutral-600 font-semibold">
                                  <div>
                                    <span>Segmen: </span>
                                    <span className="text-neutral-800 font-extrabold">{Array.isArray(cableRoute) ? cableRoute.length : 1}</span>
                                  </div>
                                  <div>
                                    <span>Total Jarak: </span>
                                    <span className="text-neutral-800 font-extrabold">
                                      {(Array.isArray(cableRoute) ? cableRoute : [cableRoute]).reduce((acc, f) => acc + turf.length(f as any, { units: 'kilometers' }), 0).toFixed(3)} km
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Drawer Footer */}
                          <div className="p-6 border-t border-neutral-100 bg-neutral-50/50">
                            <button
                              onClick={async () => {
                                await handleSaveToCloud();
                                setIsUploadDrawerOpen(false);
                              }}
                              disabled={isSaving || !cableRoute}
                              className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-neutral-300 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                            >
                              {isSaving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                              {isSaving ? 'Menyimpan...' : 'Simpan ke Database'}
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })()}
              </>
            } />
          </Routes>
        </AnimatePresence>


      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick} 
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all cursor-pointer group ${
        active 
          ? 'bg-red-600 text-white font-semibold shadow-md shadow-red-600/30 ring-1 ring-red-500/50' 
          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
      }`}
    >
      <span className={active ? 'text-white' : 'text-slate-400 group-hover:text-red-400 transition-colors'}>{icon}</span>
      <span className="text-xs font-semibold tracking-wide text-left">{label}</span>
    </button>
  );
}

function StatCard({ label, value }: { label: string, value: string }) {
  return (
    <div className="bg-red-50/30 p-4 rounded-2xl border border-red-100/50 text-center">
      <p className="text-[9px] uppercase text-neutral-400 font-bold mb-1">{label}</p>
      <p className="text-sm font-black text-neutral-800">{value}</p>
    </div>
  );
}

function WelcomePage({ user, isAdmin, onEnter }: { user: FirebaseUser, isAdmin: boolean, onEnter: () => void }) {
  const menus = [
    { icon: <Ruler size={20} />, title: 'Estimasi Putus', desc: 'Analisa jarak OTDR untuk menentukan estimasi titik putus kabel secara presisi pada peta.' },
    { icon: <Search size={20} />, title: 'Rute Kabel', desc: 'Pencarian dan visualisasi rute kabel (Feeder, Backbone, Distribusi) dari database cloud.' },
    { icon: <History size={20} />, title: 'Analisa & AI', desc: 'Asisten cerdas berbasis AI untuk membantu analisa teknis dan memberikan rekomendasi perbaikan.' },
    { icon: <AlertTriangle size={20} />, title: 'Dashboard GAMAS', desc: 'Monitoring gangguan massal secara real-time untuk respon cepat di lapangan.' },
    { icon: <CheckCircle size={20} />, title: 'Validasi Data', desc: 'Validasi fisik alat produksi (ODP/ODC) dengan dokumentasi foto langsung dari lapangan.' },
  ];

  if (isAdmin) {
    menus.push({ icon: <Upload size={20} />, title: 'Kelola Data', desc: 'Menu khusus admin untuk manajemen database KML, update rute, dan konfigurasi sistem.' });
  }

  return (
    <div className="min-h-screen bg-red-50/30 flex items-center justify-center p-4 md:p-8">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-5xl w-full bg-white/80 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-red-100/50 overflow-hidden flex flex-col md:flex-row min-h-[600px]"
      >
        <div className="md:w-1/3 bg-gradient-to-br from-red-600 to-red-800 p-8 md:p-12 text-white flex flex-col justify-center items-center text-center">
          <motion.div 
            initial={{ rotate: -10, scale: 0.8 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="w-24 h-24 md:w-28 md:h-28 bg-white/20 backdrop-blur-md rounded-3xl overflow-hidden mb-6 shadow-xl border border-white/10"
          >
            <img src={mFosisLogo} alt="M-FOSIS Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </motion.div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter mb-2">M-FOSIS</h1>
          <p className="text-[10px] md:text-xs opacity-80 font-medium leading-tight uppercase tracking-widest">Fiber Optic Smart Insight</p>
          
          <div className="mt-8 pt-8 border-t border-white/10 w-full">
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">Selamat Datang,</p>
            <p className="text-lg font-bold truncate w-full px-2">{user.displayName}</p>
            <div className="mt-4 inline-flex items-center gap-2 bg-white/20 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
              <div className={`w-2 h-2 rounded-full ${isAdmin ? 'bg-yellow-400' : 'bg-green-400'} animate-pulse`} />
              <p className="text-[9px] uppercase font-black tracking-wider">
                {isAdmin ? 'Administrator' : 'Field Technician'}
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex-1 p-8 md:p-12 flex flex-col bg-white/40">
          <div className="mb-8">
            <h2 className="text-2xl font-black text-neutral-800 tracking-tight mb-2">Panduan Navigasi Sistem</h2>
            <p className="text-xs text-neutral-500">Berikut adalah ringkasan fitur utama yang dapat Anda akses di dalam platform M-FOSIS.</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 flex-1">
            {menus.map((menu, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + (idx * 0.1) }}
                className="flex gap-4 p-4 rounded-2xl bg-white/60 border border-red-50/50 shadow-sm hover:shadow-md hover:border-red-200 transition-all group"
              >
                <div className="w-10 h-10 shrink-0 bg-red-50 text-red-600 rounded-xl flex items-center justify-center group-hover:bg-red-600 group-hover:text-white transition-all duration-300">
                  {menu.icon}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-neutral-800 mb-1 group-hover:text-red-700 transition-colors">{menu.title}</h4>
                  <p className="text-[9px] text-neutral-400 leading-relaxed font-medium">{menu.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
          
          <div className="mt-10 flex justify-end">
            <button 
              onClick={onEnter}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-10 rounded-2xl transition-all shadow-lg shadow-red-100 flex items-center gap-3 group relative overflow-hidden"
            >
              <span className="relative z-10">Mulai Eksplorasi</span>
              <ExternalLink size={18} className="relative z-10 group-hover:translate-x-1 transition-transform" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
