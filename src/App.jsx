import { useState, useEffect, useCallback, useRef } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import DeviceList from './components/devices/DeviceList';
import DeviceMarkers from './components/devices/DeviceMarkers';
import DevicesMapOverlay from './components/map/DevicesMapOverlay';
import DeviceHistoryPathLayer from './components/map/DeviceHistoryPathLayer';
import GeofencesLayer from './components/geofences/GeofencesLayer';
import GeofenceManagement from './components/geofences/GeofenceManagement';
import AuthLayout from './components/auth/AuthLayout';
import DeviceDetailPanel from './components/map/DeviceDetailPanel';
import DashboardView from './components/dashboard/DashboardView';
import { AlertCircle, Loader2 } from 'lucide-react';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { getAuthHelpers, createLocationClient } from './utils/aws';
import { useDeviceManager } from './hooks/useDeviceManager';
import { useDevicePolling } from './hooks/useDevicePolling';
import { BACKEND_URL, REGION, MAP, API_KEY } from './configuration';
import { io } from 'socket.io-client';
import Toast from './components/common/Toast';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [activeView, setActiveView] = useState('dashboard');
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [historyPoints, setHistoryPoints] = useState([]);
  const [matchedPath, setMatchedPath] = useState([]);

  const selectedDeviceRef = useRef(selectedDevice);
  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openedPanel, setOpenedPanel] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mapStyle, setMapStyle] = useState(null);
  const [toast, setToast] = useState(null);

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setIsAuthenticated(true);
      })
      .catch(() => {
        setIsAuthenticated(false);
      })
      .finally(() => {
        setIsAuthChecking(false);
      });
  }, []);

  const mapRef = useRef(null);
  const [mapFocusPending, setMapFocusPending] = useState(null);

  // AWS Clients
  const [readOnlyLocationClient, setReadOnlyLocationClient] = useState(null);
  const [writeOnlyLocationClient, setWriteOnlyLocationClient] = useState(null);
  const [readOnlyAuthHelper, setReadOnlyAuthHelper] = useState(null);

  // Initialize AWS SDK
  useEffect(() => {
    const initializeAWS = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get auth helpers
        const authHelpers = await getAuthHelpers();

        console.log('Auth helpers initialized:', authHelpers);
        console.log('ReadOnly auth helper:', authHelpers.readOnlyAuthHelper);
        console.log('Transform request function:', authHelpers.readOnlyAuthHelper?.transformRequest);

        // Get credentials
        const readOnlyCredentials = authHelpers.readOnlyAuthHelper.getLocationClientConfig();
        const writeOnlyCredentials = authHelpers.writeOnlyAuthHelper.getLocationClientConfig();

        // Create clients
        setReadOnlyLocationClient(createLocationClient(readOnlyCredentials));
        setWriteOnlyLocationClient(createLocationClient(writeOnlyCredentials));

        // Store auth helper for map
        setReadOnlyAuthHelper(authHelpers.readOnlyAuthHelper);

        // Set map style URL - use the correct AWS Location Service format
        const styleUrl = `https://maps.geo.${REGION}.amazonaws.com/maps/v0/maps/${MAP.STYLE}/style-descriptor`;
        console.log('Map style URL:', styleUrl);
        setMapStyle(styleUrl);

        setLoading(false);
      } catch (err) {
        console.error('Failed to initialize AWS:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    initializeAWS();
  }, []);

  // ── Device Manager (calls Backend REST API) ──
  const {
    devices,
    unregisteredDevices,
    loading: devicesLoading,
    error: devicesError,
    fetchDevices,
    createDevice,
    updateDevice,
    deleteDevice,
    updateDevicePosition,
    applyRealtimeEvent,
  } = useDeviceManager();

  // Initial fetch
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Socket.io Real-time connection
  useEffect(() => {
    if (!isAuthenticated) return;

    console.log('🔌 Connecting to backend Socket.io server at:', BACKEND_URL);
    const socket = io(BACKEND_URL);

    socket.on('connect', () => {
      console.log('✅ Connected to Socket.io server with ID:', socket.id);
      
      // Join targeted user room
      getCurrentUser()
        .then((user) => {
          const userId = user.userId || user.username;
          if (userId) {
            socket.emit('join-room', userId);
          }
        })
        .catch((err) => {
          console.warn('Failed to fetch user info for socket room:', err);
        });
    });

    socket.on('realtime-event', (event) => {
      console.log('📦 Received realtime event:', event);
      const processed = applyRealtimeEvent(event);
      
      const currentSelected = selectedDeviceRef.current;
      if (processed && currentSelected && event.deviceId === currentSelected.deviceId) {
        const payload = event.payload || {};
        setSelectedDevice(prev => {
          if (!prev) return null;
          return {
            ...prev,
            position: payload.position || prev.position,
            sampleTime: payload.sampleTime || prev.sampleTime,
            isOnline: payload.isOnline ?? prev.isOnline,
            positionProperties: payload.positionProperties || prev.positionProperties,
          };
        });

        if (payload.position && payload.sampleTime) {
          setHistoryPoints(prev => {
            const newPoint = { Position: payload.position, SampleTime: payload.sampleTime };
            if (prev.length === 0) {
              return [newPoint];
            }
            const lastPoint = prev[prev.length - 1];
            const liveTime = new Date(newPoint.SampleTime).getTime();
            const lastTime = new Date(lastPoint.SampleTime).getTime();
            if (liveTime > lastTime) {
              return [...prev, newPoint];
            }
            return prev;
          });
        }
      }
      
      // Hiển thị thông báo Toast nếu là cảnh báo geofence hoặc chống trộm
      if (event.type === 'geofence.enter' || event.type === 'geofence.exit' || event.type === 'antitheft.breach') {
        const title = event.type === 'antitheft.breach' ? 'CẢNH BÁO CHỐNG TRỘM!' : 'Cảnh báo vùng Geofence';
        const transition = event.type === 'geofence.enter' ? 'đã đi vào' : event.type === 'geofence.exit' ? 'đã đi ra khỏi' : 'đã vi phạm';
        const msg = event.payload?.message || `Thiết bị ${event.deviceId} ${transition} vùng giám sát ${event.payload?.geofenceId || ''}`;
        setToast({ message: `${title}: ${msg}`, type: event.type === 'antitheft.breach' ? 'error' : 'info' });
      }
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from Socket.io server');
    });

    return () => {
      socket.disconnect();
    };
  }, [isAuthenticated, applyRealtimeEvent]);



  // Poll devices from the backend while on the map view
  useDevicePolling(fetchDevices, activeView === 'map');

  const handleDeviceSelect = (device, zoomToDevice = true) => {
    setSelectedDevice(device);
    if (zoomToDevice && device?.position) {
      setActiveView('map');
      setMapFocusPending({ center: [device.position[0], device.position[1]], zoom: 16 });
    }
  };

  useEffect(() => {
    if (activeView === 'map' && mapFocusPending && mapRef.current) {
      // Small timeout to ensure the map canvas has resized properly before flying
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.flyTo({
            center: mapFocusPending.center,
            zoom: mapFocusPending.zoom,
            duration: 1500,
          });
        }
      }, 100);
      setMapFocusPending(null);
    }
  }, [activeView, mapFocusPending]);

  const handleDeviceCreate = async (formData) => {
    try {
      await createDevice(formData);
      setToast({ message: `Device "${formData.deviceId}" created successfully`, type: 'success' });
    } catch (err) {
      setToast({ message: `Failed to create device: ${err.message}`, type: 'error' });
      throw err; // keep modal open so the user can see the error
    }
  };

  const handleDeviceUpdate = async (id, formData) => {
    try {
      await updateDevice(id, formData);
      setToast({ message: `Device "${id}" updated successfully`, type: 'success' });
    } catch (err) {
      setToast({ message: `Failed to update device: ${err.message}`, type: 'error' });
      throw err;
    }
  };

  const handleDeviceDelete = async (deviceId) => {
    try {
      await deleteDevice(deviceId);
      setToast({ message: `Device "${deviceId}" permanently deleted`, type: 'success' });
    } catch (err) {
      setToast({ message: `Failed to delete device: ${err.message}`, type: 'error' });
      throw err;
    }
  };

  const handlePanelChange = (panel) => {
    setOpenedPanel(panel);
  };

  if (loading || isAuthChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aws-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-aws-orange animate-spin mx-auto mb-4" />
          <p className="text-gray-900 font-medium">Loading application...</p>
          <p className="text-sm text-gray-600 mt-2">Connecting to secure services</p>
        </div>
      </div>
    );
  }

  // --- MÀN HÌNH ĐĂNG NHẬP SẼ KIỂM TRA TRƯỚC ---
  // Để người dùng vẫn có thể xem được giao diện Đăng Nhập/Đăng ký khi chưa cấu hình xong Map/Identity Pool
  if (!isAuthenticated) {
    return (
      <AuthLayout onLoginSuccess={() => setIsAuthenticated(true)} />
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aws-gray-50 p-4 relative">
        <div className="absolute top-6 right-6">
          <button
            onClick={async () => {
              try { await signOut(); setIsAuthenticated(false); } catch (e) { }
            }}
            className="px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-100 font-medium shadow-card transition-colors border border-gray-300"
          >
            Đăng xuất
          </button>
        </div>

        <div className="max-w-md w-full bg-white rounded-lg shadow-card p-6 border border-gray-200">
          <div className="flex items-center space-x-3 text-red-600 mb-4">
            <AlertCircle className="w-6 h-6" />
            <h2 className="text-lg font-semibold text-gray-900">Lỗi cấu hình AWS AWS Location/IoT</h2>
          </div>
          <p className="text-gray-700 mb-4 text-sm">{error}</p>
          <div className="bg-gray-50 rounded-lg p-4 text-sm border border-gray-200">
            <p className="font-medium text-gray-900 mb-2">Bạn cần hoàn tất cấu hình:</p>
            <ol className="list-decimal list-inside space-y-1 text-gray-700">
              <li>Deploy thư mục <b>tracking-data-streaming-infrastructure</b> trên AWS.</li>
              <li>Chép Identity Pool, IoT Endpoint vào <b>configuration.js</b>.</li>
              <li>Khởi động lại trang web.</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex bg-slate-50 overflow-hidden text-slate-800">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeView={activeView}
        onViewChange={setActiveView}
        onToggleCollapse={() => setSidebarOpen(!sidebarOpen)}
      />

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <Header
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          title="VSmart Tracking"
          onLogout={async () => {
            try {
              await signOut();
              setIsAuthenticated(false);
            } catch (err) {
              console.error("Logout error", err);
            }
          }}
        />

        {/* Toast Notification */}
        {toast && (
          <div className="fixed top-20 right-4 z-50">
            <Toast
              message={toast.message}
              type={toast.type}
              onClose={() => setToast(null)}
            />
          </div>
        )}

        <main className="flex-1 overflow-hidden min-h-0 relative">
          {activeView === 'dashboard' && (
            <DashboardView
              devices={devices}
              onViewChange={setActiveView}
              onDeviceSelect={handleDeviceSelect}
              onAddDevice={() => setActiveView('devices')}
            />
          )}

          {activeView === 'map' && (
            <div className="h-full w-full relative">
              {/* Map Container */}
              <Map
                ref={mapRef}
                style={{ width: '100%', height: '100%' }}
                initialViewState={{
                  longitude: 105.804817,
                  latitude: 21.028511,
                  zoom: 13,
                }}
                mapStyle={`https://maps.geo.${REGION}.amazonaws.com/v2/styles/${MAP.STYLE}/descriptor?key=${API_KEY}&color-scheme=${MAP.COLOR_SCHEME}`}
                maxZoom={18}
                validateStyle={false}
              >
                <NavigationControl position="bottom-right" />

                {/* Device Markers */}
                <DeviceMarkers
                  devices={devices}
                  onDeviceClick={handleDeviceSelect}
                />

                {/* Geofences Layer */}
                <GeofencesLayer
                  readOnlyLocationClient={readOnlyLocationClient}
                  writeOnlyLocationClient={writeOnlyLocationClient}
                  isOpenedPanel={openedPanel === 'geofences'}
                  onPanelChange={handlePanelChange}
                  isDrawing={isDrawing}
                  onDrawingChange={setIsDrawing}
                  breachingGeofences={[]}
                />

                {/* Device Path History Layer */}
                 <DeviceHistoryPathLayer
                   deviceId={selectedDevice?.deviceId}
                   isVisible={!!selectedDevice}
                   history={historyPoints}
                   matchedPath={matchedPath}
                 />

                {/* Devices Overlay Panel (Locate Button) */}
                <DevicesMapOverlay
                  devices={devices}
                  isOpenedPanel={openedPanel === 'devices_overlay'}
                  onPanelChange={(p) => handlePanelChange(p === 'devices' ? 'devices_overlay' : p)}
                  onDeviceSelect={(dev, zoom) => {
                    // small timeout to ensure map layout updates
                    setTimeout(() => handleDeviceSelect(dev, zoom), 50);
                  }}
                />
              </Map>

              {/* Floating selected device detail sidebar */}
               {selectedDevice && (
                 <DeviceDetailPanel
                   device={selectedDevice}
                   selectedDate={selectedDate}
                   onSelectedDateChange={setSelectedDate}
                   historyPoints={historyPoints}
                   onHistoryPointsChange={setHistoryPoints}
                   onMatchedPathChange={setMatchedPath}
                   onClose={() => {
                     setSelectedDevice(null);
                     setHistoryPoints([]);
                     setMatchedPath([]);
                   }}
                 />
               )}
            </div>
          )}

          {activeView === 'devices' && (
            <div className="h-full overflow-y-auto p-4 md:p-6 w-full">
              <div className="w-full">
                <DeviceList
                  devices={devices}
                  unregisteredDevices={unregisteredDevices}
                  selectedDevice={selectedDevice}
                  onDeviceSelect={handleDeviceSelect}
                  onDeviceCreate={handleDeviceCreate}
                  onDeviceUpdate={handleDeviceUpdate}
                  onDeviceDelete={handleDeviceDelete}
                  loading={devicesLoading}
                  onRefresh={fetchDevices}
                />
              </div>
            </div>
          )}

          {activeView === 'geofences' && (
            <div className="h-full overflow-y-auto p-4 md:p-6 w-full">
              <div className="w-full">
                <GeofenceManagement
                  readOnlyLocationClient={readOnlyLocationClient}
                  writeOnlyLocationClient={writeOnlyLocationClient}
                />
              </div>
            </div>
          )}



          {activeView === 'settings' && (
            <div className="h-full overflow-y-auto p-4 md:p-6 w-full">
              <div className="w-full">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">
                  Settings
                </h1>
                <div className="card">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    AWS Configuration
                  </h2>
                  <div className="space-y-4 text-sm">
                    <div>
                      <label className="block text-gray-700 font-medium mb-1">
                        Region
                      </label>
                      <input
                        type="text"
                        value="us-east-1"
                        disabled
                        className="input-field bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-medium mb-1">
                        Tracker Name
                      </label>
                      <input
                        type="text"
                        value="TrackingDATN-Tracker"
                        disabled
                        className="input-field bg-gray-100"
                      />
                    </div>
                    <p className="text-gray-600 text-xs mt-4">
                      To update configuration, edit src/configuration.js
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;