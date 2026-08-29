import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Info, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw, CalendarDays } from 'lucide-react';
import { deviceApi } from '../../api/deviceApi';
import { clsx } from 'clsx';

// Icon config for timeline event types
const EVENT_ICONS = {
  driving: {
    icon: (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 dark:bg-brand-400 text-white dark:text-[#16161b]">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </div>
    ),
    label: 'Driving'
  },
  stopped: {
    icon: (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white">
        <div className="h-2 w-2 rounded-full bg-white"></div>
      </div>
    ),
    label: 'Stopped'
  }
};

// Calculate distance between two coordinates in km (Haversine formula)
const getDistanceKm = (coords1, coords2) => {
  if (!coords1 || !coords2) return 0;
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
};

export default function DeviceDetailPanel({ device, selectedDate, onSelectedDateChange, historyPoints, onHistoryPointsChange, onMatchedPathChange, onClose }) {
  const [activeTab, setActiveTab] = useState('tracking'); // 'tracking' | 'analytics' | 'details'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addresses, setAddresses] = useState({});
  const dateInputRef = useRef(null);

  const changeDate = (days) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + days);
    onSelectedDateChange(next);
  };

  const formatSelectedDate = (date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatInputDate = (date) => {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Reset date selection when active device changes
  useEffect(() => {
    if (device?.sampleTime) {
      const devDate = new Date(device.sampleTime);
      const currentFormatted = formatInputDate(selectedDate);
      const nextFormatted = formatInputDate(devDate);
      if (currentFormatted !== nextFormatted) {
        onSelectedDateChange(devDate);
      }
    } else {
      const todayFormatted = formatInputDate(new Date());
      const currentFormatted = formatInputDate(selectedDate);
      if (currentFormatted !== todayFormatted) {
        onSelectedDateChange(new Date());
      }
    }
  }, [device?.deviceId, device?.sampleTime, onSelectedDateChange, selectedDate]);

  // Fetch history from API and store in parent state
  const deviceId = device?.deviceId;
  const fetchHistory = useCallback(() => {
    if (!deviceId) return;
    setLoading(true);

    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    deviceApi.getHistory(deviceId, startOfDay.toISOString(), endOfDay.toISOString(), { matched: true })
      .then(res => {
        // AWS history positions come sorted by sampleTime desc (newest first).
        // Sort oldest to newest for chronological aggregation
        const sortedHistory = [...(res.data || [])].sort(
          (a, b) => new Date(a.SampleTime) - new Date(b.SampleTime)
        );
        onHistoryPointsChange(sortedHistory);
        // matchedPath is only populated when the backend has a local OSRM
        // instance configured; otherwise this is null and the map layer
        // falls back to drawing from the raw points above.
        onMatchedPathChange?.(res.matchedPath || []);
      })
      .catch(err => console.error('[History] Failed to load:', err))
      .finally(() => setLoading(false));
  }, [deviceId, selectedDate, onHistoryPointsChange, onMatchedPathChange]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Parse chronological events when historyPoints update
  useEffect(() => {
    if (!device) return;

    // Group consecutive updates into "Driving" or "Stopped" segments
    const segments = [];
    let currentSegment = null;

    for (let i = 0; i < historyPoints.length - 1; i++) {
      const pt = historyPoints[i];
      const nextPt = historyPoints[i + 1];

      const distance = getDistanceKm(pt.Position, nextPt.Position);
      const timeMs = Math.abs(new Date(nextPt.SampleTime) - new Date(pt.SampleTime));
      
      let type = 'stopped';
      let speed = 0;

      // If the gap between two pings is longer than 30 seconds, treat it as a stop gap
      const isGap = timeMs > 30000;

      if (!isGap) {
        const timeHrs = timeMs / 3600000;
        speed = timeHrs > 0 ? (distance / timeHrs) : 0;
        type = speed > 3 ? 'driving' : 'stopped';
      } else {
        type = 'stopped';
      }

      if (isGap) {
        // Finalize current segment before gap
        if (currentSegment) {
          segments.push(currentSegment);
          currentSegment = null;
        }
        // Add a dedicated stopped segment for the gap duration
        const gapMin = Math.round(timeMs / 60000);
        segments.push({
          type: 'stopped',
          startTime: pt.SampleTime,
          endTime: nextPt.SampleTime,
          durationMs: timeMs,
          distance: 0,
          startPosition: pt.Position,
          endPosition: pt.Position,
          speeds: [0],
          duration: gapMin > 0 ? `${gapMin} min` : null,
          rawDurationMin: gapMin,
          position: pt.Position
        });
      } else {
        if (!currentSegment) {
          currentSegment = {
            type,
            startTime: pt.SampleTime,
            endTime: nextPt.SampleTime,
            durationMs: timeMs,
            distance: distance,
            startPosition: pt.Position,
            endPosition: nextPt.Position,
            speeds: [speed]
          };
        } else if (currentSegment.type === type) {
          // Merge same state into current segment
          currentSegment.endTime = nextPt.SampleTime;
          currentSegment.durationMs += timeMs;
          currentSegment.distance += distance;
          currentSegment.endPosition = nextPt.Position;
          currentSegment.speeds.push(speed);
        } else {
          // State changed: finalize old segment and start new one
          segments.push(currentSegment);
          currentSegment = {
            type,
            startTime: pt.SampleTime,
            endTime: nextPt.SampleTime,
            durationMs: timeMs,
            distance: distance,
            startPosition: pt.Position,
            endPosition: nextPt.Position,
            speeds: [speed]
          };
        }
      }
    }

    // Push last segment
    if (currentSegment) {
      segments.push(currentSegment);
    }

    // Map segments to timeline event cards (newest first)
    const parsedEvents = segments.reverse().map((seg, idx) => {
      if (seg.type === 'stopped' && seg.duration) {
        // Already created gap segment
        return seg;
      }

      let durationMs = seg.durationMs;

      // If the latest event is 'stopped', add elapsed time from the last ping to now
      if (idx === 0 && seg.type === 'stopped') {
        const timeSinceLastPingMs = new Date() - new Date(seg.endTime);
        if (timeSinceLastPingMs > 0) {
          durationMs += timeSinceLastPingMs;
        }
      }

      const durationMin = Math.round(durationMs / 60000);
      
      // Calculate average speed for driving segment
      const avgSpeed = seg.type === 'driving' 
        ? seg.speeds.reduce((a, b) => a + b, 0) / seg.speeds.length
        : 0;

      return {
        type: seg.type,
        time: seg.endTime 
          ? new Date(seg.endTime).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
          : '12:00',
        startTime: seg.startTime,
        endTime: seg.endTime,
        rawTime: seg.endTime,
        speed: seg.type === 'driving' ? `${Math.min(Math.round(avgSpeed), 100)} km/h` : null,
        duration: durationMin > 0 ? `${durationMin} min` : null,
        rawDurationMin: durationMin,
        distance: seg.type === 'driving' && seg.distance > 0.05 ? `${seg.distance.toFixed(1)} km` : null,
        position: seg.endPosition // Use final position of the segment
      };
    });

    // Fallback if history is empty but device is currently active
    if (parsedEvents.length === 0 && device.position) {
      let durationMs = 600000; // 10 minutes default
      if (device.sampleTime) {
        const diffMs = new Date() - new Date(device.sampleTime);
        if (diffMs > 0) durationMs = diffMs;
      }
      const durationMin = Math.round(durationMs / 60000);

      parsedEvents.push({
        type: 'stopped',
        time: device.sampleTime 
          ? new Date(device.sampleTime).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
          : 'Just now',
        startTime: device.sampleTime ? new Date(device.sampleTime).getTime() - 600000 : new Date().getTime() - 600000,
        endTime: device.sampleTime ? new Date(device.sampleTime) : new Date(),
        rawTime: device.sampleTime,
        speed: null,
        duration: durationMin > 0 ? `${durationMin} min` : null,
        rawDurationMin: durationMin,
        distance: null,
        position: device.position
      });
    }

    setEvents(parsedEvents.slice(0, 5));
  }, [device, historyPoints]);

  // Translate coordinates to address
  const fetchAddress = useCallback(async (lat, lon, key) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`);
      const data = await res.json();
      if (data.display_name) {
        setAddresses(prev => ({ ...prev, [key]: data.display_name }));
      }
    } catch {
      setAddresses(prev => ({ ...prev, [key]: `${lat.toFixed(4)}, ${lon.toFixed(4)}` }));
    }
  }, []);

  useEffect(() => {
    events.forEach(eventItem => {
      if (eventItem.position) {
        const key = `${eventItem.position[1]},${eventItem.position[0]}`;
        if (!addresses[key]) {
          fetchAddress(eventItem.position[1], eventItem.position[0], key);
        }
      }
    });
  }, [events, fetchAddress, addresses]);

  if (!device) return null;

  // Calculate timeline ranges dynamically (optimized for 30+ minutes span with 5-minute steps)
  let timelineStart = null;
  let timelineEnd = null;
  let timelineLabels = [];

  if (events.length > 0) {
    const timestamps = events.flatMap(e => [new Date(e.startTime || e.rawTime), new Date(e.endTime || e.rawTime)]);
    const minTime = new Date(Math.min(...timestamps));
    const maxTime = new Date(Math.max(...timestamps));
    
    // Round min time down to nearest 5 minutes
    const roundedMin = new Date(minTime);
    const minMin = roundedMin.getMinutes();
    roundedMin.setMinutes(Math.floor(minMin / 5) * 5, 0, 0);
    timelineStart = roundedMin;

    // Round max time up to nearest 5 minutes
    const roundedMax = new Date(maxTime);
    const maxMin = roundedMax.getMinutes();
    roundedMax.setMinutes(Math.ceil(maxMin / 5) * 5, 0, 0);
    timelineEnd = roundedMax;

    // Ensure the total timeline span is at least 30 minutes
    const currentSpanMin = (timelineEnd.getTime() - timelineStart.getTime()) / 60000;
    if (currentSpanMin < 30) {
      timelineEnd = new Date(timelineStart.getTime() + 30 * 60000);
    }

    // Generate labels every 5 minutes (or 10 minutes if span is very long)
    const finalSpanMin = (timelineEnd.getTime() - timelineStart.getTime()) / 60000;
    const stepMin = finalSpanMin > 50 ? 10 : 5;

    for (let t = timelineStart.getTime(); t <= timelineEnd.getTime(); t += stepMin * 60000) {
      const dt = new Date(t);
      const formatted = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
      timelineLabels.push(formatted);
    }
  }

  const timelineStartMs = timelineStart ? timelineStart.getTime() : 0;
  const timelineEndMs = timelineEnd ? timelineEnd.getTime() : 1;
  const totalRangeMs = timelineEndMs - timelineStartMs;

  // Position each segment absolutely on the timeline bar
  const timelineBars = events.map(e => {
    const startMs = new Date(e.startTime || e.rawTime).getTime();
    const endMs = new Date(e.endTime || e.rawTime).getTime();

    const leftPct = Math.max(0, Math.min(100, ((startMs - timelineStartMs) / totalRangeMs) * 100));
    const rightPct = Math.max(0, Math.min(100, ((endMs - timelineStartMs) / totalRangeMs) * 100));
    
    let widthPct = rightPct - leftPct;
    if (widthPct < 1.5) widthPct = 1.5; // Ensure small events are visible

    return {
      type: e.type,
      left: `${leftPct}%`,
      width: `${widthPct}%`
    };
  });


  return (
    <div className="absolute top-4 right-4 bottom-4 w-96 bg-card/95 dark:bg-card-dark/95 backdrop-blur-md rounded-3xl shadow-panel-lg dark:shadow-panel-lg-dark border border-hairline dark:border-hairline-dark z-20 flex flex-col overflow-hidden select-none animate-fade-in">
      
      {/* Scrollable container for panel details */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
        
        {/* Device Information Card */}
        <div className="relative border border-hairline dark:border-hairline-dark bg-surface/60 dark:bg-white/[0.02] rounded-2xl p-4">
          <button 
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-surface dark:hover:bg-white/5 text-subtle dark:text-subtle-dark hover:text-ink dark:hover:text-ink-dark transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-ink dark:text-ink-dark leading-tight">
                {device.displayName || 'null'}
              </h2>
              <div className="flex items-center space-x-2 mt-1">
                {/* Real Device Status Badge */}
                <span className={clsx(
                  "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border",
                  device.status === 'active' && "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/30 animate-pulse",
                  device.status === 'inactive' && "bg-surface dark:bg-white/5 text-subtle dark:text-subtle-dark border-hairline dark:border-hairline-dark",
                  device.status === 'maintenance' && "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/30"
                )}>
                  {device.status ? device.status.toUpperCase() : 'NULL'}
                </span>
                <span className="text-xs font-medium text-subtle dark:text-subtle-dark">
                  #{device.deviceId}
                </span>
              </div>
            </div>
          </div>

          {/* Truck Image Mockup */}
          <div className="my-4 flex items-center justify-center py-2">
            <svg className="w-44 h-24 text-subtle dark:text-subtle-dark" viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 70h140v-30H20v30z" fill="currentColor" opacity="0.35" />
              <path d="M120 70h40V48h-40v22z" fill="currentColor" opacity="0.45" />
              <path d="M140 48l15 10H140V48z" fill="currentColor" opacity="0.6" />
              <path d="M130 52h8v8h-8v-8z" fill="currentColor" opacity="0.8" />
              <circle cx="35" cy="72" r="10" fill="currentColor" opacity="0.85" />
              <circle cx="35" cy="72" r="4" fill="currentColor" opacity="0.35" />
              <circle cx="125" cy="72" r="10" fill="currentColor" opacity="0.85" />
              <circle cx="125" cy="72" r="4" fill="currentColor" opacity="0.35" />
              <circle cx="148" cy="72" r="10" fill="currentColor" opacity="0.85" />
              <circle cx="148" cy="72" r="4" fill="currentColor" opacity="0.35" />
              <path d="M30 40h70v2H30v-2z" fill="#6664d8" />
            </svg>
          </div>

          {/* Grid Details - Removed Insurance, formatted Name and Code */}
          <div className="grid grid-cols-2 gap-2 text-center border-t border-hairline dark:border-hairline-dark pt-3">
            <div>
              <p className="text-xs font-semibold text-subtle dark:text-subtle-dark uppercase tracking-wider">Vehicle Name</p>
              <p className="text-xs font-bold text-muted dark:text-muted-dark mt-0.5 truncate">{device.displayName || 'null'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-subtle dark:text-subtle-dark uppercase tracking-wider">Vehicle Code</p>
              <p className="text-xs font-bold text-muted dark:text-muted-dark mt-0.5 truncate">{device.licensePlate || device.deviceId || 'null'}</p>
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-hairline dark:border-hairline-dark">
          {['tracking', 'analytics', 'details'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 pb-3 text-xs font-semibold text-center border-b-2 transition-colors uppercase tracking-wider ${
                activeTab === tab 
                  ? 'border-brand-500 dark:border-brand-400 text-brand-600 dark:text-brand-400' 
                  : 'border-transparent text-subtle dark:text-subtle-dark hover:text-muted dark:hover:text-muted-dark'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        {activeTab === 'tracking' && (
          <div className="space-y-4">
            
            {/* Last Update Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-ink dark:text-ink-dark">Last Update</span>
                <button
                  onClick={fetchHistory}
                  disabled={loading}
                  className="p-1 hover:bg-surface dark:hover:bg-white/5 rounded-lg text-subtle dark:text-subtle-dark hover:text-muted dark:hover:text-muted-dark transition-all active:scale-95 disabled:opacity-50"
                  title="Sync latest history"
                >
                  <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
                </button>
              </div>
              <div className="flex items-center space-x-1 text-xs text-muted dark:text-muted-dark font-semibold">
                <button
                  onClick={() => changeDate(-1)}
                  className="p-1 hover:bg-surface dark:hover:bg-white/5 rounded-md text-subtle dark:text-subtle-dark hover:text-muted dark:hover:text-muted-dark transition-all active:scale-95"
                  title="Ngày trước"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}
                  className="flex items-center space-x-1.5 bg-surface dark:bg-white/5 border border-hairline dark:border-hairline-dark rounded-lg px-2.5 py-1.5 hover:border-brand-300 dark:hover:border-brand-400/50 hover:bg-brand-50/50 dark:hover:bg-brand-400/10 transition-all cursor-pointer group"
                  title="Chọn ngày"
                >
                  <CalendarDays className="w-3.5 h-3.5 text-brand-400 dark:text-brand-400 group-hover:text-brand-500 dark:group-hover:text-brand-300 transition-colors" />
                  <span className="group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors">{formatSelectedDate(selectedDate)}</span>
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={formatInputDate(selectedDate)}
                  onChange={(e) => {
                    if (e.target.value) {
                      onSelectedDateChange(new Date(e.target.value + 'T00:00:00'));
                    }
                  }}
                  className="absolute opacity-0 pointer-events-none w-0 h-0"
                />
                <button
                  onClick={() => changeDate(1)}
                  className="p-1 hover:bg-surface dark:hover:bg-white/5 rounded-md text-subtle dark:text-subtle-dark hover:text-muted dark:hover:text-muted-dark transition-all active:scale-95"
                  title="Ngày sau"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Timeline layout containing labels and the absolute segments bar */}
            <div className="space-y-1.5 py-1">
              {timelineStart && (
                <div className="flex justify-between text-xs text-subtle dark:text-subtle-dark font-bold px-0.5">
                  {timelineLabels.map((lbl, idx) => (
                    <span key={idx}>{lbl}</span>
                  ))}
                </div>
              )}

              {/* Absolute-Positioned Horizontal Timeline Bar */}
              <div className="h-5 w-full rounded-lg overflow-hidden relative bg-surface dark:bg-white/5 border border-hairline/60 dark:border-hairline-dark/60">
                {timelineStart ? (
                  timelineBars.map((bar, idx) => (
                    <div 
                      key={idx}
                      className={clsx(
                        "absolute h-full transition-all duration-300",
                        bar.type === 'driving' ? "bg-brand-500 dark:bg-brand-400" : "bg-rose-500" // Stopped is rose (red)
                      )}
                      style={{ left: bar.left, width: bar.width }}
                    />
                  ))
                ) : (
                  <div className="h-full w-full bg-card-muted dark:bg-white/5" />
                )}
              </div>
            </div>

            {/* Vertical timeline matching real historical updates */}
            <div className="relative pl-6 border-l border-hairline dark:border-hairline-dark space-y-5 py-2">
              {loading ? (
                <div className="space-y-4 py-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="animate-pulse flex items-start space-x-3">
                      <div className="h-5 w-5 bg-card-muted dark:bg-white/10 rounded-full shrink-0"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 bg-card-muted dark:bg-white/10 rounded w-1/3"></div>
                        <div className="h-3 bg-card-muted dark:bg-white/5 rounded w-5/6"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : events.length > 0 ? (
                events.map((eventItem, index) => {
                  const key = eventItem.position ? `${eventItem.position[1]},${eventItem.position[0]}` : '';
                  const addr = addresses[key] || "Translating coordinate...";
                  const eventConf = EVENT_ICONS[eventItem.type] || EVENT_ICONS.stopped;

                  return (
                    <div key={index} className="relative group">
                      
                      {/* Timeline dot */}
                      <span className="absolute -left-[37px] top-0 z-10 bg-card dark:bg-card-dark p-0.5 rounded-full">
                        {eventConf.icon}
                      </span>

                      {/* Timeline content */}
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-ink dark:text-ink-dark flex items-center gap-1.5">
                            {eventConf.label}
                            {index === 0 && device.status === 'active' && (
                              <span className="h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400 animate-ping" />
                            )}
                          </span>
                          <span className="text-xs font-semibold text-subtle dark:text-subtle-dark">{eventItem.time}</span>
                        </div>
                        
                        <p className="text-xs text-muted dark:text-muted-dark mt-1 font-medium leading-relaxed">
                          {addr}
                        </p>

                        {/* Speed, duration and distance badges calculated from database */}
                        {(eventItem.speed || eventItem.duration || eventItem.distance) && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {eventItem.speed && (
                              <span className="px-2 py-0.5 rounded bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400 font-semibold text-xs border border-brand-100 dark:border-brand-400/20">
                                {eventItem.speed}
                              </span>
                            )}
                            {eventItem.duration && (
                              <span className="px-2 py-0.5 rounded bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400 font-semibold text-xs border border-brand-100 dark:border-brand-400/20">
                                {eventItem.duration}
                              </span>
                            )}
                            {eventItem.distance && (
                              <span className="px-2 py-0.5 rounded bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400 font-semibold text-xs border border-brand-100 dark:border-brand-400/20">
                                {eventItem.distance}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-6 text-subtle dark:text-subtle-dark text-xs">
                  No tracking events recorded.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-4 py-4 text-center">
            <Info className="w-8 h-8 text-brand-500 dark:text-brand-400 mx-auto" />
            <h3 className="text-sm font-bold text-ink dark:text-ink-dark">Analytics Insights</h3>
            <p className="text-xs text-subtle dark:text-subtle-dark leading-relaxed max-w-[240px] mx-auto">
              Real-time velocity statistics, driver safety alerts, and fuel consumption graphs will display here.
            </p>
          </div>
        )}

        {activeTab === 'details' && (
          <div className="space-y-4 text-xs">
            <div className="border border-hairline dark:border-hairline-dark bg-surface/60 dark:bg-white/[0.02] rounded-xl p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-subtle dark:text-subtle-dark font-medium">Device ID</span>
                <span className="text-ink dark:text-ink-dark font-semibold font-mono">{device.deviceId || 'null'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle dark:text-subtle-dark font-medium">Registered Name</span>
                <span className="text-ink dark:text-ink-dark font-semibold">{device.displayName || 'null'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle dark:text-subtle-dark font-medium">Device Type</span>
                <span className="text-ink dark:text-ink-dark font-semibold capitalize">{device.type || 'null'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle dark:text-subtle-dark font-medium">Coordinates</span>
                <span className="text-ink dark:text-ink-dark font-semibold font-mono">
                  {device.position ? `${device.position[1].toFixed(6)}, ${device.position[0].toFixed(6)}` : 'null'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle dark:text-subtle-dark font-medium">Last Sample Time</span>
                <span className="text-ink dark:text-ink-dark font-semibold">
                  {device.sampleTime ? new Date(device.sampleTime).toLocaleString() : 'null'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
