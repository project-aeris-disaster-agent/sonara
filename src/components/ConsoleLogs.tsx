import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Terminal,
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  Loader2,
  Twitter,
  Bot,
  Brain,
  Calendar,
  MessageSquare,
  Repeat2,
  Heart,
  ExternalLink,
  History,
  XCircle,
  Settings,
  Smile,
  Sliders,
  MessageCircle,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { ScheduledPostType } from '@/types/database';
import { useScheduledTasks } from '@/hooks/useScheduledTasks';
import { usePredictedActions } from '@/hooks/usePredictedActions';
import { getSourceLabel, getTwitterLink, formatScheduledTime, formatTime } from '@/utils/taskUtils';
import { checkTwitterConnectivity, checkLLMConnectivity, checkAgentStatus } from '@/services/connectivityService';
import { 
  getEmojiMode, 
  setEmojiMode,
  getAdvancedSettings,
  updateAdvancedSettings,
  DEFAULT_ADVANCED_SETTINGS,
  type AdvancedSettings,
} from '@/services/preferencesService';
import { useNotifications } from '@/contexts/NotificationContext';

interface ConsoleLogsProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  twitterAccessToken: string | null;
}

interface ConnectivityStatus {
  twitter: {
    status: 'connected' | 'disconnected' | 'checking';
    lastChecked: Date | null;
    error?: string;
  };
  agent: {
    status: 'active' | 'inactive' | 'checking';
    enabled: boolean;
    lastRun: Date | null;
    pendingActions: number;
  };
  llm: {
    status: 'available' | 'unavailable' | 'checking';
    lastChecked: Date | null;
    error?: string;
  };
}

type HistoryFilter = 'all' | 'success' | 'failed';

const ACTION_CONFIG: Record<ScheduledPostType, { icon: typeof Send; color: string; label: string }> = {
  tweet: { icon: Send, color: 'text-blue-400', label: 'Tweet' },
  reply: { icon: MessageSquare, color: 'text-cyan-400', label: 'Reply' },
  thread: { icon: Send, color: 'text-purple-400', label: 'Thread' },
  retweet: { icon: Repeat2, color: 'text-green-400', label: 'Retweet' },
  like: { icon: Heart, color: 'text-pink-400', label: 'Like' },
  comment: { icon: MessageSquare, color: 'text-yellow-400', label: 'Comment' },
};

