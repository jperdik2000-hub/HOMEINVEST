import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listNightPhotos,
  getNightPhotoUploadUrl,
  recordNightPhoto,
  deleteNightPhoto,
  showPhotoOnTv,
  clearTvPhoto,
} from "@/lib/night-photos.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, Trash2, Eye, X, Loader2, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

const DURATIONS = [
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
];

type Photo = Awaited<ReturnType<typeof listNightPhotos>>[number];

export function TvPhotoPanel({ nightId, activePhoto }: { nightId: string; activePhoto?: { path: string; until: string; duration: number } | null }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [duration, setDuration] = useState(10);
  const [showing, setShowing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchPhotos = useServerFn(listNightPhotos);
  const fetchUploadUrl = useServerFn(getNightPhotoUploadUrl);
  const recordPhoto = useServerFn(recordNightPhoto);
  const removePhoto = useServerFn(deleteNightPhoto);
  const pushPhoto = useServerFn(showPhotoOnTv);
  const clearPhoto = useServerFn(clearTvPhoto);

  const photos = useQuery({
    queryKey: ["night-photos", nightId],
    queryFn: async () => (await fetchPhotos({ data: { nightId } })) as Photo[],
  });

  const activePhotoId = activePhoto?.path
    ? photos.data?.find((p) => p.storagePath === activePhoto.path)?.id ?? null
    : null;

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    setUploading(true);
    try {
      const { photoId, path, signedUrl } = await fetchUploadUrl({ data: { nightId } });
      const res = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      await recordPhoto({ data: { nightId, photoId, path } });
      toast.success("Photo uploaded");
      qc.invalidateQueries({ queryKey: ["night-photos", nightId] });
      qc.invalidateQueries({ queryKey: ["tv-session", nightId] });
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this photo?")) return;
    try {
      await removePhoto({ data: { nightId, photoId: id } });
      qc.invalidateQueries({ queryKey: ["night-photos", nightId] });
      if (selectedId === id) setSelectedId(null);
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  }

  async function show() {
    if (!selectedId) return;
    setShowing(true);
    try {
      await pushPhoto({ data: { nightId, photoId: selectedId, duration } });
      toast.success("Photo is now on the TV");
      qc.invalidateQueries({ queryKey: ["tv-session", nightId] });
    } catch (e: any) {
      toast.error(e?.message || "Could not show photo");
    } finally {
      setShowing(false);
    }
  }

  async function clear() {
    setClearing(true);
    try {
      await clearPhoto({ data: { nightId } });
      toast.success("Photo cleared from TV");
      qc.invalidateQueries({ queryKey: ["tv-session", nightId] });
    } catch (e: any) {
      toast.error(e?.message || "Could not clear photo");
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="card-felt grid gap-4 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Photos on TV</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
            Take / upload
          </Button>
        </div>
      </div>

      {activePhoto && (
        <div className="flex items-center gap-3 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
          <Eye className="h-4 w-4 text-gold" />
          <span className="flex-1 truncate">A photo is currently on the TV</span>
          <Button variant="ghost" size="sm" disabled={clearing} onClick={clear}>
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            <span className="sr-only">Clear</span>
          </Button>
        </div>
      )}

      {photos.data?.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border py-8 text-sm text-muted-foreground">
          <ImagePlus className="h-8 w-8 opacity-50" />
          <p>No photos yet. Take one to display it on the TV.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {photos.data?.map((photo) => {
            const isActive = photo.id === activePhotoId;
            const isSelected = selectedId === photo.id;
            return (
              <div
                key={photo.id}
                className={cn(
                  "group relative aspect-square cursor-pointer overflow-hidden rounded-xl border-2 transition-all",
                  isActive ? "border-gold" : isSelected ? "border-primary" : "border-transparent hover:border-primary/50",
                )}
                onClick={() => setSelectedId(photo.id)}
              >
                {photo.url ? (
                  <img src={photo.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-muted text-muted-foreground">
                    <ImagePlus className="h-6 w-6" />
                  </div>
                )}
                {isActive && (
                  <div className="absolute left-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-[oklch(0.12_0.02_90)]">
                    ON TV
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(photo.id); }}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selectedId && (
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:flex sm:items-end">
          <div className="flex-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Display for</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDuration(d.value)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    duration === d.value ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <Button disabled={showing} onClick={show} className="w-full sm:w-auto">
            {showing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            Show on TV
          </Button>
        </div>
      )}
    </section>
  );
}
