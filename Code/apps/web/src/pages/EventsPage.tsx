import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { apiClient } from '../lib/api-client';
import { isAdminMfaRequiredError } from '../lib/admin-mfa';
import { OVERLAY_LAYER_CLASS } from '../lib/overlay-layers';
import { Link, useLocation } from 'react-router-dom';
import { getPrimaryTimezone, formatDateInTimezone } from '../lib/timezone-data';
import LearnerHelpIcon from '../components/LearnerHelpIcon';
import { useLearnerMode } from '../contexts/LearnerModeContext';
import { Plus, Trash2, Lock, Globe, CalendarDays, User, Search, X, ChevronDown, ShieldAlert, Copy, Repeat2, Star, Loader2, Archive } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isAnyWeekCalendar, isCalendarArchived } from '../lib/calendar-listing';
import { Button, Disclosure, IconButton } from '../components/ui';

type CalendarConfig = {
  customStartDate?: string;
  customEndDate?: string;
  hideDateNumbers?: boolean;
  [key: string]: unknown;
};

type Calendar = {
  id: string;
  hash: string;
  title: string;
  config?: CalendarConfig;
  permissions?: Record<string, unknown>;
  created_by?: string;
  creator_display_name?: string;
  visibility?: string;
  created_at?: string;
  archived_at?: string | null;
  has_recurring_meetings?: boolean;
};

type Subscription = {
  id: string;
  calendar_id: string;
  created_at: string;
  calendars: {
    id: string;
    hash: string;
    title: string;
    visibility: string;
  };
};

// Read a boolean from localStorage, defaulting to true (sections visible by default)
function useCollapsedState(key: string, defaultCollapsed = false): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsedRaw] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? stored === 'true' : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedRaw(v);
    try { localStorage.setItem(key, String(v)); } catch { /* ignore */ }
  }, [key]);
  return [collapsed, setCollapsed];
}

