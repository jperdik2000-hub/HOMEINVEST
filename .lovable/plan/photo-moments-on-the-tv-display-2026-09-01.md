# Photo Moments on the TV Display

Let the host snap photos from their phone and push them to the in-room TV for a set number of seconds, then return to the normal game view.

## What the host sees

A new "Photos" section on the TV control page (`/game/$gameId/tv-control`):

- **Upload / take photo**: a file input that opens the phone camera, plus a gallery of photos already uploaded for this night.
- **Click a photo** to show it on the TV.
- **Duration picker**: 5 / 10 / 15 / 30 / 60 seconds (default 10).
- **"Show on TV"** button writes the active photo to the session.
- **"Clear now"** button removes the active photo and returns to the normal display.
- Photos are scoped to the night, so they can be reused during the event.

## What the TV shows

When a photo is active:

- The TV pauses its normal layout and shows the photo full-screen, letterboxed to fit without distortion.
- A small progress bar at the bottom counts down the remaining seconds.
- After the duration expires, the photo automatically clears and the TV returns to the live game view.
- The host can also clear it manually from the control page at any time.

## Database & storage

One migration:

- New table `public.night_photos`:
  - `id uuid primary key default gen_random_uuid()`
  - `night_id uuid references poker_nights(id) on delete cascade not null`
  - `storage_path text not null`
  - `created_by uuid references auth.users(id) on delete set null`
  - `created_at timestamptz default now()`
- GRANTs: `SELECT, INSERT, DELETE` on `public.night_photos` to `authenticated`; `ALL` to `service_role`.
- RLS: `SELECT` via `can_view_night(night_id)`; `INSERT/DELETE` via `is_night_admin(night_id)`.
- New private storage bucket `night-photos` with RLS so only authenticated users in the night can read.
- Add `active_photo` JSON column to `night_tv_sessions`:
  - `{ path: string, until: string (ISO), duration: number }`
  - Nullable; when present and `until` is in the future, the TV shows the photo.

## App code

- `src/lib/night-photos.functions.ts`:
  - `uploadNightPhoto` — signed upload path for the storage bucket.
  - `listNightPhotos` — fetch photo rows for the night.
  - `deleteNightPhoto` — remove row + storage object.
  - `showPhotoOnTv` — set `active_photo` on `night_tv_sessions` with chosen duration.
  - `clearTvPhoto` — set `active_photo` to null.
  All functions use `requireSupabaseAuth` and verify the caller is a night admin.

- `src/components/TvPhotoPanel.tsx`:
  - Gallery grid of existing night photos.
  - File input with `accept="image/*" capture="environment"` for camera.
  - Duration selector and Show/Clear controls.

- `src/routes/_authenticated/game.$gameId.tv-control.tsx`:
  - Mount `TvPhotoPanel` in a new card below Announcement.

- `src/lib/tv.functions.ts`:
  - Include `active_photo` in the snapshot.
  - If `active_photo.until` has passed, clear it server-side before returning.

- `src/components/TvDisplay.tsx`:
  - New photo overlay that takes precedence over normal overlays and break screen.
  - Render the signed URL, countdown progress bar, and auto-clear via local timer + refetch.

## Out of scope

- Slideshow / multiple photos in sequence.
- Filters or editing of uploaded photos.
- Public upload by non-host players.
