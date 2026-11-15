import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AuthPage } from './components/AuthPage';
import { LandingPage } from './components/LandingPage';
import { LaunchSequence3D } from './components/LaunchSequence3D';
import { LearnNasaHub } from './components/LearnNasaHub';
import { LunarBase3D } from './components/LunarBase3D';
import { Navbar } from './components/Navbar';
import { ProgressView } from './components/ProgressView';
import { MissionActivityModal } from './components/activities/MissionActivityModal';
import { MISSION_DEFINITIONS, MISSION_MAP, getRankForXp } from './data/missions';
import { auth } from './firebase';
import {
  fetchCadetProfile,
  logoutCadet,
  saveMissionCompletion,
  subscribeToCadetMissions,
  subscribeToCadetProfile,
  subscribeToLeaderboard,
  updateCadetFlightState,
} from './services/cadetService';
import { fetchNasaOverview } from './services/nasaService';
import {
  AppView,
  CadetProfile,
  LeaderboardEntry,
  MissionId,
  MissionProgressRecord,
  NasaOverviewData,
} from './types/game';

function createInitialMissionsMap(uid: string): Record<string, MissionProgressRecord> {
  const map: Record<string, MissionProgressRecord> = {};
  for (const def of MISSION_DEFINITIONS) {
    map[def.id] = {
      missionId: def.id,
      uid,
      title: def.title,
      status: 'available',
      bestScore: 0,
      attempts: 0,
      telemetryNote: 'Awaiting EVA inspection.',
    };
  }
  return map;
}

export default function App() {
  const [view, setView] = useState<AppView>('landing');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const [cadet, setCadet] = useState<CadetProfile | null>(null);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [missionsProgress, setMissionsProgress] = useState<Record<string, MissionProgressRecord>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const [activeMissionId, setActiveMissionId] = useState<MissionId | null>(null);
  const [nasaData, setNasaData] = useState<NasaOverviewData | null>(null);
  const [nasaLoading, setNasaLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchNasaOverview()
      .then((data) => {
        if (active) setNasaData(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setNasaLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const isGuestModeRef = useRef(isGuestMode);
  isGuestModeRef.current = isGuestMode;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setNeedsOnboarding(false);
        if