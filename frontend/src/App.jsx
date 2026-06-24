/**
 * Ad Launcher - Frontend
 *
 * Created by Jason Akatiff
 * iSCALE.com | A4D.com
 * Telegram: @jasonakatiff
 * Email: jason@jasonakatiff.com
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { BrandProvider } from './context/BrandContext';
import { CampaignProvider } from './context/CampaignContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import Login from './pages/Login';

// Lazy-loaded pages — only downloaded when visited
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CreateAds = lazy(() => import('./pages/CreateAds'));
const ImageAds = lazy(() => import('./pages/ImageAds'));
const VideoAds = lazy(() => import('./pages/VideoAds'));
const Reporting = lazy(() => import('./pages/Reporting'));
const Brands = lazy(() => import('./pages/Brands'));
const Products = lazy(() => import('./pages/Products'));
const CustomerProfiles = lazy(() => import('./pages/CustomerProfiles'));
const FacebookCampaigns = lazy(() => import('./pages/FacebookCampaigns'));
const CreateCampaign = lazy(() => import('./pages/CreateCampaign'));
const GeneratedAds = lazy(() => import('./pages/GeneratedAds'));
const AdRemix = lazy(() => import('./pages/AdRemix'));
const Settings = lazy(() => import('./pages/Settings'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const Headlines = lazy(() => import('./pages/Headlines'));
const PromptsAndDocs = lazy(() => import('./pages/PromptsAndDocs'));
const Winners = lazy(() => import('./pages/Winners'));
const Conversions = lazy(() => import('./pages/Conversions'));
const Domains = lazy(() => import('./pages/Domains'));
const FacebookPages = lazy(() => import('./pages/FacebookPages'));
const TrafficArmor = lazy(() => import('./pages/TrafficArmor'));
const CommentFarm = lazy(() => import('./pages/CommentFarm'));
const GoogleAds = lazy(() => import('./pages/GoogleAds'));
const Optimizer = lazy(() => import('./pages/Optimizer'));

function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
      <AuthProvider>
        <BrandProvider>
          <CampaignProvider>
            <BrowserRouter>
              <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" /></div>}>
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<Login />} />

                {/* Protected routes */}
                <Route
                  path="/"
                  element={
                    <PrivateRoute>
                      <Layout />
                    </PrivateRoute>
                  }
                >
                  <Route index element={<Dashboard />} />
                  <Route path="build-creatives" element={<CreateAds />} />
                  <Route path="image-ads" element={<ImageAds />} />
                  <Route path="video-ads" element={<VideoAds />} />
                  <Route path="facebook-campaigns" element={<FacebookCampaigns />} />
                  <Route path="create-campaign" element={<CreateCampaign />} />
                  <Route path="optimizer" element={<Optimizer />} />
                  <Route path="generated-ads" element={<GeneratedAds />} />
                  <Route path="headlines" element={<Headlines />} />
                  <Route path="prompts" element={<PromptsAndDocs />} />
                  <Route path="brands" element={<Brands />} />
                  <Route path="products" element={<Products />} />
                  <Route path="profiles" element={<CustomerProfiles />} />
                  <Route path="winners" element={<Winners />} />
                  <Route path="comment-farm" element={<CommentFarm />} />
                  <Route path="ad-remix" element={<AdRemix />} />
                  <Route path="reporting" element={<Reporting />} />
                  <Route path="google-ads" element={<GoogleAds />} />
                  <Route path="conversions" element={<Conversions />} />
                  <Route path="domains" element={<Domains />} />
                  <Route path="fb-pages" element={<FacebookPages />} />
                  <Route path="traffic-armor" element={<TrafficArmor />} />
                  <Route path="settings" element={<Settings />} />
                  <Route
                    path="users"
                    element={
                      <PrivateRoute requiredRole="admin">
                        <UserManagement />
                      </PrivateRoute>
                    }
                  />
                </Route>
              </Routes>
              </Suspense>
            </BrowserRouter>
          </CampaignProvider>
        </BrandProvider>
      </AuthProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
