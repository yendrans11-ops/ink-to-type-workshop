CREATE TABLE public.font_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  local_id text NOT NULL,
  name text NOT NULL DEFAULT 'Untitled font',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  glyph_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, local_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.font_projects TO authenticated;
GRANT ALL ON public.font_projects TO service_role;

ALTER TABLE public.font_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their fonts" ON public.font_projects FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners add their fonts" ON public.font_projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update their fonts" ON public.font_projects FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete their fonts" ON public.font_projects FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_font_projects_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER font_projects_touch BEFORE UPDATE ON public.font_projects
FOR EACH ROW EXECUTE FUNCTION public.touch_font_projects_updated_at();

CREATE INDEX font_projects_user_updated ON public.font_projects (user_id, updated_at DESC);