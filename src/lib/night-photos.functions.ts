import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PhotoListInput = z.object({ nightId: z.string().uuid() });

const PhotoActionInput = z.object({
  nightId: z.string().uuid(),
  photoId: z.string().uuid(),
});

const ShowPhotoInput = z.object({
  nightId: z.string().uuid(),
  photoId: z.string().uuid(),
  duration: z.number().int().min(5).max(300),
});

const SIGNED_URL_TTL = 60 * 60; // 1 hour

function photoPath(nightId: string, photoId: string, ext: string) {
  return `${nightId}/${photoId}.${ext}`;
}

/**
 * List photos uploaded for a night, with signed URLs for display.
 */
export const listNightPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PhotoListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("night_photos")
      .select("id, night_id, storage_path, created_by, created_at")
      .eq("night_id", data.nightId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const photos = await Promise.all(
      (rows ?? []).map(async (r: any) => {
        const { data: signed } = await supabaseAdmin.storage
          .from("night-photos")
          .createSignedUrl(r.storage_path, SIGNED_URL_TTL);
        return {
          id: r.id as string,
          nightId: r.night_id as string,
          storagePath: r.storage_path as string,
          url: signed?.signedUrl ?? null,
          createdAt: r.created_at as string,
        };
      }),
    );

    return photos;
  });

/**
 * Get a one-time signed upload URL for a new night photo.
 * The client uploads the file directly to storage, then calls recordNightPhoto.
 */
export const getNightPhotoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PhotoListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const isAdmin = await context.supabase.rpc("is_night_admin", { _night: data.nightId });
    if (isAdmin.error) throw isAdmin.error;
    if (!isAdmin.data) throw new Error("Only the host can upload photos");

    const photoId = crypto.randomUUID();
    const path = photoPath(data.nightId, photoId, "jpg");

    const { data: upload, error } = await supabaseAdmin.storage
      .from("night-photos")
      .createSignedUploadUrl(path);
    if (error) throw error;

    return {
      photoId,
      path,
      signedUrl: upload.signedUrl,
    };
  });

/**
 * Record a photo in the night_photos table after the client has uploaded it.
 */
export const recordNightPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ nightId: z.string().uuid(), photoId: z.string().uuid(), path: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("night_photos").insert({
      id: data.photoId,
      night_id: data.nightId,
      storage_path: data.path,
    });
    if (error) throw error;
    return { ok: true };
  });

/**
 * Delete a photo and its storage object.
 */
export const deleteNightPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PhotoActionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const isAdmin = await context.supabase.rpc("is_night_admin", { _night: data.nightId });
    if (isAdmin.error) throw isAdmin.error;
    if (!isAdmin.data) throw new Error("Only the host can delete photos");

    const { data: row } = await context.supabase
      .from("night_photos")
      .select("storage_path")
      .eq("id", data.photoId)
      .eq("night_id", data.nightId)
      .single();
    if (!row) throw new Error("Photo not found");

    const { error: storageErr } = await supabaseAdmin.storage
      .from("night-photos")
      .remove([row.storage_path]);
    if (storageErr) throw storageErr;

    const { error } = await context.supabase
      .from("night_photos")
      .delete()
      .eq("id", data.photoId)
      .eq("night_id", data.nightId);
    if (error) throw error;

    return { ok: true };
  });

/**
 * Push a photo to the TV for a set duration.
 */
export const showPhotoOnTv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ShowPhotoInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const isAdmin = await context.supabase.rpc("is_night_admin", { _night: data.nightId });
    if (isAdmin.error) throw isAdmin.error;
    if (!isAdmin.data) throw new Error("Only the host can control the TV");

    const { data: row } = await context.supabase
      .from("night_photos")
      .select("storage_path")
      .eq("id", data.photoId)
      .eq("night_id", data.nightId)
      .single();
    if (!row) throw new Error("Photo not found");

    const until = new Date(Date.now() + data.duration * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("night_tv_sessions")
      .update({
        active_photo: {
          path: row.storage_path,
          until,
          duration: data.duration,
        },
      })
      .eq("night_id", data.nightId);
    if (error) throw error;

    return { ok: true };
  });

/**
 * Clear the active photo from the TV.
 */
export const clearTvPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ nightId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const isAdmin = await context.supabase.rpc("is_night_admin", { _night: data.nightId });
    if (isAdmin.error) throw isAdmin.error;
    if (!isAdmin.data) throw new Error("Only the host can control the TV");

    const { error } = await supabaseAdmin
      .from("night_tv_sessions")
      .update({ active_photo: null })
      .eq("night_id", data.nightId);
    if (error) throw error;

    return { ok: true };
  });
