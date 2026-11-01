import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { DocsLayout } from './components/DocsLayout'
import { MarkdownDocumentPage } from './components/MarkdownDocumentPage'
import { markdownRoutes } from './markdown-manifest'
import SiteMetadata from '../../web/src/components/site-metadata'

const OverviewPage = lazy(() => import('./pages/OverviewPage').then(m => ({ default: m.OverviewPage })))
const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage').then(m => ({ default: m.ArchitecturePage })))
const GettingStartedPage = lazy(() => import('./pages/GettingStartedPage').then(m => ({ default: m.GettingStartedPage })))
const AuthenticationPage = lazy(() => import('./pages/AuthenticationPage').then(m => ({ default: m.AuthenticationPage })))
const LimitsPage = lazy(() => import('./pages/LimitsPage').then(m => ({ default: m.LimitsPage })))
const ApiCalendarsPage = lazy(() => import('./pages/ApiCalendarsPage').then(m => ({ default: m.ApiCalendarsPage })))
const ApiMeetingsPage = lazy(() => import('./pages/ApiMeetingsPage').then(m => ({ default: m.ApiMeetingsPage })))
const ApiAnnouncementsPage = lazy(() => import('./pages/ApiAnnouncementsPage').then(m => ({ default: m.ApiAnnouncementsPage })))
const ApiFeedbackPage = lazy(() => import('./pages/ApiFeedbackPage').then(m => ({ default: m.ApiFeedbackPage })))
const ApiDiscordPage = lazy(() => import('./pages/ApiDiscordPage').then(m => ({ default: m.ApiDiscordPage })))
const ApiMailboxPage = lazy(() => import('./pages/ApiMailboxPage').then(m => ({ default: m.ApiMailboxPage })))
const ApiCalendarSourcesPage = lazy(() => import('./pages/ApiCalendarSourcesPage').then(m => ({ default: m.ApiCalendarSourcesPage })))
const ExamplesPage = lazy(() => import('./pages/ExamplesPage').then(m => ({ default: m.ExamplesPage })))
const WorkshopsPage = lazy(() => import('./pages/WorkshopsPage').then(m => ({ default: m.WorkshopsPage })))
const ZoomIntegrationPage = lazy(() => import('./pages/ZoomIntegrationPage').then(m => ({ default: m.ZoomIntegrationPage })))
const ZoomReviewPage = lazy(() => import('./pages/ZoomReviewPage').then(m => ({ default: m.ZoomReviewPage })))
const CoordinationFrameworksPage = lazy(() => import('./pages/CoordinationFrameworksPage').then(m => ({ default: m.CoordinationFrameworksPage })))
const DesignCatalogPage = lazy(() => import('./pages/DesignCatalogPage').then(m => ({ default: m.DesignCatalogPage })))
const RiskFrameworkPage = lazy(() => import('./pages/RiskFrameworkPage').then(m => ({ default: m.RiskFrameworkPage })))
const RiskRegisterPage = lazy(() => import('./pages/RiskRegisterPage').then(m => ({ default: m.RiskRegisterPage })))
const MarketingPage = lazy(() => import('./pages/MarketingPage').then(m => ({ default: m.MarketingPage })))
const SectionLandingPage = lazy(() => import('./pages/SectionLandingPage').then(m => ({ default: m.SectionLandingPage })))

export default function App() {
  return (
    <>
    <SiteMetadata docs />
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <Routes>
        <Route element={<DocsLayout />}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/section/:sectionId" element={<SectionLandingPage />} />
          <Route path="/architecture" element={<ArchitecturePage />} />
          <Route path="/getting-started" element={<GettingStartedPage />} />
          <Route path="/authentication" element={<AuthenticationPage />} />
          <Route path="/limits" element={<LimitsPage />} />
          <Route path="/api/calendars" element={<ApiCalendarsPage />} />
          <Route path="/api/calendar-sources" element={<ApiCalendarSourcesPage />} />
          <Route path="/api/meetings" element={<ApiMeetingsPage />} />
          <Route path="/api/announcements" element={<ApiAnnouncementsPage />} />
          <Route path="/api/feedback" element={<ApiFeedbackPage />} />
          <Route path="/api/discord" element={<ApiDiscordPage />} />
          <Route path="/api/mailbox" element={<ApiMailboxPage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="/workshops" element={<WorkshopsPage />} />
          <Route path="/zoom" element={<ZoomIntegrationPage />} />
          <Route path="/zoom-review" element={<ZoomReviewPage />} />
          <Route path="/coordination-frameworks" element={<CoordinationFrameworksPage />} />
          <Route path="/design/catalog" element={<DesignCatalogPage />} />
          <Route path="/risk/framework" element={<RiskFrameworkPage />} />
          <Route path="/risk/register" element={<RiskRegisterPage />} />
          <Route path="/marketing" element={<MarketingPage />} />
          {markdownRoutes.map(route => (
            <Route
              key={route.path}
              path={route.path}
              element={<MarkdownDocumentPage markdown={route.markdown} />}
            />
          ))}
        </Route>
      </Routes>
    </Suspense>
    </>
  )
}
