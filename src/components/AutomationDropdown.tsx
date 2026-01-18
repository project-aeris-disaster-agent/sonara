import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, 
  ChevronDown, 
  Twitter, 
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
  Bot,
  Sparkles
} from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { ShinyButton } from '@/components/ShinyButton';

// Custom icons matching HomePage
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
import type { ElizaOSCharacterCard, AgentSettings } from '@/types/database';
import type { ChatMessage } from '@/services/chatService';
import { 
  generateRecommendedPost, 
  schedulePost, 
  postImmediately,
  calculateNextScheduleTime,
  type RecommendedPost 
} from '@/services/automationService';
import { getAgentSettings, toggleAgentMode, DEFAULT_AGENT_SETTINGS, getAgentActivityStats, type AgentActivityStats } from '@/services/agentService';

interface AutomationDropdownProps {
  userId: string;
  characterCard: ElizaOSCharacterCard | null;
  conversationHistory: ChatMessage[];
  sessionId: string | null;
  connectedPlatforms: {
    twitter: boolean;
    farcaster: boolean;
    baseapp: boolean;
  };
  onAgentModeChange?: (enabled: boolean) => void;
}

type ScheduleType = 'instant' | '24hrs' | '48hrs' | '72hrs' | 'daily' | 'weekly' | 'custom';

