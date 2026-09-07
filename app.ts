import express from "express";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { jsPDF } from "jspdf";

dotenv.config();

export const app = express();

app.use(express.json());

// Initialize Gemini client server-side lazily
let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not defined. Please add it to your system settings secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// API Route for server-side Gemini invocation
app.post("/api/gemini/generate", async (req: express.Request, res: express.Response) => {
  try {
    const { contents, systemInstruction, model } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: "GEMINI_API_KEY is not defined. Please add it to your system settings secrets." 
      });
    }

    // Helper function to call the Gemini API with automatic retries and model fallbacks on transient/high-demand errors
    const generateContentWithRetry = async (retriesLeft = 3, currentDelay = 1000, activeModel = model || "gemini-3.5-flash"): Promise<any> => {
      try {
        console.log(`[Gemini API] Requesting model: ${activeModel}`);
        return await getAi().models.generateContent({
          model: activeModel,
          contents: contents,
          config: systemInstruction ? { systemInstruction } : undefined
        });
      } catch (err: any) {
        const errMsgString = JSON.stringify(err) || err.message || "";
        const isTransient = 
          err.status === 503 || 
          err.statusCode === 503 ||
          errMsgString.includes("503") ||
          errMsgString.includes("UNAVAILABLE") ||
          errMsgString.includes("demand") ||
          errMsgString.includes("temporary");

        if (isTransient && retriesLeft > 0) {
          // Determine next fallback model in the chain
          let nextModel = activeModel;
          if (activeModel === "gemini-3.5-flash") {
            nextModel = "gemini-3.1-flash-lite";
          } else {
            nextModel = "gemini-3.5-flash";
          }
          
          console.warn(`[Gemini API] Encountered transient high demand on ${activeModel}. Retrying with fallback model ${nextModel} in ${currentDelay}ms... (${retriesLeft} retries remaining)`);
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
          return generateContentWithRetry(retriesLeft - 1, currentDelay * 1.5, nextModel);
        }
        throw err;
      }
    };

    const response = await generateContentWithRetry();

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini API server-side execution error:", error);
    let errMsg = error.message || "Unknown error during Gemini generation.";
    if (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("demand") || errMsg.includes("demand is usually temporary")) {
      errMsg = "Layanan AI (Gemini) sedang mengalami kepadatan lalu lintas yang sangat tinggi (503 Service Unavailable). Mohon tunggu beberapa detik lalu tekan tombol analisa kembali.";
    }
    res.status(500).json({ error: errMsg });
  }
});

