import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

interface CachedEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CachedEntry<unknown>>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 5500): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const FALLBACK_APOD = {
  title: 'Earthrise Over the Lunar Horizon',
  date: '2026-11-15',explanation:
    'Captured from lunar orbit, Earth rises above the heavily cratered lunar terrain. Missions in the Artemis program study lunar geology, radiation shielding, and closed-loop life support to sustain long-duration human presence on the Moon.',
  url: '',
  mediaType: 'image',
  copyright: 'NASA / Artemis Archive',
  isLive: false,
};

const FALLBACK_FLARES = [
  {
    flrID: 'NASA-DONKI-BASELINE-01',
    beginTime: '2026-11-12T14:20Z',
    peakTime: '2026-11-12T14:48Z',
    classType: 'M2.4',
    sourceLocation: 'N18W34',
    activeRegionNum: 13892,
    note: 'Moderate M-class solar flare monitored by NOAA/NASA DONKI Space Weather Database. Elevated proton flux requires lunar EVA crew radiation shelter readiness.',
  },
  {
    flrID: 'NASA-DONKI-BASELINE-02',
    beginTime: '2026-11-08T06:10Z',
    peakTime: '2026-11-08T06:29Z',
    classType: 'C8.1',
    sourceLocation: 'S12E15',
    activeRegionNum: 13887,note: 'Routine C-class solar flare; nominal solar array irradiance at 1,361 W/m².',
  },
];

const FALLBACK_NEOS = [
  {
    id: '2026-AQ1',
    name: '(2026 AQ1)',
    estimatedDiameterKmMax: 0.14,
    relativeVelocityKph: 41820,
    missDistanceKm: 4820100,
    isPotentiallyHazardous: false,
  },
  {
    id: '2026-LM4',
    name: '(2026 LM4)',
    estimatedDiameterKmMax: 0.31,
    relativeVelocityKph: 56110,
    missDistanceKm: 7190400,
    isPotentiallyHazardous: false,
  },
];

