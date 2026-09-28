-- Large files go straight to Storage; the job-files bucket takes 100MB.
--
-- Founder, 28 Sep 2026: "people need to upload big files ... 25mb is not
-- enough". Photos, add-on photos and job files now go from the phone straight
-- to Storage on a one-path signed URL the server picks, and the server then
-- fingerprints what arrived (web/lib/portal/stored-object.ts), so the 25MB
-- Server Action body limit no longer applies to them. The evidence bucket
-- already allows 500MB. The job-files bucket allowed 25MB; it now allows
-- 100MB (104857600), with the app's own cap at 100,000,000 bytes just under
-- it, which web/tests/job-files.test.mjs holds. The allowed file types are
-- unchanged.

update storage.buckets set file_size_limit = 104857600 where id = 'job-files';
