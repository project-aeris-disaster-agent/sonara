import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sparkles,
  Loader2,
  Check,
  Edit3,
  Save,
  Download,
  RefreshCw,
  User,
  MessageSquare,
  Hash,
  Zap,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  DollarSign,
  Lock,
  Plus,
  Trash2,
  Bot,
  Clock,
  Heart,
  Repeat2,
  AtSign,
} from 'lucide-react';
import type { ElizaOSCharacterCard, ProfileScores, AgentSettings, AgentFrequency } from '@/types/database';
import { getAgentSettings, updateAgentSettings, DEFAULT_AGENT_SETTINGS, getTargetAccountUsername } from '@/services/agentService';
import {
  generateCharacterCard,
  saveCharacterCard,
  exportCharacterCardAsJSON,
  getTwitterAccessToken,
} from '@/services/characterCardService';
import { BlobLoader } from '@/components/BlobLoader';

interface TwitterProfileData {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
}

interface CharacterCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  twitterAccessToken?: string;
  // Mode: 'generate' for new clones, 'edit' for existing clones
  mode?: 'generate' | 'edit';
  // Existing card data for edit mode
  existingCard?: ElizaOSCharacterCard;
  existingScores?: ProfileScores;
  existingMetrics?: { followers_count?: number; following_count?: number; tweet_count?: number };
  onSuccess?: (card: ElizaOSCharacterCard, twitterProfile?: TwitterProfileData, scores?: ProfileScores) => void;
}

type ModalState = 'generating' | 'preview' | 'editing' | 'saving' | 'saved' | 'error' | 'confirm_regenerate';

const REGENERATE_FEE = 3; // $3 USDC

// Suggested keywords for style traits
const SUGGESTED_STYLE_TRAITS = {
  all: ['Authentic', 'Witty', 'Thoughtful', 'Bold', 'Curious', 'Empathetic', 'Analytical', 'Creative', 'Direct', 'Playful', 'Professional', 'Casual'],
  chat: ['Friendly', 'Helpful', 'Conversational', 'Engaging', 'Supportive', 'Inquisitive', 'Warm', 'Patient', 'Enthusiastic', 'Respectful'],
  post: ['Concise', 'Informative', 'Provocative', 'Inspiring', 'Educational', 'Entertaining', 'Opinionated', 'Relatable', 'Shareable', 'Viral'],
};

// Suggested topics
const SUGGESTED_TOPICS = [
  'Technology', 'AI & ML', 'Web3', 'Crypto', 'DeFi', 'NFTs', 'Gaming', 'Startups', 
  'Programming', 'Design', 'Marketing', 'Finance', 'Health', 'Fitness', 'Travel',
  'Music', 'Art', 'Philosophy', 'Science', 'Politics', 'Sports', 'Food', 'Fashion',
];

// Suggested adjectives
const SUGGESTED_ADJECTIVES = [
  'Innovative', 'Passionate', 'Strategic', 'Insightful', 'Charismatic', 'Visionary',
  'Grounded', 'Ambitious', 'Humble', 'Fearless', 'Resilient', 'Authentic',
];

// Editable Tag Component
interface EditableTagProps {
  value: string;
  onRemove: () => void;
  color?: 'pink' | 'green' | 'purple' | 'cyan' | 'yellow';
  isEditing: boolean;
}

function EditableTag({ value, onRemove, color = 'pink', isEditing }: EditableTagProps) {
  const colorClasses = {
    pink: 'bg-gradient-to-r from-pink-600/20 to-pink-500/20 border-pink-500/30 text-pink-300',
    green: 'bg-green-500/20 border-green-500/30 text-green-300',
    purple: 'bg-purple-500/20 border-purple-500/30 text-purple-300',
    cyan: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300',
    yellow: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs ${colorClasses[color]}`}>
      {value}
      {isEditing && (
        <button
          onClick={onRemove}
          className="ml-0.5 p-0.5 rounded-full hover:bg-white/20 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

// Suggestion Bubble Component
interface SuggestionBubbleProps {
  value: string;
  onAdd: () => void;
  color?: 'pink' | 'green' | 'purple' | 'cyan' | 'yellow';
}

function SuggestionBubble({ value, onAdd, color = 'pink' }: SuggestionBubbleProps) {
  const colorClasses = {
    pink: 'border-pink-500/20 text-pink-400/60 hover:border-pink-500/50 hover:text-pink-300 hover:bg-pink-500/10',
    green: 'border-green-500/20 text-green-400/60 hover:border-green-500/50 hover:text-green-300 hover:bg-green-500/10',
    purple: 'border-purple-500/20 text-purple-400/60 hover:border-purple-500/50 hover:text-purple-300 hover:bg-purple-500/10',
    cyan: 'border-cyan-500/20 text-cyan-400/60 hover:border-cyan-500/50 hover:text-cyan-300 hover:bg-cyan-500/10',
    yellow: 'border-yellow-500/20 text-yellow-400/60 hover:border-yellow-500/50 hover:text-yellow-300 hover:bg-yellow-500/10',
  };

  return (
    <button
      onClick={onAdd}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed text-xs transition-all ${colorClasses[color]}`}
    >
      <Plus className="w-2.5 h-2.5" />
      {value}
    </button>
  );
}

const statusMessages = [
  { text: 'Connecting to Twitter API...', icon: '🐦', progress: 10 },
  { text: 'Fetching your recent tweets...', icon: '📝', progress: 25 },
  { text: 'Analyzing your writing style...', icon: '✍️', progress: 40 },
  { text: 'Deep personality analysis (Pass 1)...', icon: '🧠', progress: 55 },
  { text: 'Identifying unique voice patterns...', icon: '🎯', progress: 70 },
  { text: 'Generating authentic examples (Pass 2)...', icon: '🤖', progress: 85 },
  { text: 'Building your character card...', icon: '✨', progress: 95 },
];