// API Route for Google Sheets GViz proxy (prevents client-side CORS / Failed to fetch errors)
app.get("/api/sheets/gviz", async (req: express.Request, res: express.Response) => {
  try {
    const spreadsheetId = (req.query.spreadsheetId as string) || "1-O0AQxDPt5Zb2OHHE5Caj6KTiINZIomSgBIbTjnoLN8";
    const sheetName = (req.query.sheet as string) || "M-fosis";

    const urls = [
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`,
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
    ];

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const text = await response.text();
          if (text && text.trim().length > 0) {
            res.setHeader("Content-Type", "text/plain");
            return res.send(text);
          }
        }
      } catch (fetchErr) {
        console.warn(`[Sheets Proxy] Failed to fetch URL ${url}:`, fetchErr);
      }
    }

    res.status(500).json({ error: "Gagal mengambil data dari Google Spreadsheet." });
  } catch (err: any) {
    console.error("[Sheets Proxy Internal Error]", err);
    res.status(500).json({ error: err.message || "Gagal terhubung ke Google Spreadsheet." });
  }
});

// API Route for manual spreadsheet login verification
app.post("/api/auth/verify-login", async (req: express.Request, res: express.Response) => {
  try {
    const { username, userId, password } = req.body;
    const inputId = (username || userId || "").toString().trim();
    const inputPass = (password || "").toString().trim();

    if (!inputId) {
      return res.status(400).json({
        success: false,
        code: "MISSING_INPUT",
        message: "ID / USER tidak boleh kosong."
      });
    }

    console.log(`[Manual Login] Memverifikasi login untuk ID/USER: "${inputId}"...`);

    // Google Spreadsheet URL for sheet "LOGIN"
    const spreadsheetId = "1-yM2B0tN9A4ajHJmC6AoU-t98jM8njHscAZienhVGDU";
    const sheetUrls = [
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=LOGIN`,
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&sheet=LOGIN`
    ];

    let csvText = "";
    let fetchSuccess = false;

    for (const url of sheetUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          csvText = await response.text();
          if (csvText && csvText.trim().length > 0) {
            fetchSuccess = true;
            break;
          }
        }
      } catch (fetchErr) {
        console.warn(`[Manual Login] Gagal mengambil spreadsheet dari URL ${url}:`, fetchErr);
      }
    }

    if (!fetchSuccess || !csvText) {
      console.error("[Manual Login Error] Gagal mengambil data login dari Google Spreadsheet.");
      return res.status(500).json({
        success: false,
        code: "FETCH_ERROR",
        message: "Gagal terhubung ke basis data spreadsheet login. Silakan coba beberapa saat lagi."
      });
    }

    // Helper CSV Parser
    const parseCSV = (text: string) => {
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length === 0) return [];

      const parseLine = (line: string) => {
        const result: string[] = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (c === ',' && !inQuotes) {
            result.push(cur.trim());
            cur = "";
          } else {
            cur += c;
          }
        }
        result.push(cur.trim());
        return result;
      };

      return lines.map(parseLine);
    };

    const rows = parseCSV(csvText);
    if (rows.length < 2) {
      console.error("[Manual Login Error] Spreadsheet tidak berisi data pengguna.");
      return res.status(500).json({
        success: false,
        code: "EMPTY_DATA",
        message: "Data pengguna tidak ditemukan di spreadsheet."
      });
    }

    const dataRows = rows.slice(1);
    const cleanInputId = inputId.toLowerCase();

    // Find user row by Column A (index 0)
    const userRow = dataRows.find(r => {
      const colA = (r[0] || "").toString().trim().toLowerCase();
      return colA === cleanInputId;
    });

    if (!userRow) {
      console.warn(`[Manual Login] ID/USER "${inputId}" TIDAK DITEMUKAN di Kolom A.`);
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "user belum terdaftar , silahkan register ke leader area"
      });
    }

    // Compare password from Column F (index 5)
    const dbPassword = (userRow[5] || "").toString().trim();
    if (dbPassword !== inputPass) {
      console.warn(`[Manual Login] Password untuk ID "${inputId}" salah.`);
      return res.status(401).json({
        success: false,
        code: "INVALID_PASSWORD",
        message: "Password tidak sesuai. Silakan periksa kembali password Anda."
      });
    }

    // Success!
    const userRole = (userRow[6] || "").toString().trim().toUpperCase() === "ADMIN" ? "admin" : "technician";
    const displayName = (userRow[1] || "").toString().trim() || inputId;
    const email = (userRow[3] || "").toString().trim() || `${inputId}@m-fosis.net`;

    console.log(`[Manual Login] Login BERHASIL untuk user "${displayName}" (${inputId}), Role: ${userRole}`);

    return res.json({
      success: true,
      user: {
        uid: inputId,
        username: inputId,
        displayName: displayName,
        email: email,
        role: userRole,
        phone: (userRow[2] || "").toString().trim(),
        nikAtasan: (userRow[4] || "").toString().trim(),
        autoritas: (userRow[7] || "").toString().trim()
      }
    });

  } catch (err: any) {
    console.error("[Manual Login Error] Kesalahan server internal:", err);
    return res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Terjadi kesalahan sistem saat memproses login: " + (err.message || String(err))
    });
  }
});

// Helper function to validate if a Google Access Token is active
const isTokenActive = async (accessToken: string): Promise<boolean> => {
  try {
    console.log(`[Google OAuth Validation] Memeriksa status keaktifan access token...`);
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`);
    if (!res.ok) {
      console.warn(`[Google OAuth Validation] Token tidak valid atau habis masa berlaku (Status: ${res.status})`);
      return false;
    }
    console.log(`[Google OAuth Validation] Token masih aktif.`);
    return true;
  } catch (error) {
    console.error(`[Google OAuth Validation Error] Gagal memverifikasi token ke Google:`, error);
    return false;
  }
};

// API Route to refresh Google Drive Access Token using Google OAuth2 Refresh Token
app.post("/api/auth/google/refresh", async (req: express.Request, res: express.Response) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      console.error("[Google OAuth Refresh] Autentikasi Gagal: Refresh token tidak disediakan");
      return res.status(400).json({ error: "Refresh token wajib disediakan" });
    }

    console.log("[Google OAuth Refresh] Mengajukan pembaruan access token ke Google OAuth2...");

    const clientId = process.env.GOOGLE_CLIENT_ID || "156336512986-p7s2d627iabm5f77md8b0uud60vvg02b.apps.googleusercontent.com";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    const bodyParams: any = {
      client_id: clientId,
      refresh_token: refresh_token,
      grant_type: "refresh_token"
    };

    if (clientSecret) {
      bodyParams.client_secret = clientSecret;
    }

    const refreshUrl = "https://oauth2.googleapis.com/token";
    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(bodyParams)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[Google OAuth Refresh] Proses Autentikasi Gagal saat refresh (Status: ${response.status}): ${errorText}`);
      return res.status(response.status).json({ 
        error: "Gagal memperbarui token akses Google Drive. Silakan hubungkan ulang Google Drive.",
        rawError: errorText 
      });
    }

    const tokenData: any = await response.json();
    console.log("[Google OAuth Refresh] Sukses Autentikasi: Token akses Google Drive berhasil diperbarui!");
    
    return res.json({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in
    });

  } catch (error: any) {
    console.error("[Google OAuth Refresh Error] Kesalahan sistem internal:", error);
    return res.status(500).json({ error: "Terjadi kesalahan internal saat memperbarui token akses Google." });
  }
});

// Helper to determine if a KML files text contains a match for user's ODP query
function isValueMatchingOdp(kmlText: string, query: string): boolean {
  if (!kmlText || !query) return false;
  const cleanQ = query.trim().toUpperCase();
  const upperText = kmlText.toUpperCase();
  
  if (upperText.includes(cleanQ)) return true;
  if (upperText.includes(cleanQ.replace(/\//g, "-"))) return true;
  if (upperText.includes(cleanQ.replace(/-/g, "/"))) return true;
  
  const parts = cleanQ.split(/[-_/ ]/).filter(Boolean);
  let group = "";
  let numberStr = "";
  
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^\d+(\.\d+)?$/.test(p)) {
      numberStr = p.split('.')[0];
      if (i > 0) {
        const prev = parts[i - 1];
        if (prev !== "ODP" && prev.length <= 3 && !/^\d+$/.test(prev)) {
          group = prev;
        }
      }
      break;
    }
  }
  
  if (!group && parts.length > 0) {
    const possible = parts.filter(p => p !== "ODP" && p.length >= 1 && p.length <= 3 && isNaN(Number(p)));
    if (possible.length > 0) {
      group = possible[possible.length - 1];
    }
  }
  
  if (group && numberStr) {
    const nameTagRegex = /<name>([^<]+)<\/name>/gi;
    let match;
    while ((match = nameTagRegex.exec(upperText)) !== null) {
      const nameVal = match[1].trim();
      if (nameVal === cleanQ || nameVal.replace(/\//g, "-") === cleanQ || nameVal === cleanQ.replace(/\//g, "-")) {
        return true;
      }
      
      const kmlParts = nameVal.split(/[-_/ ]/).filter(Boolean);
      const hasGroup = kmlParts.some(p => p === group);
      const hasNumber = kmlParts.some(p => {
        const pureNum = p.split('.')[0];
        return pureNum === numberStr || p === numberStr;
      });
      
      if (hasGroup && hasNumber) {
        console.log(`[Google Drive Search - Match] Cocok alternatif di tag <name>: "${nameVal}" dengan grup "${group}" dan nomor "${numberStr}"`);
        return true;
      }
      
      if (nameVal.includes(group) && nameVal.includes(numberStr)) {
        const numIdx = nameVal.indexOf(numberStr);
        const charAfter = nameVal.charAt(numIdx + numberStr.length);
        const charBefore = numIdx > 0 ? nameVal.charAt(numIdx - 1) : '';
        const isWordMatch = (!charAfter || /[^0-9]/.test(charAfter)) && (!charBefore || /[^0-9]/.test(charBefore));
        if (isWordMatch) {
          console.log(`[Google Drive Search - Match Fallback] Cocok substring di tag <name>: "${nameVal}"`);
          return true;
        }
      }
    }
    
    const regexSafeGroup = group.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regexSafeNumber = numberStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const pattern = new RegExp(`\\b${regexSafeGroup}\\b[^<]{0,100}\\b${regexSafeNumber}\\b`, 'i');
    if (pattern.test(upperText)) {
      console.log(`[Google Drive Search - Match Fallback RegEx] Cocok full-text regex.`);
      return true;
    }
  }
  
  return false;
}

// Helper function to find the main shared M-FOSIS Google Drive folder across all users
async function findMFosisFolder(accessToken: string): Promise<{ id: string; name: string } | null> {
  const knownRootId = '1AkJdPSJRWY6_xzWcQZM2cEsG-AT_2Jg_';
  // 1. Try known shared folder ID directly
  try {
    const checkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${knownRootId}?fields=id,name,trashed`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (checkRes.ok) {
      const data: any = await checkRes.json();
      if (data && data.id && !data.trashed) {
        console.log(`[Google Drive Search] Menemukan folder utama M-Fosis via ID terbagi: ${data.id}`);
        return { id: data.id, name: data.name || 'M-Fosis' };
      }
    }
  } catch (e) {
    console.warn("[Google Drive Search] Gagal memeriksa ID folder terbagi M-Fosis:", e);
  }

  // 2. Search globally (searches both 'My Drive' and 'Shared with me')
  try {
    const globalQuery = `(name = 'M-Fosis' or name = 'M-FOSIS' or name = 'm-fosis') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const globalRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalQuery)}&fields=files(id,name)`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (globalRes.ok) {
      const globalData: any = await globalRes.json();
      if (globalData.files && globalData.files.length > 0) {
        console.log(`[Google Drive Search] Menemukan folder M-Fosis via pencarian global: ID ${globalData.files[0].id}`);
        return globalData.files[0];
      }
    }
  } catch (e) {
    console.warn("[Google Drive Search] Gagal pencarian global M-Fosis:", e);
  }

  // 3. Fallback to searching in root
  try {
    const rootQuery = `'root' in parents and (name = 'M-Fosis' or name = 'M-FOSIS' or name = 'm-fosis') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const rootRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootQuery)}&fields=files(id,name)`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (rootRes.ok) {
      const rootData: any = await rootRes.json();
      if (rootData.files && rootData.files.length > 0) {
        console.log(`[Google Drive Search] Menemukan folder M-Fosis di root: ID ${rootData.files[0].id}`);
        return rootData.files[0];
      }
    }
  } catch (e) {
    console.warn("[Google Drive Search] Gagal pencarian root M-Fosis:", e);
  }

  return null;
}

