import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BleProvider } from './contexts/BleContext';
import { WaterProvider } from './contexts/WaterContext';
import { DeviceProvider } from './contexts/DeviceContext';
import { ActiveTab, Navbar } from './components/Navbar';
import { Toast } from './components/Toast';
import { AuthView } from './views/AuthView';
import { DashboardView } from './views/DashboardView';
import { DeviceCenterView } from './views/DeviceCenterView';
import { HistoryView } from './views/HistoryView';
import { StatsView } from './views/StatsView';
import { SettingsView } from './views/SettingsView';
import './App.css';

const MainLayout: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur));
    }, 3500);
  };

  const handleOpenQuickDrink = () => {
    setActiveTab('dashboard');
    window.setTimeout(() => {
      document
        .getElementById('quick-drink')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>載入中...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <AuthView showToast={showToast} />
        <Toast
          message={toast?.message ?? null}
          type={toast?.type}
          onClose={() => setToast(null)}
        />
      </>
    );
  }

  return (
    <div className="app-container app-shell">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onAdd={handleOpenQuickDrink}
      />
      <main className="main-content">
        {activeTab === 'dashboard' && (
          <DashboardView showToast={showToast} onNavigate={setActiveTab} />
        )}
        {(activeTab === 'ble' || activeTab === 'devices') && (
          <DeviceCenterView showToast={showToast} />
        )}
        {activeTab === 'history' && <HistoryView showToast={showToast} />}
        {activeTab === 'stats' && <StatsView showToast={showToast} />}
        {activeTab === 'settings' && <SettingsView showToast={showToast} />}
      </main>
      <Toast
        message={toast?.message ?? null}
        type={toast?.type}
        onClose={() => setToast(null)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BleProvider>
        <WaterProvider>
          <DeviceProvider>
            <MainLayout />
          </DeviceProvider>
        </WaterProvider>
      </BleProvider>
    </AuthProvider>
  );
};

export default App;
