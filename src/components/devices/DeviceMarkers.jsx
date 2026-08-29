import { Marker } from 'react-map-gl/maplibre';
import { Navigation2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

// Easing function for smooth movement
const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const SmoothMarker = ({ deviceId, targetPos, statusColor, onClick }) => {
  const [currentPos, setCurrentPos] = useState(targetPos);
  const startPosRef = useRef(targetPos);
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!targetPos || !currentPos) return;

    // If identical target, do nothing
    if (targetPos[0] === currentPos[0] && targetPos[1] === currentPos[1]) {
      return;
    }

    // Capture the exact moment and position we start animating from
    startPosRef.current = currentPos;
    startTimeRef.current = performance.now();
    const duration = 2000; // 2 seconds fluid movement

    const animate = (time) => {
      let timeFraction = (time - startTimeRef.current) / duration;
      if (timeFraction > 1) timeFraction = 1;

      const progress = easeInOutCubic(timeFraction);

      const newLng = startPosRef.current[0] + (targetPos[0] - startPosRef.current[0]) * progress;
      const newLat = startPosRef.current[1] + (targetPos[1] - startPosRef.current[1]) * progress;

      setCurrentPos([newLng, newLat]);

      if (timeFraction < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        console.log(`[SmoothMarker] Arrived at target: [${targetPos}]`);
      }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPos[0], targetPos[1]]);

  if (!currentPos || currentPos.length < 2) return null;

  return (
    <Marker
      longitude={currentPos[0]}
      latitude={currentPos[1]}
      anchor="center"
      onClick={onClick}
    >
      <div className="relative cursor-pointer group">
        <div
          className="absolute inset-0 rounded-full animate-ping opacity-75"
          style={{ backgroundColor: statusColor }}
        />
        <div
          className="relative w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2 border-white transition-transform group-hover:scale-110"
          style={{ backgroundColor: statusColor }}
        >
          <Navigation2 className="w-5 h-5 text-white" />
        </div>
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 px-2 py-1 bg-card dark:bg-card-dark border border-hairline dark:border-hairline-dark rounded shadow-md text-xs font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 text-ink dark:text-ink-dark">
          {deviceId}
        </div>
      </div>
    </Marker>
  );
};

const DeviceMarkers = ({ devices = [], onDeviceClick }) => {
  const getDeviceId = (device) => device.DeviceId || device.deviceId;
  const getPosition = (device) => device.Position || device.position;
  const getSampleTime = (device) => device.SampleTime || device.sampleTime;

  const getStatusColor = (device) => {
    const sampleTime = getSampleTime(device);
    if (!sampleTime) return '#94A3B8'; // Slate 400
    const lastUpdate = new Date(sampleTime);
    const now = new Date();
    const diffMinutes = (now - lastUpdate) / 1000 / 60;

    if (diffMinutes < 5) return '#10B981'; // Green (Active)
    if (diffMinutes < 30) return '#F59E0B'; // Yellow (Warning)
    return '#EF4444'; // Red (Offline)
  };

  return (
    <>
      {devices.map((device) => {
        const deviceId = getDeviceId(device);
        const position = getPosition(device);

        if (!position || position.length < 2) return null;

        const statusColor = getStatusColor(device);

        return (
          <SmoothMarker
            key={deviceId}
            deviceId={deviceId}
            targetPos={position}
            statusColor={statusColor}
            onClick={(e) => {
              if (e && e.stopPropagation) {
                e.stopPropagation();
              } else if (e && e.originalEvent && e.originalEvent.stopPropagation) {
                e.originalEvent.stopPropagation();
              }
              if (onDeviceClick) {
                onDeviceClick(device, true); // Select and zoom to device in left details sidebar
              }
            }}
          />
        );
      })}
    </>
  );
};

export default DeviceMarkers;