// Helper function to find the BAHAN REKON subfolder
async function findBahanRekonFolder(accessToken: string, mFosisFolderId: string | null): Promise<{ id: string; name: string } | null> {
  if (mFosisFolderId) {
    try {
      const bRekonQuery = `'${mFosisFolderId}' in parents and (name = 'BAHAN REKON' or name = 'Bahan Rekon' or name = 'bahan rekon') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const bRekonRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(bRekonQuery)}&fields=files(id,name)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (bRekonRes.ok) {
        const bRekonData: any = await bRekonRes.json();
        if (bRekonData.files && bRekonData.files.length > 0) {
          console.log(`[Google Drive Search] Menemukan folder BAHAN REKON di dalam M-Fosis: ID ${bRekonData.files[0].id}`);
          return bRekonData.files[0];
        }
      }
    } catch (e) {
      console.warn("[Google Drive Search] Gagal kueri BAHAN REKON di M-Fosis:", e);
    }
  }

  // Fallback: Global search for BAHAN REKON
  try {
    const globalBRekonQuery = `(name = 'BAHAN REKON' or name = 'Bahan Rekon' or name = 'bahan rekon') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const globalRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalBRekonQuery)}&fields=files(id,name)`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (globalRes.ok) {
      const globalData: any = await globalRes.json();
      if (globalData.files && globalData.files.length > 0) {
        console.log(`[Google Drive Search] Menemukan folder BAHAN REKON via kueri global: ID ${globalData.files[0].id}`);
        return globalData.files[0];
      }
    }
  } catch (e) {
    console.warn("[Google Drive Search] Gagal kueri global BAHAN REKON:", e);
  }

  return null;
}

// Helper to extract ALPRO code from input (e.g., ODP-MNZ-FD/11 -> MNZ-FD, ODC-MSP-FA -> MSP-FA)
function extractAlproCode(searchName?: string, site?: string, sto?: string): string {
  const raw = (searchName || site || "").toString().trim().toUpperCase();

  // Take the part before slash e.g. ODP-MNZ-FD/11 -> ODP-MNZ-FD
  const partBeforeSlash = raw.split('/')[0].trim();

  // Strip prefixes ODP-, ODC-, FDT-, RK-, OLT-
  const cleaned = partBeforeSlash.replace(/^(ODP|ODC|FDT|RK|OLT)[-_]/i, "").trim();

  if (cleaned) return cleaned;

  if (sto && site) {
    const cleanSto = sto.trim().toUpperCase().replace(/^(ST\.|ST_)/, "");
    const cleanSite = site.trim().toUpperCase();
    return `${cleanSto}-${cleanSite}`;
  }

  return raw;
}

// Helper to find a specific segment folder (DISTRIBUSI, FEEDER, SURGE)
async function findSegmentFolder(accessToken: string, mFosisFolderId: string | null, segmentName: string): Promise<{ id: string; name: string } | null> {
  const segUpper = segmentName.toUpperCase();
  const searchNames = [
    segUpper,
    segUpper.toLowerCase(),
    segUpper.charAt(0) + segUpper.slice(1).toLowerCase(),
    `Kabel ${segUpper}`,
    `KABEL ${segUpper}`,
    `Segment ${segUpper}`,
    `SEGMENT ${segUpper}`
  ];

  if (mFosisFolderId) {
    // 1. Direct parent = mFosisFolderId
    try {
      const nameConds = searchNames.map(n => `name = '${n}'`).join(' or ');
      const q = `'${mFosisFolderId}' in parents and (${nameConds}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data: any = await res.json();
        if (data.files && data.files[0]) {
          return data.files[0];
        }
      }
    } catch (e) {
      console.warn(`[Google Drive Search] Gagal kueri folder ${segmentName} di M-Fosis:`, e);
    }

    // 2. Parent = BAHAN REKON
    try {
      const bRekonFolder = await findBahanRekonFolder(accessToken, mFosisFolderId);
      if (bRekonFolder && bRekonFolder.id) {
        const nameConds = searchNames.map(n => `name = '${n}'`).join(' or ');
        const q = `'${bRekonFolder.id}' in parents and (${nameConds}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const data: any = await res.json();
          if (data.files && data.files[0]) {
            return data.files[0];
          }
        }
      }
    } catch (e) {
      console.warn(`[Google Drive Search] Gagal kueri folder ${segmentName} di Bahan Rekon:`, e);
    }
  }

  // 3. Global search
  try {
    const globalNameConds = searchNames.map(n => `name = '${n}'`).join(' or ');
    const globalQ = `(${globalNameConds}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalQ)}&fields=files(id,name)`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data.files && data.files[0]) {
        return data.files[0];
      }
    }
  } catch (e) {
    console.warn(`[Google Drive Search] Gagal kueri global folder ${segmentName}:`, e);
  }

  return null;
}

// Helper to find subfolder by ALPRO code (e.g. MNZ-FD or MSP-FA) inside a parent folder
async function findSubfolderByAlproCode(accessToken: string, parentFolderId: string, alproCode: string): Promise<{ id: string; name: string } | null> {
  if (!alproCode) return null;
  try {
    const subQuery = `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQuery)}&fields=files(id,name)&pageSize=1000`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;

    const data: any = await res.json();
    const subfolders = data.files || [];

    const cleanAlpro = alproCode.toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Match folder name containing cleanAlpro or vice versa
    let matched = subfolders.find((f: any) => {
      const cleanF = (f.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      return cleanF === cleanAlpro || cleanF.includes(cleanAlpro) || cleanAlpro.includes(cleanF);
    });

    if (matched) {
      console.log(`[Google Drive Search] Hierarchical: Menemukan subfolder ALPRO "${matched.name}" (ID: ${matched.id}) untuk kode "${alproCode}"`);
      return matched;
    }
  } catch (e) {
    console.warn(`[Google Drive Search] Gagal mencari subfolder ALPRO untuk "${alproCode}":`, e);
  }
  return null;
}

// Helper to identify ODC file name (e.g., ODC-XXX-XXX, ODC-MNZ-FA.kml, ODC_MNZ_FA, etc.)
function isOdcFileName(filename?: string): boolean {
  if (!filename) return false;
  const clean = filename.trim().toUpperCase().replace(/\.KML$/i, '');
  return (
    clean.startsWith('ODC-') ||
    clean.startsWith('ODC_') ||
    /^ODC[-_][A-Z0-9]+[-_][A-Z0-9]+/i.test(clean) ||
    clean.includes('ODC-') ||
    clean.includes('ODC_')
  );
}

// Helper to get all KML and ODC files in a parent folder
async function findKmlsInFolder(accessToken: string, folderId: string): Promise<any[]> {
  try {
    const kmlQuery = `'${folderId}' in parents and (name contains '.kml' or name contains 'ODC-' or name contains 'ODC_') and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)&pageSize=100`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (res.ok) {
      const data: any = await res.json();
      let files = (data.files || []).filter((f: any) => {
        const name = (f.name || "").toLowerCase();
        return name.endsWith(".kml") || isOdcFileName(f.name);
      });

      if (files.length === 0) {
        // Check 1 level deeper subfolders if no direct KMLs found
        const innerSubQuery = `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const innerSubRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(innerSubQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (innerSubRes.ok) {
          const innerData: any = await innerSubRes.json();
          const innerFolders = innerData.files || [];
          for (const fld of innerFolders) {
            const subKmlQuery = `'${fld.id}' in parents and (name contains '.kml' or name contains 'ODC-' or name contains 'ODC_') and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
            const subKmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subKmlQuery)}&fields=files(id,name,size)`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (subKmlRes.ok) {
              const subKmlData: any = await subKmlRes.json();
              const subFiles = (subKmlData.files || []).filter((f: any) => {
                const name = (f.name || "").toLowerCase();
                return name.endsWith(".kml") || isOdcFileName(f.name);
              });
              files.push(...subFiles);
            }
          }
        }
      }
      return files;
    }
  } catch (e) {
    console.warn(`[Google Drive Search] Gagal mencari berkas KML di folder ID "${folderId}":`, e);
  }
  return [];
}

