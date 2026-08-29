import { Source, Layer } from 'react-map-gl/maplibre';

const historyLineLayer = {
    id: 'device-history-line',
    type: 'line',
    paint: {
        'line-color': '#6664d8', // Brand indigo
        'line-width': 3,
        'line-opacity': 0.7,
    },
};

const historyPointsLayer = {
    id: 'device-history-points',
    type: 'circle',
    paint: {
        'circle-radius': 3,
        'circle-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#5451c4',
    },
};

const getDistanceKm = (coords1, coords2) => {
    if (!coords1 || !coords2) return 0;
    const [lon1, lat1] = coords1;
    const [lon2, lat2] = coords2;
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

export default function DeviceHistoryPathLayer({ deviceId, isVisible, history, matchedPath }) {
    // We need at least 1 point to draw anything
    if (!history || history.length === 0 || !isVisible) {
        return null;
    }

    let lineSegments;
    if (Array.isArray(matchedPath) && matchedPath.length >= 2) {
        // Road-snapped path from the backend's local OSRM instance — already
        // one continuous, road-following line, no gap/teleport filtering needed.
        lineSegments = [matchedPath];
    } else {
        // Fallback: group raw history points into separate line segments to
        // prevent massive jumps/teleportation lines (used when OSRM isn't
        // configured/reachable).
        lineSegments = [];
        let currentSegment = [];

        for (let i = 0; i < history.length; i++) {
            const pt = history[i];
            if (currentSegment.length === 0) {
                currentSegment.push(pt.Position);
            } else {
                const lastPt = history[i - 1];
                const timeMs = Math.abs(new Date(pt.SampleTime) - new Date(lastPt.SampleTime));
                const dist = getDistanceKm(pt.Position, lastPt.Position);

                // Split line if gap is > 10 minutes or distance jump is > 10 km (teleportation/GPS drift)
                const isTimeGap = timeMs > 10 * 60 * 1000;
                const isTeleport = dist > 10 && timeMs < 5 * 60 * 1000;

                if (isTimeGap || isTeleport) {
                    if (currentSegment.length >= 2) {
                        lineSegments.push(currentSegment);
                    }
                    currentSegment = [pt.Position];
                } else {
                    currentSegment.push(pt.Position);
                }
            }
        }
        if (currentSegment.length >= 2) {
            lineSegments.push(currentSegment);
        }
    }

    const geojsonLine = {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'MultiLineString',
            coordinates: lineSegments,
        },
    };

    const geojsonPoints = {
        type: 'FeatureCollection',
        features: history.map(pos => ({
            type: 'Feature',
            properties: { sampleTime: pos.SampleTime },
            geometry: { type: 'Point', coordinates: pos.Position }
        }))
    };

    return (
        <>
            {lineSegments.length > 0 && (
                <Source id={`history-line-source-${deviceId}`} type="geojson" data={geojsonLine}>
                    <Layer {...historyLineLayer} id={`history-line-layer-${deviceId}`} />
                </Source>
            )}
            <Source id={`history-points-source-${deviceId}`} type="geojson" data={geojsonPoints}>
                <Layer {...historyPointsLayer} id={`history-points-layer-${deviceId}`} />
            </Source>
        </>
    );
}
