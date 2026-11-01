import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import HomeRoute from './components/HomeRoute'
import SiteMetadata from './components/site-metadata'
import { useAuth } from './contexts/AuthContext'
import { isSetupAccessible } from './lib/setup-api'

// Lazy-loaded pages for code-splitting
const HomePage = lazy(() => import('./pages/HomePage'))
const EventsPage = lazy(() => import('./pages/EventsPage'))
const EventsCalendarPage = lazy(() => import('./pages/EventsCalendarPage'))
const CoordinateEventsPage = lazy(() => import('./pages/CoordinateEventsPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const TimeManagementPage = lazy(() => import('./pages/TimeManagementPage.tsx'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'))
const AiFeedbackPage = lazy(() => import('./pages/AiFeedbackPage'))
const AiChatPage = lazy(() => import('./pages/AiChatPage'))
const UserListPage = lazy(() => import('./pages/UserListPage'))
const PlatformOversightPage = lazy(() => import('./pages/PlatformOversightPage'))
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'))
const GuardianPage = lazy(() => import('./pages/GuardianPage'))
const PolicyPage = lazy(() => import('./pages/PolicyPage'))
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'))
const TrademarkPolicyPage = lazy(() => import('./pages/TrademarkPolicyPage'))
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const GuestBookingPage = lazy(() => import('./pages/GuestBookingPage'))
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'))
const EmailAbusePage = lazy(() => import('./pages/EmailAbusePage'))
const MeetingPage = lazy(() => import('./pages/MeetingPage'))
const ZoomReviewPage = lazy(() => import('./pages/ZoomReviewPage'))
const VideoMeetingProposalPage = lazy(() => import('./pages/VideoMeetingProposalPage'))
const DataPrivacyProposalPage = lazy(() => import('./pages/DataPrivacyProposalPage'))
const SupportPage = lazy(() => import('./pages/SupportPage'))
const MailboxPage = lazy(() => import('./pages/MailboxPage'))
const LoginPage = lazy(() => import('./pages/auth/LoginPage'))
const AuthCallbackPage = lazy(() => import('./pages/auth/AuthCallbackPage'))
const NetworkRelationsPage = lazy(() => import('./pages/NetworkRelationsPage'))
const SetupPage = lazy(() => import('./pages/SetupPage'))

function App() {
  const { user } = useAuth()
  return (
    <>
    <SiteMetadata />
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
    <Routes>
      {/* Auth routes (no layout) */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      
      {/* Guest booking — distraction-free participant flow (no layout) */}
      <Route path="/join/invite/:code" element={<AcceptInvitePage />} />
      <Route path="/join/:hash" element={<GuestBookingPage />} />
      
      {/* Public routes - accessible without authentication */}
      <Route path="/" element={<Layout key={user?.id ?? 'anon'} />}>
        <Route index element={<HomeRoute><HomePage /></HomeRoute>} />
        {/* Setup wizard -- localhost / dev only. Hidden entirely on the
            public production deployment so we never expose the wizard to
            end users on coordinationmanager.com. */}
        {isSetupAccessible() && (
          <Route path="setup" element={<SetupPage />} />
        )}
        <Route path="calendars" element={<EventsPage />} />
        <Route path="events" element={<Navigate to="/calendars" replace />} />
        <Route path="events-calendar" element={<EventsCalendarPage />} />
        <Route path="time-management" element={<TimeManagementPage />} />
        <Route path="calendar" element={<CalendarPage key="create" />} />
        <Route path="calendar/:hash" element={<CalendarPage key="view" />} />
        <Route path="meeting/:meetingId" element={<MeetingPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
          <Route path="settings" element={<SettingsPage />} />
          <Route path="coordinate-events" element={<CoordinateEventsPage />} />
          <Route path="mailbox" element={<MailboxPage />} />
          <Route path="distribute" element={<AnnouncementsPage />} />
          <Route path="announcements" element={<Navigate to="/distribute" replace />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="ai-feedback" element={<AiFeedbackPage />} />
          <Route path="ai-chat" element={<AiChatPage />} />
          <Route path="admin/users" element={<UserListPage />} />
          <Route path="admin/oversight" element={<PlatformOversightPage />} />
          <Route path="admin/network-relations" element={<NetworkRelationsPage />} />
          <Route path="user-management" element={<UserManagementPage />} />
          <Route path="guardian" element={<GuardianPage />} />
        </Route>
      </Route>

      {/* Legal pages (no layout/nav — standalone) */}
      <Route path="/policy" element={<PolicyPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/trademark" element={<TrademarkPolicyPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />
      <Route path="/email-abuse" element={<EmailAbusePage />} />
      <Route path="/zoom-review" element={<ZoomReviewPage />} />

      {/* Proposals (no layout/nav — standalone, shared with users + sponsors) */}
      <Route path="/proposals/video-meeting" element={<VideoMeetingProposalPage />} />
      <Route path="/proposals/data-privacy" element={<DataPrivacyProposalPage />} />
      
      {/* 404 catch-all */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
    </>
  )
}

export default App