function SkeletonCard() {
  return (
    <div className="border border-border rounded-lg p-4 shadow-sm animate-pulse">
      <div className="h-6 bg-muted rounded w-3/4 mb-3" />
      <div className="flex flex-col gap-2 mt-1">
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="h-4 bg-muted rounded w-2/3" />
        <div className="h-5 bg-muted rounded-full w-16 mt-1" />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export default function EventsPage() {
  const location = useLocation();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [subscribedCalendarIds, setSubscribedCalendarIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Calendar | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const deletePopoverRef = useRef<HTMLDivElement>(null);
  const { user, session, isAuthenticated, isLoading: authLoading } = useAuth();
  const { learnerMode } = useLearnerMode();

  // Close delete popover when clicking outside
  useEffect(() => {
    if (!deleteConfirm) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (deletePopoverRef.current && !deletePopoverRef.current.contains(e.target as Node)) {
        setDeleteConfirm(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [deleteConfirm]);

  // Collapsible section states — persisted in localStorage
  const [yourSectionCollapsed, setYourSectionCollapsed] = useCollapsedState('events-your-collapsed');
  const [publicSectionCollapsed, setPublicSectionCollapsed] = useCollapsedState('events-public-collapsed');
  const [yourPastCollapsed, setYourPastCollapsed] = useCollapsedState('events-your-past-collapsed', true);
  const [publicPastCollapsed, setPublicPastCollapsed] = useCollapsedState('events-public-past-collapsed', true);
  const [learnerGuideCollapsed, setLearnerGuideCollapsed] = useCollapsedState('events-learner-guide-collapsed');

  // If the user came from an individual calendar page via top nav,
  // open key sections so available events are immediately visible.
  useEffect(() => {
    const state = location.state as { fromCalendarView?: boolean } | null;
    if (!state?.fromCalendarView) return;
    setYourSectionCollapsed(false);
    setPublicSectionCollapsed(false);
  }, [location.state, setPublicSectionCollapsed, setYourSectionCollapsed]);

  // Admin powers — read from localStorage
  const isAdmin = user?.roles?.includes('admin');
  const [adminDeletePower, setAdminDeletePower] = useState(false);
  const [adminBlockPower, setAdminBlockPower] = useState(false);
  useEffect(() => {
    if (isAdmin) {
      try {
        const stored = localStorage.getItem('adminPowers');
        if (stored) {
          const parsed = JSON.parse(stored);
          setAdminDeletePower(!!parsed.deletePower);
          setAdminBlockPower(!!parsed.blockPower);
        }
      } catch { /* ignore */ }
    }
  }, [isAdmin]);

  // Listen for localStorage changes (when toggled in Settings)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'adminPowers' && isAdmin) {
        try {
          const parsed = JSON.parse(e.newValue || '{}');
          setAdminDeletePower(!!parsed.deletePower);
          setAdminBlockPower(!!parsed.blockPower);
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [isAdmin]);

  // Prevent duplicate concurrent fetches
  const fetchingRef = useRef(false);
  const lastFetchKeyRef = useRef<string>('');

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>(''); // '' = all, 'YYYY-MM' format

  const getDateRange = (calendar: Calendar): string | null => {
    const start = calendar.config?.customStartDate;
    const end = calendar.config?.customEndDate;
    if (!start || !end) return null;
    const fmt = (d: string) => {
      return formatDateInTimezone(d + 'T00:00:00', getPrimaryTimezone());
    };
    return `${fmt(start)} – ${fmt(end)}`;
  };

  const getCreatorDisplayName = (calendar: Calendar): string | null => {
    // Prefer the resolved public display name from the API
    if (calendar.creator_display_name) return calendar.creator_display_name;
    const id = calendar.created_by;
    if (!id) return null;
    // Hide real emails but allow wallet/traveler pseudo-emails to show a fallback
    if (id.includes('@')) {
      if (id.endsWith('@cardano.wallet')) {
        const walletId = id.replace('@cardano.wallet', '').replace(/^wallet-/, '');
        return walletId.length > 14 ? `${walletId.slice(0, 8)}...${walletId.slice(-6)}` : walletId;
      }
      if (id.endsWith('@traveler.local')) {
        return id.replace('@traveler.local', '').replace(/^traveler-/, '');
      }
      return null; // hide real emails
    }
    return id;
  };

  const fetchCalendars = useCallback(() => {
    // Don't fetch while auth is still resolving
    if (authLoading) return;

    const userIdentity = user?.email || user?.id || user?.travelerName;
    const fetchKey = `${isAuthenticated}:${userIdentity || ''}`;

    // Skip if already fetching or if the auth state hasn't meaningfully changed
    if (fetchingRef.current || fetchKey === lastFetchKeyRef.current) {
      if (!fetchingRef.current) setLoading(false);
      return;
    }

    fetchingRef.current = true;
    lastFetchKeyRef.current = fetchKey;
    setLoading(true);

    const params = isAuthenticated && userIdentity ? { include_own: userIdentity } : {};
    const calendarsPromise = apiClient.get('/api/calendars', { params });

    // Also fetch subscriptions if authenticated
    const subsPromise = isAuthenticated
      ? apiClient.get('/api/calendar-subscriptions').catch(() => ({ data: { subscriptions: [] } }))
      : Promise.resolve({ data: { subscriptions: [] } });

    Promise.all([calendarsPromise, subsPromise])
      .then(([calRes, subRes]) => {
        setCalendars(calRes.data);
        const subs: Subscription[] = subRes.data.subscriptions || subRes.data || [];
        const subIds = new Set(subs.map(s => s.calendar_id));
        setSubscribedCalendarIds(subIds);
      })
      .catch(err => setError(err.message))
      .finally(() => {
        setLoading(false);
        fetchingRef.current = false;
      });
  }, [authLoading, isAuthenticated, user?.email, user?.id, user?.travelerName]);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  const isOwner = (calendar: Calendar) => {
    if (!isAuthenticated || !user) return false;
    const createdBy = calendar.created_by;
    if (!createdBy) return false;
    // Check all known identity formats — session.user.email covers
    // traveler accounts where created_by is the Supabase auth email
    // (e.g. traveler-{uuid}@guest.local) which isn't exposed via user.email
    return createdBy === user.email
      || createdBy === user.id
      || createdBy === user.travelerName
      || (session?.user?.email != null && createdBy === session.user.email);
  };

  const handleToggleSubscription = async (calendar: Calendar) => {
    if (!isAuthenticated) return;
    setSubscribingId(calendar.id);
    try {
      if (subscribedCalendarIds.has(calendar.id)) {
        await apiClient.delete(`/api/calendar-subscriptions/${calendar.hash}`);
        setSubscribedCalendarIds(prev => {
          const next = new Set(prev);
          next.delete(calendar.id);
          return next;
        });
      } else {
        await apiClient.post('/api/calendar-subscriptions', { calendar_hash: calendar.hash });
        setSubscribedCalendarIds(prev => new Set([...prev, calendar.id]));
      }
    } catch (err) {
      console.error('Failed to toggle subscription', err);
    } finally {
      setSubscribingId(null);
    }
  };

  const handleDelete = async (calendar: Calendar) => {
    setIsDeleting(true);
    try {
      if (adminDeletePower && !isOwner(calendar)) {
        // Admin force-delete via admin API
        if (!session?.access_token) throw new Error('Not authenticated');
        await apiClient.delete(`/api/admin/calendars/${calendar.hash}`);
      } else {
        await apiClient.delete(`/api/calendars/${calendar.hash}`);
      }
      setCalendars(prev => prev.filter(c => c.id !== calendar.id));
      setDeleteConfirm(null);
    } catch (err) {
      if (isAdminMfaRequiredError(err)) {
        alert('Admin MFA verification is required before force-deleting calendars. Open the admin user list or oversight page to verify this session, then retry.')
        return
      }
      alert((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to delete calendar');
    } finally {
      setIsDeleting(false);
    }
  };

  // A calendar is "recurring" if it uses general weekly availability (hideDateNumbers)
  // or has recurring meetings in the database
  const isRecurring = (calendar: Calendar): boolean => isAnyWeekCalendar(calendar);

  // Determine if a calendar is "archived": either auto-archived by the listing
  // rules (any-week calendars with no upcoming meeting) or past its end date
  const isArchived = (calendar: Calendar): boolean => isCalendarArchived(calendar);

  // Get the "sort date" for a calendar — prefer the end date of the calendar range, fall back to created_at
  const getSortDate = (calendar: Calendar): number => {
    const end = calendar.config?.customEndDate;
    if (end) return new Date(end + 'T23:59:59').getTime();
    if (calendar.created_at) return new Date(calendar.created_at).getTime();
    return 0;
  };

  // Collect unique months from all calendars for the filter dropdown
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    for (const cal of calendars) {
      const start = cal.config?.customStartDate;
      const end = cal.config?.customEndDate;
      const created = cal.created_at;
      // Add months covered by the calendar range
      if (start) months.add(start.substring(0, 7));
      if (end) months.add(end.substring(0, 7));
      if (created) months.add(created.substring(0, 7));
    }
    return [...months].sort().reverse(); // newest first
  }, [calendars]);

  const formatMonth = (ym: string) => {
    const [y, m] = ym.split('-');
    const date = new Date(parseInt(y), parseInt(m) - 1);
    const tz = getPrimaryTimezone();
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' }).format(date);
  };

  // Search: match against title, creator display name, creator ID, or hash — split query into words and match all
  const matchesSearch = (calendar: Calendar, query: string): boolean => {
    if (!query.trim()) return true;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const searchable = [
      calendar.title,
      calendar.creator_display_name,
      calendar.created_by,
      calendar.hash,
    ].filter(Boolean).join(' ').toLowerCase();
    return words.every(word => searchable.includes(word));
  };

  // Month filter: calendar overlaps the selected month
  const matchesMonth = (calendar: Calendar, ym: string): boolean => {
    if (!ym) return true;
    const [fy, fm] = ym.split('-').map(Number);
    const filterStart = new Date(fy, fm - 1, 1);
    const filterEnd = new Date(fy, fm, 0, 23, 59, 59); // last day of month

    const start = calendar.config?.customStartDate;
    const end = calendar.config?.customEndDate;

    if (start && end) {
      const calStart = new Date(start + 'T00:00:00');
      const calEnd = new Date(end + 'T23:59:59');
      // Overlap check
      return calStart <= filterEnd && calEnd >= filterStart;
    }
    // Fall back to created_at month
    if (calendar.created_at) {
      return calendar.created_at.startsWith(ym);
    }
    return true;
  };

  // Apply all filters, partition into your/subscribed vs public, each with active vs past
  const { yourActive, yourPast, publicActive, publicPast } = useMemo(() => {
    const filtered = calendars
      .filter(cal => matchesSearch(cal, searchQuery))
      .filter(cal => matchesMonth(cal, selectedMonth));

    const yActive: Calendar[] = [];
    const yPast: Calendar[] = [];
    const pActive: Calendar[] = [];
    const pPast: Calendar[] = [];

    for (const cal of filtered) {
      const isYours = isOwner(cal) || subscribedCalendarIds.has(cal.id);
      const past = isArchived(cal);

      // Always place owned/subscribed calendars in the Subscribed or Your Coordination Calendars section
      if (isYours) {
        if (past) yPast.push(cal);
        else yActive.push(cal);
      }

      // Public calendars always appear in the Public Coordination Calendars section too
      // (even when already subscribed, so they show in both sections)
      if (cal.visibility === 'public' || !isYours) {
        if (past) pPast.push(cal);
        else pActive.push(cal);
      }
    }

    // Sort newest first
    const sortDesc = (a: Calendar, b: Calendar) => getSortDate(b) - getSortDate(a);
    yActive.sort(sortDesc);
    yPast.sort(sortDesc);
    pActive.sort(sortDesc);
    pPast.sort(sortDesc);

    return { yourActive: yActive, yourPast: yPast, publicActive: pActive, publicPast: pPast };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isOwner/isArchived are pure helpers over the listed reactive inputs and stable auth context
  }, [calendars, searchQuery, selectedMonth, subscribedCalendarIds]);

  const renderCalendarCard = (calendar: Calendar, index: number, opts?: { showSubscribeButton?: boolean }) => {
    const archived = isArchived(calendar);
    const statusCardClass = archived
      ? 'border-border bg-muted/40 opacity-75 hover:opacity-100 hover:bg-accent/50'
      : 'border-border bg-card hover:bg-accent/50';
    return (
    <div
      key={`${calendar.id}-${opts?.showSubscribeButton ? 'public' : 'subscribed'}`}
      className={`relative border rounded-lg p-4 shadow-sm transition-all duration-300 ease-out animate-in fade-in slide-in-from-bottom-2 ${statusCardClass}`}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
    >
      <div className="absolute top-3 right-3 z-10 flex flex-col items-center gap-0.5">
        <LearnerHelpIcon
          description={<><p className="font-semibold text-info mb-1">Coordination Calendar</p><p className="mb-1.5">This card represents a single event-planning calendar. Open it to see who has signed up and which time slots work best.</p><p><strong>Tip:</strong> Share the calendar link with participants so they can mark their available times.</p></>}
          size={4}
        />
        {(isOwner(calendar) || adminDeletePower) && (
          <>
            <IconButton
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDeleteConfirm(deleteConfirm?.id === calendar.id ? null : calendar);
              }}
              intent={!isOwner(calendar) && adminDeletePower ? 'danger' : 'neutral'}
              label={!isOwner(calendar) ? 'Admin delete calendar' : 'Delete calendar'}
              title={!isOwner(calendar) ? 'Admin: Delete calendar' : 'Delete calendar'}
              icon={!isOwner(calendar) && adminDeletePower ? (
                <ShieldAlert className="w-4 h-4" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            />
            {deleteConfirm?.id === calendar.id && (
              <div
                ref={deletePopoverRef}
                onClick={(e) => e.stopPropagation()}
                className={`absolute right-0 top-full mt-1 w-64 bg-card text-card-foreground rounded-lg p-4 shadow-xl border border-border ${OVERLAY_LAYER_CLASS.popover}`}
              >
                <p className="text-sm text-muted-foreground mb-3">
                  Delete <strong>"{calendar.title}"</strong>? This cannot be undone.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button
                    emphasis="ghost"
                    size="compact"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteConfirm(null); }}
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    intent="danger"
                    size="compact"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(calendar); }}
                    disabled={isDeleting}
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <Link
        to={`/calendar/${calendar.hash}`}
        className="block"
      >
        <h2 className="text-xl font-semibold mb-2 pr-8">{calendar.title}</h2>
        <div className="flex flex-col gap-1.5 mt-1">
          {getCreatorDisplayName(calendar) && (
            adminBlockPower && calendar.created_by ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigator.clipboard.writeText(calendar.created_by!);
                  setCopiedUserId(calendar.created_by!);
                  setTimeout(() => setCopiedUserId(null), 2000);
                }}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
                title={`Click to copy user ID: ${calendar.created_by}`}
              >
                <User className="w-3.5 h-3.5" />
                <span className="underline decoration-dotted group-hover:decoration-solid">{getCreatorDisplayName(calendar)}</span>
                {copiedUserId === calendar.created_by ? (
                  <span className="text-xs text-success">Copied!</span>
                ) : (
                  <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                {getCreatorDisplayName(calendar)}
              </p>
            )
          )}
          {getDateRange(calendar) && (
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5" />
              {getDateRange(calendar)}
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {calendar.visibility === 'unlisted' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-warning bg-warning-subtle border border-warning-muted px-2 py-0.5 rounded-full">
                <Lock className="w-3 h-3" />
                Unlisted
              </span>
            )}
            {calendar.visibility === 'public' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success bg-success-subtle border border-success-muted px-2 py-0.5 rounded-full">
                <Globe className="w-3 h-3" />
                Public
              </span>
            )}
            {isRecurring(calendar) && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-info bg-info-subtle border border-info-muted px-2 py-0.5 rounded-full">
                <Repeat2 className="w-3 h-3" />
                Recurring
              </span>
            )}
            {archived && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full"
                title="Archived -- past its date range or with no meeting planned in the listing window"
              >
                <Archive className="w-3 h-3" />
                Archived
              </span>
            )}
            {isAuthenticated && (
              <Button
                emphasis="outline"
                size="compact"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleSubscription(calendar); }}
                disabled={subscribingId === calendar.id}
                className="ml-auto"
                aria-label={subscribedCalendarIds.has(calendar.id) ? 'Unsubscribe from calendar' : 'Subscribe to calendar'}
                title={subscribedCalendarIds.has(calendar.id) ? 'Unsubscribe -- stop receiving updates' : 'Subscribe -- keep meetings in sync'}
                icon={subscribingId === calendar.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Star className={`w-3 h-3 ${subscribedCalendarIds.has(calendar.id) ? 'fill-current text-warning' : ''}`} />
                )}
              >
                {subscribingId === calendar.id ? 'Saving...' : subscribedCalendarIds.has(calendar.id) ? 'Subscribed' : 'Subscribe'}
              </Button>
            )}
          </div>
        </div>
      </Link>
    </div>
    );
  };

  const totalFiltered = yourActive.length + yourPast.length + publicActive.length + publicPast.length;
  const yourTotal = yourActive.length + yourPast.length;
  const publicTotal = publicActive.length + publicPast.length;
  const hasActiveFilters = searchQuery || selectedMonth;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Coordination Calendars</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Browse and manage Coordination Calendars -- shared scheduling tools used to find the best meeting times for a group. Subscribe to calendars you want to track.
      </p>
      {learnerMode && (
        <div className="mb-6 rounded-xl border border-info-muted/60 bg-info-subtle text-foreground text-sm leading-relaxed">
          <Disclosure
            className="p-1"
            title="Learner Guide"
            expanded={!learnerGuideCollapsed}
            onToggle={(next) => setLearnerGuideCollapsed(!next)}
            panelId="events-learner-guide"
          />
          {!learnerGuideCollapsed && (
            <div id="events-learner-guide" className="px-4 pb-3">
              <p className="font-semibold text-info mb-1.5">What is this page?</p>
              <p className="mb-2">
                This page lists all Coordination Calendars -- tools used to plan meeting times for events and
                group activities. Each card represents one calendar where participants mark their available time slots
                so the best meeting time can be identified.
              </p>
              <p className="font-semibold text-info mb-1.5">How to navigate</p>
              <ul className="list-disc list-inside space-y-1 mb-2">
                <li>Use the <strong>search bar</strong> to find calendars by name, creator, or ID.</li>
                <li>Filter by <strong>month</strong> to narrow down active or past calendars.</li>
                <li>Click any card to open a calendar and mark your available times.</li>
                <li>Use the <strong>Subscribe</strong> button to track a calendar -- subscribed calendars sync meeting times into your personal event view.</li>
              </ul>
              <p>
                Calendars you own or subscribe to appear under <strong>"Subscribed or Your Coordination Calendars"</strong>.
                All public calendars are also listed under <strong>"Public Coordination Calendars"</strong> -- if you subscribe to one it appears in both sections.
              </p>
              <p className="font-semibold text-info mt-2 mb-1.5">When calendars are archived</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Calendars with a date range are archived once that end date has passed.</li>
                <li>Any-week calendars (general weekday availability) stay active for 2 weeks after creation, then for 2 weeks after the last planned meeting.</li>
                <li>With no meeting planned in that window they are archived automatically and drop off the home page, but stay listed here under the past sections.</li>
                <li>Planning a new meeting re-activates an archived calendar.</li>
                <li>Owners can also archive an any-week calendar with the <strong>Archive</strong> option in Edit Calendar. It keeps its participation and stays reachable by link or subscription, but is listed under the archived sections.</li>
              </ul>
            </div>
          )}
        </div>
      )}
      {loading && <SkeletonGrid />}
      {error && <p className="text-danger">{error}</p>}
      
      {!loading && !error && calendars.length === 0 && (
        <div>
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Link
              to="/calendar"
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2.5 rounded-lg font-medium transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
              Create New Calendar
            </Link>
          </div>

          {/* -- Subscribed or Your Coordination Calendars (empty state) -- */}
          <div className="mb-8">
            <Disclosure
              className="mb-3"
              size="section"
              headingLevel={2}
              title={<>Subscribed or Your Coordination Calendars <span className="text-sm font-normal text-muted-foreground">(0)</span></>}
              expanded={!yourSectionCollapsed}
              onToggle={(next) => setYourSectionCollapsed(!next)}
              panelId="events-your-section-empty"
            />
            {!yourSectionCollapsed && (
              <p id="events-your-section-empty" className="text-sm text-muted-foreground py-4 pl-1">
                {isAuthenticated
                  ? 'No calendars yet. Create one or subscribe to a public calendar to see it here.'
                  : 'Sign in to see your own and subscribed calendars here.'}
              </p>
            )}
          </div>

          {/* -- Public Coordination Calendars (empty state) -- */}
          <div className="mb-8">
            <Disclosure
              className="mb-3"
              size="section"
              headingLevel={2}
              title={<>Public Coordination Calendars <span className="text-sm font-normal text-muted-foreground">(0)</span></>}
              expanded={!publicSectionCollapsed}
              onToggle={(next) => setPublicSectionCollapsed(!next)}
              panelId="events-public-section-empty"
            />
            {!publicSectionCollapsed && (
              <p id="events-public-section-empty" className="text-sm text-muted-foreground py-4 pl-1">No public calendars available right now.</p>
            )}
          </div>
        </div>
      )}
      
      {!loading && !error && calendars.length > 0 && (
        <div>
          {/* Toolbar: Create + Search + Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Link
              to="/calendar"
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2.5 rounded-lg font-medium transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
              Create New Calendar
            </Link>

            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                name="eventsSearch"
                aria-label="Search events"
                placeholder="Search by name, creator, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 border border-border rounded-lg bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/50"
              />
              {searchQuery && (
                <IconButton
                  label="Clear search"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  icon={<X className="w-4 h-4" />}
                />
              )}
            </div>

            {/* Month/Year Filter */}
            {availableMonths.length > 0 && (
              <div className="relative shrink-0">
                <select
                  name="eventsMonthFilter"
                  aria-label="Filter events by month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 border border-border rounded-lg bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/50 cursor-pointer"
                >
                  <option value="">All time</option>
                  {availableMonths.map(ym => (
                    <option key={ym} value={ym}>{formatMonth(ym)}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
            )}
          </div>

          {/* Active filters summary */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <span>Showing {totalFiltered} of {calendars.length} calendars</span>
              <button
                onClick={() => { setSearchQuery(''); setSelectedMonth(''); }}
                className="text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* No results */}
          {totalFiltered === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No calendars match your search.</p>
            </div>
          )}

          {/* -- Subscribed or Your Coordination Calendars -- */}
          <div className="mb-8">
            <Disclosure
              className="mb-3"
              size="section"
              headingLevel={2}
              title={<>Subscribed or Your Coordination Calendars <span className="text-sm font-normal text-muted-foreground">({yourTotal})</span></>}
              expanded={!yourSectionCollapsed}
              onToggle={(next) => setYourSectionCollapsed(!next)}
              panelId="events-your-section"
            />
            {!yourSectionCollapsed && (
              <div id="events-your-section">
                {!isAuthenticated && (
                  <p className="text-sm text-muted-foreground py-4 pl-1">Sign in to see your own and subscribed calendars here.</p>
                )}
                {isAuthenticated && yourActive.length === 0 && yourPast.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 pl-1">No calendars yet. Create one or subscribe to a public calendar to see it here.</p>
                )}
                {yourActive.length > 0 && (
                  <div className="mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {yourActive.map((cal, i) => renderCalendarCard(cal, i))}
                    </div>
                  </div>
                )}
                {yourPast.length > 0 && (
                  <div className="mt-4">
                    <Disclosure
                      className="mb-3"
                      headingLevel={3}
                      title={`Archived Calendars (${yourPast.length})`}
                      expanded={!yourPastCollapsed}
                      onToggle={(next) => setYourPastCollapsed(!next)}
                      panelId="events-your-archived"
                    />
                    {!yourPastCollapsed && (
                      <div id="events-your-archived" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {yourPast.map((cal, i) => renderCalendarCard(cal, i))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* -- Public Coordination Calendars -- */}
          <div className="mb-8">
            <Disclosure
              className="mb-3"
              size="section"
              headingLevel={2}
              title={<>Public Coordination Calendars <span className="text-sm font-normal text-muted-foreground">({publicTotal})</span></>}
              expanded={!publicSectionCollapsed}
              onToggle={(next) => setPublicSectionCollapsed(!next)}
              panelId="events-public-section"
            />
            {!publicSectionCollapsed && (
              <div id="events-public-section">
                {publicActive.length === 0 && publicPast.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 pl-1">No public calendars available right now.</p>
                )}
                {publicActive.length > 0 && (
                  <div className="mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {publicActive.map((cal, i) => renderCalendarCard(cal, i, { showSubscribeButton: true }))}
                    </div>
                  </div>
                )}
                {publicPast.length > 0 && (
                  <div className="mt-4">
                    <Disclosure
                      className="mb-3"
                      headingLevel={3}
                      title={`Archived Calendars (${publicPast.length})`}
                      expanded={!publicPastCollapsed}
                      onToggle={(next) => setPublicPastCollapsed(!next)}
                      panelId="events-public-archived"
                    />
                    {!publicPastCollapsed && (
                      <div id="events-public-archived" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {publicPast.map((cal, i) => renderCalendarCard(cal, i, { showSubscribeButton: true }))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  );
}