// Helper to filter KML files by checking if they contain search query in name or content
async function filterKmlsByContent(accessToken: string, kmlFiles: any[], searchQuery: string): Promise<any[]> {
  if (!kmlFiles || kmlFiles.length === 0) return [];

  // Identify any ODC files (e.g., ODC-XXX-XXX) in this folder - these must ALWAYS be preserved and included in every search!
  const odcFiles = kmlFiles.filter(f => isOdcFileName(f.name));
  if (odcFiles.length > 0) {
    console.log(`[Google Drive Filter] Menemukan ${odcFiles.length} berkas ODC di dalam folder: ${odcFiles.map(f => f.name).join(', ')}`);
  }

  // Candidate files to filter (excluding ODC files so they are not pruned)
  const candidateFiles = kmlFiles.filter(f => !isOdcFileName(f.name));

  if (!searchQuery || !searchQuery.trim()) {
    return kmlFiles;
  }

  const cleanQuery = searchQuery.trim().toUpperCase();
  console.log(`[Google Drive Filter] Memfilter ${candidateFiles.length} berkas rute kabel dengan kata kunci "${cleanQuery}"...`);

  const matchedFiles: any[] = [];

  for (const file of candidateFiles) {
    if (!file.id || file.id.startsWith("simulated-")) {
      matchedFiles.push(file);
      continue;
    }

    // 1. Check file name first
    const fnameUpper = (file.name || "").toUpperCase();
    const queryNoSlash = cleanQuery.replace(/[\/\\]/g, "_");
    const queryHyphen = cleanQuery.replace(/\//g, "-");
    const querySlash = cleanQuery.replace(/-/g, "/");

    if (
      fnameUpper.includes(cleanQuery) ||
      fnameUpper.includes(queryNoSlash) ||
      fnameUpper.includes(queryHyphen) ||
      fnameUpper.includes(querySlash)
    ) {
      console.log(`[Google Drive Filter] Berkas "${file.name}" cocok berdasarkan nama file.`);
      matchedFiles.push(file);
      continue;
    }

    // 2. Download content & inspect with isValueMatchingOdp
    try {
      console.log(`[Google Drive Filter] Mengunduh & mengecek konten berkas: "${file.name}" (ID: ${file.id})...`);
      const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (mediaRes.ok) {
        const kmlContent = await mediaRes.text();
        const isMatch = isValueMatchingOdp(kmlContent, cleanQuery);
        if (isMatch) {
          console.log(`[Google Drive Filter] OK! Kata kunci "${cleanQuery}" DITEMUKAN di dalam isi berkas "${file.name}".`);
          matchedFiles.push(file);
        } else {
          console.log(`[Google Drive Filter] Kata kunci "${cleanQuery}" TIDAK ditemukan di berkas "${file.name}". Dilewati.`);
        }
      } else {
        console.warn(`[Google Drive Filter] Gagal mengunduh media berkas ${file.name}, status: ${mediaRes.status}`);
      }
    } catch (err) {
      console.error(`[Google Drive Filter Error] Gagal membaca isi KML ${file.name}:`, err);
    }
  }

  // Combine matched cable files with any ODC files found in that folder
  const finalResult = [...matchedFiles, ...odcFiles];
  console.log(`[Google Drive Filter] Selesai. Mengembalikan total ${finalResult.length} berkas (${matchedFiles.length} berkas rute kabel + ${odcFiles.length} berkas ODC).`);
  return finalResult;
}

// API Route for hierarchical, safe KML file search on Google Drive
app.post("/api/drive/search-kml", async (req: express.Request, res: express.Response) => {
  try {
    const { accessToken, segment, searchName, sto, site } = req.body;

    if (!accessToken) {
      console.error("[Google Drive Search] Autentikasi Gagal: Access token tidak disediakan");
      return res.status(400).json({ error: "Access token wajib disediakan" });
    }

    const isTokenValid = await isTokenActive(accessToken);
    if (!isTokenValid) {
      console.error("[Google Drive Search] Autentikasi Gagal: Token tidak aktif atau kedaluwarsa sebelum memulai proses.");
      return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa" });
    }

    const alproCode = extractAlproCode(searchName, site, sto);
    console.log(`[Google Drive Search] ========================================`);
    console.log(`[Google Drive Search] Memulai hierarchical search. Segment: "${segment}", searchName: "${searchName}", sto: "${sto}", site: "${site}", alproCode: "${alproCode}"`);

    const segUpper = (segment || "").toString().toUpperCase();
    const isDistribusi = segUpper.includes("DISTRIBUSI") || segUpper === "ODP";
    const isSurge = segUpper.includes("SURGE");
    const isFeeder = segUpper.includes("FEEDER") || segUpper.includes("BACKBONE") || (!isDistribusi && !isSurge);

    const mFosisFolder = await findMFosisFolder(accessToken);
    const mFosisFolderId = mFosisFolder ? mFosisFolder.id : null;

    // 1. SURGE: Langsung cari data/file di folder SURGE
    if (isSurge) {
      console.log(`[Google Drive Search - SURGE] Mencari folder SURGE...`);
      const surgeFolder = await findSegmentFolder(accessToken, mFosisFolderId, "SURGE");
      if (surgeFolder) {
        console.log(`[Google Drive Search - SURGE] Menemukan folder SURGE (ID: ${surgeFolder.id}). Mencari KML HANYA di folder tersebut...`);
        const surgeKmls = await findKmlsInFolder(accessToken, surgeFolder.id);
        if (surgeKmls.length > 0) {
          const filtered = await filterKmlsByContent(accessToken, surgeKmls, searchName || alproCode);
          if (filtered.length > 0) {
            console.log(`[Google Drive Search - SURGE] Berhasil menemukan ${filtered.length} berkas KML relevan.`);
            return res.json({ files: filtered });
          }
        }
      }
      console.log(`[Google Drive Search - SURGE] Folder SURGE tidak ditemukan / kosong / tidak cocok query. Menjalankan fallback...`);
    }

    // 2. DISTRIBUSI:
    // User input ODP-MNZ-FD/11 -> cari folder utama DISTRIBUSI -> cari subfolder MNZ-FD -> gunakan folder ID tersebut untuk mencari KML HANYA yang berisi data ODP-MNZ-FD/11
    if (isDistribusi) {
      console.log(`[Google Drive Search - DISTRIBUSI] Mencari folder utama DISTRIBUSI...`);
      const distFolder = await findSegmentFolder(accessToken, mFosisFolderId, "DISTRIBUSI");
      if (distFolder) {
        console.log(`[Google Drive Search - DISTRIBUSI] Menemukan folder DISTRIBUSI (ID: ${distFolder.id}). Mencari subfolder ALPRO: "${alproCode}"...`);
        const targetSubfolder = await findSubfolderByAlproCode(accessToken, distFolder.id, alproCode);
        if (targetSubfolder) {
          console.log(`[Google Drive Search - DISTRIBUSI] Menemukan subfolder target "${targetSubfolder.name}" (ID: ${targetSubfolder.id}). Mencari KML HANYA yang relevan di dalamnya...`);
          const targetKmls = await findKmlsInFolder(accessToken, targetSubfolder.id);
          if (targetKmls.length > 0) {
            const filtered = await filterKmlsByContent(accessToken, targetKmls, searchName || alproCode);
            if (filtered.length > 0) {
              console.log(`[Google Drive Search - DISTRIBUSI] Berhasil menemukan ${filtered.length} berkas KML relevan.`);
              return res.json({ files: filtered });
            }
          }
        }
      }
      console.log(`[Google Drive Search - DISTRIBUSI] Folder/subfolder target tidak ditemukan / kosong / tidak ada KML yang cocok query. Menjalankan fallback pencarian...`);
    }

    // 3. FEEDER:
    // Input ODC-MSP-FA -> FEEDER -> subfolder MSP-FA -> cari KML HANYA yang relevan di folder tersebut
    if (isFeeder && !isDistribusi && !isSurge) {
      console.log(`[Google Drive Search - FEEDER] Mencari folder utama FEEDER...`);
      const feederFolder = await findSegmentFolder(accessToken, mFosisFolderId, "FEEDER");
      if (feederFolder) {
        console.log(`[Google Drive Search - FEEDER] Menemukan folder FEEDER (ID: ${feederFolder.id}). Mencari subfolder ALPRO: "${alproCode}"...`);
        const targetSubfolder = await findSubfolderByAlproCode(accessToken, feederFolder.id, alproCode);
        if (targetSubfolder) {
          console.log(`[Google Drive Search - FEEDER] Menemukan subfolder target "${targetSubfolder.name}" (ID: ${targetSubfolder.id}). Mencari KML HANYA yang relevan di dalamnya...`);
          const targetKmls = await findKmlsInFolder(accessToken, targetSubfolder.id);
          if (targetKmls.length > 0) {
            const filtered = await filterKmlsByContent(accessToken, targetKmls, searchName || alproCode);
            if (filtered.length > 0) {
              console.log(`[Google Drive Search - FEEDER] Berhasil menemukan ${filtered.length} berkas KML relevan.`);
              return res.json({ files: filtered });
            }
          }
        }
      }
      console.log(`[Google Drive Search - FEEDER] Folder/subfolder target tidak ditemukan / kosong / tidak ada KML yang cocok query. Menjalankan fallback pencarian...`);
    }

    if (isSurge) {
      console.log(`[Google Drive Search - SURGE] Menjalankan pipeline khusus segmen SURGE...`);
      const mFosisFolder = await findMFosisFolder(accessToken);
      let mFosisFolderId = mFosisFolder ? mFosisFolder.id : null;

      let surgeFolderId = null;
      if (mFosisFolderId) {
        const surgeQuery = `'${mFosisFolderId}' in parents and (name = 'SURGE' or name = 'Surge' or name = 'surge') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const surgeRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(surgeQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (surgeRes.ok) {
          const surgeData: any = await surgeRes.json();
          if (surgeData.files && surgeData.files[0]) {
            surgeFolderId = surgeData.files[0].id;
          }
        }
      }
      
      if (!surgeFolderId) {
        const globalSurgeQuery = `(name = 'SURGE' or name = 'Surge' or name = 'surge') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const globalSurgeRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalSurgeQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (globalSurgeRes.ok) {
          const globalSurgeData = await globalSurgeRes.json();
          if (globalSurgeData.files && globalSurgeData.files[0]) {
            surgeFolderId = globalSurgeData.files[0].id;
          }
        }
      }

      if (!surgeFolderId) {
        return res.status(404).json({ error: "Folder SURGE tidak ditemukan di Google Drive Anda." });
      }

      const kmlQuery = `'${surgeFolderId}' in parents and name contains '.kml' and trashed = false`;
      const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)&pageSize=100`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      let matchedFiles: any[] = [];
      if (kmlRes.ok) {
        const kmlData = await kmlRes.json();
        matchedFiles = (kmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
      }

      if (matchedFiles.length === 0) {
        const subfoldersQuery = `'${surgeFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const subfoldersRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subfoldersQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (subfoldersRes.ok) {
          const subfoldersData = await subfoldersRes.json();
          const subfolders = subfoldersData.files || [];
          for (const folder of subfolders) {
            const subKmlQuery = `'${folder.id}' in parents and name contains '.kml' and trashed = false`;
            const subKmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subKmlQuery)}&fields=files(id,name,size)&pageSize=100`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (subKmlRes.ok) {
              const subKmlData = await subKmlRes.json();
              const files = (subKmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
              matchedFiles.push(...files);
            }
          }
        }
      }

      if (matchedFiles.length > 0) {
        const filtered = await filterKmlsByContent(accessToken, matchedFiles, searchName || alproCode);
        if (filtered.length > 0) matchedFiles = filtered;
      }

      if (matchedFiles.length === 0) {
        console.warn("[Google Drive Search - SURGE Warning] Berkas KML tidak ditemukan sama sekali di Drive. Menghasilkan KML simulasi.");
        const cleanName = (searchName || site || sto || "SURGE").toString().replace(/[\s/\\?=]+/g, "_");
        matchedFiles = [{
          id: `simulated-kml-${Date.now()}`,
          name: `AS_BUILT_DRAWING_${cleanName}_SIMULATED.kml`,
          size: "4520"
        }];
      }

      console.log(`[Google Drive Search - SURGE] Berhasil menemukan ${matchedFiles.length} berkas KML.`);
      return res.json({ files: matchedFiles });

    } else if (isDistribusi) {
      console.log(`[Google Drive Search - Distribusi] Menjalankan pipeline khusus segmen DISTRIBUSI...`);
      const mFosisFolder = await findMFosisFolder(accessToken);
      let mFosisFolderId = mFosisFolder ? mFosisFolder.id : null;
      
      console.log(`[Google Drive Search - Distribusi] Mencari folder "DISTRIBUSI" di dalam M-Fosis...`);
      let distribusiFolderId = null;
      
      const distQuery = `'${mFosisFolderId}' in parents and (name = 'DISTRIBUSI' or name = 'Distribusi' or name = 'distribusi' or name = 'Segment Distribusi' or name = 'SEGMENT DISTRIBUSI') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const distRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(distQuery)}&fields=files(id,name)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (distRes.ok) {
        const distData = await distRes.json();
        if (distData.files && distData.files[0]) {
          distribusiFolderId = distData.files[0].id;
          console.log(`[Google Drive Search - Distribusi] Menemukan folder "DISTRIBUSI": ID ${distribusiFolderId}`);
        }
      }
      
      if (!distribusiFolderId) {
        console.log(`[Google Drive Search - Distribusi] Folder "DISTRIBUSI" tidak ditemukan di level paling atas M-Fosis. Memeriksa di dalam "BAHAN REKON"...`);
        const bRekonQuery = `'${mFosisFolderId}' in parents and (name = 'BAHAN REKON' or name = 'Bahan Rekon') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const bRekonRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(bRekonQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (bRekonRes.ok) {
          const bRekonData = await bRekonRes.json();
          const bRekonFolder = bRekonData.files && bRekonData.files[0];
          if (bRekonFolder) {
            const subDistQuery = `'${bRekonFolder.id}' in parents and (name = 'DISTRIBUSI' or name = 'Distribusi' or name = 'distribusi' or name = 'Segment Distribusi' or name = 'SEGMENT DISTRIBUSI') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
            const subDistRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subDistQuery)}&fields=files(id,name)`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (subDistRes.ok) {
              const subDistData = await subDistRes.json();
              if (subDistData.files && subDistData.files[0]) {
                distribusiFolderId = subDistData.files[0].id;
                console.log(`[Google Drive Search - Distribusi] Menemukan folder "DISTRIBUSI" di dalam Bahan Rekon: ID ${distribusiFolderId}`);
              }
            }
          }
        }
      }
      
      if (!distribusiFolderId) {
        console.log(`[Google Drive Search - Distribusi] Folder "DISTRIBUSI" belum ketemu. Melakukan pencarian global...`);
        const globalDistQuery = `(name = 'DISTRIBUSI' or name = 'Distribusi' or name = 'distribusi') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const globalDistRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalDistQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (globalDistRes.ok) {
          const globalDistData = await globalDistRes.json();
          if (globalDistData.files && globalDistData.files[0]) {
            distribusiFolderId = globalDistData.files[0].id;
            console.log(`[Google Drive Search - Distribusi] Menemukan folder "DISTRIBUSI" global: ID ${distribusiFolderId}`);
          }
        }
      }
      
      if (!distribusiFolderId) {
        console.error(`[Google Drive Search - Distribusi Error] Folder DISTRIBUSI tidak ditemukan.`);
        return res.status(404).json({ error: "Folder DISTRIBUSI tidak ditemukan di dalam struktur Google Drive Anda." });
      }
      
      const cleanQuery = (searchName || site || "").trim().toUpperCase();
      console.log(`[Google Drive Search - Distribusi] Kata kunci pencarian: "${cleanQuery}"`);
      
      const splitParts = cleanQuery.split(/[-_/ ]/).filter(p => p.length >= 2);
      const excludeKeywords = ["ODP", "ODC", "FDT", "RK", "OLT", "KABEL", "FIBER", "SEGMENT", "DISTRIBUSI", "SIMULATED", "KML"];
      const searchElements = splitParts.filter(part => !excludeKeywords.includes(part) && isNaN(Number(part)));
      
      console.log(`[Google Drive Search - Distribusi] Unsur pencocokan folder yang terekstrak: ${JSON.stringify(searchElements)}`);
      
      console.log(`[Google Drive Search - Distribusi] Membaca semua sub-folder di dalam folder "DISTRIBUSI"...`);
      const subfoldersQuery = `'${distribusiFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const subfoldersRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subfoldersQuery)}&fields=files(id,name)&pageSize=1000`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      let matchingFolders = [];
      if (subfoldersRes.ok) {
        const subfoldersData = await subfoldersRes.json();
        const subFolders = subfoldersData.files || [];
        console.log(`[Google Drive Search - Distribusi] Berhasil mendaftar ${subFolders.length} sub-folder dari DISTRIBUSI.`);
        
        if (searchElements.length > 0) {
          matchingFolders = subFolders.filter((folder: any) => {
            const fname = folder.name.toUpperCase();
            return searchElements.every(el => fname.includes(el));
          });
          console.log(`[Google Drive Search - Distribusi] Menemukan ${matchingFolders.length} sub-folder yang mengandung semua unsur: ${matchingFolders.map((f: any) => f.name).join(", ")}`);
          
          if (matchingFolders.length === 0 && searchElements.length > 1) {
            matchingFolders = subFolders.filter((folder: any) => {
              const fname = folder.name.toUpperCase();
              return searchElements.some(el => fname.includes(el));
            });
            console.log(`[Google Drive Search - Distribusi Fallback] Menemukan ${matchingFolders.length} sub-folder longgar: ${matchingFolders.map((f: any) => f.name).join(", ")}`);
          }
        }
        
        if (matchingFolders.length === 0) {
          matchingFolders = subFolders.filter((folder: any) => {
            const fname = folder.name.toUpperCase();
            return fname.includes(cleanQuery) || cleanQuery.includes(fname);
          });
          console.log(`[Google Drive Search - Distribusi Fallback Kasar] Menemukan ${matchingFolders.length} folder cocok mentah.`);
        }
      }
      
      let finalMatchedFiles = [];
      
      if (matchingFolders.length > 0) {
        console.log(`[Google Drive Search - Distribusi] Memulai pemindaian file KML di tingkat sub-folder yang cocok...`);
        for (const folder of matchingFolders) {
          console.log(`[Google Drive Search - Distribusi] Membaca file KML di folder: "${folder.name}" (ID)`);
          const kmlQuery = `'${folder.id}' in parents and name contains '.kml' and trashed = false`;
          const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          
          if (kmlRes.ok) {
            const kmlData = await kmlRes.json();
            const kmlFiles = (kmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
            console.log(`[Google Drive Search - Distribusi] Ditemukan ${kmlFiles.length} file KML untuk dipindai isinya.`);
            
            const odcFilesInFolder = kmlFiles.filter((f: any) => {
              const fn = (f.name || "").trim().toUpperCase();
              return fn.startsWith("ODC-") || fn.startsWith("ODC_");
            });

            let folderMatchedFiles: any[] = [];
            for (const file of kmlFiles) {
              console.log(`[Google Drive Search - Distribusi] Mengunduh & memeriksa isi file: "${file.name}" (ID: ${file.id})`);
              try {
                const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                  headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                
                if (mediaRes.ok) {
                  const kmlContent = await mediaRes.text();
                  const isFound = isValueMatchingOdp(kmlContent, cleanQuery);
                                  
                  if (isFound) {
                    console.log(`[Google Drive Search - Distribusi] OK! Kata kunci ditemukan di dalam isi file "${file.name}". Berkas ini akan digunakan.`);
                    folderMatchedFiles.push(file);
                  } else {
                    console.log(`[Google Drive Search - Distribusi] Kata kunci tidak ditemukan di "${file.name}". Tutup file, lanjut memeriksa file lain...`);
                  }
                } else {
                  console.warn(`[Google Drive Search - Distribusi] Gagal mengunduh file media ${file.name}. Status: ${mediaRes.status}`);
                }
              } catch (readErr) {
                console.error(`[Google Drive Search - Distribusi Error] Gagal membaca konten KML:`, readErr);
              }
            }

            if (folderMatchedFiles.length > 0) {
              finalMatchedFiles.push(...folderMatchedFiles);
              // Always include ODC files from this subfolder
              for (const odcFile of odcFilesInFolder) {
                if (!finalMatchedFiles.some((f: any) => f.id === odcFile.id || f.name === odcFile.name)) {
                  console.log(`[Google Drive Search - Distribusi] Menyertakan berkas titik ODC "${odcFile.name}" dari subfolder "${folder.name}"`);
                  finalMatchedFiles.push(odcFile);
                }
              }
            } else if (odcFilesInFolder.length > 0 && kmlFiles.length > 0) {
              // If none matched exact string but folder was explicitly matched by Alpro, include kmlFiles and odc
              finalMatchedFiles.push(...kmlFiles);
            }
          }
        }
      } else {
        console.log(`[Google Drive Search - Distribusi] Tidak ada subfolder yang cocok untuk pencarian elemen. Melacak berkas KML langsung di root folder "DISTRIBUSI"...`);
        const kmlQuery = `'${distribusiFolderId}' in parents and name contains '.kml' and trashed = false`;
        const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (kmlRes.ok) {
          const kmlData = await kmlRes.json();
          const kmlFiles = (kmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
          console.log(`[Google Drive Search - Distribusi] Menemukan ${kmlFiles.length} file KML di root DISTRIBUSI.`);
          
          for (const file of kmlFiles) {
            try {
              const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              if (mediaRes.ok) {
                const kmlContent = await mediaRes.text();
                if (isValueMatchingOdp(kmlContent, cleanQuery)) {
                  console.log(`[Google Drive Search - Distribusi] OK! Kata kunci ditemukan langsung di dalam berkas root KML "${file.name}".`);
                  finalMatchedFiles.push(file);
                }
              }
            } catch (e) {
              console.error(`[Google Drive Search - Distribusi Error] Gagal memeriksa isi file root KML:`, e);
            }
          }
        }
      }
      
      if (finalMatchedFiles.length === 0) {
        console.log(`[Google Drive Search - Distribusi] Pemindaian konten berkas tuntas tanpa hasil. Menjalankan fallback kueri nama berkas di drive...`);
        const fnQuery = `(name contains '${cleanQuery}' or name contains '${cleanQuery.replace(/[\/\\]/g, "_")}') and name contains '.kml' and trashed = false`;
        const fnRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fnQuery)}&fields=files(id,name,size)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (fnRes.ok) {
          const fnData = await fnRes.json();
          finalMatchedFiles = (fnData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
          if (finalMatchedFiles.length > 0) {
            console.log(`[Google Drive Search - Distribusi] Fallback sukses! Menemukan ${finalMatchedFiles.length} berkas KML dari nama.`);
          }
        }
      }
      
      if (finalMatchedFiles.length === 0) {
        console.warn("[Google Drive Search - Distribusi Warning] Berkas KML tidak ditemukan sama sekali di Drive. Menghasilkan KML simulasi.");
        const simulatedCable = {
          id: `simulated-kml-${Date.now()}`,
          name: `AS_BUILT_DRAWING_${cleanQuery.replace(/[\s/\\?=]+/g, "_")}_SIMULATED.kml`,
          size: "4520"
        };
        let odcNameSim = "ODC-DISTRIBUSI";
        const parts = cleanQuery.split(/[\/-]/).filter((p: string) => p.length >= 2);
        if (parts.length >= 3) {
          odcNameSim = `ODC-${parts[1]}-${parts[2]}`;
        } else if (parts.length >= 2) {
          odcNameSim = `ODC-${parts[0]}-${parts[1]}`;
        }
        const simulatedOdc = {
          id: `simulated-odc-${Date.now()}`,
          name: `${odcNameSim}_SIMULATED.kml`,
          size: "1850"
        };
        finalMatchedFiles = [simulatedCable, simulatedOdc];
      }
      
      console.log(`[Google Drive Search - Distribusi] Berhasil merampungkan penelusuran. Mengembalikan ${finalMatchedFiles.length} berkas.`);
      return res.json({ files: finalMatchedFiles });
      
    } else {
      console.log(`[Google Drive Search] Langkah 1: Mencari folder utama "M-Fosis"...`);
      const mFosisFolder = await findMFosisFolder(accessToken);
      const bRekonFolder = await findBahanRekonFolder(accessToken, mFosisFolder ? mFosisFolder.id : null);

      let subFolders: any[] = [];
      if (bRekonFolder && bRekonFolder.id) {
        console.log(`[Google Drive Search] Langkah 3: Mencari sub-folder di dalam BAHAN REKON (${bRekonFolder.name})...`);
        const level3Query = `'${bRekonFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const level3Res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(level3Query)}&fields=files(id,name)&pageSize=1000`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (level3Res.ok) {
          const level3Data: any = await level3Res.json();
          subFolders = level3Data.files || [];
        } else if (level3Res.status === 401 || level3Res.status === 403) {
          return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa atau tidak valid." });
        }
      }

      const queryName = (searchName || "").toString().trim().toUpperCase();
      const querySto = (sto || "").toString().trim().toUpperCase();

      let targetSubFolder = subFolders.find((f: any) => {
        const folderNameUpper = (f.name || "").toUpperCase();
        if (queryName && folderNameUpper.includes(queryName)) return true;
        if (querySto && folderNameUpper.includes(querySto)) return true;
        return false;
      });

      if (!targetSubFolder && queryName) {
        targetSubFolder = subFolders.find((f: any) => {
          const folderNameUpper = (f.name || "").toUpperCase();
          const cleanQuery = queryName.replace(/[^A-Z0-9]/g, "");
          const cleanFolder = folderNameUpper.replace(/[^A-Z0-9]/g, "");
          return cleanFolder.includes(cleanQuery) || cleanQuery.includes(cleanFolder);
        });
      }

      if (!targetSubFolder && subFolders.length > 0) {
        targetSubFolder = subFolders[0];
      }

      let kmlFiles: any[] = [];

      if (targetSubFolder && targetSubFolder.id) {
        console.log(`[Google Drive Search] Langkah 4: Mencari file .kml di dalam sub-folder "${targetSubFolder.name}"...`);
        const kmlQuery = `'${targetSubFolder.id}' in parents and name contains '.kml' and trashed = false`;
        const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (kmlRes.ok) {
          const kmlData: any = await kmlRes.json();
          kmlFiles = (kmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
        } else if (kmlRes.status === 401 || kmlRes.status === 403) {
          return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa atau tidak valid." });
        }

        // Memeriksa sub-folder di dalam targetSubFolder jika berkas KML tidak ditemukan langsung
        if (kmlFiles.length === 0) {
          console.log(`[Google Drive Search] Tidak ada file .kml langsung di "${targetSubFolder.name}". Memeriksa sub-folder di dalamnya...`);
          const innerSubQuery = `'${targetSubFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const innerSubRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(innerSubQuery)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (innerSubRes.ok) {
            const innerData: any = await innerSubRes.json();
            const innerFolders = innerData.files || [];
            for (const fld of innerFolders) {
              const subKmlQuery = `'${fld.id}' in parents and name contains '.kml' and trashed = false`;
              const subKmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subKmlQuery)}&fields=files(id,name,size)`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              if (subKmlRes.ok) {
                const subKmlData: any = await subKmlRes.json();
                const matched = (subKmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
                kmlFiles.push(...matched);
              }
            }
          }
        }
      }

      // Fallback pencarian global di Google Drive jika KML belum ditemukan
      if (kmlFiles.length === 0 && queryName) {
        console.log(`[Google Drive Search] KML belum ditemukan di sub-folder. Menjalankan fallback kueri nama berkas KML global di Drive...`);
        const cleanKey = queryName.replace(/[\s/\\?=]+/g, "_");
        const globalKmlQuery = `name contains '.kml' and (name contains '${queryName}' or name contains '${cleanKey}') and trashed = false`;
        const globalRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalKmlQuery)}&fields=files(id,name,size)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (globalRes.ok) {
          const globalData: any = await globalRes.json();
          kmlFiles = (globalData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
        }
      }

      if (kmlFiles.length > 0) {
        const filtered = await filterKmlsByContent(accessToken, kmlFiles, searchName || alproCode);
        if (filtered.length > 0) kmlFiles = filtered;
      }

      // Final fallback: Hasilkan KML simulasi jika berkas KML asli tidak ditemukan di mana pun
      if (kmlFiles.length === 0) {
        console.warn(`[Google Drive Search Warning] KML file tidak ditemukan di Drive. Menghasilkan KML simulasi.`);
        const cleanName = (queryName || querySto || (targetSubFolder ? targetSubFolder.name : "SIMULATED")).replace(/[\s/\\?=]+/g, "_");
        kmlFiles = [{
          id: `simulated-kml-${Date.now()}`,
          name: `AS_BUILT_DRAWING_${cleanName}_SIMULATED.kml`,
          size: "4520"
        }];
      }

      console.log(`[Google Drive Search] Berhasil! Mengembalikan ${kmlFiles.length} file KML.`);
      return res.json({ files: kmlFiles });
    }

  } catch (error: any) {
    console.error("[Google Drive Search Error] Internal Error:", error);
    return res.status(500).json({ error: error.message || "Gagal melakukan pencarian di Google Drive." });
  }
});

