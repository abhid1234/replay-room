ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS signature_profile text;

UPDATE endpoints
SET signature_profile = CASE WHEN signing_secret IS NULL THEN 'none' ELSE 'generic' END
WHERE signature_profile IS NULL;

ALTER TABLE endpoints
  ALTER COLUMN signature_profile SET DEFAULT 'none',
  ALTER COLUMN signature_profile SET NOT NULL;

ALTER TABLE endpoints
  DROP CONSTRAINT IF EXISTS endpoints_signature_profile_check;

ALTER TABLE endpoints
  ADD CONSTRAINT endpoints_signature_profile_check
  CHECK (signature_profile IN ('none','generic','github','stripe'));

ALTER TABLE endpoints
  DROP CONSTRAINT IF EXISTS endpoints_signature_configuration_check;

ALTER TABLE endpoints
  ADD CONSTRAINT endpoints_signature_configuration_check
  CHECK (
    (signature_profile = 'none' AND signing_secret IS NULL)
    OR (signature_profile <> 'none' AND signing_secret IS NOT NULL)
  );
