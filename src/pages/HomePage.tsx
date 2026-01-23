import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
// Lazy load DitheringShader to reduce initial bundle blocking
const DitheringShader = lazy(() => import('@/components/ui/dithering-shader').then(m => ({ default: m.DitheringShader })));
import { CharacterCardModal } from '@/components/CharacterCardModal';
import { AutomationQueue } from '@/components/AutomationQueue';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { supabase } from '@/lib/supabase';
import { getCharacterCard } from '@/services/characterCardService';
import { fetchTwitterMetrics } from '@/services/twitterApi';
import { 
  sendMessage as sendChatMessage, 
  getOrCreateSession, 
  getSessionMessages,
  clearChatHistory,
  startNewSession,
  PersonalityMetadata
} from '@/services/chatService';
import type { ElizaOSCharacterCard, ProfileScores, LetterGrade } from '@/types/database';
import { getAgentSettings } from '@/services/agentService';
import { 
  Send, 
  Sparkles, 
  Settings, 
  Twitter,
  Users,
  Heart,
  TrendingUp,
  FileText,
  Zap,
  Bot,
  LogOut,
  Award,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { AutomationDropdown } from '@/components/AutomationDropdown';
import { GoogleCalendarWidget } from '@/components/GoogleCalendarWidget';
import { ConsoleLogs } from '@/components/ConsoleLogs';
import newFronteraLogo from '@assets/Asset 20small.png';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface UserProfile {
  twitter_username: string | null;
  twitter_access_token: string | null;
  twitter_user_id: string | null;
  profile_photo_url: string | null;
  character_card_generated: boolean;
}

interface TwitterMetricsState {
  followers_count: number;
  following_count: number;
  tweet_count: number;
}

// Grade color mapping
const gradeColors: Record<LetterGrade, string> = {
  'A+': 'text-emerald-400',
  'A': 'text-green-400',
  'B+': 'text-cyan-400',
  'B': 'text-blue-400',
  'C+': 'text-yellow-400',
  'C': 'text-orange-400',
  'D': 'text-red-400',
};

const gradeBgColors: Record<LetterGrade, string> = {
  'A+': 'from-emerald-500/20 to-emerald-600/20 border-emerald-500/50',
  'A': 'from-green-500/20 to-green-600/20 border-green-500/50',
  'B+': 'from-cyan-500/20 to-cyan-600/20 border-cyan-500/50',
  'B': 'from-blue-500/20 to-blue-600/20 border-blue-500/50',
  'C+': 'from-yellow-500/20 to-yellow-600/20 border-yellow-500/50',
  'C': 'from-orange-500/20 to-orange-600/20 border-orange-500/50',
  'D': 'from-red-500/20 to-red-600/20 border-red-500/50',
};

const FarcasterIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.24 1.2H5.76C3.26 1.2 1.2 3.26 1.2 5.76v12.48c0 2.5 2.06 4.56 4.56 4.56h12.48c2.5 0 4.56-2.06 4.56-4.56V5.76c0-2.5-2.06-4.56-4.56-4.56zm.72 15.84c0 .48-.38.86-.86.86H5.9c-.48 0-.86-.38-.86-.86V6.96c0-.48.38-.86.86-.86h12.2c.48 0 .86.38.86.86v10.08z"/>
  </svg>
);

const BaseIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
    <path d="M12 6v12M8 10l4-4 4 4M8 14l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none"/>
  </svg>
);