const FALLBACK_MEDIA = [
  {
    nasaId: 'as17-134-20384',
    title: 'Apollo 17 Harrison Schmitt Sampling Lunar Boulder',
    description:
      'Astronaut Harrison H. Schmitt uses a lunar scoop and rake to collect regolith and rock samples near Taurus-Littrow during Apollo 17.',
    dateCreated: '1972-12-13',
    center: 'JSC',
    imageUrl: 'https://images-assets.nasa.gov/image/as17-134-20384/as17-134-20384~medium.jpg',
  },
  {
    nasaId: 'as12-47-6913',
    title: 'Apollo 12 Lunar Module Intrepid Surface Inspection',
    description:
      'Astronaut inspecting the Apollo 12 Lunar Module landing gear and gold Kapton thermal foil on the Ocean of Storms.',
    dateCreated: '1969-11-19',
    center: 'JSC',
    imageUrl: 'https://images-assets.nasa.gov/image/as12-47-6913/as12-47-6913~medium.jpg',
  },
  {
    nasaId: 'KSC-20221116-PH-FMX01_0001',
    title: 'Artemis I Space Launch System Liftoff',
    description:
      'NASA Space Launch System rocket lifting off from Launch Complex 39B on a trajectory toward lunar orbit.',
    dateCreated: '2022-11-16',
    center: 'KSC',
    imageUrl: 'https://images-assets.nasa.gov/image/KSC-20221116-PH-FMX01_0001/KSC-20221116-PH-FMX01_0001~medium.jpg',
  },
  {
    nasaId: 'iss069e024801',
    title: 'ISS Environmental Control and Life Support Water Recovery',
    description:
      'Astronaut servicing the Water Recovery System (WRS) aboard the International Space Station, achieving 98% closed-loop water recycling.',
    dateCreated: '2023-06-21',
    center: 'JSC',
    imageUrl: 'https://images-assets.nasa.gov/image/iss069e024801/iss069e024801~medium.jpg',
  },
];

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'astroquest-nasa-relay' });
  });

  app.get('/api/nasa/overview', async (_req, res) => {
    const cached =getCached<any>('nasa_overview');
    if (cached) {
      return res.json(cached);
    }

    const today = new Date();
    const endDate = today.toISOString().slice(0, 10);
    const startDateObj = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = startDateObj.toISOString().slice(0, 10);

    const [apodRes, flrRes, neoRes, mediaRes] = await Promise.allSettled([
      fetchJsonWithTimeout(`https://api.nasa.gov/planetary/apod?api_key=${NASA_API_KEY}`),
      fetchJsonWithTimeout(
        `https://api.nasa.gov/DONKI/FLR?startDate=${startDate}&endDate=${endDate}&api_key=${NASA_API_KEY}`,
      ),
      fetchJsonWithTimeout(
        `https://api.nasa.gov/neo/rest/v1/feed?start_date=${endDate}&end_date=${endDate}&api_key=${NASA_API_KEY}`,
      ),
      fetchJsonWithTimeout(`https://images-api.nasa.gov/search?q=artemis+lunar+astronaut&media_type=image&page_size=6`,
      ),
    ]);

    const apod =
      apodRes.status === 'fulfilled' && apodRes.value?.title
        ? {
            title: String(apodRes.value.title),
            date: String(apodRes.value.date || endDate),
            explanation: String(apodRes.value.explanation || '').slice(0, 420),
            url: String(apodRes.value.url || ''),
            mediaType: String(apodRes.value.media_type || 'image'),
            copyright: String(apodRes.value.copyright || 'NASA'),
            isLive: true,
          }
        : FALLBACK_APOD;

    let solarFlares = FALLBACK_FLARES;
    let flareIsLive = false;
    if (flrRes.status === 'fulfilled' && Array.isArray(flrRes.value) && flrRes.value.length > 0) {
      flareIsLive = true;
      solarFlares = flrRes.value
        .slice(-4)
        .reverse().map((f: any) => ({
          flrID: String(f.flrID || 'DONKI-FLR'),
          beginTime: String(f.beginTime || endDate),
          peakTime: String(f.peakTime || f.beginTime || endDate),
          classType: String(f.classType || 'C1.0'),
          sourceLocation: String(f.sourceLocation || 'Solar Disk'),
          activeRegionNum: Number(f.activeRegionNum || 0),
          note: String(f.note || 'Detected by NASA Space Weather Database Of Notifications, Knowledge, Information (DONKI).'),
        }));
    }

    let nearEarthObjects = FALLBACK_NEOS;
    let neoIsLive = false;
    if (neoRes.status === 'fulfilled' && neoRes.value?.near_earth_objects?.[endDate]) {
      neoIsLive = true;
      const list = neoRes.value.near_earth_objects[endDate] as any[];
      nearEarthObjects = list.slice(0, 4).map((obj: any) => ({
        id: String(obj.id),
        name: String(obj.name),
        estimatedDiameterKmMax: Number(obj.estimated_diameter?.kilometers?.estimated_diameter_max?.toFixed(3) || 0.1,
        ),
        relativeVelocityKph: Math.round(
          Number(obj.close_approach_data?.[0]?.relative_velocity?.kilometers_per_hour || 35000),
        ),
        missDistanceKm: Math.round(
          Number(obj.close_approach_data?.[0]?.miss_distance?.kilometers || 4000000),
        ),
        isPotentiallyHazardous: Boolean(obj.is_potentially_hazardous_asteroid),
      }));
    }

    let lunarGallery = FALLBACK_MEDIA;
    if (mediaRes.status === 'fulfilled' && Array.isArray(mediaRes.value?.collection?.items)) {
      const parsed = mediaRes.value.collection.items
        .filter((item: any) => item.links?.[0]?.href && item.data?.[0])
        .slice(0, 6)
        .map((item: any) => ({
          nasaId: String(item.data[0].nasa_id || ''),
          title: String(item.data[0].title || 'NASA Archive Image'),description: String(item.data[0].description || '').slice(0, 220),
          dateCreated: String(item.data[0].date_created || '').slice(0, 10),
          center: String(item.data[0].center || 'NASA'),
          imageUrl: String(item.links[0].href),
        }));
      if (parsed.length > 0) {
        lunarGallery = parsed;
      }
    }

    const latestFlare = solarFlares[0];
    const flareSeverity = latestFlare?.classType?.startsWith('X')
      ? 'HIGH'
      : latestFlare?.classType?.startsWith('M')
        ? 'ELEVATED'
        : 'NOMINAL';

    const payload = {
      fetchedAt: new Date().toISOString(),
      liveFeeds: {
        apod: apod.isLive,
        donki: flareIsLive,
        neows: neoIsLive,
      },
      apod,
      solarWeather: {
        status: flareSeverity,
        latestFlare,recentFlares: solarFlares,
        radiationBaselineMsvDay: flareSeverity === 'HIGH' ? 2.4 : flareSeverity === 'ELEVATED' ? 1.55 : 1.12,
      },
      nearEarthObjects,
      lunarGallery,
      scienceConstants: {
        earthMoonDistanceKm: 384400,
        lunarGravityMs2: 1.62,
        earthGravityMs2: 9.81,
        transLunarInjectionDeltaVMs: 3120,
        lunarOrbitVelocityKms: 1.68,
        solarConstantWm2: 1361,
        issWaterRecoveryRatePct: 98.0,
        cabinOxygenKpa: 21.2,
        cabinCo2MaxKpa: 0.4,
        lunarDayTempC: 120,
        lunarNightTempC: -130,
        southPoleCraterTempC: -23,
      },
    };

    setCached('nasa_overview', payload);
    res.json(payload);
  });

  app.get('/api/nasa/gallery', async (req, res) => {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : 'lunar moon apollo';
    const safeQuery = rawQuery.slice(0, 60) || 'lunar moon apollo';const cacheKey = `gallery_${safeQuery.toLowerCase()}`;
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    try {
      const data = await fetchJsonWithTimeout(
        `https://images-api.nasa.gov/search?q=${encodeURIComponent(safeQuery)}&media_type=image&page_size=12`,
      );
      const items = (data?.collection?.items || [])
        .filter((item: any) => item.links?.[0]?.href && item.data?.[0])
        .slice(0, 9)
        .map((item: any) => ({
          nasaId: String(item.data[0].nasa_id || ''),
          title: String(item.data[0].title || 'NASA Image'),
          description: String(item.data[0].description || '').slice(0, 240),
          dateCreated: String(item.data[0].date_created || '').slice(0, 10),
          center: String(item.data[0].center || 'NASA'),
          imageUrl: String(item.links[0].href),
        }));
    const result = { query: safeQuery, items: items.length > 0 ? items : FALLBACK_MEDIA };
      setCached(cacheKey, result);
      res.json(result);
    } catch {
      res.json({ query: safeQuery, items: FALLBACK_MEDIA });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
  
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AstroQuest server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();