// API Route for downloading simulated/fallback KML file
app.get("/api/drive/download-simulated-kml", async (req: express.Request, res: express.Response) => {
  try {
    const filename = (req.query.filename as string) || (req.query.name as string) || "AS_BUILT_DRAWING_SIMULATED.kml";
    const titleMatch = filename.replace(/^AS_BUILT_DRAWING_|_SIMULATED\.kml$/gi, "").replace(/_/g, " ");

    if (filename.toUpperCase().startsWith("ODC-") || filename.toUpperCase().includes("_TITIK_ODC")) {
      const odcTitle = filename.replace(/\.kml$/i, "").replace(/_SIMULATED/gi, "").replace(/_TITIK_ODC/gi, "");
      const simulatedODCKML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${odcTitle}</name>
    <description>Simulated ODC Point generated by M-FOSIS System</description>
    <Placemark>
      <name>${odcTitle}</name>
      <description>Titik Perangkat ODC</description>
      <Point>
        <coordinates>106.827153,-6.175392,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
      res.setHeader("Content-Type", "application/vnd.google.earth.kml+xml");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(simulatedODCKML);
    }

    const simulatedKML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${titleMatch} - SIMULATED AS BUILT DRAWING</name>
    <description>Simulated KML generated by M-FOSIS System when actual Drive file is missing.</description>
    <Placemark>
      <name>STO-SIMULATED</name>
      <Point>
        <coordinates>106.827153,-6.175392,0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>${titleMatch}</name>
      <Point>
        <coordinates>106.832000,-6.180000,0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>JALUR_KABEL_SIMULASI</name>
      <LineString>
        <coordinates>
          106.827153,-6.175392,0
          106.829500,-6.177500,0
          106.832000,-6.180000,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

    res.setHeader("Content-Type", "application/vnd.google.earth.kml+xml");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(simulatedKML);
  } catch (error: any) {
    console.error("[Simulated KML Download Error]:", error);
    return res.status(500).json({ error: "Gagal membuat berkas KML simulasi." });
  }
});