export function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showError, showWarning } = useNotifications();
  // Initial welcome message - will be updated when character card loads
  const getWelcomeMessage = useCallback((card?: ElizaOSCharacterCard | null): Message => ({
    id: 'welcome',
    role: 'assistant',
    content: card 
      ? `Hey! I'm ${card.name}, your AI Alter Ego. ${card.bio[0] || "Ready to chat whenever you are."} What's on your mind?`
      : "Hello! I'm ready to become your AI Alter Ego. Generate your clone first so I can learn your personality and start chatting in your unique voice!",
    timestamp: new Date(),
  }), []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasAlterEgo, setHasAlterEgo] = useState(false);
  const [characterCard, setCharacterCard] = useState<ElizaOSCharacterCard | null>(null);
  const [socialAutomation, setSocialAutomation] = useState({
    twitter: false,
    farcaster: false,
    baseapp: false,
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [twitterMetrics, setTwitterMetrics] = useState<TwitterMetricsState | null>(null);
  const [profileScores, setProfileScores] = useState<ProfileScores | null>(null);
  const [personalityMetadata, setPersonalityMetadata] = useState<PersonalityMetadata | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [agentModeEnabled, setAgentModeEnabled] = useState(false);
  const [isConsoleLogsOpen, setIsConsoleLogsOpen] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Fetch user profile and character card status
  useEffect(() => {
    async function fetchUserData() {
      if (!user?.id) {
        setIsLoadingProfile(false);
        return;
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:131',message:'fetchUserData entry',data:{userId:user.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D,E'})}).catch(()=>{});
      // #endregion

      try {
        // Fetch profile AND character card in PARALLEL using Promise.allSettled
        const [profileResult, cardResult] = await Promise.allSettled([
          supabase
            .from('profiles')
            .select('twitter_username, twitter_access_token, twitter_user_id, profile_photo_url, character_card_generated')
            .eq('id', user.id)
            .maybeSingle(),
          getCharacterCard(user.id)
        ]);

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:145',message:'cardResult status',data:{cardResultStatus:cardResult.status,cardResultValue:cardResult.status==='fulfilled'?!!cardResult.value:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion

        // Process profile result
        let loadedProfile: UserProfile | null = null;
        if (profileResult.status === 'fulfilled') {
          const { data: profile, error } = profileResult.value;
          
          if (error) {
            console.error('Error fetching profile:', error);
          }
          
          if (profile) {
            const typedProfile = profile as unknown as UserProfile;
            loadedProfile = typedProfile;
            setUserProfile(typedProfile);
            setHasAlterEgo(typedProfile.character_card_generated || false);
          } else {
            console.log('No profile found for user, may need to complete Twitter login');
          }
        } else {
          console.error('Profile fetch failed:', profileResult.reason);
        }

        // Process character card result (if successful and card exists)
        if (cardResult.status === 'fulfilled' && cardResult.value) {
          const card = cardResult.value;
          setCharacterCard(card.card_data);
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:180',message:'metadata before extraction',data:{hasMetadata:!!card.generation_metadata,metadataType:typeof card.generation_metadata,metadataKeys:card.generation_metadata?Object.keys(card.generation_metadata):null,fullMetadata:JSON.stringify(card.generation_metadata)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,E'})}).catch(()=>{});
          // #endregion
          
          // Extract metrics and scores from generation_metadata
          const metadata = card.generation_metadata as any;
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:195',message:'metadata extraction checks',data:{hasTwitterMetrics:!!metadata?.twitter_metrics,hasProfileScores:!!metadata?.profile_scores,twitterMetricsValue:metadata?.twitter_metrics,profileScoresValue:metadata?.profile_scores},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D'})}).catch(()=>{});
          // #endregion
          
          // Set profile scores if available
          if (metadata?.profile_scores) {
            setProfileScores(metadata.profile_scores);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:204',message:'profileScores set',data:{profileScores:metadata.profile_scores},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
          }
          
          // Extract personality metadata for human-like chat responses
          if (metadata?.analysis_summary || metadata?.signaturePhrases) {
            const personalityData: PersonalityMetadata = {
              signaturePhrases: metadata.signaturePhrases || metadata.analysis_summary?.signature_phrases || [],
              emojiPatterns: metadata.emojiPatterns || metadata.analysis_summary?.emoji_patterns || [],
              humorStyle: metadata.humorStyle || metadata.analysis_summary?.humor_style || '',
              vocabularyLevel: metadata.vocabularyLevel || metadata.analysis_summary?.vocabulary_level || '',
            };
            setPersonalityMetadata(personalityData);
          }
          
          // Handle Twitter metrics: always try to fetch fresh if we have access token, fallback to cache
          if (loadedProfile?.twitter_access_token) {
            // Always fetch fresh metrics from Twitter API when we have access token
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:220',message:'fetching fresh twitter metrics',data:{hasAccessToken:!!loadedProfile.twitter_access_token,hasCachedMetrics:!!metadata?.twitter_metrics},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D'})}).catch(()=>{});
            // #endregion
            try {
              const freshMetrics = await fetchTwitterMetrics(loadedProfile.twitter_access_token);
              if (freshMetrics) {
                setTwitterMetrics(freshMetrics);
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:226',message:'twitterMetrics set from API',data:{twitterMetrics:freshMetrics},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                // #endregion
              } else {
                // Fallback to cached metrics if fresh fetch fails
                if (metadata?.twitter_metrics) {
                  setTwitterMetrics(metadata.twitter_metrics);
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:231',message:'twitterMetrics fallback to cache',data:{twitterMetrics:metadata.twitter_metrics},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                  // #endregion
                } else {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:234',message:'failed to fetch twitter metrics and no cache',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D'})}).catch(()=>{});
                  // #endregion
                }
              }
            } catch (error) {
              console.warn('Failed to fetch Twitter metrics:', error);
              // Fallback to cached metrics on error
              if (metadata?.twitter_metrics) {
                setTwitterMetrics(metadata.twitter_metrics);
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:241',message:'twitterMetrics fallback to cache on error',data:{twitterMetrics:metadata.twitter_metrics,error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D'})}).catch(()=>{});
                // #endregion
              } else {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:245',message:'error fetching twitter metrics and no cache',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D'})}).catch(()=>{});
                // #endregion
              }
            }
          } else if (metadata?.twitter_metrics) {
            // Use cached metrics if no access token available
            setTwitterMetrics(metadata.twitter_metrics);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:251',message:'twitterMetrics set from cache (no token)',data:{twitterMetrics:metadata.twitter_metrics},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
          }
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:184',message:'cardResult not fulfilled or no card',data:{cardResultStatus:cardResult.status,cardResultReason:cardResult.status==='rejected'?cardResult.reason:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
        }
      } catch (err) {
        console.error('Error in fetchUserData:', err);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:188',message:'fetchUserData error',data:{error:err instanceof Error?err.message:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D,E'})}).catch(()=>{});
        // #endregion
      } finally {
        setIsLoadingProfile(false);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:191',message:'fetchUserData exit',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D,E'})}).catch(()=>{});
        // #endregion
      }
    }

    fetchUserData();
  }, [user?.id]);

  // Refresh Twitter metrics when userProfile loads (in case it loads after initial fetch)
  useEffect(() => {
    async function refreshMetricsIfNeeded() {
      // Only refresh if we have access token but no metrics yet
      if (userProfile?.twitter_access_token && !twitterMetrics) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:288',message:'refreshing metrics from userProfile effect',data:{hasAccessToken:!!userProfile.twitter_access_token,hasMetrics:!!twitterMetrics},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D'})}).catch(()=>{});
        // #endregion
        try {
          const freshMetrics = await fetchTwitterMetrics(userProfile.twitter_access_token);
          if (freshMetrics) {
            setTwitterMetrics(freshMetrics);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'HomePage.tsx:293',message:'metrics refreshed from userProfile effect',data:{twitterMetrics:freshMetrics},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
          }
        } catch (error) {
          console.warn('Failed to refresh Twitter metrics from userProfile effect:', error);
        }
      }
    }
    refreshMetricsIfNeeded();
  }, [userProfile?.twitter_access_token, twitterMetrics]);

  // Automatically enable Twitter toggle if user has successfully logged in with Twitter
  useEffect(() => {
    if (userProfile?.twitter_access_token) {
      setSocialAutomation(prev => ({ ...prev, twitter: true }));
    } else {
      setSocialAutomation(prev => ({ ...prev, twitter: false }));
    }
  }, [userProfile?.twitter_access_token]);

  // Load agent mode status
  useEffect(() => {
    async function loadAgentSettings() {
      if (!user?.id) return;
      try {
        const settings = await getAgentSettings(user.id);
        setAgentModeEnabled(settings.enabled);
      } catch (error) {
        console.error('Failed to load agent settings:', error);
      }
    }
    loadAgentSettings();
  }, [user?.id]);

  // Initialize chat session when user has a character card
  useEffect(() => {
    async function initChatSession() {
      if (!user?.id || !hasAlterEgo || sessionId) return;
      
      setIsLoadingSession(true);
      try {
        const newSessionId = await getOrCreateSession(user.id);
        setSessionId(newSessionId);
        
        // Load existing messages from this session
        const existingMessages = await getSessionMessages(newSessionId, 20);
        if (existingMessages.length > 0) {
          setMessages(existingMessages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })));
        } else if (characterCard) {
          // If no existing messages but character card exists, show welcome message
          setMessages([getWelcomeMessage(characterCard)]);
        }
      } catch (err) {
        console.error('Failed to initialize chat session:', err);
      } finally {
        setIsLoadingSession(false);
      }
    }
    
    initChatSession();
  }, [user?.id, hasAlterEgo, sessionId]);

  // Scroll to top on initial page load
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Scroll chat container to bottom only after user has interacted (sent a message)
  // This prevents the page from scrolling down on initial load
  useEffect(() => {
    if (hasUserInteracted && chatContainerRef.current) {
      // Scroll only the chat container, not the whole page
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, hasUserInteracted]);

  // Track modal mode
  const [modalMode, setModalMode] = useState<'generate' | 'edit'>('generate');

  const handleGenerateClone = async () => {
    // Check if we have a Twitter access token
    if (!userProfile?.twitter_access_token) {
      // Try to fetch it directly if profile state is stale
      if (user?.id) {
        const { data } = await supabase
          .from('profiles')
          .select('twitter_access_token')
          .eq('id', user.id)
          .maybeSingle();
        
        if (data && (data as any).twitter_access_token) {
          // We have a token, open the modal in generate mode
          setModalMode('generate');
          setIsModalOpen(true);
          return;
        }
      }
      
      // User hasn't connected Twitter
      showError('Please connect your Twitter account first to generate your AI clone. Go to the Auth page and sign in with Twitter.', 7000);
      return;
    }
    setModalMode('generate');
    setIsModalOpen(true);
  };

  const handleEditClone = () => {
    if (!characterCard) {
      showError('No character card found. Please generate your AI clone first.');
      return;
    }
    setModalMode('edit');
    setIsModalOpen(true);
  };

  const handleCharacterCardSuccess = (
    card: ElizaOSCharacterCard, 
    twitterProfile?: { followers_count?: number; following_count?: number; tweet_count?: number },
    scores?: ProfileScores
  ) => {
    setCharacterCard(card);
    setHasAlterEgo(true);
    
    // Store metrics and scores
    if (twitterProfile) {
      setTwitterMetrics({
        followers_count: twitterProfile.followers_count || 0,
        following_count: twitterProfile.following_count || 0,
        tweet_count: twitterProfile.tweet_count || 0,
      });
    }
    if (scores) {
      setProfileScores(scores);
    }
    
    // Reset session to start fresh with new personality
    setSessionId(null);
    
    // Update the initial message to reflect the character's personality
    setMessages([getWelcomeMessage(card)]);
  };

  // Format number for display (e.g., 12400 -> "12.4K")
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim()) return;
    if (!user?.id) return;
    
    // Mark that user has interacted - enables chat auto-scroll
    setHasUserInteracted(true);
    
    // If no character card, show placeholder response
    if (!characterCard) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: inputValue,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);
      setInputValue('');
      setIsTyping(true);
      
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: "I'd love to chat with you! But first, you need to generate your AI clone so I can learn your personality. Click 'Generate AI Clone' to get started! 🚀",
          timestamp: new Date(),
        }]);
        setIsTyping(false);
      }, 1000);
      return;
    }

    // Ensure we have a session
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      try {
        currentSessionId = await getOrCreateSession(user.id);
        setSessionId(currentSessionId);
      } catch (err) {
        console.error('Failed to create session:', err);
        return;
      }
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = inputValue;
    setInputValue('');
    setIsTyping(true);

    try {
      // Send message to AI clone via Edge Function (with personality metadata for human-like responses)
      const response = await sendChatMessage(
        user.id,
        currentSessionId,
        messageText,
        characterCard,
        personalityMetadata || undefined
      );

      if (response.success) {
        setMessages(prev => [...prev, {
          id: response.message.id,
          role: 'assistant',
          content: response.message.content,
          timestamp: response.message.timestamp,
        }]);
      } else {
        // Show error response
        const errorMsg = response.error || "Sorry, I'm having trouble responding right now. Please try again.";
        showError(errorMsg);
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: errorMsg,
          timestamp: new Date(),
        }]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      const rawError = err instanceof Error ? err.message : "Unknown error";
      
      // Provide user-friendly error messages
      let errorMsg: string;
      if (rawError.includes('Rate limit') || rawError.includes('429') || rawError.includes('Too many')) {
        errorMsg = "I'm a bit overwhelmed right now! Give me a moment to catch my breath. 😅";
        showWarning('⏳ Rate limit reached. Please wait a moment before sending more messages.', 6000);
      } else if (rawError.includes('401') || rawError.includes('unauthorized')) {
        errorMsg = "Hmm, there's an authentication issue. Try refreshing the page.";
        showError('Authentication error. Please refresh and try again.', 5000);
      } else {
        errorMsg = "Oops! Something went wrong. Let me try that again in a moment.";
        showError(rawError, 5000);
      }
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMsg,
        timestamp: new Date(),
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [inputValue, user?.id, characterCard, sessionId, showError, showWarning]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Clear chat history (keeps session, clears messages)
  const handleClearChat = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      await clearChatHistory(sessionId);
      // Reset to welcome message
      if (characterCard) {
        setMessages([getWelcomeMessage(characterCard)]);
      } else {
        setMessages([]);
      }
      showWarning('Chat cleared! Fresh start. 🧹', 3000);
    } catch (err) {
      console.error('Failed to clear chat:', err);
      showError('Failed to clear chat');
    }
  }, [sessionId, characterCard, showWarning, showError]);

  // Start a completely new session
  const handleNewSession = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const newSessionId = await startNewSession(user.id);
      setSessionId(newSessionId);
      // Reset to welcome message
      if (characterCard) {
        setMessages([getWelcomeMessage(characterCard)]);
      } else {
        setMessages([]);
      }
      setHasUserInteracted(false);
      showWarning('New session started! Fresh memory. 🧠', 3000);
    } catch (err) {
      console.error('Failed to start new session:', err);
      showError('Failed to start new session');
    }
  }, [user?.id, characterCard, showWarning, showError]);

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      {/* Background Shader - Full screen fixed, lazy loaded for faster initial render */}
      <Suspense fallback={<div className="fixed inset-0 bg-[#001122]" style={{ zIndex: 0 }} />}>
        <DitheringShader 
          shape="wave"
          type="8x8"
          colorBack="#001122"
          colorFront="#ff0088"
          pxSize={3}
          speed={0.6}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 0,
          }}
        />
      </Suspense>
      {/* #endregion */}
      
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-3 sm:px-4 lg:px-6 py-2.5 sm:py-3 border-b border-white/5 bg-black/40 backdrop-blur-md">
        <img src="/sona-weblogo.svg" alt="SONA Logo" className="h-7 sm:h-8 lg:h-10 w-auto" />
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsConsoleLogsOpen(true)}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            title="Console Logs & Settings"
          >
            <Settings className="w-4 h-4 text-white/70" />
          </button>
          <button 
            onClick={async () => {
              await logout();
              navigate('/auth');
            }}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-red-500/20 hover:border-red-500/50 transition-colors group"
            title="Logout"
          >
            <LogOut className="w-4 h-4 text-white/70 group-hover:text-red-400" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 p-3 sm:p-4 lg:p-6 pb-32 sm:pb-36 lg:pb-40">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-3 sm:gap-4 lg:gap-8 lg:items-start">
          
          {/* Left Panel - Profile & Controls */}
          <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 space-y-3 sm:space-y-4 lg:space-y-5 order-first">
            
              {/* Profile Card */}
              <div className={`bg-black/60 backdrop-blur-xl rounded-2xl border border-cyan-400/30 p-3 sm:p-4 relative overflow-hidden ${!hasAlterEgo ? 'feature-disabled' : ''}`}>
              {/* HUD corners */}
              <div className="absolute top-0 left-0 w-6 h-6 border-l-2 border-t-2 border-cyan-400" />
              <div className="absolute top-0 right-0 w-6 h-6 border-r-2 border-t-2 border-cyan-400" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-l-2 border-b-2 border-pink-500" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-r-2 border-b-2 border-pink-500" />
              
              {/* Final Rating Badge - Upper Left */}
              {profileScores && (
                <div className={`absolute top-2 left-2 px-2 py-1 rounded-lg bg-gradient-to-r ${gradeBgColors[profileScores.finalRating]} border backdrop-blur-sm`}>
                  <div className="flex items-center gap-1">
                    <Award className={`w-3 h-3 ${gradeColors[profileScores.finalRating]}`} />
                    <span className={`font-bold text-sm ${gradeColors[profileScores.finalRating]}`}>
                      {profileScores.finalRating}
                    </span>
                  </div>
                </div>
              )}
              
              {/* Profile Image */}
              <div className="relative mx-auto w-28 h-28 sm:w-32 sm:h-32">
                <motion.div 
                  className="absolute inset-0 rounded-full"
                  style={{ background: 'conic-gradient(from 0deg, transparent, rgba(0, 255, 255, 0.5), transparent, rgba(255, 0, 136, 0.5), transparent)' }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                />
                <div className="absolute inset-1 rounded-full bg-black/80" />
                <div className="absolute inset-2 rounded-full overflow-hidden border-2 border-white/20">
                  <img 
                    src={userProfile?.profile_photo_url || "/sonora-profile.png"} 
                    alt="AI Twin Profile" 
                    className="w-full h-full object-cover object-top" 
                  />
                </div>
                {/* Status Indicator */}
                <div className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-black ${
                  agentModeEnabled ? 'bg-green-400 animate-pulse' : hasAlterEgo ? 'bg-yellow-400' : 'bg-gray-500'
                }`} />
              </div>
              
              {/* User Info */}
              <div className="text-center mt-2.5 sm:mt-3">
                <h3 className="text-white font-bold text-sm sm:text-base truncate px-1">
                  {userProfile?.twitter_username ? `@${userProfile.twitter_username}` : '@YourUsername'}
                </h3>
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  {agentModeEnabled ? (
                    <>
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                      <p className="text-green-400 text-[10px] sm:text-xs font-medium">LIVE AGENT</p>
                    </>
                  ) : hasAlterEgo ? (
                    <p className="text-yellow-400/70 text-[10px] sm:text-xs">AGENT OFFLINE</p>
                  ) : (
                    <p className="text-white/50 text-[10px] sm:text-xs">Connect Twitter to start</p>
                  )}
                </div>
              </div>
              
              {/* Real Metrics - Followers & Following */}
              <div className="mt-2.5 sm:mt-3 grid grid-cols-3 gap-1 sm:gap-1.5 text-center">
                <div className="bg-white/5 rounded-lg p-2">
                  <Users className="w-3 h-3 mx-auto text-cyan-400 mb-0.5" />
                  <p className="text-white font-bold text-xs">
                    {twitterMetrics ? formatNumber(twitterMetrics.followers_count) : '--'}
                  </p>
                  <p className="text-white/40 text-[10px]">Followers</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <Heart className="w-3 h-3 mx-auto text-pink-500 mb-0.5" />
                  <p className={`font-bold text-xs ${profileScores ? gradeColors[profileScores.engagement] : 'text-white'}`}>
                    {profileScores ? profileScores.engagement : '--'}
                  </p>
                  <p className="text-white/40 text-[10px]">Engage</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <TrendingUp className="w-3 h-3 mx-auto text-purple-400 mb-0.5" />
                  <p className={`font-bold text-xs ${profileScores ? gradeColors[profileScores.reach] : 'text-white'}`}>
                    {profileScores ? profileScores.reach : '--'}
                  </p>
                  <p className="text-white/40 text-[10px]">Reach</p>
                </div>
              </div>
              
              <div className="mt-1.5 sm:mt-1.5 grid grid-cols-2 gap-1 sm:gap-1.5 text-center">
                <div className="bg-white/5 rounded-lg p-1.5 flex items-center justify-center gap-1">
                  <FileText className="w-3 h-3 text-green-400" />
                  <span className="text-white/70 text-[10px]">
                    {twitterMetrics ? formatNumber(twitterMetrics.tweet_count) : '--'} Tweets
                  </span>
                </div>
                <div className="bg-white/5 rounded-lg p-1.5 flex items-center justify-center gap-1">
                  <Users className="w-3 h-3 text-blue-400" />
                  <span className="text-white/70 text-[10px]">
                    {twitterMetrics ? formatNumber(twitterMetrics.following_count) : '--'} Following
                  </span>
                </div>
              </div>
            </div>

            {/* Welcome Message Card - Shown when no alter ego */}
            {!hasAlterEgo && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="bg-gradient-to-br from-cyan-500/20 via-pink-500/20 to-cyan-500/20 backdrop-blur-xl rounded-2xl border-2 border-cyan-400/50 p-4 sm:p-5 relative overflow-hidden welcome-message-highlight"
              >
                {/* Animated background glow */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-cyan-400/10 via-pink-400/10 to-cyan-400/10"
                  animate={{
                    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                  style={{
                    backgroundSize: '200% 200%',
                  }}
                />
                
                {/* Content */}
                <div className="relative z-10">
                  <div className="flex items-start gap-2.5 sm:gap-3 mb-2.5 sm:mb-3">
                    <div className="p-1.5 sm:p-2 rounded-lg bg-white/10 border border-white/20 flex-shrink-0">
                      <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-bold text-xs sm:text-sm mb-1">Welcome to SONA!</h3>
                      <p className="text-white/90 text-[11px] sm:text-xs leading-relaxed">
                        {messages.find(m => m.id === 'welcome')?.content || "Hello! I'm ready to become your AI Alter Ego. Generate your clone first so I can learn your personality and start chatting in your unique voice!"}
                      </p>
                    </div>
                  </div>
                  
                  {/* Arrow pointing to button */}
                  <div className="flex items-center justify-center mt-2 sm:mt-3">
                    <motion.div
                      animate={{ y: [0, 5, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="text-cyan-400"
                    >
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Generate/Edit AI Clone Button */}
            {hasAlterEgo ? (
              <button
                onClick={handleEditClone}
                disabled={isLoadingProfile}
                className="w-full bg-gradient-to-r from-cyan-600 to-blue-500 rounded-xl p-[2px] hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:hover:scale-100"
              >
                <div className="bg-black/80 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center justify-center gap-2">
                  <Settings className="w-4 h-4 text-white" />
                  <span className="text-white font-bold text-sm">CONFIGURE</span>
                </div>
              </button>
            ) : (
              <motion.button
                onClick={handleGenerateClone}
                disabled={isLoadingProfile}
                className="w-full rounded-xl hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:hover:scale-100 gold-glow-button relative overflow-hidden"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <div className="bg-gradient-to-r from-pink-600 to-cyan-500 rounded-[10px] px-4 py-3 flex items-center justify-center gap-2 relative z-10">
                  <Sparkles className="w-4 h-4 text-white" />
                  <span className="text-white font-bold text-sm">GENERATE AI CLONE</span>
                  <Zap className="w-3 h-3 text-yellow-400" />
                </div>
              </motion.button>
            )}
          </div>

          {/* Center Panel - Chat Interface */}
          <div className={`flex-1 min-w-0 order-2 lg:order-none ${!hasAlterEgo ? 'feature-disabled' : ''}`}>
            <div className="flex flex-col h-[450px] sm:h-[500px] lg:h-[600px] bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
              {/* Chat Header */}
              <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b border-white/10 bg-black/30">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Bot className="w-5 h-5 text-cyan-400" />
                    <div className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                      isTyping ? 'bg-yellow-400 animate-pulse' : 
                      hasAlterEgo ? 'bg-green-400' : 'bg-gray-400'
                    }`} />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                      {characterCard?.name || 'AI Alter Ego'}
                    </h3>
                    <p className="text-white/40 text-[10px] sm:text-xs">
                      {isTyping ? 'Typing...' :
                       isLoadingSession ? 'Loading session...' :
                       hasAlterEgo ? 'Online • Ready to chat' : 'Generate your clone to start'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {sessionId && hasAlterEgo && (
                    <>
                      <button
                        onClick={handleClearChat}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                        title="Clear chat history"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-white/40 group-hover:text-pink-400 transition-colors" />
                      </button>
                      <button
                        onClick={handleNewSession}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                        title="Start new session"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-white/40 group-hover:text-cyan-400 transition-colors" />
                      </button>
                    </>
                  )}
                  {sessionId && (
                    <span className="text-[10px] text-white/20 font-mono hidden sm:inline">
                      {sessionId.slice(-6)}
                    </span>
                  )}
                </div>
              </div>
              
              {/* Messages Area */}
              <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 sm:space-y-3 message-scrollbar">
                <AnimatePresence>
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 ${
                        message.role === 'user' 
                          ? 'bg-gradient-to-r from-pink-600/80 to-pink-500/80 text-white' 
                          : 'bg-white/10 text-white/90 border border-white/5'
                      }`}>
                        <p className="text-xs sm:text-sm leading-relaxed break-words">{message.content}</p>
                        <p className="text-[9px] sm:text-[10px] mt-1 opacity-50">
                          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white/10 rounded-2xl px-4 py-2.5 border border-white/5">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              
              {/* Input Area */}
              <div className="p-2.5 sm:p-3 border-t border-white/10 bg-black/30">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={hasAlterEgo ? "Message your AI Alter Ego..." : "Generate your clone first..."}
                    disabled={!hasAlterEgo}
                    className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50 text-xs sm:text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim() || !hasAlterEgo}
                    className="p-2 sm:p-2.5 bg-gradient-to-r from-pink-600 to-cyan-500 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Automation Button - Below Chat Window */}
            {hasAlterEgo && characterCard && sessionId && (
              <div className="mt-4 lg:mt-5 mb-20 sm:mb-24 lg:mb-0">
                <AutomationDropdown
                  userId={user?.id || ''}
                  characterCard={characterCard}
                  conversationHistory={messages}
                  sessionId={sessionId}
                  connectedPlatforms={socialAutomation}
                  onAgentModeChange={setAgentModeEnabled}
                />
                
                {/* Automation Queue - Shows scheduled posts */}
                <AutomationQueue 
                  userId={user?.id || ''} 
                  isVisible={hasAlterEgo}
                  agentModeEnabled={agentModeEnabled}
                />
              </div>
            )}
          </div>

          {/* Right Panel - Social Media Automation */}
          <div className={`w-full lg:w-72 xl:w-80 flex-shrink-0 order-last lg:order-last ${!hasAlterEgo ? 'feature-disabled' : ''}`}>
            <div className="bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 p-3 sm:p-4">
              <h3 className="text-white font-bold mb-3 sm:mb-4 flex items-center gap-2 text-sm">
                <Zap className="w-4 h-4 text-yellow-400" />
                Social Media Automation
              </h3>
              
              <div className="space-y-2 sm:space-y-2.5">
                {/* Twitter */}
                <label className="flex items-center gap-3 p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors">
                  <input
                    type="checkbox"
                    checked={socialAutomation.twitter}
                    onChange={(e) => setSocialAutomation(prev => ({ ...prev, twitter: e.target.checked }))}
                    className="sr-only"
                  />
                  <div className={`w-9 h-5 rounded-full relative transition-colors ${socialAutomation.twitter ? 'bg-gradient-to-r from-pink-600 to-cyan-500' : 'bg-white/10'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${socialAutomation.twitter ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </div>
                  <Twitter className="w-4 h-4 text-[#1DA1F2]" />
                  <span className="text-white/80 text-sm flex-1">Twitter / X</span>
                  {socialAutomation.twitter && <span className="text-xs text-green-400">Active</span>}
                </label>
                
                {/* Farcaster */}
                <label className="flex items-center gap-3 p-3 bg-white/5 rounded-xl cursor-not-allowed opacity-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled
                    className="sr-only"
                  />
                  <div className="w-9 h-5 rounded-full relative transition-colors bg-white/10">
                    <div className="absolute top-0.5 w-4 h-4 bg-white/30 rounded-full shadow-lg transition-transform translate-x-0.5" />
                  </div>
                  <FarcasterIcon className="w-4 h-4 text-purple-400/50" />
                  <span className="text-white/60 text-sm flex-1">Farcaster</span>
                  <span className="text-xs text-white/40">Coming soon</span>
                </label>
                
                {/* BASEapp */}
                <label className="flex items-center gap-3 p-3 bg-white/5 rounded-xl cursor-not-allowed opacity-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled
                    className="sr-only"
                  />
                  <div className="w-9 h-5 rounded-full relative transition-colors bg-white/10">
                    <div className="absolute top-0.5 w-4 h-4 bg-white/30 rounded-full shadow-lg transition-transform translate-x-0.5" />
                  </div>
                  <BaseIcon className="w-4 h-4 text-blue-500/50" />
                  <span className="text-white/60 text-sm flex-1">BASEapp</span>
                  <span className="text-xs text-white/40">Coming soon</span>
                </label>
              </div>
              
              {/* Status */}
              <div className="mt-3 sm:mt-4 p-2.5 sm:p-3 bg-white/5 rounded-xl">
                <p className="text-white/40 text-xs">
                  {Object.values(socialAutomation).filter(Boolean).length} platform(s) connected
                </p>
                <div className="mt-2 flex gap-1">
                  <div className={`w-2 h-2 rounded-full ${socialAutomation.twitter ? 'bg-green-400' : 'bg-white/20'}`} />
                  <div className={`w-2 h-2 rounded-full ${socialAutomation.farcaster ? 'bg-green-400' : 'bg-white/20'}`} />
                  <div className={`w-2 h-2 rounded-full ${socialAutomation.baseapp ? 'bg-green-400' : 'bg-white/20'}`} />
                </div>
              </div>
            </div>
            
            {/* Google Calendar Widget */}
            <div className={`mt-3 sm:mt-4 ${!hasAlterEgo ? 'feature-disabled' : ''}`}>
              <GoogleCalendarWidget isConnected={false} />
            </div>
          </div>
        </div>
      </main>

      {/* Footer - Fixed at bottom */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-white/5 bg-black/60 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 md:gap-4">
          <p className="text-white/40 text-[10px] sm:text-xs">coming soon on</p>
          <img src={newFronteraLogo} alt="New Frontera Corp Logo" className="h-5 sm:h-6 md:h-8 w-auto" />
          <p className="text-white/30 text-[9px] sm:text-[10px] md:text-xs">
            New Prontera Corp. 2025™ All Rights Reserved
          </p>
        </div>
      </footer>

      {/* Character Card Generation/Edit Modal */}
      {user && (
        <CharacterCardModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          userId={user.id}
          twitterAccessToken={userProfile?.twitter_access_token || undefined}
          mode={modalMode}
          existingCard={characterCard || undefined}
          existingScores={profileScores || undefined}
          existingMetrics={twitterMetrics || undefined}
          onSuccess={handleCharacterCardSuccess}
        />
      )}

      {/* Console Logs Modal */}
      {user && (
        <ConsoleLogs
          isOpen={isConsoleLogsOpen}
          onClose={() => setIsConsoleLogsOpen(false)}
          userId={user.id}
          twitterAccessToken={userProfile?.twitter_access_token || null}
        />
      )}
    </div>
  );
}
