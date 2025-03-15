
-- Create schema for app
CREATE SCHEMA IF NOT EXISTS public;

-- Create tablatures table
CREATE TABLE IF NOT EXISTS public.tablatures (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    instrument TEXT NOT NULL CHECK (instrument IN ('guitar', 'bass')),
    tuning TEXT NOT NULL,
    key TEXT NOT NULL,
    tempo INTEGER NOT NULL,
    sections JSONB NOT NULL,
    user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.tablatures ENABLE ROW LEVEL SECURITY;

-- Create policies
-- 1. Allow users to view their own tablatures
CREATE POLICY "Users can view own tablatures" ON public.tablatures
    FOR SELECT USING (auth.uid() = user_id);

-- 2. Allow users to insert their own tablatures
CREATE POLICY "Users can insert own tablatures" ON public.tablatures
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 3. Allow users to update their own tablatures
CREATE POLICY "Users can update own tablatures" ON public.tablatures
    FOR UPDATE USING (auth.uid() = user_id);

-- 4. Allow users to delete their own tablatures
CREATE POLICY "Users can delete own tablatures" ON public.tablatures
    FOR DELETE USING (auth.uid() = user_id);

-- Function to update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update 'updated_at' timestamp
CREATE TRIGGER update_tablatures_updated_at
BEFORE UPDATE ON public.tablatures
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Create profiles table for additional user information
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    full_name TEXT,
    avatar_url TEXT,
    subscription_tier TEXT DEFAULT 'free',
    subscription_status TEXT DEFAULT 'inactive',
    subscription_ends_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Set up RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles
-- 1. Allow users to view their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

-- 2. Allow users to update their own profile
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- Trigger to update 'updated_at' timestamp for profiles
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Function to create a profile after user signup
CREATE OR REPLACE FUNCTION public.create_profile_for_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create a profile after user signup
CREATE TRIGGER create_profile_after_signup
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.create_profile_for_user();
