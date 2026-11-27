CREATE TYPE user_role AS ENUM ('APPLICANT','OPERATOR');
CREATE TYPE actor_role AS ENUM ('APPLICANT','OPERATOR','SYSTEM');
CREATE TYPE application_type AS ENUM ('FRESH','REISSUE');
CREATE TYPE application_scenario AS ENUM ('STANDARD','EXPIRING','LOST_OR_DAMAGED');
CREATE TYPE application_status AS ENUM
  ('DRAFT','DOCUMENTS_PENDING','READY_FOR_REVIEW','UNDER_REVIEW','CORRECTION_REQUIRED','SUBMITTED_SIMULATED','CLOSED');
CREATE TYPE checklist_status AS ENUM ('MISSING','PENDING','VERIFIED','REJECTED');
CREATE TYPE document_source AS ENUM ('DIGILOCKER','UPLOAD');
CREATE TYPE connection_status AS ENUM ('PENDING','CONNECTED','WITHDRAWN');
CREATE TYPE review_decision AS ENUM ('ACCEPTED','REJECTED','CORRECTION_REQUESTED');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL,
  region        text NOT NULL,              -- operator scope / applicant's region
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,              -- SHA-256 of cookie value
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE applicant_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  date_of_birth date NOT NULL,
  phone         text NOT NULL,
  address_line  text NOT NULL,
  city          text NOT NULL,
  state         text NOT NULL,
  postal_code   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE application_reference_seq START 1001;

CREATE TABLE passport_applications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          text NOT NULL UNIQUE DEFAULT 'PA-' || nextval('application_reference_seq'),
  applicant_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type               application_type NOT NULL,
  scenario           application_scenario NOT NULL,
  region             text NOT NULL,
  status             application_status NOT NULL DEFAULT 'DRAFT',
  version            integer NOT NULL DEFAULT 1,   -- duplicate-transition guard
  sent_for_review_at timestamptz,                  -- operator visibility starts here
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'FRESH' AND scenario = 'STANDARD') OR (type = 'REISSUE' AND scenario <> 'STANDARD'))
);
CREATE INDEX applications_applicant_idx ON passport_applications(applicant_id);
CREATE INDEX applications_queue_idx ON passport_applications(region, status);

CREATE TABLE document_requirements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_type application_type NOT NULL,
  scenario         application_scenario NOT NULL,
  code             text NOT NULL,
  name             text NOT NULL,
  description      text NOT NULL,
  required         boolean NOT NULL DEFAULT true,
  rules            jsonb NOT NULL DEFAULT '{}',
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_type, scenario, code)
);

CREATE TABLE consent_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES passport_applications(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose        text NOT NULL,
  scopes         text[] NOT NULL CHECK (cardinality(scopes) > 0),
  text_version   text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz
);
CREATE INDEX consent_application_idx ON consent_records(application_id);
CREATE UNIQUE INDEX consent_one_active_idx ON consent_records(application_id) WHERE withdrawn_at IS NULL;

CREATE TABLE digilocker_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL UNIQUE REFERENCES passport_applications(id) ON DELETE CASCADE,
  consent_id       uuid NOT NULL REFERENCES consent_records(id) ON DELETE RESTRICT,
  status           connection_status NOT NULL DEFAULT 'PENDING',
  state_nonce_hash text NOT NULL UNIQUE,
  state_expires_at timestamptz NOT NULL,
  state_used_at    timestamptz,
  callback_hash    text,
  provider_ref     text,                    -- opaque handle, NOT an access token
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One checklist item per requirement per application. Metadata only, never contents.
CREATE TABLE application_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL REFERENCES passport_applications(id) ON DELETE CASCADE,
  requirement_id    uuid NOT NULL REFERENCES document_requirements(id) ON DELETE RESTRICT,
  status            checklist_status NOT NULL DEFAULT 'MISSING',
  source            document_source,
  provider_doc_ref  text,
  consent_id        uuid REFERENCES consent_records(id) ON DELETE RESTRICT,
  issuer            text,
  masked_identifier text,
  issued_on         date,
  valid_until       date,
  mime_type         text,
  size_bytes        integer,
  rejection_reason  text,
  access_revoked_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, requirement_id),
  CONSTRAINT rejected_requires_reason
    CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason,''))) > 0),
  CONSTRAINT digilocker_requires_consent
    CHECK (source IS DISTINCT FROM 'DIGILOCKER' OR consent_id IS NOT NULL)
);

CREATE TABLE application_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES passport_applications(id) ON DELETE CASCADE,
  document_id    uuid REFERENCES application_documents(id) ON DELETE CASCADE,
  operator_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision       review_decision NOT NULL,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (decision = 'ACCEPTED' OR length(btrim(coalesce(reason,''))) > 0)
);
CREATE INDEX reviews_application_idx ON application_reviews(application_id, created_at);

CREATE TABLE status_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id  uuid NOT NULL REFERENCES passport_applications(id) ON DELETE CASCADE,
  previous_status application_status,
  new_status      application_status NOT NULL,
  actor_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role      actor_role NOT NULL,
  actor_name      text NOT NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_events_application_idx ON status_events(application_id, id);

CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES passport_applications(id) ON DELETE CASCADE,
  title          text NOT NULL,
  message        text NOT NULL,
  link           text NOT NULL,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, read_at, created_at);

-- Append-only; deliberately no foreign keys so history outlives records.
CREATE TABLE audit_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id       uuid,
  actor_role     actor_role NOT NULL,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text NOT NULL,
  application_id uuid,
  outcome        text NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  detail         text,
  correlation_id text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_application_idx ON audit_events(application_id, id);
CREATE INDEX audit_actor_idx ON audit_events(actor_id, id);

CREATE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
