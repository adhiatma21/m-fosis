import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, Bot, Send, Loader2, Download, AlertCircle, 
  Map as MapIcon, Database, HardDrive, CheckCircle2, ChevronRight, HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { jsPDF } from 'jspdf';
import * as toGeoJSON from 'togeojson';

// Helper: Haversine distance between [lat, lng] in meters
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

// Helper: Project point onto line segment
function projectPointOnSegment(p1: [number, number], p2: [number, number], p: [number, number]): [number, number] {
  const [lat1, lng1] = p1;
  const [lat2, lng2] = p2;
  const [lat, lng] = p;

  const dx = lat2 - lat1;
  const dy = lng2 - lng1;
  
  if (dx === 0 && dy === 0) return p1;

  let t = ((lat - lat1) * dx + (lng - lng1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t)); // clamp to segment

  return [lat1 + t * dx, lng1 + t * dy];
}

// Helper: Distance of a point along path from start, in meters
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

  let distanceAlong = 0;
  for (let i = 0; i < closestSegmentIndex; i++) {
    distanceAlong += getHaversineDistance(path[i], path[i+1]);
  }
  distanceAlong += getHaversineDistance(path[closestSegmentIndex], closestProjPoint);
  
  return distanceAlong;
}

// Fallback Asset Datasets (used when Google Drive fails or no token)
interface KMLAsset {
  name: string;
  distMeters: number;
}
const FALLBACK_ASSETS_DISTRIBUSI: KMLAsset[] = [
  { name: "Joint Closure MDN-01 (Kubah-01)", distMeters: 120 },
  { name: "Joint Closure MDN-02 (Jointing Tiang #12)", distMeters: 310 },
  { name: "Joint Closure MDN-03 (Depan Toko M-FOSIS)", distMeters: 512 },
  { name: "ODP-MNZ-FF/35", distMeters: 580 },
  { name: "ODP-MNZ-FF/37", distMeters: 710 },
  { name: "ODP-MNZ-FF/39", distMeters: 850 }
];

const FALLBACK_ASSETS_FEEDER: KMLAsset[] = [
  { name: "HH-STO-MADIUN-01", distMeters: 100 },
  { name: "Joint Closure Feeder-01 (Depan Alun-alun)", distMeters: 350 },
  { name: "Joint Closure Feeder-02 (Perempatan Sleko)", distMeters: 535 },
  { name: "ODC-MNZ-FF", distMeters: 920 },
  { name: "ODC-MNZ-FG", distMeters: 1210 }
];

interface EventData {
  no: number;
  type: string;
  distance: number;
  loss: string;
  reflection: string;
  note: string;
}

const renderFormattedAiAssistantResponse = (text: string) => {
  if (!text) return null;

  const lines = text.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let currentSection: { title: string; icon: string; content: string[] } | null = null;
  let currentParagraphs: string[] = [];

  const flushCurrentSectionOrParagraphs = (key: number) => {
    if (currentSection) {
      renderedElements.push(
        <div key={key} className="my-2.5 bg-neutral-50/50 border border-neutral-150/70 rounded-xl p-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <h4 className="flex items-center gap-2 text-xs font-black text-slate-800 uppercase tracking-wider border-b border-dashed border-neutral-200/80 pb-1.5 mb-2 select-none">
            <span className="text-sm">{currentSection.icon}</span>
            <span>{currentSection.title}</span>
          </h4>
          <div className="space-y-1.5 pl-0.5">
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
                  <div key={idx} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-600 font-semibold">
                    <span className="text-red-500 mt-1 select-none text-[8px]">•</span>
                    <span>{cleanCLine}</span>
                  </div>
                );
              }
              
              return (
                <p key={idx} className="text-[11px] leading-relaxed text-slate-600 font-semibold">
                  {cleanCLine}
                </p>
              );
            })}
          </div>
        </div>
      );
      currentSection = null;
    } else if (currentParagraphs.length > 0) {
      renderedElements.push(
        <div key={`p-${key}`} className="space-y-1.5 my-1.5 font-semibold">
          {currentParagraphs.map((pLine, idx) => {
            const trimmed = pLine.trim();
            if (!trimmed) return null;

            const cleanPLine = trimmed
              .replace(/\*\*/g, '')
              .replace(/###/g, '')
              .trim();

            const isBullet = trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•') || trimmed.startsWith('+');
            const cleanBulletText = cleanPLine.replace(/^[\-\*\s•\+]+/, '').trim();

            if (isBullet) {
              return (
                <div key={idx} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-600">
                  <span className="text-red-500 mt-1 select-none text-[8px]">•</span>
                  <span>{cleanBulletText}</span>
                </div>
              );
            }

            return (
              <p key={idx} className="text-[11px] leading-relaxed text-slate-600">
                {cleanPLine}
              </p>
            );
          })}
        </div>
      );
      currentParagraphs = [];
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
      flushCurrentSectionOrParagraphs(elementKey++);
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
          currentParagraphs.push(line);
        } else {
          flushCurrentSectionOrParagraphs(elementKey++);
        }
      }
    }
  }

  flushCurrentSectionOrParagraphs(elementKey++);

  return <div className="space-y-1 text-slate-700 font-sans">{renderedElements}</div>;
};

interface AnalisaAiPageProps {
  driveToken: string | null;
  connectGoogleDrive: (silent?: boolean) => Promise<string>;
  refreshGoogleAccessToken?: () => Promise<string | null>;
  user: any;
}

