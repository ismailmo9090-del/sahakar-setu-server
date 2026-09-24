-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ==================== SESSIONS ====================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('web','kiosk','whatsapp','sms','ivr')),
    language VARCHAR(10) NOT NULL DEFAULT 'hi',
    guest BOOLEAN DEFAULT TRUE,
    phone_hash VARCHAR(64),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel);
CREATE INDEX IF NOT EXISTS idx_sessions_phone_hash ON sessions(phone_hash);

-- external ref (e.g. VAPI call id) to resume a session across turns
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS external_ref VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_sessions_external_ref ON sessions(external_ref);

-- ==================== MESSAGES (conversation turns) ====================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ==================== CASES ====================
CREATE TABLE IF NOT EXISTS cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    member_ref VARCHAR(64),
    category VARCHAR(50) NOT NULL,
    subcategory VARCHAR(100),
    status VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open','pending','escalated','resolved','closed')),
    strength_score INTEGER DEFAULT 0 CHECK (strength_score BETWEEN 0 AND 100),
    language VARCHAR(10) DEFAULT 'hi',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_category ON cases(category);

-- ==================== FACTS (Case Memory) ====================
CREATE TABLE IF NOT EXISTS facts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
    fact_key VARCHAR(100) NOT NULL,
    fact_value TEXT NOT NULL,
    source_turn INTEGER,
    confirmed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facts_case_id ON facts(case_id);
CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(case_id, fact_key);

-- ==================== GRIEVANCE DRAFTS ====================
CREATE TABLE IF NOT EXISTS grievance_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
    tracking_id VARCHAR(30) UNIQUE NOT NULL,
    addressee TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'hi',
    delivery_channel VARCHAR(20),
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drafts_tracking_id ON grievance_drafts(tracking_id);

-- ==================== GRIEVANCE TRACKING ====================
CREATE TABLE IF NOT EXISTS grievance_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id UUID REFERENCES grievance_drafts(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== DOCUMENTS ====================
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
    doc_type VARCHAR(50),
    original_filename TEXT,
    storage_path TEXT NOT NULL,
    ocr_text TEXT,
    analysis_summary TEXT,
    language VARCHAR(10),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_case_id ON documents(case_id);

-- ==================== CORPUS PASSAGES (RAG) ====================
CREATE TABLE IF NOT EXISTS corpus_passages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_doc VARCHAR(200) NOT NULL,
    section_ref VARCHAR(100),
    page_number INTEGER,
    passage_text TEXT NOT NULL,
    embedding vector(384),
    language VARCHAR(10) DEFAULT 'en',
    category VARCHAR(50),
    version VARCHAR(20) DEFAULT '1.0',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corpus_category ON corpus_passages(category);

-- ==================== LAWYER DIRECTORY ====================
CREATE TABLE IF NOT EXISTS lawyer_directory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    bar_council_id VARCHAR(50) UNIQUE NOT NULL,
    languages TEXT[],
    districts TEXT[],
    specialization TEXT[],
    verified BOOLEAN DEFAULT FALSE,
    phone_encrypted TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== ANALYTICS (Anonymized) ====================
CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    language VARCHAR(10),
    district VARCHAR(100),
    topic VARCHAR(100),
    channel VARCHAR(20),
    success BOOLEAN,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at);

-- ==================== ROW LEVEL SECURITY ====================
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievance_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON cases
    FOR ALL TO service_role USING (true);

CREATE POLICY "anon_own_session" ON cases
    FOR SELECT TO anon
    USING (session_id IN (
        SELECT id FROM sessions WHERE phone_hash = current_setting('app.phone_hash', true)
    ));
