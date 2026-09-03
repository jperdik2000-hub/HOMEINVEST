
-- Allow authenticated users to upload into their own user-id folder
CREATE POLICY "Chat images: authenticated upload own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to read any chat image (RLS on chat messages already gates who sees the URL)
CREATE POLICY "Chat images: authenticated read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-images');

-- Allow uploader to delete/replace their own files
CREATE POLICY "Chat images: authenticated delete own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