export function ConsoleLogs({ isOpen, onClose, userId, twitterAccessToken }: ConsoleLogsProps) {
  const { showSuccess, showError } = useNotifications();
  const [activeTab, setActiveTab] = useState<'tasks' | 'history' | 'status' | 'report' | 'settings'>('tasks');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [connectivityStatus, setConnectivityStatus] = useState<ConnectivityStatus>({
    twitter: { status: 'checking', lastChecked: null },
    agent: { status: 'checking', enabled: false, lastRun: null, pendingActions: 0 },
    llm: { status: 'checking', lastChecked: null },
  });
  const [reportText, setReportText] = useState('');
  const [emojiMode, setEmojiModeState] = useState(false);
  const [isLoadingEmojiMode, setIsLoadingEmojiMode] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>(DEFAULT_ADVANCED_SETTINGS);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);

  // Use shared hooks for task data
  const { pending: ongoingTasks, completed: completedTasks, refresh: refreshTasks } = useScheduledTasks({
    userId,
    enabled: isOpen,
    pendingLimit: 50,
    // No limit on completed posts - show all history
  });

  // Use shared hook for predicted actions
  const { predictedActions, dismissAction, refresh: refreshPredicted } = usePredictedActions({
    userId,
    enabled: isOpen,
    pendingTasks: ongoingTasks, // This will be updated when ongoingTasks changes
  });

  // Handle cancel predicted action
  const handleCancelPredicted = (predictedId: string) => {
    dismissAction(predictedId);
  };

  // Load emoji mode preference on mount
  useEffect(() => {
    if (isOpen && userId) {
      loadEmojiMode();
      loadAdvancedSettings();
    }
  }, [isOpen, userId]);

  const loadEmojiMode = async () => {
    try {
      const enabled = await getEmojiMode(userId);
      setEmojiModeState(enabled);
    } catch (error) {
      console.error('Error loading emoji mode:', error);
    }
  };

  const loadAdvancedSettings = async () => {
    try {
      const settings = await getAdvancedSettings(userId);
      setAdvancedSettings(settings);
    } catch (error) {
      console.error('Error loading advanced settings:', error);
    }
  };

  const handleToggleEmojiMode = async (enabled: boolean) => {
    setIsLoadingEmojiMode(true);
    try {
      await setEmojiMode(userId, enabled);
      setEmojiModeState(enabled);
      showSuccess(`Emoji mode ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error toggling emoji mode:', error);
      showError('Failed to update emoji mode setting');
    } finally {
      setIsLoadingEmojiMode(false);
    }
  };

  const handleUpdateAdvancedSetting = async <K extends keyof AdvancedSettings>(
    key: K,
    value: AdvancedSettings[K]
  ) => {
    setIsLoadingSettings(true);
    try {
      await updateAdvancedSettings(userId, { [key]: value });
      setAdvancedSettings(prev => ({ ...prev, [key]: value }));
    } catch (error) {
      console.error('Error updating setting:', error);
      showError('Failed to update setting');
    } finally {
      setIsLoadingSettings(false);
    }
  };

  // Check connectivity status
  const checkConnectivityStatus = async () => {
    setIsRefreshing(true);
    
    // Check Twitter API
    setConnectivityStatus(prev => ({
      ...prev,
      twitter: { status: 'checking', lastChecked: null },
    }));

    const twitterStatus = await checkTwitterConnectivity(twitterAccessToken);
    setConnectivityStatus(prev => ({
      ...prev,
      twitter: twitterStatus,
    }));

    // Check Agent Status
    const agentStatus = await checkAgentStatus(userId);
    setConnectivityStatus(prev => ({
      ...prev,
      agent: {
        ...agentStatus,
        status: agentStatus.status,
      },
    }));

    // Check LLM Status
    setConnectivityStatus(prev => ({
      ...prev,
      llm: { status: 'checking', lastChecked: null },
    }));
    const llmStatus = await checkLLMConnectivity();
    setConnectivityStatus(prev => ({
      ...prev,
      llm: llmStatus,
    }));

    setIsRefreshing(false);
  };

  // Refresh all data
  const handleRefresh = async () => {
    await Promise.all([
      refreshTasks(),
      checkConnectivityStatus(),
      refreshPredicted(),
    ]);
  };

  // Initial load and refresh on open
  useEffect(() => {
    if (isOpen && userId) {
      handleRefresh();
    }
  }, [isOpen, userId]);

  // Filter completed tasks based on history filter
  const filteredCompletedTasks = completedTasks.filter((task) => {
    if (historyFilter === 'all') return true;
    if (historyFilter === 'success') return task.status === 'posted';
    if (historyFilter === 'failed') return task.status === 'failed';
    return true;
  });

  const failedTasksCount = completedTasks.filter(t => t.status === 'failed').length;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-4 sm:inset-8 lg:inset-[10%] z-[101] bg-black/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-cyan-500/20 to-pink-500/20 rounded-lg border border-cyan-500/30">
                  <Terminal className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg">Console Logs</h2>
                  <p className="text-white/50 text-xs">System diagnostics & monitoring</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 text-white/70 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                  title="Close"
                >
                  <X className="w-4 h-4 text-white/70" />
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-6 py-3 border-b border-white/10 bg-black/40 overflow-x-auto">
              {[
                { id: 'tasks' as const, label: 'Pending', icon: Calendar, count: ongoingTasks.length },
                { id: 'history' as const, label: 'History', icon: History, count: completedTasks.length, failedCount: failedTasksCount },
                { id: 'status' as const, label: 'Status', icon: Activity },
                { id: 'report' as const, label: 'Report', icon: Send },
                { id: 'settings' as const, label: 'Settings', icon: Settings },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'bg-white/10 text-white border border-white/20'
                        : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{tab.label}</span>
                    {'count' in tab && tab.count !== undefined && tab.count > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                        'failedCount' in tab && tab.failedCount && tab.failedCount > 0
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-white/10 text-white/60'
                      }`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Ongoing Tasks Tab */}
              {activeTab === 'tasks' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-medium text-sm">Automation Queue</h3>
                    <div className="flex items-center gap-2 text-xs">
                      {connectivityStatus.agent.enabled && (
                        <div className="flex items-center gap-1 text-green-400/70">
                          <Bot className="w-3 h-3" />
                          <span>{connectivityStatus.agent.pendingActions}</span>
                        </div>
                      )}
                      <span className="text-white/40">{ongoingTasks.length} pending</span>
                    </div>
                  </div>
                  {(() => {
                    // Predicted actions are already filtered by the hook
                    // Combine actual tasks with predicted actions

                    const allTasks = [...ongoingTasks, ...predictedActions.map((pred) => ({
                      id: pred.id,
                      user_id: userId,
                      content: pred.actionType === 'comment' ? 'Generated reply will appear here' : '',
                      post_type: pred.actionType === 'comment' ? 'comment' : pred.actionType as ScheduledPostType,
                      scheduled_for: pred.predictedScheduleTime.toISOString(),
                      status: 'pending' as const,
                      created_at: new Date().toISOString(),
                      posted_at: null,
                      error_message: null,
                      target_tweet_id: null,
                      post_metadata: {
                        generated_by: 'agent_mode_predicted',
                        target_account: pred.targetAccount,
                        is_predicted: true,
                      },
                    }))].sort((a, b) => 
                      new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
                    );

                    return allTasks.length === 0 ? (
                      <div className="text-center py-12">
                        <Calendar className="w-12 h-12 text-white/20 mx-auto mb-3" />
                        <p className="text-white/50 text-sm">No ongoing tasks</p>
                        {connectivityStatus.agent.enabled && connectivityStatus.agent.pendingActions === 0 ? (
                          <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-xl max-w-md mx-auto">
                            <div className="flex items-start gap-3">
                              <Bot className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                              <div className="text-left">
                                <p className="text-green-400 text-sm font-medium mb-1">Agent Mode Active</p>
                                <p className="text-white/60 text-xs mb-2">
                                  Agent actions are scheduled automatically by the cron job (runs every 6 hours).
                                </p>
                                {connectivityStatus.agent.lastRun && (
                                  <p className="text-white/50 text-xs">
                                    Last run: {formatTime(connectivityStatus.agent.lastRun)}
                                  </p>
                                )}
                                <p className="text-white/50 text-xs mt-2">
                                  Actions will appear here once scheduled.
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-white/30 text-xs mt-1">Scheduled posts will appear here</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {allTasks.map((task) => {
                          const isPredicted = (task.post_metadata as Record<string, unknown>)?.is_predicted === true;
                          const metadata = task.post_metadata as Record<string, unknown> | null;
                          const targetAccount = metadata?.target_account as string;
                          const config = ACTION_CONFIG[task.post_type] || ACTION_CONFIG.tweet;
                          const Icon = config.icon;
                          const sourceLabel = isPredicted ? 'Agent' : getSourceLabel(task);
                          const isAgent = sourceLabel === 'Agent' || isPredicted;

                          return (
                            <div
                              key={task.id}
                              className={`p-2 rounded border ${
                                isPredicted
                                  ? 'bg-yellow-500/5 border-yellow-500/20 border-dashed'
                                  : isAgent
                                  ? 'bg-green-500/5 border-green-500/10'
                                  : 'bg-white/5 border-white/5'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Icon className={`w-3.5 h-3.5 ${config.color} flex-shrink-0`} />
                                <span className={`text-xs font-medium ${config.color}`}>
                                  {config.label}
                                </span>
                                {targetAccount && (
                                  <span className="text-white/40 text-xs">@{targetAccount}</span>
                                )}
                                <span className={`text-xs ${
                                  isPredicted
                                    ? 'text-yellow-400/70'
                                    : isAgent
                                    ? 'text-green-400/70'
                                    : 'text-white/40'
                                }`}>
                                  {sourceLabel}
                                </span>
                                {isPredicted && (
                                  <span className="text-yellow-400/60 text-xs italic">
                                    Upcoming
                                  </span>
                                )}
                                <div className="flex items-center gap-1.5 text-white/30 text-xs ml-auto">
                                  <Clock className="w-3 h-3" />
                                  <span>{formatScheduledTime(task.scheduled_for)}</span>
                                </div>
                                {isPredicted && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelPredicted(task.id);
                                    }}
                                    className="p-1 rounded hover:bg-red-500/20 text-red-400/70 hover:text-red-400 transition-colors"
                                    title="Remove"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {task.content && (
                                <p className="text-white/50 text-xs mt-1 line-clamp-1 pl-5.5">
                                  {task.content}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Activity History Tab (consolidated with Errors) */}
              {activeTab === 'history' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-medium text-sm">Activity History</h3>
                    <div className="flex items-center gap-2">
                      {/* Filter buttons */}
                      <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5 border border-white/10">
                        <button
                          onClick={() => setHistoryFilter('all')}
                          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                            historyFilter === 'all'
                              ? 'bg-white/10 text-white'
                              : 'text-white/50 hover:text-white/70'
                          }`}
                        >
                          All
                        </button>
                        <button
                          onClick={() => setHistoryFilter('success')}
                          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                            historyFilter === 'success'
                              ? 'bg-green-500/20 text-green-400'
                              : 'text-white/50 hover:text-white/70'
                          }`}
                        >
                          Success
                        </button>
                        <button
                          onClick={() => setHistoryFilter('failed')}
                          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                            historyFilter === 'failed'
                              ? 'bg-red-500/20 text-red-400'
                              : 'text-white/50 hover:text-white/70'
                          }`}
                        >
                          Failed
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-green-400/70">
                          {completedTasks.filter(t => t.status === 'posted').length}
                        </span>
                        <span className="text-red-400/70">
                          {completedTasks.filter(t => t.status === 'failed').length}
                        </span>
                      </div>
                    </div>
                  </div>
                  {filteredCompletedTasks.length === 0 ? (
                    <div className="text-center py-12">
                      <History className="w-12 h-12 text-white/20 mx-auto mb-3" />
                      <p className="text-white/50 text-sm">
                        {historyFilter === 'all' 
                          ? 'No activity history' 
                          : historyFilter === 'success'
                          ? 'No successful actions yet'
                          : 'No failed actions'}
                      </p>
                      <p className="text-white/30 text-xs mt-1">Completed actions will appear here with links</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredCompletedTasks.map((task) => {
                        const config = ACTION_CONFIG[task.post_type] || ACTION_CONFIG.tweet;
                        const Icon = config.icon;
                        const sourceLabel = getSourceLabel(task);
                        const isAgent = sourceLabel === 'Agent';
                        const isSuccess = task.status === 'posted';
                        const twitterLink = getTwitterLink(task);
                        const metadata = task.post_metadata as Record<string, unknown> | null;
                        const targetAccount = metadata?.target_account as string;

                        return (
                          <div
                            key={task.id}
                            className={`p-2 rounded border ${
                              isSuccess
                                ? 'bg-green-500/5 border-green-500/10'
                                : 'bg-red-500/5 border-red-500/10'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {isSuccess ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                              )}
                              <Icon className={`w-3.5 h-3.5 ${config.color} flex-shrink-0`} />
                              <span className={`text-xs font-medium ${config.color}`}>
                                {config.label}
                              </span>
                              {targetAccount && (
                                <span className="text-white/40 text-xs">@{targetAccount}</span>
                              )}
                              {isAgent && (
                                <span className="text-green-400/70 text-xs">Agent</span>
                              )}
                              <span className={`text-xs ${
                                isSuccess ? 'text-green-400/70' : 'text-red-400/70'
                              }`}>
                                {isSuccess ? 'Success' : 'Failed'}
                              </span>
                              <div className="flex items-center gap-1.5 text-white/30 text-xs ml-auto">
                                <Clock className="w-3 h-3" />
                                <span>{formatTime(task.posted_at ? new Date(task.posted_at) : new Date(task.scheduled_for))}</span>
                              </div>
                              {twitterLink && isSuccess && (
                                <a
                                  href={twitterLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 rounded hover:bg-cyan-500/20 text-cyan-400/70 hover:text-cyan-400 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                  title="View on X"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            {task.content && (
                              <p className="text-white/50 text-xs mt-1 line-clamp-1 pl-7">
                                {task.content}
                              </p>
                            )}
                            {!isSuccess && task.error_message && (
                              <p className="text-red-400/70 text-xs mt-1 line-clamp-1 pl-7">
                                {task.error_message}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Connectivity Status Tab */}
              {activeTab === 'status' && (
                <div className="space-y-4">
                  <h3 className="text-white font-semibold mb-4">Connectivity Status</h3>
                  
                  {/* Twitter API Status */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Twitter className="w-5 h-5 text-[#1DA1F2]" />
                        <div>
                          <h4 className="text-white font-medium">Twitter API</h4>
                          <p className="text-white/50 text-xs">
                            Last checked: {formatTime(connectivityStatus.twitter.lastChecked)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {connectivityStatus.twitter.status === 'checking' && (
                          <Loader2 className="w-4 h-4 text-white/50 animate-spin" />
                        )}
                        {connectivityStatus.twitter.status === 'connected' && (
                          <CheckCircle2 className="w-5 h-5 text-green-400" />
                        )}
                        {connectivityStatus.twitter.status === 'disconnected' && (
                          <AlertCircle className="w-5 h-5 text-red-400" />
                        )}
                      </div>
                    </div>
                    {connectivityStatus.twitter.error && (
                      <p className="text-red-400 text-xs mt-2">{connectivityStatus.twitter.error}</p>
                    )}
                  </div>

                  {/* Agent Status */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Bot className="w-5 h-5 text-purple-400" />
                        <div>
                          <h4 className="text-white font-medium">Agent Status</h4>
                          <p className="text-white/50 text-xs">
                            {connectivityStatus.agent.enabled ? 'Agent Mode Enabled' : 'Agent Mode Disabled'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {connectivityStatus.agent.status === 'active' && (
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                            <span className="text-green-400 text-sm font-medium">Active</span>
                          </div>
                        )}
                        {connectivityStatus.agent.status === 'inactive' && (
                          <span className="text-white/50 text-sm">Inactive</span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <p className="text-white/50 text-xs mb-1">Pending Actions</p>
                        <p className="text-white font-semibold">{connectivityStatus.agent.pendingActions}</p>
                      </div>
                      <div>
                        <p className="text-white/50 text-xs mb-1">Last Run</p>
                        <p className="text-white font-semibold text-sm">
                          {formatTime(connectivityStatus.agent.lastRun)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* LLM Status */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Brain className="w-5 h-5 text-yellow-400" />
                        <div>
                          <h4 className="text-white font-medium">LLM Status</h4>
                          <p className="text-white/50 text-xs">
                            Last checked: {formatTime(connectivityStatus.llm.lastChecked)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {connectivityStatus.llm.status === 'checking' && (
                          <Loader2 className="w-4 h-4 text-white/50 animate-spin" />
                        )}
                        {connectivityStatus.llm.status === 'available' && (
                          <CheckCircle2 className="w-5 h-5 text-green-400" />
                        )}
                        {connectivityStatus.llm.status === 'unavailable' && (
                          <AlertCircle className="w-5 h-5 text-red-400" />
                        )}
                      </div>
                    </div>
                    {connectivityStatus.llm.error && (
                      <p className="text-red-400 text-xs mt-2">{connectivityStatus.llm.error}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="max-w-2xl mx-auto">
                  <div className="mb-6">
                    <h3 className="text-white font-semibold mb-2">Settings</h3>
                    <p className="text-white/50 text-sm">
                      Fine-tune how your agent expresses its personality.
                    </p>
                  </div>
                  
                  <div className="space-y-6">
                    {/* Emoji Mode Toggle */}
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="p-2 bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-lg border border-yellow-500/30 mt-0.5">
                            <Smile className="w-5 h-5 text-yellow-400" />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-white font-medium">Emoji Mode</h4>
                            <p className="text-white/50 text-xs">
                              Respond only in emojis (1-5 emojis max).
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleToggleEmojiMode(!emojiMode)}
                          disabled={isLoadingEmojiMode}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            emojiMode ? 'bg-yellow-500' : 'bg-white/10'
                          } ${isLoadingEmojiMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                              emojiMode ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Response Behavior Section */}
                    <div className="space-y-3">
                      <h4 className="text-white/70 text-sm font-medium flex items-center gap-2">
                        <MessageCircle className="w-4 h-4" />
                        Response Behavior
                      </h4>
                      
                      {/* Response Length */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h5 className="text-white text-sm font-medium">Response Length</h5>
                            <p className="text-white/40 text-xs">How verbose the responses are</p>
                          </div>
                          <span className="text-cyan-400 text-xs font-medium capitalize">
                            {advancedSettings.responseLengthPreference}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {(['terse', 'brief', 'normal', 'detailed'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() => handleUpdateAdvancedSetting('responseLengthPreference', opt)}
                              disabled={isLoadingSettings}
                              className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                                advancedSettings.responseLengthPreference === opt
                                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                  : 'bg-white/5 text-white/50 hover:bg-white/10 border border-transparent'
                              }`}
                            >
                              {opt.charAt(0).toUpperCase() + opt.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Tangents */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h5 className="text-white text-sm font-medium">Allow Tangents</h5>
                            <p className="text-white/40 text-xs">Brief off-topic asides that tie back</p>
                          </div>
                          <span className="text-purple-400 text-xs font-medium capitalize">
                            {advancedSettings.allowTangents}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {(['never', 'rarely', 'sometimes'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() => handleUpdateAdvancedSetting('allowTangents', opt)}
                              disabled={isLoadingSettings}
                              className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                                advancedSettings.allowTangents === opt
                                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                  : 'bg-white/5 text-white/50 hover:bg-white/10 border border-transparent'
                              }`}
                            >
                              {opt.charAt(0).toUpperCase() + opt.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Live Search Toggle */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between">
                          <div className="flex items-start gap-3">
                            <Zap className="w-4 h-4 text-green-400 mt-0.5" />
                            <div>
                              <h5 className="text-white text-sm font-medium">Live Search</h5>
                              <p className="text-white/40 text-xs">Auto-fetch current info for trending topics</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUpdateAdvancedSetting('enableLiveSearch', !advancedSettings.enableLiveSearch)}
                            disabled={isLoadingSettings}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              advancedSettings.enableLiveSearch ? 'bg-green-500' : 'bg-white/10'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                              advancedSettings.enableLiveSearch ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                      </div>

                    </div>

                    {/* Expression Intensity Section */}
                    <div className="space-y-3">
                      <h4 className="text-white/70 text-sm font-medium flex items-center gap-2">
                        <Sliders className="w-4 h-4" />
                        Expression Intensity
                      </h4>
                      <p className="text-white/30 text-xs -mt-1">
                        These tune how much of your character's traits come through.
                      </p>

                      {/* Emoji Intensity Slider */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-white text-sm font-medium">Emoji Usage</h5>
                          <span className="text-yellow-400 text-xs font-medium">{advancedSettings.emojiIntensity}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="10"
                          value={advancedSettings.emojiIntensity}
                          onChange={(e) => handleUpdateAdvancedSetting('emojiIntensity', parseInt(e.target.value))}
                          disabled={isLoadingSettings}
                          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                        />
                        <div className="flex justify-between text-white/30 text-xs mt-1">
                          <span>None</span>
                          <span>Heavy</span>
                        </div>
                      </div>

                      {/* Signature Phrases Slider */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-white text-sm font-medium">Signature Phrases</h5>
                          <span className="text-pink-400 text-xs font-medium">{advancedSettings.signaturePhraseFrequency}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="10"
                          value={advancedSettings.signaturePhraseFrequency}
                          onChange={(e) => handleUpdateAdvancedSetting('signaturePhraseFrequency', parseInt(e.target.value))}
                          disabled={isLoadingSettings}
                          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-pink-500"
                        />
                        <div className="flex justify-between text-white/30 text-xs mt-1">
                          <span>Rare</span>
                          <span>Frequent</span>
                        </div>
                      </div>

                      {/* Humor Slider */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-white text-sm font-medium">Humor Level</h5>
                          <span className="text-orange-400 text-xs font-medium">{advancedSettings.humorIntensity}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="10"
                          value={advancedSettings.humorIntensity}
                          onChange={(e) => handleUpdateAdvancedSetting('humorIntensity', parseInt(e.target.value))}
                          disabled={isLoadingSettings}
                          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-500"
                        />
                        <div className="flex justify-between text-white/30 text-xs mt-1">
                          <span>Serious</span>
                          <span>Playful</span>
                        </div>
                      </div>

                      {/* Opinion Strength */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h5 className="text-white text-sm font-medium">Opinion Strength</h5>
                            <p className="text-white/40 text-xs">How boldly opinions are expressed</p>
                          </div>
                          <span className="text-red-400 text-xs font-medium capitalize">
                            {advancedSettings.opinionStrength}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {(['soft', 'normal', 'strong'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() => handleUpdateAdvancedSetting('opinionStrength', opt)}
                              disabled={isLoadingSettings}
                              className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                                advancedSettings.opinionStrength === opt
                                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  : 'bg-white/5 text-white/50 hover:bg-white/10 border border-transparent'
                              }`}
                            >
                              {opt.charAt(0).toUpperCase() + opt.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Creativity Section */}
                    <div className="space-y-3">
                      <h4 className="text-white/70 text-sm font-medium flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Creativity
                      </h4>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h5 className="text-white text-sm font-medium">Creativity Level</h5>
                            <p className="text-white/40 text-xs">Response unpredictability</p>
                          </div>
                          <span className="text-blue-400 text-xs font-medium capitalize">
                            {advancedSettings.creativityLevel}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {(['consistent', 'balanced', 'creative'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() => handleUpdateAdvancedSetting('creativityLevel', opt)}
                              disabled={isLoadingSettings}
                              className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                                advancedSettings.creativityLevel === opt
                                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                  : 'bg-white/5 text-white/50 hover:bg-white/10 border border-transparent'
                              }`}
                            >
                              {opt.charAt(0).toUpperCase() + opt.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Anti-Slop & Diversity Section */}
                    <div className="space-y-3">
                      <h4 className="text-white/70 text-sm font-medium flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        Anti-Slop & Diversity
                      </h4>
                      <p className="text-white/30 text-xs -mt-1">
                        Controls to prevent generic AI-sounding responses.
                      </p>

                      {/* Anti-Slop Strictness Slider */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <h5 className="text-white text-sm font-medium">Anti-Slop Strictness</h5>
                            <p className="text-white/40 text-xs">How aggressively to avoid generic AI phrases</p>
                          </div>
                          <span className="text-green-400 text-xs font-medium">{advancedSettings.antiSlopStrictness}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={advancedSettings.antiSlopStrictness}
                          onChange={(e) => handleUpdateAdvancedSetting('antiSlopStrictness', parseInt(e.target.value))}
                          disabled={isLoadingSettings}
                          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-green-500"
                        />
                        <div className="flex justify-between text-white/30 text-xs mt-1">
                          <span>Relaxed</span>
                          <span>Strict</span>
                        </div>
                      </div>

                      {/* Opening Variety Slider */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <h5 className="text-white text-sm font-medium">Opening Variety</h5>
                            <p className="text-white/40 text-xs">How much to vary how replies start</p>
                          </div>
                          <span className="text-purple-400 text-xs font-medium">{advancedSettings.openingVariety}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={advancedSettings.openingVariety}
                          onChange={(e) => handleUpdateAdvancedSetting('openingVariety', parseInt(e.target.value))}
                          disabled={isLoadingSettings}
                          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                        <div className="flex justify-between text-white/30 text-xs mt-1">
                          <span>Same openers</span>
                          <span>Varied openers</span>
                        </div>
                      </div>
                    </div>

                    {isLoadingSettings && (
                      <div className="flex items-center justify-center gap-2 text-white/50 text-xs py-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Saving...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Send Report Tab */}
              {activeTab === 'report' && (
                <div className="max-w-2xl mx-auto">
                  <div className="mb-6">
                    <h3 className="text-white font-semibold mb-2">Send Bug Report or Feedback</h3>
                    <p className="text-white/50 text-sm">
                      Describe the issue or provide feedback. This feature will be enabled soon.
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-white/70 text-sm mb-2">
                        Report Details
                      </label>
                      <textarea
                        value={reportText}
                        onChange={(e) => setReportText(e.target.value)}
                        disabled
                        placeholder="Describe the bug or provide feedback... (Feature coming soon)"
                        className="w-full h-48 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
                      />
                    </div>

                    <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                      <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                      <p className="text-white/70 text-sm">
                        Report sending is currently disabled. This feature will be available in a future update.
                      </p>
                    </div>

                    <button
                      disabled
                      className="w-full px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-500 rounded-xl text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      <span>Send Report (Coming Soon)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