// API Route to fetch evidence photo files from Google Drive folder
app.post("/api/drive/fetch-photos", async (req: express.Request, res: express.Response) => {
  try {
    const { accessToken, searchName, sto } = req.body;

    if (!accessToken) {
      console.error("[Google Drive Fetch Photos] Autentikasi Gagal: Access token tidak disediakan");
      return res.status(400).json({ error: "Access token wajib disediakan" });
    }

    const isTokenValid = await isTokenActive(accessToken);
    if (!isTokenValid) {
      console.error("[Google Drive Fetch Photos] Autentikasi Gagal: Token tidak aktif atau kedaluwarsa sebelum mengambil foto.");
      return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa" });
    }

    console.log(`[Google Drive Fetch Photos] Memulai pencarian foto bukti fisik di Google Drive...`);

    const mFosisFolder = await findMFosisFolder(accessToken);
    const bRekonFolder = await findBahanRekonFolder(accessToken, mFosisFolder ? mFosisFolder.id : null);

    let subFolders: any[] = [];
    if (bRekonFolder && bRekonFolder.id) {
      const level3Query = `'${bRekonFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const level3Res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(level3Query)}&fields=files(id,name)&pageSize=1000`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (level3Res.ok) {
        const level3Data: any = await level3Res.json();
        subFolders = level3Data.files || [];
      } else if (level3Res.status === 401 || level3Res.status === 403) {
        return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa atau tidak valid." });
      }
    }

    const queryName = (searchName || "").toString().trim().toUpperCase();
    const querySto = (sto || "").toString().trim().toUpperCase();

    let targetSubFolder = subFolders.find((f: any) => {
      const folderNameUpper = (f.name || "").toUpperCase();
      if (queryName && folderNameUpper.includes(queryName)) return true;
      if (querySto && folderNameUpper.includes(querySto)) return true;
      return false;
    });

    if (!targetSubFolder && subFolders.length > 0) {
      targetSubFolder = subFolders[0];
    }

    if (!targetSubFolder || !targetSubFolder.id) {
      return res.status(404).json({ error: "Sub-folder spesifik tidak ditemukan" });
    }

    const photoQuery = `'${targetSubFolder.id}' in parents and (mimeType contains 'image/' or name contains '.jpg' or name contains '.jpeg' or name contains '.png') and trashed = false`;
    const photoRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(photoQuery)}&fields=files(id,name,mimeType,thumbnailLink,webContentLink)&pageSize=100`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!photoRes.ok) {
      if (photoRes.status === 401 || photoRes.status === 403) {
        return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa atau tidak valid." });
      }
      return res.status(photoRes.status).json({ error: "Gagal mengambil foto dari Google Drive" });
    }

    const photoData: any = await photoRes.json();
    const photos = photoData.files || [];

    console.log(`[Google Drive Fetch Photos] Berhasil menemukan ${photos.length} foto bukti fisik.`);
    return res.json({ photos });

  } catch (error: any) {
    console.error("[Google Drive Fetch Photos Error]:", error);
    return res.status(500).json({ error: error.message || "Gagal mengambil foto dari Google Drive." });
  }
});

// API Route for server-side jsPDF Report Generation
app.post("/api/pdf/generate", async (req: express.Request, res: express.Response) => {
  try {
    const { 
      noTiket, 
      segmenKabel, 
      sto, 
      titikUkur, 
      panjangPutus, 
      jenisKabel, 
      coreKabel, 
      analisaAi, 
      koordinatEstimasi, 
      fotoBukti, 
      tanggal, 
      petugas 
    } = req.body;

    console.log(`[PDF Generator API] Memulai pembuatan PDF Berita Acara Rekon untuk Tiket: ${noTiket || "TANPA-TIKET"}`);

    const doc = new jsPDF();
    let currentY = 15;

    doc.setFillColor(220, 38, 38);
    doc.rect(0, 0, 210, 8, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(220, 38, 38);
    doc.text("TELKOM INDONESIA - M-FOSIS", 15, currentY + 8);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Sistem Estimasi Lokasi Gangguan Fiber Optik & Berita Acara Rekon", 15, currentY + 14);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(15, currentY + 18, 195, currentY + 18);

    currentY += 26;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text("BERITA ACARA REKONSILIASI & ESTIMASI PUTUS KABEL", 105, currentY, { align: "center" });

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`Nomor Tiket: ${noTiket || "TKT-MFOSIS-" + Date.now()}`, 105, currentY + 6, { align: "center" });
    doc.text(`Tanggal Laporan: ${tanggal || new Date().toLocaleDateString("id-ID")}`, 105, currentY + 11, { align: "center" });

    currentY += 20;

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, currentY, 180, 48, 3, 3, "F");
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(15, currentY, 180, 48, 3, 3, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("INFORMASI PARAMETER GANGGUKAN & ASET", 20, currentY + 8);

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text("STO / Central Office:", 20, currentY + 16);
    doc.text("Segmen Kabel:", 20, currentY + 23);
    doc.text("Titik Ukur OTDR:", 20, currentY + 30);
    doc.text("Panjang Putus / Jarak:", 20, currentY + 37);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(sto || "-", 70, currentY + 16);
    doc.text(segmenKabel || "-", 70, currentY + 23);
    doc.text(titikUkur || "-", 70, currentY + 30);
    doc.text(`${panjangPutus || "0"} Meter`, 70, currentY + 37);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text("Jenis Kabel:", 115, currentY + 16);
    doc.text("Kapasitas Core:", 115, currentY + 23);
    doc.text("Koordinat Estimasi:", 115, currentY + 30);
    doc.text("Petugas Rekon:", 115, currentY + 37);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(jenisKabel || "Kabel Udara / Tanom", 155, currentY + 16);
    doc.text(`${coreKabel || "12 / 24"} Core`, 155, currentY + 23);
    doc.text(koordinatEstimasi || "106.827, -6.175", 155, currentY + 30);
    doc.text(petugas || "Teknisi M-FOSIS", 155, currentY + 37);

    currentY += 56;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(220, 38, 38);
    doc.text("HASIL ANALISA DIAGNOSA M-FOSIS AI (GEMINI ENGINE)", 15, currentY);

    currentY += 4;
    doc.setFillColor(254, 242, 242);
    const analisaText = analisaAi || "Berdasarkan kalkulasi GIS M-FOSIS dan jarak ukur OTDR, titik putus diperkirakan berada pada bentangan kabel utama dekat dengan patok/tiang tertentu. Direkomendasikan melakukan verifikasi fisik secara visual di lokasi estimasi.";
    
    const splitAnalisa = doc.splitTextToSize(analisaText, 172);
    const boxHeight = Math.max(25, splitAnalisa.length * 4.5 + 8);

    doc.roundedRect(15, currentY, 180, boxHeight, 2, 2, "F");
    doc.setDrawColor(252, 165, 165);
    doc.roundedRect(15, currentY, 180, boxHeight, 2, 2, "S");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(153, 27, 27);
    doc.text(splitAnalisa, 19, currentY + 6);

    currentY += boxHeight + 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("FOTO BUKTI LAPANGAN & REKONSILIASI", 15, currentY);

    currentY += 5;

    let photoAdded = false;
    if (fotoBukti && Array.isArray(fotoBukti) && fotoBukti.length > 0) {
      for (let i = 0; i < Math.min(fotoBukti.length, 2); i++) {
        const photo = fotoBukti[i];
        if (photo && photo.dataUrl) {
          try {
            const xPos = i === 0 ? 15 : 110;
            doc.addImage(photo.dataUrl, "JPEG", xPos, currentY, 85, 45);
            doc.setDrawColor(203, 213, 225);
            doc.rect(xPos, currentY, 85, 45, "S");
            
            doc.setFontSize(7.5);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100, 116, 139);
            doc.text(`Lampiran Foto ${i + 1}: ${photo.name || "Kondisi Fisik Lapangan"}`, xPos, currentY + 49);
            photoAdded = true;
          } catch (e) {
            console.warn(`[PDF Generator] Gagal menyematkan foto ${i + 1}:`, e);
          }
        }
      }
    }

    if (!photoAdded) {
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(15, currentY, 180, 20, 2, 2, "F");
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text("Foto bukti fisik belum diunggah atau berada dalam sistem penyimpanan berkas internal Google Drive.", 20, currentY + 12);
      currentY += 25;
    } else {
      currentY += 55;
    }

    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    } else {
      currentY += 10;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);

    doc.text("Mengetahui & Menyetujui,", 30, currentY);
    doc.text("Petugas Lapangan / Teknisi,", 135, currentY);

    doc.text("Officer / Leader Area Telkom", 30, currentY + 25);
    doc.text(petugas || "Teknisi M-FOSIS", 135, currentY + 25);

    doc.setDrawColor(148, 163, 184);
    doc.line(30, currentY + 22, 85, currentY + 22);
    doc.line(135, currentY + 22, 190, currentY + 22);

    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text("Dokumen ini diterbitkan secara otomatis oleh Sistem Enterprise GIS M-FOSIS Telkom Indonesia.", 105, 285, { align: "center" });

    const pdfArrayBuffer = doc.output("arraybuffer");
    const pdfBuffer = Buffer.from(pdfArrayBuffer);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="BA_REKON_MFOSIS_${(noTiket || "DOK").replace(/[^a-zA-Z0-9]/g, "_")}.pdf"`);
    return res.send(pdfBuffer);

  } catch (error: any) {
    console.error("[PDF Generator API Error]:", error);
    return res.status(500).json({ error: error.message || "Gagal membuat dokumen laporan BA Rekon. Silakan hubungi pengelola sistem." });
  }
});

export default app;
