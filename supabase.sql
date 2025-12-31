-- Family Day Planner - Supabase Schema
-- This schema uses a shared space model with no authentication
-- All data is scoped to space_id = 'default'

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    space_id TEXT PRIMARY KEY DEFAULT 'default',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Day plans table
CREATE TABLE IF NOT EXISTS day_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id TEXT NOT NULL DEFAULT 'default',
    date DATE NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(space_id, date)
);

-- Day logs table
CREATE TABLE IF NOT EXISTS day_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id TEXT NOT NULL DEFAULT 'default',
    date DATE NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(space_id, date)
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    assigned_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    meta JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_day_plans_space_date ON day_plans(space_id, date);
CREATE INDEX IF NOT EXISTS idx_day_logs_space_date ON day_logs(space_id, date);
CREATE INDEX IF NOT EXISTS idx_tasks_space ON tasks(space_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_date ON tasks(assigned_date);

-- Enable Row Level Security
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for anonymous access (limited to space_id = 'default')

-- Settings policies
CREATE POLICY "Allow anon read settings for default space"
    ON settings FOR SELECT
    USING (space_id = 'default');

CREATE POLICY "Allow anon insert settings for default space"
    ON settings FOR INSERT
    WITH CHECK (space_id = 'default');

CREATE POLICY "Allow anon update settings for default space"
    ON settings FOR UPDATE
    USING (space_id = 'default')
    WITH CHECK (space_id = 'default');

-- Day plans policies
CREATE POLICY "Allow anon read day_plans for default space"
    ON day_plans FOR SELECT
    USING (space_id = 'default');

CREATE POLICY "Allow anon insert day_plans for default space"
    ON day_plans FOR INSERT
    WITH CHECK (space_id = 'default');

CREATE POLICY "Allow anon update day_plans for default space"
    ON day_plans FOR UPDATE
    USING (space_id = 'default')
    WITH CHECK (space_id = 'default');

CREATE POLICY "Allow anon delete day_plans for default space"
    ON day_plans FOR DELETE
    USING (space_id = 'default');

-- Day logs policies
CREATE POLICY "Allow anon read day_logs for default space"
    ON day_logs FOR SELECT
    USING (space_id = 'default');

CREATE POLICY "Allow anon insert day_logs for default space"
    ON day_logs FOR INSERT
    WITH CHECK (space_id = 'default');

CREATE POLICY "Allow anon update day_logs for default space"
    ON day_logs FOR UPDATE
    USING (space_id = 'default')
    WITH CHECK (space_id = 'default');

CREATE POLICY "Allow anon delete day_logs for default space"
    ON day_logs FOR DELETE
    USING (space_id = 'default');

-- Tasks policies
CREATE POLICY "Allow anon read tasks for default space"
    ON tasks FOR SELECT
    USING (space_id = 'default');

CREATE POLICY "Allow anon insert tasks for default space"
    ON tasks FOR INSERT
    WITH CHECK (space_id = 'default');

CREATE POLICY "Allow anon update tasks for default space"
    ON tasks FOR UPDATE
    USING (space_id = 'default')
    WITH CHECK (space_id = 'default');

CREATE POLICY "Allow anon delete tasks for default space"
    ON tasks FOR DELETE
    USING (space_id = 'default');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_day_plans_updated_at BEFORE UPDATE ON day_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_day_logs_updated_at BEFORE UPDATE ON day_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default settings
INSERT INTO settings (space_id, data) VALUES (
    'default',
    '{
        "constraints": [
            {"name": "Nap 1 Duration", "value": "90 min"},
            {"name": "Nap 2 Duration", "value": "90 min"},
            {"name": "Wake Window Before Nap 1", "value": "2.5 hrs"},
            {"name": "Wake Window Between Naps", "value": "3 hrs"},
            {"name": "Bedtime Target", "value": "7:00 PM"}
        ],
        "googleCalendar": null
    }'::jsonb
) ON CONFLICT (space_id) DO NOTHING;