export function CharacterCardModal({
  isOpen,
  onClose,
  userId,
  twitterAccessToken: propAccessToken,
  mode = 'generate',
  existingCard,
  existingScores,
  existingMetrics,
  onSuccess,
}: CharacterCardModalProps) {
  const [state, setState] = useState<ModalState>(mode === 'edit' ? 'editing' : 'generating');
  const [editedCard, setEditedCard] = useState<ElizaOSCharacterCard | null>(existingCard || null);
  const [error, setError] = useState<string | null>(null);
  const [statusIndex, setStatusIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [hue, setHue] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    bio: true,
    style: true,
    topics: false,
    examples: false,
    messageExamples: false,
    agent: false,
  });
  const [twitterProfile, setTwitterProfile] = useState<TwitterProfileData | null>(
    existingMetrics ? {
      id: '',
      username: '',
      name: '',
      followers_count: existingMetrics.followers_count,
      following_count: existingMetrics.following_count,
      tweet_count: existingMetrics.tweet_count,
    } : null
  );
  const [profileScores, setProfileScores] = useState<ProfileScores | null>(existingScores || null);
  const [analysisMetadata, setAnalysisMetadata] = useState<{
    tweets_analyzed: number;
    signaturePhrases?: string[];
    emojiPatterns?: string[];
    humorStyle?: string;
    vocabularyLevel?: string;
    analysis_summary?: {
      primary_topics: string[];
      core_traits: string[];
      vocabulary_level: string;
      humor_style: string;
    };
  } | null>(null);
  
  // Input states for adding new items
  const [newTopicInput, setNewTopicInput] = useState('');
  const [newAdjectiveInput, setNewAdjectiveInput] = useState('');
  const [newStyleInputs, setNewStyleInputs] = useState({ all: '', chat: '', post: '' });
  const [newPostExampleInput, setNewPostExampleInput] = useState('');
  const [newMessageExampleUserInput, setNewMessageExampleUserInput] = useState('');
  const [newMessageExampleAssistantInput, setNewMessageExampleAssistantInput] = useState('');
  
  // Agent settings state
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [newTargetAccountInput, setNewTargetAccountInput] = useState('');
  const [isLoadingAgentSettings, setIsLoadingAgentSettings] = useState(false);

  // Progress animation during generation
  useEffect(() => {
    if (state === 'generating') {
      // Initialize progress
      setProgress(statusMessages[0].progress);
      
      // Color cycling animation (same speed as blob - 1 second per cycle)
      // Use requestAnimationFrame for smooth color transitions
      let animationFrameId: number;
      let startTime = Date.now();
      
      const animateColors = () => {
        const elapsed = (Date.now() - startTime) / 1000; // Convert to seconds
        setHue((elapsed % 1.0)); // Cycle every 1 second, matching blob speed
        animationFrameId = requestAnimationFrame(animateColors);
      };
      
      animationFrameId = requestAnimationFrame(animateColors);
      
      const statusInterval = setInterval(() => {
        setStatusIndex((prev) => {
          const nextIndex = (prev + 1) % statusMessages.length;
          // Update progress to match the new status
          setProgress(statusMessages[nextIndex].progress);
          return nextIndex;
        });
      }, 2500);
      
      return () => {
        cancelAnimationFrame(animationFrameId);
        clearInterval(statusInterval);
      };
    } else {
      // Reset progress when not generating
      setProgress(0);
      setHue(0);
    }
  }, [state]);

  // Initialize based on mode when modal opens
  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && existingCard) {
        // Edit mode: load existing card directly
        setEditedCard(existingCard);
        setProfileScores(existingScores || null);
        setState('editing');
      } else if (mode === 'generate' && state === 'generating') {
        // Generate mode: start generation
        startGeneration();
      }
    }
  }, [isOpen, mode]);

  // Load agent settings when modal opens
  useEffect(() => {
    if (isOpen && userId) {
      setIsLoadingAgentSettings(true);
      getAgentSettings(userId)
        .then((settings) => {
          setAgentSettings(settings);
        })
        .catch((error) => {
          console.error('Failed to load agent settings:', error);
        })
        .finally(() => {
          setIsLoadingAgentSettings(false);
        });
    }
  }, [isOpen, userId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setState(mode === 'edit' ? 'editing' : 'generating');
        setEditedCard(existingCard || null);
        setError(null);
        setStatusIndex(0);
        if (!existingMetrics) {
          setTwitterProfile(null);
        }
        if (!existingScores) {
          setProfileScores(null);
        }
        setAnalysisMetadata(null);
        setNewTopicInput('');
        setNewAdjectiveInput('');
        setNewStyleInputs({ all: '', chat: '', post: '' });
        setNewPostExampleInput('');
        setNewMessageExampleUserInput('');
        setNewMessageExampleAssistantInput('');
        setNewTargetAccountInput('');
      }, 300);
    }
  }, [isOpen, mode, existingCard, existingScores, existingMetrics]);

  const startGeneration = async () => {
    setState('generating');
    setError(null);
    setStatusIndex(0);
    setProgress(statusMessages[0].progress);

    try {
      // Get access token from props or fetch from profile
      let accessToken = propAccessToken;
      if (!accessToken) {
        accessToken = await getTwitterAccessToken(userId) || undefined;
      }

      if (!accessToken) {
        throw new Error('Twitter not connected. Please connect your Twitter account first.');
      }

      const result = await generateCharacterCard(userId, accessToken);

      // Set progress to 100% before transitioning
      setProgress(100);
      
      // Small delay to show 100% completion
      await new Promise(resolve => setTimeout(resolve, 500));

      setEditedCard(result.character_card);
      setTwitterProfile(result.twitter_profile);
      setProfileScores(result.profile_scores);
      setAnalysisMetadata({
        tweets_analyzed: result.analysis_metadata.tweets_analyzed,
        signaturePhrases: result.analysis_metadata.signaturePhrases,
        emojiPatterns: result.analysis_metadata.emojiPatterns,
        humorStyle: result.analysis_metadata.humorStyle,
        vocabularyLevel: result.analysis_metadata.vocabularyLevel,
        analysis_summary: result.analysis_metadata.analysis_summary,
      });
      setState('preview');
    } catch (err: any) {
      console.error('Generation failed:', err);
      
      // Extract detailed error information
      let errorMessage = err.message || 'Failed to generate character card';
      let errorDetails = '';
      
      // Check if error response has detailed information
      if (err.error || (typeof err === 'object' && err.error)) {
        const errorData = err.error || err;
        errorMessage = errorData.error || errorMessage;
        
        if (errorData.error_code) {
          errorDetails += `Error Code: ${errorData.error_code}. `;
        }
        
        if (errorData.error_details) {
          if (typeof errorData.error_details === 'string') {
            errorDetails += errorData.error_details;
          } else if (errorData.error_details.errors && Array.isArray(errorData.error_details.errors)) {
            errorDetails += errorData.error_details.errors.map((e: any) => e.message || e.detail).join('; ');
          }
        }
        
        if (errorData.suggestion) {
          errorDetails += ` ${errorData.suggestion}`;
        }
      }
      
      // Check if it's a rate limit or auth error
      const isRateLimit = errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit');
      const isAuthError = errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.toLowerCase().includes('authentication') || errorMessage.toLowerCase().includes('token');
      
      if (isAuthError) {
        errorMessage = `Twitter Authentication Failed: ${errorMessage}`;
        errorDetails = 'Your Twitter access token may have expired. Please reconnect your Twitter account.';
      } else if (isRateLimit) {
        errorMessage = `Twitter API Rate Limited: ${errorMessage}`;
        errorDetails = 'Twitter API rate limit reached. You can proceed with Grok native analysis (no Twitter API required).';
      }
      
      setError(errorDetails || errorMessage);
      setState('error');
    }
  };

  // Show regenerate confirmation (payment required)
  const handleRegenerateClick = () => {
    setState('confirm_regenerate');
  };

  // Process payment and regenerate (x402 integration placeholder)
  const handleConfirmRegenerate = async () => {
    // TODO: Integrate x402 protocol for $3 USDC payment
    // For now, show alert and proceed with generation
    const confirmed = window.confirm(
      `Regenerating your AI clone costs $${REGENERATE_FEE} USDC.\n\n` +
      `This will:\n` +
      `• Fetch your latest tweets\n` +
      `• Run fresh AI personality analysis\n` +
      `• Generate a new character card\n\n` +
      `x402 payment integration coming soon.\n` +
      `Click OK to proceed (free during beta).`
    );
    
    if (confirmed) {
      await startGeneration();
    } else {
      // Return to editing state
      setState('editing');
    }
  };

  const handleSave = async () => {
    if (!editedCard) return;

    setState('saving');
    try {
      const generationMetadata = {
        twitter_username: twitterProfile?.username,
        twitter_metrics: twitterProfile ? {
          followers_count: twitterProfile.followers_count,
          following_count: twitterProfile.following_count,
          tweet_count: twitterProfile.tweet_count,
        } : null,
        profile_scores: profileScores,
        // Personality metadata for human-like chat responses
        signaturePhrases: analysisMetadata?.signaturePhrases,
        emojiPatterns: analysisMetadata?.emojiPatterns,
        humorStyle: analysisMetadata?.humorStyle,
        vocabularyLevel: analysisMetadata?.vocabularyLevel,
        analysis_summary: analysisMetadata?.analysis_summary,
        generated_at: new Date().toISOString(),
      };
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CharacterCardModal.tsx:428',message:'saving metadata',data:{generationMetadata:generationMetadata,hasTwitterMetrics:!!generationMetadata.twitter_metrics,hasProfileScores:!!generationMetadata.profile_scores},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,E'})}).catch(()=>{});
      // #endregion
      
      await saveCharacterCard(userId, editedCard, {
        generatedBy: 'grok_api',
        generationMetadata: generationMetadata,
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CharacterCardModal.tsx:439',message:'save completed',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,E'})}).catch(()=>{});
      // #endregion
      
      setState('saved');
      onSuccess?.(editedCard, twitterProfile || undefined, profileScores || undefined);
    } catch (err: any) {
      console.error('Save failed:', err);
      setError(err.message || 'Failed to save character card');
      setState('error');
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3ebd77-2545-412d-b06f-2f603dbfb7bf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CharacterCardModal.tsx:445',message:'save failed',data:{error:err.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,E'})}).catch(()=>{});
      // #endregion
    }
  };

  const handleExport = () => {
    if (editedCard) {
      exportCharacterCardAsJSON(editedCard);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const updateCardField = (field: string, value: any) => {
    if (!editedCard) return;
    setEditedCard({ ...editedCard, [field]: value });
  };

  // Helper functions for array manipulation
  const addToArray = (field: string, value: string) => {
    if (!editedCard || !value.trim()) return;
    const currentArray = (editedCard as any)[field] || [];
    if (!currentArray.includes(value.trim())) {
      updateCardField(field, [...currentArray, value.trim()]);
    }
  };

  const removeFromArray = (field: string, index: number) => {
    if (!editedCard) return;
    const currentArray = (editedCard as any)[field] || [];
    updateCardField(field, currentArray.filter((_: any, i: number) => i !== index));
  };

  const addStyleTrait = (category: 'all' | 'chat' | 'post', value: string) => {
    if (!editedCard || !value.trim()) return;
    const currentTraits = editedCard.style[category] || [];
    if (!currentTraits.includes(value.trim())) {
      updateCardField('style', {
        ...editedCard.style,
        [category]: [...currentTraits, value.trim()],
      });
    }
  };

  const removeStyleTrait = (category: 'all' | 'chat' | 'post', index: number) => {
    if (!editedCard) return;
    const currentTraits = editedCard.style[category] || [];
    updateCardField('style', {
      ...editedCard.style,
      [category]: currentTraits.filter((_, i) => i !== index),
    });
  };

  const addBioEntry = () => {
    if (!editedCard) return;
    updateCardField('bio', [...editedCard.bio, '']);
  };

  const removeBioEntry = (index: number) => {
    if (!editedCard || editedCard.bio.length <= 1) return;
    updateCardField('bio', editedCard.bio.filter((_, i) => i !== index));
  };

  const removePostExample = (index: number) => {
    if (!editedCard || editedCard.postExamples.length <= 1) return;
    updateCardField('postExamples', editedCard.postExamples.filter((_, i) => i !== index));
  };

  const addMessageExample = () => {
    if (!editedCard) return;
    const userText = newMessageExampleUserInput.trim();
    const assistantText = newMessageExampleAssistantInput.trim();
    if (!userText || !assistantText) return;
    const newExample = [
      { user: '{{user1}}', content: { text: userText } },
      { user: editedCard.name, content: { text: assistantText } },
    ];
    const currentExamples = editedCard.messageExamples || [];
    updateCardField('messageExamples', [...currentExamples, newExample]);
    setNewMessageExampleUserInput('');
    setNewMessageExampleAssistantInput('');
  };

  const removeMessageExample = (index: number) => {
    if (!editedCard) return;
    const currentExamples = editedCard.messageExamples || [];
    updateCardField('messageExamples', currentExamples.filter((_, i) => i !== index));
  };

  // Note: updateStyleField is available for future use when style editing is implemented
  const _updateStyleField = (category: 'all' | 'chat' | 'post', value: string[]) => {
    if (!editedCard) return;
    setEditedCard({
      ...editedCard,
      style: { ...editedCard.style, [category]: value },
    });
  };
  void _updateStyleField; // Suppress unused warning

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && state !== 'generating' && state !== 'saving' && onClose()}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-gradient-to-b from-gray-900 to-black rounded-2xl border border-cyan-500/30 shadow-2xl shadow-cyan-500/10"
        >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/80 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-r from-pink-600 to-cyan-500">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">AI Clone Generator</h2>
                <p className="text-xs text-white/50">
                  {state === 'generating' && 'Analyzing your Twitter presence...'}
                  {state === 'preview' && 'Preview your character card'}
                  {state === 'editing' && 'Edit your character card'}
                  {state === 'saving' && 'Saving...'}
                  {state === 'saved' && 'Character card saved!'}
                  {state === 'error' && 'Something went wrong'}
                </p>
              </div>
            </div>
            {state !== 'generating' && state !== 'saving' && (
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5 text-white/70" />
              </button>
            )}
          </div>

          {/* Content */}
          <div className="overflow-y-auto max-h-[calc(90vh-140px)] p-6 pb-24 sm:pb-6">
            {/* Generating State */}
            {state === 'generating' && (
              <div className="flex flex-col items-center justify-center py-16">
                {/* SONA Logo */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                  className="mb-8"
                >
                  <img 
                    src="/Main Sona Asset 113@10x.png" 
                    alt="SONA Logo" 
                    className="h-16 w-auto"
                  />
                </motion.div>
                
                <div className="relative w-64 h-64 mb-8">
                  <BlobLoader className="w-full h-full" />
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={statusIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-center mb-6"
                  >
                    <span className="text-3xl mb-2 block">{statusMessages[statusIndex].icon}</span>
                    <p className="text-white/70">{statusMessages[statusIndex].text}</p>
                  </motion.div>
                </AnimatePresence>

                {/* Progress Bar */}
                <div className="w-full max-w-md px-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/60 text-sm">Progress</span>
                    <span className="text-cyan-400 font-bold text-sm">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                      style={{
                        background: `linear-gradient(to right, 
                          hsl(${hue * 360}, 80%, 60%), 
                          hsl(${(hue * 360 + 60) % 360}, 90%, 65%), 
                          hsl(${(hue * 360 + 120) % 360}, 80%, 60%))`,
                        backgroundSize: '200% 100%',
                      }}
                    >
                      <motion.div
                        className="h-full w-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
                        animate={{
                          x: ['-100%', '100%'],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          ease: 'linear',
                        }}
                      />
                    </motion.div>
                  </div>
                </div>

                <div className="flex gap-1 mt-4">
                  {statusMessages.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        idx === statusIndex ? 'bg-cyan-400' : 'bg-white/20'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Error State */}
            {state === 'error' && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Generation Failed</h3>
                <p className="text-white/60 text-center max-w-md mb-6">{error}</p>
                
                {/* Check if it's a rate limit or Twitter API issue - offer Grok native fallback */}
                {error && (error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('twitter api')) && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6 max-w-md">
                    <p className="text-yellow-300 text-sm mb-3">
                      <strong>Option:</strong> You can proceed with Grok native analysis (no Twitter API required). 
                      This will use Grok's built-in Twitter access to analyze your account.
                    </p>
                    <button
                      onClick={async () => {
                        // Temporarily disable Twitter API mode and retry
                        setError(null);
                        setState('generating');
                        // The Edge Function will automatically fallback, but we can force Grok native
                        // by not providing access_token (but we need it for user_id lookup)
                        // Actually, the Edge Function should handle this automatically now
                        await startGeneration();
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/50 text-yellow-300 transition-colors"
                    >
                      <Zap className="w-4 h-4" />
                      Proceed with Grok Native Analysis
                    </button>
                  </div>
                )}
                
                <div className="flex gap-3">
                  <button
                    onClick={startGeneration}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Try Again
                  </button>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {/* Preview/Edit State */}
            {(state === 'preview' || state === 'editing') && editedCard && (
              <div className="space-y-4">
                {/* Profile Header */}
                {twitterProfile && (
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                    {twitterProfile.profile_image_url && (
                      <img
                        src={twitterProfile.profile_image_url}
                        alt={twitterProfile.name}
                        className="w-12 h-12 rounded-full border-2 border-cyan-400/50"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="text-white font-semibold">{twitterProfile.name}</h3>
                      <p className="text-white/50 text-sm">@{twitterProfile.username}</p>
                    </div>
                    {twitterProfile.followers_count && (
                      <div className="text-right">
                        <p className="text-white font-bold">{twitterProfile.followers_count.toLocaleString()}</p>
                        <p className="text-white/40 text-xs">followers</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Analysis Summary */}
                {analysisMetadata && (
                  <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <span className="text-white/80 text-sm font-medium">Analysis Summary</span>
                      <span className="text-white/40 text-xs">({analysisMetadata.tweets_analyzed} tweets analyzed)</span>
                    </div>
                    {analysisMetadata.analysis_summary && (
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-white/50 uppercase mb-1">Vocabulary</p>
                          <p className="text-cyan-300">{analysisMetadata.analysis_summary.vocabulary_level}</p>
                        </div>
                        <div>
                          <p className="text-white/50 uppercase mb-1">Humor Style</p>
                          <p className="text-pink-300">{analysisMetadata.analysis_summary.humor_style}</p>
                        </div>
                        {analysisMetadata.analysis_summary.core_traits.length > 0 && (
                          <div className="col-span-2">
                            <p className="text-white/50 uppercase mb-1">Core Traits</p>
                            <div className="flex flex-wrap gap-1">
                              {analysisMetadata.analysis_summary.core_traits.slice(0, 5).map((trait, idx) => (
                                <span key={idx} className="px-2 py-0.5 rounded bg-white/10 text-white/70">
                                  {trait}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Character Name */}
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-cyan-400" />
                    <label className="text-white/70 text-sm font-medium">Character Name</label>
                  </div>
                  {state === 'editing' ? (
                    <input
                      type="text"
                      value={editedCard.name}
                      onChange={(e) => updateCardField('name', e.target.value)}
                      className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400/50"
                    />
                  ) : (
                    <p className="text-white font-semibold">{editedCard.name}</p>
                  )}
                </div>

                {/* Bio Section */}
                <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  <button
                    onClick={() => toggleSection('bio')}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-pink-400" />
                      <span className="text-white font-medium">Bio & Personality</span>
                      <span className="text-white/40 text-xs">({editedCard.bio.length} entries)</span>
                    </div>
                    {expandedSections.bio ? (
                      <ChevronUp className="w-4 h-4 text-white/50" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/50" />
                    )}
                  </button>
                  {expandedSections.bio && (
                    <div className="px-4 pb-4 space-y-2">
                      {state === 'editing' ? (
                        <>
                          {editedCard.bio.map((bio, idx) => (
                            <div key={idx} className="relative group">
                              <textarea
                                value={bio}
                                onChange={(e) => {
                                  const newBio = [...editedCard.bio];
                                  newBio[idx] = e.target.value;
                                  updateCardField('bio', newBio);
                                }}
                                placeholder="Describe a personality trait or background..."
                                className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 pr-10 text-white/80 text-sm focus:outline-none focus:border-pink-400/50 resize-none"
                                rows={2}
                              />
                              {editedCard.bio.length > 1 && (
                                <button
                                  onClick={() => removeBioEntry(idx)}
                                  className="absolute top-2 right-2 p-1 rounded-lg bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/40 transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={addBioEntry}
                            className="w-full flex items-center justify-center gap-2 p-2 border border-dashed border-pink-500/30 rounded-lg text-pink-400/70 text-sm hover:bg-pink-500/10 hover:border-pink-500/50 transition-all"
                          >
                            <Plus className="w-4 h-4" />
                            Add Bio Entry
                          </button>
                        </>
                      ) : (
                        editedCard.bio.map((bio, idx) => (
                          <p key={idx} className="text-white/70 text-sm">
                            • {bio}
                          </p>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Style Section */}
                <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  <button
                    onClick={() => toggleSection('style')}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      <span className="text-white font-medium">Communication Style</span>
                    </div>
                    {expandedSections.style ? (
                      <ChevronUp className="w-4 h-4 text-white/50" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/50" />
                    )}
                  </button>
                  {expandedSections.style && (
                    <div className="px-4 pb-4 space-y-4">
                      {(['all', 'chat', 'post'] as const).map((category) => {
                        const categoryColors = { all: 'yellow', chat: 'cyan', post: 'purple' } as const;
                        const color = categoryColors[category];
                        const currentTraits = editedCard.style[category] || [];
                        const availableSuggestions = SUGGESTED_STYLE_TRAITS[category].filter(
                          trait => !currentTraits.includes(trait)
                        );

                        return (
                          <div key={category} className="space-y-2">
                            <p className="text-white/50 text-xs uppercase flex items-center gap-2">
                              {category === 'all' ? 'General' : category} style
                              <span className="text-white/30">({currentTraits.length})</span>
                            </p>
                            
                            {/* Current traits */}
                            <div className="flex flex-wrap gap-1.5">
                              {currentTraits.map((trait, idx) => (
                                <EditableTag
                                  key={idx}
                                  value={trait}
                                  onRemove={() => removeStyleTrait(category, idx)}
                                  color={color}
                                  isEditing={state === 'editing'}
                                />
                              ))}
                            </div>

                            {/* Add custom trait + Suggestions (only in edit mode) */}
                            {state === 'editing' && (
                              <>
                                {/* Custom input */}
                                <div className="flex gap-2 mt-2">
                                  <input
                                    type="text"
                                    value={newStyleInputs[category]}
                                    onChange={(e) => setNewStyleInputs(prev => ({ ...prev, [category]: e.target.value }))}
                                    onKeyPress={(e) => {
                                      if (e.key === 'Enter' && newStyleInputs[category].trim()) {
                                        addStyleTrait(category, newStyleInputs[category]);
                                        setNewStyleInputs(prev => ({ ...prev, [category]: '' }));
                                      }
                                    }}
                                    placeholder={`Add ${category} trait...`}
                                    className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-yellow-400/50 placeholder:text-white/30"
                                  />
                                  <button
                                    onClick={() => {
                                      if (newStyleInputs[category].trim()) {
                                        addStyleTrait(category, newStyleInputs[category]);
                                        setNewStyleInputs(prev => ({ ...prev, [category]: '' }));
                                      }
                                    }}
                                    disabled={!newStyleInputs[category].trim()}
                                    className={`px-2.5 py-1.5 rounded-lg bg-${color === 'yellow' ? 'yellow' : color}-500/20 text-${color === 'yellow' ? 'yellow' : color}-400 text-sm hover:bg-${color === 'yellow' ? 'yellow' : color}-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Suggestions */}
                                {availableSuggestions.length > 0 && (
                                  <div className="pt-2 border-t border-white/5">
                                    <p className="text-white/30 text-[10px] uppercase mb-1.5">Suggestions</p>
                                    <div className="flex flex-wrap gap-1">
                                      {availableSuggestions.slice(0, 6).map((suggestion) => (
                                        <SuggestionBubble
                                          key={suggestion}
                                          value={suggestion}
                                          onAdd={() => addStyleTrait(category, suggestion)}
                                          color={color}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Topics Section */}
                <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  <button
                    onClick={() => toggleSection('topics')}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Hash className="w-4 h-4 text-green-400" />
                      <span className="text-white font-medium">Topics & Interests</span>
                      <span className="text-white/40 text-xs">({editedCard.topics.length} topics)</span>
                    </div>
                    {expandedSections.topics ? (
                      <ChevronUp className="w-4 h-4 text-white/50" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/50" />
                    )}
                  </button>
                  {expandedSections.topics && (
                    <div className="px-4 pb-4 space-y-4">
                      {/* Topics */}
                      <div className="space-y-2">
                        <p className="text-white/50 text-xs uppercase">Topics</p>
                        <div className="flex flex-wrap gap-1.5">
                          {editedCard.topics.map((topic, idx) => (
                            <EditableTag
                              key={idx}
                              value={topic}
                              onRemove={() => removeFromArray('topics', idx)}
                              color="green"
                              isEditing={state === 'editing'}
                            />
                          ))}
                        </div>

                        {/* Add new topic input */}
                        {state === 'editing' && (
                          <>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={newTopicInput}
                                onChange={(e) => setNewTopicInput(e.target.value)}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    addToArray('topics', newTopicInput);
                                    setNewTopicInput('');
                                  }
                                }}
                                placeholder="Add a topic..."
                                className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-400/50 placeholder:text-white/30"
                              />
                              <button
                                onClick={() => {
                                  addToArray('topics', newTopicInput);
                                  setNewTopicInput('');
                                }}
                                disabled={!newTopicInput.trim()}
                                className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-sm hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Topic suggestions */}
                            {SUGGESTED_TOPICS.filter(t => !editedCard.topics.includes(t)).length > 0 && (
                              <div className="pt-2 border-t border-white/5">
                                <p className="text-white/30 text-[10px] uppercase mb-1.5">Suggestions</p>
                                <div className="flex flex-wrap gap-1">
                                  {SUGGESTED_TOPICS.filter(t => !editedCard.topics.includes(t)).slice(0, 8).map((suggestion) => (
                                    <SuggestionBubble
                                      key={suggestion}
                                      value={suggestion}
                                      onAdd={() => addToArray('topics', suggestion)}
                                      color="green"
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Adjectives */}
                      <div className="pt-3 border-t border-white/10 space-y-2">
                        <p className="text-white/50 text-xs uppercase">Adjectives</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(editedCard.adjectives || []).map((adj, idx) => (
                            <EditableTag
                              key={idx}
                              value={adj}
                              onRemove={() => removeFromArray('adjectives', idx)}
                              color="cyan"
                              isEditing={state === 'editing'}
                            />
                          ))}
                        </div>

                        {/* Add new adjective input */}
                        {state === 'editing' && (
                          <>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={newAdjectiveInput}
                                onChange={(e) => setNewAdjectiveInput(e.target.value)}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    addToArray('adjectives', newAdjectiveInput);
                                    setNewAdjectiveInput('');
                                  }
                                }}
                                placeholder="Add an adjective..."
                                className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-cyan-400/50 placeholder:text-white/30"
                              />
                              <button
                                onClick={() => {
                                  addToArray('adjectives', newAdjectiveInput);
                                  setNewAdjectiveInput('');
                                }}
                                disabled={!newAdjectiveInput.trim()}
                                className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 text-sm hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Adjective suggestions */}
                            {SUGGESTED_ADJECTIVES.filter(a => !(editedCard.adjectives || []).includes(a)).length > 0 && (
                              <div className="pt-2 border-t border-white/5">
                                <p className="text-white/30 text-[10px] uppercase mb-1.5">Suggestions</p>
                                <div className="flex flex-wrap gap-1">
                                  {SUGGESTED_ADJECTIVES.filter(a => !(editedCard.adjectives || []).includes(a)).slice(0, 6).map((suggestion) => (
                                    <SuggestionBubble
                                      key={suggestion}
                                      value={suggestion}
                                      onAdd={() => addToArray('adjectives', suggestion)}
                                      color="cyan"
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Post Examples Section */}
                <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  <button
                    onClick={() => toggleSection('examples')}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-4 h-4 text-purple-400" />
                      <span className="text-white font-medium">Post Examples</span>
                      <span className="text-white/40 text-xs">({editedCard.postExamples.length} examples)</span>
                    </div>
                    {expandedSections.examples ? (
                      <ChevronUp className="w-4 h-4 text-white/50" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/50" />
                    )}
                  </button>
                  {expandedSections.examples && (
                    <div className="px-4 pb-4 space-y-2">
                      <p className="text-white/40 text-xs mb-2">
                        These examples help your AI clone learn your posting style
                      </p>
                      
                      {/* Post examples list - read only with delete */}
                      {editedCard.postExamples.map((example, idx) => (
                        <div
                          key={idx}
                          className="relative group p-3 rounded-lg bg-white/5 border border-white/10"
                        >
                          <p className="text-white/70 text-sm pr-8">"{example}"</p>
                          {state === 'editing' && editedCard.postExamples.length > 1 && (
                            <button
                              onClick={() => removePostExample(idx)}
                              className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/40 transition-all"
                              title="Remove example"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      
                      {/* Add new post example (only in edit mode) */}
                      {state === 'editing' && (
                        <div className="pt-2 space-y-2">
                          <textarea
                            value={newPostExampleInput}
                            onChange={(e) => setNewPostExampleInput(e.target.value)}
                            placeholder="Write a new example post in your style..."
                            className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white/80 text-sm focus:outline-none focus:border-purple-400/50 resize-none placeholder:text-white/30"
                            rows={2}
                          />
                          <div className="flex items-center justify-between">
                            <span className="text-white/30 text-xs">
                              {newPostExampleInput.length}/280
                            </span>
                            <button
                              onClick={() => {
                                if (newPostExampleInput.trim()) {
                                  updateCardField('postExamples', [...editedCard.postExamples, newPostExampleInput.trim()]);
                                  setNewPostExampleInput('');
                                }
                              }}
                              disabled={!newPostExampleInput.trim()}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 text-sm hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                              Add Example
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Message Examples Section */}
                <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  <button
                    onClick={() => toggleSection('messageExamples')}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-blue-400" />
                      <span className="text-white font-medium">Message Examples</span>
                      <span className="text-white/40 text-xs">({(editedCard.messageExamples || []).length} examples)</span>
                    </div>
                    {expandedSections.messageExamples ? (
                      <ChevronUp className="w-4 h-4 text-white/50" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/50" />
                    )}
                  </button>
                  {expandedSections.messageExamples && (
                    <div className="px-4 pb-4 space-y-2">
                      <p className="text-white/40 text-xs mb-2">
                        These examples teach your AI clone how to reply in conversations
                      </p>

                      {/* Message examples list */}
                      {(editedCard.messageExamples || []).map((example, idx) => {
                        const userEntry = example.find(m => m.user === '{{user1}}') ?? example[0];
                        const assistantEntry = example.find(m => m.user !== '{{user1}}') ?? example[1];
                        return (
                          <div
                            key={idx}
                            className="relative group p-3 rounded-lg bg-white/5 border border-white/10 space-y-2"
                          >
                            <div>
                              <p className="text-white/40 text-[10px] uppercase mb-1">User</p>
                              <p className="text-white/70 text-sm">"{userEntry?.content?.text || ''}"</p>
                            </div>
                            <div>
                              <p className="text-white/40 text-[10px] uppercase mb-1">Assistant</p>
                              <p className="text-white/70 text-sm">"{assistantEntry?.content?.text || ''}"</p>
                            </div>
                            {state === 'editing' && (editedCard.messageExamples || []).length > 1 && (
                              <button
                                onClick={() => removeMessageExample(idx)}
                                className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/40 transition-all"
                                title="Remove example"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {/* Add new message example (only in edit mode) */}
                      {state === 'editing' && (
                        <div className="pt-2 space-y-2">
                          <textarea
                            value={newMessageExampleUserInput}
                            onChange={(e) => setNewMessageExampleUserInput(e.target.value)}
                            placeholder="User message example..."
                            className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white/80 text-sm focus:outline-none focus:border-blue-400/50 resize-none placeholder:text-white/30"
                            rows={2}
                          />
                          <textarea
                            value={newMessageExampleAssistantInput}
                            onChange={(e) => setNewMessageExampleAssistantInput(e.target.value)}
                            placeholder={`Your reply as ${editedCard.name}...`}
                            className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white/80 text-sm focus:outline-none focus:border-blue-400/50 resize-none placeholder:text-white/30"
                            rows={2}
                          />
                          <div className="flex items-center justify-between">
                            <span className="text-white/30 text-xs">
                              {(newMessageExampleUserInput.length + newMessageExampleAssistantInput.length)}/560
                            </span>
                            <button
                              onClick={addMessageExample}
                              disabled={!newMessageExampleUserInput.trim() || !newMessageExampleAssistantInput.trim()}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 text-sm hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                              Add Example
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Agent Settings Section */}
                <div className="rounded-xl bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 overflow-hidden">
                  <button
                    onClick={() => toggleSection('agent')}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-green-400" />
                      <span className="text-white font-medium">Agent Settings</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        agentSettings.enabled 
                          ? 'bg-green-500/30 text-green-300 animate-pulse' 
                          : 'bg-white/10 text-white/50'
                      }`}>
                        {agentSettings.enabled ? 'LIVE' : 'OFF'}
                      </span>
                    </div>
                    {expandedSections.agent ? (
                      <ChevronUp className="w-4 h-4 text-white/50" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/50" />
                    )}
                  </button>
                  {expandedSections.agent && (
                    <div className="px-4 pb-4 space-y-4">
                      {isLoadingAgentSettings ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
                        </div>
                      ) : (
                        <>
                          <p className="text-white/40 text-xs">
                            Configure automated engagement with target Twitter accounts
                          </p>

                          {/* Target Accounts */}
                          <div className="space-y-2">
                            <p className="text-white/50 text-xs uppercase flex items-center gap-2">
                              <AtSign className="w-3 h-3" />
                              Target Accounts
                              <span className="text-white/30">({agentSettings.targetAccounts.length})</span>
                            </p>
                            
                            {/* Current target accounts */}
                            {agentSettings.targetAccounts.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {agentSettings.targetAccounts.map((account, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs bg-green-500/20 border-green-500/30 text-green-300"
                                  >
                                    @{getTargetAccountUsername(account)}
                                    {state === 'editing' && (
                                      <button
                                        onClick={async () => {
                                          const newAccounts = agentSettings.targetAccounts.filter((_, i) => i !== idx);
                                          const updated = await updateAgentSettings(userId, { targetAccounts: newAccounts });
                                          setAgentSettings(updated);
                                        }}
                                        className="ml-0.5 p-0.5 rounded-full hover:bg-white/20 transition-colors"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                            
                            {/* Add target account input */}
                            {state === 'editing' && (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={newTargetAccountInput}
                                  onChange={(e) => setNewTargetAccountInput(e.target.value)}
                                  onKeyPress={async (e) => {
                                    if (e.key === 'Enter' && newTargetAccountInput.trim()) {
                                      const account = newTargetAccountInput.trim().replace(/^@/, '');
                                      if (!agentSettings.targetAccounts.includes(account)) {
                                        const updated = await updateAgentSettings(userId, {
                                          targetAccounts: [...agentSettings.targetAccounts, account],
                                        });
                                        setAgentSettings(updated);
                                      }
                                      setNewTargetAccountInput('');
                                    }
                                  }}
                                  placeholder="@username"
                                  className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-400/50 placeholder:text-white/30"
                                />
                                <button
                                  onClick={async () => {
                                    if (newTargetAccountInput.trim()) {
                                      const account = newTargetAccountInput.trim().replace(/^@/, '');
                                      if (!agentSettings.targetAccounts.includes(account)) {
                                        const updated = await updateAgentSettings(userId, {
                                          targetAccounts: [...agentSettings.targetAccounts, account],
                                        });
                                        setAgentSettings(updated);
                                      }
                                      setNewTargetAccountInput('');
                                    }
                                  }}
                                  disabled={!newTargetAccountInput.trim()}
                                  className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-sm hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Action Types */}
                          <div className="space-y-2">
                            <p className="text-white/50 text-xs uppercase">Actions</p>
                            <div className="grid grid-cols-1 gap-2">
                              {/* Auto Retweet */}
                              <label className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                                <input
                                  type="checkbox"
                                  checked={agentSettings.actions.retweet}
                                  onChange={async (e) => {
                                    if (state === 'editing') {
                                      const updated = await updateAgentSettings(userId, {
                                        actions: { ...agentSettings.actions, retweet: e.target.checked },
                                      });
                                      setAgentSettings(updated);
                                    }
                                  }}
                                  disabled={state !== 'editing'}
                                  className="w-4 h-4 rounded border-2 border-green-500/40 bg-transparent checked:bg-green-500 checked:border-green-500 focus:ring-1 focus:ring-green-500/30"
                                />
                                <Repeat2 className="w-4 h-4 text-green-400" />
                                <span className="text-white/80 text-sm">Auto Retweet</span>
                              </label>

                              {/* Auto Like */}
                              <label className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                                <input
                                  type="checkbox"
                                  checked={agentSettings.actions.like}
                                  onChange={async (e) => {
                                    if (state === 'editing') {
                                      const updated = await updateAgentSettings(userId, {
                                        actions: { ...agentSettings.actions, like: e.target.checked },
                                      });
                                      setAgentSettings(updated);
                                    }
                                  }}
                                  disabled={state !== 'editing'}
                                  className="w-4 h-4 rounded border-2 border-green-500/40 bg-transparent checked:bg-green-500 checked:border-green-500 focus:ring-1 focus:ring-green-500/30"
                                />
                                <Heart className="w-4 h-4 text-pink-400" />
                                <span className="text-white/80 text-sm">Auto Like</span>
                              </label>

                              {/* Auto @mention + Generated Tweet */}
                              <label className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                                <input
                                  type="checkbox"
                                  checked={agentSettings.actions.mention}
                                  onChange={async (e) => {
                                    if (state === 'editing') {
                                      const updated = await updateAgentSettings(userId, {
                                        actions: { ...agentSettings.actions, mention: e.target.checked },
                                      });
                                      setAgentSettings(updated);
                                    }
                                  }}
                                  disabled={state !== 'editing'}
                                  className="w-4 h-4 rounded border-2 border-green-500/40 bg-transparent checked:bg-green-500 checked:border-green-500 focus:ring-1 focus:ring-green-500/30"
                                />
                                <AtSign className="w-4 h-4 text-cyan-400" />
                                <span className="text-white/80 text-sm">Auto @mention + Generated Reply</span>
                              </label>
                            </div>
                          </div>

                          {/* Frequency */}
                          <div className="space-y-2">
                            <p className="text-white/50 text-xs uppercase flex items-center gap-2">
                              <Clock className="w-3 h-3" />
                              Frequency
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {([
                                { value: 'daily', label: 'Daily' },
                                { value: '3days', label: 'Every 3 Days' },
                                { value: 'weekly', label: 'Weekly' },
                              ] as { value: AgentFrequency; label: string }[]).map((option) => (
                                <button
                                  key={option.value}
                                  onClick={async () => {
                                    if (state === 'editing') {
                                      const updated = await updateAgentSettings(userId, { frequency: option.value });
                                      setAgentSettings(updated);
                                    }
                                  }}
                                  disabled={state !== 'editing'}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                    agentSettings.frequency === option.value
                                      ? 'bg-green-500/30 text-green-300 border border-green-500/50'
                                      : 'bg-white/5 text-white/60 border border-white/10 hover:border-white/20'
                                  } disabled:opacity-50`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                            <p className="text-white/30 text-[10px]">
                              Actions are randomized within the frequency window to avoid detection
                            </p>
                          </div>

                          {/* Last Run Info */}
                          {agentSettings.lastRunAt && (
                            <div className="pt-2 border-t border-white/10">
                              <p className="text-white/40 text-xs">
                                Last run: {new Date(agentSettings.lastRunAt).toLocaleString()}
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Saving State */}
            {state === 'saving' && (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mb-4" />
                <p className="text-white/70">Saving your character card...</p>
              </div>
            )}

            {/* Saved State */}
            {state === 'saved' && (
              <div className="flex flex-col items-center justify-center py-16">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-16 h-16 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center mb-6"
                >
                  <Check className="w-8 h-8 text-white" />
                </motion.div>
                <h3 className="text-xl font-bold text-white mb-2">Character Card Saved!</h3>
                <p className="text-white/60 text-center max-w-md mb-6">
                  Your AI clone has been created. It will now use this personality when interacting on your behalf.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export JSON
                  </button>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-cyan-500 text-white font-medium transition-transform hover:scale-105"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Regenerate Confirmation State */}
          {state === 'confirm_regenerate' && (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/50 flex items-center justify-center mb-6">
                <DollarSign className="w-10 h-10 text-yellow-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Regenerate Character Card</h3>
              <p className="text-white/60 text-center max-w-md mb-4">
                Regenerating your AI clone will fetch your latest tweets and create a fresh personality analysis.
              </p>
              
              <div className="bg-white/5 rounded-xl p-4 mb-6 w-full max-w-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/70 text-sm">Regeneration Fee</span>
                  <span className="text-yellow-400 font-bold">${REGENERATE_FEE} USDC</span>
                </div>
                <div className="flex items-center gap-2 text-white/40 text-xs">
                  <Lock className="w-3 h-3" />
                  <span>Secured via x402 protocol</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setState('editing')}
                  className="px-6 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmRegenerate}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-bold transition-transform hover:scale-105"
                >
                  <Zap className="w-4 h-4" />
                  Pay & Regenerate
                </button>
              </div>
              
              <p className="text-white/30 text-xs mt-4">
                Free during beta • Payment coming soon
              </p>
            </div>
          )}

          {/* Footer Actions */}
          {(state === 'preview' || state === 'editing') && (
            <div className="sticky bottom-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-0 px-3 sm:px-6 py-3 sm:py-4 border-t border-white/10 bg-black/80 backdrop-blur-md">
              <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                <button
                  onClick={handleExport}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-xs sm:text-sm transition-colors flex-1 sm:flex-initial min-w-0"
                >
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                  <span className="truncate text-center">Export</span>
                </button>
                <button
                  onClick={handleRegenerateClick}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs sm:text-sm transition-colors flex-1 sm:flex-initial min-w-0"
                >
                  <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                  <span className="truncate text-center">Update Persona</span>
                </button>
              </div>
              <div className="flex gap-2 flex-1 sm:flex-initial">
                {state === 'preview' ? (
                  <>
                    <button
                      onClick={() => setState('editing')}
                      className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm transition-colors flex-1 sm:flex-initial min-w-0"
                    >
                      <Edit3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                      <span className="truncate text-center">Edit</span>
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-gradient-to-r from-pink-600 to-cyan-500 text-white font-medium text-xs sm:text-sm transition-transform hover:scale-105 flex-1 sm:flex-initial min-w-0"
                    >
                      <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                      <span className="truncate text-center">Save Clone</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      className="flex items-center justify-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm transition-colors flex-1 sm:flex-initial min-w-0 text-center"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-gradient-to-r from-pink-600 to-cyan-500 text-white font-medium text-xs sm:text-sm transition-transform hover:scale-105 flex-1 sm:flex-initial min-w-0"
                    >
                      <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                      <span className="truncate text-center">Save Changes</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