export function AutomationDropdown({
  userId,
  characterCard,
  conversationHistory,
  sessionId,
  connectedPlatforms,
  onAgentModeChange,
}: AutomationDropdownProps) {
  const { showSuccess, showError, showWarning } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [recommendedPost, setRecommendedPost] = useState<RecommendedPost | null>(null);
  const [editableContent, setEditableContent] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('instant');
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [postStatus, setPostStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Agent Mode state
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [isTogglingAgentMode, setIsTogglingAgentMode] = useState(false);
  const [agentStats, setAgentStats] = useState<AgentActivityStats | null>(null);

  // No longer need position calculation since we're using a centered modal

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Auto-generation disabled - user must click "Generate Post" button manually

  // Sync editable content and tags with the latest generated post
  useEffect(() => {
    if (recommendedPost?.content) {
      setEditableContent(recommendedPost.content);
    }
    if (recommendedPost?.suggestedTopics) {
      // Only take the first tag to minimize UI space
      setTags(recommendedPost.suggestedTopics.slice(0, 1));
    }
  }, [recommendedPost]);

  // Update selected platforms based on connected platforms
  useEffect(() => {
    const platforms: string[] = [];
    if (connectedPlatforms.twitter) platforms.push('twitter');
    if (connectedPlatforms.farcaster) platforms.push('farcaster');
    if (connectedPlatforms.baseapp) platforms.push('baseapp');
    setSelectedPlatforms(platforms);
  }, [connectedPlatforms]);

  // Load agent settings and stats on mount
  useEffect(() => {
    if (userId) {
      getAgentSettings(userId)
        .then((settings) => {
          setAgentSettings(settings);
          onAgentModeChange?.(settings.enabled);
        })
        .catch((error) => {
          console.error('Failed to load agent settings:', error);
        });
      
      // Load activity stats
      getAgentActivityStats(userId)
        .then((stats) => {
          setAgentStats(stats);
        })
        .catch((error) => {
          console.error('Failed to load agent stats:', error);
        });
    }
  }, [userId]);

  // Refresh stats periodically when agent mode is enabled
  useEffect(() => {
    if (!agentSettings.enabled || !userId) return;
    
    const interval = setInterval(() => {
      getAgentActivityStats(userId)
        .then((stats) => {
          setAgentStats(stats);
        })
        .catch((error) => {
          console.error('Failed to refresh agent stats:', error);
        });
    }, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, [agentSettings.enabled, userId]);

  // Handle agent mode toggle
  // Format relative time
  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 0) {
      const absMins = Math.abs(diffMins);
      if (absMins < 60) return `${absMins}m ago`;
      const absHours = Math.abs(diffHours);
      if (absHours < 24) return `${absHours}h ago`;
      return `${Math.abs(diffDays)}d ago`;
    }

    if (diffMins < 60) return `in ${diffMins}m`;
    if (diffHours < 24) return `in ${diffHours}h`;
    return `in ${diffDays}d`;
  };

  const handleAgentModeToggle = async () => {
    if (isTogglingAgentMode) return;
    
    setIsTogglingAgentMode(true);
    try {
      const newEnabled = !agentSettings.enabled;
      const updated = await toggleAgentMode(userId, newEnabled);
      setAgentSettings(updated);
      onAgentModeChange?.(newEnabled);
      
      // Refresh stats after toggle
      if (newEnabled) {
        getAgentActivityStats(userId)
          .then((stats) => {
            setAgentStats(stats);
          })
          .catch((error) => {
            console.error('Failed to load agent stats:', error);
          });
      }
    } catch (error) {
      console.error('Failed to toggle agent mode:', error);
      setPostStatus({
        type: 'error',
        message: 'Failed to toggle Agent Mode. Please try again.',
      });
    } finally {
      setIsTogglingAgentMode(false);
    }
  };

  const handleGeneratePost = async () => {
    if (!characterCard || !sessionId) {
      return;
    }

    setIsGenerating(true);
    setPostStatus(null);

    const tagsToUse = tags.length > 0 ? tags : undefined;

    try {
      const post = await generateRecommendedPost(
        userId,
        characterCard,
        conversationHistory,
        sessionId,
        tagsToUse
      );
      setRecommendedPost(post);
      setEditableContent(post.content);
      // Update tags only if no tags exist yet (initial generation) - only take first tag
      if (tags.length === 0 && post.suggestedTopics.length > 0) {
        setTags(post.suggestedTopics.slice(0, 1));
      }
    } catch (error) {
      console.error('Failed to generate post:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate post';
      
      // Check for rate limit errors
      if (errorMessage.includes('Rate limit') || errorMessage.includes('429') || errorMessage.includes('Too many')) {
        showWarning('⏳ Too many requests. Please wait a moment before generating again.', 6000);
        setPostStatus({
          type: 'error',
          message: 'Rate limit reached. Please wait before generating.',
        });
      } else {
        showError(`Failed to generate post: ${errorMessage}`, 5000);
        setPostStatus({
          type: 'error',
          message: 'Failed to generate post. Please try again.',
        });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSummarize = async () => {
    if (!editableContent.trim() || !characterCard) return;
    
    setIsSummarizing(true);
    try {
      // Call the chat edge function to summarize in the character's voice
      const edgeFunctionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-with-clone`;
      
      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId || 'summarize-session',
          message: `Summarize this tweet into 1-2 short sentences with emojis. Keep your authentic voice - punchy, casual, like texting a friend. Here's the tweet to summarize:\n\n"${editableContent}"`,
          character_card: characterCard,
          conversation_history: [],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to summarize');
      }

      // Clean up the response - remove quotes if wrapped
      let summarized = data.response.trim();
      if (summarized.startsWith('"') && summarized.endsWith('"')) {
        summarized = summarized.slice(1, -1);
      }
      
      setEditableContent(summarized);
      showSuccess('✨ Tweet summarized!');
    } catch (error) {
      console.error('Failed to summarize:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to summarize';
      showError(`Summarize failed: ${errorMessage}`, 4000);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleDeleteTag = (indexToDelete: number) => {
    setTags(prev => prev.filter((_, idx) => idx !== indexToDelete));
  };

  const handleAddTag = () => {
    const trimmedTag = newTagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags(prev => [...prev, trimmedTag]);
      setNewTagInput('');
    }
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handlePost = async () => {
    if (!recommendedPost || selectedPlatforms.length === 0) {
      setPostStatus({
        type: 'error',
        message: 'Please select at least one platform.',
      });
      return;
    }

    const contentToPost = editableContent.trim();
    if (!contentToPost) {
      setPostStatus({
        type: 'error',
        message: 'Post content cannot be empty.',
      });
      return;
    }

    setIsPosting(true);
    setPostStatus(null);

    try {
      if (scheduleType === 'instant') {
        // Post immediately
        const results = await postImmediately(userId, contentToPost, selectedPlatforms);
        const allSuccess = results.every(r => r.success);
        
        if (allSuccess) {
          setPostStatus({
            type: 'success',
            message: `Posted successfully to ${selectedPlatforms.join(', ')}!`,
          });
          showSuccess(`🎉 Posted to ${selectedPlatforms.map(p => p === 'twitter' ? 'X' : p).join(', ')}!`);
          // Reset after 3 seconds
          setTimeout(() => {
            setPostStatus(null);
            setIsOpen(false);
          }, 3000);
        } else {
          const errors = results.filter(r => !r.success);
          const errorDetails = errors.map(e => `${e.platform}: ${e.error || 'Unknown error'}`).join('\n');
          console.error('Post failed with errors:', errorDetails);
          
          // Check for specific error types and show user-friendly messages
          const firstError = errors[0]?.error || '';
          let userMessage = '';
          
          if (firstError.includes('Rate limit') || firstError.includes('429')) {
            userMessage = 'Too many posts! Please wait a few minutes before posting again.';
            showWarning(userMessage, 8000);
          } else if (firstError.includes('401') || firstError.includes('unauthorized') || firstError.includes('token')) {
            userMessage = 'Your X connection has expired. Please reconnect your account.';
            showError(userMessage, 8000);
          } else if (firstError.includes('duplicate') || firstError.includes('already posted')) {
            userMessage = 'This content was already posted recently. Try adding something unique!';
            showWarning(userMessage, 6000);
          } else {
            userMessage = `Failed to post: ${firstError || 'Unknown error'}`;
            showError(userMessage, 6000);
          }
          
          setPostStatus({
            type: 'error',
            message: userMessage,
          });
        }
      } else {
        // Schedule post
        let scheduledDate: Date;

        if (scheduleType === 'custom') {
          if (!customDate || !customTime) {
            setPostStatus({
              type: 'error',
              message: 'Please select both date and time.',
            });
            setIsPosting(false);
            return;
          }
          scheduledDate = new Date(`${customDate}T${customTime}`);
        } else {
          scheduledDate = calculateNextScheduleTime(scheduleType as '24hrs' | '48hrs' | '72hrs' | 'daily' | 'weekly');
        }

        await schedulePost(userId, contentToPost, scheduledDate, selectedPlatforms);
        
        setPostStatus({
          type: 'success',
          message: `Post scheduled for ${scheduledDate.toLocaleString()}!`,
        });
        showSuccess(`📅 Post scheduled for ${scheduledDate.toLocaleString()}`);
        
        setTimeout(() => {
          setPostStatus(null);
          setIsOpen(false);
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to post:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to post. Please try again.';
      
      // Check for rate limit errors
      if (errorMessage.includes('Rate limit') || errorMessage.includes('429') || errorMessage.includes('Too many')) {
        showWarning('⏳ Rate limit reached. Please wait before trying again.', 8000);
      } else {
        showError(`❌ ${errorMessage}`, 6000);
      }
      
      setPostStatus({
        type: 'error',
        message: errorMessage,
      });
    } finally {
      setIsPosting(false);
    }
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  const scheduleOptions: { value: ScheduleType; label: string; shortLabel: string }[] = [
    { value: 'instant', label: 'Post Now', shortLabel: 'Now' },
    { value: '24hrs', label: 'In 24 Hours', shortLabel: '24h' },
    { value: '48hrs', label: 'In 48 Hours', shortLabel: '48h' },
    { value: '72hrs', label: 'In 72 Hours', shortLabel: '72h' },
    { value: 'daily', label: 'Daily', shortLabel: 'Daily' },
    { value: 'weekly', label: 'Weekly', shortLabel: 'Weekly' },
    { value: 'custom', label: 'Custom Date & Time', shortLabel: 'Custom' },
  ];

  const availablePlatforms = [
    { id: 'twitter', name: 'Twitter / X', icon: Twitter, enabled: connectedPlatforms.twitter },
    { id: 'farcaster', name: 'Farcaster', icon: FarcasterIcon, enabled: connectedPlatforms.farcaster },
    { id: 'baseapp', name: 'BASEapp', icon: BaseIcon, enabled: connectedPlatforms.baseapp },
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Automation Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full mt-3 bg-gradient-to-r from-yellow-600/80 to-orange-500/80 hover:from-yellow-600 hover:to-orange-500 rounded-xl p-[2px] transition-all duration-200 hover:scale-[1.02]"
      >
        <div className="bg-black/80 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center justify-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="text-white font-bold text-sm">AUTOMATION</span>
          <ChevronDown className={`w-4 h-4 text-white/70 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Modal Popup - Premium Gold/Black Theme */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]"
              onClick={() => setIsOpen(false)}
            />
            
            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none"
            >
              <div 
                className="w-full max-w-2xl max-h-[90vh] overflow-hidden pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
            {/* Premium Gold Border Container */}
            <div className="bg-gradient-to-br from-yellow-600/20 via-yellow-500/10 to-orange-500/20 rounded-2xl p-[2px] shadow-2xl flex flex-col max-h-[90vh]">
              <div className="bg-black/95 backdrop-blur-xl rounded-2xl border-2 border-yellow-500/30 relative overflow-hidden flex flex-col max-h-full">
                {/* Decorative Corner Accents */}
                <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-yellow-500/50 rounded-tl-2xl" />
                <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-yellow-500/50 rounded-tr-2xl" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 border-yellow-500/50 rounded-bl-2xl" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-yellow-500/50 rounded-br-2xl" />
                
                {/* Scrollable Content Area */}
                <div className="p-2 sm:p-2.5 space-y-1.5 sm:space-y-2 relative z-10 flex flex-col flex-1 min-h-0 overflow-y-auto">
                  {/* Premium Header */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-yellow-500/20">
                    <div className="flex items-center gap-1.5">
                      <div className="p-1 bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-lg border border-yellow-500/30">
                        <Zap className="w-3.5 h-3.5 text-yellow-400" />
                      </div>
                      <div>
                        <h3 className="text-white font-bold text-xs flex items-center gap-2">
                          Recommended Post
                        </h3>
                        <p className="text-yellow-400/70 text-[9px] font-medium">Premium Automation</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsOpen(false)}
                      className="p-1.5 hover:bg-yellow-500/10 rounded-lg transition-colors border border-yellow-500/20 hover:border-yellow-500/40"
                    >
                      <X className="w-3.5 h-3.5 text-yellow-400/80" />
                    </button>
                  </div>

                  {/* Agent Mode Toggle */}
                  <div 
                    className={`rounded-lg p-2 border-2 transition-all duration-300 ${
                      agentSettings.enabled 
                        ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500/50 shadow-lg shadow-green-500/20' 
                        : 'bg-black/40 border-white/10'
                    }`}
                  >
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-1.5">
                        <div className={`p-1 rounded-lg transition-all duration-300 ${
                          agentSettings.enabled 
                            ? 'bg-green-500/30 border border-green-500/50' 
                            : 'bg-white/10 border border-white/20'
                        }`}>
                          <Bot className={`w-3.5 h-3.5 transition-colors ${
                            agentSettings.enabled ? 'text-green-400' : 'text-white/50'
                          }`} />
                        </div>
                        <div>
                          <span className={`font-bold text-xs transition-colors ${
                            agentSettings.enabled ? 'text-green-300' : 'text-white/70'
                          }`}>
                            AGENT MODE
                          </span>
                          <p className={`text-[9px] transition-colors leading-tight ${
                            agentSettings.enabled ? 'text-green-400/70' : 'text-white/40'
                          }`}>
                            {agentSettings.enabled ? 'Auto-engagement active' : 'Enable auto-engagement'}
                          </p>
                        </div>
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={agentSettings.enabled}
                          onChange={handleAgentModeToggle}
                          disabled={isTogglingAgentMode}
                          className="sr-only peer"
                        />
                        <div className={`w-10 h-5 rounded-full transition-all duration-300 peer-focus:ring-2 peer-focus:ring-green-500/30 ${
                          agentSettings.enabled 
                            ? 'bg-gradient-to-r from-green-500 to-emerald-500' 
                            : 'bg-white/20'
                        }`}>
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ${
                            agentSettings.enabled ? 'translate-x-[18px]' : 'translate-x-0'
                          }`} />
                        </div>
                        {agentSettings.enabled && (
                          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                        )}
                      </div>
                    </label>
                    {agentSettings.enabled && (
                      <div className="mt-1.5 pt-1.5 border-t border-green-500/20">
                        <div className="flex items-center gap-2 text-[9px] mb-1">
                          <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" />
                          <span className="font-medium text-green-400/80">LIVE</span>
                          <span className="text-green-400/60">• Monitoring {agentSettings.targetAccounts.length} target{agentSettings.targetAccounts.length !== 1 ? 's' : ''}</span>
                        </div>
                        {agentStats && (
                          <div className="flex items-center gap-2 flex-wrap text-[9px]">
                            <div className="text-green-400/70">
                              <span className="text-white/50">Pending: </span>
                              <span className="font-semibold">{agentStats.pendingActions}</span>
                            </div>
                            <div className="text-green-400/70">
                              <span className="text-white/50">Today: </span>
                              <span className="font-semibold">{agentStats.executedToday}</span>
                            </div>
                            {agentStats.lastRunAt && agentStats.nextScheduledAction && (
                              <>
                                <span className="text-green-400/40">•</span>
                                <span className="text-green-400/60">
                                  Last: {formatRelativeTime(agentStats.lastRunAt)}
                                </span>
                                <span className="text-green-400/60">
                                  Next: {formatRelativeTime(agentStats.nextScheduledAction)}
                                </span>
                              </>
                            )}
                            {agentStats.lastRunAt && !agentStats.nextScheduledAction && (
                              <>
                                <span className="text-green-400/40">•</span>
                                <span className="text-green-400/60">
                                  Last: {formatRelativeTime(agentStats.lastRunAt)}
                                </span>
                              </>
                            )}
                            {!agentStats.lastRunAt && agentStats.nextScheduledAction && (
                              <>
                                <span className="text-green-400/40">•</span>
                                <span className="text-green-400/60">
                                  Next: {formatRelativeTime(agentStats.nextScheduledAction)}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Premium Post Content */}
                  {isGenerating ? (
                    <div className="bg-gradient-to-br from-black/60 to-black/40 rounded-lg p-3 border-2 border-yellow-500/20 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="p-1.5 bg-yellow-500/10 rounded-full border border-yellow-500/30">
                          <RefreshCw className="w-4 h-4 text-yellow-400 animate-spin" />
                        </div>
                        <p className="text-yellow-400/80 text-[10px] font-medium">Generating...</p>
                      </div>
                    </div>
                  ) : recommendedPost ? (
                    <div className="bg-gradient-to-br from-black/60 to-black/40 rounded-lg p-2.5 border-2 border-yellow-500/20 relative">
                      <div className="absolute top-1.5 left-1.5 w-2.5 h-2.5 border-l-2 border-t-2 border-yellow-500/50" />
                      <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 border-r-2 border-t-2 border-yellow-500/50" />
                      <div className="absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-l-2 border-b-2 border-yellow-500/50" />
                      <div className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-r-2 border-b-2 border-yellow-500/50" />
                      
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-[9px] font-semibold rounded border border-yellow-500/30">
                            AI-GENERATED
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={handleSummarize}
                            disabled={isSummarizing || !editableContent.trim()}
                            className="p-1 hover:bg-purple-500/10 rounded-lg transition-colors border border-purple-500/20 hover:border-purple-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Summarize into 1-2 sentences with emojis"
                          >
                            {isSummarizing ? (
                              <RefreshCw className="w-3 h-3 text-purple-400/80 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3 text-purple-400/80" />
                            )}
                          </button>
                          <button
                            onClick={handleGeneratePost}
                            className="p-1 hover:bg-yellow-500/10 rounded-lg transition-colors border border-yellow-500/20 hover:border-yellow-500/40"
                            title={tags.length > 0 ? `Regenerate with ${tags.length} tag(s)` : "Regenerate"}
                          >
                            <RefreshCw className="w-3 h-3 text-yellow-400/80" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-yellow-400/70 text-[9px] font-semibold flex items-center gap-1">
                          <span>Edit before posting</span>
                        </label>
                        <textarea
                          value={editableContent}
                          onChange={(e) => setEditableContent(e.target.value)}
                          className="w-full bg-black/60 border border-yellow-500/30 rounded-lg p-1.5 text-white text-xs leading-tight focus:outline-none focus:border-yellow-500/60 min-h-[80px] resize-vertical"
                          placeholder="Customize the generated copy..."
                        />
                      </div>
                      {/* Tags Section */}
                      <div className="mt-1.5 pt-1.5 border-t border-yellow-500/10">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-yellow-400/70 text-[9px] font-semibold">
                            Tags / Topics
                          </label>
                        </div>
                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {tags.map((tag, idx) => (
                              <span
                                key={idx}
                                className="px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 text-[9px] font-medium rounded-full border border-yellow-500/30 flex items-center gap-1 group"
                              >
                                <span className="max-w-[120px] truncate">{tag}</span>
                                <button
                                  onClick={() => handleDeleteTag(idx)}
                                  className="hover:bg-yellow-500/20 rounded-full p-0.5 transition-colors flex-shrink-0"
                                  title="Remove tag"
                                >
                                  <X className="w-2 h-2 text-yellow-400/80 group-hover:text-yellow-400" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={handleTagInputKeyDown}
                            placeholder="Add tag..."
                            className="flex-1 bg-black/60 border border-yellow-500/30 rounded px-1.5 py-0.5 text-white text-[9px] focus:outline-none focus:border-yellow-500/60 placeholder:text-white/30"
                          />
                          <button
                            onClick={handleAddTag}
                            disabled={!newTagInput.trim() || tags.includes(newTagInput.trim())}
                            className="px-1.5 py-0.5 bg-yellow-500/20 hover:bg-yellow-500/30 disabled:opacity-40 disabled:cursor-not-allowed border border-yellow-500/30 rounded text-yellow-400 text-[9px] font-semibold transition-colors"
                            title="Add tag"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-br from-black/60 to-black/40 rounded-lg p-4 text-center border-2 border-yellow-500/20">
                      <ShinyButton onClick={handleGeneratePost}>
                        Generate Post
                      </ShinyButton>
                    </div>
                  )}

                  {/* Simplified Platform Selection - Simple Checkboxes */}
                  <div>
                    <label className="text-yellow-400/80 text-[9px] font-semibold mb-1 block">
                      Platforms
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {availablePlatforms.map((platform) => {
                        const Icon = platform.icon;
                        const isSelected = selectedPlatforms.includes(platform.id);
                        const isDisabled = !platform.enabled;

                        return (
                          <label
                            key={platform.id}
                            className={`flex items-center gap-1 cursor-pointer transition-all ${
                              isDisabled ? 'opacity-40 cursor-not-allowed' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => !isDisabled && togglePlatform(platform.id)}
                              disabled={isDisabled}
                              className="w-3 h-3 rounded border-2 border-yellow-500/40 bg-transparent checked:bg-yellow-500 checked:border-yellow-500 focus:ring-1 focus:ring-yellow-500/30 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <Icon className={`w-3 h-3 ${isSelected ? 'text-yellow-400' : 'text-white/50'}`} />
                            <span className={`text-[9px] ${isSelected ? 'text-yellow-400' : 'text-white/60'}`}>
                              {platform.id === 'twitter' ? 'X' : platform.id === 'farcaster' ? 'FC' : 'BASE'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Simplified Schedule Options - Numbers Only */}
                  <div>
                    <label className="text-yellow-400/80 text-[9px] font-semibold mb-1 block">
                      Schedule
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {scheduleOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setScheduleType(option.value)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold transition-all ${
                            scheduleType === option.value
                              ? 'bg-gradient-to-r from-yellow-600/80 to-orange-500/80 text-white border border-yellow-500/50'
                              : 'bg-black/40 text-white/60 hover:text-white border border-yellow-500/20 hover:border-yellow-500/40'
                          }`}
                        >
                          {option.shortLabel}
                        </button>
                      ))}
                    </div>

                    {/* Simplified Custom Date/Time Picker */}
                    {scheduleType === 'custom' && (
                      <div className="mt-1.5 flex gap-1">
                        <input
                          type="date"
                          value={customDate}
                          onChange={(e) => setCustomDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="flex-1 bg-black/60 border border-yellow-500/30 rounded px-1.5 py-0.5 text-white text-[9px] focus:outline-none focus:border-yellow-500/60"
                        />
                        <input
                          type="time"
                          value={customTime}
                          onChange={(e) => setCustomTime(e.target.value)}
                          className="flex-1 bg-black/60 border border-yellow-500/30 rounded px-1.5 py-0.5 text-white text-[9px] focus:outline-none focus:border-yellow-500/60"
                        />
                      </div>
                    )}
                  </div>

                  {/* Premium Status Message */}
                  {postStatus && (
                    <div
                      className={`p-2 rounded-lg flex items-center gap-2 border-2 ${
                        postStatus.type === 'success'
                          ? 'bg-green-500/10 border-green-500/50'
                          : 'bg-red-500/10 border-red-500/50'
                      }`}
                    >
                      {postStatus.type === 'success' ? (
                        <div className="p-1 bg-green-500/20 rounded border border-green-500/30">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                        </div>
                      ) : (
                        <div className="p-1 bg-red-500/20 rounded border border-red-500/30">
                          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        </div>
                      )}
                      <p
                        className={`text-xs font-semibold ${
                          postStatus.type === 'success' ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {postStatus.message}
                      </p>
                    </div>
                  )}

                </div>
                
                {/* Fixed Bottom Button - Always Visible */}
                <div className="p-2.5 sm:p-3 pt-2 border-t-2 border-yellow-500/30 bg-black/95 flex-shrink-0">
                  <button
                    onClick={handlePost}
                    disabled={
                      isPosting ||
                      !recommendedPost ||
                      selectedPlatforms.length === 0 ||
                      !editableContent.trim()
                    }
                    className="w-full bg-gradient-to-r from-yellow-500 via-yellow-600 to-orange-500 hover:from-yellow-400 hover:via-yellow-500 hover:to-orange-400 rounded-lg px-4 py-3 text-black font-extrabold text-sm hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2 border-2 border-yellow-400/60 shadow-2xl shadow-yellow-500/40 disabled:shadow-none uppercase tracking-wider"
                  >
                    {isPosting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="text-xs">{scheduleType === 'instant' ? 'Posting...' : 'Scheduling...'}</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        {scheduleType === 'instant' ? 'AUTOMATE NOW' : 'SCHEDULE POST'}
                      </>
                    )}
                  </button>
                </div>
              </div>
                </div>
              </div>
            </motion.div>
          </>
          )}
        </AnimatePresence>
    </div>
  );
}

