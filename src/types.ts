export interface TitikSambung {
  id: number;
  name: string;
  lat: string;
  long: string;
  distance?: number;
  isOdc?: boolean;
}

export interface EventData {
  no: number;
  type: string;
  distance: number;
  loss: string;
  reflection: string;
  note: string;
}

export interface Recommendation {
  finding: string;
  impact: string;
  action: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export interface GamasRecord {
  id: string;
  segment: 'DISTRIBUSI' | 'FEEDER' | 'ODP' | 'TIANG' | 'Lainya';
  alproName: string;
  sto: string;
  jenisGamas: string;
  titikPerbaikan: {
    lat: string;
    long: string;
  }[];
  kmlData?: string; // GeoJSON string
  status: 'Open' | 'On Progress' | 'Closed' | 'Temporer';
  namaLop?: string;
  tanggalPekerjaan?: string;
  createdAt: any; // Timestamp
  updatedAt: any; // Timestamp
  authorUid: string;
}
