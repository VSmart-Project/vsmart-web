import { useState } from "react";
import { X, Trash2, Eye, EyeOff, CircleDot, PenLine } from "lucide-react";
import { GEOFENCE } from "../../configuration";

const GeofencesPanel = ({
  onClose,
  geofences,
  onDeleteGeofences,
  onAddPolygonGeofence,
  onAddCircleGeofence,
  isLoading,
  onToggleGeofences,
  geofencesVisible,
  totalGeofences,
}) => {
  const [selectedItems, setSelectedItems] = useState([]);

  const handleSelectionChange = (geofenceId) => {
    setSelectedItems((prev) =>
      prev.includes(geofenceId)
        ? prev.filter((id) => id !== geofenceId)
        : [...prev, geofenceId]
    );
  };

  const handleDeleteGeofences = () => {
    onDeleteGeofences(selectedItems);
    setSelectedItems([]);
  };

  return (
    <div className="absolute top-16 left-4 w-80 bg-card/95 dark:bg-card-dark/95 backdrop-blur-md rounded-2xl shadow-panel-lg dark:shadow-panel-lg-dark border border-hairline dark:border-hairline-dark z-10 overflow-hidden select-none">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-hairline dark:border-hairline-dark">
        <h2 className="text-xs font-bold text-ink dark:text-ink-dark uppercase tracking-wider">Geofences</h2>
        <button
          onClick={onClose}
          className="text-subtle dark:text-subtle-dark hover:text-ink dark:hover:text-ink-dark transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Draw new geofence ── */}
      <div className="px-4 py-3.5 border-b border-hairline dark:border-hairline-dark bg-surface/60 dark:bg-white/[0.02]">
        <p className="text-[10px] font-bold text-subtle dark:text-subtle-dark uppercase tracking-wider mb-2.5">
          Draw New Geofence
        </p>
        <div className="flex gap-2">
          <button
            onClick={onAddPolygonGeofence}
            className="flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 text-xs font-semibold border border-hairline dark:border-hairline-dark rounded-xl bg-card dark:bg-card-dark text-muted dark:text-muted-dark hover:border-brand-500 dark:hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors shadow-sm"
          >
            <PenLine className="w-4 h-4" />
            <span>Polygon</span>
          </button>
          <button
            onClick={onAddCircleGeofence}
            className="flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 text-xs font-semibold rounded-xl bg-brand-500 dark:bg-brand-400 text-white dark:text-[#16161b] hover:bg-brand-600 dark:hover:bg-brand-300 transition-colors shadow-sm"
          >
            <CircleDot className="w-4 h-4" />
            <span>Circle</span>
          </button>
        </div>
      </div>

      {/* ── Geofence list ── */}
      <div className="p-4 max-h-72 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500 dark:border-brand-400"></div>
          </div>
        ) : geofences?.length > 0 ? (
          <div>
            <div className="text-[10px] text-subtle dark:text-subtle-dark font-semibold mb-2.5">
              Collection: <span className="font-bold text-muted dark:text-muted-dark">{GEOFENCE}</span>
            </div>
            <div className="space-y-1">
              {geofences.map((geofence) => (
                <label
                  key={geofence.GeofenceId}
                  className="flex items-center space-x-3 p-2.5 hover:bg-surface dark:hover:bg-white/5 rounded-xl cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(geofence.GeofenceId)}
                    onChange={() => handleSelectionChange(geofence.GeofenceId)}
                    className="w-4 h-4 text-brand-500 border-hairline dark:border-hairline-dark rounded focus:ring-brand-500/30"
                  />
                  <span className="text-xs font-semibold text-muted dark:text-muted-dark flex-1 truncate">
                    {geofence.GeofenceId}
                  </span>
                </label>
              ))}
            </div>
            {totalGeofences > 10 && (
              <div className="text-[10px] text-subtle dark:text-subtle-dark mt-3 italic font-medium">
                Showing {geofences?.length} of {totalGeofences}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6">
            <CircleDot className="w-8 h-8 mx-auto mb-2 text-hairline dark:text-hairline-dark" />
            <p className="text-xs font-bold text-muted dark:text-muted-dark">No geofences yet.</p>
            <p className="text-[10px] text-subtle dark:text-subtle-dark mt-1 font-semibold">Use Polygon or Circle above to create one.</p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-hairline dark:border-hairline-dark">
        <button
          onClick={handleDeleteGeofences}
          disabled={selectedItems.length === 0}
          className="flex items-center space-x-1.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span>Remove ({selectedItems.length})</span>
        </button>

        <button
          onClick={onToggleGeofences}
          className="flex items-center space-x-1.5 text-xs font-bold text-muted dark:text-muted-dark hover:text-ink dark:hover:text-ink-dark transition-colors"
        >
          {geofencesVisible ? (
            <>
              <EyeOff className="w-4 h-4" />
              <span>Hide</span>
            </>
          ) : (
            <>
              <Eye className="w-4 h-4" />
              <span>Show</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default GeofencesPanel;