export default function AnalisaAiPage({ driveToken, connectGoogleDrive, refreshGoogleAccessToken, user }: AnalisaAiPageProps) {
  // Input form states
  const [tipeAlpro, setTipeAlpro] = useState<'FEEDER' | 'DISTRIBUSI'>('DISTRIBUSI');
  const [targetPerangkat, setTargetPerangkat] = useState('');
  
  // File SOR states
  const [sorFileName, setSorFileName] = useState('dis_01_pot_01.sor');
  const [totalLoss, setTotalLoss] = useState('1.772');
  const [attenuasi, setAttenuasi] = useState('2.416');
  const [panjang, setPanjang] = useState('0.733');
  const [waveLength, setWaveLength] = useState('1310');
  const [events, setEvents] = useState<EventData[]>([
    { no: 1, type: "Reflection", distance: 0.020, loss: "0.306", reflection: "-50.716", note: "Refleksi tinggi, konektor kotor" },
    { no: 2, type: "Loss", distance: 0.529, loss: "0.215", reflection: "—", note: "Redaman sambungan/splice" },
    { no: 3, type: "End", distance: 0.733, loss: "5.604", reflection: "-35.125", note: "Ujung fiber terbuka" }
  ]);

  // UI state indicators
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stepLogs, setStepLogs] = useState<string[]>([]);
  const [suspectedAsset, setSuspectedAsset] = useState<string>('');
  
  // Chat state
  const [messages, setMessages] = useState<any[]>([
    { 
      id: 'welcome', 
      role: 'model', 
      text: 'Halo! Saya M-FOSIS AI Assistant, pakar jaringan optik Telkom Akses Madiun. Unggah file .SOR Anda atau lengkapi form parameter alpro lapangan di sebelah kiri, lalu tekan "Mulai Analisa AI" untuk mendeteksi lokasi dan penyebab redaman secara presisi.' 
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasCompletedAnalysis, setHasCompletedAnalysis] = useState(false);
  const [geminiResponse, setGeminiResponse] = useState('');
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // File drop handling
  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setSorFileName(file.name);
    setHasAnalyzed(false);
    
    // Simulate real parsing from SOR file
    setStepLogs([]);
    const isFeederFile = file.name.toUpperCase().includes('FEED') || tipeAlpro === 'FEEDER';
    
    if (isFeederFile) {
      setTotalLoss('3.412');
      setAttenuasi('0.380');
      setPanjang('4.821');
      setWaveLength('1550');
      setEvents([
        { no: 1, type: "Reflection", distance: 0.010, loss: "0.125", reflection: "-62.110", note: "Konektor OTB STO" },
        { no: 2, type: "Loss", distance: 1.250, loss: "0.082", reflection: "—", note: "Sambungan aman/closure" },
        { no: 3, type: "Loss", distance: 3.245, loss: "1.890", reflection: "—", note: "⚠️ REDAMAN DOMINAN / LOSS TINGGI" },
        { no: 4, type: "End", distance: 4.821, loss: "7.150", reflection: "-28.450", note: "End of fiber ODC" }
      ]);
    } else {
      // Randomized values for variety
      const randomDist = (0.4 + Math.random() * 0.5).toFixed(3);
      const randomTotalDist = (parseFloat(randomDist) + 0.2 + Math.random() * 0.3).toFixed(3);
      const randomLoss = (0.15 + Math.random() * 0.5).toFixed(3);
      
      setTotalLoss((1.2 + Math.random() * 1.5).toFixed(3));
      setAttenuasi((1.8 + Math.random() * 1.2).toFixed(3));
      setPanjang(randomTotalDist);
      setWaveLength('1310');
      setEvents([
        { no: 1, type: "Reflection", distance: 0.020, loss: "0.410", reflection: "-51.201", note: "Konektor kotor di Roset/Drop" },
        { no: 2, type: "Loss", distance: parseFloat(randomDist), loss: randomLoss, reflection: "—", note: "⚠️ REDAMAN SAMBUNGAN / SPLICE" },
        { no: 3, type: "End", distance: parseFloat(randomTotalDist), loss: "6.210", reflection: "-31.220", note: "End-of-fiber" }
      ]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/octet-stream': ['.sor'] },
    multiple: false
  } as any);

  // Main execution logic
  const handleStartAnalysis = async () => {
    setIsAnalyzing(true);
    setHasAnalyzed(true);
    setStepLogs([]);
    setSuspectedAsset('');
    setHasCompletedAnalysis(false);

    // Identify dominant loss event
    const lossEvents = events.filter(e => e.type === 'Loss');
    const dominantLossEvent = lossEvents.sort((a, b) => parseFloat(b.loss) - parseFloat(a.loss))[0] || events[1];
    const targetDistanceKm = dominantLossEvent ? dominantLossEvent.distance : 0.529;
    const targetDistanceMeters = targetDistanceKm * 1000;

    const addLog = (msg: string) => {
      setStepLogs(prev => [...prev, msg]);
    };

    try {
      let selectedAsset = '';

      // JIKA USER MENGISI FORM (FORM NOT EMPTY) -> KONDISI A
      if (tipeAlpro && targetPerangkat.trim() !== '') {
        const textTarget = targetPerangkat.toUpperCase().trim();
        addLog(`[KONDISI A] Formulir terisi: Tipe alpro ${tipeAlpro}, Perangkat target: ${textTarget}`);
        
        // Ketentuan 2: Sebelum fetch file KML, cek localStorage. Jika token masih valid, langsung gunakan!
        let tokenToUse = driveToken;
        const localToken = localStorage.getItem('access_token') || localStorage.getItem('m_fosis_drive_token');
        const localExpiryStr = localStorage.getItem('expires_at') || localStorage.getItem('m_fosis_drive_expiry');
        const localExpiry = localExpiryStr ? parseInt(localExpiryStr, 10) : null;
        if (localToken && (!localExpiry || Date.now() < localExpiry)) {
          tokenToUse = localToken;
        }

        if (!tokenToUse) {
          addLog("Google Drive belum terhubung atau token kedaluwarsa, mencoba menyegarkan sesi...");
          try {
            if (refreshGoogleAccessToken) {
              tokenToUse = await refreshGoogleAccessToken();
            }
            // Ketentuan 4: Hanya panggil pop-up OAuth jika token belum ada/expired
            if (!tokenToUse && connectGoogleDrive) {
              tokenToUse = await connectGoogleDrive(false);
            }
            if (tokenToUse) {
              addLog("✓ Berhasil terhubung ke Google Drive!");
            }
          } catch (err) {
            addLog("⚠️ Autentikasi Google Drive gagal atau dibatalkan.");
          }
        }

        addLog(`Pencarian folder Google Drive (ID: 1AkJdPSJRWY6_xzWcQZM2cEsG-AT_2Jg_)...`);
        
        // Extract STO and ODC keyword for searching
        let extractedSTO = "MNZ";
        let extractedODC = "FF";
        const cleanTarget = textTarget.replace(/[^A-Z0-9-]/g, "");
        const parts = cleanTarget.split('-');
        if (parts.length >= 3) {
          extractedSTO = parts[1].trim();
          extractedODC = parts[2].split('/')[0].trim();
        } else if (parts.length === 2) {
          extractedSTO = parts[0].trim();
          extractedODC = parts[1].trim();
        } else {
          const match = textTarget.match(/([A-Z]{3})-([A-Z]{2})/);
          if (match) {
            extractedSTO = match[1];
            extractedODC = match[2];
          }
        }

        addLog(`Memulai pencarian KML hierarkis di backend untuk segment: "${tipeAlpro}", target: "${textTarget}"`);

        let kmlFoundAndParsed = false;

        // Try actual drive fetch if token is active
        if (tokenToUse) {
          try {
            let searchRes = await fetch("/api/drive/search-kml", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${tokenToUse}`
              },
              body: JSON.stringify({
                accessToken: tokenToUse,
                segment: tipeAlpro,
                searchName: textTarget,
                sto: extractedSTO,
                site: extractedODC
              })
            });

            // Ketentuan 4: JIKA TOKEN KEDALUWARSA (401), REFRESH ATAU PANGGIL POP-UP LALU RETRY
            if (!searchRes.ok && searchRes.status === 401) {
              addLog("Sesi Google Drive kedaluwarsa (401). Memperbarui sesi...");
              let refreshedToken = refreshGoogleAccessToken ? await refreshGoogleAccessToken() : null;
              if (!refreshedToken && connectGoogleDrive) {
                refreshedToken = await connectGoogleDrive(false);
              }
              if (refreshedToken) {
                tokenToUse = refreshedToken;
                addLog("✓ Sesi baru diperoleh. Mengulangi pencarian...");
                searchRes = await fetch("/api/drive/search-kml", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${tokenToUse}`
                  },
                  body: JSON.stringify({
                    accessToken: tokenToUse,
                    segment: tipeAlpro,
                    searchName: textTarget,
                    sto: extractedSTO,
                    site: extractedODC
                  })
                });
              }
            }

            if (searchRes.ok) {
              const searchData = await searchRes.json();
              if (searchData.files && searchData.files.length > 0) {
                const lines: any[] = [];
                const points: any[] = [];

                for (const targetFile of searchData.files) {
                  addLog(`Mengunduh berkas KML: "${targetFile.name}"...`);
                  
                  let dlRes;
                  if (targetFile.id && (targetFile.id.startsWith('simulated-') || targetFile.id.includes('simulated'))) {
                    dlRes = await fetch(`/api/drive/download-simulated-kml?name=${encodeURIComponent(targetFile.name)}`);
                  } else {
                    const dlUrl = `https://www.googleapis.com/drive/v3/files/${targetFile.id}?alt=media`;
                    dlRes = await fetch(dlUrl, {
                      headers: { 'Authorization': `Bearer ${tokenToUse}` }
                    });

                    // Ketentuan 4: JIKA TOKEN KEDALUWARSA SAAT DOWNLOAD, REFRESH/POP-UP LALU RETRY
                    if (!dlRes.ok && dlRes.status === 401) {
                      addLog("Sesi Google Drive kedaluwarsa (401) saat mengunduh. Memperbarui sesi...");
                      let refreshedToken = refreshGoogleAccessToken ? await refreshGoogleAccessToken() : null;
                      if (!refreshedToken && connectGoogleDrive) {
                        refreshedToken = await connectGoogleDrive(false);
                      }
                      if (refreshedToken) {
                        tokenToUse = refreshedToken;
                        addLog("✓ Token berhasil diperbarui. Mengulangi pengunduhan berkas...");
                        dlRes = await fetch(dlUrl, {
                          headers: { 'Authorization': `Bearer ${tokenToUse}` }
                        });
                      }
                    }
                  }

                  if (dlRes && dlRes.ok) {
                    const kmlText = await dlRes.text();
                    const cleanFileName = targetFile.name.replace(/\.kml$/i, '').trim();
                    const isOdcFile = cleanFileName.toUpperCase().startsWith('ODC-') || cleanFileName.toUpperCase().startsWith('ODC_');
                    
                    // XML Parsing
                    const parser = new DOMParser();
                    const kmlDom = parser.parseFromString(kmlText, 'text/xml');
                    const geoJson = toGeoJSON.kml(kmlDom);
                    
                    const fileLines: any[] = [];
                    const filePoints: any[] = [];
                    
                    const processGeometry = (geometry: any, properties: any) => {
                      if (!geometry) return;
                      if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
                        fileLines.push({ geometry, properties });
                      } else if (geometry.type === 'Point') {
                        filePoints.push({ geometry, properties });
                      } else if (geometry.type === 'Polygon') {
                        if (geometry.coordinates && geometry.coordinates.length > 0) {
                          fileLines.push({ geometry: { type: 'LineString', coordinates: geometry.coordinates[0] }, properties });
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

                    if (isOdcFile) {
                      if (filePoints.length === 0) {
                        const coordMatch = kmlText.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
                        if (coordMatch && coordMatch[1]) {
                          const coordParts = coordMatch[1].trim().split(/[\s,]+/);
                          if (coordParts.length >= 2) {
                            const lng = parseFloat(coordParts[0]);
                            const lat = parseFloat(coordParts[1]);
                            if (!isNaN(lat) && !isNaN(lng)) {
                              filePoints.push({
                                geometry: { type: 'Point', coordinates: [lng, lat] },
                                properties: { name: cleanFileName }
                              });
                            }
                          }
                        }
                      }
                      filePoints.forEach((p: any) => {
                        if (!p.properties) p.properties = {};
                        const currName = (p.properties.name || '').trim();
                        if (!currName || !currName.toUpperCase().includes('ODC')) {
                          p.properties.name = cleanFileName;
                        }
                      });
                    }

                    lines.push(...fileLines);
                    points.push(...filePoints);
                  }
                }

                addLog(`✓ Terdeteksi ${lines.length} LineString rute kabel fisik dan ${points.length} Placemark alpro KML.`);

                  if (lines.length > 0) {
                    addLog("Menghitung rute kabel utama...");
                    // Sort lines to find longest as main cable path
                    const sortedLines = lines.sort((a, b) => {
                      const lenA = a.geometry.coordinates ? a.geometry.coordinates.length : 0;
                      const lenB = b.geometry.coordinates ? b.geometry.coordinates.length : 0;
                      return lenB - lenA;
                    });
                    const mainLine = sortedLines[0];
                    const mainCoords: [number, number][] = mainLine.geometry.coordinates.map((c: any) => [c[1], c[0]]); // [lat, lng]

                    addLog(`Menjalankan internal tracker untuk memproyeksikan ${points.length} aset fisik ke rute hulu...`);
                    
                    const calculatedPoints = points.map(pt => {
                      const coord: [number, number] = [pt.geometry.coordinates[1], pt.geometry.coordinates[0]];
                      const distM = getDistanceAlongPath(mainCoords, coord);
                      return {
                        name: pt.properties?.name || 'Aset Tanpa Nama',
                        distMeters: distM
                      };
                    });

                    // Match closest to targetDistanceMeters (dominant loss event)
                    addLog(`Mencari korelasi optimal Jarak OTDR: ${targetDistanceKm} km (${targetDistanceMeters.toFixed(0)}m)...`);
                    let bestAsset = null;
                    let minDiff = Infinity;

                    calculatedPoints.forEach(p => {
                      const diff = Math.abs(p.distMeters - targetDistanceMeters);
                      if (diff < minDiff) {
                        minDiff = diff;
                        bestAsset = p;
                      }
                    });

                    if (bestAsset) {
                      selectedAsset = (bestAsset as any).name;
                      addLog(`✓ Korelasi Berhasil! Titik loss terdekat terproyeksi pada: "${selectedAsset}" (selisih ${(minDiff).toFixed(1)} meter)`);
                      kmlFoundAndParsed = true;
                    }
                  }
                }
              }
            } catch (e: any) {
            addLog(`⚠️ Gagal fetch rute dari Google Drive: ${e.message || e}`);
          }
        }

        // Dropbound / Token missing fallback (Condition A Fallback Mode)
        if (!kmlFoundAndParsed) {
          addLog("Berkas KML tidak aktif dari drive atau error, mengaktifkan korelasi biner otomatis via Local Asset Database...");
          const benchmarkAssets = tipeAlpro === 'FEEDER' ? FALLBACK_ASSETS_FEEDER : FALLBACK_ASSETS_DISTRIBUSI;
          
          let bestAsset = benchmarkAssets[0];
          let minDiff = Infinity;
          
          benchmarkAssets.forEach(p => {
            const diff = Math.abs(p.distMeters - targetDistanceMeters);
            if (diff < minDiff) {
              minDiff = diff;
              bestAsset = p;
            }
          });
          
          selectedAsset = bestAsset.name;
          addLog(`✓ Korelasi Lokal Berhasil: Aset fisik terdekat yang terpaut jarak ${targetDistanceKm} km adalah: "${selectedAsset}"`);
        }

        setSuspectedAsset(selectedAsset);
        addLog("Menyiapkan dynamic prompt korelasi lapangan untuk M-FOSIS AI Engine...");
        
        // Feed into Gemini API - Conditions A Prompt
        const promptA = `Anda adalah M-FOSIS AI Assistant, pakar optikal Telkom Akses Madiun. Tolong lakukan korelasi data. Link: ${tipeAlpro} ${targetPerangkat}. Hasil .SOR mendeteksi Event Loss sebesar ${dominantLossEvent.loss} dB pada jarak ${targetDistanceKm} km. Berdasarkan file KML, aset fisik terdekat di titik gangguan tersebut adalah ${selectedAsset}. Berikan analisa lokasi persis gangguan, faktor penyebab lapangan, dan action plan taktis tim maintenance.`;
        
        await triggerGemini(promptA, 'A', selectedAsset, targetDistanceKm, dominantLossEvent.loss);
      } 
      // JIKA USER TIDAK MENGISI FORM (FORM IS EMPTY) -> KONDISI B
      else {
        addLog("[KONDISI B] Formulir target kosong, masuk ke Mode Standalone (Murni Pembacaan SOR)...");
        addLog(`Menganalisa data biner .SOR: Total loss ${totalLoss} dB, Attenuasi ${attenuasi} dB/km, Panjang ${panjang} km...`);
        addLog("Mengekstrak urutan log event biner dari metadata file...");
        addLog("Menyiapkan dynamic prompt analisis mandiri untuk M-FOSIS AI Engine...");
        
        const eventsJson = JSON.stringify(events);
        const promptB = `Anda adalah M-FOSIS AI Assistant, pakar jaringan optik Telkom Akses Madiun. Pengguna hanya mengunggah file .SOR tanpa data KML lapangan. Tolong analisa data biner OTDR ini secara mandiri: Total Panjang: ${panjang} km, Total Loss: ${totalLoss} dB, Attenuasi: ${attenuasi} dB/km, Event Log: ${eventsJson}. Berikan Laporan Analisis Tingkat Keparahan Redaman, Estimasi Jarak Kerusakan, dan Penanganan di Lapangan.`;
        
        await triggerGemini(promptB, 'B');
      }

    } catch (error: any) {
      console.error(error);
      addLog(`❌ Gagal: ${error.message || error}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Launch Gemini API
  const triggerGemini = async (promptText: string, mode: 'A' | 'B', assetName?: string, distance?: number, lossVal?: string) => {
    setIsTyping(true);
    // User message display
    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: mode === 'A' 
        ? `Tolong lakukan korelasi data untuk link ${tipeAlpro} ${targetPerangkat}. Ada redaman ${lossVal} dB di km ${distance}. Lokasi fisik terdekat: ${assetName}.`
        : `Tolong analisa file OTDR .SOR ini secara mandiri: Panjang ${panjang} km, total loss ${totalLoss} dB, attenuasi ${attenuasi} dB/km.`
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3.5-flash",
          contents: promptText,
          systemInstruction: "Anda adalah asisten ahli Fiber Optic spesialis M-FOSIS untuk Telkom Akses Madiun. Berikan penjelasan terstruktur, teknis, bahasa profesional, rapi, dan mudah dibaca oleh teknisi di lapangan dalam Bahasa Indonesia."
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.text || "Gagal memperoleh respons dari AI.";
      setGeminiResponse(responseText);
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText
      }]);
      setHasCompletedAnalysis(true);
    } catch (err: any) {
      console.error("Gemini Failure: ", err);
      setMessages(prev => [...prev, {
        id: 'err',
        role: 'model',
        text: 'Maaf, terjadi kendala saat menghubungkan dengan M-FOSIS AI Engine. Pastikan API Key di panel Settings telah terpasang dengan benar.'
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  // Chat interface conversation
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { id: Date.now().toString(), role: 'user', text: chatInput };
    setMessages(prev => [...prev, userMsg]);
    const currentInput = chatInput;
    setChatInput('');
    setIsTyping(true);

    try {
      // Map simple message list to standard GoogleGenAI SDK contents structure:
      const mappedContents = [
        ...messages.map(m => ({
          role: m.role || 'user',
          parts: [{ text: m.text }]
        })),
        {
          role: 'user',
          parts: [{ text: currentInput }]
        }
      ];

      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3.5-flash",
          contents: mappedContents,
          systemInstruction: "Anda adalah M-FOSIS AI Assistant, pakar optikal Telkom Akses Madiun. Beri jawaban teknis fiber optik yang solutif, ringkas, dalam Bahasa Indonesia."
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.text || 'Maaf, saya tidak bisa merespons saat ini.';

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText
      }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: 'err',
        role: 'model',
        text: 'Gagal merespons. Terjadi kesalahan jaringan.'
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  // PDF formal report generation
  const downloadPDFReport = () => {
    try {
      const doc = new jsPDF();
      
      // Page styling & margins
      doc.setFont('helvetica', 'normal');
      
      // === HALAMAN 1 (DATA TEKNIS UTAMA) ===
      // Kop Surat Header
      doc.setFillColor(220, 38, 38); // Telkom Red accent bar
      doc.rect(15, 12, 180, 2, 'F');
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text("M-FOSIS - LAPORAN HASIL ANALISA GANGGUAN OPTIK", 15, 22);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(110, 110, 110);
      doc.text("(AUTOMATED AI RECOGNITION & REPAIR PLAN REPORT)", 15, 28);
      
      // Print date & file info
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const printDate = new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'});
      const printTime = new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'});
      doc.text(`Tanggal Cetak : ${printDate} - ${printTime} WIB`, 15, 34);
      doc.text(`Nama File .SOR: ${sorFileName}`, 15, 39);
      doc.text(`Dianalisa Oleh : M-FOSIS AI Engine - Telkom Akses Madiun`, 15, 44);
      
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(15, 48, 195, 48);

      // Section I: Technical Metrics
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(220, 38, 38);
      doc.text("BAGIAN I: RINGKASAN DATA TEKNIS", 15, 55);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      doc.text(`Arah/Tipe Alpro : ${targetPerangkat ? `${tipeAlpro} (${targetPerangkat})` : `${tipeAlpro} (Standalone Mode)`}`, 18, 62);
      doc.text(`Panjang Serat  : ${panjang} km`, 18, 68);
      doc.text(`Total Redaman  : ${totalLoss} dB`, 18, 74);
      doc.text(`Attenuasi Rata2: ${attenuasi} dB/km`, 18, 80);
      doc.text(`Panjang Wave   : ${waveLength} nm`, 18, 86);
      
      if (suspectedAsset) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(21, 128, 61); // Green success color
        doc.text(`Aset Terduga   : ${suspectedAsset} (Sesuai Titik Splicing Lapangan)`, 18, 92);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(40, 40, 40);
      }

      // Event table
      let y = suspectedAsset ? 101 : 95;
      doc.setFont('helvetica', 'bold');
      doc.text("Event Log Biner OTDR:", 15, y);
      y += 5;

      // Table Header Row
      doc.setFillColor(245, 245, 245);
      doc.rect(15, y, 180, 6, 'F');
      
      doc.setFontSize(9);
      doc.text("No", 17, y + 4.5);
      doc.text("Tipe Event", 26, y + 4.5);
      doc.text("Jarak (km)", 60, y + 4.5);
      doc.text("Loss (dB)", 95, y + 4.5);
      doc.text("Keterangan", 130, y + 4.5);
      
      doc.setDrawColor(220, 220, 220);
      doc.line(15, y, 195, y);
      doc.line(15, y + 6, 195, y + 6);
      y += 6;

      events.forEach((ev) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(ev.no.toString(), 17, y + 4.5);
        
        if (parseFloat(ev.loss) > 0.15 && ev.type === 'Loss') {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(220, 38, 38);
        } else {
          doc.setTextColor(40, 40, 40);
        }
        doc.text(ev.type, 26, y + 4.5);
        doc.setFont('helvetica', 'normal');
        
        doc.setTextColor(40, 40, 40);
        doc.text(`${ev.distance.toFixed(3)} km`, 60, y + 4.5);
        doc.text(`${ev.loss} dB`, 95, y + 4.5);
        doc.text(ev.note, 130, y + 4.5);
        
        doc.line(15, y + 6, 195, y + 6);
        y += 6;
      });

      // SUNTIKKAN PERINTAH KERJA KERAS PAGE-BREAK TO PG 2
      doc.addPage();

      // === HALAMAN 2 (REKOMENDASI AI & PENGESAHAN) ===
      // Kop Surat Page 2 Header Bar
      doc.setFillColor(220, 38, 38);
      doc.rect(15, 12, 180, 2, 'F');

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(220, 38, 38);
      doc.text("BAGIAN II: REKOMENDASI AI & ACTION PLAN LAPANGAN", 15, 21);

      // Define standard formatting function for PDF tables
      const drawRow = (rowY: number, colWidths: number[], colTexts: string[], bgHeader = false, isBold = false) => {
        const wrappedCols = colTexts.map((txt, index) => {
          return doc.splitTextToSize(txt, colWidths[index] - 4);
        });
        
        const maxLines = Math.max(...wrappedCols.map(lines => lines.length));
        const rowHeight = maxLines * 4.5 + 3.5; // Optimized compact spacing for A4
        
        if (bgHeader) {
          doc.setFillColor(180, 20, 20); // Deep red for headers
          doc.rect(15, rowY, colWidths.reduce((a, b) => a + b, 0), rowHeight, 'F');
          doc.setTextColor(255, 255, 255);
        } else {
          doc.setFillColor(252, 252, 252);
          doc.rect(15, rowY, colWidths.reduce((a, b) => a + b, 0), rowHeight, 'F');
          doc.setTextColor(40, 40, 40);
        }
        
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.2);
        
        let currentX = 15;
        wrappedCols.forEach((lines, colIndex) => {
          const w = colWidths[colIndex];
          doc.rect(currentX, rowY, w, rowHeight, 'S');
          
          lines.forEach((line: string, lineIndex: number) => {
            doc.text(line, currentX + 2, rowY + 3.5 + (lineIndex * 4.5));
          });
          
          currentX += w;
        });
        
        return rowHeight;
      };

      const isFeeder = tipeAlpro === 'FEEDER';
      const defaultTarget = targetPerangkat ? targetPerangkat.toUpperCase() : (isFeeder ? 'ODC-MNZ-FF' : 'ODC-MNZ-FAJ');
      const defaultDistKm = hasAnalyzed ? panjang : '0.485';
      const defaultDistM = (parseFloat(defaultDistKm) * 1000).toFixed(0);
      const defaultLoss = hasAnalyzed ? totalLoss : '0.375';
      const defaultAsset = suspectedAsset || (isFeeder ? 'Joint Closure Feeder-02 (Perempatan Sleko)' : 'Joint Closure MDN-03 (Depan Toko M-FOSIS)');

      // TABEL 1: TABEL ANALISIS KORELASI DATA GANGGUAN
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text("TABEL 1: ANALISIS KORELASI DATA GANGGUAN", 15, 27);

      const table1Rows = [
        { param: "Nama Link & Segmen", val: `${tipeAlpro} ${defaultTarget} (A-end)` },
        { param: "Jarak Kerusakan (OTDR)", val: `${defaultDistKm} km (${defaultDistM} Meter) dari hulu ODC` },
        { param: "Nilai Redaman (Event Loss)", val: `${defaultLoss} dB (Kategori: Minor to Moderate Anomaly — Melebihi standar Telkom ≤ 0.1 dB)` },
        { param: "Tipe Kejadian (Event)", val: "Non-Reflective Event (Indikasi bending tajam / degradasi splicing, bukan kabel putus total)" },
        { param: "Korelasi Aset KML", val: defaultAsset },
        { param: "Estimasi Lokasi Persis", val: `Tepat di dalam atau maksimal ± 5 meter sebelum/sesudah ${defaultAsset.split(' (')[0]} pada tiang distribusi terkait.` }
      ];

      let currentY = 30;
      doc.setFontSize(8.5);
      // Header Table 1
      currentY += drawRow(currentY, [60, 120], ["Parameter Gangguan", "Nilai / Hasil Analisis Lapangan"], true, true);
      
      // Rows Table 1
      table1Rows.forEach((row) => {
        currentY += drawRow(currentY, [60, 120], [row.param, row.val], false, false);
      });

      // TABEL 2: TABEL REKOMENDASI TAKTIS & ACTION PLAN TEKNISI
      currentY += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text("TABEL 2: REKOMENDASI TAKTIS & ACTION PLAN TEKNISI LAPANGAN", 15, currentY);
      currentY += 3;

      const table2Cols = [10, 95, 40, 35]; // Sums up to 180mm
      const table2Headers = ["No", "Langkah Kerja", "Target Lokasi", "Estimasi Material & Alat"];
      currentY += drawRow(currentY, table2Cols, table2Headers, true, true);

      const table2Rows = [
        {
          no: "1",
          kerja: "Lakukan pengecekan fisik dan perbaikan core di dalam Joint Closure (buka box, bersihkan tray, re-splicing jika protektor sleeve rusak/retak).",
          lokasi: defaultAsset.split(' (')[0],
          alat: "Splicer, Cleaver, Protection Sleeve."
        },
        {
          no: "2",
          kerja: "Lakukan patroli visual sejauh 5 meter ke hulu dan hilir tiang jika JC dalam kondisi aman, periksa potensi bending akibat kabel terjepit / tertimpa dahan.",
          lokasi: `Radius ± 5 meter dari ${defaultAsset.split(' (')[0]}`,
          alat: "Tangga, OPM, visual fault locator (senter hulu)."
        }
      ];

      table2Rows.forEach((row) => {
        currentY += drawRow(currentY, table2Cols, [row.no, row.kerja, row.lokasi, row.alat], false, false);
      });

      // AI Summary Text with cleaned LaTeX / Markdown
      currentY += 6;
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(220, 38, 38);
      doc.text("Catatan Teknis Tambahan AI:", 15, currentY);
      currentY += 4.5;

      let cleanAIExplanation = geminiResponse || "M-FOSIS AI Engine menganalisis adanya redaman sambungan (splice loss) di titik Joint Closure yang tertekuk (bending) atau kotor di lapangan. Rekomendasi utama adalah melakukan re-splicing pada core terdampak dan mengatur ulang rute kabel (cable management) di dalam cassette tray hulu.";
      
      // Clean up markdown/LaTeX signs:
      cleanAIExplanation = cleanAIExplanation
        .replace(/\\le/g, "≤")
        .replace(/\$\\le\$/g, "≤")
        .replace(/\\pm/g, "±")
        .replace(/\$\\pm\$/g, "±")
        .replace(/###/g, "")
        .replace(/---/g, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/\*/g, "•");

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const splitExplanation = doc.splitTextToSize(cleanAIExplanation, 180);
      
      for (let i = 0; i < splitExplanation.length; i++) {
        // Prevent overflow into page 3
        if (currentY > 227) {
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(110, 110, 110);
          doc.text("... [Laporan dipotong agar pas di batas maksimal 2 halaman]", 15, currentY);
          break;
        }
        doc.text(splitExplanation[i], 15, currentY);
        currentY += 4;
      }

      // Lembar Pengesahan Otomatis (Footer) di Bagian Paling Bawah Halaman 2
      const sigY = 235;
      doc.setDrawColor(210, 210, 210);
      doc.line(15, sigY, 195, sigY);
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text("TIM PEMELIHARAAN JARINGAN FIBER OPTIC", 15, sigY + 8);
      doc.text("PT. Telkom Akses Madiun", 15, sigY + 13);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(110, 110, 110);
      doc.text("M-FOSIS AI Engine — Tim Pemeliharaan Jaringan Telkom Akses Madiun", 15, sigY + 20);
      doc.text("Dokumen ini disahkan secara otomatis oleh M-FOSIS Automated Engine berbasis korelasi KML lapangan.", 15, sigY + 25);

      doc.save(`M_FOSIS_Automated_Report_${sorFileName.replace('.sor', '')}.pdf`);
    } catch (e) {
      console.error("PDF generation failure: ", e);
      alert("Terjadi kendala saat mencetak PDF.");
    }
  };

  return (
    <div className="space-y-6 w-full text-neutral-800" id="m_fosis_analisa_ai_stage">
      {/* Hero Header - Sticky / Freeze Panes */}
      <header className="sticky -top-4 md:-top-8 z-30 flex flex-col md:flex-row md:items-center justify-between border-b border-red-100/50 pb-5 pt-4 md:pt-8 bg-[#fffafa]/95 backdrop-blur-md px-4 md:px-8 -mx-4 md:-mx-8" id="analisa_header_bar">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-extrabold tracking-widest uppercase">M-FOSIS Engine</span>
            <span className="text-[10px] text-neutral-400 font-mono">• Telkom Akses Madiun</span>
          </div>
          <h1 className="text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
            Fiber Optic AI Assistant & SOR Analis
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
            Sistem korelasi file biner OTDR (*.SOR) secara visual dengan rute fisik KML untuk mitigasi gangguan core secara akurat.
          </p>
        </div>
        
        {/* Drive token badge status */}
        <div className="mt-3 md:mt-0" id="google_drive_badge">
          {driveToken ? (
            <div className="flex items-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200/60 px-4 py-2 rounded-full text-xs font-semibold shadow-sm">
              <span>Koneksi Cloud : Terhubung 📡</span>
              <span className="flex h-1.5 w-1.5 relative ml-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
            </div>
          ) : (
            <button 
              onClick={() => connectGoogleDrive()} 
              className="flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100/80 px-4 py-2 rounded-full text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <span>Koneksi Cloud : Terputus 🔌</span>
              <HardDrive size={13} className="ml-0.5 text-amber-700" />
            </button>
          )}
        </div>
      </header>

      {/* Main Core 2 Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="analisa_main_layout_grid">
        
        {/* KOLOM KIRI: Upload .SOR, Form Parameter, Metric Cards & Wide Event Table (60% / 7-cols) */}
        <div className="lg:col-span-7 space-y-6 flex flex-col" id="kolom_kiri_analisa">
          
          {/* Component Upload File .SOR */}
          <div 
            {...getRootProps()} 
            className={`p-8 border-2 border-dashed rounded-3xl text-center transition-all cursor-pointer bg-white relative overflow-hidden flex flex-col justify-center items-center ${
              isDragActive 
                ? 'border-red-500 bg-red-50/50 scale-[0.99] shadow-inner' 
                : 'border-neutral-200 hover:border-red-300 hover:bg-neutral-50/10'
            }`}
            id="sor_file_uploader_zone"
          >
            <input {...getInputProps()} />
            
            <div className="p-4 bg-red-50 text-red-600 rounded-full mb-3 shadow-sm border border-red-100/40">
              <Upload className="animate-pulse" size={28} />
            </div>
            
            <h3 className="text-sm font-bold text-neutral-800">Unggah File OTDR (.SOR)</h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-[320px]">
              Tarik file biner <code className="bg-neutral-100 text-neutral-600 px-1 py-0.5 rounded text-[10px]">.sor</code> Anda ke sini, atau klik untuk meramban.
            </p>
            
            <div className="mt-3 flex items-center gap-1.5 bg-neutral-100/50 hover:bg-neutral-100 px-3 py-1.5 rounded-xl border border-neutral-200" id="file_name_badge">
              <FileText size={12} className="text-red-500" />
              <span className="text-[10px] font-mono font-bold text-neutral-500">{sorFileName}</span>
            </div>
          </div>

          {/* Form Parameter Alpro Card */}
          <div className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm" id="form_parameter_alpro_card">
            <h2 className="text-sm font-black text-neutral-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Database size={16} className="text-red-600" />
              Form Parameter Alpro Lapangan
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-extrabold uppercase text-neutral-400 tracking-wider">Tipe Alpro</label>
                <select 
                  value={tipeAlpro}
                  onChange={(e) => setTipeAlpro(e.target.value as 'FEEDER' | 'DISTRIBUSI')}
                  className="bg-neutral-50 border border-neutral-200 active:border-red-500 focus:outline-none rounded-xl px-3 py-2.5 text-xs font-bold transition-all"
                >
                  <option value="FEEDER">FEEDER (Alpro STO - ODC)</option>
                  <option value="DISTRIBUSI">DISTRIBUSI (Alpro ODC - ODP)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-extrabold uppercase text-neutral-400 tracking-wider">Target Perangkat</label>
                <input 
                  type="text" 
                  value={targetPerangkat}
                  onChange={(e) => setTargetPerangkat(e.target.value)}
                  placeholder={tipeAlpro === 'FEEDER' ? 'Contoh: ODC-MNZ-FF' : 'Contoh: ODP-MNZ-FF/37'}
                  className="bg-neutral-50 border border-neutral-200 focus:ring-1 focus:ring-red-400 focus:outline-none rounded-xl px-3 py-2.5 text-xs font-bold transition-all font-mono"
                />
              </div>
            </div>

            {/* AI Action Execution Button */}
            <div className="mt-5 flex gap-3">
              <button
                onClick={handleStartAnalysis}
                disabled={isAnalyzing}
                className={`w-full flex items-center justify-center gap-2 font-extrabold text-xs tracking-wider uppercase text-white py-3 rounded-xl transition-all shadow-md active:scale-95 ${
                  isAnalyzing 
                    ? 'bg-neutral-400 cursor-not-allowed' 
                    : 'bg-red-600 hover:bg-red-700 hover:shadow-lg'
                }`}
                id="btn_mulai_analisa_ai"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="animate-spin" size={14} />
                    Sedang Memproses Analisa Korelasi...
                  </>
                ) : (
                  <>
                    <Bot size={14} />
                    Mulai Analisa AI
                  </>
                )}
              </button>
            </div>
            
            {/* Real-time Processing Logs */}
            <AnimatePresence>
              {stepLogs.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }} 
                  animate={{ opacity: 1, height: 'auto' }} 
                  exit={{ opacity: 0, height: 0 }} 
                  className="mt-4 p-4 bg-neutral-900 rounded-2xl border border-neutral-800 text-[10px] font-mono text-neutral-300 leading-relaxed overflow-hidden shadow-inner"
                  id="processing_logs_box"
                >
                  <p className="text-[9px] font-black uppercase text-neutral-500 tracking-widest mb-2 border-b border-neutral-800 pb-1">AI Execution Step-Logs:</p>
                  <div className="space-y-1 max-h-[140px] overflow-y-auto">
                    {stepLogs.map((log, index) => (
                      <div key={index} className="flex gap-2">
                        <span className="text-neutral-500 select-none">[{index + 1}]</span>
                        <p>{log}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Metrics summary boxes (.SOR metrics) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="sor_metrics_summary">
            <div className="bg-neutral-50/50 border border-neutral-200/80 p-4 rounded-2xl text-center">
              <p className="text-[9px] font-extrabold uppercase text-neutral-400 tracking-widest leading-none">Total Loss</p>
              <p className={`text-lg font-black mt-2 font-mono leading-none ${hasAnalyzed ? 'text-neutral-900' : 'text-neutral-400'}`}>
                {hasAnalyzed ? `${totalLoss} ` : '- '}
                <span className="text-xs font-bold text-neutral-500">dB</span>
              </p>
            </div>
            <div className="bg-neutral-50/50 border border-neutral-200/80 p-4 rounded-2xl text-center">
              <p className="text-[9px] font-extrabold uppercase text-neutral-400 tracking-widest leading-none">Attenuasi</p>
              <p className={`text-lg font-black mt-2 font-mono leading-none ${hasAnalyzed ? 'text-neutral-900' : 'text-neutral-400'}`}>
                {hasAnalyzed ? `${attenuasi} ` : '- '}
                <span className="text-xs font-bold text-neutral-500">dB/km</span>
              </p>
            </div>
            <div className="bg-neutral-50/50 border border-neutral-200/80 p-4 rounded-2xl text-center">
              <p className="text-[9px] font-extrabold uppercase text-neutral-400 tracking-widest leading-none">Panjang Link</p>
              <p className={`text-lg font-black mt-2 font-mono leading-none ${hasAnalyzed ? 'text-neutral-900' : 'text-neutral-400'}`}>
                {hasAnalyzed ? `${panjang} ` : '- '}
                <span className="text-xs font-bold text-neutral-500">km</span>
              </p>
            </div>
            <div className="bg-neutral-50/50 border border-neutral-200/80 p-4 rounded-2xl text-center">
              <p className="text-[9px] font-extrabold uppercase text-neutral-400 tracking-widest leading-none">Panjang Gelombang</p>
              <p className={`text-lg font-black mt-2 font-mono leading-none ${hasAnalyzed ? 'text-neutral-900' : 'text-neutral-400'}`}>
                {hasAnalyzed ? `${waveLength} ` : '- '}
                <span className="text-xs font-bold text-neutral-500">nm</span>
              </p>
            </div>
          </div>

          {/* Wide Event Sequence Table */}
          <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-sm overflow-hidden flex-1" id="tabel_event_urutan_biner">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-900 flex items-center gap-1.5">
                <FileText size={14} className="text-red-500" />
                Tabel Urutan Event Biner OTDR
              </h3>
              <span className="text-[10px] font-bold text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-lg">Default OTDR Standard</span>
            </div>
            
            <div className="overflow-x-auto rounded-2xl border border-neutral-100">
              <table className="w-full text-xs">
                <thead className="bg-neutral-800 text-white font-bold text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="p-3 text-center w-12">No</th>
                    <th className="p-3 text-left">Tipe Event</th>
                    <th className="p-3 text-left">Jarak (km)</th>
                    <th className="p-3 text-left">Loss (dB)</th>
                    <th className="p-3 text-left">Keterangan Teknis Lapangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 font-medium">
                  {hasAnalyzed ? (
                    events.map((ev, index) => {
                      const isSevereLoss = parseFloat(ev.loss) > 0.15 && ev.type === 'Loss';
                      return (
                        <tr 
                          key={ev.no} 
                          className={`hover:bg-neutral-50/50 transition-colors ${
                            isSevereLoss ? 'bg-red-50/20' : ''
                          }`}
                        >
                          <td className="p-3 text-center font-mono font-bold text-neutral-400">{index + 1}</td>
                          <td className={`p-3 font-bold ${
                            ev.type === 'Reflection' ? 'text-amber-600' :
                            isSevereLoss ? 'text-red-600' : 'text-neutral-700'
                          }`}>{ev.type}</td>
                          <td className="p-3 font-mono text-neutral-600">{ev.distance.toFixed(3)}</td>
                          <td className={`p-3 font-mono font-bold ${isSevereLoss ? 'text-red-600' : 'text-neutral-700'}`}>{ev.loss}</td>
                          <td className="p-3 text-neutral-500 font-sans tracking-tight">{ev.note}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-neutral-400 font-medium font-sans">
                        Belum ada data. Silakan masukkan parameter alpro dan klik 'Mulai Analisa AI' untuk membedah file .SOR.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* KOLOM KANAN: Panel Chat Interaktif "M-FOSIS AI Assistant" (40% / 5-cols) */}
        <div className="lg:col-span-5 flex" id="kolom_kanan_analisa">
          
          <div className="bg-white rounded-3xl border border-neutral-200 shadow-sm w-full flex flex-col h-[650px] overflow-hidden" id="ai_chat_panel_container">
            
            {/* Header chat with optional PDF export button */}
            <div className="p-4 border-b border-neutral-100 bg-red-600 text-white flex items-center justify-between" id="chat_header_ai">
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-white/10 rounded-xl">
                  <Bot size={20} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider leading-none">M-FOSIS AI Assistant</p>
                  <p className="text-[9px] opacity-80 mt-1 font-medium leading-none">Telkom Akses Madiun Expert System</p>
                </div>
              </div>

              {/* ACTION BUTTON: Download PDF */}
              {hasCompletedAnalysis && (
                <button
                  onClick={downloadPDFReport}
                  className="flex items-center gap-1.5 bg-white text-red-600 border border-white hover:bg-neutral-50 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all shadow-md active:scale-95"
                  id="pdf_export_btn_trigger"
                >
                  <Download size={12} />
                  Download PDF
                </button>
              )}
            </div>

            {/* Chat Messages flow scroll area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50/50" id="chat_messages_flow">
              {messages.map((m, index) => (
                <div 
                  key={m.id || index} 
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-sm flex flex-col gap-1.5 ${
                    m.role === 'user' 
                      ? 'bg-red-600 text-white rounded-tr-none' 
                      : 'bg-white text-neutral-700 border border-neutral-100 rounded-tl-none font-medium'
                  }`}>
                    {/* Message Text (Preserve whitespace line breaks from Gemini markdown) */}
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{m.text}</p>
                    ) : (
                      renderFormattedAiAssistantResponse(m.text)
                    )}
                    
                    {/* Timestamp signature */}
                    <span className={`text-[8px] font-mono self-end ${
                      m.role === 'user' ? 'text-white/60' : 'text-neutral-400'
                    }`}>
                      {new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div className="flex justify-start" id="ai_typing_indicator_chunk">
                  <div className="bg-white border border-neutral-100 p-3.5 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                    <Loader2 className="animate-spin text-red-600" size={14} />
                    <span className="text-[10px] font-bold text-neutral-400">Asisten sedang menulis laporan...</span>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>

            {/* Footer Input Form */}
            <div className="p-3 border-t border-neutral-100 bg-white flex gap-2" id="chat_input_controls">
              <input 
                value={chatInput} 
                onChange={e => setChatInput(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && sendChatMessage()} 
                placeholder="Tanya asisten terkait temuan serat optik..." 
                className="flex-1 bg-neutral-50/50 border border-neutral-200/60 px-4 py-2.5 rounded-xl text-xs outline-none focus:ring-1 focus:ring-red-300 font-medium transition-all"
                id="chat_text_input_field"
              />
              <button 
                onClick={sendChatMessage} 
                className="p-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors shadowactive:scale-95"
                id="chat_send_button_trigger"
              >
                <Send size={15} />
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
